import { describe, expect, it } from "vitest";
import { scheduledPublicationRequestUrl } from "@/lib/scheduled-publication";

describe("scheduled publication dispatch", () => {
  it.each(["0 */2 * * *", "15,45 * * * *"])("runs a publish-first cycle for %s", (cron) => {
    const scheduledTime = Date.UTC(2026, 8, 11, 10, 15);
    const url = new URL(scheduledPublicationRequestUrl({ cron, scheduledTime }));

    expect(url.origin).toBe("https://world-news-simply.internal");
    expect(url.pathname).toBe("/api/cron");
    expect(url.searchParams.get("mode")).toBe("publish");
    expect(url.searchParams.get("scheduledTime")).toBe(String(scheduledTime));
  });

  it("rejects malformed scheduler timestamps before dispatch", () => {
    expect(() => scheduledPublicationRequestUrl({ cron: "test", scheduledTime: Number.NaN })).toThrow(
      /positive scheduled timestamp/,
    );
  });
});
