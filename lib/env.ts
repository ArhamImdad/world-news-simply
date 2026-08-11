function readRequiredEnv(name: string, fallback?: string) {
  const value = process.env[name] || fallback;

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getSupabasePublicEnv() {
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

export function getPublicSiteUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const fallback = "http://localhost:3000";

  try {
    const url = new URL(configuredUrl || fallback);
    if (!['http:', 'https:'].includes(url.protocol)) return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}

export function getServerSecret(name: "GROQ_API_KEY" | "SUPABASE_SERVICE_ROLE_KEY" | "CRON_SECRET") {
  return readRequiredEnv(name);
}
