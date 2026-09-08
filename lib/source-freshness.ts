import type { SupportingItem } from "@/lib/source-material";

type FreshnessCandidate = SupportingItem & { corroboration?: unknown[] };

export function sourceItemExpiration(item: FreshnessCandidate, prepared: Date) {
  const evergreen = Array.isArray(item.corroboration);
  const origin = evergreen || item.source.freshnessClass === "EVERGREEN"
    ? prepared.getTime()
    : Date.parse(item.publishedAt ?? "") || 0;
  return new Date(origin + (evergreen ? 24 * 365 : item.source.freshnessHours) * 3_600_000);
}

export function sourceItemIsFresh(item: FreshnessCandidate, at = new Date()) {
  return sourceItemExpiration(item, at).getTime() > at.getTime();
}
