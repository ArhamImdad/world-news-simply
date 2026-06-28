import Groq from "groq-sdk";
import { getServerEnv } from "@/lib/env";
import type { FeedConfig } from "@/lib/rss";
import type { RewrittenArticle } from "@/types/article";

const groq = new Groq({ apiKey: getServerEnv().GROQ_API_KEY });

const allowedCategories = new Set([
  "World",
  "Politics",
  "Technology",
  "Business",
  "Sports",
  "Health",
  "Opinion",
]);
const allowedTypes = new Set(["news", "opinion", "long-read", "video"]);
const allowedRegions = new Set(["Asia", "Europe", "Middle East", "Americas", "Africa", "Global"]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function parseGroqJson(text: string) {
  const clean = text
    .replace(/```json|```/g, "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim();

  return JSON.parse(clean) as Partial<RewrittenArticle>;
}

export async function rewriteWithGroq(
  title: string,
  content: string,
  feed: FeedConfig,
  retries = 3
): Promise<RewrittenArticle> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "user",
            content: `You are a news writer. Rewrite this news article in simple, clear English.
Return a JSON object with these fields:
- title: improved headline
- content: full article (300-400 words, simple English)
- summary: 2 sentence summary
- category: one of (World, Politics, Technology, Business, Sports, Health, Opinion)
- article_type: one of (news, opinion, long-read, video)
- region: one of (Asia, Europe, Middle East, Americas, Africa, Global)
- is_breaking: true if urgent breaking news, false otherwise
- read_time: estimated reading time in minutes (1-15)

Use these feed hints unless the story clearly belongs elsewhere:
- categoryHint: ${feed.categoryHint}
- articleTypeHint: ${feed.articleTypeHint ?? "news"}
- regionHint: ${feed.regionHint ?? "Global"}
- isBreakingHint: ${feed.isBreakingHint ?? false}

Original title: ${title}
Original content: ${content}

Return only valid JSON, nothing else.`,
          },
        ],
      });

      const parsed = parseGroqJson(completion.choices[0]?.message?.content || "");
      const fallbackType = feed.articleTypeHint ?? "news";
      const category = String(parsed.category || feed.categoryHint);
      const articleType = String(parsed.article_type || fallbackType);
      const region = String(parsed.region || feed.regionHint || "Global");

      return {
        title: parsed.title || title,
        content: parsed.content || content,
        summary: parsed.summary || content.slice(0, 220),
        category: allowedCategories.has(category) ? (category as RewrittenArticle["category"]) : "World",
        article_type: allowedTypes.has(articleType) ? (articleType as RewrittenArticle["article_type"]) : fallbackType,
        region: allowedRegions.has(region) ? (region as RewrittenArticle["region"]) : "Global",
        is_breaking: Boolean(parsed.is_breaking || feed.isBreakingHint),
        read_time: clampNumber(parsed.read_time, fallbackType === "long-read" ? 9 : 3, 1, 15),
      };
    } catch (error) {
      if (attempt < retries - 1) {
        console.error(`Groq rewrite failed. Retry ${attempt + 1}/${retries - 1} in 15s.`, error);
        await sleep(15000);
      } else {
        throw error;
      }
    }
  }

  throw new Error("Groq rewrite failed after retries.");
}
