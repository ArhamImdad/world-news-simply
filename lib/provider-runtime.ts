export type ProviderOperation = "generation" | "generation-repair" | "audit" |
  "revision" | "revision-repair" | "revision-audit";

export type KnownProviderUsage = {
  status: "known";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type UnknownProviderUsage = { status: "unknown" };
export type ProviderUsage = KnownProviderUsage | UnknownProviderUsage;

export type ProviderContractDiagnostic = {
  schemaVersion: "provider-contract-diagnostic-v1";
  errorCode: string;
  fieldPath: string | null;
  offendingPattern: string | null;
  sanitizedContext: string | null;
  matchedInternalEvidenceIdentifier: string | null;
  bracketed: boolean | null;
  evidenceIdKnown: boolean | null;
  location: "headline" | "body" | "metadata" | null;
  recoverability: "recoverable" | "terminal" | "not-applicable";
  repairApplied: boolean;
  repairOutcome: "passed" | "failed" | "not-attempted";
  postRepairValidatorResult: "passed" | "failed" | "not-run";
};

export type ProviderAttemptRecord = {
  attemptId: string;
  runId: string;
  operation: ProviderOperation;
  providerOutcome: "success" | "failure";
  applicationOutcome: "success" | "failure" | "not-run";
  usage: ProviderUsage;
  reservedTokens: number;
  requestId: string | null;
  failureKind: "none" | "provider" | "application-validation";
  startedAt: string;
  endedAt: string;
  httpStatus: number | null;
  providerErrorType: string | null;
  providerErrorCode: string | null;
  retryOfAttemptId: string | null;
  retryKind: "provider" | "format-repair" | null;
  retryWaitMs: number;
  proactivePacingWaitMs: number;
  rateLimit: ProviderRateLimit;
  /** Present on v4 attempts created after provider-contract diagnostic instrumentation. */
  promptRawEvidenceIds?: number | null;
  contractDiagnostics?: ProviderContractDiagnostic[];
  reservationReconciled: boolean;
  ledgerKnownTotalAfterAttempt: number;
};

export type ProviderRuntime = {
  runId: string;
  budget: ProviderRequestBudget;
  pacer: ProviderTokenPacer;
  ledger: ProviderAttemptLedger;
  beforeRequest?: () => Promise<void>;
};

export type ProviderUsageEvent = ProviderAttemptRecord & {
  candidateTelemetryId: string;
  candidateHash: string;
  revisionRequired: boolean;
  finalDisposition: string;
};

type UsageShape = {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
};

function nonNegativeInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

export function providerUsageFrom(value: unknown): ProviderUsage {
  const candidate = value as {
    usage?: UsageShape | null;
    body?: { usage?: UsageShape | null };
    error?: { usage?: UsageShape | null };
  } | null;
  const usage = candidate?.usage ?? candidate?.body?.usage ?? candidate?.error?.usage;
  if (!usage) return { status: "unknown" };
  const inputTokens = nonNegativeInteger(usage.prompt_tokens);
  const outputTokens = nonNegativeInteger(usage.completion_tokens);
  const reportedTotal = nonNegativeInteger(usage.total_tokens);
  if (inputTokens === null || outputTokens === null) return { status: "unknown" };
  return {
    status: "known",
    inputTokens,
    outputTokens,
    totalTokens: reportedTotal ?? inputTokens + outputTokens,
  };
}

export function knownTokens(record: Pick<ProviderAttemptRecord, "usage">) {
  return record.usage.status === "known" ? record.usage.totalTokens : 0;
}

export class ProviderAttemptLedger {
  private readonly recordsById = new Map<string, ProviderAttemptRecord>();

  record(record: ProviderAttemptRecord) {
    if (this.recordsById.has(record.attemptId)) return false;
    this.recordsById.set(record.attemptId, structuredClone(record));
    return true;
  }

  records() {
    return [...this.recordsById.values()].map((record) => structuredClone(record));
  }

  knownTotal() {
    return this.records().reduce((total, record) => total + knownTokens(record), 0);
  }

  unknownAttempts() {
    return this.records().filter((record) => record.usage.status === "unknown").length;
  }
}

export class ProviderBudgetExceededError extends Error {
  constructor(message = "Provider request would exceed the configured token budget.") {
    super(message);
    this.name = "ProviderBudgetExceededError";
  }
}

export class ProviderRequestBudget {
  private readonly reservations = new Map<string, number>();
  private readonly reconciledAttempts = new Set<string>();
  private knownConsumed = 0;
  private unknownEstimated = 0;

  constructor(private readonly runLimit: number, private readonly dailyRemaining: number) {}

  reserve(attemptId: string, estimatedTokens: number) {
    const estimate = Math.max(1, Math.ceil(estimatedTokens));
    if (this.reservations.has(attemptId) || this.reconciledAttempts.has(attemptId)) {
      throw new Error(`Duplicate provider attempt ID: ${attemptId}`);
    }
    const committed = this.knownConsumed + this.unknownEstimated + this.reservedTokens();
    if (committed + estimate > this.runLimit || committed + estimate > this.dailyRemaining) {
      throw new ProviderBudgetExceededError();
    }
    this.reservations.set(attemptId, estimate);
    return estimate;
  }

  cancel(attemptId: string) {
    this.reservations.delete(attemptId);
  }

  reconcile(record: ProviderAttemptRecord) {
    if (this.reconciledAttempts.has(record.attemptId)) return false;
    const reserved = this.reservations.get(record.attemptId) ?? record.reservedTokens;
    this.reservations.delete(record.attemptId);
    this.reconciledAttempts.add(record.attemptId);
    if (record.usage.status === "known") this.knownConsumed += record.usage.totalTokens;
    else this.unknownEstimated += reserved;
    return true;
  }

  snapshot() {
    const reserved = this.reservedTokens();
    const committed = this.knownConsumed + this.unknownEstimated + reserved;
    return {
      knownConsumed: this.knownConsumed,
      unknownEstimated: this.unknownEstimated,
      reserved,
      committed,
      runRemaining: Math.max(0, this.runLimit - committed),
      dailyRemaining: Math.max(0, this.dailyRemaining - committed),
    };
  }

  private reservedTokens() {
    return [...this.reservations.values()].reduce((total, value) => total + value, 0);
  }
}

export type HeaderReader = { get(name: string): string | null };

function durationMilliseconds(value: string | null) {
  if (!value) return null;
  const numericSeconds = Number(value);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) return Math.ceil(numericSeconds * 1_000);
  const matches = [...value.trim().matchAll(/([\d.]+)\s*(ms|s|m|h)/gi)];
  if (!matches.length) return null;
  const multipliers: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };
  return Math.ceil(matches.reduce((total, match) => total + Number(match[1]) * multipliers[match[2].toLowerCase()], 0));
}

export function estimatedRequestTokens(prompt: string, maximumOutputTokens: number) {
  return Math.max(1, Math.ceil(prompt.length / 4) + maximumOutputTokens);
}

export type ProviderRateLimit = {
  tokenLimit: number | null;
  remainingTokens: number | null;
  resetTokensMs: number | null;
  retryAfterMs: number | null;
};

export function parseProviderRateLimit(headers?: HeaderReader | null, now = Date.now()): ProviderRateLimit {
  const integer = (name: string) => {
    const parsed = Number.parseInt(headers?.get(name) ?? "", 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const retryValue = headers?.get("retry-after") ?? null;
  let retryAfterMs = durationMilliseconds(retryValue);
  if (retryAfterMs === null && retryValue) {
    const date = Date.parse(retryValue);
    if (Number.isFinite(date)) retryAfterMs = Math.max(0, date - now);
  }
  return {
    tokenLimit: integer("x-ratelimit-limit-tokens"),
    remainingTokens: integer("x-ratelimit-remaining-tokens"),
    resetTokensMs: durationMilliseconds(headers?.get("x-ratelimit-reset-tokens") ?? null),
    retryAfterMs,
  };
}

export class ProviderPacingDeferredError extends Error {
  constructor(message = "Provider token capacity is unavailable within the bounded wait policy.") {
    super(message);
    this.name = "ProviderPacingDeferredError";
  }
}

export class ProviderTokenPacer {
  private tokenLimit: number | null = null;
  private remainingTokens: number | null = null;
  private resetAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly maximumWaitMs = 120_000,
    private readonly wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly now: () => number = Date.now
  ) {}

  observe(headers?: HeaderReader | null) {
    const parsed = parseProviderRateLimit(headers, this.now());
    if (parsed.tokenLimit !== null) this.tokenLimit = parsed.tokenLimit;
    if (parsed.remainingTokens !== null) this.remainingTokens = parsed.remainingTokens;
    const waitMs = Math.max(parsed.resetTokensMs ?? 0, parsed.retryAfterMs ?? 0);
    if (waitMs > 0) this.resetAt = this.now() + waitMs;
    return parsed;
  }

  schedule(estimatedTokens: number) {
    const scheduled = this.queue.then(() => this.scheduleInternal(Math.max(1, Math.ceil(estimatedTokens))));
    this.queue = scheduled.catch(() => undefined);
    return scheduled;
  }

  private async scheduleInternal(estimatedTokens: number) {
    let waitedMs = 0;
    let remainingTokens = this.remainingTokens;
    if (remainingTokens === null) return waitedMs;
    if (this.resetAt > 0 && this.now() >= this.resetAt) {
      this.remainingTokens = this.tokenLimit;
      remainingTokens = this.remainingTokens;
      this.resetAt = 0;
    }
    if (remainingTokens === null || remainingTokens < estimatedTokens) {
      const delay = Math.max(0, this.resetAt - this.now());
      if (delay <= 0 || delay > this.maximumWaitMs) throw new ProviderPacingDeferredError();
      await this.wait(delay);
      waitedMs += delay;
      this.remainingTokens = this.tokenLimit;
      this.resetAt = 0;
    }
    if (this.remainingTokens !== null) this.remainingTokens = Math.max(0, this.remainingTokens - estimatedTokens);
    return waitedMs;
  }
}

export function retryDelayFrom(error: unknown, fallbackMs: number, maximumWaitMs = 120_000) {
  const candidate = error as { headers?: HeaderReader; message?: string };
  const parsed = parseProviderRateLimit(candidate?.headers);
  const messageMs = durationMilliseconds(candidate?.message?.match(/try again in ([\d.]+(?:ms|s|m|h))/i)?.[1] ?? null) ?? 0;
  const delay = Math.max(fallbackMs, parsed.retryAfterMs ?? 0, parsed.resetTokensMs ?? 0, messageMs);
  return delay <= maximumWaitMs ? delay : null;
}

export function isTpdExhaustion(error: unknown) {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status) : 0;
  return status === 429 && /tokens per day|\bTPD\b/i.test(error instanceof Error ? error.message : "");
}

type ProviderResponse<T> = { data: T; headers?: HeaderReader | null; requestId?: string | null };

export async function executeAccountedProviderAttempt<TProvider, TResult>(options: {
  runId: string;
  operation: ProviderOperation;
  estimatedTokens: number;
  budget: ProviderRequestBudget;
  pacer: ProviderTokenPacer;
  ledger: ProviderAttemptLedger;
  beforeRequest?: () => Promise<void>;
  recorder?: (record: ProviderAttemptRecord) => void;
  request: () => Promise<ProviderResponse<TProvider>>;
  validate: (providerValue: TProvider) => TResult;
  attemptId?: string;
  retryOfAttemptId?: string | null;
  retryKind?: "provider" | "format-repair" | null;
  retryWaitMs?: number;
  promptRawEvidenceIds?: number | null;
  applicationDiagnostics?: (error: unknown) => ProviderContractDiagnostic[];
}) {
  const attemptId = options.attemptId ?? crypto.randomUUID();
  await options.beforeRequest?.();
  const reservedTokens = options.budget.reserve(attemptId, options.estimatedTokens);
  let providerValue: TProvider | undefined;
  let providerOutcome: ProviderAttemptRecord["providerOutcome"] = "failure";
  let applicationOutcome: ProviderAttemptRecord["applicationOutcome"] = "not-run";
  let requestId: string | null = null;
  let caught: unknown;
  let requestStarted = false;
  let startedAt = "";
  let endedAt = "";
  let proactivePacingWaitMs = 0;
  let observedRateLimit: ProviderRateLimit = {
    tokenLimit: null, remainingTokens: null, resetTokensMs: null, retryAfterMs: null,
  };
  try {
    proactivePacingWaitMs = await options.pacer.schedule(reservedTokens);
    await options.beforeRequest?.();
    requestStarted = true;
    startedAt = new Date().toISOString();
    const response = await options.request();
    endedAt = new Date().toISOString();
    providerValue = response.data;
    providerOutcome = "success";
    requestId = response.requestId ?? null;
    observedRateLimit = options.pacer.observe(response.headers);
    try {
      const result = options.validate(response.data);
      applicationOutcome = "success";
      return result;
    } catch (error) {
      applicationOutcome = "failure";
      throw error;
    }
  } catch (error) {
    caught = error;
    endedAt = new Date().toISOString();
    const headers = (error as { headers?: HeaderReader })?.headers;
    if (providerOutcome === "failure") observedRateLimit = options.pacer.observe(headers);
    throw error;
  } finally {
    if (!requestStarted || caught instanceof ProviderBudgetExceededError || caught instanceof ProviderPacingDeferredError) {
      options.budget.cancel(attemptId);
    } else {
      const usage = providerUsageFrom(providerValue === undefined ? caught : providerValue);
      const status = typeof caught === "object" && caught !== null && "status" in caught
        ? Number((caught as { status?: unknown }).status) : providerOutcome === "success" ? 200 : 0;
      const errorCode = typeof caught === "object" && caught !== null && "code" in caught
        ? String((caught as { code?: unknown }).code).slice(0, 80) : null;
      const ledgerKnownTotalAfterAttempt = options.ledger.knownTotal() +
        (usage.status === "known" ? usage.totalTokens : 0);
      const record: ProviderAttemptRecord = {
        attemptId,
        runId: options.runId,
        operation: options.operation,
        providerOutcome,
        applicationOutcome,
        usage,
        reservedTokens,
        requestId,
        failureKind: providerOutcome === "failure" ? "provider"
          : caught !== undefined ? "application-validation" : "none",
        startedAt: startedAt || endedAt,
        endedAt,
        httpStatus: Number.isFinite(status) && status > 0 ? status : null,
        providerErrorType: caught instanceof Error ? caught.name.slice(0, 80) : null,
        providerErrorCode: isTpdExhaustion(caught) ? "tokens-per-day" : errorCode,
        retryOfAttemptId: options.retryOfAttemptId ?? null,
        retryKind: options.retryKind ?? null,
        retryWaitMs: Math.max(0, options.retryWaitMs ?? 0),
        proactivePacingWaitMs,
        rateLimit: observedRateLimit,
        promptRawEvidenceIds: options.promptRawEvidenceIds ?? null,
        contractDiagnostics: options.applicationDiagnostics?.(caught) ?? [],
        reservationReconciled: true,
        ledgerKnownTotalAfterAttempt,
      };
      if (options.ledger.record(record)) {
        options.budget.reconcile(record);
        options.recorder?.(record);
      }
    }
  }
}
