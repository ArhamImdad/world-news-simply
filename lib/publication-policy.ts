import type {
  ArticleGenerationMetadata,
  ArticleSource,
  ArticleValidationResults,
  ContentPool,
  FreshnessClass,
} from "@/types/article";
import { isPublicationCategory } from "@/lib/category-balance";

export const AUTOMATIC_PUBLICATION_QUALITY_THRESHOLD = 90;
export const AUTOMATIC_EDITORIAL_DIMENSION_THRESHOLD = 90;
export const PIPELINE_VERSION = "autonomous-queue-v1";

export type ReadyArticle = {
  title: string;
  summary: string;
  content: string;
  category: string;
  image_url: string;
  quality_score: number;
  publication_status: "draft";
  editorial_state: "ready";
  sources: ArticleSource[];
  prepared_at: string;
  publish_after: string;
  expires_at: string;
  freshness_class: FreshnessClass;
  content_pool: ContentPool;
  publication_priority: number;
  topic_signature: string[];
  validation_results: ArticleValidationResults;
  generation_metadata: ArticleGenerationMetadata;
  image_photographer_name?: string | null;
  image_photographer_profile_url?: string | null;
  image_attribution_url?: string | null;
};

const ignoredWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "in", "is", "it",
  "of", "on", "or", "that", "the", "this", "to", "was", "were", "will", "with", "says", "after",
]);

function validWebUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function sourceDomain(source: ArticleSource) {
  try {
    return new URL(source.url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function buildTopicSignature(title: string) {
  return [...new Set(title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((token) => token.length > 2 && !ignoredWords.has(token)))].sort().slice(0, 16);
}

export function topicSignatureSimilarity(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) return 0;
  return [...leftSet].filter((token) => rightSet.has(token)).length / union.size;
}

export function materiallySimilar(left: string[], right: string[]) {
  const overlap = new Set(left.filter((token) => right.includes(token))).size;
  return overlap >= 3 && topicSignatureSimilarity(left, right) >= 0.58;
}

export function automatedEditorialEvidenceFailures(input: {
  qualityScore: number | null | undefined;
  validation: ArticleValidationResults | null | undefined;
  generationMetadata: ArticleGenerationMetadata | null | undefined;
}) {
  const failures: string[] = [];
  const validation = input.validation;
  const dimensionScores = [
    validation?.factualCompletenessScore,
    validation?.originalityScore,
    validation?.usefulnessScore,
    validation?.meaningfulContextScore,
    validation?.headlineQualityScore,
    validation?.addedValueScore,
  ];
  if (!Number.isFinite(input.qualityScore) || Number(input.qualityScore) < AUTOMATIC_PUBLICATION_QUALITY_THRESHOLD) failures.push("quality score below 90");
  if (!validation?.automatedEditorialPassed) failures.push("automated editorial review failed");
  if (dimensionScores.some((score) => !Number.isFinite(score) || Number(score) < AUTOMATIC_EDITORIAL_DIMENSION_THRESHOLD)) failures.push("editorial dimension below 90");
  if (!validation?.factualSupportPassed || validation.unsupportedClaims) failures.push("factual support failed");
  if (!validation?.originalityPassed) failures.push("originality failed");
  if (!validation?.duplicateDetectionPassed) failures.push("duplicate detection failed");
  if (!validation?.sourceOverlapPassed) failures.push("source overlap failed");
  if (validation?.inventedQuotes) failures.push("invented quotes");
  if (validation?.inventedStatistics) failures.push("invented statistics");
  if (validation?.mostlyParaphrase) failures.push("mostly paraphrase");
  if (validation?.speculativeOrInvented) failures.push("speculative or invented content");
  if (!validation?.completeAttribution) failures.push("incomplete attribution");
  if (!validation || !Array.isArray(validation.hardWarnings) || validation.hardWarnings.length > 0) failures.push("hard warnings");
  const metadata = input.generationMetadata;
  if (!metadata?.modernPipeline || !metadata.preparedAutomatically || metadata.pipelineVersion !== PIPELINE_VERSION) failures.push("legacy generation metadata");
  return failures;
}

export function autoPublishEligibilityFailures(
  article: ReadyArticle,
  permittedSourceIds: ReadonlySet<string>,
  now = new Date()
) {
  const failures: string[] = [];
  const sources = Array.isArray(article.sources) ? article.sources : [];
  const domains = new Set(sources.map(sourceDomain).filter(Boolean));
  const validation = article.validation_results;

  if (article.publication_status !== "draft" || article.editorial_state !== "ready") failures.push("not ready");
  failures.push(...automatedEditorialEvidenceFailures({ qualityScore: article.quality_score,
    validation, generationMetadata: article.generation_metadata }));
  if (!article.prepared_at || Number.isNaN(Date.parse(article.prepared_at))) failures.push("missing prepared timestamp");
  if (!article.expires_at || Number.isNaN(Date.parse(article.expires_at)) || Date.parse(article.expires_at) <= now.getTime()) failures.push("expired");
  if (!article.publish_after || Number.isNaN(Date.parse(article.publish_after)) || Date.parse(article.publish_after) > now.getTime()) failures.push("not publishable yet");
  if (sources.length < 2 || domains.size < 2) failures.push("fewer than two independent source domains");
  if (!sources.some((source) => source.isPrimary)) failures.push("missing structured primary source");
  if (sources.some((source) => !source.registryId || !source.recognized || !permittedSourceIds.has(source.registryId))) failures.push("unrecognized source");
  if (sources.some((source) => !validWebUrl(source.url) || !source.title || !source.publisher || !source.licenseType || !source.permissionUrl)) failures.push("malformed sources");
  if (sources.some((source) => !source.commercialUseAllowed || !source.aiProcessingAllowed || !source.transformationAllowed)) failures.push("source permission denied");
  if (!article.title.trim() || !article.summary.trim() || !article.content.trim() || !article.category.trim()) failures.push("incomplete article");
  if (!isPublicationCategory(article.category)) failures.push("unsupported category");
  if (!["breaking", "government-records", "economic-data", "evergreen"].includes(article.content_pool)) failures.push("invalid content pool");
  if (!article.image_url || (!article.image_url.startsWith("/") && !validWebUrl(article.image_url))) failures.push("invalid image");
  if (!article.image_url.startsWith("/") && (!article.image_photographer_name || !article.image_attribution_url)) failures.push("missing image attribution");
  if (!Array.isArray(article.topic_signature) || article.topic_signature.length < 3) failures.push("missing topic signature");
  return [...new Set(failures)];
}

export function isAutoPublishEligible(
  article: ReadyArticle,
  permittedSourceIds: ReadonlySet<string>,
  now = new Date()
) {
  return autoPublishEligibilityFailures(article, permittedSourceIds, now).length === 0;
}

// Compatibility alias for staging diagnostics and existing integrations.
export const readyArticleFailures = autoPublishEligibilityFailures;

export function fallbackClassRank(freshnessClass: FreshnessClass) {
  if (freshnessClass === "BREAKING" || freshnessClass === "CURRENT") return 4;
  if (freshnessClass === "ANALYSIS") return 3;
  return 2;
}

export function rankingScore(article: ReadyArticle, recentCategories: string[], now = new Date()) {
  const ageHours = Math.max(0, (now.getTime() - Date.parse(article.prepared_at)) / 3_600_000);
  const categoryCount = recentCategories.filter((category) => category === article.category).length;
  const consecutive = recentCategories.findIndex((category) => category !== article.category);
  const streak = consecutive === -1 ? recentCategories.length : consecutive;
  const freshness = article.freshness_class === "BREAKING" ? 50
    : article.freshness_class === "CURRENT" ? 40
      : article.freshness_class === "ANALYSIS" && article.content_pool !== "economic-data" ? 30
        : article.content_pool === "economic-data" ? 20 : 10;
  return article.publication_priority + article.quality_score * 2 + freshness - Math.min(ageHours, 72) * 0.3
    - categoryCount * 4 - (streak >= 3 ? 25 : 0) - (streak >= 9 ? 1_000 : 0);
}

export function selectBestReadyArticle(
  articles: ReadyArticle[],
  permittedSourceIds: ReadonlySet<string>,
  recentCategories: string[],
  now = new Date(),
  recentlyPublishedSignatures: string[][] = []
) {
  return articles.filter((article) => isAutoPublishEligible(article, permittedSourceIds, now) &&
      !recentlyPublishedSignatures.some((signature) => materiallySimilar(article.topic_signature, signature)))
    .sort((left, right) => rankingScore(right, recentCategories, now) - rankingScore(left, recentCategories, now))[0] ?? null;
}
