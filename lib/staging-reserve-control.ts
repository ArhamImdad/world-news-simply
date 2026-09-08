import type { SupabaseClient } from "@supabase/supabase-js";
import { assertAppEnvironment, STAGING_SUPABASE_PROJECT_REF } from "@/lib/environment-isolation";
import { readyArticleFailures } from "@/lib/publication-policy";
import { permittedSourceIds, type PreparedArticleInsert } from "@/lib/publication-queue";
import { measureReadyVisibility } from "@/lib/replenishment-visibility";

export type StagingBaselineCounts = {
  totalArticles: number;
  draftArticles: number;
  readyArticles: number;
  eligibleReadyArticles: number;
  approvedArticles: number;
  rejectedArticles: number;
  expiredArticles: number;
  publicationSlots: number;
  activeLeases: number;
  expiredLeases: number;
  attributionRows: number;
  anonVisibleReady: number;
  authenticatedVisibleReady: number;
  serviceVisibleReady: number;
};

export type StagingInspection = {
  schemaVersion: "staging-reserve-inspection-v1";
  inspectedAt: string;
  environmentMode: "staging";
  projectRef: typeof STAGING_SUPABASE_PROJECT_REF;
  counts: StagingBaselineCounts;
  temporaryAuthUserDeleted: boolean | null;
  success: boolean;
  cleanBaseline: boolean;
  mismatches: string[];
};

const ZERO_BASELINE: Omit<StagingBaselineCounts, "expiredLeases"> = {
  totalArticles: 0, draftArticles: 0, readyArticles: 0, eligibleReadyArticles: 0,
  approvedArticles: 0, rejectedArticles: 0, expiredArticles: 0, publicationSlots: 0,
  activeLeases: 0, attributionRows: 0, anonVisibleReady: 0, authenticatedVisibleReady: 0,
  serviceVisibleReady: 0,
};

export function validateCleanStagingBaseline(counts: StagingBaselineCounts) {
  const mismatches = Object.entries(ZERO_BASELINE).flatMap(([name, expected]) => {
    const actual = counts[name as keyof StagingBaselineCounts];
    return actual === expected ? [] : [`${name}: expected ${expected}, observed ${actual}`];
  });
  return { valid: mismatches.length === 0, mismatches };
}

export function reserveHarnessMayStart(inspection: StagingInspection) {
  const validation = validateCleanStagingBaseline(inspection.counts);
  return { allowed: inspection.success && validation.valid,
    reasons: inspection.success ? validation.mismatches : ["staging inspection did not complete successfully"] };
}

async function exactCount(query: PromiseLike<{ count: number | null; error: { message: string } | null }>, label: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await query;
    if (!result.error) return result.count ?? 0;
    if (!/AbortError|aborted/i.test(result.error.message) || attempt === 2) {
      throw new Error(`${label} inspection failed: ${result.error.message}`);
    }
  }
  throw new Error(`${label} inspection failed after bounded retries.`);
}

const READY_SELECT = "id,title,summary,content,image_url,image_photographer_name,image_attribution_url,sources,publication_status,editorial_state,quality_score,category,prepared_at,publish_after,expires_at,freshness_class,content_pool,topic_signature,validation_results,generation_metadata";

export async function inspectStagingReserveState(serviceClient: SupabaseClient): Promise<StagingInspection> {
  const isolation = assertAppEnvironment();
  if (isolation.mode !== "staging" || isolation.expectedProjectRef !== STAGING_SUPABASE_PROJECT_REF) {
    throw new Error("Staging reserve inspection requires the canonical staging environment.");
  }
  const now = new Date();
  // Keep these control-plane reads sequential. A cold staging PostgREST endpoint
  // can starve a single Node connection pool when all checks are launched at
  // once, leaving the guarded harness without an authoritative baseline.
  const totalArticles = await exactCount(serviceClient.from("articles").select("id", { count: "exact", head: true }), "total articles");
  const draftArticles = await exactCount(serviceClient.from("articles").select("id", { count: "exact", head: true }).eq("publication_status", "draft"), "draft articles");
  const readyArticles = await exactCount(serviceClient.from("articles").select("id", { count: "exact", head: true }).eq("publication_status", "draft").eq("editorial_state", "ready"), "READY articles");
  const approvedArticles = await exactCount(serviceClient.from("articles").select("id", { count: "exact", head: true }).eq("publication_status", "approved"), "approved articles");
  const rejectedArticles = await exactCount(serviceClient.from("articles").select("id", { count: "exact", head: true }).eq("publication_status", "rejected"), "rejected articles");
  const expiredArticles = await exactCount(serviceClient.from("articles").select("id", { count: "exact", head: true }).eq("editorial_state", "expired"), "expired articles");
  const publicationSlots = await exactCount(serviceClient.from("articles").select("id", { count: "exact", head: true }).not("publication_slot", "is", null), "publication slots");
  const activeLeases = await exactCount(serviceClient.from("replenishment_run_leases").select("system_key", { count: "exact", head: true }).gt("expires_at", now.toISOString()), "active leases");
  const expiredLeases = await exactCount(serviceClient.from("replenishment_run_leases").select("system_key", { count: "exact", head: true }).lte("expires_at", now.toISOString()), "expired leases");
  const attributionRows = await exactCount(serviceClient.from("article_replenishment_attribution").select("article_id", { count: "exact", head: true }), "attribution rows");
  const readyQuery = serviceClient.from("articles").select(READY_SELECT)
    .eq("publication_status", "draft").eq("editorial_state", "ready");
  let readyRows = await readyQuery;
  for (let attempt = 1; readyRows.error && /AbortError|aborted/i.test(readyRows.error.message) && attempt < 3; attempt += 1) {
    readyRows = await readyQuery;
  }
  const visibility = await measureReadyVisibility({ serviceClient });
  if (readyRows.error) throw new Error(`Eligible READY inspection failed: ${readyRows.error.message}`);
  const permitted = new Set(permittedSourceIds());
  const eligibleReadyArticles = (readyRows.data ?? []).filter((row) =>
    readyArticleFailures(row as unknown as PreparedArticleInsert, permitted, now).length === 0).length;
  const counts: StagingBaselineCounts = { totalArticles, draftArticles, readyArticles, eligibleReadyArticles,
    approvedArticles, rejectedArticles, expiredArticles, publicationSlots, activeLeases, expiredLeases,
    attributionRows, anonVisibleReady: visibility.anonVisibleReady,
    authenticatedVisibleReady: visibility.authenticatedVisibleReady, serviceVisibleReady: visibility.serviceReady };
  const baseline = validateCleanStagingBaseline(counts);
  return { schemaVersion: "staging-reserve-inspection-v1", inspectedAt: new Date().toISOString(),
    environmentMode: "staging", projectRef: STAGING_SUPABASE_PROJECT_REF, counts,
    temporaryAuthUserDeleted: visibility.temporaryAuthUserDeleted, success: true,
    cleanBaseline: baseline.valid, mismatches: baseline.mismatches };
}

export type CleanupRepository = {
  inspect(): Promise<StagingInspection>;
  activeLeases(): Promise<Array<{ runId: string; expiresAt: string }>>;
  attributedArticleIds(runIds: string[]): Promise<string[]>;
  deleteArticles(articleIds: string[]): Promise<number>;
  deleteExpiredLeases(runIds: string[], at: string): Promise<number>;
};

export type StagingCleanupResult = {
  schemaVersion: "staging-reserve-cleanup-v1";
  requestedRunIds: string[];
  startedAt: string;
  endedAt: string;
  before: StagingInspection;
  deletedArticles: number;
  deletedExpiredLeases: number;
  after: StagingInspection;
  success: boolean;
  residualMismatches: string[];
};

export function validatedRunIds(values: string[]) {
  const ids = [...new Set(values.map((value) => value.trim().toLowerCase()))];
  if (ids.length === 0 || ids.some((value) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))) {
    throw new Error("Cleanup requires one or more valid UUID --run-id values.");
  }
  return ids;
}

export async function cleanupStagingReserveRuns(repository: CleanupRepository, suppliedRunIds: string[]) {
  const isolation = assertAppEnvironment();
  if (isolation.mode !== "staging" || isolation.expectedProjectRef !== STAGING_SUPABASE_PROJECT_REF) {
    throw new Error("Staging reserve cleanup requires the canonical staging environment.");
  }
  const runIds = validatedRunIds(suppliedRunIds);
  const startedAt = new Date().toISOString();
  const before = await repository.inspect();
  const liveLeases = await repository.activeLeases();
  if (liveLeases.length > 0) {
    throw new Error(`Cleanup refused because ${liveLeases.length} active replenishment lease(s) exist.`);
  }
  const articleIds = await repository.attributedArticleIds(runIds);
  const deletedArticles = articleIds.length > 0 ? await repository.deleteArticles(articleIds) : 0;
  const deletedExpiredLeases = await repository.deleteExpiredLeases(runIds, new Date().toISOString());
  const after = await repository.inspect();
  const postcondition = validateCleanStagingBaseline(after.counts);
  return { schemaVersion: "staging-reserve-cleanup-v1", requestedRunIds: runIds, startedAt,
    endedAt: new Date().toISOString(), before, deletedArticles, deletedExpiredLeases, after,
    success: postcondition.valid, residualMismatches: postcondition.mismatches } satisfies StagingCleanupResult;
}
