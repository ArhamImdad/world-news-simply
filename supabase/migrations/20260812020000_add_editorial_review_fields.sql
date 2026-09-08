ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS quality_score smallint,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.articles'::regclass
      AND conname = 'articles_quality_score_check'
  ) THEN
    ALTER TABLE public.articles
      ADD CONSTRAINT articles_quality_score_check
      CHECK (quality_score IS NULL OR quality_score BETWEEN 0 AND 100);
  END IF;
END
$$;

COMMENT ON COLUMN public.articles.quality_score IS
  'Internal pre-publication quality-gate score. Not selected by public pages.';
COMMENT ON COLUMN public.articles.approved_at IS
  'Time the atomic autonomous publication gate approved the article for publication.';

-- Keep internal review and Unsplash tracking metadata inaccessible to browser roles.
-- RLS still limits the granted public columns to approved rows only.
REVOKE ALL PRIVILEGES ON TABLE public.articles FROM anon, authenticated;
GRANT SELECT (
  id,
  slug,
  title,
  content,
  summary,
  image_url,
  source_url,
  category,
  created_at,
  region,
  article_type,
  is_breaking,
  is_editors_pick,
  read_time,
  views,
  publication_status,
  sources,
  image_photographer_name,
  image_photographer_profile_url,
  image_attribution_url
) ON public.articles TO anon, authenticated;
