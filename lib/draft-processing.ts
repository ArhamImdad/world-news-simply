import { deterministicOriginalityPrecheck, evaluateArticle, hasCompleteSourceAttribution, preflightSources } from "@/lib/article-quality";
import { buildCanonicalArticleIdentity } from "@/lib/article-identity";
import { type InstrumentedContentProvider, type RevisionGuidance } from "@/lib/content-provider";
import { buildEvidenceBundle, evidenceBundleFailures } from "@/lib/evidence-model";
import { isPublicationCategory, balanceCandidates, PUBLICATION_CATEGORIES, type CategoryCoverage } from "@/lib/category-balance";
import { buildTopicSignature, PIPELINE_VERSION, readyArticleFailures } from "@/lib/publication-policy";
import { getReadyQueueDepth, permittedSourceIds, type PreparedArticleInsert } from "@/lib/publication-queue";
import { loadSupportingItems, collectSourceMaterials, type SupportingItem } from "@/lib/source-material";
import { SYNTHESIS_SOURCES, sourceUrlIsAllowed, type SourceRegistryEntry } from "@/lib/source-registry";
import { sourceItemExpiration, sourceItemIsFresh } from "@/lib/source-freshness";
import { assertWritesAllowed } from "@/lib/environment-isolation";
import { getUnsplashImage } from "@/lib/unsplash";
import { estimateCandidateTokens, maySpendTokens, recordTokenUsage } from "@/lib/token-budget";
import type { ArticleQualityReview, RewrittenArticle } from "@/types/article";
import type { SupabaseClient } from "@supabase/supabase-js";

const BACKLOG_SCAN_LIMIT = 90;
const BACKLOG_PROVIDER_LIMIT = 2;
const BACKLOG_REJECTION_LIMIT = 25;

export type PendingGeneratedDraft = {
  id: string;
  slug: string | null;
  title: string;
  summary: string;
  content: string;
  image_url: string | null;
  source_url: string;
  category: string;
  region: string | null;
  article_type: string | null;
  is_breaking: boolean | null;
  read_time: number | null;
  created_at: string;
};

export type DraftCategoryMetrics = {
  found: number;
  processed: number;
  qualityScoresGenerated: number;
  prepared: number;
  rejected: number;
  failures: number;
};

export type DraftProcessingMetrics = {
  draftsFound: number;
  draftsLoaded: number;
  articlesProcessed: number;
  qualityScoresGenerated: number;
  preparedArticles: number;
  rejectedArticles: number;
  processingFailures: number;
  providerCalls: number;
  providerTokens: number;
  tokenBudgetStopped: boolean;
  rejectionReasons: Record<string, number>;
  qualityScoresByCategory: Record<string, { count: number; minimum: number; maximum: number; average: number }>;
  categoryDistribution: Record<string, DraftCategoryMetrics>;
};

function emptyCategoryMetrics(): DraftCategoryMetrics {
  return { found: 0, processed: 0, qualityScoresGenerated: 0, prepared: 0, rejected: 0, failures: 0 };
}

export function permittedSourceForDraft(sourceUrl: string): SourceRegistryEntry | null {
  return SYNTHESIS_SOURCES.find((source) => sourceUrlIsAllowed(source, sourceUrl)) ?? null;
}

export function orderPendingDrafts(
  drafts: readonly PendingGeneratedDraft[],
  coverage: CategoryCoverage
) {
  const supported = drafts.filter((draft) => isPublicationCategory(draft.category));
  const unsupported = drafts.filter((draft) => !isPublicationCategory(draft.category));
  return [...balanceCandidates(supported, coverage, (draft) => draft.category,
    (draft) => Date.parse(draft.created_at) || 0), ...unsupported];
}

function reviewFailures(review: ArticleQualityReview) {
  const failures = [...review.rejection_reasons];
  if (!review.should_publish) failures.push("quality review rejected");
  if (!review.claims_supported || review.factual_completeness < 90) failures.push("factual completeness below 90");
  if (review.originality < 90 || review.mostly_paraphrase) failures.push("originality below 90");
  if (review.usefulness < 90) failures.push("usefulness below 90");
  if (review.meaningful_context < 90) failures.push("meaningful context below 90");
  if (review.headline_quality < 90) failures.push("headline quality below 90");
  if (review.added_value < 90) failures.push("added value below 90");
  if (review.speculative_or_invented) failures.push("speculative or invented facts");
  if (review.invented_quotes) failures.push("invented quotes");
  if (review.invented_statistics) failures.push("invented statistics");
  return [...new Set(failures)];
}

function guidance(review: ArticleQualityReview): RevisionGuidance {
  const reasons = reviewFailures(review);
  const joined = reasons.join(" ");
  const focus: RevisionGuidance["focus"] = /attribut/i.test(joined) ? "attribution"
    : review.originality < 90 || review.mostly_paraphrase ? "originality"
      : !review.claims_supported || review.factual_completeness < 90 ? "factual-support"
        : review.meaningful_context < 90 || review.added_value < 90 ? "multi-source-synthesis" : "depth";
  return { focus, reasons, review };
}

function blankReview(): ArticleQualityReview {
  return {
    should_publish: false, factual_completeness: 0, originality: 0, usefulness: 0,
    meaningful_context: 0, headline_quality: 0, added_value: 0, claims_supported: false,
    mostly_paraphrase: false, speculative_or_invented: false, invented_quotes: false,
    invented_statistics: false, rejection_reasons: [],
  };
}

function structuredSources(sources: Awaited<ReturnType<typeof collectSourceMaterials>>) {
  return sources.map((source) => ({
    title: source.title, url: source.url, publisher: source.publisher, publishedAt: source.publishedAt,
    licenseType: source.licenseType, sourceType: source.sourceType, isPrimary: source.isPrimary,
    registryId: source.registryId, recognized: true, commercialUseAllowed: source.commercialUseAllowed,
    aiProcessingAllowed: source.aiProcessingAllowed, transformationAllowed: source.transformationAllowed,
    permissionUrl: source.permissionUrl,
  }));
}

function validationResults(review: ArticleQualityReview, completeAttribution: boolean) {
  return {
    factualCompletenessScore: review.factual_completeness,
    originalityScore: review.originality,
    usefulnessScore: review.usefulness,
    meaningfulContextScore: review.meaningful_context,
    headlineQualityScore: review.headline_quality,
    addedValueScore: review.added_value,
    automatedEditorialPassed: review.should_publish,
    mostlyParaphrase: review.mostly_paraphrase,
    speculativeOrInvented: review.speculative_or_invented,
    factualSupportPassed: review.claims_supported && review.factual_completeness >= 90 && !review.speculative_or_invented,
    originalityPassed: review.originality >= 90 && !review.mostly_paraphrase,
    duplicateDetectionPassed: true,
    sourceOverlapPassed: !review.mostly_paraphrase,
    unsupportedClaims: !review.claims_supported,
    inventedQuotes: review.invented_quotes,
    inventedStatistics: review.invented_statistics,
    completeAttribution,
    hardWarnings: [],
  };
}

function reasonKey(reason: string) {
  return reason.replace(/\s+/g, " ").trim().slice(0, 120) || "unspecified";
}

function categoryMetric(metrics: DraftProcessingMetrics, category: string) {
  return metrics.categoryDistribution[category] ??= emptyCategoryMetrics();
}

function recordReason(metrics: DraftProcessingMetrics, reasons: string[]) {
  for (const reason of [...new Set(reasons)]) {
    const key = reasonKey(reason);
    metrics.rejectionReasons[key] = (metrics.rejectionReasons[key] ?? 0) + 1;
  }
}

function recordScore(metrics: DraftProcessingMetrics, category: string, score: number) {
  const current = metrics.qualityScoresByCategory[category];
  const count = (current?.count ?? 0) + 1;
  const total = (current?.average ?? 0) * (current?.count ?? 0) + score;
  metrics.qualityScoresByCategory[category] = {
    count,
    minimum: Math.min(current?.minimum ?? score, score),
    maximum: Math.max(current?.maximum ?? score, score),
    average: Math.round(total / count),
  };
}

async function rejectDraft(database: SupabaseClient, draft: PendingGeneratedDraft, reasons: string[],
  score?: number, review?: ArticleQualityReview, provider?: InstrumentedContentProvider) {
  const update: Record<string, unknown> = {
    publication_status: "rejected", editorial_state: "rejected", rejection_reason: [...new Set(reasons)].join("; ").slice(0, 1000),
    reviewed_at: new Date().toISOString(), approved_at: null,
  };
  if (score !== undefined && review) {
    update.quality_score = score;
    update.validation_results = validationResults(review, false);
    update.generation_metadata = {
      pipelineVersion: PIPELINE_VERSION, provider: provider?.id ?? "automated-backlog-review",
      model: provider?.model ?? "unknown",
      modernPipeline: true, preparedAutomatically: true,
    };
  }
  const { data, error } = await database.from("articles").update(update).eq("id", draft.id)
    .eq("publication_status", "draft").is("editorial_state", null).select("id");
  if (error) throw new Error(`Unable to reject pending draft: ${error.message}`);
  return Array.isArray(data) && data.length === 1;
}

async function prepareDraft(database: SupabaseClient, draft: PendingGeneratedDraft, article: PreparedArticleInsert) {
  const patch: Record<string, unknown> = { ...article };
  delete patch.slug;
  delete patch.views;
  const { data, error } = await database.from("articles").update({
    ...patch, slug: draft.slug || article.slug, rejection_reason: null, reviewed_at: null, reviewed_by: null, approved_at: null,
  }).eq("id", draft.id).eq("publication_status", "draft").is("editorial_state", null).select("id");
  if (error) throw new Error(`Unable to prepare pending draft: ${error.message}`);
  return Array.isArray(data) && data.length === 1;
}

export async function processPendingGeneratedDrafts(options: {
  provider: InstrumentedContentProvider;
  coverage: CategoryCoverage;
  queueMaximum: number;
  fillTarget: number;
  assertOwned: () => Promise<void>;
  database?: SupabaseClient;
}): Promise<DraftProcessingMetrics> {
  assertWritesAllowed("pending generated draft processing");
  const database = options.database ?? (await import("@/lib/supabase")).createServerSupabaseClient();
  const metrics: DraftProcessingMetrics = {
    draftsFound: 0, draftsLoaded: 0, articlesProcessed: 0, qualityScoresGenerated: 0,
    preparedArticles: 0, rejectedArticles: 0, processingFailures: 0,
    providerCalls: 0, providerTokens: 0, tokenBudgetStopped: false,
    rejectionReasons: {}, qualityScoresByCategory: {}, categoryDistribution: {},
  };
  const [countResult, ...categoryResults] = await Promise.all([
    database.from("articles").select("id", { count: "exact", head: true })
      .eq("publication_status", "draft").is("editorial_state", null),
    ...PUBLICATION_CATEGORIES.map((category) => database.from("articles")
      .select("id,slug,title,summary,content,image_url,source_url,category,region,article_type,is_breaking,read_time,created_at", { count: "exact" })
      .eq("publication_status", "draft").is("editorial_state", null).eq("category", category)
      .order("created_at", { ascending: false }).limit(Math.ceil(BACKLOG_SCAN_LIMIT / PUBLICATION_CATEGORIES.length))),
  ]);
  const failedCategoryQuery = categoryResults.find((result) => result.error);
  if (countResult.error || failedCategoryQuery?.error) {
    throw new Error(`Unable to load pending generated drafts: ${countResult.error?.message ?? failedCategoryQuery?.error?.message}`);
  }
  metrics.draftsFound = countResult.count ?? 0;
  const drafts = categoryResults.flatMap((result) => result.data ?? []) as PendingGeneratedDraft[];
  metrics.draftsLoaded = drafts.length;
  for (const [index, category] of PUBLICATION_CATEGORIES.entries()) {
    categoryMetric(metrics, category).found = categoryResults[index].count ?? 0;
  }

  let providerCandidates = 0;
  let deterministicRejections = 0;
  const knownResult = await database.from("articles")
    .select("title,summary").or("publication_status.eq.approved,editorial_state.eq.ready")
    .order("created_at", { ascending: false }).limit(500);
  if (knownResult.error) throw new Error(`Unable to load backlog duplicate index: ${knownResult.error.message}`);
  const known = (knownResult.data ?? []) as Array<{ title: string; summary?: string | null }>;

  for (const draft of orderPendingDrafts(drafts, options.coverage)) {
    await options.assertOwned();
    const category = categoryMetric(metrics, draft.category);
    const source = permittedSourceForDraft(draft.source_url);
    const classifiedCategory = isPublicationCategory(draft.category) ? draft.category : null;
    const rejectDeterministically = async (reasons: string[]) => {
      if (deterministicRejections >= BACKLOG_REJECTION_LIMIT) return false;
      if (await rejectDraft(database, draft, reasons)) {
        deterministicRejections += 1;
        metrics.articlesProcessed += 1;
        metrics.rejectedArticles += 1;
        category.processed += 1;
        category.rejected += 1;
        recordReason(metrics, reasons);
      }
      return true;
    };

    try {
      if (!classifiedCategory) {
        if (!await rejectDeterministically(["unsupported publication category"])) break;
        continue;
      }
      if (!source) {
        if (!await rejectDeterministically(["source is not permitted by the current registry"])) break;
        continue;
      }
      const item: SupportingItem = {
        title: draft.title, content: draft.content, url: draft.source_url, publishedAt: draft.created_at,
        source: { ...source, categoryHint: classifiedCategory },
      };
      if (!sourceItemIsFresh(item)) {
        if (!await rejectDeterministically(["source item expired before automated preparation"])) break;
        continue;
      }
      if (providerCandidates >= BACKLOG_PROVIDER_LIMIT || await getReadyQueueDepth(database) >= options.fillTarget) break;
      const sources = await collectSourceMaterials(item, await loadSupportingItems(source));
      const preflight = preflightSources(sources);
      if (!preflight.accepted) {
        if (!await rejectDeterministically(preflight.reasons)) break;
        continue;
      }
      const evidence = buildEvidenceBundle(draft.title, sources, draft.source_url);
      const evidenceFailures = evidenceBundleFailures(evidence);
      if (evidenceFailures.length > 0) {
        if (!await rejectDeterministically(evidenceFailures)) break;
        continue;
      }
      const estimatedTokens = estimateCandidateTokens(JSON.stringify(evidence).length);
      if (!maySpendTokens(metrics.providerTokens, estimatedTokens)) {
        metrics.tokenBudgetStopped = true;
        break;
      }

      providerCandidates += 1;
      metrics.articlesProcessed += 1;
      category.processed += 1;
      options.provider.beginCandidate?.(evidence.candidateHash, `backlog:${draft.id}`);
      let article: RewrittenArticle = {
        title: draft.title, summary: draft.summary, content: draft.content,
        read_time: draft.read_time && draft.read_time > 0 ? draft.read_time : Math.max(1, Math.ceil(draft.content.split(/\s+/).length / 220)),
        quality_review: blankReview(),
      };
      let originality = deterministicOriginalityPrecheck(article, sources);
      let revised = false;
      if (!originality.accepted && options.provider.revise) {
        article = await options.provider.revise(article, {
          focus: "originality", reasons: originality.reasons, deterministicOriginality: originality,
        }, evidence);
        originality = deterministicOriginalityPrecheck(article, sources);
        revised = true;
      }
      if (!originality.accepted) {
        await rejectDraft(database, draft, originality.reasons);
        metrics.rejectedArticles += 1;
        category.rejected += 1;
        recordReason(metrics, originality.reasons);
        options.provider.finishCandidate?.("rejected:deterministic-originality", revised);
        continue;
      }
      let review = await options.provider.validate(article, evidence);
      let failures = reviewFailures(review);
      if (failures.length > 0 && !revised && options.provider.revise) {
        article = await options.provider.revise(article, guidance(review), evidence);
        revised = true;
        originality = deterministicOriginalityPrecheck(article, sources);
        if (originality.accepted) {
          review = await options.provider.validate(article, evidence);
          failures = reviewFailures(review);
        } else {
          failures = originality.reasons;
        }
      }
      const audited = { ...article, quality_review: review };
      const quality = evaluateArticle(audited, sources, known);
      metrics.qualityScoresGenerated += 1;
      category.qualityScoresGenerated += 1;
      recordScore(metrics, classifiedCategory, quality.score);
      if (failures.length > 0 || !quality.accepted) {
        const reasons = [...new Set([...failures, ...quality.reasons])];
        await rejectDraft(database, draft, reasons, quality.score, review, options.provider);
        metrics.rejectedArticles += 1;
        category.rejected += 1;
        recordReason(metrics, reasons);
        options.provider.finishCandidate?.("rejected:quality", revised);
        continue;
      }

      const now = new Date();
      const image = await getUnsplashImage(classifiedCategory);
      const sourceRows = structuredSources(sources);
      const completeAttribution = hasCompleteSourceAttribution(audited.content, sources);
      const identity = buildCanonicalArticleIdentity({
        candidateHash: evidence.candidateHash, topic: audited.title,
        sourceRegistryIds: sources.map((entry) => entry.registryId), sourceUrls: sources.map((entry) => entry.url),
        sources, category: classifiedCategory, eventDate: draft.created_at,
      });
      const prepared: PreparedArticleInsert = {
        title: audited.title, slug: draft.slug || `article-${draft.id}`, content: audited.content, summary: audited.summary,
        image_url: image.url, image_photographer_name: image.photographerName,
        image_photographer_profile_url: image.photographerProfileUrl, image_attribution_url: image.attributionUrl,
        image_download_location: image.downloadLocation, source_url: sources[0].url, sources: sourceRows,
        publication_status: "draft", editorial_state: "ready", quality_score: quality.score,
        category: classifiedCategory, region: draft.region || source.regionHint || "Global",
        article_type: draft.article_type || source.articleTypeHint || "news",
        is_breaking: Boolean(draft.is_breaking || source.freshnessClass === "BREAKING"), is_editors_pick: false,
        read_time: audited.read_time, views: 0, prepared_at: now.toISOString(), publish_after: now.toISOString(),
        expires_at: sourceItemExpiration(item, now).toISOString(), freshness_class: source.freshnessClass,
        content_pool: source.contentPool, publication_priority: Math.min(100, Math.round(source.reliability * 0.7 + quality.score * 0.3)),
        topic_signature: buildTopicSignature(audited.title), validation_results: validationResults(review, completeAttribution),
        generation_metadata: {
          pipelineVersion: PIPELINE_VERSION, provider: options.provider.id, model: options.provider.model,
          modernPipeline: true, preparedAutomatically: true, candidateIdentity: identity,
        },
        preparation_key: `backlog:${draft.id}`,
      };
      const eligibilityFailures = readyArticleFailures(prepared, new Set(permittedSourceIds()), now);
      if (eligibilityFailures.length > 0) {
        await rejectDraft(database, draft, eligibilityFailures, quality.score, review, options.provider);
        metrics.rejectedArticles += 1;
        category.rejected += 1;
        recordReason(metrics, eligibilityFailures);
        options.provider.finishCandidate?.("rejected:eligibility", revised);
        continue;
      }
      if (await getReadyQueueDepth(database) >= options.queueMaximum) break;
      await options.assertOwned();
      if (await prepareDraft(database, draft, prepared)) {
        metrics.preparedArticles += 1;
        category.prepared += 1;
        known.push({ title: prepared.title, summary: prepared.summary });
        options.provider.finishCandidate?.("ready", revised);
      }
    } catch (error) {
      metrics.processingFailures += 1;
      category.failures += 1;
      options.provider.finishCandidate?.("retry:processing-failure", false);
      console.error(JSON.stringify({ event: "pending_draft_processing_failed", articleId: draft.id,
        category: draft.category, error: error instanceof Error ? error.message : "unknown" }));
    } finally {
      const events = options.provider.drainUsage?.() ?? [];
      recordTokenUsage(events);
      metrics.providerCalls += events.length;
      metrics.providerTokens += events.reduce((total, event) => total +
        (event.usage.status === "known" ? event.usage.totalTokens : event.reservedTokens), 0);
    }
  }
  return metrics;
}
