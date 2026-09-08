import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupStagingReserveRuns,
  inspectStagingReserveState,
  reserveHarnessMayStart,
  validateCleanStagingBaseline,
  type CleanupRepository,
  type StagingBaselineCounts,
  type StagingInspection,
} from "@/lib/staging-reserve-control";
import { measureReadyVisibility } from "@/lib/replenishment-visibility";
import type { SupabaseClient } from "@supabase/supabase-js";

const RUN_A = "11111111-1111-4111-8111-111111111111";
const RUN_B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.stubEnv("APP_ENV", "staging");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://xfmbyxjevjliiwndcrpr.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-fixture-key");
});
afterEach(() => vi.unstubAllEnvs());

function zeroCounts(overrides: Partial<StagingBaselineCounts> = {}): StagingBaselineCounts {
  return { totalArticles: 0, draftArticles: 0, readyArticles: 0, eligibleReadyArticles: 0,
    approvedArticles: 0, rejectedArticles: 0, expiredArticles: 0, publicationSlots: 0,
    activeLeases: 0, expiredLeases: 0, attributionRows: 0, anonVisibleReady: 0,
    authenticatedVisibleReady: 0, serviceVisibleReady: 0, ...overrides };
}

function inspection(counts = zeroCounts()): StagingInspection {
  const validation = validateCleanStagingBaseline(counts);
  return { schemaVersion: "staging-reserve-inspection-v1", inspectedAt: "2026-08-26T00:00:00.000Z",
    environmentMode: "staging", projectRef: "xfmbyxjevjliiwndcrpr", counts,
    temporaryAuthUserDeleted: null, success: true, cleanBaseline: validation.valid,
    mismatches: validation.mismatches };
}

function fakeRepository(options: { activeRunId?: string; unrelated?: boolean; residual?: boolean } = {}) {
  const owned = new Set(["owned-article"]);
  const unrelated = new Set(options.unrelated ? ["unrelated-article"] : []);
  const attribution = new Map([[RUN_A, new Set(["owned-article"])]]);
  let activeRunId = options.activeRunId;
  let expiredLease = false;
  const inspect = async () => {
    const total = owned.size + unrelated.size + (options.residual ? 1 : 0);
    return inspection(zeroCounts({ totalArticles: total, draftArticles: total,
      readyArticles: total, eligibleReadyArticles: total, publicationSlots: owned.size,
      activeLeases: activeRunId ? 1 : 0, expiredLeases: expiredLease ? 1 : 0,
      attributionRows: [...attribution.values()].reduce((sum, ids) => sum + ids.size, 0),
      serviceVisibleReady: total }));
  };
  const repository: CleanupRepository = {
    inspect,
    async activeLeases() { return activeRunId ? [{ runId: activeRunId, expiresAt: "future" }] : []; },
    async attributedArticleIds(runIds) {
      return runIds.flatMap((runId) => [...(attribution.get(runId) ?? [])]);
    },
    async deleteArticles(ids) {
      let deleted = 0;
      for (const id of ids) if (owned.delete(id)) deleted += 1;
      for (const [runId, attributed] of attribution) {
        for (const id of ids) attributed.delete(id);
        if (attributed.size === 0) attribution.delete(runId);
      }
      return deleted;
    },
    async deleteExpiredLeases(runIds) {
      if (expiredLease && runIds.includes(RUN_A)) { expiredLease = false; return 1; }
      return 0;
    },
  };
  return { repository, owned, unrelated, attribution,
    release() { activeRunId = undefined; }, setExpiredLease() { expiredLease = true; } };
}

describe("guarded staging reserve inspection and cleanup", () => {
  it("rejects production inspection before making a database call", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://mgfnosozkomhinsaztbs.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://news.example.com");
    const from = vi.fn();
    await expect(inspectStagingReserveState({ from } as unknown as SupabaseClient))
      .rejects.toThrow(/canonical staging environment/);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects production cleanup before making a repository call", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://mgfnosozkomhinsaztbs.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://news.example.com");
    const inspect = vi.fn();
    const repository = { inspect, activeLeases: vi.fn(), attributedArticleIds: vi.fn(),
      deleteArticles: vi.fn(), deleteExpiredLeases: vi.fn() } as unknown as CleanupRepository;
    await expect(cleanupStagingReserveRuns(repository, [RUN_A]))
      .rejects.toThrow(/canonical staging environment/);
    expect(inspect).not.toHaveBeenCalled();
  });

  it("accepts the exact direct zero baseline and lets the reserve harness start", () => {
    expect(validateCleanStagingBaseline(zeroCounts())).toEqual({ valid: true, mismatches: [] });
    expect(reserveHarnessMayStart(inspection())).toEqual({ allowed: true, reasons: [] });
  });

  it.each([
    ["article", { totalArticles: 1 }], ["active lease", { activeLeases: 1 }],
    ["attribution", { attributionRows: 1 }], ["publication slot", { publicationSlots: 1 }],
    ["anon visibility", { anonVisibleReady: 1 }],
  ])("blocks a dirty baseline containing %s", (_name, override) => {
    const result = validateCleanStagingBaseline(zeroCounts(override));
    expect(result.valid).toBe(false);
    expect(reserveHarnessMayStart(inspection(zeroCounts(override))).allowed).toBe(false);
  });

  it("measures anon, authenticated, and service READY visibility directly", async () => {
    const result = await measureReadyVisibility({ serviceClient: {} as SupabaseClient,
      directDatabaseUrl: "fixture", directRoleCounter: async () => ({ anon: 0, authenticated: 0, service: 1 }) });
    expect(result).toMatchObject({ anonVisibleReady: 0, authenticatedVisibleReady: 0, serviceReady: 1 });
  });

  it("always removes its temporary authenticated principal", async () => {
    const deleteUser = vi.fn(async () => ({ error: null }));
    const service = { auth: { admin: { createUser: vi.fn(async () => ({ error: null,
      data: { user: { id: "temporary-user" } } })), deleteUser } } } as unknown as SupabaseClient;
    const clients = [{ auth: {} }, { auth: { signInWithPassword: vi.fn(async () => ({ error: null })),
      signOut: vi.fn(async () => undefined) } }];
    let index = 0;
    const result = await measureReadyVisibility({ serviceClient: service, directDatabaseUrl: null,
      publicUrl: "https://fixture.supabase.co", anonKey: "fixture",
      publicClientFactory: (() => clients[index++] as unknown as SupabaseClient) as never,
      readyCounter: async (client) => client === service ? 1 : 0 });
    expect(result.temporaryAuthUserDeleted).toBe(true);
    expect(deleteUser).toHaveBeenCalledWith("temporary-user");
  });

  it("removes only run-attributed articles, cascades attribution, and clears their slots", async () => {
    const state = fakeRepository();
    const result = await cleanupStagingReserveRuns(state.repository, [RUN_A]);
    expect(result).toMatchObject({ deletedArticles: 1, success: true,
      after: { counts: { attributionRows: 0, publicationSlots: 0 } } });
    expect(state.owned.size).toBe(0);
    expect(state.attribution.size).toBe(0);
  });

  it("leaves unrelated staging rows untouched and fails the zero-baseline postcondition", async () => {
    const state = fakeRepository({ unrelated: true });
    const result = await cleanupStagingReserveRuns(state.repository, [RUN_A]);
    expect(result.success).toBe(false);
    expect(state.unrelated.has("unrelated-article")).toBe(true);
  });

  it.each([["owned", RUN_A], ["foreign", RUN_B]])("refuses an active %s lease and succeeds after release", async (_name, runId) => {
    const state = fakeRepository({ activeRunId: runId });
    await expect(cleanupStagingReserveRuns(state.repository, [RUN_A])).rejects.toThrow(/active replenishment lease/);
    expect(state.owned.size).toBe(1);
    state.release();
    await expect(cleanupStagingReserveRuns(state.repository, [RUN_A])).resolves.toMatchObject({ success: true });
  });

  it("is idempotent and safely removes a targeted expired lease", async () => {
    const state = fakeRepository();
    state.setExpiredLease();
    const first = await cleanupStagingReserveRuns(state.repository, [RUN_A]);
    const second = await cleanupStagingReserveRuns(state.repository, [RUN_A]);
    expect(first).toMatchObject({ deletedArticles: 1, deletedExpiredLeases: 1, success: true });
    expect(second).toMatchObject({ deletedArticles: 0, deletedExpiredLeases: 0, success: true });
  });

  it("reports residual state after owned cleanup", async () => {
    const result = await cleanupStagingReserveRuns(fakeRepository({ residual: true }).repository, [RUN_A]);
    expect(result.success).toBe(false);
    expect(result.residualMismatches.some((reason) => reason.startsWith("totalArticles"))).toBe(true);
  });
});
