import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProviderUsageEvent } from "@/lib/provider-runtime";
import { assertWritesAllowed } from "@/lib/environment-isolation";

export const REPLENISHMENT_SYSTEM_KEY = "autonomous-publication";
export const REPLENISHMENT_LEASE_TTL_MS = 180_000;
export const REPLENISHMENT_HEARTBEAT_MS = 60_000;
export const REPLENISHMENT_OWNERSHIP_MAX_ATTEMPTS = 2;
export const REPLENISHMENT_OWNERSHIP_RETRY_DELAY_MS = 250;

export type LeaseOwnershipOutcome = "TRUE" | "FALSE" | "TRANSPORT_TIMEOUT" | "NETWORK_ERROR" | "RPC_ERROR";
export type LeaseOwnershipAttempt = {
  attempt: number;
  startedAt: string;
  endedAt: string;
  latencyMs: number;
  outcome: LeaseOwnershipOutcome;
  retryPerformed: boolean;
  retryReason: "TRANSPORT_TIMEOUT" | "NETWORK_ERROR" | null;
};

export class ReplenishmentLeaseRpcError extends Error {
  constructor(readonly rpcName: string, readonly kind: "transport-timeout" | "network-error" | "rpc-error",
    message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ReplenishmentLeaseRpcError";
  }
}

export function leaseOwnershipFailureOutcome(error: unknown): Extract<LeaseOwnershipOutcome,
  "TRANSPORT_TIMEOUT" | "NETWORK_ERROR" | "RPC_ERROR"> {
  if (error instanceof ReplenishmentLeaseRpcError) {
    return error.kind === "transport-timeout" ? "TRANSPORT_TIMEOUT"
      : error.kind === "network-error" ? "NETWORK_ERROR" : "RPC_ERROR";
  }
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/AbortError|aborted|timed?\s*out/i.test(message)) return "TRANSPORT_TIMEOUT";
  if (/fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(message)) return "NETWORK_ERROR";
  return "RPC_ERROR";
}

export class ReplenishmentLeaseUnavailableError extends Error {
  constructor(message = "Another replenishment run owns the active lease.") {
    super(message);
    this.name = "ReplenishmentLeaseUnavailableError";
  }
}

export class ReplenishmentLeaseLostError extends Error {
  constructor(message = "The replenishment run no longer owns its lease.", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ReplenishmentLeaseLostError";
  }
}

export class ReplenishmentRunIntegrityError extends Error {
  constructor(message = "Foreign replenishment-run activity was detected.") {
    super(message);
    this.name = "ReplenishmentRunIntegrityError";
  }
}

export interface ReplenishmentLeaseStore {
  acquire(systemKey: string, runId: string, ttlSeconds: number): Promise<boolean>;
  renew(systemKey: string, runId: string, ttlSeconds: number): Promise<boolean>;
  owns(systemKey: string, runId: string): Promise<boolean>;
  release(systemKey: string, runId: string): Promise<boolean>;
}

export class SupabaseReplenishmentLeaseStore implements ReplenishmentLeaseStore {
  constructor(private readonly database: SupabaseClient) {}

  private async booleanRpc(name: string, parameters: Record<string, unknown>) {
    assertWritesAllowed(`service-role RPC ${name}`);
    const { data, error } = await this.database.rpc(name, parameters);
    if (error) {
      const kind = /AbortError|aborted|timed?\s*out/i.test(error.message) ? "transport-timeout"
        : /fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(error.message) ? "network-error" : "rpc-error";
      throw new ReplenishmentLeaseRpcError(name, kind,
        `Replenishment lease RPC ${name} failed: ${error.message}`, { cause: error });
    }
    return data === true;
  }

  acquire(systemKey: string, runId: string, ttlSeconds: number) {
    return this.booleanRpc("acquire_replenishment_run_lease", {
      p_system_key: systemKey, p_run_id: runId, p_ttl_seconds: ttlSeconds,
    });
  }

  renew(systemKey: string, runId: string, ttlSeconds: number) {
    return this.booleanRpc("renew_replenishment_run_lease", {
      p_system_key: systemKey, p_run_id: runId, p_ttl_seconds: ttlSeconds,
    });
  }

  owns(systemKey: string, runId: string) {
    return this.booleanRpc("owns_replenishment_run_lease", {
      p_system_key: systemKey, p_run_id: runId,
    });
  }

  release(systemKey: string, runId: string) {
    return this.booleanRpc("release_replenishment_run_lease", {
      p_system_key: systemKey, p_run_id: runId,
    });
  }
}

export type ReplenishmentLeaseOptions = {
  runId?: string;
  systemKey?: string;
  ttlMs?: number;
  heartbeatMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  observer?: ReplenishmentLeaseObserver;
  ownershipRetryDelayMs?: number;
  waitFn?: (milliseconds: number) => Promise<void>;
};

export type ReplenishmentLeaseObserver = {
  acquisitionAttempted?(at: string): void;
  acquired?(runId: string, at: string): void;
  acquisitionFailed?(at: string): void;
  ownershipChecked?(owned: boolean, at: string): void;
  ownershipAttempt?(attempt: LeaseOwnershipAttempt): void;
  ownershipIndeterminate?(outcome: Extract<LeaseOwnershipOutcome,
    "TRANSPORT_TIMEOUT" | "NETWORK_ERROR" | "RPC_ERROR">, at: string): void;
  heartbeat?(success: boolean, at: string): void;
  leaseLost?(at: string): void;
  releaseAttempted?(at: string): void;
  released?(success: boolean, at: string): void;
};

export class ReplenishmentRunLease {
  readonly runId: string;
  readonly systemKey: string;
  readonly ttlMs: number;
  readonly heartbeatMs: number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private lost = false;
  private readonly observer?: ReplenishmentLeaseObserver;
  private readonly ownershipRetryDelayMs: number;
  private readonly waitFn: (milliseconds: number) => Promise<void>;

  constructor(private readonly store: ReplenishmentLeaseStore, options: ReplenishmentLeaseOptions = {}) {
    this.runId = options.runId ?? crypto.randomUUID();
    this.systemKey = options.systemKey ?? REPLENISHMENT_SYSTEM_KEY;
    this.ttlMs = options.ttlMs ?? REPLENISHMENT_LEASE_TTL_MS;
    this.heartbeatMs = options.heartbeatMs ?? REPLENISHMENT_HEARTBEAT_MS;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
    this.observer = options.observer;
    this.ownershipRetryDelayMs = Math.max(0, options.ownershipRetryDelayMs ?? REPLENISHMENT_OWNERSHIP_RETRY_DELAY_MS);
    this.waitFn = options.waitFn ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    if (this.heartbeatMs <= 0 || this.heartbeatMs >= this.ttlMs) {
      throw new Error("Replenishment heartbeat must be positive and shorter than the lease TTL.");
    }
  }

  private ttlSeconds() {
    return Math.max(1, Math.ceil(this.ttlMs / 1_000));
  }

  async acquire() {
    assertWritesAllowed("replenishment lease acquisition");
    const attemptedAt = new Date().toISOString();
    this.observer?.acquisitionAttempted?.(attemptedAt);
    if (!await this.store.acquire(this.systemKey, this.runId, this.ttlSeconds())) {
      this.observer?.acquisitionFailed?.(new Date().toISOString());
      throw new ReplenishmentLeaseUnavailableError();
    }
    this.active = true;
    this.lost = false;
    this.observer?.acquired?.(this.runId, new Date().toISOString());
    this.heartbeat = this.setIntervalFn(() => {
      void this.renew().catch(() => { this.lost = true; });
    }, this.heartbeatMs);
    const timer = this.heartbeat as unknown as { unref?: () => void };
    timer.unref?.();
    return this;
  }

  async renew() {
    assertWritesAllowed("replenishment lease renewal");
    if (!this.active || this.lost) {
      const at = new Date().toISOString();
      this.observer?.heartbeat?.(false, at);
      this.observer?.leaseLost?.(at);
      throw new ReplenishmentLeaseLostError();
    }
    let renewed: boolean;
    try {
      renewed = await this.store.renew(this.systemKey, this.runId, this.ttlSeconds());
    } catch (error) {
      this.lost = true;
      const at = new Date().toISOString();
      this.observer?.heartbeat?.(false, at);
      this.observer?.leaseLost?.(at);
      throw new ReplenishmentLeaseLostError("Replenishment lease heartbeat could not establish continued ownership.",
        { cause: error });
    }
    if (!renewed) {
      this.lost = true;
      const at = new Date().toISOString();
      this.observer?.heartbeat?.(false, at);
      this.observer?.leaseLost?.(at);
      throw new ReplenishmentLeaseLostError();
    }
    this.observer?.heartbeat?.(true, new Date().toISOString());
  }

  async assertOwned(signal?: AbortSignal) {
    if (signal?.aborted) {
      const at = new Date().toISOString();
      this.observer?.ownershipChecked?.(false, at);
      this.observer?.leaseLost?.(at);
      throw new ReplenishmentLeaseLostError("Replenishment shutdown was requested.");
    }
    if (!this.active || this.lost) {
      const at = new Date().toISOString();
      this.observer?.ownershipChecked?.(false, at);
      this.observer?.leaseLost?.(at);
      throw new ReplenishmentLeaseLostError();
    }
    for (let attempt = 1; attempt <= REPLENISHMENT_OWNERSHIP_MAX_ATTEMPTS; attempt += 1) {
      const started = Date.now();
      const startedAt = new Date(started).toISOString();
      try {
        const owned = await this.store.owns(this.systemKey, this.runId);
        const ended = Date.now();
        this.observer?.ownershipAttempt?.({ attempt, startedAt, endedAt: new Date(ended).toISOString(),
          latencyMs: Math.max(0, ended - started), outcome: owned ? "TRUE" : "FALSE",
          retryPerformed: false, retryReason: null });
        this.observer?.ownershipChecked?.(owned, new Date(ended).toISOString());
        if (owned) return;
        this.lost = true;
        this.observer?.leaseLost?.(new Date(ended).toISOString());
        throw new ReplenishmentLeaseLostError();
      } catch (error) {
        if (error instanceof ReplenishmentLeaseLostError) throw error;
        const outcome = leaseOwnershipFailureOutcome(error);
        const retryPerformed = attempt === 1 && (outcome === "TRANSPORT_TIMEOUT" || outcome === "NETWORK_ERROR");
        const ended = Date.now();
        this.observer?.ownershipAttempt?.({ attempt, startedAt, endedAt: new Date(ended).toISOString(),
          latencyMs: Math.max(0, ended - started), outcome, retryPerformed,
          retryReason: retryPerformed ? outcome : null });
        if (retryPerformed) {
          await this.waitFn(this.ownershipRetryDelayMs);
          continue;
        }
        this.lost = true;
        this.observer?.ownershipIndeterminate?.(outcome, new Date(ended).toISOString());
        throw new ReplenishmentLeaseLostError(
          `Replenishment lease ownership is indeterminate after ${attempt} RPC attempt${attempt === 1 ? "" : "s"}.`,
          { cause: error });
      }
    }
    {
      this.lost = true;
      const at = new Date().toISOString();
      this.observer?.ownershipIndeterminate?.("RPC_ERROR", at);
      throw new ReplenishmentLeaseLostError("Replenishment lease ownership could not be established.");
    }
  }

  async release() {
    assertWritesAllowed("replenishment lease release");
    this.observer?.releaseAttempted?.(new Date().toISOString());
    if (this.heartbeat) this.clearIntervalFn(this.heartbeat);
    this.heartbeat = null;
    const wasActive = this.active;
    this.active = false;
    if (!wasActive) {
      this.observer?.released?.(false, new Date().toISOString());
      return false;
    }
    const released = await this.store.release(this.systemKey, this.runId);
    this.observer?.released?.(released, new Date().toISOString());
    return released;
  }

  isLost() {
    return this.lost;
  }
}

export function validateReplenishmentRunIntegrity(options: {
  runId: string;
  providerEvents: Array<Pick<ProviderUsageEvent, "runId">>;
  attributedRunIds: string[];
  leaseLost: boolean;
}) {
  if (options.leaseLost || options.providerEvents.some((event) => event.runId !== options.runId) ||
      options.attributedRunIds.some((runId) => runId !== options.runId)) {
    throw new ReplenishmentRunIntegrityError();
  }
  return true;
}

export async function guardedByReplenishmentLease<T>(
  lease: Pick<ReplenishmentRunLease, "assertOwned">,
  action: () => Promise<T>,
  signal?: AbortSignal
) {
  await lease.assertOwned(signal);
  return action();
}
