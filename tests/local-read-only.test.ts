import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LocalOperationRefusedError,
  PRODUCTION_SUPABASE_PROJECT_REF,
  assertWritesAllowed,
  validateAppEnvironment,
} from "@/lib/environment-isolation";
import { resolvePublicSiteUrl } from "@/lib/env";
import { readAdsenseRuntimeConfig } from "@/lib/adsense";
import { enqueueReadyArticle, publishNextReadyArticle } from "@/lib/publication-queue";
import { ReplenishmentRunLease } from "@/lib/replenishment-lease";
import { createGroqRuntime } from "@/lib/groq";
import { getUnsplashImage } from "@/lib/unsplash";

const productionUrl = `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;

function useLocalEnvironment() {
  vi.stubEnv("APP_ENV", "local");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", productionUrl);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-fixture-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("CRON_SECRET", "");
  vi.stubEnv("GROQ_API_KEY", "");
  vi.stubEnv("UNSPLASH_ACCESS_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_ADSENSE_ENABLED", "false");
}

beforeEach(useLocalEnvironment);
afterEach(() => vi.unstubAllEnvs());

describe("local production-public read mode", () => {
  it("accepts localhost while requiring the production Supabase project", () => {
    expect(validateAppEnvironment(process.env)).toMatchObject({
      mode: "local",
      expectedProjectRef: PRODUCTION_SUPABASE_PROJECT_REF,
    });
    expect(resolvePublicSiteUrl("http://localhost:3000", "local")).toBe("http://localhost:3000");
    expect(() => validateAppEnvironment({ ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "https://xfmbyxjevjliiwndcrpr.supabase.co" })).toThrow(/required by APP_ENV=local/);
  });

  it("uses the anonymous public article path locally and keeps approved-only RLS", () => {
    const page = readFileSync(resolve("app/article/[id]/page.tsx"), "utf8");
    const migration = readFileSync(resolve("supabase/migrations/20260812010000_add_editorial_review_and_source_attribution.sql"), "utf8");
    const columnGrant = readFileSync(resolve("supabase/migrations/20260812020000_add_editorial_review_fields.sql"), "utf8");
    expect(page).toContain("local ? supabase : createServerSupabaseClient()");
    expect(page).toContain("local ? ARTICLE_SELECT : ADSENSE_ARTICLE_SELECT");
    expect(migration).toMatch(/CREATE POLICY articles_public_read[\s\S]*FOR SELECT[\s\S]*USING \(publication_status = 'approved'\)/);
    expect(columnGrant).toMatch(/REVOKE ALL PRIVILEGES[\s\S]*GRANT SELECT \(/);
    expect(columnGrant).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE)/);
  });
});

describe("canonical local write refusal", () => {
  it("rejects privileged secrets at startup and service-role client creation", async () => {
    expect(() => validateAppEnvironment({ ...process.env, SUPABASE_SERVICE_ROLE_KEY: "present" }))
      .toThrow(/forbids privileged environment variable SUPABASE_SERVICE_ROLE_KEY/);
    const { createServerSupabaseClient } = await import("@/lib/supabase");
    expect(() => createServerSupabaseClient()).toThrow(LocalOperationRefusedError);
  });

  it("rejects enqueue and publication before an injected database client is called", async () => {
    const rpc = vi.fn();
    await expect(enqueueReadyArticle({} as never, 30, 18,
      { systemKey: "system", runId: "00000000-0000-4000-8000-000000000001" }, { rpc } as never))
      .rejects.toThrow(/read-only/);
    await expect(publishNextReadyArticle(new Date(), { rpc } as never)).rejects.toThrow(/read-only/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects lease acquisition before the store is called", async () => {
    const store = {
      acquire: vi.fn(async () => true), renew: vi.fn(async () => true),
      owns: vi.fn(async () => true), release: vi.fn(async () => true),
    };
    const lease = new ReplenishmentRunLease(store, { heartbeatMs: 1_000, ttlMs: 2_000 });
    await expect(lease.acquire()).rejects.toThrow(/read-only/);
    expect(store.acquire).not.toHaveBeenCalled();
  });

  it("rejects replenishment and cron through their public entry points", async () => {
    const [{ replenishReadyQueue }, cronRoute] = await Promise.all([
      import("@/lib/news-update"), import("@/app/api/cron/route"),
    ]);
    await expect(replenishReadyQueue()).rejects.toThrow(/read-only/);
    const response = await cronRoute.GET(new Request("http://localhost:3000/api/cron"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false });
  });

  it("does not call Groq or Unsplash", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(() => createGroqRuntime()).toThrow(/read-only/);
    await expect(getUnsplashImage("world", "provider-key")).rejects.toThrow(/read-only/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("forces AdSense off even when live-looking flags and IDs are supplied", () => {
    expect(readAdsenseRuntimeConfig({
      APP_ENV: "local",
      NEXT_PUBLIC_ADSENSE_ENABLED: "true",
      NEXT_PUBLIC_ADSENSE_CONSENT_READY: "true",
      NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT: `ca-pub-${"1".repeat(16)}`,
      NEXT_PUBLIC_GOOGLE_ADSENSE_ARTICLE_SLOT: "2".repeat(10),
    })).toEqual({ enabled: false, consentReady: false, clientId: null, articleSlot: null });
  });
});

describe("non-local isolation remains intact", () => {
  it("keeps production canonical and project protections", () => {
    expect(() => resolvePublicSiteUrl("http://localhost:3000", "production")).toThrow(/custom HTTPS/);
    expect(() => resolvePublicSiteUrl("https://preview.workers.dev", "production")).toThrow(/custom HTTPS/);
    expect(() => resolvePublicSiteUrl("https://world-news-simply.vercel.app", "production")).toThrow(/custom HTTPS/);
    expect(() => validateAppEnvironment({ APP_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://xfmbyxjevjliiwndcrpr.supabase.co" })).toThrow(/required/);
    expect(() => assertWritesAllowed("publication", { APP_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: productionUrl, NEXT_PUBLIC_SITE_URL: "https://news.example.com",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-fixture-key" })).not.toThrow();
  });

  it("keeps test isolated and retained staging diagnostics bound to staging", () => {
    expect(() => validateAppEnvironment({ APP_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: productionUrl }))
      .toThrow(/protected/);
    expect(validateAppEnvironment({ APP_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" }).mode)
      .toBe("test");
    expect(() => validateAppEnvironment({ APP_ENV: "staging", NEXT_PUBLIC_SUPABASE_URL: productionUrl }))
      .toThrow(/required by APP_ENV=staging/);
  });
});
