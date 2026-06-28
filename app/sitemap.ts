import type { MetadataRoute } from "next";
import { supabase } from "@/lib/supabase";

const siteUrl = "https://world-news-simply.vercel.app";
const categories = ["World", "Politics", "Technology", "Business", "Sports", "Health", "Opinion"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data } = await supabase
    .from("articles")
    .select("id,created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  return [
    {
      url: siteUrl,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 1,
    },
    ...categories.map((category) => ({
      url: `${siteUrl}/?category=${category}`,
      lastModified: new Date(),
      changeFrequency: "hourly" as const,
      priority: 0.8,
    })),
    ...(data ?? []).map((article) => ({
      url: `${siteUrl}/article/${article.id}`,
      lastModified: new Date(article.created_at),
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
