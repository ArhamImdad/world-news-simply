import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { withRetry } from "@/lib/retry";
import { parseFeed } from "@/lib/rss";
import { compatibleSourceIds, matchOfficialStories } from "@/lib/source-pairs";
import { identifyReleaseSeries } from "@/lib/release-series";
import {
  SYNTHESIS_SOURCES,
  sourceCanBeSynthesized,
  sourceUrlIsAllowed,
  type SourceRegistryEntry,
} from "@/lib/source-registry";
import type { SourceMaterial } from "@/types/article";

export type SupportingItem = {
  title: string;
  content: string;
  url: string;
  publishedAt: string | null;
  source: SourceRegistryEntry;
};

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach(
      (parameter) => url.searchParams.delete(parameter)
    );
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return "";
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&#(\d+);/g, (entity, code: string) => {
      const point = Number(code);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    })
    .replace(/&#x([0-9a-f]+);/gi, (entity, code: string) => {
      const point = Number.parseInt(code, 16);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    })
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function cleanText(value: string) {
  return decodeHtml(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function extractEurostatReleaseText(html: string) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const property = tag.match(/\bproperty\s*=\s*(["'])og:description\1/i);
    if (!property) continue;
    const content = tag.match(/\bcontent\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] ?? "";
    const extracted = cleanText(content);
    if (extracted.length >= 500) return extracted;
  }
  return "";
}

function releaseIdentity(item: Pick<SupportingItem, "title" | "content" | "source">, periodContext?: string) {
  return identifyReleaseSeries(item.source.id, item.title, periodContext ?? `${item.title} ${item.content}`);
}

export function resolveOfficialDeepReleaseUrl(item: SupportingItem, html: string) {
  const original = normalizeUrl(item.url);
  if (!original) return null;
  const identity = releaseIdentity(item);
  if (!identity?.period) return null;

  if (item.source.id === "census-economic-indicators") {
    const url = new URL(original);
    return identity.seriesId === "international-trade" && url.pathname.toLowerCase() === "/foreign-trade/index.html"
      ? new URL("/foreign-trade/current/index.html", url).toString() : null;
  }

  if (item.source.id !== "ons-release-calendar" || !new URL(original).pathname.toLowerCase().startsWith("/releases/")) {
    return null;
  }
  for (const anchor of html.matchAll(/<a\b[^>]*href\s*=\s*(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    let candidateUrl = "";
    try { candidateUrl = new URL(decodeHtml(anchor[2]), original).toString(); } catch { continue; }
    if (!new URL(candidateUrl).pathname.toLowerCase().includes("/bulletins/") ||
        !sourceUrlIsAllowed(item.source, candidateUrl)) continue;
    const candidateTitle = cleanText(anchor[3]);
    const candidate = identifyReleaseSeries(item.source.id, candidateTitle,
      `${candidateTitle} ${new URL(candidateUrl).pathname}`);
    if (candidate?.seriesId === identity.seriesId && candidate.period?.key === identity.period.key) return candidateUrl;
  }
  return null;
}

export function extractArticleText(html: string) {
  const jsonBodies = [...html.matchAll(/"articleBody"\s*:\s*"((?:\\.|[^"\\])*)"/gi)]
    .map((match) => { try { return JSON.parse(`"${match[1]}"`) as string; } catch { return ""; } })
    .map(cleanText).filter(Boolean);
  const longestJsonBody = jsonBodies.sort((a, b) => b.length - a.length)[0];
  if (longestJsonBody?.length >= 500) return longestJsonBody;

  // Prefer content roots used by official agency templates. The bounded slice
  // avoids treating a deeply nested div as if its first closing tag ended the
  // article, while still preventing the page footer from entering the source.
  const contentRoot = html.match(
    /<(?:main|div|section)\b[^>]*(?:class|id)=["'][^"']*\b(?:article-content|detailPageMiddleColumn|main-content)\b[^"']*["'][^>]*>/i
  );
  let scoped = "";
  if (contentRoot?.index !== undefined) {
    const start = contentRoot.index + contentRoot[0].length;
    const remainder = html.slice(start, start + 300_000);
    const footer = remainder.search(/<footer\b|<div\b[^>]*id=["']footer/i);
    scoped = footer >= 0 ? remainder.slice(0, footer) : remainder;
  }

  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  scoped ||= articleMatch?.[1] ?? mainMatch?.[1] ?? "";

  // Some official methodology pages (including current BLS templates) use a
  // Drupal body-field div instead of <article> or <main>. Scope from that
  // semantic content marker to the footer so navigation remains excluded.
  if (!scoped) {
    const marker = html.match(/<(?:div|section)\b[^>]*class=["'][^"']*\bfield--name-body\b[^"']*["'][^>]*>/i)
      ?? html.match(/<(?:div|section)\b[^>]*class=["'][^"']*\b(?:main-content|article-body|release-content|region-content)\b[^"']*["'][^>]*>/i)
      ?? html.match(/<(?:div|section)\b[^>]*id=["'](?:article|content|main-content)["'][^>]*>/i);
    if (marker?.index !== undefined) {
      const start = marker.index + marker[0].length;
      const remainder = html.slice(start);
      const footer = remainder.search(/<footer\b|<div\b[^>]*id=["']footer/i);
      scoped = footer >= 0 ? remainder.slice(0, footer) : remainder;
    }
  }

  if (!scoped) return "";
  const withoutNoise = scoped
    .replace(/<(script|style|svg|nav|footer|form|aside|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(?:div|section)\b[^>]*(?:cookie|newsletter|subscribe|social-share|related-content)[^>]*>[\s\S]*?<\/(?:div|section)>/gi, " ");
  const blocks = [...withoutNoise.matchAll(/<(p|h2|h3|li|tr|pre)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => ({ tag: match[1].toLowerCase(), text: cleanText(match[2]) }))
    .filter(({ tag, text }) => text.length >= (tag === "h2" || tag === "h3" ? 15 : 35) &&
      !/^(share|subscribe|contact us|read more|back to top)\b/i.test(text))
    .map(({ text }) => text);
  return [...new Set(blocks)].join("\n");
}

function validPublishedAt(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function buildSourceMaterial(item: SupportingItem, isPrimary: boolean): Promise<SourceMaterial | null> {
  const { source } = item;
  if (!sourceCanBeSynthesized(source)) return null;
  const originalUrl = normalizeUrl(item.url);
  if (!originalUrl || !sourceUrlIsAllowed(source, originalUrl)) return null;

  let finalUrl = originalUrl;
  let text = cleanText(item.content);
  if (source.contentFetchAllowed) {
    try {
      const response = await withRetry(() => fetchWithTimeout(originalUrl, {
        headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "World News Simply/1.0" },
        cache: "no-store",
      }, 12000), { operation: `source_page:${source.id}` });
      const finalCandidate = normalizeUrl(response.url) || originalUrl;
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !sourceUrlIsAllowed(source, finalCandidate) ||
          (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml"))) return null;
      const html = (await response.text()).slice(0, 750_000);
      if (source.requiredLicenseMarker && !source.requiredLicenseMarker.test(html)) return null;
      const extracted = source.id === "eurostat-news-releases"
        ? [extractArticleText(html), extractEurostatReleaseText(html)].sort((a, b) => b.length - a.length)[0]
        : extractArticleText(html);
      if (extracted.length > text.length) text = extracted;
      finalUrl = finalCandidate;

      const deepUrl = resolveOfficialDeepReleaseUrl(item, html);
      if (deepUrl && deepUrl !== finalCandidate) {
        const deepResponse = await withRetry(() => fetchWithTimeout(deepUrl, {
          headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "World News Simply/1.0" },
          cache: "no-store",
        }, 12000), { operation: `source_deep_release:${source.id}` });
        const resolvedDeepUrl = normalizeUrl(deepResponse.url) || deepUrl;
        const deepType = deepResponse.headers.get("content-type") ?? "";
        if (deepResponse.ok && sourceUrlIsAllowed(source, resolvedDeepUrl) &&
            (deepType.includes("text/html") || deepType.includes("application/xhtml+xml"))) {
          const deepHtml = (await deepResponse.text()).slice(0, 750_000);
          const deepText = extractArticleText(deepHtml);
          const originalIdentity = releaseIdentity(item);
          const deepIdentity = releaseIdentity(item, `${item.title} ${deepText}`);
          if (originalIdentity?.period && deepIdentity?.seriesId === originalIdentity.seriesId &&
              deepIdentity.period?.key === originalIdentity.period.key && deepText.length > text.length) {
            text = deepText;
            finalUrl = resolvedDeepUrl;
          }
        }
      }
    } catch {
      if (source.requiredLicenseMarker) return null;
    }
  }

  text = text.slice(0, source.maxSourceCharacters);
  if (!text) return null;
  return {
    title: cleanText(item.title), publisher: source.publisher, url: finalUrl, text,
    publishedAt: item.publishedAt, licenseType: source.licenseType, sourceType: source.sourceType,
    reliability: source.reliability, isPrimary,
    registryId: source.id, commercialUseAllowed: source.commercialUseAllowed,
    aiProcessingAllowed: source.aiProcessingAllowed, transformationAllowed: source.transformationAllowed,
    permissionUrl: source.permissionUrl,
  };
}

function distinctRelatedSources(selected: SourceRegistryEntry) {
  const compatible = new Set(compatibleSourceIds(selected.id));
  return SYNTHESIS_SOURCES.filter((source) => compatible.has(source.id)).slice(0, 8);
}

export async function loadSupportingItems(selected: SourceRegistryEntry): Promise<SupportingItem[]> {
  const results = await Promise.allSettled(distinctRelatedSources(selected).map(async (source) => {
    const parsed = await parseFeed(source);
    return parsed.items.slice(0, source.currentDiscoveryLimit ?? 15).flatMap((item) => {
      const title = cleanText(item.title ?? "");
      const content = cleanText(item.contentSnippet || item.content || item.summary || "").slice(0, source.maxSourceCharacters);
      const url = normalizeUrl(item.link || "");
      return title && content && sourceUrlIsAllowed(source, url) ? [{
        title, content, url, publishedAt: validPublishedAt(item.isoDate || item.pubDate), source,
      }] : [];
    });
  }));
  return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

export async function collectSourceMaterials(primaryItem: SupportingItem, supportingItems: SupportingItem[]) {
  const primary = await buildSourceMaterial(primaryItem, true);
  if (!primary) return [];
  const matches = supportingItems.map((item) => ({ item, match: matchOfficialStories(primaryItem, item) }))
    .filter(({ match }) => match.accepted)
    .sort((a, b) => b.match.score - a.match.score);
  const exactSeriesMatches = matches.filter(({ match }) => match.signals.includes("release-series"));
  const candidates = exactSeriesMatches.length ? exactSeriesMatches : matches;
  const selected: typeof candidates = [];
  const selectedDomains = new Set<string>();
  const selectedUnderlyingReleases = new Set<string>();
  const underlyingRelease = (item: SupportingItem) => {
    const identity = releaseIdentity(item);
    return identity?.seriesId === "international-trade" && identity.period &&
      ["bea-news-releases", "census-economic-indicators"].includes(item.source.id)
      ? `us-joint-trade:${identity.period.key}` : null;
  };
  const primaryUnderlyingRelease = underlyingRelease(primaryItem);
  if (primaryUnderlyingRelease) selectedUnderlyingReleases.add(primaryUnderlyingRelease);
  for (const candidate of candidates) {
    const group = underlyingRelease(candidate.item);
    if (selectedDomains.has(candidate.item.source.domain) || group && selectedUnderlyingReleases.has(group)) continue;
    selected.push(candidate);
    selectedDomains.add(candidate.item.source.domain);
    if (group) selectedUnderlyingReleases.add(group);
    if (selected.length === 2) break;
  }
  const supporting = await Promise.all(selected.map(({ item }) => buildSourceMaterial(item, false)));
  return [primary, ...supporting.filter((source): source is SourceMaterial => Boolean(source))];
}

export async function collectExplicitSourceMaterials(items: SupportingItem[]) {
  const materials = await Promise.all(items.map((item, index) => buildSourceMaterial(item, index === 0)));
  return materials.filter((source): source is SourceMaterial => Boolean(source));
}
