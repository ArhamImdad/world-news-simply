// The OpenNext worker is generated before Wrangler bundles this entrypoint.
import handler from "./.open-next/worker.js";
import { scheduledPublicationRequestUrl, type ScheduledPublicationEvent } from "./lib/scheduled-publication";

type WorkerEnvironment = {
  CRON_SECRET: string;
};

type WorkerContext = {
  waitUntil(promise: Promise<unknown>): void;
};

type ScheduledCycleResponse = {
  success?: boolean;
  publicationOutcome?: "published" | "slot_already_filled" | "no_eligible_ready_article" | "failed";
  publicationError?: string | null;
  published?: {
    id?: string;
    category?: string;
    was_published?: boolean;
  } | null;
  replenishment?: {
    queueDepthAfter?: number;
    articlesPrepared?: number;
    preparedCategories?: Record<string, number>;
    rejectedCategories?: Record<string, number>;
    pendingDraftProcessing?: {
      draftsFound?: number;
      articlesProcessed?: number;
      qualityScoresGenerated?: number;
      preparedArticles?: number;
      rejectedArticles?: number;
      processingFailures?: number;
      categoryDistribution?: Record<string, unknown>;
      rejectionReasons?: Record<string, number>;
    } | null;
    pendingDraftProcessingError?: string | null;
  } | null;
};

async function runScheduledUpdate(event: ScheduledPublicationEvent, env: WorkerEnvironment, ctx: WorkerContext) {
  const request = new Request(scheduledPublicationRequestUrl(event), {
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  });
  const response = await handler.fetch(request, env, ctx);
  const payload = await response.clone().json().catch(() => null) as ScheduledCycleResponse | null;
  const publicationFailed = Boolean(payload?.publicationError);

  if (!response.ok || payload?.success === false || publicationFailed) {
    console.error("Scheduled publication cycle failed.", {
      cron: event.cron,
      scheduledTime: event.scheduledTime,
      status: response.status,
      publicationOutcome: payload?.publicationOutcome ?? "failed",
      publicationError: payload?.publicationError ?? null,
    });
    return;
  }

  console.log("Scheduled publication cycle completed.", {
    cron: event.cron,
    scheduledTime: event.scheduledTime,
    publishedArticleId: payload?.published?.id ?? null,
    publishedCategory: payload?.published?.category ?? null,
    wasPublished: payload?.published?.was_published ?? false,
    publicationOutcome: payload?.publicationOutcome ?? "no_eligible_ready_article",
    readyQueueDepth: payload?.replenishment?.queueDepthAfter ?? null,
    articlesPrepared: payload?.replenishment?.articlesPrepared ?? 0,
    preparedCategories: payload?.replenishment?.preparedCategories ?? {},
    rejectedCategories: payload?.replenishment?.rejectedCategories ?? {},
    pendingDraftProcessing: payload?.replenishment?.pendingDraftProcessing ?? null,
    pendingDraftProcessingError: payload?.replenishment?.pendingDraftProcessingError ?? null,
  });
}

const worker = {
  fetch: handler.fetch,
  scheduled(
    event: ScheduledPublicationEvent,
    env: WorkerEnvironment,
    ctx: WorkerContext
  ) {
    ctx.waitUntil(runScheduledUpdate(event, env, ctx));
  },
};

export default worker;

// Preserve OpenNext cache Durable Object exports when those cache modes are enabled.
export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
