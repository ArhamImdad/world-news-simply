import Parser from "rss-parser";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { SOURCE_REGISTRY, type SourceRegistryEntry } from "@/lib/source-registry";
import { withRetry } from "@/lib/retry";

export type FeedConfig = SourceRegistryEntry;
export const RSS_FEEDS = SOURCE_REGISTRY;

const parser = new Parser();

export type NormalizedFeedItem = {
  title?: string; link?: string; pubDate?: string; isoDate?: string;
  contentSnippet?: string; content?: string; summary?: string;
};

function decodeHtml(value: string) {
  return value.replace(/&#(\d+);/g, (entity, code: string) => {
    const point = Number(code);
    return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  }).replace(/&#x([0-9a-f]+);/gi, (entity, code: string) => {
    const point = Number.parseInt(code, 16);
    return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  }).replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function cleanHtmlText(value: string) {
  return decodeHtml(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function parseAbsReleaseIndex(html: string, indexUrl: string) {
  const rows = [...html.matchAll(/<div class="views-row">([\s\S]*?)(?=<div class="views-row">|<\/div><\/div><\/div>|$)/gi)];
  return { items: rows.flatMap((row) => {
    const body = row[1];
    const timestamp = body.match(/<time\b[^>]*datetime="([^"]+)"/i)?.[1];
    const anchor = body.match(/<h3>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/i);
    if (!timestamp || !anchor) return [];
    const title = cleanHtmlText(anchor[2]);
    const subtitle = cleanHtmlText(body.match(/<div class="release__subtitle">([\s\S]*?)<\/div>/i)?.[1] ?? "");
    try {
      const link = new URL(anchor[1], indexUrl).toString();
      return title ? [{ title, link, pubDate: timestamp, isoDate: timestamp,
        contentSnippet: subtitle || title, content: subtitle || title, summary: subtitle || title }] : [];
    } catch { return []; }
  }).slice(0, 20) };
}

export function parseFeedXml(xml: string) {
  return parser.parseString(xml);
}

function structuredText(value: unknown): string {
  if (typeof value === "string") return cleanHtmlText(value);
  if (Array.isArray(value)) return value.map(structuredText).filter(Boolean).join(" ");
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return [record._, ...Object.entries(record).filter(([key]) => key !== "$" && key !== "_")
    .map(([, child]) => child)].map(structuredText).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function normalizeStructuredFeedItems(feed: { items: Array<Record<string, unknown>> }): { items: NormalizedFeedItem[] } {
  return { items: feed.items.map((item) => ({ ...item,
    title: structuredText(item.title),
    contentSnippet: structuredText(item.contentSnippet || item.content || item.summary),
  })) as NormalizedFeedItem[] };
}

async function fetchDiscovery(source: SourceRegistryEntry, url: string) {
  const response = await withRetry(() => fetchWithTimeout(url, {
    headers: { "User-Agent": "World News Simply/1.0" }, cache: "no-store",
  }), { operation: `source_feed:${source.id}` });
  if (!response.ok) throw new Error(`RSS request failed with status ${response.status}`);
  const body = await response.text();
  if (source.discoveryFormat === "abs-release-index") return parseAbsReleaseIndex(body, url);
  return normalizeStructuredFeedItems(await parseFeedXml(body) as { items: Array<Record<string, unknown>> });
}

export async function parseFeed(source: SourceRegistryEntry): Promise<{ items: NormalizedFeedItem[] }> {
  if (!source.discoveryAllowed) throw new Error(`Source ${source.id} is not approved for automated discovery.`);
  const attempts = await Promise.allSettled([source.feedApiUrl, ...(source.additionalDiscoveryUrls ?? [])]
    .map((url) => fetchDiscovery(source, url)));
  const feeds = attempts.flatMap((attempt) => attempt.status === "fulfilled" ? [attempt.value] : []);
  if (feeds.length === 0) throw new Error(`All discovery endpoints failed for source ${source.id}.`);
  const seen = new Set<string>();
  return { items: feeds.flatMap((feed) => feed.items).filter((item) => {
    const key = `${String(item.link ?? "")}|${String(item.pubDate ?? item.isoDate ?? "")}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }) };
}
