export type ReserveFillControl = {
  readyDepthAtStart: number;
  configuredFillTarget: number;
  initialDeficit: number;
  successfulEnqueues: number;
  targetReachedAt: string | null;
  providerWorkSkippedAfterDeficitSatisfied: number;
  finalObservedReadyDepth: number | null;
};

export function createReserveFillControl(readyDepthAtStart: number, configuredFillTarget: number): ReserveFillControl {
  if (!Number.isInteger(readyDepthAtStart) || readyDepthAtStart < 0) {
    throw new Error("ready depth must be a non-negative integer");
  }
  if (!Number.isInteger(configuredFillTarget) || configuredFillTarget < 1) {
    throw new Error("fill target must be a positive integer");
  }
  return {
    readyDepthAtStart,
    configuredFillTarget,
    initialDeficit: Math.max(0, configuredFillTarget - readyDepthAtStart),
    successfulEnqueues: 0,
    targetReachedAt: null,
    providerWorkSkippedAfterDeficitSatisfied: 0,
    finalObservedReadyDepth: null,
  };
}

/**
 * The initial deficit is the normal success budget. A live depth below the
 * target re-opens work only when queue consumption created a legitimate slot.
 * The enqueue RPC remains authoritative for the final atomic decision.
 */
export function shouldStartProviderWork(control: ReserveFillControl, liveEligibleReadyDepth: number) {
  return liveEligibleReadyDepth < control.configuredFillTarget;
}

export function recordSuccessfulEnqueue(
  control: ReserveFillControl,
  candidateTelemetryId: string,
  readyDepthAfterInsert: number
) {
  control.successfulEnqueues += 1;
  if (readyDepthAfterInsert >= control.configuredFillTarget && !control.targetReachedAt) {
    control.targetReachedAt = candidateTelemetryId;
  }
}

export function recordSkippedProviderWork(control: ReserveFillControl, skipped: number) {
  control.providerWorkSkippedAfterDeficitSatisfied += Math.max(0, skipped);
}
