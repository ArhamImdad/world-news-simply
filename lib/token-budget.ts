import type { ProviderUsageEvent } from "@/lib/provider-runtime";

type DailyUsage = { day: string; knownTokens: number; unknownEstimatedTokens: number; attemptIds: Set<string> };
let processDailyUsage: DailyUsage = { day: "", knownTokens: 0, unknownEstimatedTokens: 0, attemptIds: new Set() };

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function refreshDay() {
  if (processDailyUsage.day !== today()) {
    processDailyUsage = { day: today(), knownTokens: 0, unknownEstimatedTokens: 0, attemptIds: new Set() };
  }
}

export function tokenBudgetConfig() {
  return {
    runBudget: boundedInteger("GROQ_RUN_TOKEN_BUDGET", 45_000, 2_000, 200_000),
    dailyBudget: boundedInteger("GROQ_DAILY_TOKEN_BUDGET", 180_000, 10_000, 200_000),
    reportedDailyUsed: boundedInteger("GROQ_DAILY_TOKENS_USED", 0, 0, 200_000),
  };
}

export function recordTokenUsage(events: ProviderUsageEvent[]) {
  refreshDay();
  for (const event of events) {
    if (processDailyUsage.attemptIds.has(event.attemptId)) continue;
    processDailyUsage.attemptIds.add(event.attemptId);
    if (event.usage.status === "known") processDailyUsage.knownTokens += event.usage.totalTokens;
    else processDailyUsage.unknownEstimatedTokens += event.reservedTokens;
  }
}

export function observeProviderQuotaError(error: unknown) {
  if (!(error instanceof Error)) return;
  const match = error.message.match(/tokens per day[\s\S]*?Limit\s+(\d+),\s+Used\s+(\d+)/i);
  if (!match) return;
  refreshDay();
  const used = Number.parseInt(match[2], 10);
  if (Number.isFinite(used)) processDailyUsage.knownTokens = Math.max(processDailyUsage.knownTokens, used);
}

export function currentTokenBudgetUsage(runTokens: number) {
  refreshDay();
  const config = tokenBudgetConfig();
  const knownDailyUsed = Math.max(config.reportedDailyUsed, processDailyUsage.knownTokens);
  const unknownDailyEstimated = processDailyUsage.unknownEstimatedTokens;
  const dailyUsed = knownDailyUsed + unknownDailyEstimated;
  return {
    runTokens,
    dailyUsed,
    knownDailyUsed,
    unknownDailyEstimated,
    runRemaining: Math.max(0, config.runBudget - runTokens),
    dailyRemaining: Math.max(0, config.dailyBudget - dailyUsed),
    config,
  };
}

export function maySpendTokens(runTokens: number, estimatedCandidateTokens: number) {
  const usage = currentTokenBudgetUsage(runTokens);
  return usage.runRemaining >= estimatedCandidateTokens && usage.dailyRemaining >= estimatedCandidateTokens;
}

export function estimateCandidateTokens(evidenceCharacters: number, allowRevision = true) {
  const evidenceTokens = Math.ceil(evidenceCharacters / 4);
  const generation = evidenceTokens + 2_200;
  const audit = evidenceTokens + 2_000;
  const revision = allowRevision ? evidenceTokens + 3_000 : 0;
  const revisionAudit = allowRevision ? evidenceTokens + 2_000 : 0;
  return generation + audit + revision + revisionAudit;
}
