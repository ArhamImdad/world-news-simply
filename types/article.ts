import type { ArticleQualityReview } from "@/lib/article-audit";
export type { ArticleQualityReview } from "@/lib/article-audit";

export const ARTICLE_CATEGORIES = [
  "All",
  "World",
  "Politics",
  "Technology",
  "Business",
  "Economy",
  "Science",
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
  slug?: string | null;
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
  publication_status?: "draft" | "approved" | "rejected" | null;
  editorial_state?: EditorialState | null;
  sources?: ArticleSource[] | null;
  image_photographer_name?: string | null;
  image_photographer_profile_url?: string | null;
  image_attribution_url?: string | null;
  image_download_location?: string | null;
  quality_score?: number | null;
  approved_at?: string | null;
  prepared_at?: string | null;
  publish_after?: string | null;
  expires_at?: string | null;
  freshness_class?: FreshnessClass | null;
  content_pool?: ContentPool | null;
  publication_priority?: number | null;
  topic_signature?: string[] | null;
  validation_results?: ArticleValidationResults | null;
  generation_metadata?: ArticleGenerationMetadata | null;
  adsense_review_status?: AdsenseReviewStatus | null;
  adsense_reviewed_at?: string | null;
  adsense_reviewed_by?: string | null;
};

export type EditorialState = "candidate" | "qualified" | "ready" | "published" | "expired" | "rejected";
export type FreshnessClass = "BREAKING" | "CURRENT" | "ANALYSIS" | "EVERGREEN";
export type ContentPool = "breaking" | "government-records" | "economic-data" | "evergreen";
export type AdsenseReviewStatus = "pending" | "approved" | "rejected";

export type ArticleSource = {
  title: string;
  url: string;
  publisher: string;
  publishedAt: string | null;
  licenseType: string;
  sourceType: string;
  isPrimary: boolean;
  registryId: string;
  recognized: boolean;
  commercialUseAllowed: boolean;
  aiProcessingAllowed: boolean;
  transformationAllowed: boolean;
  permissionUrl: string;
};

export type ArticleValidationResults = {
  factualSupportPassed: boolean;
  originalityPassed: boolean;
  duplicateDetectionPassed: boolean;
  sourceOverlapPassed: boolean;
  unsupportedClaims: boolean;
  inventedQuotes: boolean;
  inventedStatistics: boolean;
  completeAttribution: boolean;
  hardWarnings: string[];
};

export type ArticleGenerationMetadata = {
  pipelineVersion: string;
  provider: string;
  model: string;
  modernPipeline: true;
  preparedAutomatically: true;
  candidateIdentity?: {
    version: 1;
    candidateHash: string | null;
    topic: string | null;
    topicKey: string | null;
    topicSignature: string[];
    sourceRegistryIds: string[];
    sourceDomains: string[];
    sourceUrls: string[];
    primarySourceUrls: string[];
    supportingSourceUrls: string[];
    unclassifiedSourceUrls: string[];
    primarySourceRegistryIds: string[];
    supportingSourceRegistryIds: string[];
    category: string | null;
    dateWindow: string | null;
    malformed: boolean;
  };
};

export type RewrittenArticle = {
  title: string;
  content: string;
  summary: string;
  read_time: number;
  quality_review: ArticleQualityReview;
};

export type SourceMaterial = {
  title: string;
  publisher: string;
  url: string;
  text: string;
  reliability: number;
  isPrimary: boolean;
  publishedAt: string | null;
  licenseType: string;
  sourceType: string;
  registryId: string;
  commercialUseAllowed: boolean;
  aiProcessingAllowed: boolean;
  transformationAllowed: boolean;
  permissionUrl: string;
};

export const ARTICLE_SELECT =
  "id,slug,title,content,summary,image_url,source_url,category,created_at,region,article_type,is_breaking,is_editors_pick,read_time,views,publication_status,sources,image_photographer_name,image_photographer_profile_url,image_attribution_url";
