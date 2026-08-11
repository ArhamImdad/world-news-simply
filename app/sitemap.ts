import type { MetadataRoute } from "next";
import { getArticlePath } from "@/lib/article-url";
import { getPublicSiteUrl } from "@/lib/env";
import { supabase } from "@/lib/supabase";

const staticPages = [
  "",
  "/about",
  "/contact",
  "/editorial-policy",
  "/corrections-policy",
  "/privacy",
  "/terms",
  "/disclaimer",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getPublicSiteUrl();
  const { data: articles, error } = await supabase
    .from("articles")
    .select("id,slug,created_at")
    .order("created_at", { ascending: false });

  if (error) console.error("Sitemap article query failed:", error.message);

  const articleUrls = (articles || []).map((article) => {
    const modified = new Date(article.created_at);
    return {
      url: `${baseUrl}${getArticlePath(article)}`,
      ...(Number.isNaN(modified.getTime()) ? {} : { lastModified: modified }),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    };
  });

  return [
    ...staticPages.map((path, index) => ({
      url: `${baseUrl}${path}`,
      changeFrequency: (index === 0 ? "daily" : "monthly") as "daily" | "monthly",
      priority: index === 0 ? 1 : 0.4,
    })),
    ...articleUrls,
  ];
}
