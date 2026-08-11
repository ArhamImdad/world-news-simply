// The OpenNext worker is generated before Wrangler bundles this entrypoint.
import handler from "./.open-next/worker.js";

type WorkerEnvironment = {
  CRON_SECRET: string;
};

type WorkerContext = {
  waitUntil(promise: Promise<unknown>): void;
};

async function runScheduledUpdate(env: WorkerEnvironment, ctx: WorkerContext) {
  const request = new Request("https://world-news-simply.internal/api/cron", {
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
    _event: { cron: string; scheduledTime: number },
    env: WorkerEnvironment,
    ctx: WorkerContext
  ) {
    ctx.waitUntil(runScheduledUpdate(env, ctx));
  },
};

export default worker;

// Preserve OpenNext cache Durable Object exports when those cache modes are enabled.
export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
