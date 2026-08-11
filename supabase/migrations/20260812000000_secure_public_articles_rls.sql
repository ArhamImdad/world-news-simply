-- All rows in public.articles are published content. The live schema has no
-- publication-status column, so public reads intentionally include every row.

ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;

-- Remove policies that apply to public frontend roles so an older permissive
-- write policy cannot survive this migration under an unknown policy name.
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
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.articles',
      existing_policy.policyname
    );
  END LOOP;
END
$$;

-- Frontend users only need read access. service_role is deliberately not
-- changed here and continues to bypass RLS for trusted server-side ingestion.
REVOKE ALL PRIVILEGES ON TABLE public.articles FROM anon, authenticated;
GRANT SELECT ON TABLE public.articles TO anon, authenticated;

CREATE POLICY articles_public_read
  ON public.articles
  FOR SELECT
  TO anon, authenticated
  USING (true);
