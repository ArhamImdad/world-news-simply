-- AdSense monetization is deliberately separate from publication approval.
-- Existing and future articles fail closed as pending until a human reviewer
-- records an explicit monetization decision through the private RPC below.

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS adsense_review_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS adsense_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS adsense_reviewed_by text;

UPDATE public.articles
SET adsense_review_status = 'pending',
    adsense_reviewed_at = NULL,
    adsense_reviewed_by = NULL
WHERE adsense_review_status IS NULL;

ALTER TABLE public.articles
  ALTER COLUMN adsense_review_status SET DEFAULT 'pending',
  ALTER COLUMN adsense_review_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.articles'::regclass
      AND conname = 'articles_adsense_review_status_check'
  ) THEN
    ALTER TABLE public.articles
      ADD CONSTRAINT articles_adsense_review_status_check
      CHECK (adsense_review_status IN ('pending', 'approved', 'rejected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.articles'::regclass
      AND conname = 'articles_adsense_review_audit_check'
  ) THEN
    ALTER TABLE public.articles
      ADD CONSTRAINT articles_adsense_review_audit_check CHECK (
        (adsense_review_status = 'pending' AND adsense_reviewed_at IS NULL AND adsense_reviewed_by IS NULL)
        OR
        (adsense_review_status IN ('approved', 'rejected') AND adsense_reviewed_at IS NOT NULL
          AND nullif(btrim(adsense_reviewed_by), '') IS NOT NULL)
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS articles_adsense_review_status_idx
  ON public.articles (adsense_review_status, approved_at DESC)
  WHERE publication_status = 'approved';

CREATE OR REPLACE FUNCTION public.review_article_for_adsense(
  p_article_id uuid,
  p_review_status text,
  p_reviewed_by text
)
RETURNS TABLE (
  article_id uuid,
  adsense_review_status text,
  adsense_reviewed_at timestamptz,
  adsense_reviewed_by text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_review_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'AdSense review status must be approved or rejected';
  END IF;

  IF nullif(btrim(p_reviewed_by), '') IS NULL OR length(btrim(p_reviewed_by)) > 200 THEN
    RAISE EXCEPTION 'A concise human reviewer identifier is required';
  END IF;

  RETURN QUERY
  UPDATE public.articles article
  SET adsense_review_status = p_review_status,
      adsense_reviewed_at = clock_timestamp(),
      adsense_reviewed_by = btrim(p_reviewed_by)
  WHERE article.id = p_article_id
    AND article.publication_status = 'approved'
  RETURNING article.id, article.adsense_review_status,
    article.adsense_reviewed_at, article.adsense_reviewed_by;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only an existing published article can receive an AdSense review decision';
  END IF;
END;
$$;

REVOKE UPDATE (adsense_review_status, adsense_reviewed_at, adsense_reviewed_by)
  ON TABLE public.articles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_article_for_adsense(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_article_for_adsense(uuid, text, text)
  TO service_role;

COMMENT ON COLUMN public.articles.adsense_review_status IS
  'Human monetization-curation decision. Independent of publication and factual-quality approval; pending is always ad-free.';
COMMENT ON COLUMN public.articles.adsense_reviewed_at IS
  'Time a human monetization reviewer recorded the latest approved or rejected decision.';
COMMENT ON COLUMN public.articles.adsense_reviewed_by IS
  'Private operator identifier for the latest human monetization review.';
COMMENT ON FUNCTION public.review_article_for_adsense(uuid, text, text) IS
  'Service-role-only human AdSense monetization approval or rejection for an already-published article.';
