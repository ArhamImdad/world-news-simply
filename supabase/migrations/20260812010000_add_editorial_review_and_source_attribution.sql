-- Existing rows were already published before this workflow and remain public.
-- New automated ingestion explicitly writes publication_status = 'draft'.
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS publication_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS image_photographer_name text,
  ADD COLUMN IF NOT EXISTS image_photographer_profile_url text,
  ADD COLUMN IF NOT EXISTS image_attribution_url text,
  ADD COLUMN IF NOT EXISTS image_download_location text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.articles'::regclass
      AND conname = 'articles_publication_status_check'
  ) THEN
    ALTER TABLE public.articles
      ADD CONSTRAINT articles_publication_status_check
      CHECK (publication_status IN ('draft', 'approved', 'rejected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.articles'::regclass
      AND conname = 'articles_sources_array_check'
  ) THEN
    ALTER TABLE public.articles
      ADD CONSTRAINT articles_sources_array_check
      CHECK (jsonb_typeof(sources) = 'array');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS articles_publication_status_created_at_idx
  ON public.articles (publication_status, created_at DESC);

ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  existing_policy record;
BEGIN
  FOR existing_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'articles'
      AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.articles', existing_policy.policyname);
  END LOOP;
END
$$;

CREATE POLICY articles_public_read
  ON public.articles
  FOR SELECT
  TO anon, authenticated
  USING (publication_status = 'approved');

REVOKE ALL PRIVILEGES ON TABLE public.articles FROM anon, authenticated;
GRANT SELECT ON TABLE public.articles TO anon, authenticated;

COMMENT ON COLUMN public.articles.publication_status IS
  'Public visibility state. Autonomous preparation uses drafts; only approved rows are public.';
