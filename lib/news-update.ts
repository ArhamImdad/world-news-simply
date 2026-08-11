import { rewriteWithGroq } from "@/lib/groq";
import { RSS_FEEDS, parseFeed } from "@/lib/rss";
import { createServerSupabaseClient } from "@/lib/supabase";
import { getUnsplashImage } from "@/lib/unsplash";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeHeadline(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function headlineTokens(value: string) {
  const ignored = new Set(["a", "an", "and", "at", "for", "from", "in", "of", "on", "the", "to", "with"]);
  return new Set(normalizeHeadline(value).split(" ").filter((token) => token.length > 2 && !ignored.has(token)));
}

function headlinesAreSimilar(first: string, second: string) {
  const a = headlineTokens(first);
  const b = headlineTokens(second);
  if (a.size === 0 || b.size === 0) return false;

  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union >= 0.72;
}

function normalizeSourceUrl(value: string) {
  if (!value) return "";

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return "";
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

function generateSlug(title: string) {
  const base = normalizeHeadline(title).replace(/\s+/g, "-").slice(0, 80) || "article";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function updateNews() {
  const database = createServerSupabaseClient();
  const randomFeed = RSS_FEEDS[Math.floor(Math.random() * RSS_FEEDS.length)];
  const feed = await parseFeed(randomFeed.url);
  const items = feed.items.slice(0, 2);
  const { data: recentArticles, error: recentError } = await database
    .from("articles")
    .select("title,source_url")
    .order("created_at", { ascending: false })
    .limit(200);

  if (recentError) throw recentError;

  const known = recentArticles ?? [];
  let inserted = 0;
  let skipped = 0;

  for (const item of items) {
    const title = item.title?.trim() || "";
    const content = (item.contentSnippet || item.content || "").trim();
    const sourceUrl = normalizeSourceUrl(item.link || "");

    if (!title || !content || !sourceUrl) {
      skipped += 1;
      continue;
    }

    const duplicate = known.some((article) =>
      normalizeSourceUrl(article.source_url || "") === sourceUrl ||
      headlinesAreSimilar(article.title, title)
    );

    if (duplicate) {
      skipped += 1;
      continue;
    }

    const rewritten = await rewriteWithGroq(title, content);
    const imageUrl = await getUnsplashImage(
      randomFeed.articleTypeHint === "opinion" ? "editorial news" : randomFeed.categoryHint
    );
    const { error } = await database.from("articles").insert({
      title: rewritten.title,
      slug: generateSlug(rewritten.title),
      content: rewritten.content,
      summary: rewritten.summary,
      image_url: imageUrl,
      source_url: sourceUrl,
      category: randomFeed.categoryHint,
      region: randomFeed.regionHint ?? "Global",
      article_type: randomFeed.articleTypeHint || "news",
      is_breaking: Boolean(randomFeed.isBreakingHint),
      is_editors_pick: false,
      read_time: rewritten.read_time || 3,
      views: 0,
    });

    if (error) throw error;
    known.push({ title: rewritten.title, source_url: sourceUrl });
    inserted += 1;
    await sleep(1500);
  }

  return { inserted, skipped, source: new URL(randomFeed.url).hostname };
}
