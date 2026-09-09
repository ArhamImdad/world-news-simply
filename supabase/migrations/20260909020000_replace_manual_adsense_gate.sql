-- Publication and AdSense inventory quality are now determined by automated,
-- fail-closed editorial evidence. Preserve legacy review data for audit history,
-- but retire the manual mutation path and keep the columns private.
DROP FUNCTION IF EXISTS public.review_article_for_adsense(uuid, text, text);

REVOKE UPDATE (adsense_review_status, adsense_reviewed_at, adsense_reviewed_by)
  ON TABLE public.articles FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.articles.adsense_review_status IS
  'Legacy monetization-review state retained for history; no longer gates publication or AdSense eligibility.';
COMMENT ON COLUMN public.articles.adsense_reviewed_at IS
  'Legacy monetization-review timestamp retained for history.';
COMMENT ON COLUMN public.articles.adsense_reviewed_by IS
  'Legacy private reviewer identifier retained for history.';
