-- Autonomous preparation queue and atomic publication. This migration does not
-- publish or rewrite any existing row. Legacy records keep null queue metadata.

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS editorial_state text,
  ADD COLUMN IF NOT EXISTS prepared_at timestamptz,
  ADD COLUMN IF NOT EXISTS publish_after timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS freshness_class text,
  ADD COLUMN IF NOT EXISTS content_pool text,
  ADD COLUMN IF NOT EXISTS publication_priority smallint,
  ADD COLUMN IF NOT EXISTS topic_signature text[],
  ADD COLUMN IF NOT EXISTS validation_results jsonb,
  ADD COLUMN IF NOT EXISTS generation_metadata jsonb,
  ADD COLUMN IF NOT EXISTS preparation_key text,
  ADD COLUMN IF NOT EXISTS publication_slot timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.articles'::regclass AND conname = 'articles_editorial_state_check') THEN
    ALTER TABLE public.articles ADD CONSTRAINT articles_editorial_state_check
      CHECK (editorial_state IS NULL OR editorial_state IN ('candidate', 'qualified', 'ready', 'published', 'expired', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.articles'::regclass AND conname = 'articles_freshness_class_check') THEN
    ALTER TABLE public.articles ADD CONSTRAINT articles_freshness_class_check
      CHECK (freshness_class IS NULL OR freshness_class IN ('BREAKING', 'CURRENT', 'ANALYSIS', 'EVERGREEN'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.articles'::regclass AND conname = 'articles_publication_priority_check') THEN
    ALTER TABLE public.articles ADD CONSTRAINT articles_publication_priority_check
      CHECK (publication_priority IS NULL OR publication_priority BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.articles'::regclass AND conname = 'articles_content_pool_check') THEN
    ALTER TABLE public.articles ADD CONSTRAINT articles_content_pool_check
      CHECK (content_pool IS NULL OR content_pool IN ('breaking', 'government-records', 'economic-data', 'evergreen'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.articles'::regclass AND conname = 'articles_ready_requires_modern_metadata_check') THEN
    ALTER TABLE public.articles ADD CONSTRAINT articles_ready_requires_modern_metadata_check CHECK (
      editorial_state <> 'ready' OR (
        publication_status = 'draft' AND quality_score >= 90 AND prepared_at IS NOT NULL AND
        publish_after IS NOT NULL AND expires_at IS NOT NULL AND expires_at > prepared_at AND
        jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) >= 2 AND
        jsonb_typeof(validation_results) = 'object' AND jsonb_typeof(generation_metadata) = 'object' AND
        coalesce((generation_metadata->>'modernPipeline')::boolean, false) AND
        coalesce((generation_metadata->>'preparedAutomatically')::boolean, false)
      )
    );
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS articles_preparation_key_unique_idx
  ON public.articles (preparation_key) WHERE preparation_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS articles_publication_slot_unique_idx
  ON public.articles (publication_slot) WHERE publication_slot IS NOT NULL;
CREATE INDEX IF NOT EXISTS articles_ready_queue_rank_idx
  ON public.articles (publication_priority DESC, quality_score DESC, prepared_at DESC)
  WHERE publication_status = 'draft' AND editorial_state = 'ready';
CREATE INDEX IF NOT EXISTS articles_topic_signature_gin_idx
  ON public.articles USING gin (topic_signature);

CREATE OR REPLACE FUNCTION public.topic_signature_similarity(p_left text[], p_right text[])
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH intersection_count AS (
    SELECT count(DISTINCT value)::numeric AS count
    FROM unnest(coalesce(p_left, ARRAY[]::text[])) value
    WHERE value = ANY(coalesce(p_right, ARRAY[]::text[]))
  ), union_count AS (
    SELECT count(DISTINCT value)::numeric AS count
    FROM unnest(coalesce(p_left, ARRAY[]::text[]) || coalesce(p_right, ARRAY[]::text[])) value
  )
  SELECT CASE WHEN union_count.count = 0 THEN 0 ELSE intersection_count.count / union_count.count END
  FROM intersection_count, union_count;
$$;

CREATE OR REPLACE FUNCTION public.ready_payload_is_eligible(
  p_article jsonb,
  p_permitted_source_ids text[],
  p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  source_count integer;
  domain_count integer;
BEGIN
  IF p_article->>'publication_status' <> 'draft' OR p_article->>'editorial_state' <> 'ready' OR
     coalesce((p_article->>'quality_score')::integer, 0) < 90 OR
     coalesce((p_article->>'expires_at')::timestamptz, '-infinity') <= p_at OR
     coalesce((p_article->>'publish_after')::timestamptz, 'infinity') > p_at OR
     p_article->'generation_metadata'->>'pipelineVersion' <> 'autonomous-queue-v1' OR
     NOT coalesce((p_article->'generation_metadata'->>'modernPipeline')::boolean, false) OR
     NOT coalesce((p_article->'generation_metadata'->>'preparedAutomatically')::boolean, false) OR
     NOT coalesce((p_article->'validation_results'->>'factualSupportPassed')::boolean, false) OR
     NOT coalesce((p_article->'validation_results'->>'originalityPassed')::boolean, false) OR
     NOT coalesce((p_article->'validation_results'->>'duplicateDetectionPassed')::boolean, false) OR
     NOT coalesce((p_article->'validation_results'->>'sourceOverlapPassed')::boolean, false) OR
     NOT coalesce((p_article->'validation_results'->>'completeAttribution')::boolean, false) OR
     coalesce((p_article->'validation_results'->>'unsupportedClaims')::boolean, true) OR
     coalesce((p_article->'validation_results'->>'inventedQuotes')::boolean, true) OR
     coalesce((p_article->'validation_results'->>'inventedStatistics')::boolean, true) OR
     jsonb_array_length(coalesce(p_article->'validation_results'->'hardWarnings', '[]'::jsonb)) <> 0 OR
     jsonb_typeof(p_article->'sources') <> 'array' OR
     nullif(btrim(p_article->>'title'), '') IS NULL OR nullif(btrim(p_article->>'summary'), '') IS NULL OR
     nullif(btrim(p_article->>'content'), '') IS NULL OR nullif(btrim(p_article->>'category'), '') IS NULL OR
     coalesce(p_article->>'content_pool', '') NOT IN ('breaking', 'government-records', 'economic-data', 'evergreen') OR
     NOT ((p_article->>'image_url') LIKE '/%' OR ((p_article->>'image_url') ~ '^https?://' AND
       nullif(p_article->>'image_photographer_name','') IS NOT NULL AND nullif(p_article->>'image_attribution_url','') IS NOT NULL)) OR
     cardinality(ARRAY(SELECT jsonb_array_elements_text(coalesce(p_article->'topic_signature', '[]'::jsonb)))) < 3 THEN
    RETURN false;
  END IF;

  SELECT count(*), count(DISTINCT regexp_replace(split_part(regexp_replace(source->>'url', '^https?://', '', 'i'), '/', 1), '^www\.', '', 'i'))
  INTO source_count, domain_count
  FROM jsonb_array_elements(p_article->'sources') source
  WHERE source ?& ARRAY['title','url','publisher','licenseType','sourceType','isPrimary','registryId','recognized',
                        'commercialUseAllowed','aiProcessingAllowed','transformationAllowed','permissionUrl']
    AND source->>'registryId' = ANY(p_permitted_source_ids)
    AND coalesce((source->>'recognized')::boolean, false)
    AND coalesce((source->>'commercialUseAllowed')::boolean, false)
    AND coalesce((source->>'aiProcessingAllowed')::boolean, false)
    AND coalesce((source->>'transformationAllowed')::boolean, false)
    AND source->>'url' ~ '^https?://'
    AND source->>'permissionUrl' ~ '^https?://';

  RETURN source_count = jsonb_array_length(p_article->'sources') AND source_count >= 2 AND domain_count >= 2
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_article->'sources') source WHERE coalesce((source->>'isPrimary')::boolean, false));
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.ready_row_is_eligible(
  p_article public.articles,
  p_permitted_source_ids text[],
  p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  source_count integer;
  domain_count integer;
BEGIN
  IF p_article.publication_status <> 'draft' OR p_article.editorial_state <> 'ready' OR
     coalesce(p_article.quality_score, 0) < 90 OR p_article.prepared_at IS NULL OR
     p_article.publish_after IS NULL OR p_article.publish_after > p_at OR
     p_article.expires_at IS NULL OR p_article.expires_at <= p_at OR
     p_article.generation_metadata->>'pipelineVersion' <> 'autonomous-queue-v1' OR
     NOT coalesce((p_article.generation_metadata->>'modernPipeline')::boolean, false) OR
     NOT coalesce((p_article.generation_metadata->>'preparedAutomatically')::boolean, false) OR
     nullif(btrim(p_article.generation_metadata->>'provider'), '') IS NULL OR
     nullif(btrim(p_article.generation_metadata->>'model'), '') IS NULL OR
     NOT coalesce((p_article.validation_results->>'factualSupportPassed')::boolean, false) OR
     NOT coalesce((p_article.validation_results->>'originalityPassed')::boolean, false) OR
     NOT coalesce((p_article.validation_results->>'duplicateDetectionPassed')::boolean, false) OR
     NOT coalesce((p_article.validation_results->>'sourceOverlapPassed')::boolean, false) OR
     NOT coalesce((p_article.validation_results->>'completeAttribution')::boolean, false) OR
     coalesce((p_article.validation_results->>'unsupportedClaims')::boolean, true) OR
     coalesce((p_article.validation_results->>'inventedQuotes')::boolean, true) OR
     coalesce((p_article.validation_results->>'inventedStatistics')::boolean, true) OR
     (CASE WHEN jsonb_typeof(p_article.validation_results->'hardWarnings') = 'array'
       THEN jsonb_array_length(p_article.validation_results->'hardWarnings') ELSE 1 END) <> 0 OR
     jsonb_typeof(p_article.sources) <> 'array' OR cardinality(p_article.topic_signature) < 3 OR
     nullif(btrim(p_article.title), '') IS NULL OR nullif(btrim(p_article.summary), '') IS NULL OR
     nullif(btrim(p_article.content), '') IS NULL OR nullif(btrim(p_article.category), '') IS NULL OR
     coalesce(p_article.content_pool, '') NOT IN ('breaking', 'government-records', 'economic-data', 'evergreen') OR
     NOT (p_article.image_url LIKE '/%' OR (p_article.image_url ~ '^https?://' AND
       p_article.image_photographer_name IS NOT NULL AND p_article.image_attribution_url IS NOT NULL)) THEN
    RETURN false;
  END IF;

  SELECT count(*), count(DISTINCT regexp_replace(split_part(regexp_replace(source->>'url', '^https?://', '', 'i'), '/', 1), '^www\.', '', 'i'))
  INTO source_count, domain_count
  FROM jsonb_array_elements(p_article.sources) source
  WHERE source ?& ARRAY['title','url','publisher','licenseType','sourceType','isPrimary','registryId','recognized',
                        'commercialUseAllowed','aiProcessingAllowed','transformationAllowed','permissionUrl']
    AND nullif(btrim(source->>'title'), '') IS NOT NULL AND nullif(btrim(source->>'publisher'), '') IS NOT NULL
    AND nullif(btrim(source->>'licenseType'), '') IS NOT NULL AND source->>'licenseType' <> 'unknown'
    AND source->>'registryId' = ANY(p_permitted_source_ids)
    AND coalesce((source->>'recognized')::boolean, false)
    AND coalesce((source->>'commercialUseAllowed')::boolean, false)
    AND coalesce((source->>'aiProcessingAllowed')::boolean, false)
    AND coalesce((source->>'transformationAllowed')::boolean, false)
    AND source->>'url' ~ '^https?://' AND source->>'permissionUrl' ~ '^https?://';

  RETURN source_count = jsonb_array_length(p_article.sources) AND source_count >= 2 AND domain_count >= 2
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_article.sources) source WHERE coalesce((source->>'isPrimary')::boolean, false));
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_ready_article(
  p_article jsonb,
  p_max_queue_depth integer,
  p_permitted_source_ids text[]
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  inserted_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('autonomous-ready-queue'));
  IF NOT public.ready_payload_is_eligible(p_article, p_permitted_source_ids, now()) THEN
    RETURN NULL;
  END IF;
  IF (SELECT count(*) FROM public.articles WHERE publication_status = 'draft' AND editorial_state = 'ready' AND expires_at > now()) >= p_max_queue_depth THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.articles existing
    WHERE existing.preparation_key = p_article->>'preparation_key'
       OR (existing.publication_status = 'approved' AND existing.approved_at > now() - interval '30 days'
           AND public.topic_signature_similarity(existing.topic_signature,
             ARRAY(SELECT jsonb_array_elements_text(p_article->'topic_signature'))) >= 0.58)
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.articles (
    slug, title, content, summary, image_url, image_photographer_name, image_photographer_profile_url,
    image_attribution_url, image_download_location, source_url, sources, publication_status, editorial_state,
    quality_score, category, region, article_type, is_breaking, is_editors_pick, read_time, views,
    prepared_at, publish_after, expires_at, freshness_class, publication_priority, topic_signature,
    content_pool, validation_results, generation_metadata, preparation_key
  ) VALUES (
    p_article->>'slug', p_article->>'title', p_article->>'content', p_article->>'summary', p_article->>'image_url',
    nullif(p_article->>'image_photographer_name',''), nullif(p_article->>'image_photographer_profile_url',''),
    nullif(p_article->>'image_attribution_url',''), nullif(p_article->>'image_download_location',''),
    p_article->>'source_url', p_article->'sources', 'draft', 'ready', (p_article->>'quality_score')::smallint,
    p_article->>'category', p_article->>'region', p_article->>'article_type', (p_article->>'is_breaking')::boolean,
    false, (p_article->>'read_time')::integer, 0, (p_article->>'prepared_at')::timestamptz,
    (p_article->>'publish_after')::timestamptz, (p_article->>'expires_at')::timestamptz,
    p_article->>'freshness_class', (p_article->>'publication_priority')::smallint,
    ARRAY(SELECT jsonb_array_elements_text(p_article->'topic_signature')),
    p_article->>'content_pool', p_article->'validation_results', p_article->'generation_metadata', p_article->>'preparation_key'
  ) RETURNING id INTO inserted_id;
  RETURN inserted_id;
EXCEPTION WHEN unique_violation THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_next_ready_article(
  p_publication_slot timestamptz,
  p_permitted_source_ids text[]
)
RETURNS TABLE (id uuid, slug text, title text, category text, freshness_class text, was_published boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  selected_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('autonomous-publication-scheduler'));

  RETURN QUERY SELECT a.id, a.slug, a.title, a.category, a.freshness_class, false
  FROM public.articles a WHERE a.publication_slot = p_publication_slot LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  UPDATE public.articles SET editorial_state = 'expired'
  WHERE publication_status = 'draft' AND editorial_state = 'ready' AND expires_at <= now();

  SELECT candidate.id INTO selected_id
  FROM public.articles candidate
  WHERE candidate.publication_status = 'draft' AND candidate.editorial_state = 'ready'
    AND public.ready_row_is_eligible(candidate, p_permitted_source_ids, now())
    AND (
      NOT coalesce((
        SELECT count(*) = 9 AND bool_and(recent.category = candidate.category)
        FROM (SELECT published_category.category FROM public.articles published_category
              WHERE published_category.publication_status = 'approved'
              ORDER BY published_category.approved_at DESC NULLS LAST LIMIT 9) recent
      ), false)
      OR NOT EXISTS (
        SELECT 1 FROM public.articles diverse
        WHERE diverse.publication_status = 'draft' AND diverse.editorial_state = 'ready'
          AND diverse.category <> candidate.category
          AND public.ready_row_is_eligible(diverse, p_permitted_source_ids, now())
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.articles published
      WHERE published.publication_status = 'approved' AND (
        (published.approved_at > candidate.prepared_at AND published.source_url = candidate.source_url) OR
        (published.approved_at > now() - interval '30 days' AND
         public.topic_signature_similarity(published.topic_signature, candidate.topic_signature) >= 0.58)
      )
    )
  ORDER BY
    coalesce(candidate.publication_priority, 0) + candidate.quality_score * 2 +
      CASE WHEN candidate.freshness_class = 'BREAKING' THEN 50
           WHEN candidate.freshness_class = 'CURRENT' THEN 40
           WHEN candidate.freshness_class = 'ANALYSIS' AND candidate.content_pool <> 'economic-data' THEN 30
           WHEN candidate.content_pool = 'economic-data' THEN 20 ELSE 10 END -
      4 * (SELECT count(*) FROM (SELECT recent.category FROM public.articles recent WHERE recent.publication_status = 'approved' ORDER BY recent.approved_at DESC NULLS LAST LIMIT 10) recent_categories WHERE recent_categories.category = candidate.category)
      DESC,
    candidate.prepared_at DESC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF selected_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  UPDATE public.articles selected SET
    publication_status = 'approved', editorial_state = 'published', approved_at = now(),
    created_at = now(), publication_slot = p_publication_slot
  WHERE selected.id = selected_id AND selected.publication_status = 'draft' AND selected.editorial_state = 'ready'
  RETURNING selected.id, selected.slug, selected.title, selected.category, selected.freshness_class, true;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_ready_article(jsonb, integer, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_next_ready_article(timestamptz, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_ready_article(jsonb, integer, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_next_ready_article(timestamptz, text[]) TO service_role;

COMMENT ON COLUMN public.articles.editorial_state IS 'Private autonomous preparation lifecycle; null identifies records outside the modern queue.';
COMMENT ON COLUMN public.articles.prepared_at IS 'Time all automatic publication gates passed; distinct from public created_at.';
COMMENT ON COLUMN public.articles.publication_slot IS 'Unique two-hour scheduler slot used for database-level idempotency.';
