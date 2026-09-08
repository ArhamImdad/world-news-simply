import { describe, expect, it } from "vitest";
import { executeSeparatedCycle } from "@/lib/publication-orchestrator";
import { candidateReserveOrder, getPublicationConfig, groqCandidateLimit, replenishmentLimit } from "@/lib/publication-config";
import { deterministicOriginalityPrecheck } from "@/lib/article-quality";
import { buildEvidenceBundle, evidenceBundleFailures } from "@/lib/evidence-model";
import {
  buildTopicSignature,
  PIPELINE_VERSION,
  readyArticleFailures,
  selectBestReadyArticle,
  type ReadyArticle,
} from "@/lib/publication-policy";
import { publicationSlotAt, publishNextReadyArticle } from "@/lib/publication-queue";
import { getUnsplashImage } from "@/lib/unsplash";
import { extractArticleText } from "@/lib/source-material";
import { matchOfficialStories } from "@/lib/source-pairs";
import { SOURCE_REGISTRY, SYNTHESIS_SOURCES, sourceCanBeSynthesized } from "@/lib/source-registry";
import { EVERGREEN_TOPICS } from "@/lib/evergreen-topics";
import type { SourceMaterial } from "@/types/article";

const NOW = new Date("2026-08-13T12:00:00.000Z");
const permitted = new Set(["source-a", "source-b"]);

function article(overrides: Partial<ReadyArticle> = {}): ReadyArticle {
  const title = overrides.title ?? "Official agencies report measurable change in regional employment";
  return {
    title,
    summary: "A fully sourced summary with useful context.",
    content: "A sufficiently complete and fully attributed article body.",
    category: "Economy",
    image_url: "/og-default.svg",
    quality_score: 94,
    publication_status: "draft",
    editorial_state: "ready",
    sources: [
      { title: "Primary", url: "https://a.gov/release", publisher: "Agency A", publishedAt: NOW.toISOString(), licenseType: "public-domain-us", sourceType: "government-news", isPrimary: true, registryId: "source-a", recognized: true, commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true, permissionUrl: "https://a.gov/terms" },
      { title: "Support", url: "https://b.gov/data", publisher: "Agency B", publishedAt: NOW.toISOString(), licenseType: "public-domain-us", sourceType: "official-dataset", isPrimary: false, registryId: "source-b", recognized: true, commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true, permissionUrl: "https://b.gov/terms" },
    ],
    prepared_at: "2026-08-13T11:00:00.000Z",
    publish_after: "2026-08-13T11:00:00.000Z",
    expires_at: "2026-08-14T12:00:00.000Z",
    freshness_class: "CURRENT",
    content_pool: "government-records",
    publication_priority: 95,
    topic_signature: buildTopicSignature(title),
    validation_results: { factualSupportPassed: true, originalityPassed: true, duplicateDetectionPassed: true, sourceOverlapPassed: true, unsupportedClaims: false, inventedQuotes: false, inventedStatistics: false, completeAttribution: true, hardWarnings: [] },
    generation_metadata: { pipelineVersion: PIPELINE_VERSION, provider: "test", model: "test-model", modernPipeline: true, preparedAutomatically: true },
    ...overrides,
  };
}

describe("automatic eligibility", () => {
  it("publishes a ready article", () => {
    const ready = article();
    expect(readyArticleFailures(ready, permitted, NOW)).toEqual([]);
    expect(selectBestReadyArticle([ready], permitted, [], NOW)).toBe(ready);
  });

  it("does not publish an expired article", () => {
    const expired = article({ expires_at: "2026-08-13T11:59:59.000Z" });
    expect(readyArticleFailures(expired, permitted, NOW)).toContain("expired");
    expect(selectBestReadyArticle([expired], permitted, [], NOW)).toBeNull();
  });

  it("does not publish a duplicate", () => {
    const ready = article();
    expect(selectBestReadyArticle([ready], permitted, [], NOW, [ready.topic_signature])).toBeNull();
  });

  it("does not admit a one-source article", () => {
    expect(readyArticleFailures(article({ sources: article().sources.slice(0, 1) }), permitted, NOW))
      .toContain("fewer than two independent source domains");
  });

  it("does not admit score 89", () => {
    expect(readyArticleFailures(article({ quality_score: 89 }), permitted, NOW)).toContain("quality score below 90");
  });

  it.each([
    ["factual support", { factualSupportPassed: false }, "factual support failed"],
    ["originality", { originalityPassed: false }, "originality failed"],
    ["duplicate detection", { duplicateDetectionPassed: false }, "duplicate detection failed"],
    ["source overlap", { sourceOverlapPassed: false }, "source overlap failed"],
    ["unsupported claims", { unsupportedClaims: true }, "factual support failed"],
    ["invented quotes", { inventedQuotes: true }, "invented quotes"],
    ["invented statistics", { inventedStatistics: true }, "invented statistics"],
    ["attribution", { completeAttribution: false }, "incomplete attribution"],
    ["hard warnings", { hardWarnings: ["warning"] }, "hard warnings"],
  ])("does not weaken the %s publication gate", (_gate, validationOverride, expectedFailure) => {
    const validation_results = { ...article().validation_results, ...validationOverride };
    expect(readyArticleFailures(article({ validation_results }), permitted, NOW)).toContain(expectedFailure);
  });

  it("does not admit an unknown licence or source", () => {
    const sources = article().sources.map((source, index) => index ? { ...source, registryId: "unknown", licenseType: "unknown" } : source);
    expect(readyArticleFailures(article({ sources }), permitted, NOW)).toContain("unrecognized source");
  });

  it("does not admit a legacy article", () => {
    const legacy = article({ generation_metadata: { ...article().generation_metadata, modernPipeline: false as true } });
    expect(readyArticleFailures(legacy, permitted, NOW)).toContain("legacy generation metadata");
  });

  it("publishes a strong fallback when current news is unavailable", () => {
    const fallback = article({ freshness_class: "EVERGREEN", publication_priority: 70 });
    expect(selectBestReadyArticle([fallback], permitted, [], NOW)).toBe(fallback);
  });

  it("breaks a nine-article category streak when another qualified article exists", () => {
    const saturated = article({ publication_priority: 100, category: "Economy" });
    const diverse = article({
      title: "Independent official records explain a major public health measure",
      topic_signature: buildTopicSignature("Independent official records explain a major public health measure"),
      publication_priority: 60,
      category: "Health",
    });
    expect(selectBestReadyArticle([saturated, diverse], permitted, Array(9).fill("Economy"), NOW)).toBe(diverse);
  });
});

describe("scheduler resilience", () => {
  it("prevents two scheduler instances from double publishing a slot", async () => {
    let published = false;
    let mutations = 0;
    const database = {
      async rpc() {
        await Promise.resolve();
        if (!published) {
          published = true;
          mutations += 1;
          return { data: [{ id: "one", slug: "one", title: "One", category: "World", freshness_class: "CURRENT", was_published: true }], error: null };
        }
        return { data: [{ id: "one", slug: "one", title: "One", category: "World", freshness_class: "CURRENT", was_published: false }], error: null };
      },
    };
    const slot = publicationSlotAt(NOW);
    const results = await Promise.all([
      publishNextReadyArticle(slot, database as never),
      publishNextReadyArticle(slot, database as never),
    ]);
    expect(mutations).toBe(1);
    expect(results.filter((result) => result?.was_published)).toHaveLength(1);
  });

  it("uses a safe local image when Unsplash is unavailable", async () => {
    const image = await getUnsplashImage("science", "");
    expect(image.url).toBe("/og-default.svg");
    expect(image.attributionUrl).toBeNull();
  });

  it("an empty reserve triggers bounded critical replenishment", () => {
    const config = getPublicationConfig();
    expect(replenishmentLimit(0, config)).toMatchObject({ mode: "critical" });
    expect(replenishmentLimit(0, config).limit).toBeGreaterThan(0);
    expect(replenishmentLimit(0, config).limit).toBeLessThanOrEqual(config.maximum);
  });

  it("provider failure cannot undo publication or destroy existing queue state", async () => {
    const readyIds = ["ready-2", "ready-3"];
    const result = await executeSeparatedCycle(
      async () => "published-1",
      async () => { throw new Error("provider unavailable"); }
    );
    expect(result.publication).toBe("published-1");
    expect(result.replenishmentError).toBeInstanceOf(Error);
    expect(readyIds).toEqual(["ready-2", "ready-3"]);
  });

  it("queue replenishment preserves already-ready articles", async () => {
    const readyIds = ["ready-1"];
    const result = await executeSeparatedCycle(
      async () => null,
      async () => { readyIds.push("ready-2"); return readyIds.length; }
    );
    expect(result.replenishment).toBe(2);
    expect(readyIds).toEqual(["ready-1", "ready-2"]);
  });
});

describe("official source extraction", () => {
  it("extracts semantic body-field pages without admitting navigation or footer text", () => {
    const html = `
      <nav><p>This navigation paragraph must never become source material.</p></nav>
      <div class="main-content">
        <div class="field field--name-body field__item">
          <p>This official methodology paragraph contains enough substantive information to be retained safely.</p>
          <p>This second official paragraph supplies additional definitions and explanatory context for readers.</p>
        </div>
      </div>
      <footer><p>This footer paragraph must never become source material.</p></footer>`;
    const extracted = extractArticleText(html);
    expect(extracted).toContain("official methodology paragraph");
    expect(extracted).toContain("second official paragraph");
    expect(extracted).not.toContain("navigation paragraph");
    expect(extracted).not.toContain("footer paragraph");
  });

  it("prioritizes curated evergreen pairs when the reserve is empty", () => {
    expect(candidateReserveOrder("critical", "economic-data", true)).toBeLessThan(
      candidateReserveOrder("critical", "economic-data", false)
    );
  });

  it("extracts official table context while excluding forms and subscription noise", () => {
    const html = `
      <main>
        <form><p>This form text must not be retained even if it is long enough to pass the block filter.</p></form>
        <h2>Official quarterly comparison</h2>
        <p>The agency explains how the reported indicator changed between the current and prior official periods.</p>
        <table><tr><th>Period and measure</th><td>Second quarter 2026 increased by 2.4 percent from the prior period.</td></tr></table>
        <aside><p>Subscribe to unrelated updates and newsletters using this promotional sidebar.</p></aside>
      </main>`;
    const extracted = extractArticleText(html);
    expect(extracted).toContain("Official quarterly comparison");
    expect(extracted).toContain("Second quarter 2026");
    expect(extracted).not.toContain("form text");
    expect(extracted).not.toContain("Subscribe to unrelated");
  });

  it("extracts official agency article-content roots without page chrome", () => {
    const html = `
      <header><p>This navigation sentence must not be selected as article material.</p></header>
      <div class="l-col article-content">
        <h2>Factors affecting electricity prices</h2>
        <p>Fuel prices, power plant costs, transmission systems, and weather can affect the price paid by electricity customers.</p>
        <p>Regulators and utilities also use different rate structures to recover the cost of providing service.</p>
      </div>
      <footer><p>This footer sentence must not be selected as article material.</p></footer>`;
    const extracted = extractArticleText(html);
    expect(extracted).toContain("Fuel prices");
    expect(extracted).toContain("Regulators and utilities");
    expect(extracted).not.toContain("navigation sentence");
    expect(extracted).not.toContain("footer sentence");
  });
});

describe("permission-safe source coverage", () => {
  it("enables only sources with complete affirmative permission metadata", () => {
    expect(SYNTHESIS_SOURCES.length).toBeGreaterThanOrEqual(13);
    for (const source of SYNTHESIS_SOURCES) {
      expect(sourceCanBeSynthesized(source)).toBe(true);
      expect(source.commercialUseAllowed).toBe(true);
      expect(source.aiProcessingAllowed).toBe(true);
      expect(source.transformationAllowed).toBe(true);
      expect(source.permissionUrl).toMatch(/^https:\/\//);
      expect(source.topicTags.length).toBeGreaterThan(0);
    }
    expect(SOURCE_REGISTRY.find((source) => source.id === "bbc-world")?.synthesisEnabled).toBe(false);
  });

  it("maintains at least eight curated two-domain evergreen opportunities", () => {
    expect(EVERGREEN_TOPICS.length).toBeGreaterThanOrEqual(8);
    for (const candidate of EVERGREEN_TOPICS) {
      expect(candidate.corroboration.length).toBeGreaterThanOrEqual(1);
      expect(candidate.corroboration[0].source.domain).not.toBe(candidate.source.domain);
      expect(sourceCanBeSynthesized(candidate.source)).toBe(true);
      expect(sourceCanBeSynthesized(candidate.corroboration[0].source)).toBe(true);
    }
  });
});

describe("evidence-first token controls", () => {
  const material = (registryId: string, publisher: string, url: string, text: string): SourceMaterial => ({
    title: `${publisher} official methodology`, publisher, url, text, reliability: 98,
    isPrimary: registryId === "source-a", publishedAt: "2026-08-20T12:00:00Z",
    licenseType: "public-domain-us", sourceType: "government-statistics", registryId,
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    permissionUrl: `${new URL(url).origin}/terms`,
  });
  const sourceA = material("source-a", "Agency Alpha", "https://alpha.gov/method", [
    "Agency Alpha measures monthly price change using a representative sample of household purchases across eight spending groups.",
    "The sample weights are updated from expenditure data so categories reflect their relative share of household spending.",
    "Published estimates compare the current index with both the previous month and the same month one year earlier.",
    "The agency excludes investment purchases because the measure is designed around household consumption expenses.",
  ].join("\n"));
  const sourceB = material("source-b", "Agency Beta", "https://beta.gov/quality", [
    "Agency Beta compiles its consumer measure from approximately 180000 monthly observations covering a reviewed basket of goods and services.",
    "Its quality report describes coverage, sampling, validation, and the limits readers should consider when comparing periods.",
    "The published framework distinguishes measures that include housing costs from measures with narrower population coverage.",
    "Annual reviews allow the basket and weights to reflect changes in consumer purchasing patterns over time.",
  ].join("\n"));

  it("builds a compact traceable evidence bundle with both publishers", () => {
    const bundle = buildEvidenceBundle("How official price measures differ", [sourceA, sourceB], "candidate-1");
    expect(evidenceBundleFailures(bundle)).toEqual([]);
    expect(new Set(bundle.facts.map((fact) => fact.sourceId))).toEqual(new Set(["source-a", "source-b"]));
    expect(bundle.facts.every((fact) => fact.support === "direct" && fact.sourceUrl.startsWith("https://"))).toBe(true);
    expect(bundle.plan.comparisonOpportunities.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects deterministic source-phrase copying before an AI audit", () => {
    const copied = deterministicOriginalityPrecheck({
      title: "How official price measures differ",
      content: `${sourceA.text} ${sourceA.text}`,
    }, [sourceA, sourceB]);
    expect(copied.accepted).toBe(false);
    expect(copied.reasons).toContain("five-word source phrase overlap");
  });

  it("caps critical-mode Groq spending below the discovery maximum", () => {
    const config = getPublicationConfig();
    expect(groqCandidateLimit("critical", config)).toBeLessThan(replenishmentLimit(0, config).limit);
    expect(groqCandidateLimit("critical", config)).toBe(3);
  });
});

describe("official corroboration matching", () => {
  const source = (id: string) => {
    const found = SYNTHESIS_SOURCES.find((entry) => entry.id === id);
    if (!found) throw new Error(`Missing test source ${id}`);
    return found;
  };

  it("matches the same GDP period across independent statistical agencies", () => {
    const match = matchOfficialStories(
      { title: "GDP second estimate, 2nd quarter 2026", content: "Official output and spending measures for Q2 2026.", publishedAt: "2026-08-26T12:30:00Z", source: source("bea-news-releases") },
      { title: "Quarterly national accounts: April to June 2026", content: "GDP output, income and expenditure estimates for Q2 2026.", publishedAt: "2026-08-27T06:00:00Z", source: source("ons-release-calendar") },
    );
    expect(match.accepted).toBe(true);
    expect(match.signals).toContain("event");
    expect(match.signals).toContain("date");
  });

  it("matches enforcement reports only when a named subject and event overlap", () => {
    const related = matchOfficialStories(
      { title: "SEC charges Acme Capital executives with securities fraud", content: "The complaint alleges investor fraud by Acme Capital.", publishedAt: "2026-08-18T18:00:00Z", source: source("sec-press-releases") },
      { title: "Acme Capital executive indicted for securities fraud", content: "A federal indictment charges an Acme Capital executive.", publishedAt: "2026-08-19T12:00:00Z", source: source("doj-news") },
    );
    const unrelated = matchOfficialStories(
      { title: "FDA approves therapy for a rare metabolic disease", content: "The agency reviewed clinical evidence for a treatment.", publishedAt: "2026-08-19T18:00:00Z", source: source("fda-press-announcements") },
      { title: "Former bank employee sentenced for wire fraud", content: "A court imposed sentence in a bank fraud matter.", publishedAt: "2026-08-20T12:00:00Z", source: source("doj-news") },
    );
    expect(related.accepted).toBe(true);
    expect(related.signals).toContain("entity");
    expect(unrelated.accepted).toBe(false);
  });

  it("rejects otherwise similar items outside the rule's freshness window", () => {
    const match = matchOfficialStories(
      { title: "FTC charges Acme Capital over deceptive pricing", content: "An enforcement complaint alleges deceptive pricing.", publishedAt: "2026-08-20T12:00:00Z", source: source("ftc-press-releases") },
      { title: "Acme Capital charged over deceptive pricing", content: "The enforcement case concerns pricing practices.", publishedAt: "2026-05-01T12:00:00Z", source: source("doj-news") },
    );
    expect(match.accepted).toBe(false);
    expect(match.signals).toContain("outside-time-window");
  });
});
