// The OpenNext worker is generated before Wrangler bundles this entrypoint.
import handler from "./.open-next/worker.js";

type WorkerEnvironment = {
  CRON_SECRET: string;
};

type WorkerContext = {
  waitUntil(promise: Promise<unknown>): void;
};

async function runScheduledUpdate(event: { cron: string; scheduledTime: number }, env: WorkerEnvironment, ctx: WorkerContext) {
  const mode = event.cron === "0 */2 * * *" ? "publish" : "replenish";
  const request = new Request(`https://world-news-simply.internal/api/cron?mode=${mode}&scheduledTime=${event.scheduledTime}`, {
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  });
  const response = await handler.fetch(request, env, ctx);

  if (!response.ok) {
    console.error(`Scheduled news update returned HTTP ${response.status}.`);
  }
}

const worker = {
  fetch: handler.fetch,
  scheduled(
    event: { cron: string; scheduledTime: number },
    env: WorkerEnvironment,
    ctx: WorkerContext
  ) {
    ctx.waitUntil(runScheduledUpdate(event, env, ctx));
  },
};

export default worker;

// Preserve OpenNext cache Durable Object exports when those cache modes are enabled.
export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
