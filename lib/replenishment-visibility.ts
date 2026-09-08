import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ReplenishmentTelemetryRecorder, RlsObservation } from "@/lib/replenishment-telemetry";

function decode(value: string) { try { return decodeURIComponent(value); } catch { return value; } }

function databaseConnection(value: string) {
  const stripped = value.replace(/^postgres(?:ql)?:\/\//, "");
  const at = stripped.lastIndexOf("@");
  const credentials = stripped.slice(0, at);
  const endpoint = stripped.slice(at + 1);
  const credentialSeparator = credentials.indexOf(":");
  const slash = endpoint.indexOf("/");
  const hostPort = endpoint.slice(0, slash);
  const portSeparator = hostPort.lastIndexOf(":");
  return { user: decode(credentials.slice(0, credentialSeparator)), password: decode(credentials.slice(credentialSeparator + 1)),
    host: hostPort.slice(0, portSeparator), port: Number(hostPort.slice(portSeparator + 1)),
    database: endpoint.slice(slash + 1).split("?")[0], ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000, query_timeout: 20_000, statement_timeout: 20_000 };
}

async function directRoleCounts(connectionString: string) {
  const { Client } = await import("pg");
  const client = new Client(databaseConnection(connectionString));
  await client.connect();
  const idsAs = async (role: "anon" | "authenticated") => {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL ROLE ${role}`);
      const result = await client.query<{ id: string }>("SELECT id::text FROM public.articles");
      return new Set(result.rows.map((row) => row.id));
    } finally {
      await client.query("ROLLBACK");
    }
  };
  try {
    const ready = await client.query<{ id: string }>(`SELECT id::text FROM public.articles
      WHERE publication_status = 'draft' AND editorial_state = 'ready'`);
    const readyIds = new Set(ready.rows.map((row) => row.id));
    const anonIds = await idsAs("anon");
    const authenticatedIds = await idsAs("authenticated");
    return { anon: [...readyIds].filter((id) => anonIds.has(id)).length,
      authenticated: [...readyIds].filter((id) => authenticatedIds.has(id)).length, service: readyIds.size };
  } finally { await client.end(); }
}

async function readyCount(client: SupabaseClient) {
  const { count, error } = await client.from("articles").select("id", { count: "exact", head: true })
    .eq("publication_status", "draft").eq("editorial_state", "ready");
  if (error) throw Object.assign(new Error("READY visibility query failed."), { code: error.code });
  return count ?? 0;
}

export type ReadyVisibilityMeasurement = {
  anonVisibleReady: number;
  authenticatedVisibleReady: number;
  serviceReady: number;
  temporaryAuthUserDeleted: boolean | null;
};

export async function measureReadyVisibility(options: {
  serviceClient: SupabaseClient;
  directDatabaseUrl?: string | null;
  directRoleCounter?: typeof directRoleCounts;
  publicUrl?: string;
  anonKey?: string;
  publicClientFactory?: typeof createClient;
  readyCounter?: typeof readyCount;
}): Promise<ReadyVisibilityMeasurement> {
  const directDatabaseUrl = options.directDatabaseUrl === undefined
    ? process.env.STAGING_DATABASE_URL : options.directDatabaseUrl;
  if (directDatabaseUrl) {
    const counts = await (options.directRoleCounter ?? directRoleCounts)(directDatabaseUrl);
    return { anonVisibleReady: counts.anon, authenticatedVisibleReady: counts.authenticated,
      serviceReady: counts.service, temporaryAuthUserDeleted: null };
  }
  const url = options.publicUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = options.anonKey ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw Object.assign(new Error("Staging public Supabase configuration is unavailable."), { code: "missing-public-config" });
  const clientFactory = options.publicClientFactory ?? createClient;
  const countReady = options.readyCounter ?? readyCount;
  const anon = clientFactory(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const serviceReady = await countReady(options.serviceClient);
  const anonVisibleReady = await countReady(anon);
  const email = `telemetry-${crypto.randomUUID()}@example.invalid`;
  const password = `${crypto.randomUUID()}Aa1!${crypto.randomUUID()}`;
  const created = await options.serviceClient.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw Object.assign(new Error("Temporary authenticated RLS principal creation failed."),
    { code: created.error?.code ?? "temporary-auth-create-failed" });
  const userId = created.data.user.id;
  try {
    const authenticated = clientFactory(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signedIn = await authenticated.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw Object.assign(new Error("Temporary authenticated RLS sign-in failed."),
      { code: signedIn.error.code ?? "temporary-auth-sign-in-failed" });
    const authenticatedVisibleReady = await countReady(authenticated);
    await authenticated.auth.signOut();
    return { anonVisibleReady, authenticatedVisibleReady, serviceReady, temporaryAuthUserDeleted: true };
  } finally {
    const deleted = await options.serviceClient.auth.admin.deleteUser(userId);
    if (deleted.error) throw Object.assign(new Error("Temporary authenticated RLS principal cleanup failed."),
      { code: deleted.error.code ?? "temporary-auth-delete-failed" });
  }
}

export async function observeControlledRlsVisibility(options: {
  telemetry: ReplenishmentTelemetryRecorder;
  serviceClient: SupabaseClient;
  phase: string;
  required?: boolean;
}) {
  const observedAt = new Date().toISOString();
  const required = options.required ?? true;
  const result: RlsObservation = { phase: options.phase, observedAt, required, anonVisibleReady: null,
    authenticatedVisibleReady: null, serviceReady: null, temporaryAuthUserRef: null,
    temporaryAuthUserDeleted: null, errorCode: null };
  try {
    const measurement = await measureReadyVisibility({ serviceClient: options.serviceClient });
    result.anonVisibleReady = measurement.anonVisibleReady;
    result.authenticatedVisibleReady = measurement.authenticatedVisibleReady;
    result.serviceReady = measurement.serviceReady;
    result.temporaryAuthUserDeleted = measurement.temporaryAuthUserDeleted;
  } catch (error) {
    result.errorCode = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code).slice(0, 80) : error instanceof Error ? error.name : "unknown";
  }
  options.telemetry.recordRls(result);
  return result;
}
