-- Hide pre-licensing-pipeline articles without deleting or rewriting them.
-- This migration intentionally fails and rolls back unless the audited legacy
-- fingerprint still identifies exactly the expected 892 approved rows.

DO $$
DECLARE
  legacy_approved_count bigint;
  legacy_draft_count bigint;
  affected_count bigint;
BEGIN
  SELECT count(*)
  INTO legacy_approved_count
  FROM public.articles
  WHERE publication_status = 'approved'
    AND sources = '[]'::jsonb
    AND quality_score IS NULL
    AND approved_at IS NULL;

  IF legacy_approved_count <> 892 THEN
    RAISE EXCEPTION
      'Legacy cleanup aborted: expected exactly 892 approved legacy rows, found %.',
      legacy_approved_count;
  END IF;

  -- This makes the final draft-count assertion unambiguous and prevents the
  -- migration from silently including unrelated drafts with the same legacy
  -- fingerprint.
  SELECT count(*)
  INTO legacy_draft_count
  FROM public.articles
  WHERE publication_status = 'draft'
    AND sources = '[]'::jsonb
    AND quality_score IS NULL
    AND approved_at IS NULL;

  IF legacy_draft_count <> 0 THEN
    RAISE EXCEPTION
      'Legacy cleanup aborted: expected 0 pre-existing draft rows with the legacy fingerprint, found %.',
      legacy_draft_count;
  END IF;

  UPDATE public.articles
  SET
    publication_status = 'draft',
    reviewed_at = NULL,
    reviewed_by = NULL,
    approved_at = NULL,
    rejection_reason = 'Legacy licensing and attribution review pending'
  WHERE publication_status = 'approved'
    AND sources = '[]'::jsonb
    AND quality_score IS NULL
    AND approved_at IS NULL;

  GET DIAGNOSTICS affected_count = ROW_COUNT;

  IF affected_count <> 892 THEN
    RAISE EXCEPTION
      'Legacy cleanup aborted: expected to update exactly 892 rows, updated %.',
      affected_count;
  END IF;

  SELECT count(*)
  INTO legacy_approved_count
  FROM public.articles
  WHERE publication_status = 'approved'
    AND sources = '[]'::jsonb
    AND quality_score IS NULL
    AND approved_at IS NULL;

  IF legacy_approved_count <> 0 THEN
    RAISE EXCEPTION
      'Legacy cleanup verification failed: % approved legacy rows remain.',
      legacy_approved_count;
  END IF;

  SELECT count(*)
  INTO legacy_draft_count
  FROM public.articles
  WHERE publication_status = 'draft'
    AND sources = '[]'::jsonb
    AND quality_score IS NULL
    AND approved_at IS NULL;

  IF legacy_draft_count <> 892 THEN
    RAISE EXCEPTION
      'Legacy cleanup verification failed: expected exactly 892 matching draft rows, found %.',
      legacy_draft_count;
  END IF;

  -- The approved-only RLS policy must still exist. Public application queries
  -- also explicitly filter publication_status = 'approved', so these drafts
  -- remain absent from lists, sitemap output, and direct article responses.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'articles'
      AND policyname = 'articles_public_read'
      AND cmd = 'SELECT'
      AND roles @> ARRAY['anon']::name[]
      AND roles @> ARRAY['authenticated']::name[]
      AND qual = '(publication_status = ''approved''::text)'
  ) THEN
    RAISE EXCEPTION
      'Legacy cleanup aborted: the expected approved-only public SELECT policy is missing or changed.';
  END IF;
END
$$;
