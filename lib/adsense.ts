import type { Article } from "@/types/article";

export type AdsenseReviewStatus = "pending" | "approved" | "rejected";

export type AdsenseRuntimeConfig = {
  enabled: boolean;
  consentReady: boolean;
  clientId: string | null;
  articleSlot: string | null;
};

const adsenseClientPattern = /^ca-pub-\d{16}$/;
const adsenseSlotPattern = /^\d{10}$/;
const articleRoutePattern = /^\/article\/[^/]+\/?$/;

export function isValidAdsenseClientId(value: string | null | undefined) {
  return adsenseClientPattern.test(value?.trim() ?? "");
}

export function isValidAdsenseSlotId(value: string | null | undefined) {
  return adsenseSlotPattern.test(value?.trim() ?? "");
}

export function readAdsenseRuntimeConfig(
  environment: Record<string, string | undefined> = process.env
): AdsenseRuntimeConfig {
  if (environment.APP_ENV?.trim() === "local") {
    return { enabled: false, consentReady: false, clientId: null, articleSlot: null };
  }
  const rawClientId = environment.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT?.trim();
  const rawArticleSlot = environment.NEXT_PUBLIC_GOOGLE_ADSENSE_ARTICLE_SLOT?.trim();

  return {
    enabled: environment.NEXT_PUBLIC_ADSENSE_ENABLED === "true",
    consentReady: environment.NEXT_PUBLIC_ADSENSE_CONSENT_READY === "true",
    clientId: isValidAdsenseClientId(rawClientId) ? rawClientId! : null,
    articleSlot: isValidAdsenseSlotId(rawArticleSlot) ? rawArticleSlot! : null,
  };
}

export function isAdsenseRouteEligible(pathname: string) {
  return articleRoutePattern.test(pathname);
}

function validDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function wordCount(value: string | null | undefined) {
  return (value ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function hasSubstantivePublisherContent(article: Article) {
  const paragraphs = article.content.split(/\n+/).map((value) => value.trim()).filter(Boolean);
  return article.title.trim().length >= 20 && wordCount(article.summary) >= 15 &&
    wordCount(article.content) >= 250 && paragraphs.length >= 3;
}

function hasIndependentPermittedSources(article: Article) {
  if (!Array.isArray(article.sources) || article.sources.length < 2) return false;
  const domains = new Set<string>();
  let primarySources = 0;

  for (const source of article.sources) {
    try {
      const sourceUrl = new URL(source.url);
      const permissionUrl = new URL(source.permissionUrl);
      if (!["http:", "https:"].includes(sourceUrl.protocol) ||
          !["http:", "https:"].includes(permissionUrl.protocol)) return false;
      domains.add(sourceUrl.hostname.replace(/^www\./i, "").toLowerCase());
    } catch {
      return false;
    }

    if (!source.title?.trim() || !source.publisher?.trim() || !source.registryId?.trim() ||
        !source.licenseType?.trim() || source.licenseType === "unknown" || !source.recognized ||
        !source.commercialUseAllowed || !source.aiProcessingAllowed || !source.transformationAllowed) {
      return false;
    }
    if (source.isPrimary) primarySources += 1;
  }

  return domains.size >= 2 && primarySources >= 1;
}

function passedPublicationQuality(article: Article) {
  const validation = article.validation_results;
  const generation = article.generation_metadata;
  return (article.quality_score ?? 0) >= 90 && Boolean(validation) &&
    validation!.factualSupportPassed && validation!.originalityPassed &&
    validation!.duplicateDetectionPassed && validation!.sourceOverlapPassed &&
    validation!.completeAttribution && !validation!.unsupportedClaims &&
    !validation!.inventedQuotes && !validation!.inventedStatistics &&
    Array.isArray(validation!.hardWarnings) && validation!.hardWarnings.length === 0 &&
    Boolean(generation?.modernPipeline) && Boolean(generation?.preparedAutomatically) &&
    generation?.pipelineVersion === "autonomous-queue-v1";
}

/**
 * Canonical human-curation and content-quality boundary for article inventory.
 * This is intentionally stricter than public visibility and fails closed when
 * internal quality or review metadata is absent.
 */
export function isAdsenseEligible(article: Article, now = new Date()) {
  const expiresAt = validDate(article.expires_at);
  const approvedAt = validDate(article.approved_at);
  const reviewedAt = validDate(article.adsense_reviewed_at);

  return article.publication_status === "approved" && article.editorial_state === "published" &&
    article.adsense_review_status === "approved" && Boolean(approvedAt) && Boolean(reviewedAt) &&
    Boolean(article.adsense_reviewed_by?.trim()) && Boolean(expiresAt && expiresAt > now) &&
    hasSubstantivePublisherContent(article) && hasIndependentPermittedSources(article) &&
    passedPublicationQuality(article);
}

export function canRenderAdsense(input: {
  article: Article;
  pathname: string;
  config?: AdsenseRuntimeConfig;
  now?: Date;
}) {
  const config = input.config ?? readAdsenseRuntimeConfig();
  return config.enabled && config.consentReady && Boolean(config.clientId) &&
    Boolean(config.articleSlot) && isAdsenseRouteEligible(input.pathname) &&
    isAdsenseEligible(input.article, input.now);
}

export function adsTxtRecord(clientId: string | null | undefined) {
  if (!isValidAdsenseClientId(clientId)) return null;
  return `google.com, ${clientId!.replace(/^ca-/, "")}, DIRECT, f08c47fec0942fa0`;
}
