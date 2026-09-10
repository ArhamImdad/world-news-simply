import { describe, expect, it } from "vitest";
import { balanceCandidates, classifyArticleCategory, emptyCategoryCoverage, PUBLICATION_CATEGORIES } from "@/lib/category-balance";

describe("category coverage allocation", () => {
  const order = (items: Array<{ category: string; score: number }>, coverage = emptyCategoryCoverage()) =>
    balanceCandidates(items, coverage, (item) => item.category, (item) => item.score);

  it("fills an empty category before a high-scoring dominant category", () => {
    const coverage = emptyCategoryCoverage();
    coverage.World = { published: 50, ready: 4, recent: 20 };
    const items = [{ category: "World", score: 100 }, { category: "Technology", score: 91 }];
    expect(order(items, coverage)[0].category).toBe("Technology");
    expect(coverage.Technology.ready).toBe(0);
  });

  it("allocates one slot to each empty category before repeating a category", () => {
    const items = PUBLICATION_CATEGORIES.flatMap((category, index) =>
      [100, 99, 98].map((score) => ({ category, score: score - index })));
    expect(new Set(order(items).slice(0, 9).map((item) => item.category)).size).toBe(9);
  });

  it("counts pending ready articles toward the floor to avoid overfilling", () => {
    const coverage = emptyCategoryCoverage();
    coverage.Technology.ready = 3;
    const items = [{ category: "Technology", score: 100 }, { category: "Health", score: 90 }];
    expect(order(items, coverage)[0].category).toBe("Health");
  });

  it("balances recent publication volume after the coverage floor is met", () => {
    const coverage = emptyCategoryCoverage();
    coverage.World = { published: 50, ready: 1, recent: 15 };
    coverage.Science = { published: 100, ready: 0, recent: 0 };
    expect(order([{ category: "World", score: 100 }, { category: "Science", score: 90 }], coverage)[0].category).toBe("Science");
  });

  it("does not fabricate candidates for categories without eligible supply", () => {
    expect(order([{ category: "World", score: 95 }])).toEqual([{ category: "World", score: 95 }]);
  });
});

describe("subject classification", () => {
  it.each([
    ["Artificial intelligence computing programme announced", "Technology"],
    ["Football participation funding announced", "Sports"],
    ["Clinical cancer treatment study results", "Health"],
    ["NASA spacecraft observes new planet", "Science"],
    ["Consumer prices and inflation estimates published", "Economy"],
    ["Company merger investigation opened", "Business"],
    ["Parliament passes new legislation", "Politics"],
    ["International humanitarian response update", "World"],
  ])("classifies %s from its subject rather than a generic feed hint", (title, category) => {
    expect(classifyArticleCategory(title, "World")).toBe(category);
  });

  it("reserves Opinion for an explicitly commissioned analysis", () => {
    expect(classifyArticleCategory("Inflation measurement limitations", "Economy")).toBe("Economy");
    expect(classifyArticleCategory("Inflation measurement limitations", "Economy", "opinion")).toBe("Opinion");
  });
});
