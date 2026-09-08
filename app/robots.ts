import type { MetadataRoute } from "next";
import { getPublicSiteUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getPublicSiteUrl();

  if (process.env.APP_ENV === "local") {
    return {
      rules: { userAgent: "*", disallow: "/" },
      ...(process.env.NEXT_PUBLIC_CANONICAL_SITE_URL ? { sitemap: `${siteUrl}/sitemap.xml`, host: siteUrl } : {}),
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/admin/", "/internal/", "/review/"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
