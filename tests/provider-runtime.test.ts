import { describe, expect, it, vi } from "vitest";
import {
  executeAccountedProviderAttempt,
  isTpdExhaustion,
  parseProviderRateLimit,
  ProviderAttemptLedger,
  ProviderBudgetExceededError,
  ProviderRequestBudget,
  ProviderTokenPacer,
  retryDelayFrom,
  type ProviderAttemptRecord,
  type ProviderOperation,
} from "@/lib/provider-runtime";

function runtime(runLimit = 50_000, dailyRemaining = 100_000) {
  return {
    runId: "test-run-id",
    budget: new ProviderRequestBudget(runLimit, dailyRemaining),
    pacer: new ProviderTokenPacer(120_000, async () => undefined),
    ledger: new ProviderAttemptLedger(),
  };
}

function completion(totalTokens: number) {
  return {
    usage: {
      prompt_tokens: Math.floor(totalTokens * 0.7),
      completion_tokens: totalTokens - Math.floor(totalTokens * 0.7),
      total_tokens: totalTokens,
    },
    payload: "valid",
  };
}

async function accounted(operation: ProviderOperation, attemptId: string, totalTokens: number,
  state = runtime()) {
  return executeAccountedProviderAttempt({
    operation,
    attemptId,
    estimatedTokens: totalTokens + 500,
    ...state,
    request: async () => ({ data: completion(totalTokens) }),
    validate: (value) => value.payload,
  });
}

function record(attemptId: string, totalTokens: number): ProviderAttemptRecord {
  return {
    attemptId,
    runId: "test-run-id",
    operation: "generation",
    providerOutcome: "success",
    applicationOutcome: "success",
    usage: { status: "known", inputTokens: totalTokens, outputTokens: 0, totalTokens },
    reservedTokens: totalTokens,
    requestId: null,
    failureKind: "none",
    startedAt: "2026-08-24T00:00:00.000Z",
    endedAt: "2026-08-24T00:00:01.000Z",
    httpStatus: 200,
    providerErrorType: null,
    providerErrorCode: null,
    retryOfAttemptId: null,
    retryKind: null,
    retryWaitMs: 0,
    proactivePacingWaitMs: 0,
    rateLimit: { tokenLimit: null, remainingTokens: null, resetTokensMs: null, retryAfterMs: null },
    promptRawEvidenceIds: null,
    contractDiagnostics: [],
    reservationReconciled: true,
    ledgerKnownTotalAfterAttempt: totalTokens,
  };
}

describe("exactly-once provider accounting", () => {
  it.each(["generation", "audit", "revision", "revision-audit"] as const)("counts %s once", async (operation) => {
    const state = runtime();
    await accounted(operation, `attempt-${operation}`, 1_250, state);
    expect(state.ledger.knownTotal()).toBe(1_250);
    expect(state.ledger.records()).toHaveLength(1);
  });

  it("reproduces and fixes the Phase 2 7,000-token validation-failure defect", async () => {
    const state = runtime();
    const recorded = vi.fn();
    await expect(executeAccountedProviderAttempt({
      operation: "generation",
      attemptId: "phase-2-7000",
      estimatedTokens: 7_500,
      ...state,
      recorder: recorded,
      request: async () => ({ data: completion(7_000) }),
      validate: () => { throw new Error("Groq response omitted content."); },
    })).rejects.toThrow("omitted content");

    expect(state.ledger.knownTotal()).toBe(7_000);
    expect(recorded).toHaveBeenCalledTimes(1);
    expect(state.ledger.records()[0]).toMatchObject({
      providerOutcome: "success",
      applicationOutcome: "failure",
      failureKind: "application-validation",
      usage: { status: "known", totalTokens: 7_000 },
    });
  });

  it("retains only explicitly supplied sanitized application diagnostics", async () => {
    const state = runtime();
    await expect(executeAccountedProviderAttempt({
      operation: "revision", attemptId: "diagnostic", estimatedTokens: 2_000, ...state,
      promptRawEvidenceIds: 0,
      applicationDiagnostics: () => [{
        schemaVersion: "provider-contract-diagnostic-v1", errorCode: "exposed-evidence-reference",
        fieldPath: "$.content", offendingPattern: "[S1F1]", sanitizedContext: "Supported fact [S1F1] remains.",
        matchedInternalEvidenceIdentifier: "S1F1", bracketed: true, evidenceIdKnown: true, location: "body",
        recoverability: "recoverable", repairApplied: true, repairOutcome: "passed", postRepairValidatorResult: "passed",
      }],
      request: async () => ({ data: completion(1_200) }), validate: () => { throw new Error("invalid"); },
    })).rejects.toThrow("invalid");
    expect(state.ledger.records()[0]).toMatchObject({ promptRawEvidenceIds: 0,
      contractDiagnostics: [{ schemaVersion: "provider-contract-diagnostic-v1", fieldPath: "$.content" }] });
  });

  it("counts reported retry usage separately while deduplicating the same attempt ID", async () => {
    const state = runtime();
    await accounted("generation", "retry-1", 600, state);
    await accounted("generation", "retry-2", 700, state);
    expect(state.ledger.record(record("retry-2", 700))).toBe(false);
    expect(state.ledger.knownTotal()).toBe(1_300);
  });

  it("records HTTP failure without usage as unknown rather than fabricated zero", async () => {
    const state = runtime();
    await expect(executeAccountedProviderAttempt({
      operation: "audit",
      attemptId: "http-failure",
      estimatedTokens: 2_000,
      ...state,
      request: async () => { throw Object.assign(new Error("timeout"), { status: 408 }); },
      validate: () => true,
    })).rejects.toThrow("timeout");
    expect(state.ledger.records()[0].usage).toEqual({ status: "unknown" });
    expect(state.ledger.knownTotal()).toBe(0);
    expect(state.budget.snapshot()).toMatchObject({ knownConsumed: 0, unknownEstimated: 2_000, reserved: 0 });
  });

  it("uses provider-reported usage even on a failed request", async () => {
    const state = runtime();
    const error = Object.assign(new Error("provider rejected completion"), {
      status: 500,
      usage: { prompt_tokens: 300, completion_tokens: 25, total_tokens: 325 },
    });
    await expect(executeAccountedProviderAttempt({
      operation: "audit", attemptId: "reported-failure", estimatedTokens: 1_000, ...state,
      request: async () => { throw error; }, validate: () => true,
    })).rejects.toThrow();
    expect(state.ledger.knownTotal()).toBe(325);
    expect(state.budget.snapshot()).toMatchObject({ knownConsumed: 325, unknownEstimated: 0, reserved: 0 });
  });

  it("reconciles reservations after success and prevents concurrent oversubscription", async () => {
    const budget = new ProviderRequestBudget(10_000, 10_000);
    budget.reserve("first", 6_000);
    expect(() => budget.reserve("second", 5_000)).toThrow(ProviderBudgetExceededError);
    budget.reconcile(record("first", 4_000));
    expect(budget.snapshot()).toMatchObject({ knownConsumed: 4_000, reserved: 0, runRemaining: 6_000 });
    expect(budget.reserve("third", 6_000)).toBe(6_000);
  });
});

describe("TPM scheduling and bounded retry policy", () => {
  it("parses Groq token reset and retry-after headers", () => {
    const headers = new Headers({
      "x-ratelimit-limit-tokens": "8000",
      "x-ratelimit-remaining-tokens": "1250",
      "x-ratelimit-reset-tokens": "1m30.5s",
      "retry-after": "12.25",
    });
    expect(parseProviderRateLimit(headers, 0)).toEqual({
      tokenLimit: 8_000,
      remainingTokens: 1_250,
      resetTokensMs: 90_500,
      retryAfterMs: 12_250,
    });
    expect(retryDelayFrom({ headers }, 750)).toBe(90_500);
  });

  it("waits for an observed reset before an expensive request", async () => {
    let now = 1_000;
    const waits: number[] = [];
    const pacer = new ProviderTokenPacer(10_000, async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    }, () => now);
    pacer.observe(new Headers({
      "x-ratelimit-limit-tokens": "8000",
      "x-ratelimit-remaining-tokens": "100",
      "x-ratelimit-reset-tokens": "2s",
    }));
    await pacer.schedule(2_000);
    expect(waits).toEqual([2_000]);
  });

  it("fails closed when provider timing exceeds the bounded wait", () => {
    const headers = new Headers({ "retry-after": "121" });
    expect(retryDelayFrom({ headers }, 750, 120_000)).toBeNull();
  });

  it("keeps TPD exhaustion terminal while allowing bounded TPM timing", () => {
    expect(isTpdExhaustion(Object.assign(new Error("tokens per day (TPD) exceeded"), { status: 429 }))).toBe(true);
    expect(isTpdExhaustion(Object.assign(new Error("tokens per minute exceeded"), { status: 429 }))).toBe(false);
    expect(retryDelayFrom({ headers: new Headers({ "retry-after": "3" }) }, 750)).toBe(3_000);
  });
});

describe("Phase 2 accounting simulation", () => {
  it("reduces 32,840 raw tokens to 25,840 exactly-once tokens without premature governor stop", () => {
    const actual = [3_853, 2_791, 3_475, 3_525, 3_536, 2_543, 3_447, 2_670];
    const oldRaw = [...actual, 3_475, 3_525];
    expect(oldRaw.reduce((sum, value) => sum + value, 0)).toBe(32_840);

    const ledger = new ProviderAttemptLedger();
    actual.forEach((tokens, index) => ledger.record(record(`phase2-${index}`, tokens)));
    ledger.record(record("phase2-2", 3_475));
    ledger.record(record("phase2-3", 3_525));
    expect(ledger.knownTotal()).toBe(25_840);

    const runBudget = 45_000;
    const nextBoundedEstimate = 15_000;
    expect(runBudget - 32_840).toBeLessThan(nextBoundedEstimate);
    expect(runBudget - ledger.knownTotal()).toBeGreaterThanOrEqual(nextBoundedEstimate);
  });
});
