ALTER TABLE articles ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS article_type text DEFAULT 'news';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS is_breaking boolean DEFAULT false;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS is_editors_pick boolean DEFAULT false;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS read_time integer DEFAULT 3;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS views integer DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_articles_created_at
  ON articles(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_slug
  ON articles(slug);
CREATE INDEX IF NOT EXISTS idx_articles_category
  ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_region
  ON articles(region);
CREATE INDEX IF NOT EXISTS idx_articles_type
  ON articles(article_type);

-- Verify RLS in Supabase dashboard:
-- 1. Public clients should only be able to SELECT published article data.
-- 2. INSERT/UPDATE/DELETE should be restricted to trusted server-side credentials.
