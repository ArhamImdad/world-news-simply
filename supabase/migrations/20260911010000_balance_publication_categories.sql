-- Coverage floor: three published articles per category, then seven-day balance.
-- Non-destructive: preserves publication slot locking, eligibility and duplicate checks.
BEGIN;

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
    AND candidate.category IN ('World', 'Politics', 'Technology', 'Business', 'Economy', 'Science', 'Sports', 'Health', 'Opinion')
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
    -- Coverage outranks score; all original eligibility and duplicate guards remain.
    CASE WHEN (SELECT count(*) FROM public.articles p
      WHERE p.publication_status = 'approved' AND p.category = candidate.category) = 0 THEN 0
      WHEN (SELECT count(*) FROM public.articles p
      WHERE p.publication_status = 'approved' AND p.category = candidate.category) < 3 THEN 1 ELSE 2 END,
    CASE WHEN (SELECT count(*) FROM public.articles p
      WHERE p.publication_status = 'approved' AND p.category = candidate.category) < 3
      THEN (SELECT count(*) FROM public.articles p
        WHERE p.publication_status = 'approved' AND p.category = candidate.category)
      ELSE (SELECT count(*) FROM public.articles p
        WHERE p.publication_status = 'approved' AND p.category = candidate.category
          AND p.approved_at >= now() - interval '7 days') END,
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

CREATE INDEX IF NOT EXISTS articles_published_category_coverage_idx
  ON public.articles (category, approved_at DESC) WHERE publication_status = 'approved';

COMMIT;
