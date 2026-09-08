export const PRODUCTION_SUPABASE_PROJECT_REF = "mgfnosozkomhinsaztbs";
export const STAGING_SUPABASE_PROJECT_REF = "xfmbyxjevjliiwndcrpr";
export const STAGING_SUPABASE_REQUEST_TIMEOUT_MS = 20_000;

export type AppEnvironment = "local" | "production" | "staging" | "test";
export type EnvironmentSource = Record<string, string | undefined>;

const LOCAL_FORBIDDEN_SECRETS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "GROQ_API_KEY",
  "UNSPLASH_ACCESS_KEY",
] as const;

export function supabaseRequestTimeoutFor(mode: AppEnvironment) {
  return mode === "staging" ? STAGING_SUPABASE_REQUEST_TIMEOUT_MS : null;
}

const DATABASE_URL_VARIABLES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "STAGING_DATABASE_URL",
  "DATABASE_URL",
  "SUPABASE_DB_URL",
  "POSTGRES_URL",
] as const;

function appEnvironment(source: EnvironmentSource): AppEnvironment {
  const value = source.APP_ENV?.trim();
  if (value === "local" || value === "production" || value === "staging" || value === "test") return value;
  throw new Error("APP_ENV must be explicitly set to local, production, staging, or test before application code runs.");
}

function assertProductionSiteUrl(source: EnvironmentSource) {
  const configured = source.NEXT_PUBLIC_SITE_URL?.trim();
  let url: URL;
  try { url = new URL(configured ?? ""); } catch {
    throw new Error("APP_ENV=production requires a custom HTTPS NEXT_PUBLIC_SITE_URL origin.");
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash ||
      ["localhost", "127.0.0.1", "::1"].includes(hostname) || hostname.endsWith(".localhost") ||
      hostname.endsWith(".workers.dev") || hostname.endsWith(".supabase.co") || hostname.endsWith(".vercel.app")) {
    throw new Error("APP_ENV=production requires a custom HTTPS NEXT_PUBLIC_SITE_URL origin.");
  }
}

export function supabaseProjectRefFromUrl(value: string, variableName: string) {
  if (/^postgres(?:ql)?:\/\//i.test(value)) {
    const embeddedRefs = [
      value.match(/^postgres(?:ql)?:\/\/postgres[.]([a-z]{20})(?=[:@.])/i)?.[1],
      value.match(/@db[.]([a-z]{20})[.]supabase[.]co(?=[:/]|$)/i)?.[1],
    ].filter((entry): entry is string => Boolean(entry)).map((entry) => entry.toLowerCase());
    if (new Set(embeddedRefs).size > 1) throw new Error(`${variableName} contains conflicting Supabase project refs.`);
    if (embeddedRefs[0]) return embeddedRefs[0];
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${variableName} is not a valid URL.`); }
  if (!["http:", "https:", "postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(`${variableName} uses an unsupported protocol.`);
  }
  const labels = url.hostname.toLowerCase().split(".");
  if (labels.at(-2) === "supabase" && labels.at(-1) === "co") {
    if (labels[0] === "db" && labels[1]) return labels[1];
    if (labels[0] && labels[0] !== "api" && labels[0] !== "pooler") return labels[0];
  }
  const username = decodeURIComponent(url.username || "");
  const usernameMatch = username.match(/(?:^|[.])([a-z]{20})(?:$|[.])/i);
  if (usernameMatch?.[1]) return usernameMatch[1].toLowerCase();
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())) return "local";
  throw new Error(`Unable to derive a Supabase project ref from ${variableName}.`);
}

export function validateAppEnvironment(source: EnvironmentSource = process.env) {
  const mode = appEnvironment(source);
  const configured = DATABASE_URL_VARIABLES.flatMap((name) => {
    const value = source[name]?.trim();
    return value ? [{ name, projectRef: supabaseProjectRefFromUrl(value, name) }] : [];
  });

  if (mode === "test") {
    const protectedTarget = configured.find((entry) =>
      entry.projectRef === PRODUCTION_SUPABASE_PROJECT_REF || entry.projectRef === STAGING_SUPABASE_PROJECT_REF);
    if (protectedTarget) throw new Error(`APP_ENV=test cannot target a protected Supabase project through ${protectedTarget.name}.`);
    return { mode, expectedProjectRef: null, configuredProjectRefs: configured } as const;
  }

  if (!source.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
    throw new Error(`${mode} mode requires NEXT_PUBLIC_SUPABASE_URL.`);
  }
  const expectedProjectRef = mode === "staging" ? STAGING_SUPABASE_PROJECT_REF : PRODUCTION_SUPABASE_PROJECT_REF;
  const mismatch = configured.find((entry) => entry.projectRef !== expectedProjectRef);
  if (mismatch) throw new Error(`${mismatch.name} does not target the Supabase project required by APP_ENV=${mode}.`);
  if (configured.length === 0) throw new Error(`No Supabase project URL is configured for APP_ENV=${mode}.`);
  if (mode === "production") {
    assertProductionSiteUrl(source);
    if (!source.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()) {
      throw new Error("production mode requires NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    }
  }
  if (mode === "local") {
    const privilegedSecret = LOCAL_FORBIDDEN_SECRETS.find((name) => source[name]?.trim());
    if (privilegedSecret) {
      throw new Error(`APP_ENV=local forbids privileged environment variable ${privilegedSecret}.`);
    }
    if (source.NEXT_PUBLIC_ADSENSE_ENABLED?.trim() === "true") {
      throw new Error("APP_ENV=local forbids AdSense activation.");
    }
  }
  return { mode, expectedProjectRef, configuredProjectRefs: configured } as const;
}

export function assertAppEnvironment(source: EnvironmentSource = process.env) {
  return validateAppEnvironment(source);
}

export function runAfterEnvironmentGuard<T>(operation: () => T, source: EnvironmentSource = process.env) {
  assertAppEnvironment(source);
  return operation();
}

export class LocalOperationRefusedError extends Error {
  constructor(operation: string) {
    super(`APP_ENV=local is read-only; refusing ${operation}.`);
    this.name = "LocalOperationRefusedError";
  }
}

export function assertWritesAllowed(operation = "privileged write operation", source: EnvironmentSource = process.env) {
  const isolation = assertAppEnvironment(source);
  if (isolation.mode === "local") throw new LocalOperationRefusedError(operation);
  return isolation;
}

export function assertProviderCallsAllowed(provider = "content provider", source: EnvironmentSource = process.env) {
  const isolation = assertAppEnvironment(source);
  if (isolation.mode === "local") throw new LocalOperationRefusedError(`${provider} execution`);
  return isolation;
}

export function assertCronExecutionAllowed(source: EnvironmentSource = process.env) {
  const isolation = assertAppEnvironment(source);
  if (isolation.mode === "local") throw new LocalOperationRefusedError("cron execution");
  return isolation;
}

export function isLocalEnvironment(source: EnvironmentSource = process.env) {
  return assertAppEnvironment(source).mode === "local";
}

export const DATABASE_ENVIRONMENT_VARIABLES = [...DATABASE_URL_VARIABLES];
export const LOCAL_PRIVILEGED_ENVIRONMENT_VARIABLES = [...LOCAL_FORBIDDEN_SECRETS];
