import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/env";
export type { Article } from "@/types/article";

const env = getSupabasePublicEnv();

export const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
