import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import { getPublicSiteUrl } from "@/lib/env";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getPublicSiteUrl();
  const homeEntry = {
    url: baseUrl,
    lastModified: new Date(),
    changeFrequency: "hourly" as const,
    priority: 1,
  };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return [homeEntry];
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: articles } = await supabase
      .from("articles")
      .select("id, slug, created_at")
      .order("created_at", { ascending: false });

    const articleUrls = (articles || []).map((article) => ({
      url: `${baseUrl}/article/${article.slug || article.id}`,
      lastModified: new Date(article.created_at),
      changeFrequency: "daily" as const,
      priority: 0.8,
    }));

    return [homeEntry, ...articleUrls];
  } catch {
    return [homeEntry];
  }
}
