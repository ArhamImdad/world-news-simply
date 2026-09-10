import { describe, expect, it } from "vitest";
import { emptyCategoryCoverage } from "@/lib/category-balance";
import {
  orderPendingDrafts,
  permittedSourceForDraft,
  type PendingGeneratedDraft,
} from "@/lib/draft-processing";

function draft(id: string, category: string, createdAt: string): PendingGeneratedDraft {
  return {
    id, slug: null, title: `${category} article ${id}`, summary: "Summary", content: "Content",
    image_url: null, source_url: "https://www.bls.gov/news.release/example.htm", category,
    region: "Americas", article_type: "news", is_breaking: false, read_time: 2, created_at: createdAt,
  };
}

describe("pending generated draft recovery", () => {
  it("accepts only source URLs covered by the current synthesis registry", () => {
    expect(permittedSourceForDraft("https://www.bls.gov/news.release/example.htm")?.id).toBe("bls-latest");
    expect(permittedSourceForDraft("https://www.space.com/example-story")).toBeNull();
  });

  it("prioritizes categories with no published or ready inventory", () => {
    const coverage = emptyCategoryCoverage();
    coverage.World = { published: 20, ready: 5, recent: 8 };
    coverage.Politics = { published: 10, ready: 2, recent: 4 };
    const ordered = orderPendingDrafts([
      draft("world", "World", "2026-09-11T10:00:00.000Z"),
      draft("technology", "Technology", "2026-09-11T08:00:00.000Z"),
      draft("politics", "Politics", "2026-09-11T09:00:00.000Z"),
      draft("science", "Science", "2026-09-11T07:00:00.000Z"),
    ], coverage);

    expect(ordered.slice(0, 2).map((article) => article.category).sort()).toEqual(["Science", "Technology"]);
    expect(ordered.at(-1)?.category).toBe("World");
  });

  it("keeps unsupported legacy categories last so valid categories receive provider capacity", () => {
    const ordered = orderPendingDrafts([
      draft("unknown", "Culture", "2026-09-11T12:00:00.000Z"),
      draft("health", "Health", "2026-09-11T10:00:00.000Z"),
    ], emptyCategoryCoverage());
    expect(ordered.map((article) => article.category)).toEqual(["Health", "Culture"]);
  });
});
