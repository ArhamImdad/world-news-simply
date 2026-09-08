import { assertAppEnvironment } from "@/lib/environment-isolation";

function readRequiredEnv(name: string, fallback?: string) {
  const value = process.env[name] || fallback;

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getSupabasePublicEnv() {
  if (typeof window === "undefined") assertAppEnvironment();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing required Supabase public environment variables.");
  }

  return {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
  };
}

export function resolvePublicSiteUrl(configuredUrl: string | undefined, appEnvironment: string | undefined) {
  const fallback = "http://localhost:3000";

  try {
    const url = new URL(configuredUrl || fallback);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Public site URL must use HTTP or HTTPS.");
    if (appEnvironment === "production") {
      const hostname = url.hostname.toLowerCase();
      if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash ||
          ["localhost", "127.0.0.1", "::1"].includes(hostname) || hostname.endsWith(".localhost") ||
          hostname.endsWith(".workers.dev") || hostname.endsWith(".supabase.co") ||
          hostname.endsWith(".vercel.app")) {
        throw new Error("Production NEXT_PUBLIC_SITE_URL must be the custom HTTPS canonical origin.");
      }
    }
    return url.origin;
  } catch {
    if (appEnvironment === "production") {
      throw new Error("Production NEXT_PUBLIC_SITE_URL must be the custom HTTPS canonical origin.");
    }
    return fallback;
  }
}

export function getPublicSiteUrl() {
  const mode = process.env.APP_ENV?.trim();
  const canonicalUrl = mode === "local" ? process.env.NEXT_PUBLIC_CANONICAL_SITE_URL?.trim() : undefined;
  return canonicalUrl
    ? resolvePublicSiteUrl(canonicalUrl, "production")
    : resolvePublicSiteUrl(process.env.NEXT_PUBLIC_SITE_URL?.trim(), mode);
}

export function getServerSecret(name: "GROQ_API_KEY" | "SUPABASE_SERVICE_ROLE_KEY" | "CRON_SECRET") {
  return readRequiredEnv(name);
}
