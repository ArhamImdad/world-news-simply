import { describe, expect, it } from "vitest";
import { preflightSources } from "@/lib/article-quality";
import { articleIdentitiesAreDuplicate, buildCanonicalArticleIdentity } from "@/lib/article-identity";
import { EVERGREEN_TOPICS } from "@/lib/evergreen-topics";
import { extractArticleText, extractEurostatReleaseText, resolveOfficialDeepReleaseUrl } from "@/lib/source-material";
import { compatibleSourceIds, matchOfficialStories } from "@/lib/source-pairs";
import { normalizeStructuredFeedItems, parseAbsReleaseIndex, parseFeedXml } from "@/lib/rss";
import { classifyReleaseSupply, identifyReleaseSeries, normalizeReleasePeriod, publishedMonthPeriodHint, recurringReleaseMatch, releaseIdentityKey } from "@/lib/release-series";
import { sourceItemIsFresh } from "@/lib/source-freshness";
import { SOURCE_REGISTRY, SYNTHESIS_SOURCES, sourceCanBeSynthesized } from "@/lib/source-registry";
import type { SourceMaterial } from "@/types/article";

const approvedIds = ["cftc-press-releases", "cfpb-newsroom", "eurostat-news-releases", "statcan-daily", "abs-latest-releases"] as const;

function source(id: string) {
  const result = SYNTHESIS_SOURCES.find((entry) => entry.id === id);
  if (!result) throw new Error(`Missing source ${id}`);
  return result;
}

function material(id: string, domain: string, isPrimary: boolean): SourceMaterial {
  return {
    title: `${id} official release`, publisher: source(id).publisher, url: `https://${domain}/release`,
    text: Array.from({ length: 140 }, (_, index) => `fact${index}`).join(" "), publishedAt: "2026-08-25T12:00:00Z",
    licenseType: "public-domain-us", sourceType: "government-press-release", reliability: 98, isPrimary,
    registryId: id, commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    permissionUrl: source(id).permissionUrl,
  };
}

describe("controlled official-source expansion", () => {
  it("pins deterministic replay admission counts for controlled source expansion", () => {
    expect(SYNTHESIS_SOURCES).toHaveLength(19);
    expect(new Set(SYNTHESIS_SOURCES.map((entry) => entry.domain))).toHaveLength(18);
    expect(EVERGREEN_TOPICS).toHaveLength(27);
  });

  it.each(approvedIds)("registers %s with affirmative fail-closed permission metadata", (id) => {
    const entry = source(id);
    expect(sourceCanBeSynthesized(entry)).toBe(true);
    expect(entry.discoveryAllowed).toBe(true);
    expect(entry.contentFetchAllowed).toBe(true);
    expect(entry.commercialUseAllowed).toBe(true);
    expect(entry.aiProcessingAllowed).toBe(true);
    expect(entry.transformationAllowed).toBe(true);
    expect(entry.licenseType).not.toBe("unknown");
    expect(entry.permissionReviewedAt).toBe("2026-08-26");
    expect(entry.feedApiUrl).toMatch(/^https:\/\//);
  });

  it.each(approvedIds)("limits %s to agency-authored text and records third-party exclusions", (id) => {
    const entry = source(id);
    expect(entry.notes).toMatch(/Only .* (?:is|are) eligible/i);
    expect(entry.notes).toMatch(/third-party|private-party/i);
    expect(entry.notes).toMatch(/logo|seal|trademark/i);
    expect(entry.allowedArticleDomains).toEqual([entry.domain]);
  });

  it("keeps ambiguous investigated sources disabled", () => {
    expect(SOURCE_REGISTRY.find((entry) => entry.id === "who-news")?.synthesisEnabled).toBe(false);
    expect(SOURCE_REGISTRY.some((entry) => ["cdc-news", "epa-news", "hud-news", "treasury-news", "usgs-news"]
      .includes(entry.id) && entry.synthesisEnabled)).toBe(false);
  });

  it("parses bounded official RSS discovery data without broad crawling", async () => {
    const feed = await parseFeedXml(`<?xml version="1.0"?><rss version="2.0"><channel><title>Official newsroom</title>
      <item><title>Agency charges Acme Markets in fraud action</title><link>https://www.cftc.gov/PressRoom/PressReleases/9999-26</link>
      <description>Agency-authored release summary.</description><pubDate>Tue, 25 Aug 2026 12:00:00 GMT</pubDate></item>
      </channel></rss>`);
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].link).toMatch(/^https:\/\/www\.cftc\.gov\//);
    expect(feed.items[0].pubDate).toContain("2026");
  });

  it("parses bounded ABS release rows with direct dates and links", () => {
    const html = `<div class="views-row"><time datetime="2026-08-26T01:30:00Z">26 August</time><h3><a href="/statistics/economy/cpi/jul-2026"> Consumer Price Index, Australia </a></h3><div class="release__subtitle">July 2026 results</div></div>`;
    expect(parseAbsReleaseIndex(html, "https://www.abs.gov.au/release-calendar/latest-releases?page=0").items).toEqual([{
      title: "Consumer Price Index, Australia", link: "https://www.abs.gov.au/statistics/economy/cpi/jul-2026",
      pubDate: "2026-08-26T01:30:00Z", isoDate: "2026-08-26T01:30:00Z",
      contentSnippet: "July 2026 results", content: "July 2026 results", summary: "July 2026 results",
    }]);
  });

  it("normalizes structured Atom titles without guessing their series", () => {
    const feed = normalizeStructuredFeedItems({ items: [{ title: { $: { type: "xhtml" }, div: [{ _: "Consumer Price Index, ", span: [{ _: "July 2026" }] }] } }] });
    expect(feed.items[0].title).toBe("Consumer Price Index, July 2026");
    expect(identifyReleaseSeries("statcan-daily", String(feed.items[0].title))).toMatchObject({
      seriesId: "consumer-prices", period: { key: "2026-07" }, cadence: "monthly",
    });
  });

  it("recovers only an exact same-series, same-period ONS bulletin from a release landing page", () => {
    const item = { title: "UK Trade: June 2026", content: "Monthly UK trade release for June 2026.",
      url: "https://www.ons.gov.uk/releases/uktradejune2026", publishedAt: "2026-08-13T07:00:00Z",
      source: source("ons-release-calendar") };
    const html = `<a href="/economy/inflationandpriceindices/bulletins/producerpriceinflation/june2026">Wrong series</a>
      <a href="/economy/nationalaccounts/balanceofpayments/bulletins/uktrade/may2026">UK trade: May 2026</a>
      <a href="/economy/nationalaccounts/balanceofpayments/bulletins/uktrade/june2026">UK trade: June 2026</a>`;
    expect(resolveOfficialDeepReleaseUrl(item, html))
      .toBe("https://www.ons.gov.uk/economy/nationalaccounts/balanceofpayments/bulletins/uktrade/june2026");
  });

  it("maps only the current Census FT900 landing page to its exact official deep release", () => {
    const item = { title: "U.S. International Trade in Goods and Services", content: "June 2026 release.",
      url: "https://www.census.gov/foreign-trade/index.html", publishedAt: "2026-08-04T12:30:00Z",
      source: source("census-economic-indicators") };
    expect(resolveOfficialDeepReleaseUrl(item, ""))
      .toBe("https://www.census.gov/foreign-trade/current/index.html");
    expect(resolveOfficialDeepReleaseUrl({ ...item, title: "Advance retail sales" }, "")).toBeNull();
  });

  it("extracts the full official Eurostat release metadata rather than page chrome", () => {
    const description = Array.from({ length: 14 }, (_, index) =>
      `In June 2026 official industrial production measure ${index + 1} changed by ${index + 1}.0 percent.`).join(" ");
    const html = `<meta property="og:description" content="${description.replace(/&/g, "&amp;")}">`;
    expect(extractEurostatReleaseText(html)).toContain("official industrial production measure 14");
    expect(extractEurostatReleaseText(html).length).toBeGreaterThan(500);
  });

  it("normalizes monthly and quarter release periods deterministically", () => {
    expect(normalizeReleasePeriod("Consumer prices: July 2026")?.key).toBe("2026-07");
    expect(normalizeReleasePeriod("GDP, second quarter 2026")?.key).toBe("2026-Q2");
    expect(normalizeReleasePeriod("GDP, June quarter 2026")?.key).toBe("2026-Q2");
    expect(normalizeReleasePeriod("GDP first quarterly estimate: April to June 2026")?.key).toBe("2026-Q2");
  });

  it("infers a missing title year only from a nearby official publication date", () => {
    expect(publishedMonthPeriodHint("PPI for final demand unchanged in July", "2026-08-13T12:30:00Z"))
      .toBe("july 2026");
    expect(publishedMonthPeriodHint("CPI rose in December", "2026-01-15T12:30:00Z"))
      .toBe("december 2025");
    expect(publishedMonthPeriodHint("Old June comparison", "2026-11-15T12:30:00Z")).toBeNull();
  });

  it("uses a nearby official publication date to align month-only recurring release titles", () => {
    expect(recurringReleaseMatch(
      { sourceId: "bls-latest", title: "PPI for final demand unchanged in July",
        publishedAt: "2026-08-13T12:30:00Z" },
      { sourceId: "ons-release-calendar", title: "Producer price inflation, UK: July 2026",
        publishedAt: "2026-08-19T07:00:00Z" },
    )).toMatchObject({ seriesId: "producer-prices", period: "2026-07" });
  });

  it("keeps retail sales distinct from personal income and spending", () => {
    expect(recurringReleaseMatch(
      { sourceId: "bea-news-releases", title: "Personal Income and Outlays, July 2026" },
      { sourceId: "ons-release-calendar", title: "Retail sales, Great Britain: July 2026" },
    )).toBeNull();
    expect(recurringReleaseMatch(
      { sourceId: "statcan-daily", title: "Retail trade, June 2026" },
      { sourceId: "eurostat-news-releases", title: "Volume of retail trade, June 2026" },
    )).toMatchObject({ seriesId: "retail-sales", period: "2026-06" });
  });

  it("uses series and period as a rotational identity while preserving the next cycle", () => {
    const onsJuly = releaseIdentityKey({ sourceId: "ons-release-calendar",
      title: "Consumer price inflation, UK: July 2026" });
    const statcanJuly = releaseIdentityKey({ sourceId: "statcan-daily", title: "Consumer Price Index, July 2026" });
    const onsAugust = releaseIdentityKey({ sourceId: "ons-release-calendar",
      title: "Consumer price inflation, UK: August 2026" });
    expect(onsJuly).toBe("consumer-prices:2026-07");
    expect(statcanJuly).toBe(onsJuly);
    expect(onsAugust).not.toBe(onsJuly);
  });

  it("matches only explicitly mapped comparable series with the same period", () => {
    expect(recurringReleaseMatch(
      { sourceId: "abs-latest-releases", title: "Consumer Price Index, Australia July 2026" },
      { sourceId: "ons-release-calendar", title: "Consumer price inflation, UK: July 2026" },
    )).toMatchObject({ seriesId: "consumer-prices", period: "2026-07" });
    expect(recurringReleaseMatch(
      { sourceId: "abs-latest-releases", title: "Consumer Price Index, Australia July 2026" },
      { sourceId: "ons-release-calendar", title: "Consumer price inflation, UK: June 2026" },
    )).toBeNull();
    expect(recurringReleaseMatch(
      { sourceId: "abs-latest-releases", title: "Labour Force, Australia July 2026" },
      { sourceId: "ons-release-calendar", title: "Consumer price inflation, UK: July 2026" },
    )).toBeNull();
  });

  it("separates evergreen, recurring-current, and occasional-current supply", () => {
    const primary = { sourceId: "abs-latest-releases", title: "Consumer Price Index, Australia July 2026" };
    const exact = [{ sourceId: "ons-release-calendar", title: "Consumer price inflation, UK: July 2026" }];
    const wrongPeriod = [{ sourceId: "ons-release-calendar", title: "Consumer price inflation, UK: June 2026" }];
    expect(classifyReleaseSupply(primary, exact).supplyClass).toBe("recurring-current");
    expect(classifyReleaseSupply(primary, wrongPeriod).supplyClass).toBe("occasional-current");
    expect(classifyReleaseSupply(primary, exact, true).supplyClass).toBe("evergreen");
  });

  it("deduplicates rotational same-period angles but permits the next release period", () => {
    const july = buildCanonicalArticleIdentity({
      topic: "What July 2026 consumer-price releases show across official economies",
      sourceRegistryIds: ["bls-latest", "ons-release-calendar"],
      sourceUrls: ["https://bls.gov/cpi-july", "https://ons.gov.uk/cpi-july"],
      eventDate: "2026-08-15T00:00:00Z",
    });
    const rotatedJuly = buildCanonicalArticleIdentity({
      topic: "What July 2026 consumer-price releases show across official economies",
      sourceRegistryIds: ["statcan-daily", "abs-latest-releases"],
      sourceUrls: ["https://statcan.gc.ca/cpi-july", "https://abs.gov.au/cpi-july"],
      eventDate: "2026-08-20T00:00:00Z",
    });
    const august = buildCanonicalArticleIdentity({
      topic: "What August 2026 consumer-price releases show across official economies",
      sourceRegistryIds: ["bls-latest", "ons-release-calendar"],
      sourceUrls: ["https://bls.gov/cpi-august", "https://ons.gov.uk/cpi-august"],
      eventDate: "2026-09-15T00:00:00Z",
    });
    expect(articleIdentitiesAreDuplicate(july, rotatedJuly)).toBe(true);
    expect(articleIdentitiesAreDuplicate(july, august)).toBe(false);
  });

  it("keeps current discovery expansions bounded to approved official endpoints", () => {
    const bls = source("bls-latest");
    expect(bls.additionalDiscoveryUrls).toHaveLength(4);
    expect(bls.additionalDiscoveryUrls?.every((url) => new URL(url).hostname === "www.bls.gov")).toBe(true);
    expect(bls.currentDiscoveryLimit).toBe(30);
    const abs = source("abs-latest-releases");
    expect(abs.additionalDiscoveryUrls).toHaveLength(2);
    expect(abs.currentDiscoveryLimit).toBe(60);
  });

  it("extracts sufficient official release depth and excludes page chrome", () => {
    const paragraphs = Array.from({ length: 14 }, (_, index) =>
      `<p>The agency's official finding ${index + 1} identifies measurable market conduct, dates, entities, and consequences for consumers.</p>`).join("");
    const extracted = extractArticleText(`<header><p>Navigation must be excluded from evidence extraction entirely.</p></header>
      <main><h2>Official enforcement findings</h2>${paragraphs}<table><tr><td>2026 penalty totaled 12 million dollars.</td></tr></table></main>
      <footer><p>Footer must be excluded from evidence extraction entirely.</p></footer>`);
    expect(extracted.length).toBeGreaterThan(1_000);
    expect(extracted).toContain("12 million dollars");
    expect(extracted).not.toContain("Navigation must");
    expect(extracted).not.toContain("Footer must");
  });

  it("preserves independent-domain enforcement in source preflight", () => {
    const first = material("cftc-press-releases", "cftc.gov", true);
    const sameDomain = { ...material("cftc-press-releases", "cftc.gov", false), url: "https://www.cftc.gov/second" };
    expect(preflightSources([first, sameDomain]).reasons)
      .toContain("fewer than two independent permitted source domains");
    expect(preflightSources([first, material("sec-press-releases", "sec.gov", false)]).accepted).toBe(true);
  });

  it("adds only narrow, evidence-dependent pairing compatibility", () => {
    expect(compatibleSourceIds("cftc-press-releases")).toContain("sec-press-releases");
    expect(compatibleSourceIds("cfpb-newsroom")).toContain("ftc-press-releases");
    expect(compatibleSourceIds("cfpb-newsroom")).not.toContain("nasa-news-releases");
    expect(compatibleSourceIds("eurostat-news-releases")).toContain("bls-latest");
    expect(compatibleSourceIds("statcan-daily")).toContain("census-economic-indicators");
    expect(compatibleSourceIds("abs-latest-releases")).toContain("bls-latest");
    expect(compatibleSourceIds("abs-latest-releases")).not.toContain("fda-press-announcements");
  });

  it("matches recurring international statistical comparisons without weakening the threshold", () => {
    const result = matchOfficialStories(
      { title: "Euro area annual inflation reaches 2.1% in July 2026", content: "Eurostat reports consumer prices and energy costs for July 2026.", publishedAt: "2026-08-18T09:00:00Z", source: source("eurostat-news-releases") },
      { title: "Consumer Price Index rises 2.1 percent in July 2026", content: "BLS reports consumer prices and energy costs for July 2026.", publishedAt: "2026-08-12T12:30:00Z", source: source("bls-latest") },
    );
    expect(result.accepted).toBe(true);
    expect(result.ruleId).toBe("economic-indicators");
  });


  it("matches a same-subject CFTC and SEC enforcement event", () => {
    const result = matchOfficialStories(
      { title: "CFTC charges Acme Markets with digital asset fraud", content: "Acme Markets allegedly defrauded customers through commodity trading.", publishedAt: "2026-08-25T12:00:00Z", source: source("cftc-press-releases") },
      { title: "SEC charges Acme Markets with digital asset securities fraud", content: "The complaint alleges Acme Markets defrauded investors through trading.", publishedAt: "2026-08-26T12:00:00Z", source: source("sec-press-releases") },
    );
    expect(result.accepted).toBe(true);
    expect(result.ruleId).toBe("financial-enforcement");
  });

  it("rejects false pairs even when agencies share a pair group", () => {
    const result = matchOfficialStories(
      { title: "CFTC publishes annual swaps market data", content: "The report covers derivatives trading volumes.", publishedAt: "2026-08-25T12:00:00Z", source: source("cftc-press-releases") },
      { title: "SEC charges Northstar Adviser with accounting fraud", content: "The complaint concerns unrelated securities statements.", publishedAt: "2026-08-25T13:00:00Z", source: source("sec-press-releases") },
    );
    expect(result.accepted).toBe(false);
  });

  it("rejects same-subject events outside the permitted date window", () => {
    const result = matchOfficialStories(
      { title: "CFPB charges Acme Credit with debt collection fraud", content: "Acme Credit allegedly harmed consumers.", publishedAt: "2026-01-01T12:00:00Z", source: source("cfpb-newsroom") },
      { title: "FTC charges Acme Credit with debt collection fraud", content: "Acme Credit allegedly harmed consumers.", publishedAt: "2026-08-25T12:00:00Z", source: source("ftc-press-releases") },
    );
    expect(result.accepted).toBe(false);
    expect(result.signals).toEqual(["outside-time-window"]);
  });

  it("rejects stale current releases without widening the freshness window", () => {
    const currentSource = source("cfpb-newsroom");
    const stale = { title: "Old release", content: "Old official release summary", url: "https://www.consumerfinance.gov/about-us/newsroom/old-release/",
      publishedAt: "2026-07-01T00:00:00Z", source: currentSource };
    expect(currentSource.freshnessHours).toBe(336);
    expect(sourceItemIsFresh(stale, new Date("2026-08-26T00:00:00Z"))).toBe(false);
  });
});
