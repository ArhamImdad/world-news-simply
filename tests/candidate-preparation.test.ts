import { describe, expect, it } from "vitest";
import { buildCanonicalArticleIdentity, duplicateIdentityEvidence } from "@/lib/article-identity";
import { candidateHash } from "@/lib/evidence-model";
import { selectNormalPreparedCandidates } from "@/lib/candidate-preparation";

const roundFiveIdentities = [
  "gross-domestic-product:2026-Q2",
  "consumer-prices:2026-07",
  "retail-sales:2026-06",
  "producer-prices:2026-07",
  "international-trade:2026-06",
  "industrial-production:2026-06",
  "household-income-spending:2026-06",
  "labour-force:2026-06",
  "consumer-prices:2026-06",
];

describe("normal deterministic candidate selection", () => {
  it("ranks qualified candidates before repeated early single-source failures", () => {
    const repeatedFailures = Array.from({ length: 12 }, (_, index) => ({
      identity: `single-source-${index}`, discoveryRank: index + 1,
      disposition: "rejected" as const, qualificationScore: null,
    }));
    const recurring = roundFiveIdentities.map((identity, index) => ({
      identity, discoveryRank: 13 + index, disposition: "eligible" as const, qualificationScore: 98 - index,
    }));
    const selected = selectNormalPreparedCandidates([...repeatedFailures, ...recurring], 18);
    expect(selected.filter((candidate) => candidate.disposition === "eligible").map((candidate) => candidate.identity))
      .toEqual(roundFiveIdentities);
    expect(selected).toHaveLength(18);
  });

  it("accounts for every Round 5 series-period identity without a silent disappearance", () => {
    const selected = selectNormalPreparedCandidates(roundFiveIdentities.map((identity, index) => ({
      identity, discoveryRank: index + 1, disposition: "eligible" as const, qualificationScore: 90 + index,
    })), 18);
    expect(new Set(selected.map((candidate) => candidate.identity))).toEqual(new Set(roundFiveIdentities));
  });

  it("keeps every qualified candidate available when the qualified set exceeds the consideration limit", () => {
    const candidates = Array.from({ length: 24 }, (_, index) => ({ identity: `qualified-${index}`,
      discoveryRank: index + 1, disposition: "eligible" as const, qualificationScore: 100 - index }));
    expect(selectNormalPreparedCandidates(candidates, 18)).toHaveLength(24);
  });
});

describe("recurring identity duplicate compatibility", () => {
  const recurring = (topic: string, seriesPeriod: string, eventDate: string) => buildCanonicalArticleIdentity({
    topic, topicKey: candidateHash(`recurring-release:${seriesPeriod}`),
    sourceRegistryIds: ["official-a", "official-b"],
    sourceUrls: [`https://a.test/${seriesPeriod}`, `https://b.test/${seriesPeriod}`], eventDate,
  });

  it.each([
    ["Consumer-price methodology and definitions", "Consumer prices in July 2026 across official economies", "consumer-prices:2026-07"],
    ["How gross domestic product is measured", "Gross domestic product in the second quarter of 2026", "gross-domestic-product:2026-Q2"],
  ])("does not automatically block evergreen methodology against a period release", (methodology, release, key) => {
    const evergreen = buildCanonicalArticleIdentity({ topic: methodology, sourceRegistryIds: ["official-a", "official-b"],
      sourceUrls: ["https://a.test/methodology", "https://b.test/methodology"], eventDate: "2026-08-01" });
    expect(duplicateIdentityEvidence(evergreen, recurring(release, key, "2026-08-20"))).toBeNull();
  });

  it("collapses rotational same-period candidates but preserves the next period", () => {
    const july = recurring("Consumer prices in July 2026 across official economies", "consumer-prices:2026-07", "2026-08-20");
    const rotatedJuly = recurring("July 2026 consumer-price releases compared", "consumer-prices:2026-07", "2026-08-21");
    const august = recurring("Consumer prices in August 2026 across official economies", "consumer-prices:2026-08", "2026-09-20");
    expect(duplicateIdentityEvidence(july, rotatedJuly)).toBe("topic-key");
    expect(duplicateIdentityEvidence(july, august)).toBeNull();
  });
});
