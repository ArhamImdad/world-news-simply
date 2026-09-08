import { describe, expect, it } from "vitest";
import {
  ARTICLE_QUALITY_AUDIT_JSON_SCHEMA,
  parseArticleQualityReview,
  sanitizeArticleAuditTelemetry,
  type ArticleQualityReview,
} from "@/lib/article-audit";

function audit(rejectionReasons: string[] = []): ArticleQualityReview {
  return {
    factual_completeness: 94,
    originality: 93,
    usefulness: 92,
    meaningful_context: 91,
    headline_quality: 95,
    added_value: 90,
    claims_supported: true,
    mostly_paraphrase: false,
    speculative_or_invented: false,
    invented_quotes: false,
    invented_statistics: false,
    should_publish: rejectionReasons.length === 0,
    rejection_reasons: rejectionReasons,
  };
}

describe("canonical strict independent-audit contract", () => {
  it.each([0, 8, 10, 14])("accepts %i rejection reasons", (count) => {
    const reasons = Array.from({ length: count }, (_, index) => `criterion ${index + 1} failed`);
    expect(parseArticleQualityReview(audit(reasons)).rejection_reasons).toEqual(reasons);
  });

  it("has a closed root object, requires every property, and does not bound rejection-reason count", () => {
    expect(ARTICLE_QUALITY_AUDIT_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(ARTICLE_QUALITY_AUDIT_JSON_SCHEMA.required).toEqual(
      Object.keys(ARTICLE_QUALITY_AUDIT_JSON_SCHEMA.properties)
    );
    expect(ARTICLE_QUALITY_AUDIT_JSON_SCHEMA.properties.rejection_reasons).not.toHaveProperty("maxItems");
  });

  it.each([
    null,
    { ...audit(), originality: 90.5 },
    { ...audit(), factual_completeness: 101 },
    { ...audit(), claims_supported: "yes" },
    { ...audit(), rejection_reasons: ["valid", 2] },
  ])("rejects malformed audit object %#", (value) => {
    expect(() => parseArticleQualityReview(value)).toThrow();
  });

  it("rejects undeclared properties", () => {
    expect(() => parseArticleQualityReview({ ...audit(), explanation: "not declared" })).toThrow(
      "undeclared quality-review fields"
    );
  });

  it("rejects an omitted required field", () => {
    const missingOriginality = { ...audit() } as Partial<ArticleQualityReview>;
    delete missingOriginality.originality;
    expect(() => parseArticleQualityReview(missingOriginality)).toThrow();
  });

  it("sanitizes a telemetry copy without changing the complete audit", () => {
    const original = audit(Array.from({ length: 12 }, (_, index) => `  reason   ${index + 1}  `));
    const snapshot = structuredClone(original);
    const telemetry = sanitizeArticleAuditTelemetry(original, 5, 20);
    expect(original).toEqual(snapshot);
    expect(original.rejection_reasons).toHaveLength(12);
    expect(telemetry.rejection_reasons).toHaveLength(5);
    expect(telemetry.rejection_reason_count).toBe(12);
    expect(telemetry.rejection_reasons[0]).toBe("reason 1");
  });
});
