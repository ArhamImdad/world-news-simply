export const PUBLICATION_CATEGORIES = [
  "World", "Politics", "Technology", "Business", "Economy", "Science", "Sports", "Health", "Opinion",
] as const;
export type PublicationCategory = typeof PUBLICATION_CATEGORIES[number];
// A coverage floor, not permission to relax editorial or source checks.
export const MINIMUM_PUBLISHED_PER_CATEGORY = 3;
export type CategoryCoverage = Record<PublicationCategory, { published: number; ready: number; recent: number }>;

export function emptyCategoryCoverage(): CategoryCoverage {
  return Object.fromEntries(PUBLICATION_CATEGORIES.map((category) =>
    [category, { published: 0, ready: 0, recent: 0 }])) as CategoryCoverage;
}

export function isPublicationCategory(value: string): value is PublicationCategory {
  return PUBLICATION_CATEGORIES.some((category) => category === value);
}

// Classify the subject, never the desired inventory. Registry permissions stay unchanged.
export function classifyArticleCategory(title: string, fallback: string, articleType?: string): PublicationCategory {
  if (articleType === "opinion") return "Opinion";
  const rules: Array<[PublicationCategory, RegExp]> = [
    ["Sports", /\b(sport[s]?|football|cricket|olympic[s]?|paralympic[s]?|athletes?|rugby|tennis|basketball)\b/i],
    ["Technology", /\b(artificial intelligence|AI|cybersecurity|cyber|semiconductors?|software|computing|broadband|telecoms?|digital technology|quantum computing)\b/i],
    ["Health", /\b(health|hospitals?|patients?|vaccines?|disease|cancer|clinical|medicine|medical|public health)\b/i],
    ["Science", /\b(science|scientific|astronomy|spacecraft|planet[s]?|nasa|climate research|laboratory|physics|biology)\b/i],
    ["Economy", /\b(inflation|GDP|gross domestic product|unemployment|consumer prices|interest rates|economic|economy|labour force|labor force|productivity|national accounts)\b/i],
    ["Business", /\b(business|companies|company|corporate|securities|investment|merger[s]?|antitrust|markets?|trade)\b/i],
    ["Politics", /\b(election[s]?|parliament|minister[s]?|congress|legislation|government policy|diplomacy|senate)\b/i],
  ];
  return rules.find(([, pattern]) => pattern.test(title))?.[0] ??
    (isPublicationCategory(fallback) ? fallback : "World");
}

// Allocate slots one at a time so a single deficient category cannot take every slot.
export function balanceCandidates<T>(candidates: readonly T[], coverage: CategoryCoverage,
  categoryOf: (candidate: T) => string, scoreOf: (candidate: T) => number): T[] {
  const projected = structuredClone(coverage);
  const remaining = [...candidates];
  const ordered: T[] = [];
  const priority = (category: PublicationCategory) => {
    const count = projected[category];
    const total = count.published + count.ready;
    return [total === 0 ? 0 : total < MINIMUM_PUBLISHED_PER_CATEGORY ? 1 : 2,
      total < MINIMUM_PUBLISHED_PER_CATEGORY ? total : count.recent + count.ready];
  };
  while (remaining.length) {
    remaining.sort((left, right) => {
      const leftCategory = categoryOf(left);
      const rightCategory = categoryOf(right);
      if (!isPublicationCategory(leftCategory) || !isPublicationCategory(rightCategory)) {
        throw new Error("Cannot balance an unsupported publication category.");
      }
      const a = priority(leftCategory);
      const b = priority(rightCategory);
      return a[0] - b[0] || a[1] - b[1] || scoreOf(right) - scoreOf(left);
    });
    const next = remaining.shift()!;
    projected[categoryOf(next) as PublicationCategory].ready += 1;
    ordered.push(next);
  }
  return ordered;
}
