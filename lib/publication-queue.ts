import { SYNTHESIS_SOURCES } from "@/lib/source-registry";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReadyArticle } from "@/lib/publication-policy";
import { assertWritesAllowed } from "@/lib/environment-isolation";

export type PreparedArticleInsert = ReadyArticle & {
  slug: string;
  source_url: string;
  region: string;
  article_type: string;
  is_breaking: boolean;
  is_editors_pick: boolean;
  read_time: number;
  views: number;
  image_photographer_profile_url: string | null;
  image_download_location: string | null;
  preparation_key: string;
};

export type PublishedQueueArticle = {
  id: string;
  slug: string | null;
  title: string;
  category: string;
  freshness_class: string;
  was_published: boolean;
};

export type EnqueueDisposition = "INSERTED" | "TARGET_REACHED" | "MAX_DEPTH_REACHED" |
  "DUPLICATE" | "INELIGIBLE" | "LEASE_NOT_OWNED";

export type EnqueueReadyArticleResult = {
  articleId: string | null;
  disposition: EnqueueDisposition;
  readyDepth: number;
};

async function databaseClient(database?: SupabaseClient) {
  if (database) return database;
  const { createServerSupabaseClient } = await import("@/lib/supabase");
  return createServerSupabaseClient();
}

export function permittedSourceIds() {
  return SYNTHESIS_SOURCES.map((source) => source.id);
}

export async function getReadyQueueDepth(database?: SupabaseClient) {
  assertWritesAllowed("private publication queue access");
  const client = await databaseClient(database);
  const { count, error } = await client.from("articles").select("id", { count: "exact", head: true })
    .eq("publication_status", "draft").eq("editorial_state", "ready")
    .gt("expires_at", new Date().toISOString());
  if (error) throw new Error(`Unable to count ready queue: ${error.message}`);
  return count ?? 0;
}

export async function enqueueReadyArticle(
  article: PreparedArticleInsert,
  maximumQueueDepth: number,
  fillTarget: number,
  ownership: { systemKey: string; runId: string },
  database?: SupabaseClient
): Promise<EnqueueReadyArticleResult> {
  assertWritesAllowed("publication queue mutation");
  const client = await databaseClient(database);
  const { data, error } = await client.rpc("enqueue_ready_article_owned", {
    p_article: article,
    p_max_queue_depth: maximumQueueDepth,
    p_fill_target: fillTarget,
    p_permitted_source_ids: permittedSourceIds(),
    p_system_key: ownership.systemKey,
    p_replenishment_run_id: ownership.runId,
  });
  if (error) throw new Error(`Unable to enqueue prepared article: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as {
    article_id?: unknown; disposition?: unknown; ready_depth?: unknown;
  } | null;
  const dispositions = new Set<EnqueueDisposition>([
    "INSERTED", "TARGET_REACHED", "MAX_DEPTH_REACHED", "DUPLICATE", "INELIGIBLE", "LEASE_NOT_OWNED",
  ]);
  if (!row || typeof row.disposition !== "string" || !dispositions.has(row.disposition as EnqueueDisposition) ||
      !Number.isInteger(row.ready_depth) || Number(row.ready_depth) < 0) {
    throw new Error("Owned enqueue returned a malformed disposition.");
  }
  return {
    articleId: typeof row.article_id === "string" && row.article_id.length > 0 ? row.article_id : null,
    disposition: row.disposition as EnqueueDisposition,
    readyDepth: Number(row.ready_depth),
  };
}

export async function articleReplenishmentRunId(articleId: string, database?: SupabaseClient) {
  assertWritesAllowed("service-role replenishment attribution RPC access");
  const client = await databaseClient(database);
  const { data, error } = await client.rpc("article_replenishment_run_id", { p_article_id: articleId });
  if (error) throw new Error(`Unable to verify article replenishment attribution: ${error.message}`);
  return typeof data === "string" ? data : null;
}

export async function publishNextReadyArticle(
  publicationSlot: Date,
  database?: SupabaseClient
): Promise<PublishedQueueArticle | null> {
  assertWritesAllowed("article publication");
  const client = await databaseClient(database);
  const { data, error } = await client.rpc("publish_next_ready_article", {
    p_publication_slot: publicationSlot.toISOString(),
    p_permitted_source_ids: permittedSourceIds(),
  });
  if (error) throw new Error(`Atomic publication failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return row ? row as PublishedQueueArticle : null;
}

export function publicationSlotAt(date = new Date()) {
  const slot = new Date(date);
  slot.setUTCMinutes(0, 0, 0);
  slot.setUTCHours(Math.floor(slot.getUTCHours() / 2) * 2);
  return slot;
}
