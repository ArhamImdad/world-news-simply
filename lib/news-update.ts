import { deterministicOriginalityPrecheck, evaluateArticle, hasCompleteSourceAttribution, headlinesAreSimilar, preflightSources } from "@/lib/article-quality";
import {
  anyDuplicateIdentity,
  buildCanonicalArticleIdentity,
  canonicalIdentityFromStored,
  type CanonicalArticleIdentity,
} from "@/lib/article-identity";
import { GroqContentProvider, type InstrumentedContentProvider, type RevisionGuidance } from "@/lib/content-provider";
import { buildEvidenceBundle, candidateHash, compactEvidencePayload, evidenceBundleFailures, preGroqQualificationScore, type EvidenceBundle } from "@/lib/evidence-model";
import { EVERGREEN_TOPICS, type EvergreenCandidate } from "@/lib/evergreen-topics";
import { candidateReserveOrder, getPublicationConfig, groqCandidateLimit, replenishmentFillTarget, replenishmentLimit, type ReserveMode } from "@/lib/publication-config";
import { buildTopicSignature, PIPELINE_VERSION, readyArticleFailures } from "@/lib/publication-policy";
import { executeSeparatedCycle } from "@/lib/publication-orchestrator";
import {
  articleReplenishmentRunId,
  enqueueReadyArticle,
  getReadyQueueDepth,
  getCategoryCoverage,
  permittedSourceIds,
  publicationSlotAt,
  publishNextReadyArticle,
  type PreparedArticleInsert,
} from "@/lib/publication-queue";
import {
  createReserveFillControl,
  recordSkippedProviderWork,
  recordSuccessfulEnqueue,
  shouldStartProviderWork,
} from "@/lib/reserve-fill-control";
import {
  ReplenishmentLeaseLostError,
  ReplenishmentRunIntegrityError,
  ReplenishmentRunLease,
  SupabaseReplenishmentLeaseStore,
  validateReplenishmentRunIntegrity,
} from "@/lib/replenishment-lease";
import { parseFeed } from "@/lib/rss";
import { collectExplicitSourceMaterials, collectSourceMaterials, type SupportingItem } from "@/lib/source-material";
import { SYNTHESIS_SOURCES, sourceUrlIsAllowed } from "@/lib/source-registry";
import { sourceItemExpiration, sourceItemIsFresh } from "@/lib/source-freshness";
import { classifyReleaseSupply, releaseIdentityKey } from "@/lib/release-series";
import { createServerSupabaseClient } from "@/lib/supabase";
import { assertWritesAllowed } from "@/lib/environment-isolation";
import { currentTokenBudgetUsage, estimateCandidateTokens, maySpendTokens, observeProviderQuotaError, recordTokenUsage } from "@/lib/token-budget";
import { getUnsplashImage } from "@/lib/unsplash";
import { GeneratedArticleContractError } from "@/lib/generated-article-contract";
import {
  candidateTelemetryIdFor,
  classifyResolutionAndPairing,
  type CandidateFunnelEvent,
  type ReplenishmentTelemetryRecorder,
} from "@/lib/replenishment-telemetry";
import { selectNormalPreparedCandidates } from "@/lib/candidate-preparation";
import { balanceCandidates, classifyArticleCategory, MINIMUM_PUBLISHED_PER_CATEGORY, PUBLICATION_CATEGORIES } from "@/lib/category-balance";

type RecentArticle = {
  title: string;
  summary?: string | null;
  source_url?: string | null;
  sources?: Array<{ url?: string; registryId?: string; isPrimary?: boolean }> | null;
  topic_signature?: string[] | null;
  category?: string | null;
  prepared_at?: string | null;
  generation_metadata?: { candidateIdentity?: unknown } | null;
};
type CandidateItem = SupportingItem | EvergreenCandidate;

export type ReplenishmentMetrics = {
  runId: string;
  queueDepthBefore: number;
  queueDepthAfter: number;
  reserveMode: ReserveMode;
  candidatesProcessed: number;
  candidatesRejected: number;
  articlesPrepared: number;
  rejectionReasons: Record<string, number>;
  sourceFailures: number;
  providerFailures: number;
  revisionAttempts: number;
  duplicateRejections: number;
  productiveSourcePairs: Record<string, number>;
  preparedCategories: Record<string, number>;
  rejectedCategories: Record<string, number>;
  candidatesSentToGroq: number;
  candidatesDeferred: number;
  groqCalls: number;
  groqInputTokens: number;
  groqOutputTokens: number;
  groqTotalTokens: number;
  tokensPerReadyArticle: number | null;
  tokensPerRejectedArticle: number | null;
  rejectionStageDistribution: Record<string, number>;
  tokenBudgetStopped: boolean;
  attributedArticleIds: string[];
  sampleIntegrityPassed: boolean;
  auditResults: Array<{
    candidateHash: string;
    phase: "initial" | "post-revision";
    factualCompleteness: number;
    originality: number;
    addedValue: number;
    accepted: boolean;
  }>;
};

function operationalLog(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  const payload = JSON.stringify({ event, ...fields });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.info(payload);
}

function normalizeText(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeSourceUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"]
      .forEach((parameter) => url.searchParams.delete(parameter));
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return "";
  }
}

function sourceDomain(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

async function recordQueueObservation(telemetry: ReplenishmentTelemetryRecorder | undefined,
  phase: "starting" | "ending", readyDepth: number) {
  if (!telemetry) return;
  const database = createServerSupabaseClient();
  const [total, approved, slots] = await Promise.all([
    database.from("articles").select("id", { count: "exact", head: true }),
    database.from("articles").select("id", { count: "exact", head: true }).eq("publication_status", "approved"),
    database.from("articles").select("id", { count: "exact", head: true }).not("publication_slot", "is", null),
  ]);
  if (total.error || approved.error || slots.error) throw new Error("Unable to persist queue telemetry observation.");
  telemetry.recordQueue({ phase, observedAt: new Date().toISOString(), readyDepth,
    totalRows: total.count ?? 0, approvedCount: approved.count ?? 0, publicationSlotCount: slots.count ?? 0 });
}

function generateSlug(title: string) {
  const base = title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "article";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

function publishedAt(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function discoverCandidates(mode: ReserveMode) {
  const sources = [...SYNTHESIS_SOURCES].sort((left, right) =>
    candidateReserveOrder(mode, left.contentPool) - candidateReserveOrder(mode, right.contentPool));
  const results = await Promise.allSettled(sources.map(async (source) => {
    const feed = await parseFeed(source);
    const defaultLimit = mode === "critical" ? 12 : mode === "low" ? 8 : 5;
    const limit = mode === "critical" ? source.currentDiscoveryLimit ?? defaultLimit : defaultLimit;
    return feed.items.slice(0, limit).flatMap((item) => {
      const title = normalizeText(item.title ?? "");
      const content = normalizeText(item.contentSnippet || item.content || item.summary || "");
      const url = normalizeSourceUrl(item.link || "");
      return title && content && url && sourceUrlIsAllowed(source, url) ? [{
        title,
        content: content.slice(0, source.maxSourceCharacters),
        url,
        publishedAt: publishedAt(item.isoDate || item.pubDate),
        source: { ...source, categoryHint: classifyArticleCategory(title, source.categoryHint, source.articleTypeHint) },
      } satisfies SupportingItem] : [];
    });
  }));

  const failures = results.filter((result) => result.status === "rejected").length;
  const discovered: CandidateItem[] = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const evergreen = EVERGREEN_TOPICS.map((item) => ({ ...item, source: { ...item.source,
    categoryHint: classifyArticleCategory(item.title, item.source.categoryHint, item.source.articleTypeHint) } }));
  const items: CandidateItem[] = mode === "critical" ? [...evergreen, ...discovered] : [...discovered, ...evergreen];
  items.sort((left, right) =>
    candidateReserveOrder(mode, left.source.contentPool, "corroboration" in left) -
      candidateReserveOrder(mode, right.source.contentPool, "corroboration" in right) ||
    (Date.parse(right.publishedAt ?? "") || 0) - (Date.parse(left.publishedAt ?? "") || 0));
  return { items, failures };
}

function recordRejection(metrics: ReplenishmentMetrics, reasons: string[], category?: string, stage = "unspecified") {
  metrics.candidatesRejected += 1;
  metrics.rejectionStageDistribution[stage] = (metrics.rejectionStageDistribution[stage] ?? 0) + 1;
  if (category) metrics.rejectedCategories[category] = (metrics.rejectedCategories[category] ?? 0) + 1;
  for (const reason of [...new Set(reasons)].slice(0, 5)) {
    const sanitized = reason.replace(/\s+/g, " ").trim().slice(0, 80) || "unspecified";
    metrics.rejectionReasons[sanitized] = (metrics.rejectionReasons[sanitized] ?? 0) + 1;
    if (sanitized.includes("duplicate")) metrics.duplicateRejections += 1;
  }
}

function finishProviderCandidate(
  metrics: ReplenishmentMetrics,
  provider: InstrumentedContentProvider,
  disposition: string,
  revisionRequired: boolean,
  runId: string
) {
  provider.finishCandidate?.(disposition, revisionRequired);
  const events = provider.drainUsage?.() ?? [];
  validateReplenishmentRunIntegrity({ runId, providerEvents: events, attributedRunIds: [], leaseLost: false });
  recordTokenUsage(events);
  const tokens = events.reduce((total, event) => total +
    (event.usage.status === "known" ? event.usage.totalTokens : event.reservedTokens), 0);
  metrics.groqCalls += events.length;
  metrics.groqInputTokens += events.reduce((total, event) => total +
    (event.usage.status === "known" ? event.usage.inputTokens : 0), 0);
  metrics.groqOutputTokens += events.reduce((total, event) => total +
    (event.usage.status === "known" ? event.usage.outputTokens : 0), 0);
  metrics.groqTotalTokens += tokens;
  for (const event of events) operationalLog("info", "groq_usage", event);
  return tokens;
}

function revisionGuidance(review: Awaited<ReturnType<InstrumentedContentProvider["validate"]>>): RevisionGuidance {
  const joined = review.rejection_reasons.join(" ");
  const focus: RevisionGuidance["focus"] = /attribut/i.test(joined) ? "attribution"
    : review.originality < 90 || review.mostly_paraphrase ? "originality"
      : !review.claims_supported || review.factual_completeness < 90 ? "factual-support"
        : review.meaningful_context < 90 || review.added_value < 90 ? "multi-source-synthesis"
          : "depth";
  return { focus, reasons: review.rejection_reasons, review };
}

function auditFailures(review: Awaited<ReturnType<InstrumentedContentProvider["validate"]>>) {
  const failures = [...review.rejection_reasons];
  if (!review.should_publish) failures.push("quality review rejected");
  if (!review.claims_supported || review.factual_completeness < 90) failures.push("factual completeness below 90");
  if (review.originality < 90 || review.mostly_paraphrase) failures.push("originality below 90");
  if (review.speculative_or_invented) failures.push("speculative or invented facts");
  if (review.invented_quotes) failures.push("invented quotes");
  if (review.invented_statistics) failures.push("invented statistics");
  return [...new Set(failures)];
}

function recordAuditResult(metrics: ReplenishmentMetrics, evidence: EvidenceBundle, phase: "initial" | "post-revision",
  review: Awaited<ReturnType<InstrumentedContentProvider["validate"]>>) {
  metrics.auditResults.push({
    candidateHash: evidence.candidateHash,
    phase,
    factualCompleteness: review.factual_completeness,
    originality: review.originality,
    addedValue: review.added_value,
    accepted: auditFailures(review).length === 0,
  });
}

function repairHeadlineWithoutNewFacts<T extends { title: string; content: string }>(article: T, evidence: EvidenceBundle,
  sources: Awaited<ReturnType<typeof collectSourceMaterials>>) {
  const current = deterministicOriginalityPrecheck(article, sources);
  if (current.reasons.length !== 1 || current.reasons[0] !== "headline too similar to source") return { article, originality: current };
  const repaired = { ...article, title: evidence.plan.headlineFallback };
  return { article: repaired, originality: deterministicOriginalityPrecheck(repaired, sources) };
}

function providerFailureReason(error: unknown) {
  if (error instanceof GeneratedArticleContractError) return `generation payload ${error.code}`;
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status) : 0;
  if (status === 429 && error instanceof Error && /tokens per day|\bTPD\b/i.test(error.message)) {
    return "generation or validation daily token quota exhausted";
  }
  if (status === 429) return "generation or validation provider rate limit";
  if (status >= 500) return "generation or validation provider server error";
  if (error instanceof SyntaxError) return "generation or validation returned invalid JSON";
  if (error instanceof Error && /omitted|invalid|incomplete quality review/i.test(error.message)) {
    return "generation or validation returned incomplete structured output";
  }
  return "generation or factual validation provider unavailable";
}

async function recentArticles() {
  const { data, error } = await createServerSupabaseClient().from("articles")
    .select("title,summary,source_url,sources,topic_signature,category,prepared_at,generation_metadata")
    .or("publication_status.eq.approved,editorial_state.eq.ready")
    .order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(`Unable to load duplicate index: ${error.message}`);
  return (data ?? []) as RecentArticle[];
}

function recentArticleIdentity(article: RecentArticle) {
  const sources = Array.isArray(article.sources) ? article.sources : [];
  return canonicalIdentityFromStored(article.generation_metadata?.candidateIdentity, {
    topic: article.title,
    topicSignature: article.topic_signature,
    sourceRegistryIds: sources.map((source) => source.registryId),
    sourceUrls: [article.source_url, ...sources.map((source) => source.url)],
    sources,
    category: article.category,
    eventDate: article.prepared_at,
  });
}

function candidateIdentity(item: CandidateItem, sources: Awaited<ReturnType<typeof collectSourceMaterials>> = [],
  evidence?: EvidenceBundle) {
  const releaseKey = "corroboration" in item ? null : releaseIdentityKey({
    sourceId: item.source.id, title: item.title, periodContext: `${item.title} ${item.content.slice(0, 900)}`,
    publishedAt: item.publishedAt,
  });
  return buildCanonicalArticleIdentity({
    candidateHash: evidence?.candidateHash,
    topicKey: releaseKey ? candidateHash(`recurring-release:${releaseKey}`) : undefined,
    topic: item.title,
    sourceRegistryIds: sources.length ? sources.map((source) => source.registryId) : [item.source.id],
    sourceUrls: sources.length ? sources.map((source) => source.url) : [item.url],
    sources: sources.length ? sources : [{
      url: item.url,
      registryId: item.source.id,
      isPrimary: true,
    }],
    category: item.source.categoryHint,
    eventDate: item.publishedAt,
  });
}

function isKnownCandidate(item: CandidateItem, known: RecentArticle[], identities: CanonicalArticleIdentity[]) {
  const identity = candidateIdentity(item);
  return anyDuplicateIdentity(identity, identities) || known.some((article) =>
    normalizeSourceUrl(article.source_url ?? "") === item.url || headlinesAreSimilar(article.title, item.title));
}

export type DeterministicPreflightReplay = {
  providerRequests: 0;
  reserveMode: ReserveMode;
  sourceDiscoveryFailures: number;
  uniqueDiscoveredIdentities: number;
  uniquePreflightEligibleIdentities: number;
  uniquePreflightRejectedIdentities: number;
  rejectionRate: number;
  rejectionReasons: Record<string, number>;
  independentDomainFailures: number;
  thinSourceFailures: number;
  evidenceEligibleCandidates: number;
  evergreenEvidenceEligibleCandidates: number;
  recurringCurrentEvidenceEligibleCandidates: number;
  occasionalCurrentEvidenceEligibleCandidates: number;
  distinctRecurringSourcePairs: string[];
  distinctRecurringSourceDomains: string[];
  distinctEligibleSourcePairs: string[];
  distinctEligibleSourceDomains: string[];
  eligibleCategories: string[];
  sourcePairValue: Array<{
    sourceId: string;
    discoveries: number;
    matchedIndependentEvents: number;
    freshnessPass: number;
    depthPass: number;
    preflightPass: number;
    evidencePass: number;
    distinctPairFamilies: string[];
  }>;
  candidates: Array<{
    title: string;
    sourceId: string;
    sourcePair: string[];
    sourceDomains: string[];
    category: string;
    disposition: "eligible" | "rejected";
    stage: "duplicate" | "freshness" | "source-preflight" | "evidence" | "qualified" | "unexpected";
    reasons: string[];
    preGroqScore: number | null;
    synthesisScore: number | null;
    canonicalCandidateHash: string | null;
    canonicalTopicKey: string | null;
    duplicateState: "surviving" | "blocked" | "not-assessed";
    supplyClass: "evergreen" | "recurring-current" | "occasional-current";
    releaseSeries: string | null;
    releasePeriod: string | null;
    recurringCadence: string | null;
    comparisonClassification: "comparable-with-definition-methodology-caveat" | null;
  }>;
};

type SupplyMetadata = ReturnType<typeof classifyReleaseSupply>;
type PreparedCandidateAssessment = {
  funnelIdentity: string;
  discoveryRank: number;
  item: CandidateItem;
  sources: Awaited<ReturnType<typeof collectSourceMaterials>>;
  evidence: EvidenceBundle | null;
  expiresAt: Date;
  identity: CanonicalArticleIdentity;
  qualificationScore: number | null;
  disposition: "eligible" | "rejected";
  stage: DeterministicPreflightReplay["candidates"][number]["stage"];
  reasons: string[];
  supply: SupplyMetadata;
};

function deterministicSupplyMetadata(item: CandidateItem,
  sources: Awaited<ReturnType<typeof collectSourceMaterials>>): SupplyMetadata {
  return classifyReleaseSupply(
    { sourceId: item.source.id, title: item.title, periodContext: `${item.title} ${item.content.slice(0, 900)}`,
      publishedAt: item.publishedAt },
    sources.filter((source) => source.registryId !== item.source.id).map((source) => ({
      sourceId: source.registryId, title: source.title, periodContext: `${source.title} ${source.text.slice(0, 900)}`,
      publishedAt: source.publishedAt,
    })),
    "corroboration" in item,
  );
}

async function prepareCandidateUniverse(mode: ReserveMode, retainedKnownIdentities: CanonicalArticleIdentity[] = [],
  beforeCandidate?: () => Promise<void>) {
  const discovery = await discoverCandidates(mode);
  const known = await recentArticles();
  const knownIdentities = [...known.map(recentArticleIdentity), ...retainedKnownIdentities];
  const selectedCandidateIdentities: CanonicalArticleIdentity[] = [];
  const seenUrls = new Set<string>();
  const assessments: PreparedCandidateAssessment[] = [];
  const funnelEvents: CandidateFunnelEvent[] = discovery.items.map((item, index) => ({
    funnelIdentity: `discovery:${candidateHash(`${item.source.id}|${item.url}|${index + 1}`)}`,
    discoveryRank: index + 1,
    discoverySourceId: item.source.id,
    sourceUrl: item.url,
    sourceHints: [item.source.id, ...("corroboration" in item ? item.corroboration.map((entry) => entry.source.id) : [])],
    rawDiscovered: true,
    resolution: "not-assessed",
    pairing: "not-assessed",
    preflight: "not-assessed",
    evidence: "not-assessed",
    duplicate: "not-assessed",
    ranking: "not-assessed",
    finalStage: "discovered",
    reasonCodes: [],
  }));

  const reject = (funnelIdentity: string, discoveryRank: number, item: CandidateItem,
    stage: PreparedCandidateAssessment["stage"], reasons: string[],
    sources: Awaited<ReturnType<typeof collectSourceMaterials>> = [], evidence: EvidenceBundle | null = null,
    qualificationScore: number | null = null, identity = candidateIdentity(item, sources, evidence ?? undefined)) => {
    assessments.push({ funnelIdentity, discoveryRank, item, sources, evidence, expiresAt: sourceItemExpiration(item, new Date()), identity,
      qualificationScore, disposition: "rejected", stage, reasons: [...new Set(reasons)],
      supply: deterministicSupplyMetadata(item, sources) });
  };

  for (const [rawIndex, item] of discovery.items.entries()) {
    await beforeCandidate?.();
    const funnel = funnelEvents[rawIndex];
    if (seenUrls.has(item.url)) {
      funnel.finalStage = "raw-deduplication";
      funnel.reasonCodes = ["duplicate raw source URL"];
      continue;
    }
    seenUrls.add(item.url);
    const discoveryRank = assessments.length + 1;
    try {
      if (isKnownCandidate(item, known, knownIdentities)) {
        funnel.duplicate = "blocked";
        funnel.finalStage = "duplicate";
        funnel.reasonCodes = ["duplicate"];
        reject(funnel.funnelIdentity, discoveryRank, item, "duplicate", ["duplicate"]);
        continue;
      }
      if (!sourceItemIsFresh(item)) {
        funnel.finalStage = "freshness";
        funnel.reasonCodes = ["source item expired"];
        reject(funnel.funnelIdentity, discoveryRank, item, "freshness", ["source item expired"]);
        continue;
      }
      const sources = "corroboration" in item
        ? await collectExplicitSourceMaterials([item, ...item.corroboration])
        : await collectSourceMaterials(item, discovery.items.filter((candidate) => candidate.url !== item.url));
      const sourceStages = classifyResolutionAndPairing(sources.length);
      funnel.resolution = sourceStages.resolution;
      funnel.pairing = sourceStages.pairing;
      const preflight = preflightSources(sources);
      if (!preflight.accepted) {
        funnel.preflight = funnel.pairing === "qualified" ? "rejected" : "not-assessed";
        funnel.finalStage = funnel.resolution === "rejected" ? "resolution" : "source-preflight";
        funnel.reasonCodes = [...new Set([
          ...(funnel.resolution === "rejected" ? ["no source material resolved"] : []),
          ...preflight.reasons,
        ])];
        reject(funnel.funnelIdentity, discoveryRank, item, "source-preflight", preflight.reasons, sources);
        continue;
      }
      const evidence = buildEvidenceBundle(item.title, sources, item.url);
      funnel.preflight = "qualified";
      const identity = candidateIdentity(item, sources, evidence);
      const reasons = evidenceBundleFailures(evidence);
      funnel.evidence = reasons.length > 0 ? "rejected" : "qualified";
      if (anyDuplicateIdentity(identity, knownIdentities) || anyDuplicateIdentity(identity, selectedCandidateIdentities)) {
        funnel.duplicate = "blocked";
        funnel.finalStage = "duplicate";
        funnel.reasonCodes = ["duplicate canonical candidate identity"];
        reject(funnel.funnelIdentity, discoveryRank, item, "duplicate", ["duplicate canonical candidate identity"], sources, evidence, null, identity);
        continue;
      }
      const qualificationScore = preGroqQualificationScore(evidence, preflight.score, "corroboration" in item);
      if (qualificationScore < 75) reasons.push("pre-Groq qualification score below 75");
      if (reasons.length > 0) {
        funnel.evidence = "rejected";
        funnel.finalStage = "evidence";
        funnel.reasonCodes = [...new Set(reasons)];
        reject(funnel.funnelIdentity, discoveryRank, item, "evidence", reasons, sources, evidence, qualificationScore, identity);
        continue;
      }
      selectedCandidateIdentities.push(identity);
      funnel.duplicate = "surviving";
      funnel.finalStage = "qualified";
      assessments.push({ funnelIdentity: funnel.funnelIdentity, discoveryRank, item, sources, evidence, expiresAt: sourceItemExpiration(item, new Date()), identity,
        qualificationScore, disposition: "eligible", stage: "qualified", reasons: [],
        supply: deterministicSupplyMetadata(item, sources) });
    } catch (error) {
      funnel.finalStage = "unexpected";
      funnel.reasonCodes = [error instanceof Error ? error.message : "candidate processing failed"];
      reject(funnel.funnelIdentity, discoveryRank, item, "unexpected", funnel.reasonCodes);
    }
  }
  return { discovery, known, knownIdentities, assessments, funnelEvents };
}

/**
 * Replays the same discovery, freshness, source-material, source-preflight,
 * evidence, and canonical-duplicate gates used before the provider loop.
 * It performs no generation, audit, image, enqueue, or publication work.
 */
export async function runDeterministicSourcePreflightReplay(
  mode: ReserveMode = "critical"
): Promise<DeterministicPreflightReplay> {
  const { discovery, assessments } = await prepareCandidateUniverse(mode);
  const candidates: DeterministicPreflightReplay["candidates"] = assessments.map((assessment) => ({
    title: assessment.item.title, sourceId: assessment.item.source.id,
    sourcePair: assessment.sources.map((source) => source.registryId).sort(),
    sourceDomains: assessment.sources.map((source) => sourceDomain(source.url)).filter(Boolean).sort(),
    category: assessment.item.source.categoryHint, disposition: assessment.disposition, stage: assessment.stage,
    reasons: assessment.reasons, preGroqScore: assessment.qualificationScore,
    synthesisScore: assessment.evidence?.richnessScore ?? null,
    canonicalCandidateHash: assessment.identity.candidateHash ?? null,
    canonicalTopicKey: assessment.identity.topicKey ?? null,
    duplicateState: assessment.stage === "duplicate" ? "blocked"
      : assessment.disposition === "eligible" ? "surviving" : "not-assessed",
    ...assessment.supply,
  }));
  const rejectionReasons: Record<string, number> = {};
  const eligiblePairs = new Set<string>();
  const eligibleDomains = new Set<string>();
  const eligibleCategories = new Set<string>();
  for (const candidate of candidates) {
    for (const reason of candidate.reasons) rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
    if (candidate.disposition !== "eligible") continue;
    eligiblePairs.add(candidate.sourcePair.join(" + "));
    candidate.sourceDomains.forEach((domain) => eligibleDomains.add(domain));
    eligibleCategories.add(candidate.category);
  }
  const preflightEligible = candidates.filter((candidate) => ["evidence", "qualified"].includes(candidate.stage) ||
    candidate.stage === "duplicate" && candidate.sourcePair.length >= 2).length;

  const eligible = candidates.filter((candidate) => candidate.disposition === "eligible").length;
  const evergreenEligible = candidates.filter((candidate) => candidate.disposition === "eligible" && candidate.supplyClass === "evergreen");
  const recurringEligible = candidates.filter((candidate) => candidate.disposition === "eligible" && candidate.supplyClass === "recurring-current");
  const occasionalEligible = candidates.filter((candidate) => candidate.disposition === "eligible" && candidate.supplyClass === "occasional-current");
  const registryDomains = new Map(SYNTHESIS_SOURCES.map((source) => [source.id, source.domain]));
  const preflightRejected = candidates.filter((candidate) => candidate.stage === "source-preflight").length;
  const preflightAssessed = preflightEligible + preflightRejected;
  const sourcePairValue = SYNTHESIS_SOURCES.map((source) => {
    const assessed = candidates.filter((candidate) => candidate.sourceId === source.id);
    const eligibleForSource = assessed.filter((candidate) => candidate.disposition === "eligible");
    return {
      sourceId: source.id,
      discoveries: assessed.length,
      matchedIndependentEvents: assessed.filter((candidate) => new Set(candidate.sourceDomains).size >= 2).length,
      freshnessPass: assessed.filter((candidate) => candidate.stage !== "freshness" && candidate.stage !== "duplicate").length,
      depthPass: assessed.filter((candidate) => candidate.sourcePair.length >= 2 && !candidate.reasons.includes("thin source")).length,
      preflightPass: assessed.filter((candidate) => ["evidence", "qualified"].includes(candidate.stage) ||
        candidate.stage === "duplicate" && candidate.sourcePair.length >= 2).length,
      evidencePass: eligibleForSource.length,
      distinctPairFamilies: [...new Set(eligibleForSource.map((candidate) => candidate.sourcePair.join(" + ")))].sort(),
    };
  });
  return {
    providerRequests: 0,
    reserveMode: mode,
    sourceDiscoveryFailures: discovery.failures,
    uniqueDiscoveredIdentities: candidates.length,
    uniquePreflightEligibleIdentities: preflightEligible,
    uniquePreflightRejectedIdentities: preflightRejected,
    rejectionRate: preflightAssessed ? preflightRejected / preflightAssessed : 0,
    rejectionReasons,
    independentDomainFailures: rejectionReasons["fewer than two independent permitted source domains"] ?? 0,
    thinSourceFailures: rejectionReasons["thin source"] ?? 0,
    evidenceEligibleCandidates: eligible,
    evergreenEvidenceEligibleCandidates: evergreenEligible.length,
    recurringCurrentEvidenceEligibleCandidates: recurringEligible.length,
    occasionalCurrentEvidenceEligibleCandidates: occasionalEligible.length,
    distinctRecurringSourcePairs: [...new Set(recurringEligible.map((candidate) => candidate.sourcePair.join(" + ")))].sort(),
    distinctRecurringSourceDomains: [...new Set(recurringEligible.flatMap((candidate) => candidate.sourcePair)
      .map((sourceId) => registryDomains.get(sourceId)).filter((domain): domain is string => Boolean(domain)))].sort(),
    distinctEligibleSourcePairs: [...eligiblePairs].sort(),
    distinctEligibleSourceDomains: [...eligibleDomains].sort(),
    eligibleCategories: [...eligibleCategories].sort(),
    sourcePairValue,
    candidates,
  };
}

/** Runs the production candidate-preparation path once and compares its full
 * deterministic view with the bounded normal-replenishment selection. */
export async function runCandidatePreparationParity(mode: Exclude<ReserveMode, "healthy"> = "critical") {
  const preparation = await prepareCandidateUniverse(mode);
  const config = getPublicationConfig();
  const limit = mode === "critical" ? config.criticalCandidateLimit
    : mode === "low" ? config.lowCandidateLimit : config.normalCandidateLimit;
  const normal = selectNormalPreparedCandidates(preparation.assessments, limit);
  const identity = (candidate: PreparedCandidateAssessment) => candidate.supply.releaseSeries && candidate.supply.releasePeriod
    ? `${candidate.supply.releaseSeries}:${candidate.supply.releasePeriod}`
    : candidate.identity.topicKey ?? candidate.identity.candidateHash ?? candidate.item.url;
  const replayIdentities = preparation.assessments.filter((candidate) => candidate.disposition === "eligible").map(identity);
  const normalIdentities = normal.filter((candidate) => candidate.disposition === "eligible").map(identity);
  const replaySet = new Set(replayIdentities);
  const normalSet = new Set(normalIdentities);
  return {
    providerRequests: 0 as const,
    databaseWrites: 0 as const,
    leaseAcquired: false as const,
    reserveMode: mode,
    candidateLimit: limit,
    deterministicReplayCandidateIdentities: replayIdentities,
    normalNoProviderCandidateIdentities: normalIdentities,
    intersection: replayIdentities.filter((value) => normalSet.has(value)),
    replayOnly: replayIdentities.filter((value) => !normalSet.has(value)),
    normalOnly: normalIdentities.filter((value) => !replaySet.has(value)),
    candidates: preparation.assessments.map((candidate) => ({ identity: identity(candidate), title: candidate.item.title,
      discoverySourceId: candidate.item.source.id, disposition: candidate.disposition, stage: candidate.stage,
      reasons: candidate.reasons, preGroqScore: candidate.qualificationScore, supplyClass: candidate.supply.supplyClass,
      selectedByNormalPreparation: normal.includes(candidate) })),
  };
}

/** Executes the real source/preparation path without a lease, provider, image,
 * enqueue, or publication operation, and emits the complete v4 funnel. */
export async function runCandidateFunnelReplay(mode: Exclude<ReserveMode, "healthy"> = "critical") {
  const preparation = await prepareCandidateUniverse(mode);
  const config = getPublicationConfig();
  const limit = mode === "critical" ? config.criticalCandidateLimit : config.lowCandidateLimit;
  const normal = selectNormalPreparedCandidates(preparation.assessments, limit);
  const qualified = normal.filter((candidate) => candidate.disposition === "eligible")
    .sort((left, right) => (right.qualificationScore ?? -1) - (left.qualificationScore ?? -1));
  const providerLimit = Math.min(groqCandidateLimit(mode, config), qualified.length);
  const selected = new Set(qualified.slice(0, providerLimit).map((candidate) => candidate.funnelIdentity));
  const deferred = new Set(qualified.slice(providerLimit).map((candidate) => candidate.funnelIdentity));
  for (const event of preparation.funnelEvents) {
    if (selected.has(event.funnelIdentity)) {
      event.ranking = "selected";
      event.finalStage = "provider-selected";
    } else if (deferred.has(event.funnelIdentity)) {
      event.ranking = "deferred";
      event.finalStage = "provider-deferred";
      event.reasonCodes = ["provider candidate limit"];
    }
  }
  return { schemaVersion: "replenishment-run-telemetry-v4" as const, providerRequests: 0 as const,
    databaseWrites: 0 as const, leaseAcquired: false as const, reserveMode: mode,
    sourceDiscoveryFailures: preparation.discovery.failures, funnelEvents: preparation.funnelEvents };
}

async function replenishReadyQueueWithLease(
  provider: InstrumentedContentProvider,
  retainedKnownIdentities: CanonicalArticleIdentity[],
  lease: ReplenishmentRunLease,
  signal?: AbortSignal,
  telemetry?: ReplenishmentTelemetryRecorder,
  observeRls?: (phase: string) => Promise<unknown>
): Promise<ReplenishmentMetrics> {
  const runId = lease.runId;
  const assertOwned = () => lease.assertOwned(signal);
  await assertOwned();
  const config = getPublicationConfig();
  const depth = await getReadyQueueDepth();
  const categoryCoverage = await getCategoryCoverage();
  operationalLog("info", "category_distribution", { runId, categoryCoverage, minimumPublishedPerCategory: MINIMUM_PUBLISHED_PER_CATEGORY });
  await recordQueueObservation(telemetry, "starting", depth);
  const coverageDeficit = PUBLICATION_CATEGORIES.reduce((sum, category) => sum + Math.max(0,
    MINIMUM_PUBLISHED_PER_CATEGORY - categoryCoverage[category].published - categoryCoverage[category].ready), 0);
  const coverageRepair = depth >= config.target && depth < config.maximum && coverageDeficit > 0;
  const effort = coverageRepair
    ? { mode: "normal" as const, limit: Math.min(config.normalCandidateLimit, config.maximum - depth) }
    : replenishmentLimit(depth, config);
  const fillTarget = coverageRepair ? Math.min(config.maximum, depth + coverageDeficit) : replenishmentFillTarget(depth, config);
  const generatedCategories: Record<string, number> = {};
  const reserveControl = createReserveFillControl(depth, fillTarget);
  telemetry?.recordReserveControl(reserveControl);
  const metrics: ReplenishmentMetrics = {
    runId,
    queueDepthBefore: depth,
    queueDepthAfter: depth,
    reserveMode: effort.mode,
    candidatesProcessed: 0,
    candidatesRejected: 0,
    articlesPrepared: 0,
    rejectionReasons: {},
    sourceFailures: 0,
    providerFailures: 0,
    revisionAttempts: 0,
    duplicateRejections: 0,
    productiveSourcePairs: {},
    preparedCategories: {},
    rejectedCategories: {},
    candidatesSentToGroq: 0,
    candidatesDeferred: 0,
    groqCalls: 0,
    groqInputTokens: 0,
    groqOutputTokens: 0,
    groqTotalTokens: 0,
    tokensPerReadyArticle: null,
    tokensPerRejectedArticle: null,
    rejectionStageDistribution: {},
    tokenBudgetStopped: false,
    attributedArticleIds: [],
    sampleIntegrityPassed: true,
    auditResults: [],
  };

  if (effort.mode === "healthy" || effort.limit === 0) {
    operationalLog("info", "queue_replenishment_skipped", { runId, readyQueueDepth: depth, reserveMode: effort.mode });
    reserveControl.finalObservedReadyDepth = depth;
    telemetry?.recordReserveControl(reserveControl);
    await recordQueueObservation(telemetry, "ending", depth);
    return metrics;
  }
  if (effort.mode === "low") operationalLog("warn", "queue_below_minimum", { runId, readyQueueDepth: depth, minimum: config.minimum });
  if (effort.mode === "critical") operationalLog("error", "queue_empty", { runId, readyQueueDepth: depth, action: "immediate_safe_replenishment" });

  await assertOwned();
  const preparation = await prepareCandidateUniverse(effort.mode, retainedKnownIdentities, assertOwned);
  metrics.sourceFailures = preparation.discovery.failures;
  const { known, knownIdentities } = preparation;
  const groqCandidates: Array<{
    funnelIdentity: string;
    candidateTelemetryId: string;
    deterministicRank: number;
    candidateStartedAt: string;
    item: CandidateItem;
    sources: Awaited<ReturnType<typeof collectSourceMaterials>>;
    evidence: EvidenceBundle;
    expiresAt: Date;
    qualificationScore: number;
    identity: CanonicalArticleIdentity;
    supply: SupplyMetadata;
  }> = [];

  const normalCandidates = selectNormalPreparedCandidates(preparation.assessments, effort.limit);
  for (const assessment of normalCandidates) {
    await assertOwned();
    const { funnelIdentity, item, sources, evidence, expiresAt, identity, qualificationScore, supply } = assessment;
    metrics.candidatesProcessed += 1;
    const deterministicRank = metrics.candidatesProcessed;
    const candidateStartedAt = new Date().toISOString();
    const candidateTelemetryId = candidateTelemetryIdFor(runId, deterministicRank);
    telemetry?.considerCandidate({ candidateTelemetryId, deterministicRank,
      discoveredIdentity: { topic: item.title || null, sourceUrl: item.url || null },
      sourceHints: [item.source.id, ...( "corroboration" in item ? item.corroboration.map((entry) => entry.source.id) : [])],
      consideredAt: candidateStartedAt,
      supplyClass: supply.supplyClass === "evergreen" ? "EVERGREEN"
        : supply.supplyClass === "recurring-current" ? "RECURRING_CURRENT" : "OCCASIONAL_CURRENT",
      releaseSeriesId: supply.releaseSeries, normalizedPeriod: supply.releasePeriod,
      canonicalSeriesPeriodIdentity: supply.releaseSeries && supply.releasePeriod
        ? `${supply.releaseSeries}:${supply.releasePeriod}` : null,
      recurringCadence: supply.recurringCadence, publisherRoots: sources.map((source) => sourceDomain(source.url)).filter(Boolean),
      category: item.source.categoryHint, discoverySourceId: item.source.id, preparationKey: null,
      releasePublicationDates: sources.flatMap((source) => source.publishedAt ? [source.publishedAt] : []),
      nextExpectedCadenceClassification: supply.supplyClass === "recurring-current" ? supply.recurringCadence : null });
    const initialIdentity = candidateIdentity(item);
    const recordCandidate = (disposition: string, reasonCodes: string[], details?: {
      sources?: Awaited<ReturnType<typeof collectSourceMaterials>>; preGroqScore?: number; synthesisScore?: number;
      providerWorkStarted?: boolean; sourcePreflightPassed?: boolean; evidencePassed?: boolean; duplicate?: boolean;
    }) => telemetry?.recordCandidate({
      candidateTelemetryId,
      candidateHash: (details?.sources?.length ? candidateIdentity(item, details.sources).candidateHash : initialIdentity.candidateHash) ?? null,
      sourcePair: (details?.sources ?? []).map((source) => source.registryId),
      sourceDomains: (details?.sources ?? []).map((source) => sourceDomain(source.url)).filter(Boolean),
      sourcePreflightResults: details?.sourcePreflightPassed === undefined ? null
        : { passed: details.sourcePreflightPassed, reasons: details.sourcePreflightPassed ? [] : [...new Set(reasonCodes)] },
      evidenceResults: details?.evidencePassed === undefined ? null
        : { passed: details.evidencePassed, reasons: details.evidencePassed ? [] : [...new Set(reasonCodes)] },
      synthesisResult: details?.synthesisScore === undefined ? null
        : { passed: details.evidencePassed !== false, score: details.synthesisScore, reasons: details.evidencePassed === false ? [...new Set(reasonCodes)] : [] },
      duplicateResult: details?.duplicate === undefined ? null
        : { duplicate: details.duplicate, reasons: details.duplicate ? [...new Set(reasonCodes)] : [] },
      preGroqScore: details?.preGroqScore ?? null, synthesisScore: details?.synthesisScore ?? null,
      disposition, reasonCodes: [...new Set(reasonCodes)], duplicateIdentity: reasonCodes.some((reason) => /duplicate/i.test(reason)),
      providerWorkStarted: details?.providerWorkStarted ?? false, startedAt: candidateStartedAt,
      endedAt: disposition === "qualified" || disposition === "provider-started" ? null : new Date().toISOString(),
      durationMs: disposition === "qualified" || disposition === "provider-started" ? null
        : Math.max(0, Date.now() - Date.parse(candidateStartedAt)),
    });

    try {
      if (assessment.disposition === "rejected") {
        recordRejection(metrics, assessment.reasons, item.source.categoryHint,
          assessment.stage === "unexpected" ? "pre-Groq-unexpected" : assessment.stage);
        recordCandidate(`rejected:${assessment.stage === "unexpected" ? "pre-Groq-unexpected" : assessment.stage}`,
          assessment.reasons, { sources, sourcePreflightPassed: assessment.stage !== "source-preflight",
            evidencePassed: assessment.stage === "evidence" ? false : undefined,
            preGroqScore: qualificationScore ?? undefined, synthesisScore: evidence?.richnessScore,
            duplicate: assessment.stage === "duplicate" });
        continue;
      }
      if (!evidence || qualificationScore === null) throw new Error("qualified candidate is missing deterministic evidence");
      groqCandidates.push({ funnelIdentity, candidateTelemetryId, deterministicRank, candidateStartedAt,
        item, sources, evidence, expiresAt, qualificationScore, identity, supply });
      recordCandidate("qualified", [], { sources, sourcePreflightPassed: true, evidencePassed: true, duplicate: false,
        preGroqScore: qualificationScore, synthesisScore: evidence.richnessScore });
    } catch (error) {
      const reasons = [error instanceof Error ? error.message : "candidate processing failed"];
      recordRejection(metrics, reasons, item.source.categoryHint, "pre-Groq-unexpected");
      recordCandidate("rejected:pre-Groq-unexpected", reasons);
    }
  }

  const balanced = balanceCandidates(groqCandidates, categoryCoverage,
    (candidate) => candidate.item.source.categoryHint, (candidate) => candidate.qualificationScore);
  groqCandidates.splice(0, groqCandidates.length, ...balanced);
  if (coverageRepair) {
    // Extra reserve capacity is exclusively for the missing categories.
    const deficient = groqCandidates.filter((candidate) => {
      const count = categoryCoverage[candidate.item.source.categoryHint as keyof typeof categoryCoverage];
      return count.published + count.ready < MINIMUM_PUBLISHED_PER_CATEGORY;
    });
    groqCandidates.splice(0, groqCandidates.length, ...deficient);
  }
  for (const category of PUBLICATION_CATEGORIES) {
    if (categoryCoverage[category].published + categoryCoverage[category].ready < MINIMUM_PUBLISHED_PER_CATEGORY &&
        !groqCandidates.some((candidate) => candidate.item.source.categoryHint === category)) {
      operationalLog("warn", "category_supply_gap", { runId, category, coverage: categoryCoverage[category],
        reason: "no_eligible_candidate_after_source_evidence_duplicate_and_quality_preflight" });
    }
  }
  const providerLimit = Math.min(groqCandidateLimit(effort.mode, config), groqCandidates.length);
  const selectedFunnelIds = new Set(groqCandidates.slice(0, providerLimit).map((candidate) => candidate.funnelIdentity));
  const deferredFunnelIds = new Set(groqCandidates.slice(providerLimit).map((candidate) => candidate.funnelIdentity));
  for (const event of preparation.funnelEvents) {
    if (selectedFunnelIds.has(event.funnelIdentity)) {
      event.ranking = "selected";
      event.finalStage = "provider-selected";
    } else if (deferredFunnelIds.has(event.funnelIdentity)) {
      event.ranking = "deferred";
      event.finalStage = "provider-deferred";
      event.reasonCodes = ["provider candidate limit"];
    }
  }
  telemetry?.recordFunnel(preparation.funnelEvents);
  metrics.candidatesDeferred = Math.max(0, groqCandidates.length - providerLimit);
  for (const candidate of groqCandidates.slice(providerLimit)) telemetry?.recordCandidate({
    candidateTelemetryId: candidate.candidateTelemetryId,
    candidateHash: candidate.identity.candidateHash ?? candidate.evidence.candidateHash,
    sourcePair: candidate.sources.map((source) => source.registryId),
    sourceDomains: candidate.sources.map((source) => sourceDomain(source.url)).filter(Boolean),
    preGroqScore: candidate.qualificationScore, synthesisScore: candidate.evidence.richnessScore,
    disposition: "deferred:provider-limit", reasonCodes: ["provider candidate limit"], duplicateIdentity: false,
    providerWorkStarted: false, endedAt: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - Date.parse(candidate.candidateStartedAt)),
  });
  let readyTokens = 0;
  let rejectedTokens = 0;
  let groqRejectedCandidates = 0;

  for (let candidateIndex = 0; candidateIndex < providerLimit; candidateIndex += 1) {
    await assertOwned();
    const { candidateTelemetryId, candidateStartedAt, item, sources, evidence, expiresAt, identity, qualificationScore, supply } = groqCandidates[candidateIndex];
    const finalizeCandidateTelemetry = (disposition: string, reasonCodes: string[], providerWorkStarted = true) =>
      telemetry?.recordCandidate({ candidateTelemetryId, candidateHash: identity.candidateHash ?? evidence.candidateHash,
        sourcePair: sources.map((source) => source.registryId), sourceDomains: sources.map((source) => sourceDomain(source.url)).filter(Boolean),
        preGroqScore: qualificationScore, synthesisScore: evidence.richnessScore, disposition,
        reasonCodes: [...new Set(reasonCodes)], duplicateIdentity: reasonCodes.some((reason) => /duplicate/i.test(reason)),
        providerWorkStarted, endedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - Date.parse(candidateStartedAt)) });
    if (reserveControl.successfulEnqueues >= reserveControl.initialDeficit || reserveControl.targetReachedAt) {
      const liveDepth = await getReadyQueueDepth();
      if (!shouldStartProviderWork(reserveControl, liveDepth)) {
        const skipped = groqCandidates.slice(candidateIndex, providerLimit);
        metrics.candidatesDeferred += skipped.length;
        recordSkippedProviderWork(reserveControl, skipped.length);
        telemetry?.recordReserveControl(reserveControl);
        for (const deferred of skipped) telemetry?.recordCandidate({
          candidateTelemetryId: deferred.candidateTelemetryId,
          disposition: "deferred:target-satisfied", reasonCodes: ["reserve fill target satisfied"],
          providerWorkStarted: false, endedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - Date.parse(deferred.candidateStartedAt)),
        });
        break;
      }
    }
    if (depth + metrics.articlesPrepared >= config.maximum) {
      const deferredForMaximum = groqCandidates.slice(candidateIndex, providerLimit);
      metrics.candidatesDeferred += deferredForMaximum.length;
      for (const deferred of deferredForMaximum) telemetry?.recordCandidate({
        candidateTelemetryId: deferred.candidateTelemetryId,
        disposition: "deferred:queue-maximum", reasonCodes: ["queue maximum reached"], providerWorkStarted: false,
        endedAt: new Date().toISOString(), durationMs: Math.max(0, Date.now() - Date.parse(deferred.candidateStartedAt)),
      });
      break;
    }
    if (anyDuplicateIdentity(identity, knownIdentities)) {
      recordRejection(metrics, ["duplicate canonical candidate identity"], item.source.categoryHint, "duplicate");
      finalizeCandidateTelemetry("rejected:duplicate", ["duplicate canonical candidate identity"], false);
      continue;
    }
    const estimatedTokens = estimateCandidateTokens(JSON.stringify(compactEvidencePayload(evidence)).length);
    if (!maySpendTokens(metrics.groqTotalTokens, estimatedTokens)) {
      metrics.tokenBudgetStopped = true;
      metrics.candidatesDeferred += providerLimit - candidateIndex;
      metrics.rejectionStageDistribution["token-budget"] = (metrics.rejectionStageDistribution["token-budget"] ?? 0) + 1;
      for (const deferred of groqCandidates.slice(candidateIndex, providerLimit)) telemetry?.recordCandidate({
        candidateTelemetryId: deferred.candidateTelemetryId,
        candidateHash: deferred.identity.candidateHash ?? deferred.evidence.candidateHash,
        sourcePair: deferred.sources.map((source) => source.registryId),
        sourceDomains: deferred.sources.map((source) => sourceDomain(source.url)).filter(Boolean),
        preGroqScore: deferred.qualificationScore, synthesisScore: deferred.evidence.richnessScore,
        disposition: "deferred:token-budget", reasonCodes: ["token budget"], duplicateIdentity: false,
        providerWorkStarted: false, endedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - Date.parse(deferred.candidateStartedAt)) });
      break;
    }

    metrics.candidatesSentToGroq += 1;
    telemetry?.recordCandidate({ candidateTelemetryId, candidateHash: identity.candidateHash ?? evidence.candidateHash,
      sourcePair: sources.map((source) => source.registryId), sourceDomains: sources.map((source) => sourceDomain(source.url)).filter(Boolean),
      preGroqScore: qualificationScore, synthesisScore: evidence.richnessScore, disposition: "provider-started",
      reasonCodes: [], duplicateIdentity: false, providerWorkStarted: true,
      endedAt: null, durationMs: null });
    provider.beginCandidate?.(evidence.candidateHash, candidateTelemetryId);
    let revisionUsed = false;

    try {
      let generated;
      let independentReview;
      let finalOriginality: ReturnType<typeof deterministicOriginalityPrecheck> | null = null;
      try {
        await assertOwned();
        evidence.editorialCategory = item.source.categoryHint;
        generated = await provider.generate(evidence);
        generatedCategories[item.source.categoryHint] = (generatedCategories[item.source.categoryHint] ?? 0) + 1;
        let headlineRepair = repairHeadlineWithoutNewFacts(generated, evidence, sources);
        generated = headlineRepair.article;
        let originality = headlineRepair.originality;
        finalOriginality = originality;
        if (!originality.accepted && provider.revise) {
          revisionUsed = true;
          metrics.revisionAttempts += 1;
          await assertOwned();
          generated = await provider.revise(generated, {
            focus: "originality", reasons: originality.reasons, deterministicOriginality: originality,
          }, evidence);
          headlineRepair = repairHeadlineWithoutNewFacts(generated, evidence, sources);
          generated = headlineRepair.article;
          originality = headlineRepair.originality;
          finalOriginality = originality;
        }
        if (!originality.accepted) {
          const tokens = finishProviderCandidate(metrics, provider, "rejected:deterministic-originality", revisionUsed, runId);
          rejectedTokens += tokens;
          groqRejectedCandidates += 1;
          recordRejection(metrics, originality.reasons, item.source.categoryHint, "deterministic-originality");
          finalizeCandidateTelemetry("rejected:deterministic-originality", originality.reasons);
          continue;
        }

        await assertOwned();
        independentReview = await provider.validate(generated, evidence);
        recordAuditResult(metrics, evidence, "initial", independentReview);
        let reviewFailures = auditFailures(independentReview);
        if (reviewFailures.length > 0 && !revisionUsed && provider.revise) {
          revisionUsed = true;
          metrics.revisionAttempts += 1;
          await assertOwned();
          generated = await provider.revise(generated, revisionGuidance(independentReview), evidence);
          const repairedRevision = repairHeadlineWithoutNewFacts(generated, evidence, sources);
          generated = repairedRevision.article;
          const revisedOriginality = repairedRevision.originality;
          finalOriginality = revisedOriginality;
          if (!revisedOriginality.accepted) {
            const tokens = finishProviderCandidate(metrics, provider, "rejected:deterministic-originality", revisionUsed, runId);
            rejectedTokens += tokens;
            groqRejectedCandidates += 1;
            recordRejection(metrics, revisedOriginality.reasons, item.source.categoryHint, "deterministic-originality");
            finalizeCandidateTelemetry("rejected:deterministic-originality", revisedOriginality.reasons);
            continue;
          }
          await assertOwned();
          independentReview = await provider.validate(generated, evidence);
          recordAuditResult(metrics, evidence, "post-revision", independentReview);
          reviewFailures = auditFailures(independentReview);
        }
        if (reviewFailures.length > 0) {
          const tokens = finishProviderCandidate(metrics, provider, "rejected:audit", revisionUsed, runId);
          rejectedTokens += tokens;
          groqRejectedCandidates += 1;
          recordRejection(metrics, reviewFailures, item.source.categoryHint, "audit");
          finalizeCandidateTelemetry("rejected:audit", reviewFailures);
          continue;
        }
      } catch (error) {
        if (error instanceof ReplenishmentLeaseLostError || error instanceof ReplenishmentRunIntegrityError) throw error;
        metrics.providerFailures += 1;
        observeProviderQuotaError(error);
        const tokens = finishProviderCandidate(metrics, provider, "rejected:provider", revisionUsed, runId);
        rejectedTokens += tokens;
        groqRejectedCandidates += 1;
        recordRejection(metrics, [providerFailureReason(error)], item.source.categoryHint, "provider");
        finalizeCandidateTelemetry("rejected:provider", [providerFailureReason(error)]);
        continue;
      }
      const audited = { ...generated, quality_review: independentReview };
      const quality = evaluateArticle(audited, sources, known);
      if (!quality.accepted) {
        const tokens = finishProviderCandidate(metrics, provider, "rejected:quality", revisionUsed, runId);
        rejectedTokens += tokens;
        groqRejectedCandidates += 1;
        recordRejection(metrics, quality.reasons, item.source.categoryHint, "quality");
        finalizeCandidateTelemetry("rejected:quality", quality.reasons);
        continue;
      }

      const image = await getUnsplashImage(item.source.categoryHint);
      const now = new Date();
      const completeAttribution = hasCompleteSourceAttribution(audited.content, sources);
      const structuredSources = sources.map((source) => ({
        title: source.title,
        url: source.url,
        publisher: source.publisher,
        publishedAt: source.publishedAt,
        licenseType: source.licenseType,
        sourceType: source.sourceType,
        isPrimary: source.isPrimary,
        registryId: source.registryId,
        recognized: true,
        commercialUseAllowed: source.commercialUseAllowed,
        aiProcessingAllowed: source.aiProcessingAllowed,
        transformationAllowed: source.transformationAllowed,
        permissionUrl: source.permissionUrl,
      }));
      const prepared: PreparedArticleInsert = {
        title: audited.title,
        slug: generateSlug(audited.title),
        content: audited.content,
        summary: audited.summary,
        image_url: image.url,
        image_photographer_name: image.photographerName,
        image_photographer_profile_url: image.photographerProfileUrl,
        image_attribution_url: image.attributionUrl,
        image_download_location: image.downloadLocation,
        source_url: sources[0].url,
        sources: structuredSources,
        publication_status: "draft",
        editorial_state: "ready",
        quality_score: quality.score,
        category: item.source.categoryHint,
        region: item.source.regionHint ?? "Global",
        article_type: item.source.articleTypeHint ?? "news",
        is_breaking: item.source.freshnessClass === "BREAKING",
        is_editors_pick: false,
        read_time: audited.read_time,
        views: 0,
        prepared_at: now.toISOString(),
        publish_after: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        freshness_class: "corroboration" in item ? "EVERGREEN" : item.source.freshnessClass,
        content_pool: "corroboration" in item ? "evergreen" : item.source.contentPool,
        publication_priority: Math.min(100, Math.round(item.source.reliability * 0.7 + quality.score * 0.3)),
        topic_signature: buildTopicSignature(audited.title),
        validation_results: {
          factualCompletenessScore: independentReview.factual_completeness,
          originalityScore: independentReview.originality,
          usefulnessScore: independentReview.usefulness,
          meaningfulContextScore: independentReview.meaningful_context,
          headlineQualityScore: independentReview.headline_quality,
          addedValueScore: independentReview.added_value,
          automatedEditorialPassed: independentReview.should_publish,
          mostlyParaphrase: independentReview.mostly_paraphrase,
          speculativeOrInvented: independentReview.speculative_or_invented,
          factualSupportPassed: independentReview.claims_supported && independentReview.factual_completeness >= 90 && !independentReview.speculative_or_invented,
          originalityPassed: independentReview.originality >= 90 && !independentReview.mostly_paraphrase,
          duplicateDetectionPassed: true,
          sourceOverlapPassed: !independentReview.mostly_paraphrase,
          unsupportedClaims: !independentReview.claims_supported,
          inventedQuotes: independentReview.invented_quotes,
          inventedStatistics: independentReview.invented_statistics,
          completeAttribution,
          hardWarnings: [],
        },
        generation_metadata: {
          pipelineVersion: PIPELINE_VERSION,
          provider: provider.id,
          model: provider.model,
          modernPipeline: true,
          preparedAutomatically: true,
          candidateIdentity: identity,
        },
        preparation_key: "corroboration" in item ? `${item.url}|evergreen|${now.getUTCFullYear()}` : item.url,
      };

      const eligibilityFailures = readyArticleFailures(prepared, new Set(permittedSourceIds()), now);
      if (eligibilityFailures.length > 0) {
        const tokens = finishProviderCandidate(metrics, provider, "rejected:eligibility", revisionUsed, runId);
        rejectedTokens += tokens;
        groqRejectedCandidates += 1;
        recordRejection(metrics, eligibilityFailures, item.source.categoryHint, "eligibility");
        finalizeCandidateTelemetry("rejected:eligibility", eligibilityFailures);
        continue;
      }
      if (!finalOriginality) throw new Error("deterministic originality telemetry is unavailable");
      telemetry?.recordCandidate({ candidateTelemetryId, preparationKey: prepared.preparation_key });
      const readyTelemetry = {
        candidateTelemetryId, candidateHash: evidence.candidateHash, runId,
        preparationKey: prepared.preparation_key, duplicateIdentity: identity.candidateHash ?? evidence.candidateHash,
        quality: quality.score, sourcePair: sources.map((source) => source.registryId),
        supplyClass: supply.supplyClass === "evergreen" ? "EVERGREEN" as const
          : supply.supplyClass === "recurring-current" ? "RECURRING_CURRENT" as const : "OCCASIONAL_CURRENT" as const,
        releaseSeriesId: supply.releaseSeries, normalizedPeriod: supply.releasePeriod,
        canonicalSeriesPeriodIdentity: supply.releaseSeries && supply.releasePeriod
          ? `${supply.releaseSeries}:${supply.releasePeriod}` : null,
        recurringCadence: supply.recurringCadence, title: prepared.title, category: prepared.category,
        publisherRoots: sources.map((source) => sourceDomain(source.url)).filter(Boolean),
        primarySource: sources.find((source) => source.isPrimary)?.registryId ?? null,
        preGroqScore: qualificationScore, factualCompleteness: independentReview.factual_completeness,
        originality: independentReview.originality, usefulness: independentReview.usefulness,
        meaningfulContext: independentReview.meaningful_context, headlineQuality: independentReview.headline_quality,
        addedValue: independentReview.added_value, mostlyParaphrase: independentReview.mostly_paraphrase,
        claimsSupported: independentReview.claims_supported,
        speculativeOrInvented: independentReview.speculative_or_invented,
        inventedQuotes: independentReview.invented_quotes, inventedStatistics: independentReview.invented_statistics,
        deterministicOriginality: finalOriginality, preparedAt: prepared.prepared_at, expiresAt: prepared.expires_at,
        lifecycleState: prepared.editorial_state, publicationStatus: prepared.publication_status,
        eligibilityRevalidationPassed: true, eligibilityFailures: [],
      };
      await assertOwned();
      const enqueue = await enqueueReadyArticle(prepared, config.maximum, fillTarget, {
        systemKey: lease.systemKey, runId,
      });
      if (enqueue.disposition === "LEASE_NOT_OWNED") {
        finishProviderCandidate(metrics, provider, "rejected:lease-lost", revisionUsed, runId);
        throw new ReplenishmentLeaseLostError();
      }
      if (enqueue.disposition !== "INSERTED" || !enqueue.articleId) {
        telemetry?.recordReady({ ...readyTelemetry, articleId: null, enqueueResult: enqueue.disposition,
          insertedAt: null, attributedRunId: null });
        await assertOwned();
        const candidateDisposition = enqueue.disposition === "TARGET_REACHED" ? "not-enqueued:target-reached"
          : enqueue.disposition === "MAX_DEPTH_REACHED" ? "not-enqueued:maximum-reached"
            : enqueue.disposition === "DUPLICATE" ? "rejected:duplicate-enqueue" : "rejected:enqueue-ineligible";
        const reason = enqueue.disposition === "TARGET_REACHED" ? "reserve fill target reached"
          : enqueue.disposition === "MAX_DEPTH_REACHED" ? "queue maximum reached"
            : enqueue.disposition === "DUPLICATE" ? "duplicate enqueue" : "enqueue eligibility rejected";
        if (enqueue.disposition === "TARGET_REACHED" && !reserveControl.targetReachedAt) {
          reserveControl.targetReachedAt = candidateTelemetryId;
          telemetry?.recordReserveControl(reserveControl);
        }
        const tokens = finishProviderCandidate(metrics, provider, candidateDisposition, revisionUsed, runId);
        rejectedTokens += tokens;
        groqRejectedCandidates += 1;
        if (enqueue.disposition !== "TARGET_REACHED") {
          recordRejection(metrics, [reason], item.source.categoryHint,
            enqueue.disposition === "DUPLICATE" ? "duplicate" : "enqueue");
        }
        finalizeCandidateTelemetry(candidateDisposition, [reason]);
        continue;
      }
      const insertedId = enqueue.articleId;
      const attributedRunId = await articleReplenishmentRunId(insertedId);
      validateReplenishmentRunIntegrity({
        runId, providerEvents: [], attributedRunIds: attributedRunId ? [attributedRunId] : ["missing"], leaseLost: lease.isLost(),
      });
      metrics.attributedArticleIds.push(insertedId);
      telemetry?.recordReady({ ...readyTelemetry, articleId: insertedId, enqueueResult: "INSERTED",
        insertedAt: new Date().toISOString(), attributedRunId });
      operationalLog("info", "ready_article_attributed", { runId, articleId: insertedId, candidateHash: evidence.candidateHash });
      await observeRls?.(`ready-depth-${depth + metrics.articlesPrepared + 1}`);
      readyTokens += finishProviderCandidate(metrics, provider, "ready", revisionUsed, runId);
      known.push({
        title: prepared.title,
        summary: prepared.summary,
        source_url: prepared.source_url,
        sources: prepared.sources,
        topic_signature: prepared.topic_signature,
        category: prepared.category,
        prepared_at: prepared.prepared_at,
        generation_metadata: prepared.generation_metadata,
      });
      knownIdentities.push(identity);
      metrics.articlesPrepared += 1;
      recordSuccessfulEnqueue(reserveControl, candidateTelemetryId, enqueue.readyDepth);
      telemetry?.recordReserveControl(reserveControl);
      finalizeCandidateTelemetry("ready", []);
      const pair = sources.map((source) => source.registryId).sort().join(" + ");
      metrics.productiveSourcePairs[pair] = (metrics.productiveSourcePairs[pair] ?? 0) + 1;
      metrics.preparedCategories[prepared.category] = (metrics.preparedCategories[prepared.category] ?? 0) + 1;
    } catch (error) {
      if (error instanceof ReplenishmentLeaseLostError || error instanceof ReplenishmentRunIntegrityError) throw error;
      const tokens = finishProviderCandidate(metrics, provider, "rejected:post-Groq-unexpected", revisionUsed, runId);
      rejectedTokens += tokens;
      groqRejectedCandidates += 1;
      recordRejection(metrics, [error instanceof Error ? error.message : "candidate processing failed"], item.source.categoryHint, "post-Groq-unexpected");
      finalizeCandidateTelemetry("rejected:post-Groq-unexpected",
        [error instanceof Error ? error.message : "candidate processing failed"]);
    }
  }

  metrics.tokensPerReadyArticle = metrics.articlesPrepared > 0 ? Math.round(readyTokens / metrics.articlesPrepared) : null;
  metrics.tokensPerRejectedArticle = groqRejectedCandidates > 0 ? Math.round(rejectedTokens / groqRejectedCandidates) : null;

  await assertOwned();
  metrics.queueDepthAfter = await getReadyQueueDepth();
  reserveControl.finalObservedReadyDepth = metrics.queueDepthAfter;
  telemetry?.recordReserveControl(reserveControl);
  await recordQueueObservation(telemetry, "ending", metrics.queueDepthAfter);
  const budgetUsage = currentTokenBudgetUsage(metrics.groqTotalTokens);
  operationalLog("info", "queue_replenishment_completed", {
    runId,
    readyQueueDepth: metrics.queueDepthAfter,
    candidatesProcessed: metrics.candidatesProcessed,
    candidatesRejected: metrics.candidatesRejected,
    articlesPrepared: metrics.articlesPrepared,
    sourceFailures: metrics.sourceFailures,
    providerFailures: metrics.providerFailures,
    revisionAttempts: metrics.revisionAttempts,
    duplicateRejections: metrics.duplicateRejections,
    rejectionReasons: metrics.rejectionReasons,
    productiveSourcePairs: metrics.productiveSourcePairs,
    preparedCategories: metrics.preparedCategories,
    generatedCategories,
    categoryCoverageAfter: await getCategoryCoverage(),
    rejectedCategories: metrics.rejectedCategories,
    candidatesSentToGroq: metrics.candidatesSentToGroq,
    candidatesDeferred: metrics.candidatesDeferred,
    groqCalls: metrics.groqCalls,
    groqInputTokens: metrics.groqInputTokens,
    groqOutputTokens: metrics.groqOutputTokens,
    groqTotalTokens: metrics.groqTotalTokens,
    tokensPerReadyArticle: metrics.tokensPerReadyArticle,
    tokensPerRejectedArticle: metrics.tokensPerRejectedArticle,
    rejectionStageDistribution: metrics.rejectionStageDistribution,
    tokenBudgetStopped: metrics.tokenBudgetStopped,
    runTokenBudgetRemaining: budgetUsage.runRemaining,
    approximateDailyTokenBudgetRemaining: budgetUsage.dailyRemaining,
    auditResults: metrics.auditResults,
  });
  return metrics;
}

export type ReplenishmentRunOptions = {
  signal?: AbortSignal;
  runId?: string;
  lease?: ReplenishmentRunLease;
  telemetry?: ReplenishmentTelemetryRecorder;
  observeRls?: (phase: string) => Promise<unknown>;
};

export async function replenishReadyQueue(
  provider?: InstrumentedContentProvider,
  retainedKnownIdentities: CanonicalArticleIdentity[] = [],
  options: ReplenishmentRunOptions = {}
): Promise<ReplenishmentMetrics> {
  assertWritesAllowed("queue replenishment");
  const database = createServerSupabaseClient();
  const lease = options.lease ?? new ReplenishmentRunLease(
    new SupabaseReplenishmentLeaseStore(database), { runId: options.runId, observer: options.telemetry?.leaseObserver() }
  );
  let acquiredHere = false;
  try {
    if (!options.lease) {
      await lease.acquire();
      acquiredHere = true;
    } else {
      await lease.assertOwned(options.signal);
    }
    const activeProvider = provider ?? new GroqContentProvider(lease.runId, () => lease.assertOwned(options.signal));
    activeProvider.setRunContext?.(lease.runId, () => lease.assertOwned(options.signal));
    activeProvider.setAttemptObserver?.((event) => options.telemetry?.recordProviderAttempt(event));
    return await replenishReadyQueueWithLease(activeProvider, retainedKnownIdentities, lease, options.signal,
      options.telemetry, options.observeRls);
  } finally {
    if (acquiredHere) {
      const released = await Promise.race([
        lease.release(),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
      ]);
      operationalLog(released ? "info" : "warn", "replenishment_lease_released", {
        runId: lease.runId, released,
      });
    }
  }
}

export async function runPublicationCycle(slot = publicationSlotAt(), signal?: AbortSignal) {
  assertWritesAllowed("publication cycle");
  const result = await executeSeparatedCycle(
    () => publishNextReadyArticle(slot),
    () => replenishReadyQueue(undefined, [], { signal })
  );
  const published = result.publication;
  if (published?.was_published) {
    operationalLog("info", "article_published", { articleId: published.id, category: published.category, freshnessClass: published.freshness_class, slot: slot.toISOString() });
  } else if (published) {
    operationalLog("info", "publication_slot_already_filled", { articleId: published.id, slot: slot.toISOString() });
  } else if (!result.publicationError) {
    operationalLog("error", "publication_slot_empty", { slot: slot.toISOString(), reason: "no_eligible_ready_article" });
  } else {
    operationalLog("error", "publication_failed", { slot: slot.toISOString(), error: result.publicationError instanceof Error ? result.publicationError.name : "unknown" });
  }
  if (result.replenishmentError) {
    operationalLog("error", "queue_replenishment_failed", { error: result.replenishmentError instanceof Error ? result.replenishmentError.name : "unknown" });
  }
  return {
    published,
    publicationError: result.publicationError ? "Atomic publication failed." : null,
    replenishment: result.replenishment,
  };
}

// Kept as a compatibility alias for the protected legacy endpoint.
export const updateNews = replenishReadyQueue;
