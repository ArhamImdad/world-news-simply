import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildGenerationPrompt, buildRevisionPrompt } from "@/lib/article-generation-prompts";
import { QUALITY_THRESHOLD, deterministicOriginalityPrecheck } from "@/lib/article-quality";
import { buildEvidenceBundle, evidenceBundleFailures, modelVisibleEvidencePayload, type EvidenceBoundInsight } from "@/lib/evidence-model";
import { AUTOMATIC_PUBLICATION_QUALITY_THRESHOLD } from "@/lib/publication-policy";
import type { ArticleQualityReview, RewrittenArticle, SourceMaterial } from "@/types/article";

function source(registryId: string, publisher: string, url: string, text: string, isPrimary: boolean): SourceMaterial {
  return {
    title: `${publisher} official methodology`, publisher, url, text, reliability: 98, isPrimary,
    publishedAt: "2026-08-20T12:00:00Z", licenseType: "public-domain-us", sourceType: "government-statistics",
    registryId, commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    permissionUrl: `${new URL(url).origin}/terms`,
  };
}

const alpha = source("alpha", "Agency Alpha", "https://alpha.gov/method", [
  "Agency Alpha measures monthly price change using a representative sample of household purchases across eight spending groups.",
  "The sample weights are updated from expenditure data so categories reflect their relative share of household spending.",
  "Published estimates compare the current index with both the previous month and the same month one year earlier.",
  "The agency excludes investment purchases because the measure is designed around household consumption expenses.",
].join("\n"), true);

const beta = source("beta", "Agency Beta", "https://beta.gov/quality", [
  "Agency Beta compiles its consumer measure from approximately 180000 monthly observations covering a reviewed basket of goods and services.",
  "Its quality report describes coverage, sampling, validation, and the limits readers should consider when comparing periods.",
  "The published framework distinguishes measures that include housing costs from measures with narrower population coverage.",
  "Annual reviews allow the basket and weights to reflect changes in consumer purchasing patterns over time.",
].join("\n"), false);

const strongBundle = () => buildEvidenceBundle("How official price measures differ", [alpha, beta], "strong");

function insightList(bundle: ReturnType<typeof strongBundle>): EvidenceBoundInsight[] {
  return [bundle.plan.evidenceShows, bundle.plan.sourceRelationship, bundle.plan.legitimateComparison,
    bundle.plan.combinedInsight, bundle.plan.practicalInterpretation, ...bundle.plan.limitations];
}

describe("evidence-bound synthesis planning", () => {
  it("plans by cross-source reader questions rather than source order", () => {
    const forward = strongBundle();
    const reversed = buildEvidenceBundle("How official price measures differ", [beta, alpha], "strong");
    const signatures = (bundle: typeof forward) => new Set(bundle.plan.comparisonOpportunities.map((comparison) => {
      const facts = [comparison.leftFactId, comparison.rightFactId].map((id) =>
        bundle.facts.find((fact) => fact.id === id)?.fact ?? "").sort();
      return facts.join(" || ");
    }));
    expect(signatures(forward)).toEqual(signatures(reversed));
    expect(forward.plan.sections.filter((section) => section.requiresCrossSourceSynthesis).length).toBeGreaterThanOrEqual(2);
  });

  it("requires explicit reader value, comparison, interpretation, and limitations", () => {
    const plan = strongBundle().plan;
    expect(plan.centralReaderQuestion).toMatch(/\?$/);
    expect(plan.combinedInsight.factIds.length).toBeGreaterThanOrEqual(2);
    expect(plan.practicalInterpretation.factIds.length).toBeGreaterThanOrEqual(2);
    expect(plan.limitations.length).toBeGreaterThan(0);
    expect(plan.synthesisValueScore).toBeGreaterThanOrEqual(70);
  });

  it("defers a fact-rich pair with no defensible synthesis relationship", () => {
    const unrelatedA = source("unrelated-a", "Weather Office", "https://weather.gov/report", [
      "The weather office measures rainfall totals from calibrated gauges across four coastal monitoring stations.",
      "Published rainfall estimates compare the current month with a thirty year observation baseline.",
      "The monitoring scope excludes stations that fail the documented calibration review.",
      "Monthly weather tables distinguish provisional observations from quality controlled rainfall records.",
    ].join("\n"), true);
    const unrelatedB = source("unrelated-b", "Justice Agency", "https://justice.gov/report", [
      "The justice agency records criminal filings after prosecutors submit documents to the federal court.",
      "Published enforcement summaries identify allegations that remain unproven until a final court judgment.",
      "Case statistics cover filed charges and do not represent convictions or sentencing outcomes.",
      "Annual compliance reports classify matters by statutory program and procedural stage.",
    ].join("\n"), false);
    const bundle = buildEvidenceBundle("Unrelated official reports", [unrelatedA, unrelatedB], "weak");
    expect(evidenceBundleFailures(bundle)).toContain("insufficient evidence-backed synthesis value");
  });

  it("keeps every planned interpretation traceable to existing evidence IDs", () => {
    const bundle = strongBundle();
    const ids = new Set(bundle.facts.map((fact) => fact.id));
    for (const insight of insightList(bundle)) {
      expect(insight.factIds.length).toBeGreaterThan(0);
      expect(insight.factIds.every((id) => ids.has(id))).toBe(true);
    }
    for (const comparison of bundle.plan.comparisonOpportunities) {
      const sourceIds = comparison.interpretation.factIds.map((id) => bundle.facts.find((fact) => fact.id === id)?.sourceId);
      expect(new Set(sourceIds).size).toBe(2);
    }
  });

  it("makes unsupported inference boundaries explicit in plan and prompt", () => {
    const bundle = strongBundle();
    expect(bundle.plan.prohibitedConclusions.join(" ")).toMatch(/causation/i);
    expect(bundle.plan.comparisonOpportunities.every((comparison) => /Do not treat/.test(comparison.limitation))).toBe(true);
    const prompt = buildGenerationPrompt(bundle);
    expect(prompt).toMatch(/Every factual or interpretive sentence/i);
    expect(prompt).toMatch(/causal speculation/i);
  });

  it("separates internal evidence traceability from the model-visible surface", () => {
    const bundle = strongBundle();
    const modelSurface = JSON.stringify(modelVisibleEvidencePayload(bundle));
    const generationPrompt = buildGenerationPrompt(bundle);
    expect(bundle.facts.every((fact) => /^S\d+F\d+$/.test(fact.id) && fact.sourceId.length > 0)).toBe(true);
    expect(modelSurface).not.toMatch(/S\d+F\d+|"sourceId"|"factIds"/);
    expect(generationPrompt).not.toMatch(/S\d+F\d+|"sourceId"|"factIds"/);
    expect(modelSurface).toContain("supportingEvidencePositions");
  });

  it("keeps source-headline similarity protection and supplies a synthesis fallback", () => {
    const bundle = strongBundle();
    expect(bundle.plan.headlineFallback).not.toBe(alpha.title);
    expect(bundle.plan.headlineFallback).not.toBe(beta.title);
    expect(deterministicOriginalityPrecheck({ title: alpha.title, content: "Original reader-focused prose." }, [alpha, beta]).reasons)
      .toContain("headline too similar to source");
    expect(deterministicOriginalityPrecheck({ title: bundle.plan.headlineFallback, content: "Original reader-focused prose." }, [alpha, beta]).reasons)
      .not.toContain("headline too similar to source");
  });

  it("turns paraphrase and low-value audit findings into a structural revision", () => {
    const review: ArticleQualityReview = {
      factual_completeness: 80, originality: 70, usefulness: 75, meaningful_context: 80, headline_quality: 70,
      added_value: 60, claims_supported: true, mostly_paraphrase: true, speculative_or_invented: false,
      invented_quotes: false, invented_statistics: false, should_publish: false,
      rejection_reasons: ["mostly_paraphrase", "originality below 90", "added_value below 90", "usefulness below 90"],
    };
    const article: RewrittenArticle = { title: "Draft", summary: "Draft", content: "Draft", read_time: 2, quality_review: review };
    const prompt = buildRevisionPrompt(article, { focus: "originality", reasons: review.rejection_reasons, review }, strongBundle());
    expect(prompt).toMatch(/structural synthesis repair/i);
    expect(prompt).toMatch(/Discard the current source-shaped paragraph order/i);
    expect(prompt).toMatch(/Do not synonym-rewrite/i);
    expect(prompt).not.toMatch(/S\d+F\d+|"sourceId"|"factIds"/);
    expect(prompt).toMatch(/never output internal fact IDs/i);
  });

  it("uses durable ignored calibration storage and preserves all 90-point gates", () => {
    expect(readFileSync(".gitignore", "utf8")).toMatch(/^\/\.calibration\/$/m);
    expect(QUALITY_THRESHOLD).toBe(90);
    expect(AUTOMATIC_PUBLICATION_QUALITY_THRESHOLD).toBe(90);
  });
});
