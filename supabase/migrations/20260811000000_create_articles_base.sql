-- Bootstrap the articles relation for clean environments. Existing projects
-- retain their table and receive only any missing legacy application columns.

CREATE TABLE IF NOT EXISTS public.articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  content text NOT NULL,
  summary text NOT NULL,
  image_url text NOT NULL,
  source_url text,
  category text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS article_type text DEFAULT 'news',
  ADD COLUMN IF NOT EXISTS is_breaking boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_editors_pick boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS read_time integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS views integer DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_articles_created_at
  ON public.articles (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_slug
  ON public.articles (slug);
CREATE INDEX IF NOT EXISTS idx_articles_category
  ON public.articles (category);
CREATE INDEX IF NOT EXISTS idx_articles_region
  ON public.articles (region);
CREATE INDEX IF NOT EXISTS idx_articles_type
  ON public.articles (article_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_source_url_unique
  ON public.articles (source_url)
  WHERE source_url IS NOT NULL AND source_url <> '';
