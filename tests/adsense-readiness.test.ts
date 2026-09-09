import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adsTxtRecord,
  canRenderAdsense,
  isAdsenseEligible,
  isAdsenseRouteEligible,
  readAdsenseRuntimeConfig,
  type AdsenseRuntimeConfig,
} from "@/lib/adsense";
import { resolvePublicSiteUrl } from "@/lib/env";
import type { Article } from "@/types/article";

const realShapeClientId = () => `ca-pub-${"1".repeat(16)}`;
const realShapeSlotId = () => "2".repeat(10);

function article(overrides: Partial<Article> = {}): Article {
  const paragraph = Array.from({ length: 95 }, (_, index) => `supported-word-${index}`).join(" ");
  const source = (host: string, primary: boolean) => ({
    title: `Official evidence from ${host}`,
    url: `https://${host}/release`,
    publisher: host,
    publishedAt: "2026-08-30T00:00:00.000Z",
    licenseType: "public-domain",
    sourceType: "government-record",
    isPrimary: primary,
    registryId: host,
    recognized: true,
    commercialUseAllowed: true,
    aiProcessingAllowed: true,
    transformationAllowed: true,
    permissionUrl: `https://${host}/policy`,
  });

  return {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "automatically-qualified-article",
    title: "Automatically qualified independent synthesis of two official economic releases",
    summary: "This substantive briefing compares independently published official evidence and explains the meaningful context for readers without copying either source.",
    content: `${paragraph}\n${paragraph}\n${paragraph}`,
    image_url: "/globe.svg",
    source_url: "https://one.example/release",
    category: "Economy",
    created_at: "2026-08-30T00:00:00.000Z",
    publication_status: "approved",
    editorial_state: "published",
    quality_score: 94,
    approved_at: "2026-08-30T00:00:00.000Z",
    expires_at: "2027-08-30T00:00:00.000Z",
    sources: [source("one.example", true), source("two.example", false)],
    validation_results: {
      factualCompletenessScore: 94,
      originalityScore: 94,
      usefulnessScore: 94,
      meaningfulContextScore: 94,
      headlineQualityScore: 94,
      addedValueScore: 94,
      automatedEditorialPassed: true,
      mostlyParaphrase: false,
      speculativeOrInvented: false,
      factualSupportPassed: true,
      originalityPassed: true,
      duplicateDetectionPassed: true,
      sourceOverlapPassed: true,
      unsupportedClaims: false,
      inventedQuotes: false,
      inventedStatistics: false,
      completeAttribution: true,
      hardWarnings: [],
    },
    generation_metadata: {
      pipelineVersion: "autonomous-queue-v1",
      provider: "configured-provider",
      model: "configured-model",
      modernPipeline: true,
      preparedAutomatically: true,
    },
    ...overrides,
  };
}

const enabledConfig = (): AdsenseRuntimeConfig => ({
  enabled: true,
  consentReady: true,
  clientId: realShapeClientId(),
  articleSlot: realShapeSlotId(),
});

describe("AdSense article eligibility", () => {
  const now = new Date("2026-08-31T00:00:00.000Z");

  it("does not require manual review metadata for automated AdSense eligibility", () => {
    expect(canRenderAdsense({ article: article(), pathname: "/article/automatically-qualified-article",
      config: enabledConfig(), now })).toBe(true);
  });

  it("keeps an approved article ad-free while AdSense is disabled", () => {
    expect(canRenderAdsense({ article: article(), pathname: "/article/automatically-qualified-article",
      config: { ...enabledConfig(), enabled: false }, now })).toBe(false);
  });

  it("keeps an approved article ad-free without a valid publisher ID", () => {
    expect(canRenderAdsense({ article: article(), pathname: "/article/automatically-qualified-article",
      config: { ...enabledConfig(), clientId: null }, now })).toBe(false);
  });

  it("allows only a fully eligible approved article with valid enabled configuration", () => {
    expect(canRenderAdsense({ article: article(), pathname: "/article/automatically-qualified-article",
      config: enabledConfig(), now })).toBe(true);
  });

  it.each([
    ["draft", { publication_status: "draft" as const }],
    ["expired", { expires_at: "2026-08-30T00:00:00.000Z" }],
    ["rejected", { publication_status: "rejected" as const, editorial_state: "rejected" as const }],
  ])("keeps a %s article ad-free", (_label, overrides) => {
    expect(isAdsenseEligible(article(overrides), now)).toBe(false);
  });

  it("fails closed for thin content and incomplete source independence", () => {
    expect(isAdsenseEligible(article({ content: "Thin article." }), now)).toBe(false);
    expect(isAdsenseEligible(article({ sources: [article().sources![0]] }), now)).toBe(false);
  });

  it("fails closed when an automated editorial score or safety gate fails", () => {
    expect(isAdsenseEligible(article({ validation_results: {
      ...article().validation_results!, usefulnessScore: 89,
    } }), now)).toBe(false);
    expect(isAdsenseEligible(article({ validation_results: {
      ...article().validation_results!, unsupportedClaims: true,
    } }), now)).toBe(false);
  });

  it("keeps error, policy, loading, API, and navigation routes ineligible", () => {
    for (const route of ["/404", "/privacy", "/terms", "/api/cron", "/", "/loading"]) {
      expect(isAdsenseRouteEligible(route)).toBe(false);
    }
    expect(isAdsenseRouteEligible("/article/automatically-qualified-article")).toBe(true);
  });

  it("requires the explicit consent-readiness boundary", () => {
    expect(canRenderAdsense({ article: article(), pathname: "/article/automatically-qualified-article",
      config: { ...enabledConfig(), consentReady: false }, now })).toBe(false);
  });
});

describe("AdSense configuration and inventory declarations", () => {
  it("defaults disabled and rejects malformed publisher configuration", () => {
    expect(readAdsenseRuntimeConfig({})).toEqual({
      enabled: false, consentReady: false, clientId: null, articleSlot: null,
    });
    expect(readAdsenseRuntimeConfig({
      NEXT_PUBLIC_ADSENSE_ENABLED: "true",
      NEXT_PUBLIC_ADSENSE_CONSENT_READY: "true",
      NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT: "not-a-publisher",
      NEXT_PUBLIC_GOOGLE_ADSENSE_ARTICLE_SLOT: "not-a-slot",
    })).toMatchObject({ enabled: true, consentReady: true, clientId: null, articleSlot: null });
  });

  it("never emits ads.txt data without a real-shape publisher identifier", () => {
    expect(adsTxtRecord(undefined)).toBeNull();
    expect(adsTxtRecord("not-a-publisher")).toBeNull();
    expect(adsTxtRecord(realShapeClientId())).toBe(
      `google.com, pub-${"1".repeat(16)}, DIRECT, f08c47fec0942fa0`
    );
  });

  it("rejects staging and worker origins as production canonicals", () => {
    expect(() => resolvePublicSiteUrl("https://staging-project.workers.dev", "production")).toThrow();
    expect(resolvePublicSiteUrl("https://news.example.com", "production")).toBe("https://news.example.com");
  });
});

describe("automated monetization migration security", () => {
  const migration = readFileSync(resolve(process.cwd(),
    "supabase/migrations/20260909020000_replace_manual_adsense_gate.sql"), "utf8");

  it("retires the manual review RPC without deleting article data", () => {
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.review_article_for_adsense(uuid, text, text)");
    expect(migration).not.toMatch(/DROP COLUMN/i);
    expect(migration).not.toMatch(/DELETE FROM public\.articles/i);
  });

  it("keeps legacy review columns private", () => {
    expect(migration).toMatch(/REVOKE UPDATE \(adsense_review_status, adsense_reviewed_at, adsense_reviewed_by\)[\s\S]*FROM PUBLIC, anon, authenticated/);
  });
});
