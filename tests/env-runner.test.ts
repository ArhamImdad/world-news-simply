import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATABASE_ENVIRONMENT_VARIABLES, LOCAL_PRIVILEGED_ENVIRONMENT_VARIABLES,
  PRODUCTION_SUPABASE_PROJECT_REF, STAGING_SUPABASE_PROJECT_REF } from "@/lib/environment-isolation";

const runner = resolve("scripts/run-with-app-env.mjs");
const production = {
  APP_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://news.example.com",
  NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-fixture-key",
  NEXT_PUBLIC_ADSENSE_ENABLED: "false",
  NEXT_PUBLIC_ADSENSE_CONSENT_READY: "false",
};
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "env-runner-")); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

function run(environment: Record<string, string | undefined> = production,
  code = "console.log('child-started')", mode = "production", file = ".env.production.local") {
  const inherited = { ...process.env };
  for (const key of [...DATABASE_ENVIRONMENT_VARIABLES, ...LOCAL_PRIVILEGED_ENVIRONMENT_VARIABLES,
    "APP_ENV_LOCK", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT",
    "NEXT_PUBLIC_GOOGLE_ADSENSE_ARTICLE_SLOT"]) delete inherited[key];
  return spawnSync(process.execPath, [runner, mode, file, "--", process.execPath, "-e", code], {
    cwd: directory, env: { ...inherited, ...environment }, encoding: "utf8", windowsHide: true,
  });
}

describe("environment runner CI fallback", () => {
  it("preserves CI values and secrets across nested production runners without a file", () => {
    const result = run({ ...production, APP_ENV: "staging", GROQ_API_KEY: "fixture-groq",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-service", UNSPLASH_ACCESS_KEY: "fixture-image",
      CRON_SECRET: "fixture-cron" }, `
      const assert = require('node:assert/strict');
      assert.equal(process.env.APP_ENV, 'production');
      assert.equal(process.env.APP_ENV_LOCK, 'production');
      assert.equal(process.env.GROQ_API_KEY, 'fixture-groq');
      assert.equal(process.env.SUPABASE_SERVICE_ROLE_KEY, 'fixture-service');
      assert.equal(process.env.UNSPLASH_ACCESS_KEY, 'fixture-image');
      assert.equal(process.env.CRON_SECRET, 'fixture-cron');
      assert.equal(process.env.NEXT_PUBLIC_ADSENSE_ENABLED, 'false');
      assert.equal(process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT, undefined);
      const child = require('node:child_process').spawnSync(process.execPath,
        [${JSON.stringify(runner)}, 'production', '.env.production.local', '--', process.execPath,
          '-e', "console.log('nested-started')"], { encoding: 'utf8', windowsHide: true });
      assert.equal(child.status, 0);
      assert.equal(child.stdout.trim(), 'nested-started');
      console.log('child-started');
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("child-started");
    expect(result.stderr).not.toContain("fixture-");
  });

  it.each(["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"])(
    "refuses missing or blank %s before starting the child", (key) => {
      for (const value of [undefined, "   "]) {
        const result = run({ ...production, [key]: value });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(key);
        expect(result.stdout).not.toContain("child-started");
      }
    });

  it.each(["http://localhost:3000", "https://preview.workers.dev", "https://preview.vercel.app",
    "https://project.supabase.co"])("still refuses invalid production canonical %s", (url) => {
    const result = run({ ...production, NEXT_PUBLIC_SITE_URL: url });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("child-started");
  });

  it("rejects a mismatched inherited database and a conflicting nested environment lock", () => {
    for (const extra of [{ DATABASE_URL: `https://${STAGING_SUPABASE_PROJECT_REF}.supabase.co` },
      { APP_ENV_LOCK: "staging" }]) {
      const result = run({ ...production, ...extra });
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain("child-started");
    }
  });

  it("preserves CI variables while blocking unrelated local dotenv fallback values", () => {
    writeFileSync(join(directory, ".env.local"), "NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321\nGROQ_API_KEY=fixture-local\n");
    const result = run(production, `
      const assert = require('node:assert/strict');
      assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, ${JSON.stringify(production.NEXT_PUBLIC_SUPABASE_URL)});
      assert.equal(process.env.GROQ_API_KEY, '');
    `);
    expect(result.status, result.stderr).toBe(0);
  });

  it("keeps explicit production files authoritative and isolates inherited database URLs", () => {
    writeFileSync(join(directory, ".env.production.local"), Object.entries(production)
      .map(([key, value]) => `${key}=${value}`).join("\n"));
    const result = run({ DATABASE_URL: `https://${STAGING_SUPABASE_PROJECT_REF}.supabase.co`,
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("child-started");
  });

  it.each(["local", "staging"])("preserves %s file loading", (mode) => {
    const file = mode === "local" ? ".env.local" : ".env.staging.local";
    const ref = mode === "local" ? PRODUCTION_SUPABASE_PROJECT_REF : STAGING_SUPABASE_PROJECT_REF;
    writeFileSync(join(directory, file), `NEXT_PUBLIC_SUPABASE_URL=https://${ref}.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=public-fixture-key\n`);
    const result = run({}, "console.log('child-started')", mode, file);
    expect(result.status, result.stderr).toBe(0);
  });

  it("does not bypass local secret protections when using process.env", () => {
    const result = run({ ...production, GROQ_API_KEY: "fixture-forbidden" }, undefined, "local", ".env.local");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("forbids privileged environment variable GROQ_API_KEY");
    expect(result.stdout).not.toContain("child-started");
  });

  it("retains the test runner's explicit no-file database isolation", () => {
    const result = run(production, "console.log('child-started')", "test", "-");
    expect(result.status, result.stderr).toBe(0);
  });
});
