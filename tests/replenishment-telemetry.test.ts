import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  candidateTelemetryIdFor,
  classifyResolutionAndPairing,
  readReplenishmentTelemetry,
  reconcileProviderAccounting,
  ReplenishmentTelemetryRecorder,
  reportFromReplenishmentTelemetry,
  validateSupplyCompositionTelemetry,
  validateCandidateFunnelEvents,
  validateFunnelTelemetry,
  validateReplenishmentTelemetry,
  type ReplenishmentRunTelemetry,
} from "@/lib/replenishment-telemetry";
import type { ProviderUsageEvent } from "@/lib/provider-runtime";
import { createReserveFillControl } from "@/lib/reserve-fill-control";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const occasionalSupply = {
  supplyClass: "OCCASIONAL_CURRENT" as const, releaseSeriesId: null, normalizedPeriod: null,
  canonicalSeriesPeriodIdentity: null, recurringCadence: null, publisherRoots: ["source.test"], category: "test",
  discoverySourceId: "source", preparationKey: null, releasePublicationDates: [],
  nextExpectedCadenceClassification: null,
};

const readyDetails = {
  ...occasionalSupply, title: "Test article", category: "test", sourcePair: ["one", "two"],
  primarySource: "one", preGroqScore: 95, factualCompleteness: 95, originality: 95, usefulness: 95,
  meaningfulContext: 95, headlineQuality: 95, addedValue: 95, mostlyParaphrase: false, claimsSupported: true,
  speculativeOrInvented: false, inventedQuotes: false, inventedStatistics: false,
  deterministicOriginality: { accepted: true, fiveWordOverlap: 0, maximumSentenceSimilarity: 0,
    headlineSimilarity: 0, sourceOrderSimilarity: 0, reasons: [] },
  preparedAt: "2026-08-24T00:00:00.000Z", expiresAt: "2026-08-25T00:00:00.000Z",
};

function recorder(runId = "run-telemetry") {
  const directory = mkdtempSync(join(tmpdir(), "replenishment-telemetry-"));
  directories.push(directory);
  return new ReplenishmentTelemetryRecorder({ runId, projectRef: "staging-test", environment: "local-test",
    path: join(directory, `${runId}.json`), startedAt: "2026-08-24T00:00:00.000Z" });
}

function attempt(index: number, operation: ProviderUsageEvent["operation"] = "generation",
  usage: ProviderUsageEvent["usage"] = { status: "known", inputTokens: 80, outputTokens: 20, totalTokens: 100 },
  candidateTelemetryId = "run-telemetry:candidate:1"): ProviderUsageEvent {
  return { attemptId: `attempt-${index}`, runId: "run-telemetry", operation, providerOutcome: "success",
    applicationOutcome: "success", usage, reservedTokens: 150, requestId: null, failureKind: "none",
    startedAt: `2026-08-24T00:00:0${index}.000Z`, endedAt: `2026-08-24T00:00:0${index}.500Z`,
    httpStatus: 200, providerErrorType: null, providerErrorCode: null,
    retryOfAttemptId: index > 1 ? `attempt-${index - 1}` : null, retryKind: index > 1 ? "provider" : null,
    retryWaitMs: index > 1 ? 750 : 0, proactivePacingWaitMs: index === 1 ? 500 : 0,
    rateLimit: { tokenLimit: 8_000, remainingTokens: 7_000, resetTokensMs: 1_000, retryAfterMs: null },
    reservationReconciled: true, ledgerKnownTotalAfterAttempt: usage.status === "known" ? index * 100 : (index - 1) * 100,
    candidateTelemetryId, candidateHash: "candidate", revisionRequired: operation.includes("revision"), finalDisposition: "ready" };
}

function addRunEvidence(value: ReplenishmentTelemetryRecorder) {
  const observer = value.leaseObserver();
  observer.acquisitionAttempted?.("2026-08-24T00:00:00.000Z");
  observer.acquired?.("run-telemetry", "2026-08-24T00:00:00.010Z");
  observer.ownershipAttempt?.({ attempt: 1, startedAt: "2026-08-24T00:00:00.010Z",
    endedAt: "2026-08-24T00:00:00.020Z", latencyMs: 10, outcome: "TRUE",
    retryPerformed: false, retryReason: null });
  observer.ownershipChecked?.(true, "2026-08-24T00:00:00.020Z");
  observer.heartbeat?.(true, "2026-08-24T00:01:00.000Z");
  observer.releaseAttempted?.("2026-08-24T00:01:01.000Z");
  observer.released?.(true, "2026-08-24T00:01:01.010Z");
  value.recordQueue({ phase: "starting", observedAt: "2026-08-24T00:00:00.000Z", readyDepth: 0,
    totalRows: 0, approvedCount: 0, publicationSlotCount: 0 });
  value.recordQueue({ phase: "ending", observedAt: "2026-08-24T00:01:01.000Z", readyDepth: 0,
    totalRows: 0, approvedCount: 0, publicationSlotCount: 0 });
  value.recordRls({ phase: "ending", observedAt: "2026-08-24T00:01:01.000Z", required: true,
    anonVisibleReady: 0, authenticatedVisibleReady: 0, serviceReady: 0, temporaryAuthUserRef: "sanitized-user",
    temporaryAuthUserDeleted: true, errorCode: null });
}

function addCandidate(value: ReplenishmentTelemetryRecorder, rank: number, disposition = "rejected:source-preflight",
  reasonCodes = ["thin source"], candidateHash: string | null = null, providerWorkStarted = false) {
  const candidateTelemetryId = candidateTelemetryIdFor("run-telemetry", rank);
  value.considerCandidate({ candidateTelemetryId, deterministicRank: rank,
    discoveredIdentity: { topic: `topic-${rank}`, sourceUrl: `https://source-${rank}.test/item` },
    sourceHints: [`source-${rank}`], consideredAt: `2026-08-24T00:00:${rank.toString().padStart(2, "0")}.000Z`,
    ...occasionalSupply, discoverySourceId: `source-${rank}` });
  value.recordCandidate({ candidateTelemetryId, candidateHash, sourcePair: ["one"], sourceDomains: ["one.test"],
    sourcePreflightResults: { passed: disposition !== "rejected:source-preflight", reasons: [...reasonCodes] },
    evidenceResults: disposition === "rejected:evidence" ? { passed: false, reasons: [...reasonCodes] } : null,
    synthesisResult: disposition === "rejected:synthesis" ? { passed: false, score: 60, reasons: [...reasonCodes] } : null,
    duplicateResult: { duplicate: disposition === "rejected:duplicate", reasons: [...reasonCodes] },
    preGroqScore: null, synthesisScore: null, disposition, reasonCodes, duplicateIdentity: disposition === "rejected:duplicate",
    providerWorkStarted, endedAt: "2026-08-24T00:01:00.000Z", durationMs: 1_000 });
  return candidateTelemetryId;
}

function validSnapshot(withCandidate = true) {
  const value = recorder();
  addRunEvidence(value);
  if (withCandidate) {
    addCandidate(value, 1);
    value.recordFunnel([{ funnelIdentity: "discovery:1", discoveryRank: 1, discoverySourceId: "source-1",
      sourceUrl: "https://source-1.test/item", sourceHints: ["source-1"], rawDiscovered: true,
      resolution: "qualified", pairing: "qualified", preflight: "rejected", evidence: "not-assessed",
      duplicate: "not-assessed", ranking: "not-assessed", finalStage: "source-preflight", reasonCodes: ["thin source"] }]);
  }
  return value.finalize("completed", "done");
}

describe("candidate telemetry v2 identity and completeness", () => {
  it("creates identity before candidateHash and attaches the hash without changing identity", () => {
    const value = recorder();
    const id = candidateTelemetryIdFor("run-telemetry", 1);
    value.considerCandidate({ candidateTelemetryId: id, deterministicRank: 1,
      discoveredIdentity: { topic: "topic", sourceUrl: null }, sourceHints: ["source"], consideredAt: "now",
      ...occasionalSupply });
    expect(value.snapshot().candidates[0]).toMatchObject({ candidateTelemetryId: id, candidateHash: null });
    value.recordCandidate({ candidateTelemetryId: id, candidateHash: "later-hash" });
    expect(value.snapshot().candidates[0]).toMatchObject({ candidateTelemetryId: id, candidateHash: "later-hash" });
  });

  it("gives two hashless candidates distinct IDs and rejects sentinel keys", () => {
    const value = recorder();
    addCandidate(value, 1);
    addCandidate(value, 2);
    expect(new Set(value.snapshot().candidates.map((candidate) => candidate.candidateTelemetryId)).size).toBe(2);
    expect(() => value.considerCandidate({ candidateTelemetryId: "unavailable", deterministicRank: 3,
      discoveredIdentity: { topic: null, sourceUrl: null }, sourceHints: [], consideredAt: "now",
      ...occasionalSupply })).toThrow();
    expect(value.snapshot().candidateSequence.overwriteAttempts).toBe(1);
  });

  it("reproduces the 18-to-7 sentinel collision and retains all 18 with v2 IDs", () => {
    const old = new Map<string, number>();
    for (let rank = 1; rank <= 18; rank += 1) old.set(rank <= 12 ? "unavailable" : `hash-${rank}`, rank);
    expect(old.size).toBe(7);
    const value = recorder();
    for (let rank = 1; rank <= 18; rank += 1) addCandidate(value, rank,
      rank % 4 === 0 ? "deferred:token-budget" : "rejected:evidence", ["fixture"], rank % 3 === 0 ? `hash-${rank}` : null);
    expect(value.snapshot()).toMatchObject({ candidateSequence: { consideredCount: 18, highestDeterministicRank: 18 } });
    expect(value.snapshot().candidates).toHaveLength(18);
  });

  it.each(["rejected:source-preflight", "rejected:evidence", "rejected:duplicate", "deferred:token-budget"])(
    "retains the final %s lifecycle record", (disposition) => {
      const value = recorder();
      addCandidate(value, 1, disposition);
      expect(value.snapshot().candidates[0].disposition).toBe(disposition);
    });

  it("reconstructs exact dispositions separately from reason occurrences", () => {
    const value = recorder();
    addCandidate(value, 1, "rejected:source-preflight", ["independent domains", "thin source"]);
    addCandidate(value, 2, "rejected:source-preflight", ["thin source"]);
    addCandidate(value, 3, "rejected:duplicate", ["duplicate"]);
    const report = reportFromReplenishmentTelemetry(value.snapshot());
    expect(report).toMatchObject({ consideredCandidates: 3, sourcePreflightRejectedCandidates: 2,
      dispositionCounts: { "rejected:source-preflight": 2, "rejected:duplicate": 1 },
      reasonOccurrenceCounts: { "independent domains": 1, "thin source": 2, duplicate: 1 }, reasonOccurrences: 4 });
  });

  it("passes a complete valid v2 sample", () => {
    expect(validateReplenishmentTelemetry(validSnapshot())).toEqual({ valid: true,
      classification: "AUTHORITATIVE_COMPLETE_SAMPLE", reasons: [] });
  });

  it("keeps v2 accounting-readable while marking supply composition insufficient", () => {
    const telemetry = validSnapshot();
    telemetry.schemaVersion = "replenishment-run-telemetry-v2";
    for (const field of ["supplyClass", "releaseSeriesId", "normalizedPeriod", "canonicalSeriesPeriodIdentity",
      "recurringCadence", "publisherRoots", "category", "discoverySourceId", "preparationKey",
      "releasePublicationDates", "nextExpectedCadenceClassification"] as const) {
      delete (telemetry.candidates[0] as unknown as Record<string, unknown>)[field];
    }
    expect(validateReplenishmentTelemetry(telemetry)).toEqual({ valid: true,
      classification: "AUTHORITATIVE_COMPLETE_SAMPLE", reasons: [] });
    expect(validateSupplyCompositionTelemetry(telemetry)).toMatchObject({ valid: false, accountingReadable: true });
  });

  it("retains and validates recurring series-period telemetry in v3", () => {
    const telemetry = validSnapshot();
    Object.assign(telemetry.candidates[0], {
      supplyClass: "RECURRING_CURRENT", releaseSeriesId: "consumer-prices", normalizedPeriod: "2026-07",
      canonicalSeriesPeriodIdentity: "consumer-prices:2026-07", recurringCadence: "monthly",
      releasePublicationDates: ["2026-08-20T00:00:00.000Z"], nextExpectedCadenceClassification: "monthly",
    });
    expect(validateSupplyCompositionTelemetry(telemetry)).toEqual({ valid: true, accountingReadable: true, reasons: [] });
    delete (telemetry.candidates[0] as Partial<typeof telemetry.candidates[number]>).normalizedPeriod;
    expect(validateSupplyCompositionTelemetry(telemetry).reasons)
      .toContain("recurring candidate lacks mandatory series-period telemetry");
  });

  it("requires READY supply metadata to match its candidate lifecycle", () => {
    const telemetry = validSnapshot();
    const candidate = telemetry.candidates[0];
    telemetry.readyInsertions.push({ ...readyDetails, candidateTelemetryId: candidate.candidateTelemetryId,
      articleId: "article", candidateHash: "hash", runId: telemetry.run.runId, preparationKey: "key",
      duplicateIdentity: "identity", quality: 95, lifecycleState: "ready", publicationStatus: "draft",
      eligibilityRevalidationPassed: true, eligibilityFailures: [], enqueueResult: "INSERTED",
      insertedAt: "2026-08-24T00:01:00.000Z", attributedRunId: telemetry.run.runId });
    expect(validateSupplyCompositionTelemetry(telemetry).valid).toBe(true);
    telemetry.readyInsertions[0].supplyClass = "EVERGREEN";
    expect(validateSupplyCompositionTelemetry(telemetry).reasons)
      .toContain("READY supply classification differs from candidate telemetry");
  });

  it.each([
    ["missing record", (telemetry: ReplenishmentRunTelemetry) => { telemetry.candidates.splice(0, 1); }, "considered candidate count"],
    ["count mismatch", (telemetry: ReplenishmentRunTelemetry) => { telemetry.candidateSequence.consideredCount = 2; }, "considered candidate count"],
    ["rank gap", (telemetry: ReplenishmentRunTelemetry) => { telemetry.candidates[0].deterministicRank = 2; }, "missing or non-contiguous"],
    ["duplicate ID", (telemetry: ReplenishmentRunTelemetry) => { telemetry.candidates.push(structuredClone(telemetry.candidates[0])); }, "duplicate candidateTelemetryId"],
    ["duplicate rank", (telemetry: ReplenishmentRunTelemetry) => { const copy = structuredClone(telemetry.candidates[0]);
      copy.candidateTelemetryId = "run-telemetry:candidate:2"; telemetry.candidates.push(copy);
      telemetry.candidateSequence.consideredCount = 2; telemetry.candidateSequence.highestDeterministicRank = 2;
      telemetry.candidateSequence.candidateTelemetryIds.push(copy.candidateTelemetryId); }, "duplicate deterministic"],
    ["missing final disposition", (telemetry: ReplenishmentRunTelemetry) => { telemetry.candidates[0].disposition = "qualified"; }, "lacks final disposition"],
  ])("invalidates %s with an explicit reason", (_name, mutate, reason) => {
    const telemetry = validSnapshot();
    mutate(telemetry);
    const result = validateReplenishmentTelemetry(telemetry);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((entry) => entry.includes(reason))).toBe(true);
  });

  it("requires canonical provider and READY relations to known telemetry IDs", () => {
    const telemetry = validSnapshot();
    telemetry.providerAttempts.push(attempt(1, "generation", { status: "known", inputTokens: 80, outputTokens: 20, totalTokens: 100 }, "unknown-id"));
    telemetry.providerLedgerKnownTotal = 100;
    telemetry.readyInsertions.push({ ...readyDetails, candidateTelemetryId: "unknown-id", articleId: "article", candidateHash: "hash",
      runId: "run-telemetry", preparationKey: "key", duplicateIdentity: "identity", quality: 95,
      lifecycleState: "ready", publicationStatus: "draft",
      eligibilityRevalidationPassed: true, eligibilityFailures: [], enqueueResult: "INELIGIBLE", insertedAt: null,
      attributedRunId: "run-telemetry" });
    const result = validateReplenishmentTelemetry(telemetry);
    expect(result.reasons).toEqual(expect.arrayContaining([
      "provider attempt references unknown candidateTelemetryId", "READY attribution references unknown candidateTelemetryId"]));
  });

  it("proves a provider-started candidate has a telemetry-ID-linked attempt", () => {
    const value = recorder();
    addRunEvidence(value);
    const id = addCandidate(value, 1, "rejected:provider", ["provider failure"], "candidate", true);
    value.recordFunnel([{ funnelIdentity: "discovery:1", discoveryRank: 1, discoverySourceId: "source-1",
      sourceUrl: "https://source-1.test/item", sourceHints: ["source-1"], rawDiscovered: true,
      resolution: "qualified", pairing: "qualified", preflight: "qualified", evidence: "qualified",
      duplicate: "surviving", ranking: "selected", finalStage: "provider-selected", reasonCodes: [] }]);
    value.recordProviderAttempt(attempt(1, "generation", undefined, id));
    expect(validateReplenishmentTelemetry(value.finalize("completed", "done")).valid).toBe(true);
  });

  it("treats v1 as readable but conservatively invalid", () => {
    const telemetry = validSnapshot(false);
    telemetry.schemaVersion = "replenishment-run-telemetry-v1";
    const result = validateReplenishmentTelemetry(telemetry);
    expect(result).toMatchObject({ valid: false });
    expect(result.reasons).toContain("telemetry v1 candidate completeness cannot be proven");
    expect(reportFromReplenishmentTelemetry(telemetry).schemaVersion).toBe("replenishment-run-telemetry-v1");
  });
});

describe("existing provider, lease, process, RLS, and artifact telemetry", () => {
  it("persists the starting depth, fill target, deficit, enqueue count, target marker, and skipped work", () => {
    const value = recorder();
    const control = createReserveFillControl(7, 8);
    control.successfulEnqueues = 1;
    control.targetReachedAt = "run-telemetry:candidate:1";
    control.providerWorkSkippedAfterDeficitSatisfied = 1;
    control.finalObservedReadyDepth = 8;
    value.recordReserveControl(control);
    expect(value.snapshot().reserveControl).toEqual(control);
  });

  it.each([
    ["deficit", (telemetry: ReplenishmentRunTelemetry) => { telemetry.reserveControl!.initialDeficit = 7; }, "reserve deficit"],
    ["success count", (telemetry: ReplenishmentRunTelemetry) => { telemetry.reserveControl!.successfulEnqueues = 1; }, "successful enqueue"],
    ["final depth", (telemetry: ReplenishmentRunTelemetry) => { telemetry.reserveControl!.finalObservedReadyDepth = 1; }, "final reserve depth"],
    ["target identity", (telemetry: ReplenishmentRunTelemetry) => { telemetry.reserveControl!.targetReachedAt = "unknown"; }, "targetReachedAt"],
    ["skipped work", (telemetry: ReplenishmentRunTelemetry) => { telemetry.reserveControl!.providerWorkSkippedAfterDeficitSatisfied = 1; }, "provider work skipped"],
  ])("invalidates inconsistent reserve %s telemetry", (_name, mutate, reason) => {
    const telemetry = validSnapshot();
    telemetry.reserveControl = createReserveFillControl(0, 8);
    telemetry.reserveControl.finalObservedReadyDepth = 0;
    mutate(telemetry);
    expect(validateReplenishmentTelemetry(telemetry).reasons.some((entry) => entry.includes(reason))).toBe(true);
  });

  it("retains ownership latency, retry reason, and final outcome", () => {
    const value = recorder();
    const observer = value.leaseObserver();
    observer.ownershipAttempt?.({ attempt: 1, startedAt: "2026-08-24T00:00:00.000Z",
      endedAt: "2026-08-24T00:00:20.000Z", latencyMs: 20_000, outcome: "TRANSPORT_TIMEOUT",
      retryPerformed: true, retryReason: "TRANSPORT_TIMEOUT" });
    observer.ownershipAttempt?.({ attempt: 2, startedAt: "2026-08-24T00:00:20.250Z",
      endedAt: "2026-08-24T00:00:20.500Z", latencyMs: 250, outcome: "TRUE",
      retryPerformed: false, retryReason: null });
    expect(value.snapshot().lease).toMatchObject({ leaseOwnershipOutcome: "TRUE",
      ownershipAttempts: [{ outcome: "TRANSPORT_TIMEOUT", retryPerformed: true,
        retryReason: "TRANSPORT_TIMEOUT", latencyMs: 20_000 }, { outcome: "TRUE", latencyMs: 250 }] });
  });

  it("classifies a safely released transport-aborted run as integrity-valid but incomplete", () => {
    const value = recorder();
    addRunEvidence(value);
    const telemetry = value.snapshot();
    telemetry.lease.ownershipAttempts.push({ attempt: 2, startedAt: "2026-08-24T00:00:20.250Z",
      endedAt: "2026-08-24T00:00:40.250Z", latencyMs: 20_000, outcome: "TRANSPORT_TIMEOUT",
      retryPerformed: false, retryReason: null });
    telemetry.lease.leaseOwnershipOutcome = "TRANSPORT_TIMEOUT";
    telemetry.lease.ownershipIndeterminateAt = "2026-08-24T00:00:40.250Z";
    telemetry.queueObservations = telemetry.queueObservations.slice(0, 1);
    telemetry.run.finalStatus = "failed";
    expect(validateReplenishmentTelemetry(telemetry)).toMatchObject({ valid: false,
      classification: "RUN_INTEGRITY_VALID_BUT_INCOMPLETE" });
  });
  it("persists atomically without stdout and reconstructs artifact-only output", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const value = recorder();
    addRunEvidence(value);
    value.finalize("completed", "done");
    log.mockRestore();
    expect(readdirSync(join(value.path, "..")).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(reportFromReplenishmentTelemetry(readReplenishmentTelemetry(value.path)).accounting.invariantPassed).toBe(true);
  });

  it("retains six attempts and preserves exactly-once accounting and operation splits", () => {
    const value = recorder();
    const operations: ProviderUsageEvent["operation"][] = ["generation", "generation-repair", "audit", "revision", "revision-repair", "revision-audit"];
    operations.forEach((operation, index) => value.recordProviderAttempt(attempt(index + 1, operation)));
    const report = reportFromReplenishmentTelemetry(readReplenishmentTelemetry(value.path));
    expect(report.accounting.uniqueAttemptCount).toBe(6);
    expect(Object.values(report.operations)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(report.providerRetries).toBe(5);
  });

  it("reconciles known tokens once and rejects duplicate attempt IDs", () => {
    const value = recorder();
    value.recordProviderAttempt(attempt(1));
    const telemetry = value.snapshot();
    telemetry.providerAttempts.push(structuredClone(telemetry.providerAttempts[0]));
    expect(reconcileProviderAccounting(telemetry)).toMatchObject({ knownTokenTotal: 100,
      duplicateAttemptIds: ["attempt-1"], invariantPassed: false });
  });

  it("retains unknown usage and HTTP/TPM evidence", () => {
    const value = recorder();
    const event = attempt(1, "generation", { status: "unknown" });
    event.httpStatus = 429; event.providerOutcome = "failure"; event.providerErrorType = "RateLimitError";
    event.rateLimit.retryAfterMs = 2_000;
    value.recordProviderAttempt(event);
    expect(reconcileProviderAccounting(value.snapshot())).toMatchObject({ knownTokenTotal: 0,
      unknownAttemptCount: 1, unknownReservations: 150, budgetAccountedTotal: 150 });
    expect(readReplenishmentTelemetry(value.path).providerAttempts[0]).toMatchObject({ httpStatus: 429,
      providerErrorType: "RateLimitError", rateLimit: { tokenLimit: 8_000, retryAfterMs: 2_000 } });
  });

  it.each([
    ["lease loss", (telemetry: ReplenishmentRunTelemetry) => { telemetry.lease.leaseLostAt = "2026-08-24T00:00:30Z"; }],
    ["foreign provider", (telemetry: ReplenishmentRunTelemetry) => { telemetry.providerAttempts.push({ ...attempt(1), runId: "foreign" }); }],
    ["unexplained depth", (telemetry: ReplenishmentRunTelemetry) => { telemetry.queueObservations[1].readyDepth = 1; }],
    ["unavailable RLS", (telemetry: ReplenishmentRunTelemetry) => { telemetry.rlsObservations[0].anonVisibleReady = null; }],
  ])("marks %s invalid", (_name, mutate) => {
    const telemetry = validSnapshot();
    mutate(telemetry);
    expect(validateReplenishmentTelemetry(telemetry).valid).toBe(false);
  });

  it("leaves a crash partial artifact readable and invalid", () => {
    const partial = readReplenishmentTelemetry(recorder().path);
    expect(partial.run.finalStatus).toBe("running");
    expect(validateReplenishmentTelemetry(partial)).toMatchObject({ valid: false });
  });
});

describe("authoritative telemetry v4 funnel", () => {
  const event = (rank: number, overrides: Partial<NonNullable<ReplenishmentRunTelemetry["funnelEvents"]>[number]> = {}) => ({
    funnelIdentity: `discovery:${rank}`, discoveryRank: rank, discoverySourceId: `source-${rank}`,
    sourceUrl: `https://source-${rank}.test/item`, sourceHints: [`source-${rank}`], rawDiscovered: true as const,
    resolution: "qualified" as const, pairing: "qualified" as const, preflight: "qualified" as const,
    evidence: "qualified" as const, duplicate: "surviving" as const, ranking: "deferred" as const,
    finalStage: "provider-deferred", reasonCodes: ["provider candidate limit"], ...overrides,
  });

  it("persists raw discovery, resolution, pairing, rejection reasons, and provider selection", () => {
    const value = recorder();
    value.recordFunnel([
      event(1, { ranking: "selected", finalStage: "provider-selected", reasonCodes: [] }),
      event(2),
      event(3, { preflight: "rejected", evidence: "not-assessed", duplicate: "not-assessed",
        ranking: "not-assessed", finalStage: "source-preflight",
        reasonCodes: ["fewer than two independent permitted source domains", "thin source"] }),
      event(4, { evidence: "rejected", duplicate: "not-assessed", ranking: "not-assessed",
        finalStage: "evidence", reasonCodes: ["insufficient evidence"] }),
      event(5, { duplicate: "blocked", ranking: "not-assessed", finalStage: "duplicate",
        reasonCodes: ["duplicate canonical candidate identity"] }),
    ]);
    const funnel = value.snapshot().funnelEvents!;
    expect(funnel).toHaveLength(5);
    expect(funnel.filter((item) => item.resolution === "qualified")).toHaveLength(5);
    expect(funnel.filter((item) => item.pairing === "qualified")).toHaveLength(5);
    expect(funnel.filter((item) => item.preflight === "rejected")).toHaveLength(1);
    expect(funnel.flatMap((item) => item.reasonCodes)).toEqual(expect.arrayContaining([
      "fewer than two independent permitted source domains", "thin source", "insufficient evidence",
      "duplicate canonical candidate identity"]));
    expect(funnel.filter((item) => item.ranking === "selected")).toHaveLength(1);
    expect(funnel.filter((item) => item.ranking === "deferred")).toHaveLength(1);
    expect(validateFunnelTelemetry(value.snapshot()).valid).toBe(true);
    expect(reportFromReplenishmentTelemetry(value.snapshot()).funnel).toMatchObject({ rawDiscoveries: 5,
      resolved: 5, paired: 5, preflightRejected: 1, evidenceRejected: 1, duplicateBlocked: 1,
      providerSelected: 1, providerDeferred: 1 });
  });

  it("invalidates unexplained disappearance and provider-pool mismatch", () => {
    const telemetry = validSnapshot(false);
    telemetry.funnelEvents = [event(1, { pairing: "not-assessed", preflight: "not-assessed",
      evidence: "not-assessed", duplicate: "not-assessed", ranking: "not-assessed", finalStage: "resolved" })];
    expect(validateFunnelTelemetry(telemetry)).toMatchObject({ valid: false,
      reasons: expect.arrayContaining(["resolved candidate disappeared before pairing classification"]) });
    telemetry.funnelEvents = [event(1, { ranking: "not-assessed", finalStage: "qualified", reasonCodes: [] })];
    expect(validateFunnelTelemetry(telemetry).reasons)
      .toContain("qualified provider pool does not equal selected plus deferred");
  });

  it("preserves explicit v2, v3, and v4 authority semantics", () => {
    const telemetry = validSnapshot(false);
    telemetry.funnelEvents = [event(1)];
    expect(validateFunnelTelemetry(telemetry)).toMatchObject({ valid: true, fullFunnelReadable: true });
    telemetry.schemaVersion = "replenishment-run-telemetry-v3";
    expect(validateFunnelTelemetry(telemetry)).toMatchObject({ valid: false, accountingReadable: true,
      supplyCompositionReadable: true, fullFunnelReadable: false });
    telemetry.schemaVersion = "replenishment-run-telemetry-v2";
    expect(validateFunnelTelemetry(telemetry)).toMatchObject({ valid: false, accountingReadable: true,
      supplyCompositionReadable: false, fullFunnelReadable: false });
  });

  it("rejects a second funnel write instead of silently overwriting evidence", () => {
    const value = recorder();
    value.recordFunnel([event(1)]);
    expect(() => value.recordFunnel([event(1)])).toThrow(/only be recorded once/);
  });

  it("reproduces run 4 and keeps a terminal resolution rejection out of pairing", () => {
    const historical = event(1, {
      funnelIdentity: "discovery:85146fb8", discoverySourceId: "govuk-news",
      sourceUrl: "https://www.gov.uk/government/news/pm-accelerates-roll-out-of-police-rape-and-sexual-offence-teams",
      sourceHints: ["govuk-news"], resolution: "rejected", pairing: "rejected",
      preflight: "not-assessed", evidence: "not-assessed", duplicate: "not-assessed",
      ranking: "not-assessed", finalStage: "source-preflight",
      reasonCodes: ["unreliable source", "fewer than two independent permitted source domains", "thin source"],
    });
    expect(validateCandidateFunnelEvents([historical])).toMatchObject({ valid: false,
      reasons: expect.arrayContaining(["rejected resolution advanced to pairing"]) });

    const fixed = { ...historical, ...classifyResolutionAndPairing(0), finalStage: "resolution",
      reasonCodes: ["no source material resolved", ...historical.reasonCodes] };
    expect(validateCandidateFunnelEvents([fixed])).toMatchObject({ valid: true });
  });

  it("rejects true rejected or unknown resolution lineage used by pairing", () => {
    expect(validateCandidateFunnelEvents([event(1, { resolution: "rejected", pairing: "qualified",
      preflight: "not-assessed", evidence: "not-assessed", duplicate: "not-assessed",
      ranking: "not-assessed", finalStage: "pairing" })]).reasons)
      .toContain("rejected resolution advanced to pairing");
    expect(validateCandidateFunnelEvents([event(1, { resolution: "not-assessed", pairing: "qualified",
      preflight: "not-assessed", evidence: "not-assessed", duplicate: "not-assessed",
      ranking: "not-assessed", finalStage: "pairing" })]).reasons)
      .toContain("pairing assessment lacks successful resolution");
  });

  it("allows distinct rejected and resolved discoveries without conflating their state", () => {
    const rejected = event(1, { resolution: "rejected", pairing: "not-assessed", preflight: "not-assessed",
      evidence: "not-assessed", duplicate: "not-assessed", ranking: "not-assessed",
      finalStage: "resolution", reasonCodes: ["no source material resolved"] });
    const resolved = event(2, { ranking: "selected", finalStage: "provider-selected", reasonCodes: [] });
    expect(validateCandidateFunnelEvents([rejected, resolved])).toMatchObject({ valid: true });
  });

  it("classifies only the final material set and does not turn an intermediate fetch failure into terminal rejection", () => {
    expect(classifyResolutionAndPairing(0)).toEqual({ resolution: "rejected", pairing: "not-assessed" });
    // Fetch/deep-resolution failures are internal attempts. A surviving feed or
    // fallback material means the terminal material set still resolved.
    expect(classifyResolutionAndPairing(1)).toEqual({ resolution: "qualified", pairing: "rejected" });
    expect(classifyResolutionAndPairing(2)).toEqual({ resolution: "qualified", pairing: "qualified" });
    expect(() => classifyResolutionAndPairing(-1)).toThrow(/non-negative integer/);
  });

  it("prevents identity collisions, duplicate events, and silent funnel overwrite", () => {
    const duplicate = [event(1), event(2, { funnelIdentity: "discovery:1" })];
    expect(validateCandidateFunnelEvents(duplicate).reasons).toContain("duplicate funnel identity");
    const value = recorder();
    value.recordFunnel([event(1)]);
    expect(() => value.recordFunnel([event(2)])).toThrow(/only be recorded once/);
  });

  it("fails closed when preflight, evidence, or duplicate classification disappears", () => {
    expect(validateCandidateFunnelEvents([event(1, { preflight: "not-assessed", evidence: "not-assessed",
      duplicate: "not-assessed", ranking: "not-assessed", finalStage: "paired" })]).reasons)
      .toContain("paired candidate disappeared before preflight classification");
    expect(validateCandidateFunnelEvents([event(1, { evidence: "not-assessed", duplicate: "not-assessed",
      ranking: "not-assessed", finalStage: "preflight-qualified" })]).reasons)
      .toContain("preflight-qualified candidate disappeared before evidence classification");
    expect(validateCandidateFunnelEvents([event(1, { duplicate: "not-assessed", ranking: "not-assessed",
      finalStage: "evidence-qualified" })]).reasons)
      .toContain("evidence-qualified candidate disappeared before duplicate classification");
  });

  it("reconciles resolution, pairing, preflight, and provider counts", () => {
    const value = recorder();
    value.recordFunnel([
      event(1, { ranking: "selected", finalStage: "provider-selected", reasonCodes: [] }),
      event(2),
      event(3, { resolution: "qualified", pairing: "rejected", preflight: "not-assessed",
        evidence: "not-assessed", duplicate: "not-assessed", ranking: "not-assessed",
        finalStage: "source-preflight", reasonCodes: ["fewer than two independent permitted source domains"] }),
      event(4, { resolution: "rejected", pairing: "not-assessed", preflight: "not-assessed",
        evidence: "not-assessed", duplicate: "not-assessed", ranking: "not-assessed",
        finalStage: "resolution", reasonCodes: ["no source material resolved"] }),
    ]);
    expect(validateFunnelTelemetry(value.snapshot())).toMatchObject({ valid: true });
    expect(reportFromReplenishmentTelemetry(value.snapshot()).funnel).toMatchObject({
      rawDiscoveries: 4, resolutionAttempts: 4, resolved: 3, terminalResolutionRejected: 1,
      paired: 2, unpaired: 1, preflightAssessed: 2, preflightQualified: 2, preflightRejected: 0,
      ranked: 2, providerSelected: 1, providerDeferred: 1,
    });
  });
});
