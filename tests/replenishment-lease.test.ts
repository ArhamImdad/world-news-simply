import { describe, expect, it, vi } from "vitest";
import {
  guardedByReplenishmentLease,
  ReplenishmentLeaseLostError,
  ReplenishmentLeaseRpcError,
  ReplenishmentLeaseUnavailableError,
  ReplenishmentRunIntegrityError,
  ReplenishmentRunLease,
  SupabaseReplenishmentLeaseStore,
  validateReplenishmentRunIntegrity,
  type ReplenishmentLeaseStore,
} from "@/lib/replenishment-lease";
import {
  executeAccountedProviderAttempt,
  ProviderAttemptLedger,
  ProviderRequestBudget,
  ProviderTokenPacer,
} from "@/lib/provider-runtime";

class MemoryLeaseStore implements ReplenishmentLeaseStore {
  now = 0;
  lease: { systemKey: string; runId: string; expiresAt: number } | null = null;

  async acquire(systemKey: string, runId: string, ttlSeconds: number) {
    if (this.lease?.systemKey === systemKey && this.lease.runId !== runId && this.lease.expiresAt > this.now) return false;
    this.lease = { systemKey, runId, expiresAt: this.now + ttlSeconds * 1_000 };
    return true;
  }
  async renew(systemKey: string, runId: string, ttlSeconds: number) {
    if (!this.lease || this.lease.systemKey !== systemKey || this.lease.runId !== runId || this.lease.expiresAt <= this.now) return false;
    this.lease.expiresAt = this.now + ttlSeconds * 1_000;
    return true;
  }
  async owns(systemKey: string, runId: string) {
    return Boolean(this.lease && this.lease.systemKey === systemKey && this.lease.runId === runId && this.lease.expiresAt > this.now);
  }
  async release(systemKey: string, runId: string) {
    if (!this.lease || this.lease.systemKey !== systemKey || this.lease.runId !== runId) return false;
    this.lease = null;
    return true;
  }
}

const noTimer = {
  setIntervalFn: (() => ({ unref() {} })) as unknown as typeof setInterval,
  clearIntervalFn: (() => undefined) as unknown as typeof clearInterval,
};

function lease(store: MemoryLeaseStore, runId: string) {
  return new ReplenishmentRunLease(store, {
    ...noTimer, runId, ttlMs: 30_000, heartbeatMs: 10_000,
  });
}

describe("database-backed replenishment lease contract", () => {
  it("classifies Supabase timeout, network, and semantic RPC failures without retrying mutating calls", async () => {
    for (const [message, kind] of [["AbortError: operation aborted", "transport-timeout"],
      ["TypeError: fetch failed", "network-error"], ["permission denied", "rpc-error"]] as const) {
      const database = { rpc: vi.fn(async () => ({ data: null, error: { message } })) };
      const store = new SupabaseReplenishmentLeaseStore(database as never);
      await expect(store.owns("system", "owner")).rejects.toMatchObject({ kind });
      expect(database.rpc).toHaveBeenCalledTimes(1);
    }
  });

  it("retries one transient ownership timeout and records the fresh TRUE response", async () => {
    const store = new MemoryLeaseStore();
    const owns = vi.spyOn(store, "owns")
      .mockRejectedValueOnce(new ReplenishmentLeaseRpcError("owns_replenishment_run_lease", "transport-timeout", "AbortError"))
      .mockResolvedValueOnce(true);
    const attempts: Array<{ outcome: string; retryPerformed: boolean }> = [];
    const owner = new ReplenishmentRunLease(store, { ...noTimer, runId: "owner", ttlMs: 30_000, heartbeatMs: 10_000,
      ownershipRetryDelayMs: 0, waitFn: async () => undefined,
      observer: { ownershipAttempt: (attempt) => attempts.push(attempt) } });
    await owner.acquire();
    await expect(owner.assertOwned()).resolves.toBeUndefined();
    expect(owns).toHaveBeenCalledTimes(2);
    expect(attempts).toMatchObject([{ outcome: "TRANSPORT_TIMEOUT", retryPerformed: true },
      { outcome: "TRUE", retryPerformed: false }]);
    await owner.release();
  });

  it("fails closed after a second ownership timeout", async () => {
    const store = new MemoryLeaseStore();
    const owns = vi.spyOn(store, "owns").mockRejectedValue(
      new ReplenishmentLeaseRpcError("owns_replenishment_run_lease", "transport-timeout", "AbortError"));
    const owner = new ReplenishmentRunLease(store, { ...noTimer, runId: "owner", ttlMs: 30_000, heartbeatMs: 10_000,
      ownershipRetryDelayMs: 0, waitFn: async () => undefined });
    await owner.acquire();
    await expect(owner.assertOwned()).rejects.toBeInstanceOf(ReplenishmentLeaseLostError);
    expect(owns).toHaveBeenCalledTimes(2);
    expect(owner.isLost()).toBe(true);
    await owner.release();
  });

  it("retries a network error once but not an explicit FALSE or semantic RPC error", async () => {
    const networkStore = new MemoryLeaseStore();
    const networkOwns = vi.spyOn(networkStore, "owns")
      .mockRejectedValueOnce(new ReplenishmentLeaseRpcError("owns_replenishment_run_lease", "network-error", "fetch failed"))
      .mockResolvedValueOnce(true);
    const networkOwner = new ReplenishmentRunLease(networkStore, { ...noTimer, runId: "network-owner",
      ttlMs: 30_000, heartbeatMs: 10_000, ownershipRetryDelayMs: 0, waitFn: async () => undefined });
    await networkOwner.acquire();
    await networkOwner.assertOwned();
    expect(networkOwns).toHaveBeenCalledTimes(2);
    await networkOwner.release();

    for (const [name, failure] of [["false", false], ["semantic", new ReplenishmentLeaseRpcError(
      "owns_replenishment_run_lease", "rpc-error", "permission denied")]] as const) {
      const store = new MemoryLeaseStore();
      const owns = vi.spyOn(store, "owns");
      if (failure === false) owns.mockResolvedValue(false);
      else owns.mockRejectedValue(failure);
      const owner = new ReplenishmentRunLease(store, { ...noTimer, runId: `${name}-owner`, ttlMs: 30_000,
        heartbeatMs: 10_000, ownershipRetryDelayMs: 0, waitFn: async () => undefined });
      await owner.acquire();
      await expect(owner.assertOwned()).rejects.toBeInstanceOf(ReplenishmentLeaseLostError);
      expect(owns).toHaveBeenCalledTimes(1);
      await owner.release();
    }
  });

  it("allows the first runner and rejects a concurrent second runner", async () => {
    const store = new MemoryLeaseStore();
    const first = lease(store, "run-a");
    const second = lease(store, "run-b");
    await first.acquire();
    await expect(second.acquire()).rejects.toBeInstanceOf(ReplenishmentLeaseUnavailableError);
    await first.release();
  });

  it("produces exactly one winner for simultaneous acquisition", async () => {
    const store = new MemoryLeaseStore();
    const contenders = [lease(store, "run-a"), lease(store, "run-b")];
    const results = await Promise.allSettled(contenders.map((contender) => contender.acquire()));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await contenders.find((contender) => contender.runId === store.lease?.runId)?.release();
  });

  it("renews only for the owner and extends expiry", async () => {
    const store = new MemoryLeaseStore();
    const owner = lease(store, "owner");
    await owner.acquire();
    const originalExpiry = store.lease?.expiresAt ?? 0;
    store.now = 5_000;
    await owner.renew();
    expect(store.lease?.expiresAt).toBeGreaterThan(originalExpiry);
    expect(await store.renew("autonomous-publication", "foreign", 30)).toBe(false);
    await owner.release();
  });

  it("marks the local lease lost when heartbeat ownership is indeterminate", async () => {
    const store = new MemoryLeaseStore();
    const owner = lease(store, "owner");
    await owner.acquire();
    vi.spyOn(store, "renew").mockRejectedValueOnce(new Error("network failure"));
    await expect(owner.renew()).rejects.toBeInstanceOf(ReplenishmentLeaseLostError);
    expect(owner.isLost()).toBe(true);
    await owner.release();
  });

  it("rejects non-owner release and unexpired takeover", async () => {
    const store = new MemoryLeaseStore();
    const owner = lease(store, "owner");
    await owner.acquire();
    expect(await store.release("autonomous-publication", "foreign")).toBe(false);
    await expect(lease(store, "foreign").acquire()).rejects.toBeInstanceOf(ReplenishmentLeaseUnavailableError);
    expect(await store.owns("autonomous-publication", "owner")).toBe(true);
    await owner.release();
  });

  it("allows deterministic takeover after expiry and fences the stale owner", async () => {
    const store = new MemoryLeaseStore();
    const stale = lease(store, "stale");
    await stale.acquire();
    store.now = 30_001;
    const replacement = lease(store, "replacement");
    await replacement.acquire();
    await expect(stale.assertOwned()).rejects.toBeInstanceOf(ReplenishmentLeaseLostError);
    await expect(stale.renew()).rejects.toBeInstanceOf(ReplenishmentLeaseLostError);
    await replacement.release();
  });

  it("refuses provider work when ownership is lost before the request", async () => {
    const store = new MemoryLeaseStore();
    const owner = lease(store, "owner");
    await owner.acquire();
    store.now = 30_001;
    const replacement = lease(store, "replacement");
    await replacement.acquire();
    const request = vi.fn(async () => ({ data: { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } }));
    const ledger = new ProviderAttemptLedger();
    await expect(executeAccountedProviderAttempt({
      runId: owner.runId,
      operation: "generation",
      estimatedTokens: 100,
      budget: new ProviderRequestBudget(1_000, 1_000),
      pacer: new ProviderTokenPacer(),
      ledger,
      beforeRequest: () => owner.assertOwned(),
      request,
      validate: () => true,
    })).rejects.toBeInstanceOf(ReplenishmentLeaseLostError);
    expect(request).not.toHaveBeenCalled();
    expect(ledger.records()).toEqual([]);
    await replacement.release();
  });

  it("refuses enqueue work after lease loss or cancellation", async () => {
    const store = new MemoryLeaseStore();
    const owner = lease(store, "owner");
    await owner.acquire();
    store.now = 30_001;
    const replacement = lease(store, "replacement");
    await replacement.acquire();
    const enqueue = vi.fn(async () => "article-id");
    await expect(guardedByReplenishmentLease(owner, enqueue)).rejects.toBeInstanceOf(ReplenishmentLeaseLostError);
    expect(enqueue).not.toHaveBeenCalled();
    await replacement.release();
  });

  it("releases on graceful completion and graceful cancellation", async () => {
    const store = new MemoryLeaseStore();
    const completed = lease(store, "completed");
    await completed.acquire();
    await completed.release();
    expect(store.lease).toBeNull();

    const cancelled = lease(store, "cancelled");
    await cancelled.acquire();
    const controller = new AbortController();
    controller.abort();
    await expect(cancelled.assertOwned(controller.signal)).rejects.toBeInstanceOf(ReplenishmentLeaseLostError);
    await cancelled.release();
    expect(store.lease).toBeNull();
  });

  it("models crash expiry and permits a later clean start", async () => {
    const store = new MemoryLeaseStore();
    await lease(store, "crashed").acquire();
    store.now = 30_001;
    const recovered = lease(store, "recovered");
    await recovered.acquire();
    expect(await store.owns("autonomous-publication", "recovered")).toBe(true);
    await recovered.release();
  });
});

describe("run attribution and integrity", () => {
  it("puts the immutable run ID on provider ledger records", async () => {
    const ledger = new ProviderAttemptLedger();
    await executeAccountedProviderAttempt({
      runId: "run-attributed",
      operation: "audit",
      attemptId: "attempt-attributed",
      estimatedTokens: 100,
      budget: new ProviderRequestBudget(1_000, 1_000),
      pacer: new ProviderTokenPacer(),
      ledger,
      request: async () => ({ data: { usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } } }),
      validate: () => true,
    });
    expect(ledger.records()[0].runId).toBe("run-attributed");
  });

  it("accepts matching provider/article attribution and detects foreign activity", () => {
    expect(validateReplenishmentRunIntegrity({
      runId: "owner", providerEvents: [{ runId: "owner" }], attributedRunIds: ["owner"], leaseLost: false,
    })).toBe(true);
    expect(() => validateReplenishmentRunIntegrity({
      runId: "owner", providerEvents: [{ runId: "foreign" }], attributedRunIds: ["owner"], leaseLost: false,
    })).toThrow(ReplenishmentRunIntegrityError);
    expect(() => validateReplenishmentRunIntegrity({
      runId: "owner", providerEvents: [{ runId: "owner" }], attributedRunIds: ["foreign"], leaseLost: false,
    })).toThrow(ReplenishmentRunIntegrityError);
  });
});
