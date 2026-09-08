import type { ArticleQualityReview, RewrittenArticle, SourceMaterial } from "@/types/article";

export const QUALITY_THRESHOLD = 90;

type RecentArticle = {
  title: string;
  summary?: string | null;
  source_url?: string | null;
};

export type QualityGateResult = {
  accepted: boolean;
  score: number;
  reasons: string[];
};

const ignoredWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "in", "is", "it",
  "of", "on", "or", "that", "the", "this", "to", "was", "were", "will", "with",
]);

export function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTokens(value: string) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !ignoredWords.has(token));
}

export function textSimilarity(first: string, second: string) {
  const a = new Set(meaningfulTokens(first));
  const b = new Set(meaningfulTokens(second));
  if (a.size === 0 || b.size === 0) return 0;

  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / new Set([...a, ...b]).size;
}

export function headlinesAreSimilar(first: string, second: string, threshold = 0.62) {
  const a = meaningfulTokens(first);
  const b = meaningfulTokens(second);
  if (a.length < 3 || b.length < 3) return false;

  const overlap = new Set(a.filter((token) => b.includes(token))).size;
  return overlap >= 3 && textSimilarity(first, second) >= threshold;
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export function hasCompleteSourceAttribution(content: string, sources: SourceMaterial[]) {
  const normalized = normalizeText(content);
  return sources.filter((source) => source.reliability >= 65).every((source) => {
    const publisher = normalizeText(source.publisher);
    return publisher.length > 2 && normalized.includes(publisher);
  });
}

export function ngramOverlap(generated: string, source: string, size = 5) {
  const generatedTokens = meaningfulTokens(generated);
  const sourceTokens = meaningfulTokens(source);
  if (generatedTokens.length < size || sourceTokens.length < size) return 0;

  const makeNgrams = (tokens: string[]) => {
    const grams = new Set<string>();
    for (let index = 0; index <= tokens.length - size; index += 1) {
      grams.add(tokens.slice(index, index + size).join(" "));
    }
    return grams;
  };

  const generatedGrams = makeNgrams(generatedTokens);
  const sourceGrams = makeNgrams(sourceTokens);
  const matches = [...generatedGrams].filter((gram) => sourceGrams.has(gram)).length;
  return matches / generatedGrams.size;
}

function sentenceParts(value: string) {
  return value.split(/(?<=[.!?])\s+|\n+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length >= 35);
}

function sourceOrderSimilarity(generated: string, source: string) {
  const sourceSentences = sentenceParts(source);
  const mapped = sentenceParts(generated).flatMap((sentence) => {
    let bestIndex = -1;
    let bestScore = 0;
    sourceSentences.forEach((candidate, index) => {
      const score = textSimilarity(sentence, candidate);
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    });
    return bestIndex >= 0 && bestScore >= 0.24 ? [bestIndex] : [];
  });
  if (mapped.length < 4) return 0;
  let ordered = 0;
  for (let index = 1; index < mapped.length; index += 1) if (mapped[index] > mapped[index - 1]) ordered += 1;
  return ordered / (mapped.length - 1);
}

export type DeterministicOriginalityResult = {
  accepted: boolean;
  fiveWordOverlap: number;
  maximumSentenceSimilarity: number;
  headlineSimilarity: number;
  sourceOrderSimilarity: number;
  reasons: string[];
};

export function deterministicOriginalityPrecheck(article: Pick<RewrittenArticle, "title" | "content">, sources: SourceMaterial[]): DeterministicOriginalityResult {
  const fiveWordOverlap = Math.max(0, ...sources.map((source) => ngramOverlap(article.content, source.text, 5)));
  const maximumSentenceSimilarity = Math.max(0, ...sentenceParts(article.content).flatMap((sentence) =>
    sources.flatMap((source) => sentenceParts(source.text).map((sourceSentence) => textSimilarity(sentence, sourceSentence)))));
  const headlineSimilarity = Math.max(0, ...sources.map((source) => textSimilarity(article.title, source.title)));
  const orderSimilarity = Math.max(0, ...sources.map((source) => sourceOrderSimilarity(article.content, source.text)));
  const reasons: string[] = [];
  if (fiveWordOverlap > 0.16) reasons.push("five-word source phrase overlap");
  if (maximumSentenceSimilarity > 0.76) reasons.push("sentence too similar to source");
  if (headlineSimilarity > 0.72) reasons.push("headline too similar to source");
  if (orderSimilarity > 0.82) reasons.push("article follows source order");
  return {
    accepted: reasons.length === 0,
    fiveWordOverlap,
    maximumSentenceSimilarity,
    headlineSimilarity,
    sourceOrderSimilarity: orderSimilarity,
    reasons,
  };
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function headlineScore(title: string) {
  const normalized = normalizeText(title);
  const clickbait = /\b(shocking|you won.t believe|mind blowing|must see|game changer|breaks the internet)\b/i;
  let score = 100;
  if (title.length < 35 || title.length > 110) score -= 25;
  if (clickbait.test(normalized)) score -= 50;
  if (title.endsWith("!")) score -= 15;
  if (title === title.toUpperCase() && /[A-Z]/.test(title)) score -= 25;
  return clampScore(score);
}

export function preflightSources(sources: SourceMaterial[]): QualityGateResult {
  const reasons: string[] = [];
  const primary = sources.find((source) => source.isPrimary);
  const reliableSources = sources.filter((source) => source.reliability >= 65);
  const totalWords = sources.reduce((total, source) => total + wordCount(source.text), 0);
  const primaryWords = primary ? wordCount(primary.text) : 0;
  const independentDomains = new Set(sources.flatMap((source) => {
    try { return [new URL(source.url).hostname.toLowerCase().replace(/^www\./, "")]; } catch { return []; }
  }));

  if (sources.some((source) => !source.licenseType || source.licenseType === "unknown")) {
    reasons.push("source permission not verified");
  }
  if (!primary || primary.reliability < 65) reasons.push("unreliable source");
  if (reliableSources.length < 2 || independentDomains.size < 2) reasons.push("fewer than two independent permitted source domains");
  if (sources.some((source) => !source.registryId || !source.commercialUseAllowed ||
      !source.aiProcessingAllowed || !source.transformationAllowed || !source.permissionUrl)) {
    reasons.push("source permission not verified");
  }
  if (primaryWords < 120 || totalWords < 180) reasons.push("thin source");

  const reliability = primary?.reliability ?? 0;
  const depth = clampScore(Math.min(100, primaryWords / 4) + Math.min(20, (reliableSources.length - 1) * 10));
  return {
    accepted: reasons.length === 0,
    score: clampScore(reliability * 0.55 + depth * 0.45),
    reasons: [...new Set(reasons)],
  };
}

function reviewIsValid(review: ArticleQualityReview) {
  const scores = [
    review.factual_completeness,
    review.originality,
    review.usefulness,
    review.meaningful_context,
    review.headline_quality,
    review.added_value,
  ];
  return scores.every((score) => Number.isFinite(score) && score >= 0 && score <= 100);
}

export function evaluateArticle(
  article: RewrittenArticle,
  sources: SourceMaterial[],
  recentArticles: RecentArticle[]
): QualityGateResult {
  const reasons: string[] = [];
  const review = article.quality_review;
  const primary = sources.find((source) => source.isPrimary);
  const reliableSources = sources.filter((source) => source.reliability >= 65);
  const contentWords = wordCount(article.content);

  if (!reviewIsValid(review)) reasons.push("invalid quality review");
  if (!review.should_publish) reasons.push(...review.rejection_reasons, "quality review rejected");
  if (!review.claims_supported) reasons.push("unsupported claims");
  if (review.speculative_or_invented) reasons.push("speculative or invented facts");
  if (review.invented_quotes) reasons.push("invented quotes");
  if (review.invented_statistics) reasons.push("invented statistics");
  if (review.mostly_paraphrase) reasons.push("mostly a paraphrase");
  if (contentWords < 300) reasons.push("article too thin");
  if (contentWords > 1400) reasons.push("article insufficiently concise");

  const duplicate = recentArticles.some((recent) =>
    headlinesAreSimilar(recent.title, article.title, 0.58) ||
    textSimilarity(`${recent.title} ${recent.summary ?? ""}`, `${article.title} ${article.summary}`) >= 0.62
  );
  if (duplicate) reasons.push("duplicate");

  const sourceOverlap = primary ? ngramOverlap(article.content, primary.text) : 1;
  if (sourceOverlap > 0.28) reasons.push("too close to source wording");

  if (!hasCompleteSourceAttribution(article.content, reliableSources)) reasons.push("incomplete source attribution");

  const sourceReliability = primary?.reliability ?? 0;
  const sourceDepth = clampScore(
    Math.min(85, sources.reduce((total, source) => total + wordCount(source.text), 0) / 5) +
    Math.min(15, (reliableSources.length - 1) * 8)
  );
  const lexicalOriginality = clampScore(100 - sourceOverlap * 180);
  const deterministicHeadline = headlineScore(article.title);

  const score = clampScore(
    sourceReliability * 0.15 +
    sourceDepth * 0.12 +
    review.factual_completeness * 0.16 +
    Math.min(review.originality, lexicalOriginality) * 0.15 +
    review.usefulness * 0.14 +
    review.meaningful_context * 0.10 +
    Math.min(review.headline_quality, deterministicHeadline) * 0.08 +
    review.added_value * 0.10
  );

  if (score < QUALITY_THRESHOLD) reasons.push("quality score too low");

  return {
    accepted: reasons.length === 0,
    score,
    reasons: [...new Set(reasons.map((reason) => reason.trim()).filter(Boolean))],
  };
}
