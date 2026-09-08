import { createClient } from "@supabase/supabase-js";
import { getServerSecret, getSupabasePublicEnv } from "@/lib/env";
import { assertWritesAllowed, supabaseRequestTimeoutFor } from "@/lib/environment-isolation";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
export type { Article } from "@/types/article";

const env = getSupabasePublicEnv();

export const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export function createServerSupabaseClient() {
  const isolation = assertWritesAllowed("service-role Supabase access");
  const timeoutMs = supabaseRequestTimeoutFor(isolation.mode);
  const options = timeoutMs !== null ? {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      fetchWithTimeout(input, init, timeoutMs) },
  } : { auth: { persistSession: false, autoRefreshToken: false } };
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    getServerSecret("SUPABASE_SERVICE_ROLE_KEY"),
    options
  );
}
