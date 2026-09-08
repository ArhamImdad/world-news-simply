import { candidateHash } from "@/lib/evidence-model";
import { buildTopicSignature, materiallySimilar, topicSignatureSimilarity } from "@/lib/publication-policy";

export type CanonicalArticleIdentity = {
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

export type ArticleIdentityInput = {
  candidateHash?: unknown;
  topic?: unknown;
  topicKey?: unknown;
  topicSignature?: unknown;
  sourceRegistryIds?: unknown;
  sourceDomains?: unknown;
  sourceUrls?: unknown;
  primarySourceUrls?: unknown;
  supportingSourceUrls?: unknown;
  unclassifiedSourceUrls?: unknown;
  primarySourceRegistryIds?: unknown;
  supportingSourceRegistryIds?: unknown;
  sources?: unknown;
  category?: unknown;
  eventDate?: unknown;
};

export type DuplicateIdentitySignal =
  | "candidate-hash"
  | "topic-key"
  | "material-topic"
  | "primary-url-and-topic"
  | "primary-supporting-inversion-and-topic"
  | "multiple-urls-and-topic"
  | null;

export type CalibrationArtifactDiagnostic = {
  code: "artifact-not-object" | "unsupported-artifact-version" | "results-not-array" |
    "conflicting-disposition" | "invalid-disposition" | "invalid-ready-result" | "invalid-selection";
  resultIndex: number | null;
};

export type NormalizedRetainedArtifactResult = {
  disposition: SupportedArtifactDisposition;
  candidateHash: unknown;
  candidate: unknown;
  category: unknown;
  sourcePair: Array<Record<string, unknown>>;
  storedIdentity: unknown;
};

export type NormalizedCalibrationArtifact = {
  version: "legacy" | 1;
  safe: boolean;
  results: NormalizedRetainedArtifactResult[];
  identities: CanonicalArticleIdentity[];
  diagnostics: CalibrationArtifactDiagnostic[];
};

const SUPPORTED_DISPOSITIONS = new Set([
  "ready-qualified-no-insert",
  "deferred:token-budget",
  "rejected:audit",
  "rejected:deterministic-originality",
  "rejected:deterministic-pre-Groq",
  "rejected:duplicate-pre-Groq",
  "rejected:enqueue",
  "rejected:evidence",
  "rejected:eligibility",
  "rejected:freshness",
  "rejected:no-configured-candidate",
  "rejected:post-Groq-unexpected",
  "rejected:provider",
  "rejected:provider-application-validation",
  "rejected:quality",
  "rejected:source-preflight",
] as const);
type SupportedArtifactDisposition = typeof SUPPORTED_DISPOSITIONS extends Set<infer T> ? T : never;

export class CalibrationArtifactError extends Error {
  constructor(readonly diagnostics: CalibrationArtifactDiagnostic[]) {
    super(`Calibration artifact rejected: ${diagnostics.map((diagnostic) => diagnostic.code).join(", ")}`);
    this.name = "CalibrationArtifactError";
  }
}

function normalizedText(value: unknown) {
  return typeof value === "string" ? value.normalize("NFKD").toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim() : "";
}

function normalizedList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    const normalized = normalizedText(item);
    return normalized ? [normalized] : [];
  }))].sort();
}

function canonicalUrl(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"]
      .forEach((name) => url.searchParams.delete(name));
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return "";
  }
}

function canonicalUrlList(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.map(canonicalUrl).filter(Boolean))].sort() : [];
}

function dateWindow(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 7);
}

function hashValue(value: unknown) {
  return normalizedText(value).replace(/[^a-f0-9]/g, "").slice(0, 64) || null;
}

function sourceRecords(value: unknown) {
  return Array.isArray(value) ? value.filter((source): source is Record<string, unknown> =>
    Boolean(source) && typeof source === "object" && !Array.isArray(source)) : [];
}

export function buildCanonicalArticleIdentity(input: ArticleIdentityInput): CanonicalArticleIdentity {
  const topic = normalizedText(input.topic);
  const sources = sourceRecords(input.sources);
  const roleMalformed = sources.some((source) => source.isPrimary !== undefined && typeof source.isPrimary !== "boolean");
  const sourceRegistryIds = normalizedList([
    ...(Array.isArray(input.sourceRegistryIds) ? input.sourceRegistryIds : []), ...sources.map((source) => source.registryId),
  ]);
  const explicitDomains = normalizedList(input.sourceDomains);
  const explicitUrls = canonicalUrlList(input.sourceUrls);
  const sourceUrlsFromRecords = canonicalUrlList(sources.map((source) => source.url));
  const primarySourceUrls = canonicalUrlList([
    ...(Array.isArray(input.primarySourceUrls) ? input.primarySourceUrls : []),
    ...sources.filter((source) => source.isPrimary === true).map((source) => source.url),
  ]);
  const supportingSourceUrls = canonicalUrlList([
    ...(Array.isArray(input.supportingSourceUrls) ? input.supportingSourceUrls : []),
    ...sources.filter((source) => source.isPrimary === false).map((source) => source.url),
  ]);
  const explicitlyClassified = new Set([...primarySourceUrls, ...supportingSourceUrls]);
  const unclassifiedSourceUrls = canonicalUrlList([
    ...(Array.isArray(input.unclassifiedSourceUrls) ? input.unclassifiedSourceUrls : []),
    ...explicitUrls.filter((url) => !explicitlyClassified.has(url)),
    ...sources.filter((source) => typeof source.isPrimary !== "boolean").map((source) => source.url),
  ]);
  const sourceUrls = [...new Set([
    ...explicitUrls, ...sourceUrlsFromRecords, ...primarySourceUrls, ...supportingSourceUrls, ...unclassifiedSourceUrls,
  ])].sort();
  const primarySourceRegistryIds = normalizedList([
    ...(Array.isArray(input.primarySourceRegistryIds) ? input.primarySourceRegistryIds : []),
    ...sources.filter((source) => source.isPrimary === true).map((source) => source.registryId),
  ]);
  const supportingSourceRegistryIds = normalizedList([
    ...(Array.isArray(input.supportingSourceRegistryIds) ? input.supportingSourceRegistryIds : []),
    ...sources.filter((source) => source.isPrimary === false).map((source) => source.registryId),
  ]);
  const urlDomains = sourceUrls.flatMap((url) => {
    try { return [new URL(url).hostname.toLowerCase().replace(/^www\./, "")]; } catch { return []; }
  });
  const sourceDomains = [...new Set([...explicitDomains, ...urlDomains])].sort();
  const suppliedSignature = normalizedList(input.topicSignature);
  const topicSignature = suppliedSignature.length ? suppliedSignature : topic ? buildTopicSignature(topic) : [];
  const window = dateWindow(input.eventDate);
  const suppliedHash = hashValue(input.candidateHash);
  const category = normalizedText(input.category) || null;
  const computedTopicKeySeed = topic && sourceRegistryIds.length
    ? [topic, sourceRegistryIds.join("+"), window ?? "undated"].join("|") : "";
  const suppliedTopicKey = hashValue(input.topicKey);
  const malformed = Boolean(
    input.sourceRegistryIds !== undefined && !Array.isArray(input.sourceRegistryIds) ||
    input.sourceUrls !== undefined && !Array.isArray(input.sourceUrls) ||
    input.sourceDomains !== undefined && !Array.isArray(input.sourceDomains) ||
    input.topicSignature !== undefined && !Array.isArray(input.topicSignature) ||
    input.primarySourceUrls !== undefined && !Array.isArray(input.primarySourceUrls) ||
    input.supportingSourceUrls !== undefined && !Array.isArray(input.supportingSourceUrls) ||
    input.unclassifiedSourceUrls !== undefined && !Array.isArray(input.unclassifiedSourceUrls) ||
    input.primarySourceRegistryIds !== undefined && !Array.isArray(input.primarySourceRegistryIds) ||
    input.supportingSourceRegistryIds !== undefined && !Array.isArray(input.supportingSourceRegistryIds) ||
    input.sources !== undefined && !Array.isArray(input.sources) || roleMalformed
  );
  return {
    version: 1,
    candidateHash: suppliedHash,
    topic: topic || null,
    topicKey: suppliedTopicKey ?? (computedTopicKeySeed ? candidateHash(computedTopicKeySeed) : null),
    topicSignature,
    sourceRegistryIds,
    sourceDomains,
    sourceUrls,
    primarySourceUrls,
    supportingSourceUrls,
    unclassifiedSourceUrls,
    primarySourceRegistryIds,
    supportingSourceRegistryIds,
    category,
    dateWindow: window,
    malformed,
  };
}

export function canonicalIdentityFromStored(value: unknown, fallback: ArticleIdentityInput = {}) {
  const stored = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  return buildCanonicalArticleIdentity({
    candidateHash: stored.candidateHash ?? fallback.candidateHash,
    topic: stored.topic ?? fallback.topic,
    topicKey: stored.topicKey ?? fallback.topicKey,
    topicSignature: stored.topicSignature ?? fallback.topicSignature,
    sourceRegistryIds: stored.sourceRegistryIds ?? fallback.sourceRegistryIds,
    sourceDomains: stored.sourceDomains ?? fallback.sourceDomains,
    sourceUrls: stored.sourceUrls ?? fallback.sourceUrls,
    primarySourceUrls: stored.primarySourceUrls ?? fallback.primarySourceUrls,
    supportingSourceUrls: stored.supportingSourceUrls ?? fallback.supportingSourceUrls,
    unclassifiedSourceUrls: stored.unclassifiedSourceUrls ?? fallback.unclassifiedSourceUrls,
    primarySourceRegistryIds: stored.primarySourceRegistryIds ?? fallback.primarySourceRegistryIds,
    supportingSourceRegistryIds: stored.supportingSourceRegistryIds ?? fallback.supportingSourceRegistryIds,
    sources: fallback.sources,
    category: stored.category ?? fallback.category,
    eventDate: stored.eventDate ?? stored.preparedAt ?? fallback.eventDate,
  });
}

function overlapCount(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return new Set(left.filter((value) => rightSet.has(value))).size;
}

export function duplicateIdentityEvidence(left: CanonicalArticleIdentity, right: CanonicalArticleIdentity): DuplicateIdentitySignal {
  const separatedWindows = Boolean(left.dateWindow && right.dateWindow && left.dateWindow !== right.dateWindow);
  const materialTopic = left.topicSignature.length >= 3 && right.topicSignature.length >= 3 &&
    materiallySimilar(left.topicSignature, right.topicSignature);
  const topicSimilarity = left.topicSignature.length >= 3 && right.topicSignature.length >= 3
    ? topicSignatureSimilarity(left.topicSignature, right.topicSignature) : 0;
  const exactTopic = Boolean(left.topic && right.topic && left.topic === right.topic);

  if (left.topicKey && right.topicKey && left.topicKey === right.topicKey) return "topic-key";
  if (separatedWindows) return null;
  if (left.candidateHash && right.candidateHash && left.candidateHash === right.candidateHash &&
      (materialTopic || exactTopic || left.topicSignature.length < 3 || right.topicSignature.length < 3)) {
    return "candidate-hash";
  }
  if (materialTopic) return "material-topic";

  const strongCombinedTopic = exactTopic || topicSimilarity >= 0.45;
  if (!strongCombinedTopic) return null;
  if (overlapCount(left.primarySourceUrls, right.primarySourceUrls) > 0) return "primary-url-and-topic";
  if (overlapCount(left.primarySourceUrls, right.supportingSourceUrls) > 0 ||
      overlapCount(left.supportingSourceUrls, right.primarySourceUrls) > 0) {
    return "primary-supporting-inversion-and-topic";
  }
  if (overlapCount(left.sourceUrls, right.sourceUrls) >= 2) return "multiple-urls-and-topic";
  return null;
}

export function articleIdentitiesAreDuplicate(left: CanonicalArticleIdentity, right: CanonicalArticleIdentity) {
  return duplicateIdentityEvidence(left, right) !== null;
}

export function anyDuplicateIdentity(candidate: CanonicalArticleIdentity, known: CanonicalArticleIdentity[]) {
  return known.some((identity) => articleIdentitiesAreDuplicate(candidate, identity));
}

function normalizedDisposition(result: Record<string, unknown>, resultIndex: number,
  diagnostics: CalibrationArtifactDiagnostic[]) {
  const current = result.disposition;
  const historical = result.finalDisposition;
  if (current !== undefined && historical !== undefined && current !== historical) {
    diagnostics.push({ code: "conflicting-disposition", resultIndex });
    return null;
  }
  const value = current ?? historical;
  if (typeof value !== "string" || !SUPPORTED_DISPOSITIONS.has(value as SupportedArtifactDisposition)) {
    diagnostics.push({ code: "invalid-disposition", resultIndex });
    return null;
  }
  return value as SupportedArtifactDisposition;
}

function resultSources(result: Record<string, unknown>, pairs: Array<Record<string, unknown>>) {
  const readyEvaluation = result.readyEvaluation && typeof result.readyEvaluation === "object" && !Array.isArray(result.readyEvaluation)
    ? result.readyEvaluation as Record<string, unknown> : null;
  return Array.isArray(readyEvaluation?.sources) ? readyEvaluation.sources : pairs;
}

export function normalizeCalibrationArtifact(value: unknown): NormalizedCalibrationArtifact {
  const diagnostics: CalibrationArtifactDiagnostic[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push({ code: "artifact-not-object", resultIndex: null });
    return { version: "legacy", safe: false, results: [], identities: [], diagnostics };
  }
  const artifact = value as Record<string, unknown>;
  const declaredVersion = artifact.artifactVersion ?? artifact.schemaVersion;
  const version = declaredVersion === undefined ? "legacy" : declaredVersion === 1 || declaredVersion === "1" ? 1 : null;
  if (version === null) diagnostics.push({ code: "unsupported-artifact-version", resultIndex: null });
  if (artifact.results !== undefined && !Array.isArray(artifact.results)) {
    diagnostics.push({ code: "results-not-array", resultIndex: null });
  }

  const normalizedResults: NormalizedRetainedArtifactResult[] = [];
  const identities: CanonicalArticleIdentity[] = [];
  const selection = artifact.selection && typeof artifact.selection === "object" && !Array.isArray(artifact.selection)
    ? artifact.selection as Record<string, unknown> : null;
  const finalEvaluation = artifact.finalEvaluation && typeof artifact.finalEvaluation === "object" && !Array.isArray(artifact.finalEvaluation)
    ? artifact.finalEvaluation as Record<string, unknown> : null;
  if (finalEvaluation?.readyQualified === true) {
    const pairs = Array.isArray(selection?.sourcePair) ? selection.sourcePair.filter((source): source is Record<string, unknown> =>
      Boolean(source) && typeof source === "object" && !Array.isArray(source)) : [];
    if (!selection || typeof selection.candidate !== "string" || !selection.candidate.trim() || pairs.length < 2 ||
        pairs.some((source) => typeof source.registryId !== "string" || !source.registryId)) {
      diagnostics.push({ code: "invalid-selection", resultIndex: null });
    } else {
      const identity = buildCanonicalArticleIdentity({
        topic: selection.candidate,
        sources: pairs,
        sourceRegistryIds: pairs.map((source) => source.registryId),
        sourceDomains: pairs.map((source) => source.domain),
        sourceUrls: pairs.map((source) => source.url),
      });
      if (identity.malformed) diagnostics.push({ code: "invalid-selection", resultIndex: null });
      else identities.push(identity);
    }
  }

  const results = Array.isArray(artifact.results) ? artifact.results : [];
  results.forEach((rawResult, resultIndex) => {
    if (!rawResult || typeof rawResult !== "object" || Array.isArray(rawResult)) {
      diagnostics.push({ code: "invalid-ready-result", resultIndex });
      return;
    }
    const result = rawResult as Record<string, unknown>;
    const disposition = normalizedDisposition(result, resultIndex, diagnostics);
    if (!disposition) return;
    const pairs = Array.isArray(result.sourcePair) ? result.sourcePair.filter((source): source is Record<string, unknown> =>
      Boolean(source) && typeof source === "object" && !Array.isArray(source)) : [];
    const readyEvaluation = result.readyEvaluation && typeof result.readyEvaluation === "object" && !Array.isArray(result.readyEvaluation)
      ? result.readyEvaluation as Record<string, unknown> : null;
    const generationMetadata = readyEvaluation?.generation_metadata && typeof readyEvaluation.generation_metadata === "object"
      ? readyEvaluation.generation_metadata as Record<string, unknown> : null;
    const normalized: NormalizedRetainedArtifactResult = {
      disposition,
      candidateHash: result.candidateHash,
      candidate: result.candidate,
      category: result.category,
      sourcePair: pairs,
      storedIdentity: generationMetadata?.candidateIdentity,
    };
    normalizedResults.push(normalized);
    if (disposition !== "ready-qualified-no-insert") return;
    if (typeof result.candidate !== "string" || !result.candidate.trim() || pairs.length < 2 ||
        pairs.some((source) => typeof source.registryId !== "string" || !source.registryId)) {
      diagnostics.push({ code: "invalid-ready-result", resultIndex });
      return;
    }
    const sources = resultSources(result, pairs);
    const identity = canonicalIdentityFromStored(normalized.storedIdentity, {
      candidateHash: result.candidateHash,
      topic: result.candidate,
      sourceRegistryIds: pairs.map((source) => source.registryId),
      sourceDomains: pairs.map((source) => source.domain),
      sourceUrls: pairs.map((source) => source.url),
      sources,
      category: result.category,
    });
    if (identity.malformed) diagnostics.push({ code: "invalid-ready-result", resultIndex });
    else identities.push(identity);
  });
  return { version: version ?? "legacy", safe: diagnostics.length === 0, results: normalizedResults, identities, diagnostics };
}

export function identitiesFromCalibrationArtifact(value: unknown) {
  const normalized = normalizeCalibrationArtifact(value);
  if (!normalized.safe) throw new CalibrationArtifactError(normalized.diagnostics);
  return normalized.identities;
}
