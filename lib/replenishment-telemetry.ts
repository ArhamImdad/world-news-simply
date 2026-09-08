import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ProviderAttemptRecord, ProviderUsageEvent } from "@/lib/provider-runtime";
import type { LeaseOwnershipAttempt, LeaseOwnershipOutcome, ReplenishmentLeaseObserver } from "@/lib/replenishment-lease";
import type { ReserveFillControl } from "@/lib/reserve-fill-control";

export const REPLENISHMENT_TELEMETRY_SCHEMA_VERSION = "replenishment-run-telemetry-v4";
export type TelemetryEvidenceClassification = "AUTHORITATIVE_COMPLETE_SAMPLE" |
  "RUN_INTEGRITY_VALID_BUT_INCOMPLETE" | "INVALID";
const FORBIDDEN_CANDIDATE_KEYS = new Set(["unavailable", "unknown", "pending", "null", "undefined"]);

export type CandidateTelemetry = {
  candidateTelemetryId: string;
  runId: string;
  candidateHash: string | null;
  deterministicRank: number;
  discoveredIdentity: { topic: string | null; sourceUrl: string | null };
  sourceHints: string[];
  consideredAt: string;
  supplyClass: "EVERGREEN" | "OCCASIONAL_CURRENT" | "RECURRING_CURRENT";
  releaseSeriesId: string | null;
  normalizedPeriod: string | null;
  canonicalSeriesPeriodIdentity: string | null;
  recurringCadence: string | null;
  publisherRoots: string[];
  category: string | null;
  discoverySourceId: string;
  preparationKey: string | null;
  releasePublicationDates: string[];
  nextExpectedCadenceClassification: string | null;
  sourcePair: string[];
  sourceDomains: string[];
  sourcePreflightResults: { passed: boolean; reasons: string[] } | null;
  evidenceResults: { passed: boolean; reasons: string[] } | null;
  synthesisResult: { passed: boolean; score: number | null; reasons: string[] } | null;
  duplicateResult: { duplicate: boolean; reasons: string[] } | null;
  preGroqScore: number | null;
  synthesisScore: number | null;
  disposition: string;
  reasonCodes: string[];
  duplicateIdentity: boolean;
  providerWorkStarted: boolean;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
};

export type CandidateConsideration = Pick<CandidateTelemetry,
  "candidateTelemetryId" | "deterministicRank" | "discoveredIdentity" | "sourceHints" | "consideredAt" |
  "supplyClass" | "releaseSeriesId" | "normalizedPeriod" | "canonicalSeriesPeriodIdentity" |
  "recurringCadence" | "publisherRoots" | "category" | "discoverySourceId" | "preparationKey" |
  "releasePublicationDates" | "nextExpectedCadenceClassification">;
export type CandidateTelemetryUpdate = { candidateTelemetryId: string } & Partial<Omit<CandidateTelemetry,
  "candidateTelemetryId" | "runId" | "deterministicRank" | "discoveredIdentity" | "sourceHints" | "consideredAt">>;

export type FunnelStatus = "not-assessed" | "qualified" | "rejected";

/**
 * Source-material collection is terminal at discovery granularity: retries,
 * deep-page fetches, and feed-content fallbacks are resolved internally before
 * this classification is emitted. Pairing is therefore assessable only when
 * at least one final source material resolved successfully.
 */
export function classifyResolutionAndPairing(sourceMaterialCount: number): {
  resolution: Exclude<FunnelStatus, "not-assessed">;
  pairing: FunnelStatus;
} {
  if (!Number.isInteger(sourceMaterialCount) || sourceMaterialCount < 0) {
    throw new Error("source material count must be a non-negative integer");
  }
  if (sourceMaterialCount === 0) return { resolution: "rejected", pairing: "not-assessed" };
  return { resolution: "qualified", pairing: sourceMaterialCount >= 2 ? "qualified" : "rejected" };
}

export type CandidateFunnelEvent = {
  funnelIdentity: string;
  discoveryRank: number;
  discoverySourceId: string;
  sourceUrl: string;
  sourceHints: string[];
  rawDiscovered: true;
  resolution: FunnelStatus;
  pairing: FunnelStatus;
  preflight: FunnelStatus;
  evidence: FunnelStatus;
  duplicate: "not-assessed" | "surviving" | "blocked";
  ranking: "not-assessed" | "selected" | "deferred";
  finalStage: string;
  reasonCodes: string[];
};

export type QueueObservation = {
  phase: "starting" | "ending" | "cleanup";
  observedAt: string;
  readyDepth: number;
  totalRows: number;
  approvedCount: number;
  publicationSlotCount: number;
};

export type RlsObservation = {
  phase: string;
  observedAt: string;
  required: boolean;
  anonVisibleReady: number | null;
  authenticatedVisibleReady: number | null;
  serviceReady: number | null;
  temporaryAuthUserRef: string | null;
  temporaryAuthUserDeleted: boolean | null;
  errorCode: string | null;
};

export type ReadyTelemetry = {
  candidateTelemetryId: string;
  articleId: string | null;
  candidateHash: string;
  runId: string;
  preparationKey: string;
  duplicateIdentity: string;
  quality: number;
  sourcePair: string[];
  supplyClass: CandidateTelemetry["supplyClass"];
  releaseSeriesId: string | null;
  normalizedPeriod: string | null;
  canonicalSeriesPeriodIdentity: string | null;
  recurringCadence: string | null;
  title: string;
  category: string;
  publisherRoots: string[];
  primarySource: string | null;
  preGroqScore: number;
  factualCompleteness: number;
  originality: number;
  usefulness: number;
  meaningfulContext: number;
  headlineQuality: number;
  addedValue: number;
  mostlyParaphrase: boolean;
  claimsSupported: boolean;
  speculativeOrInvented: boolean;
  inventedQuotes: boolean;
  inventedStatistics: boolean;
  deterministicOriginality: {
    accepted: boolean;
    fiveWordOverlap: number;
    maximumSentenceSimilarity: number;
    headlineSimilarity: number;
    sourceOrderSimilarity: number;
    reasons: string[];
  };
  preparedAt: string;
  expiresAt: string;
  lifecycleState: string;
  publicationStatus: string;
  eligibilityRevalidationPassed: boolean;
  eligibilityFailures: string[];
  enqueueResult: "INSERTED" | "TARGET_REACHED" | "MAX_DEPTH_REACHED" | "DUPLICATE" | "INELIGIBLE";
  insertedAt: string | null;
  attributedRunId: string | null;
};

export type ReplenishmentRunTelemetry = {
  schemaVersion: typeof REPLENISHMENT_TELEMETRY_SCHEMA_VERSION | "replenishment-run-telemetry-v3" |
    "replenishment-run-telemetry-v2" | "replenishment-run-telemetry-v1";
  run: {
    runId: string;
    environment: "staging" | "local-test";
    projectRef: string;
    startedAt: string;
    endedAt: string | null;
    finalStatus: "running" | "completed" | "failed" | "aborted" | "incomplete";
    stopReason: string | null;
    sampleValid: boolean;
    evidenceClassification: TelemetryEvidenceClassification;
    invalidationReasons: string[];
    processOverlapDetected: boolean;
  };
  lease: {
    acquisitionAttemptedAt: string | null;
    acquisitionSuccess: boolean | null;
    ownerRunId: string | null;
    acquiredAt: string | null;
    ownershipChecks: Array<{ observedAt: string; owned: boolean }>;
    ownershipAttempts: LeaseOwnershipAttempt[];
    leaseOwnershipOutcome: LeaseOwnershipOutcome | null;
    ownershipIndeterminateAt: string | null;
    heartbeatCount: number;
    heartbeatTimestamps: string[];
    heartbeatFailureAt: string | null;
    leaseLostAt: string | null;
    releaseAttemptedAt: string | null;
    releaseSuccess: boolean | null;
    releasedAt: string | null;
  };
  candidateSequence: {
    consideredCount: number;
    highestDeterministicRank: number;
    candidateTelemetryIds: string[];
    overwriteAttempts: number;
  };
  candidates: CandidateTelemetry[];
  funnelEvents?: CandidateFunnelEvent[];
  providerAttempts: ProviderUsageEvent[];
  providerLedgerKnownTotal: number;
  readyInsertions: ReadyTelemetry[];
  reserveControl?: ReserveFillControl;
  queueObservations: QueueObservation[];
  rlsObservations: RlsObservation[];
  timing: { runtimeMs: number | null; providerPacingWaitMs: number; retryWaitMs: number };
  cleanup: { baselineRestored: boolean | null; observedAt: string | null };
};

function nowIso() { return new Date().toISOString(); }
function bounded(values: string[]) { return values.slice(-100); }
function validTelemetryId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 && !FORBIDDEN_CANDIDATE_KEYS.has(value.trim().toLowerCase());
}
export function candidateTelemetryIdFor(runId: string, deterministicRank: number) {
  if (!runId.trim() || !Number.isInteger(deterministicRank) || deterministicRank < 1) {
    throw new Error("A candidate telemetry identity requires a run ID and positive deterministic rank.");
  }
  return `${runId}:candidate:${deterministicRank}`;
}

export function telemetryArtifactPath(runId: string, directory = resolve(process.cwd(), ".calibration", "replenishment-runs")) {
  return resolve(directory, `${runId}.json`);
}

export class ReplenishmentTelemetryRecorder {
  readonly path: string;
  private telemetry: ReplenishmentRunTelemetry;
  private funnelRecorded = false;

  constructor(options: { runId: string; projectRef: string; environment?: "staging" | "local-test"; path?: string; startedAt?: string }) {
    const startedAt = options.startedAt ?? nowIso();
    this.path = options.path ?? telemetryArtifactPath(options.runId);
    this.telemetry = {
      schemaVersion: REPLENISHMENT_TELEMETRY_SCHEMA_VERSION,
      run: { runId: options.runId, environment: options.environment ?? "staging", projectRef: options.projectRef,
        startedAt, endedAt: null, finalStatus: "running", stopReason: null, sampleValid: true,
        evidenceClassification: "INVALID",
        invalidationReasons: [], processOverlapDetected: false },
      lease: { acquisitionAttemptedAt: null, acquisitionSuccess: null, ownerRunId: null, acquiredAt: null,
        ownershipChecks: [], ownershipAttempts: [], leaseOwnershipOutcome: null, ownershipIndeterminateAt: null,
        heartbeatCount: 0, heartbeatTimestamps: [], heartbeatFailureAt: null,
        leaseLostAt: null, releaseAttemptedAt: null, releaseSuccess: null, releasedAt: null },
      candidateSequence: { consideredCount: 0, highestDeterministicRank: 0, candidateTelemetryIds: [], overwriteAttempts: 0 },
      candidates: [], funnelEvents: [], providerAttempts: [], providerLedgerKnownTotal: 0, readyInsertions: [],
      queueObservations: [], rlsObservations: [], timing: { runtimeMs: null, providerPacingWaitMs: 0, retryWaitMs: 0 },
      cleanup: { baselineRestored: null, observedAt: null },
    };
    this.persist();
  }

  private persist() {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.telemetry, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.path);
  }

  snapshot() { return structuredClone(this.telemetry); }
  invalidate(reason: string) {
    if (!this.telemetry.run.invalidationReasons.includes(reason)) this.telemetry.run.invalidationReasons.push(reason);
    this.telemetry.run.sampleValid = false;
    this.persist();
  }

  considerCandidate(candidate: CandidateConsideration) {
    const invalidKey = !validTelemetryId(candidate.candidateTelemetryId);
    const duplicateId = this.telemetry.candidateSequence.candidateTelemetryIds.includes(candidate.candidateTelemetryId);
    const duplicateRank = this.telemetry.candidates.some((entry) => entry.deterministicRank === candidate.deterministicRank);
    if (invalidKey || duplicateId || duplicateRank || candidate.deterministicRank !== this.telemetry.candidateSequence.consideredCount + 1) {
      this.telemetry.candidateSequence.overwriteAttempts += 1;
      this.invalidate(invalidKey ? "invalid or sentinel candidate telemetry ID" :
        duplicateId ? "candidate telemetry overwrite attempted" :
          duplicateRank ? "duplicate deterministic candidate rank attempted" : "non-contiguous candidate consideration attempted");
      throw new Error("Candidate telemetry identity/sequence invariant failed before candidate processing.");
    }
    const record: CandidateTelemetry = {
      ...structuredClone(candidate), runId: this.telemetry.run.runId, candidateHash: null,
      sourcePair: [], sourceDomains: [], sourcePreflightResults: null, evidenceResults: null, synthesisResult: null,
      duplicateResult: null, preGroqScore: null, synthesisScore: null, disposition: "considering", reasonCodes: [],
      duplicateIdentity: false, providerWorkStarted: false, startedAt: candidate.consideredAt, endedAt: null, durationMs: null,
    };
    this.telemetry.candidates.push(record);
    this.telemetry.candidateSequence.consideredCount += 1;
    this.telemetry.candidateSequence.highestDeterministicRank = candidate.deterministicRank;
    this.telemetry.candidateSequence.candidateTelemetryIds.push(candidate.candidateTelemetryId);
    this.persist();
  }

  recordCandidate(update: CandidateTelemetryUpdate) {
    if (!validTelemetryId(update.candidateTelemetryId)) {
      this.telemetry.candidateSequence.overwriteAttempts += 1;
      this.invalidate("invalid or sentinel candidate telemetry ID used for update");
      throw new Error("Candidate telemetry updates require a non-sentinel candidateTelemetryId.");
    }
    const index = this.telemetry.candidates.findIndex((entry) => entry.candidateTelemetryId === update.candidateTelemetryId);
    if (index < 0) {
      this.telemetry.candidateSequence.overwriteAttempts += 1;
      this.invalidate("candidate telemetry update referenced an unknown candidate");
      throw new Error("Candidate telemetry must be considered before it can be updated.");
    }
    const patch = structuredClone(update) as Partial<CandidateTelemetry>;
    delete patch.candidateTelemetryId;
    this.telemetry.candidates[index] = { ...this.telemetry.candidates[index], ...patch };
    this.persist();
  }

  recordFunnel(events: CandidateFunnelEvent[]) {
    if (this.funnelRecorded) {
      this.invalidate("candidate funnel telemetry overwrite attempted");
      throw new Error("Candidate funnel telemetry may only be recorded once per run.");
    }
    this.funnelRecorded = true;
    this.telemetry.funnelEvents = structuredClone(events);
    this.persist();
  }

  recordProviderAttempt(event: ProviderUsageEvent) {
    const index = this.telemetry.providerAttempts.findIndex((entry) => entry.attemptId === event.attemptId);
    if (index >= 0) this.telemetry.providerAttempts[index] = structuredClone(event);
    else this.telemetry.providerAttempts.push(structuredClone(event));
    this.telemetry.providerLedgerKnownTotal = Math.max(this.telemetry.providerLedgerKnownTotal, event.ledgerKnownTotalAfterAttempt);
    this.telemetry.timing.providerPacingWaitMs = this.telemetry.providerAttempts.reduce((sum, attempt) => sum + attempt.proactivePacingWaitMs, 0);
    this.telemetry.timing.retryWaitMs = this.telemetry.providerAttempts.reduce((sum, attempt) => sum + attempt.retryWaitMs, 0);
    this.persist();
  }
  recordReady(record: ReadyTelemetry) { this.telemetry.readyInsertions.push(structuredClone(record)); this.persist(); }
  recordReserveControl(control: ReserveFillControl) {
    this.telemetry.reserveControl = structuredClone(control);
    this.persist();
  }
  recordQueue(observation: QueueObservation) { this.telemetry.queueObservations.push(structuredClone(observation)); this.persist(); }
  recordRls(observation: RlsObservation) { this.telemetry.rlsObservations.push(structuredClone(observation)); this.persist(); }
  markCleanup(restored: boolean) { this.telemetry.cleanup = { baselineRestored: restored, observedAt: nowIso() }; this.persist(); }
  leaseObserver(): ReplenishmentLeaseObserver {
    return {
      acquisitionAttempted: (at) => { this.telemetry.lease.acquisitionAttemptedAt = at; this.persist(); },
      acquired: (runId, at) => { this.telemetry.lease.acquisitionSuccess = true; this.telemetry.lease.ownerRunId = runId;
        this.telemetry.lease.acquiredAt = at; this.persist(); },
      acquisitionFailed: (at) => { this.telemetry.lease.acquisitionSuccess = false; this.invalidate(`lease acquisition failed at ${at}`); },
      ownershipChecked: (owned, at) => { this.telemetry.lease.ownershipChecks = bounded([
        ...this.telemetry.lease.ownershipChecks.map((entry) => JSON.stringify(entry)), JSON.stringify({ observedAt: at, owned }),
      ]).map((entry) => JSON.parse(entry) as { observedAt: string; owned: boolean }); if (!owned) this.telemetry.lease.leaseLostAt = at; this.persist(); },
      ownershipAttempt: (attempt) => { this.telemetry.lease.ownershipAttempts = bounded([
        ...this.telemetry.lease.ownershipAttempts.map((entry) => JSON.stringify(entry)), JSON.stringify(attempt),
      ]).map((entry) => JSON.parse(entry) as LeaseOwnershipAttempt);
      this.telemetry.lease.leaseOwnershipOutcome = attempt.outcome; this.persist(); },
      ownershipIndeterminate: (outcome, at) => { this.telemetry.lease.leaseOwnershipOutcome = outcome;
        this.telemetry.lease.ownershipIndeterminateAt = at; this.persist(); },
      heartbeat: (success, at) => { this.telemetry.lease.heartbeatCount += success ? 1 : 0;
        this.telemetry.lease.heartbeatTimestamps = bounded([...this.telemetry.lease.heartbeatTimestamps, at]);
        if (!success) this.telemetry.lease.heartbeatFailureAt = at; this.persist(); },
      leaseLost: (at) => { this.telemetry.lease.leaseLostAt = at; this.invalidate("lease ownership lost"); },
      releaseAttempted: (at) => { this.telemetry.lease.releaseAttemptedAt = at; this.persist(); },
      released: (success, at) => { this.telemetry.lease.releaseSuccess = success; this.telemetry.lease.releasedAt = at;
        if (!success) this.invalidate("lease release was not confirmed"); else this.persist(); },
    };
  }
  finalize(status: "completed" | "failed" | "aborted" | "incomplete", reason: string) {
    const endedAt = nowIso();
    this.telemetry.run.endedAt = endedAt;
    this.telemetry.run.finalStatus = status;
    this.telemetry.run.stopReason = reason;
    this.telemetry.timing.runtimeMs = Math.max(0, Date.parse(endedAt) - Date.parse(this.telemetry.run.startedAt));
    const validation = validateReplenishmentTelemetry(this.telemetry);
    for (const item of validation.reasons) if (!this.telemetry.run.invalidationReasons.includes(item)) this.telemetry.run.invalidationReasons.push(item);
    this.telemetry.run.sampleValid = validation.valid;
    this.telemetry.run.evidenceClassification = validation.classification;
    this.persist();
    return this.snapshot();
  }
}

export function readReplenishmentTelemetry(path: string): ReplenishmentRunTelemetry {
  return JSON.parse(readFileSync(path, "utf8")) as ReplenishmentRunTelemetry;
}

export function reconcileProviderAccounting(telemetry: ReplenishmentRunTelemetry) {
  const unique = new Map<string, ProviderAttemptRecord>();
  const duplicateAttemptIds: string[] = [];
  for (const attempt of telemetry.providerAttempts ?? []) {
    if (unique.has(attempt.attemptId)) duplicateAttemptIds.push(attempt.attemptId);
    else unique.set(attempt.attemptId, attempt);
  }
  const attempts = [...unique.values()];
  const knownTokenTotal = attempts.reduce((sum, attempt) => sum + (attempt.usage.status === "known" ? attempt.usage.totalTokens : 0), 0);
  const unknown = attempts.filter((attempt) => attempt.usage.status === "unknown");
  const unknownReservations = unknown.reduce((sum, attempt) => sum + attempt.reservedTokens, 0);
  return { uniqueAttemptCount: attempts.length, duplicateAttemptIds, knownTokenTotal, unknownAttemptCount: unknown.length,
    unknownReservations, budgetAccountedTotal: knownTokenTotal + unknownReservations,
    providerLedgerKnownTotal: telemetry.providerLedgerKnownTotal,
    invariantPassed: duplicateAttemptIds.length === 0 && knownTokenTotal === telemetry.providerLedgerKnownTotal &&
      attempts.every((attempt) => attempt.reservationReconciled) };
}

function duplicateValues<T>(values: T[]) {
  const seen = new Set<T>();
  return [...new Set(values.filter((value) => seen.has(value) || !seen.add(value)))];
}

export function validateReplenishmentTelemetry(telemetry: ReplenishmentRunTelemetry) {
  const reasons: string[] = [];
  const runId = telemetry.run.runId;
  const accounting = reconcileProviderAccounting(telemetry);
  if (telemetry.schemaVersion === "replenishment-run-telemetry-v1") {
    reasons.push("telemetry v1 candidate completeness cannot be proven");
  } else {
    const sequence = telemetry.candidateSequence;
    const candidates = telemetry.candidates ?? [];
    const ids = candidates.map((candidate) => candidate.candidateTelemetryId);
    const ranks = candidates.map((candidate) => candidate.deterministicRank);
    if (!sequence || sequence.consideredCount !== new Set(ids).size || sequence.consideredCount !== candidates.length) {
      reasons.push("considered candidate count does not match unique retained candidate records");
    }
    if (duplicateValues(ids).length > 0) reasons.push("duplicate candidateTelemetryId");
    if (ids.some((id) => !validTelemetryId(id))) reasons.push("missing, empty, or sentinel candidateTelemetryId");
    if (duplicateValues(ranks).length > 0) reasons.push("duplicate deterministic candidate rank");
    const expectedRanks = Array.from({ length: sequence?.consideredCount ?? 0 }, (_, index) => index + 1);
    if (!sequence || sequence.highestDeterministicRank !== sequence.consideredCount ||
        expectedRanks.some((rank) => !ranks.includes(rank))) reasons.push("missing or non-contiguous deterministic candidate rank");
    if (!sequence || sequence.candidateTelemetryIds.length !== sequence.consideredCount ||
        sequence.candidateTelemetryIds.some((id, index) => ids.find((candidateId) => candidateId === id) === undefined ||
          candidates.find((candidate) => candidate.candidateTelemetryId === id)?.deterministicRank !== index + 1)) {
      reasons.push("candidate consideration sequence does not match retained records");
    }
    if ((sequence?.overwriteAttempts ?? 0) > 0) reasons.push("candidate telemetry overwrite was attempted");
    const finalArtifact = telemetry.run.finalStatus !== "running";
    const nonFinal = new Set(["considering", "qualified", "provider-started", "deferred"]);
    if (finalArtifact && candidates.some((candidate) => !candidate.disposition || nonFinal.has(candidate.disposition))) {
      reasons.push("completed candidate lacks final disposition");
    }
    if (candidates.some((candidate) => candidate.runId !== runId || !Number.isInteger(candidate.deterministicRank) ||
        candidate.deterministicRank < 1 || !candidate.consideredAt || !candidate.discoveredIdentity ||
        !Array.isArray(candidate.sourceHints) || !Array.isArray(candidate.sourcePair) || !Array.isArray(candidate.sourceDomains) ||
        !Array.isArray(candidate.reasonCodes) || typeof candidate.providerWorkStarted !== "boolean")) {
      reasons.push("candidate record is malformed or incomplete");
    }
    const knownIds = new Set(ids);
    if ((telemetry.providerAttempts ?? []).some((attempt) => !knownIds.has(attempt.candidateTelemetryId))) {
      reasons.push("provider attempt references unknown candidateTelemetryId");
    }
    if (candidates.some((candidate) => candidate.providerWorkStarted &&
        !(telemetry.providerAttempts ?? []).some((attempt) => attempt.candidateTelemetryId === candidate.candidateTelemetryId))) {
      reasons.push("provider-started candidate has no provider-attempt relation");
    }
    if ((telemetry.readyInsertions ?? []).some((entry) => !knownIds.has(entry.candidateTelemetryId))) {
      reasons.push("READY attribution references unknown candidateTelemetryId");
    }
    const hashes = new Map<string, CandidateTelemetry[]>();
    for (const candidate of candidates) if (candidate.candidateHash) {
      hashes.set(candidate.candidateHash, [...(hashes.get(candidate.candidateHash) ?? []), candidate]);
    }
    if ([...hashes.values()].some((group) => group.length > 1 &&
        group.filter((candidate) => candidate.disposition !== "rejected:duplicate" || candidate.providerWorkStarted).length > 1)) {
      reasons.push("candidateHash is attached to multiple non-duplicate candidate records");
    }
    if (telemetry.schemaVersion === "replenishment-run-telemetry-v3" ||
        telemetry.schemaVersion === REPLENISHMENT_TELEMETRY_SCHEMA_VERSION) {
      reasons.push(...validateSupplyCompositionTelemetry(telemetry).reasons);
    }
    if (telemetry.schemaVersion === REPLENISHMENT_TELEMETRY_SCHEMA_VERSION) {
      reasons.push(...validateFunnelTelemetry(telemetry).reasons);
    }
  }
  if (!accounting.invariantPassed) reasons.push("provider accounting cannot be reconciled");
  if ((telemetry.providerAttempts ?? []).some((attempt) => !attempt.runId || attempt.runId !== runId)) reasons.push("foreign or missing provider run attribution");
  if ((telemetry.readyInsertions ?? []).some((entry) => entry.runId !== runId ||
      (entry.enqueueResult === "INSERTED" && entry.attributedRunId !== runId) ||
      (entry.enqueueResult !== "INSERTED" && (entry.articleId !== null || entry.attributedRunId !== null)))) {
    reasons.push("foreign or missing READY run attribution");
  }
  if (!telemetry.lease.acquisitionSuccess || telemetry.lease.ownerRunId !== runId || telemetry.lease.leaseLostAt) reasons.push("lease ownership is unprovable or lost");
  if (telemetry.run.finalStatus !== "running" && telemetry.lease.releaseSuccess !== true) reasons.push("lease release is unconfirmed");
  if (telemetry.run.processOverlapDetected) reasons.push("process overlap detected");
  const start = (telemetry.queueObservations ?? []).find((entry) => entry.phase === "starting");
  const end = [...(telemetry.queueObservations ?? [])].reverse().find((entry) => entry.phase === "ending");
  const inserted = (telemetry.readyInsertions ?? []).filter((entry) => entry.enqueueResult === "INSERTED").length;
  if (start && end && end.readyDepth !== start.readyDepth + inserted) reasons.push("unexplained queue depth change");
  if (!start || !end) reasons.push("required queue observations are incomplete");
  const reserve = telemetry.reserveControl;
  if (reserve) {
    const reserveCandidates = telemetry.candidates ?? [];
    const reserveCandidateIds = reserveCandidates.map((candidate) => candidate.candidateTelemetryId);
    if (reserve.readyDepthAtStart !== start?.readyDepth || reserve.initialDeficit !==
        Math.max(0, reserve.configuredFillTarget - reserve.readyDepthAtStart)) {
      reasons.push("reserve deficit telemetry is inconsistent");
    }
    if (reserve.successfulEnqueues !== inserted || (reserve.successfulEnqueues > reserve.initialDeficit &&
        end?.readyDepth === (start?.readyDepth ?? 0) + inserted)) {
      reasons.push("successful enqueue count exceeds the effective available slots");
    }
    if (reserve.finalObservedReadyDepth !== end?.readyDepth) reasons.push("final reserve depth telemetry is inconsistent");
    if (end && start && end.readyDepth === start.readyDepth + inserted &&
        end.readyDepth > reserve.configuredFillTarget) reasons.push("controlled run exceeded configured fill target");
    if (reserve.targetReachedAt && !reserveCandidateIds.includes(reserve.targetReachedAt)) reasons.push("targetReachedAt references unknown candidate");
    const skipped = reserveCandidates.filter((candidate) => candidate.disposition === "deferred:target-satisfied" &&
      !candidate.providerWorkStarted).length;
    if (reserve.providerWorkSkippedAfterDeficitSatisfied !== skipped) {
      reasons.push("provider work skipped telemetry is inconsistent");
    }
  }
  if ((telemetry.rlsObservations ?? []).some((entry) => entry.required &&
      (entry.errorCode || entry.anonVisibleReady === null || entry.authenticatedVisibleReady === null || entry.serviceReady === null ||
       entry.anonVisibleReady !== 0 || entry.authenticatedVisibleReady !== 0))) reasons.push("required RLS observation failed or is unavailable");
  if (telemetry.run.finalStatus === "incomplete" || telemetry.run.finalStatus === "running") reasons.push("telemetry artifact is incomplete");
  if (telemetry.cleanup.baselineRestored === false) reasons.push("cleanup baseline was not restored");
  const uniqueReasons = [...new Set([...telemetry.run.invalidationReasons, ...reasons])];
  const integrityBlockingPatterns = [
    /provider accounting cannot be reconciled/, /foreign or missing/, /lease ownership is unprovable or lost/,
    /lease release is unconfirmed/, /process overlap/, /unexplained queue depth change/,
    /required RLS observation failed/, /cleanup baseline was not restored/, /malformed/,
    /overwrite/, /duplicate candidateTelemetryId/, /duplicate deterministic/, /multiple non-duplicate/,
  ];
  const finalOwnershipOutcome = telemetry.lease.leaseOwnershipOutcome;
  const semanticOwnershipFailure = finalOwnershipOutcome === "RPC_ERROR" || finalOwnershipOutcome === "FALSE";
  const integrityValid = telemetry.run.finalStatus !== "running" && !semanticOwnershipFailure &&
    !uniqueReasons.some((reason) => integrityBlockingPatterns.some((pattern) => pattern.test(reason)));
  const classification: TelemetryEvidenceClassification = uniqueReasons.length === 0
    ? "AUTHORITATIVE_COMPLETE_SAMPLE" : integrityValid ? "RUN_INTEGRITY_VALID_BUT_INCOMPLETE" : "INVALID";
  return { valid: uniqueReasons.length === 0, classification, reasons: uniqueReasons };
}

export function validateFunnelTelemetry(telemetry: ReplenishmentRunTelemetry) {
  if (telemetry.schemaVersion !== REPLENISHMENT_TELEMETRY_SCHEMA_VERSION) {
    return { valid: false, accountingReadable: true, supplyCompositionReadable:
      telemetry.schemaVersion === "replenishment-run-telemetry-v3",
      fullFunnelReadable: false, reasons: [`${telemetry.schemaVersion} is insufficient for authoritative raw-funnel analysis`] };
  }
  const events = telemetry.funnelEvents ?? [];
  const result = validateCandidateFunnelEvents(events);
  const reasons = [...result.reasons];
  if ((telemetry.candidates ?? []).length > 0 && events.length === 0) reasons.push("raw discovery funnel is missing");
  return { ...result, valid: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function validateCandidateFunnelEvents(events: CandidateFunnelEvent[]) {
  const reasons: string[] = [];
  const identities = events.map((event) => event.funnelIdentity);
  const ranks = events.map((event) => event.discoveryRank);
  if (duplicateValues(identities).length) reasons.push("duplicate funnel identity");
  if (duplicateValues(ranks).length || ranks.some((rank, index) => rank !== index + 1)) {
    reasons.push("raw discovery ranks are missing or non-contiguous");
  }
  for (const event of events) {
    if (!event.funnelIdentity || !event.discoverySourceId || !event.sourceUrl || !Array.isArray(event.sourceHints) ||
        !Array.isArray(event.reasonCodes) || event.rawDiscovered !== true || !event.finalStage) {
      reasons.push("raw funnel event is malformed");
    }
    if (!["not-assessed", "qualified", "rejected"].includes(event.resolution) ||
        !["not-assessed", "qualified", "rejected"].includes(event.pairing) ||
        !["not-assessed", "qualified", "rejected"].includes(event.preflight) ||
        !["not-assessed", "qualified", "rejected"].includes(event.evidence)) {
      reasons.push("funnel stage has an unknown outcome");
    }
    if (event.resolution === "rejected" && event.pairing !== "not-assessed") reasons.push("rejected resolution advanced to pairing");
    if (event.resolution === "not-assessed" && event.pairing !== "not-assessed") reasons.push("pairing assessment lacks successful resolution");
    if (event.pairing === "rejected" && event.preflight !== "not-assessed") reasons.push("rejected pairing advanced to preflight");
    if (event.pairing === "qualified" && event.preflight === "not-assessed") reasons.push("paired candidate disappeared before preflight classification");
    if (event.preflight === "rejected" && event.evidence !== "not-assessed") reasons.push("preflight rejection advanced to evidence");
    if (event.preflight === "qualified" && event.evidence === "not-assessed") reasons.push("preflight-qualified candidate disappeared before evidence classification");
    if (event.evidence === "rejected" && event.duplicate === "surviving") reasons.push("evidence rejection advanced to duplicate survival");
    if (event.evidence === "qualified" && event.duplicate === "not-assessed") reasons.push("evidence-qualified candidate disappeared before duplicate classification");
    if (event.duplicate === "blocked" && event.ranking !== "not-assessed") reasons.push("duplicate-blocked candidate advanced to ranking");
    if (event.ranking !== "not-assessed" &&
        !(event.resolution === "qualified" && event.pairing === "qualified" && event.preflight === "qualified" &&
          event.evidence === "qualified" && event.duplicate === "surviving")) {
      reasons.push("ranked candidate did not survive every qualification stage");
    }
  }
  const ranked = events.filter((event) => event.ranking !== "not-assessed");
  const qualifiedProviderPool = events.filter((event) => event.resolution === "qualified" && event.pairing === "qualified" &&
    event.preflight === "qualified" && event.evidence === "qualified" && event.duplicate === "surviving");
  if (ranked.length !== qualifiedProviderPool.length) reasons.push("qualified provider pool does not equal selected plus deferred");
  if (events.some((event) => event.resolution === "qualified" && event.pairing === "not-assessed")) {
    reasons.push("resolved candidate disappeared before pairing classification");
  }
  return { valid: reasons.length === 0, accountingReadable: true, supplyCompositionReadable: true,
    fullFunnelReadable: true, reasons: [...new Set(reasons)] };
}

export function validateSupplyCompositionTelemetry(telemetry: ReplenishmentRunTelemetry) {
  if (telemetry.schemaVersion === "replenishment-run-telemetry-v1" ||
      telemetry.schemaVersion === "replenishment-run-telemetry-v2") {
    return { valid: false, accountingReadable: true,
      reasons: [`${telemetry.schemaVersion} is insufficient for authoritative supply-composition analysis`] };
  }
  const reasons: string[] = [];
  const allowed = new Set(["EVERGREEN", "OCCASIONAL_CURRENT", "RECURRING_CURRENT"]);
  for (const candidate of telemetry.candidates ?? []) {
    if (!allowed.has(candidate.supplyClass) || !candidate.discoverySourceId || !Array.isArray(candidate.publisherRoots) ||
        !Array.isArray(candidate.releasePublicationDates)) {
      reasons.push("candidate supply classification is missing or malformed");
    }
    if (candidate.supplyClass === "RECURRING_CURRENT" &&
        (!candidate.releaseSeriesId || !candidate.normalizedPeriod || !candidate.canonicalSeriesPeriodIdentity ||
         !candidate.recurringCadence)) {
      reasons.push("recurring candidate lacks mandatory series-period telemetry");
    }
    if (candidate.releaseSeriesId && candidate.normalizedPeriod && candidate.canonicalSeriesPeriodIdentity !==
        `${candidate.releaseSeriesId}:${candidate.normalizedPeriod}`) {
      reasons.push("candidate recurring identity is inconsistent with its series and period");
    }
  }
  const candidates = new Map((telemetry.candidates ?? []).map((candidate) => [candidate.candidateTelemetryId, candidate]));
  for (const ready of telemetry.readyInsertions ?? []) {
    const candidate = candidates.get(ready.candidateTelemetryId);
    if (!candidate) {
      reasons.push("READY supply telemetry cannot be traced to candidate telemetry");
      continue;
    }
    if (ready.supplyClass !== candidate.supplyClass || ready.releaseSeriesId !== candidate.releaseSeriesId ||
        ready.normalizedPeriod !== candidate.normalizedPeriod ||
        ready.canonicalSeriesPeriodIdentity !== candidate.canonicalSeriesPeriodIdentity ||
        ready.recurringCadence !== candidate.recurringCadence) {
      reasons.push("READY supply classification differs from candidate telemetry");
    }
  }
  return { valid: reasons.length === 0, accountingReadable: true, reasons: [...new Set(reasons)] };
}

export function reportFromReplenishmentTelemetry(telemetry: ReplenishmentRunTelemetry) {
  const accounting = reconcileProviderAccounting(telemetry);
  const attempts = telemetry.providerAttempts ?? [];
  const candidates = telemetry.candidates ?? [];
  const operations = Object.fromEntries(["generation", "generation-repair", "audit", "revision", "revision-repair", "revision-audit"]
    .map((operation) => [operation, attempts.filter((attempt) => attempt.operation === operation).length]));
  const dispositionCounts = candidates.reduce<Record<string, number>>((counts, candidate) => {
    counts[candidate.disposition] = (counts[candidate.disposition] ?? 0) + 1; return counts;
  }, {});
  const reasonOccurrenceCounts = candidates.reduce<Record<string, number>>((counts, candidate) => {
    for (const reason of candidate.reasonCodes ?? []) counts[reason] = (counts[reason] ?? 0) + 1; return counts;
  }, {});
  const rejectedCandidates = candidates.filter((candidate) => candidate.disposition?.startsWith("rejected")).length;
  const funnelEvents = telemetry.funnelEvents ?? [];
  const funnel = telemetry.schemaVersion === REPLENISHMENT_TELEMETRY_SCHEMA_VERSION ? {
    rawDiscoveries: funnelEvents.length,
    resolutionAttempts: funnelEvents.filter((event) => event.resolution !== "not-assessed").length,
    resolved: funnelEvents.filter((event) => event.resolution === "qualified").length,
    terminalResolutionRejected: funnelEvents.filter((event) => event.resolution === "rejected").length,
    paired: funnelEvents.filter((event) => event.pairing === "qualified").length,
    unpaired: funnelEvents.filter((event) => event.pairing === "rejected").length,
    preflightAssessed: funnelEvents.filter((event) => event.preflight !== "not-assessed").length,
    preflightQualified: funnelEvents.filter((event) => event.preflight === "qualified").length,
    preflightRejected: funnelEvents.filter((event) => event.preflight === "rejected").length,
    evidenceQualified: funnelEvents.filter((event) => event.evidence === "qualified").length,
    evidenceRejected: funnelEvents.filter((event) => event.evidence === "rejected").length,
    duplicateSurviving: funnelEvents.filter((event) => event.duplicate === "surviving").length,
    duplicateBlocked: funnelEvents.filter((event) => event.duplicate === "blocked").length,
    ranked: funnelEvents.filter((event) => event.ranking !== "not-assessed").length,
    providerSelected: funnelEvents.filter((event) => event.ranking === "selected").length,
    providerDeferred: funnelEvents.filter((event) => event.ranking === "deferred").length,
  } : null;
  return { schemaVersion: telemetry.schemaVersion, run: telemetry.run, lease: telemetry.lease, accounting, operations, funnel,
    candidateSequence: telemetry.candidateSequence ?? null, consideredCandidates: telemetry.candidateSequence?.consideredCount ?? candidates.length,
    dispositionCounts, reasonOccurrenceCounts,
    sourcePreflightRejectedCandidates: dispositionCounts["rejected:source-preflight"] ?? 0,
    providerCandidates: candidates.filter((candidate) => candidate.providerWorkStarted).length,
    providerRetries: attempts.filter((attempt) => attempt.retryOfAttemptId !== null).length,
    tpm429s: attempts.filter((attempt) => attempt.httpStatus === 429).length,
    tpdFailures: attempts.filter((attempt) => attempt.providerErrorCode === "tokens-per-day").length,
    rejectedCandidates, reasonOccurrences: Object.values(reasonOccurrenceCounts).reduce((sum, count) => sum + count, 0),
    readyInsertions: (telemetry.readyInsertions ?? []).filter((entry) => entry.enqueueResult === "INSERTED").length,
    reserveControl: telemetry.reserveControl ?? null,
    queueObservations: telemetry.queueObservations ?? [], rlsObservations: telemetry.rlsObservations ?? [], timing: telemetry.timing };
}
