import { rewriteWithGroq } from "@/lib/groq";
import { RSS_FEEDS, parseFeed } from "@/lib/rss";
import { supabase } from "@/lib/supabase";
import { getUnsplashImage } from "@/lib/unsplash";

export const dynamic = "force-dynamic";

const ARTICLE_DELAY_MS = 8000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 2;
const requestLog: number[] = [];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type JobSummary = {
  feedsChecked: number;
  inserted: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  failedFeeds: Array<{ url: string; error: string }>;
  failedArticles: Array<{ feedUrl: string; title: string; error: string }>;
};

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
  if (isRateLimited()) {
    return Response.json(
      {
        success: false,
        message: "Rate limit exceeded. Try again later.",
      },
      { status: 429 }
    );
  }

  const summary: JobSummary = {
    feedsChecked: 0,
    inserted: 0,
    skippedDuplicates: 0,
    skippedInvalid: 0,
    failedFeeds: [],
    failedArticles: [],
  };

  for (const feed of RSS_FEEDS) {
    summary.feedsChecked += 1;

    let parsedFeed;
    try {
      parsedFeed = await parseFeed(feed.url);
    } catch (error) {
      summary.failedFeeds.push({ url: feed.url, error: getErrorMessage(error) });
      continue;
    }

    const items = parsedFeed.items.slice(0, 1);

    for (const item of items) {
      const title = item.title?.trim() || "";
      const content = (item.contentSnippet || item.content || "").trim();
      const sourceUrl = item.link || "";

      if (!title || !content) {
        summary.skippedInvalid += 1;
        continue;
      }

      try {
        if (await articleExists(title, sourceUrl)) {
          summary.skippedDuplicates += 1;
          continue;
        }

        const rewritten = await rewriteWithGroq(title, content, feed);
        const imageUrl = await getUnsplashImage(
          rewritten.article_type === "opinion" ? "editorial opinion" : rewritten.category
        );

        await insertArticle({
          title: rewritten.title,
          content: rewritten.content,
          summary: rewritten.summary,
          image_url: imageUrl,
          source_url: sourceUrl,
          category: rewritten.category,
          region: rewritten.region,
          article_type: rewritten.article_type,
          is_breaking: rewritten.is_breaking,
          is_editors_pick: false,
          read_time: rewritten.read_time,
          views: 0,
        });

        summary.inserted += 1;
        await sleep(ARTICLE_DELAY_MS);
      } catch (error) {
        summary.failedArticles.push({
          feedUrl: feed.url,
          title,
          error: getErrorMessage(error),
        });
      }
    }
  }

  const status = summary.inserted > 0 || summary.failedFeeds.length < RSS_FEEDS.length ? 200 : 502;

  return Response.json(
    {
      success: status === 200,
      message: status === 200 ? "Articles fetched and saved." : "All feeds failed.",
      summary,
    },
    { status }
  );
}
