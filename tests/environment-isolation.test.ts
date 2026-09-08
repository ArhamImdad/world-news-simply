import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  PRODUCTION_SUPABASE_PROJECT_REF,
  STAGING_SUPABASE_PROJECT_REF,
  STAGING_SUPABASE_REQUEST_TIMEOUT_MS,
  runAfterEnvironmentGuard,
  supabaseRequestTimeoutFor,
  validateAppEnvironment,
} from "@/lib/environment-isolation";

const temporaryDirectories: string[] = [];
afterEach(() => { for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const projectUrl = (projectRef: string) => `https://${projectRef}.supabase.co`;

describe("explicit application environment isolation", () => {
  it("bounds staging Supabase requests without changing production or test behavior", () => {
    expect(supabaseRequestTimeoutFor("staging")).toBe(STAGING_SUPABASE_REQUEST_TIMEOUT_MS);
    expect(STAGING_SUPABASE_REQUEST_TIMEOUT_MS).toBe(20_000);
    expect(supabaseRequestTimeoutFor("production")).toBeNull();
    expect(supabaseRequestTimeoutFor("test")).toBeNull();
  });
  it.each([
    ["staging", STAGING_SUPABASE_PROJECT_REF],
    ["production", PRODUCTION_SUPABASE_PROJECT_REF],
  ] as const)("accepts %s mode only with its expected project", (mode, projectRef) => {
    expect(validateAppEnvironment({ APP_ENV: mode, NEXT_PUBLIC_SUPABASE_URL: projectUrl(projectRef),
      ...(mode === "production" ? { NEXT_PUBLIC_SITE_URL: "https://news.example.com" } : {}) }))
      .toMatchObject({ mode, expectedProjectRef: projectRef });
  });

  it.each([
    ["staging", PRODUCTION_SUPABASE_PROJECT_REF],
    ["production", STAGING_SUPABASE_PROJECT_REF],
  ] as const)("rejects %s mode with the wrong protected project", (mode, projectRef) => {
    expect(() => validateAppEnvironment({ APP_ENV: mode, NEXT_PUBLIC_SUPABASE_URL: projectUrl(projectRef),
      ...(mode === "production" ? { NEXT_PUBLIC_SITE_URL: "https://news.example.com" } : {}) }))
      .toThrow(/does not target/);
  });

  it("fails closed for missing identity and malformed URLs", () => {
    expect(() => validateAppEnvironment({ NEXT_PUBLIC_SUPABASE_URL: projectUrl(STAGING_SUPABASE_PROJECT_REF) }))
      .toThrow(/APP_ENV/);
    expect(() => validateAppEnvironment({ APP_ENV: "staging", NEXT_PUBLIC_SUPABASE_URL: "not-a-url" }))
      .toThrow(/valid URL/);
  });

  it("rejects a production secondary database URL in staging", () => {
    expect(() => validateAppEnvironment({ APP_ENV: "staging",
      NEXT_PUBLIC_SUPABASE_URL: projectUrl(STAGING_SUPABASE_PROJECT_REF),
      DATABASE_URL: `postgresql://postgres.${PRODUCTION_SUPABASE_PROJECT_REF}:fixture@pooler.supabase.com:5432/postgres`,
    })).toThrow(/DATABASE_URL/);
  });

  it("executes the guard before database, lease, or provider operations", () => {
    const calls = { database: 0, lease: 0, provider: 0 };
    expect(() => runAfterEnvironmentGuard(() => {
      calls.database += 1; calls.lease += 1; calls.provider += 1;
    }, { APP_ENV: "staging", NEXT_PUBLIC_SUPABASE_URL: projectUrl(PRODUCTION_SUPABASE_PROJECT_REF) })).toThrow();
    expect(calls).toEqual({ database: 0, lease: 0, provider: 0 });
  });

  it("negative staging command exits before its child process executes", () => {
    const directory = mkdtempSync(join(tmpdir(), "environment-isolation-"));
    temporaryDirectories.push(directory);
    const environmentFile = join(directory, ".env.staging.local");
    writeFileSync(environmentFile,
      `NEXT_PUBLIC_SUPABASE_URL=${projectUrl(PRODUCTION_SUPABASE_PROJECT_REF)}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=fixture\n`);
    const result = spawnSync(process.execPath, [resolve("scripts/run-with-app-env.mjs"), "staging", environmentFile,
      "--", process.execPath, "-e", "console.log('child-network-operation')"],
    { cwd: process.cwd(), encoding: "utf8", windowsHide: true, env: { ...process.env, APP_ENV_LOCK: "" } });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("child-network-operation");
  });

  it("prevents a nested production build from escaping a staging environment lock", () => {
    const result = spawnSync(process.execPath, [resolve("scripts/run-with-app-env.mjs"), "production", ".env.local",
      "--", process.execPath, "-e", "console.log('nested-production-child')"],
    { cwd: process.cwd(), encoding: "utf8", windowsHide: true, env: { ...process.env, APP_ENV_LOCK: "staging" } });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("nested-production-child");
    expect(result.stderr).toContain("locked to staging");
  });

  it("makes build modes deterministic and protects sitemap through the central client", () => {
    const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts.dev).toContain("run-with-app-env.mjs local .env.local");
    expect(packageJson.scripts.build).toContain("run-with-app-env.mjs local .env.local");
    expect(packageJson.scripts["build:production"]).toContain("run-with-app-env.mjs production .env.production.local");
    expect(packageJson.scripts["build:staging"]).toContain("run-with-app-env.mjs staging .env.staging.local");
    expect(packageJson.scripts["cf:build:staging"]).toContain("run-with-app-env.mjs staging .env.staging.local");
    expect(packageJson.scripts["cf:dry-run:staging"]).toContain("run-with-app-env.mjs staging .env.staging.local");
    expect(packageJson.scripts["staging:soak:safe"]).toContain("run-with-app-env.mjs staging .env.staging.local");
    expect(packageJson.scripts.preview).toContain("run-with-app-env.mjs production .env.production.local");
    expect(packageJson.scripts["cf:build"]).toContain("run-with-app-env.mjs production .env.production.local");
    expect(packageJson.scripts.deploy).toContain("run-with-app-env.mjs production .env.production.local");
    expect(readFileSync(resolve("open-next.config.ts"), "utf8")).toContain('isolation.mode === "staging" ? "npm run build:staging" : "npm run build:production"');
    expect(readFileSync(resolve("app/sitemap.ts"), "utf8")).toContain('from "@/lib/supabase"');
    expect(readFileSync(resolve("lib/supabase.ts"), "utf8")).toContain("assertWritesAllowed");
  });

  it("keeps the lease reliability command staging-guarded and provider-free", () => {
    const script = readFileSync(resolve("scripts/staging-soak.ts"), "utf8");
    const command = script.slice(script.indexOf("async function leaseReliabilityValidation"),
      script.indexOf("async function noProviderTelemetryValidation"));
    expect(command).toContain("providerRequests: artifact.providerAttempts.length");
    expect(command).not.toContain("GroqContentProvider");
    expect(command).not.toContain("replenishReadyQueue");
    expect(script).toContain('["replenish", "provider-failure", "telemetry-no-provider", "calibration-startup", "lease-reliability"');
  });

  it("test mode rejects protected projects but permits explicit local fixtures", () => {
    expect(() => validateAppEnvironment({ APP_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: projectUrl(PRODUCTION_SUPABASE_PROJECT_REF) })).toThrow(/protected/);
    expect(validateAppEnvironment({ APP_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" }))
      .toMatchObject({ mode: "test", expectedProjectRef: null });
  });
});
