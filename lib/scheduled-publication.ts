export type ScheduledPublicationEvent = {
  cron: string;
  scheduledTime: number;
};

const INTERNAL_CRON_URL = "https://world-news-simply.internal/api/cron";

/**
 * Every trigger runs the complete publish-first cycle. Publication remains
 * idempotent because the database owns the two-hour publication-slot lock.
 * The offset triggers therefore retry a failed slot while continuing to
 * replenish the ready queue.
 */
export function scheduledPublicationRequestUrl(event: ScheduledPublicationEvent) {
  if (!Number.isFinite(event.scheduledTime) || event.scheduledTime <= 0) {
    throw new Error("Scheduled publication requires a positive scheduled timestamp.");
  }

  const url = new URL(INTERNAL_CRON_URL);
  url.searchParams.set("mode", "publish");
  url.searchParams.set("scheduledTime", String(Math.trunc(event.scheduledTime)));
  return url.toString();
}
