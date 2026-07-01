export const ARTICLE_CATEGORIES = [
  "All",
  "World",
  "Politics",
  "Technology",
  "Business",
  "Sports",
  "Health",
  "Opinion",
] as const;

export const ARTICLE_REGIONS = [
  "All",
  "Asia",
  "Europe",
  "Middle East",
  "Americas",
  "Africa",
] as const;

export const ARTICLE_TYPES = ["news", "opinion", "long-read", "video"] as const;

export type ArticleCategory = (typeof ARTICLE_CATEGORIES)[number];
export type ArticleRegion = (typeof ARTICLE_REGIONS)[number];
export type ArticleType = (typeof ARTICLE_TYPES)[number];

export type Article = {
  id: string;
  title: string;
  content: string;
  summary: string;
  image_url: string;
  source_url: string;
  category: Exclude<ArticleCategory, "All"> | string;
  created_at: string;
  region?: Exclude<ArticleRegion, "All"> | "Global" | string | null;
  article_type?: ArticleType | string | null;
  is_breaking?: boolean | null;
  is_editors_pick?: boolean | null;
  read_time?: number | null;
  views?: number | null;
};

export type RewrittenArticle = {
  title: string;
  content: string;
  summary: string;
  is_breaking: boolean;
  read_time: number;
};

export const ARTICLE_SELECT =
  "id,title,content,summary,image_url,source_url,category,created_at,region,article_type,is_breaking,is_editors_pick,read_time,views";
