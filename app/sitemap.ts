import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://world-news-simply.vercel.app";

  const { data: articles } = await supabase
    .from("articles")
    .select("id, created_at")
    .order("created_at", { ascending: false });

  const articleUrls = (articles || []).map((article) => ({
    url: `${baseUrl}/article/${article.id}`,
    lastModified: new Date(article.created_at),
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "hourly" as const,
      priority: 1,
    },
    ...articleUrls,
  ];
}
