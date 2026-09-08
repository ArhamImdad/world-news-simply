import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  getPublicationConfig,
  replenishmentDeficit,
  replenishmentFillTarget,
} from "@/lib/publication-config";
import {
  createReserveFillControl,
  recordSkippedProviderWork,
  recordSuccessfulEnqueue,
  shouldStartProviderWork,
} from "@/lib/reserve-fill-control";
import { enqueueReadyArticle, type EnqueueDisposition, type PreparedArticleInsert } from "@/lib/publication-queue";
import type { SupabaseClient } from "@supabase/supabase-js";

function config(minimum = 8, target = 18, maximum = 30) {
  return { ...getPublicationConfig(), minimum, target, maximum };
}

function simulate(start: number, target: number, outcomes: Array<"success" | "failure">,
  liveDepthBeforeNext?: (current: number, started: number) => number) {
  const control = createReserveFillControl(start, target);
  let depth = start;
  let providerStarted = 0;
  for (const outcome of outcomes) {
    const liveDepth = liveDepthBeforeNext?.(depth, providerStarted) ?? depth;
    depth = liveDepth;
    if (!shouldStartProviderWork(control, liveDepth)) {
      recordSkippedProviderWork(control, outcomes.length - providerStarted);
      break;
    }
    providerStarted += 1;
    if (outcome === "success" && depth < target) {
      depth += 1;
      recordSuccessfulEnqueue(control, `candidate-${providerStarted}`, depth);
    }
  }
  control.finalObservedReadyDepth = depth;
  return { control, depth, providerStarted };
}

class AtomicReadyStore {
  depth: number;
  private tail = Promise.resolve();
  private keys = new Set<string>();
  constructor(depth: number) { this.depth = depth; }
  enqueue(target: number, maximum: number, key: string, leaseOwned = true) {
    const operation = this.tail.then((): EnqueueDisposition => {
      if (!leaseOwned) return "LEASE_NOT_OWNED";
      if (this.depth >= target) return "TARGET_REACHED";
      if (this.depth >= maximum) return "MAX_DEPTH_REACHED";
      if (this.keys.has(key)) return "DUPLICATE";
      this.keys.add(key);
      this.depth += 1;
      return "INSERTED";
    });
    this.tail = operation.then(() => undefined);
    return operation;
  }
  publish() { this.depth = Math.max(0, this.depth - 1); }
}

describe("reserve deficit and provider attempt separation", () => {
  it("preserves 8/18/30 semantics and gives low runs a floor fill target", () => {
    const value = config();
    expect([value.minimum, value.target, value.maximum]).toEqual([8, 18, 30]);
    expect([0, 6, 7].map((depth) => replenishmentFillTarget(depth, value))).toEqual([8, 8, 8]);
    expect([8, 9].map((depth) => replenishmentFillTarget(depth, value))).toEqual([18, 18]);
    expect(replenishmentDeficit(7, value)).toBe(1);
  });

  it("reproduces the historical two-cap case as 7 to 8 and skips candidate two", () => {
    const result = simulate(7, 8, ["success", "success"]);
    expect(result).toMatchObject({ depth: 8, providerStarted: 1,
      control: { initialDeficit: 1, successfulEnqueues: 1,
        targetReachedAt: "candidate-1", providerWorkSkippedAfterDeficitSatisfied: 1 } });
  });

  it("keeps fallback: first failure allows the second candidate to succeed", () => {
    expect(simulate(7, 8, ["failure", "success"])).toMatchObject({
      depth: 8, providerStarted: 2, control: { successfulEnqueues: 1 },
    });
  });

  it("allows exactly two successes for a two-slot deficit", () => {
    expect(simulate(6, 8, ["success", "success", "success"])).toMatchObject({
      depth: 8, providerStarted: 2, control: { successfulEnqueues: 2,
        providerWorkSkippedAfterDeficitSatisfied: 1 },
    });
  });

  it("allows failure fallback until two successful slots are filled", () => {
    expect(simulate(6, 8, ["failure", "success", "success"])).toMatchObject({
      depth: 8, providerStarted: 3, control: { successfulEnqueues: 2 },
    });
  });

  it.each([8, 9])("starts no provider work at or above an explicit fill target: depth %s", (depth) => {
    expect(simulate(depth, 8, ["success", "success"])).toMatchObject({ depth, providerStarted: 0,
      control: { successfulEnqueues: 0, providerWorkSkippedAfterDeficitSatisfied: 2 } });
  });

  it("re-opens a legitimate slot when publication consumes READY during the run", () => {
    const result = simulate(7, 8, ["success", "success"], (depth, started) => started === 1 ? depth - 1 : depth);
    expect(result).toMatchObject({ depth: 8, providerStarted: 2, control: { successfulEnqueues: 2 } });
  });

  it("stops later provider work after an atomic TARGET_REACHED race", () => {
    const control = createReserveFillControl(7, 8);
    control.targetReachedAt = "candidate-1";
    expect(control.successfulEnqueues).toBe(0);
    expect(shouldStartProviderWork(control, 8)).toBe(false);
  });
});

describe("atomic enqueue target fence", () => {
  it("allows exactly one of two competing inserts at depth seven", async () => {
    const store = new AtomicReadyStore(7);
    const results = await Promise.all([store.enqueue(8, 30, "a"), store.enqueue(8, 30, "b")]);
    expect(results.sort()).toEqual(["INSERTED", "TARGET_REACHED"]);
    expect(store.depth).toBe(8);
  });

  it("allows a new slot after publication and preserves duplicate, lease, and maximum dispositions", async () => {
    const store = new AtomicReadyStore(7);
    expect(await store.enqueue(8, 30, "a")).toBe("INSERTED");
    store.publish();
    expect(await store.enqueue(8, 30, "b")).toBe("INSERTED");
    store.publish();
    expect(await store.enqueue(8, 30, "b")).toBe("DUPLICATE");
    expect(await store.enqueue(8, 30, "c", false)).toBe("LEASE_NOT_OWNED");
    const maximum = new AtomicReadyStore(8);
    expect(await maximum.enqueue(30, 8, "a")).toBe("MAX_DEPTH_REACHED");
  });

  it("passes fill target to the owned RPC and parses explicit target disposition", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ article_id: null, disposition: "TARGET_REACHED", ready_depth: 8 }], error: null });
    const database = { rpc } as unknown as SupabaseClient;
    await expect(enqueueReadyArticle({} as PreparedArticleInsert, 30, 8,
      { systemKey: "system", runId: "run" }, database)).resolves.toEqual({
        articleId: null, disposition: "TARGET_REACHED", readyDepth: 8,
      });
    expect(rpc).toHaveBeenCalledWith("enqueue_ready_article_owned", expect.objectContaining({
      p_max_queue_depth: 30, p_fill_target: 8, p_system_key: "system", p_replenishment_run_id: "run",
    }));
  });

  it("defines the database check under the existing advisory and lease fences", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260830010000_enforce_replenishment_fill_target.sql"), "utf8");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('autonomous-ready-queue'))");
    expect(sql).toContain("ready_row_is_eligible(candidate, p_permitted_source_ids, now())");
    expect(sql).toContain("'TARGET_REACHED'::text");
    expect(sql).toContain("'MAX_DEPTH_REACHED'::text");
    expect(sql).toContain("'DUPLICATE'::text");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.enqueue_ready_article_owned(jsonb, integer, text[], text, uuid)");
  });
});
