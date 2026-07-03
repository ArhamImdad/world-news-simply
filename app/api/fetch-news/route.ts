import { rewriteWithGroq } from "@/lib/groq";
import { RSS_FEEDS, parseFeed } from "@/lib/rss";
import { supabase } from "@/lib/supabase";
import { getUnsplashImage } from "@/lib/unsplash";

export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 2;
const requestLog: number[] = [];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRateLimited() {
  const now = Date.now();
  const recentRequests = requestLog.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  requestLog.length = 0;
  requestLog.push(...recentRequests);

  if (requestLog.length >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  requestLog.push(now);
  return false;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function articleExists(title: string, sourceUrl: string) {
  const { data: titleMatch, error: titleError } = await supabase
    .from("articles")
    .select("id")
    .eq("title", title)
    .limit(1);

  if (titleError) {
    throw titleError;
  }

  if (titleMatch?.length) {
    return true;
  }

  if (!sourceUrl) {
    return false;
  }

  const { data: sourceMatch, error: sourceError } = await supabase
    .from("articles")
    .select("id")
    .eq("source_url", sourceUrl)
    .limit(1);

  if (sourceError) {
    throw sourceError;
  }

  return Boolean(sourceMatch?.length);
}

async function insertArticle(payload: Record<string, unknown>) {
  const { error } = await supabase.from("articles").insert(payload);

  if (!error) return;

  throw error;
}

export async function GET() {
  try {
    if (isRateLimited()) {
      return Response.json(
        {
          success: false,
          message: "Rate limit exceeded. Try again later.",
        },
        { status: 429 }
      );
    }

    const randomFeed = RSS_FEEDS[Math.floor(Math.random() * RSS_FEEDS.length)];
    const feed = await parseFeed(randomFeed.url);
    const items = feed.items.slice(0, 2);
    let inserted = 0;

    for (const item of items) {
      const title = item.title?.trim() || "";
      const content = (item.contentSnippet || item.content || "").trim();
      const sourceUrl = item.link || "";

      if (!title || !content) continue;

      if (await articleExists(title, sourceUrl)) {
        continue;
      }

      const rewritten = await rewriteWithGroq(title, content);
      const imageUrl = await getUnsplashImage(
        randomFeed.articleTypeHint === "opinion" ? "editorial opinion" : randomFeed.categoryHint
      );

      await insertArticle({
        title: rewritten.title,
        content: rewritten.content,
        summary: rewritten.summary,
        image_url: imageUrl,
        source_url: sourceUrl,
        category: randomFeed.categoryHint,
        region: randomFeed.regionHint ?? "Global",
        article_type: randomFeed.articleTypeHint || "news",
        is_breaking: rewritten.is_breaking || false,
        is_editors_pick: false,
        read_time: rewritten.read_time || 3,
        views: 0,
      });

      inserted += 1;
      await sleep(4000);
    }

    return Response.json({
      success: true,
      feed: randomFeed.url,
      inserted,
    });
  } catch (error) {
    console.error(error);
    return Response.json(
      {
        success: false,
        error: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}
