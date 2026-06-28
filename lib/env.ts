type ServerEnv = {
  GROQ_API_KEY: string;
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  UNSPLASH_ACCESS_KEY?: string;
  NEXT_PUBLIC_SITE_URL: string;
};

function readRequiredEnv(name: keyof ServerEnv, fallback?: string) {
  const value = process.env[name] || fallback;

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getServerEnv(): ServerEnv {
  return {
    GROQ_API_KEY: readRequiredEnv("GROQ_API_KEY"),
    NEXT_PUBLIC_SUPABASE_URL: readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: readRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    UNSPLASH_ACCESS_KEY: process.env.UNSPLASH_ACCESS_KEY,
    NEXT_PUBLIC_SITE_URL: readRequiredEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000"),
  };
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
  return process.env.NEXT_PUBLIC_SITE_URL || "https://world-news-simply.vercel.app";
}
