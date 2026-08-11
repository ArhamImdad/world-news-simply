import { createClient } from "@supabase/supabase-js";
import { getServerSecret, getSupabasePublicEnv } from "@/lib/env";
export type { Article } from "@/types/article";

const env = getSupabasePublicEnv();

export const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export function createServerSupabaseClient() {
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    getServerSecret("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}
