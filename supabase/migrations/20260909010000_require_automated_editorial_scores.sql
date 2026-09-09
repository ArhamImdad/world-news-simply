-- Extend the existing autonomous queue predicate without changing ranking,
-- duplicate detection, reserve controls, or publication scheduling.
DO $$
BEGIN
  IF to_regprocedure('public.legacy_ready_payload_is_eligible(jsonb,text[],timestamptz)') IS NULL THEN
    ALTER FUNCTION public.ready_payload_is_eligible(jsonb, text[], timestamptz)
      RENAME TO legacy_ready_payload_is_eligible;
  END IF;
  IF to_regprocedure('public.legacy_ready_row_is_eligible(public.articles,text[],timestamptz)') IS NULL THEN
    ALTER FUNCTION public.ready_row_is_eligible(public.articles, text[], timestamptz)
      RENAME TO legacy_ready_row_is_eligible;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.automated_editorial_validation_is_eligible(p_validation jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN jsonb_typeof(p_validation) = 'object'
    AND coalesce((p_validation->>'automatedEditorialPassed')::boolean, false)
    AND coalesce((p_validation->>'factualCompletenessScore')::integer, 0) >= 90
    AND coalesce((p_validation->>'originalityScore')::integer, 0) >= 90
    AND coalesce((p_validation->>'usefulnessScore')::integer, 0) >= 90
    AND coalesce((p_validation->>'meaningfulContextScore')::integer, 0) >= 90
    AND coalesce((p_validation->>'headlineQualityScore')::integer, 0) >= 90
    AND coalesce((p_validation->>'addedValueScore')::integer, 0) >= 90
    AND NOT coalesce((p_validation->>'mostlyParaphrase')::boolean, true)
    AND NOT coalesce((p_validation->>'speculativeOrInvented')::boolean, true);
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.ready_payload_is_eligible(
  p_article jsonb,
  p_permitted_source_ids text[],
  p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.legacy_ready_payload_is_eligible(p_article, p_permitted_source_ids, p_at)
    AND public.automated_editorial_validation_is_eligible(p_article->'validation_results');
$$;

CREATE OR REPLACE FUNCTION public.ready_row_is_eligible(
  p_article public.articles,
  p_permitted_source_ids text[],
  p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.legacy_ready_row_is_eligible(p_article, p_permitted_source_ids, p_at)
    AND public.automated_editorial_validation_is_eligible(p_article.validation_results);
$$;

REVOKE ALL ON FUNCTION public.automated_editorial_validation_is_eligible(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.legacy_ready_payload_is_eligible(jsonb, text[], timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.legacy_ready_row_is_eligible(public.articles, text[], timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ready_payload_is_eligible(jsonb, text[], timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ready_row_is_eligible(public.articles, text[], timestamptz)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.automated_editorial_validation_is_eligible(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.legacy_ready_payload_is_eligible(jsonb, text[], timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.legacy_ready_row_is_eligible(public.articles, text[], timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.ready_payload_is_eligible(jsonb, text[], timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.ready_row_is_eligible(public.articles, text[], timestamptz) TO service_role;

COMMENT ON FUNCTION public.automated_editorial_validation_is_eligible(jsonb) IS
  'Fail-closed automated editorial score and safety predicate required by queue admission and publication.';
