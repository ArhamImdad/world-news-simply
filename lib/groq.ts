import Groq from "groq-sdk";
import { getServerEnv } from "@/lib/env";
import type { RewrittenArticle } from "@/types/article";

const groq = new Groq({ apiKey: getServerEnv().GROQ_API_KEY });

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
Return ONLY a JSON object with these fields:
- title: improved headline
- content: full article (300-400 words, simple English)
- summary: 2 sentence summary
- is_breaking: true if urgent breaking news, false otherwise
- read_time: estimated reading time in minutes (1-15)

Original title: ${title}
Original content: ${content}

Return only valid JSON, nothing else.`,
          },
        ],
      });

      const parsed = parseGroqJson(completion.choices[0]?.message?.content || "");

      return {
        title: parsed.title || title,
        content: parsed.content || content,
        summary: parsed.summary || content.slice(0, 220),
        is_breaking: Boolean(parsed.is_breaking),
        read_time: clampNumber(parsed.read_time, 3, 1, 15),
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
