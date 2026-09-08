export type ArticleQualityReview = {
  factual_completeness: number;
  originality: number;
  usefulness: number;
  meaningful_context: number;
  headline_quality: number;
  added_value: number;
  claims_supported: boolean;
  mostly_paraphrase: boolean;
  speculative_or_invented: boolean;
  invented_quotes: boolean;
  invented_statistics: boolean;
  should_publish: boolean;
  rejection_reasons: string[];
};

const SCORE_FIELDS = [
  "factual_completeness",
  "originality",
  "usefulness",
  "meaningful_context",
  "headline_quality",
  "added_value",
] as const satisfies readonly (keyof ArticleQualityReview)[];

const BOOLEAN_FIELDS = [
  "claims_supported",
  "mostly_paraphrase",
  "speculative_or_invented",
  "invented_quotes",
  "invented_statistics",
  "should_publish",
] as const satisfies readonly (keyof ArticleQualityReview)[];

const AUDIT_FIELDS = [...SCORE_FIELDS, ...BOOLEAN_FIELDS, "rejection_reasons"] as const;

export const ARTICLE_QUALITY_AUDIT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    factual_completeness: { type: "integer", minimum: 0, maximum: 100 },
    originality: { type: "integer", minimum: 0, maximum: 100 },
    usefulness: { type: "integer", minimum: 0, maximum: 100 },
    meaningful_context: { type: "integer", minimum: 0, maximum: 100 },
    headline_quality: { type: "integer", minimum: 0, maximum: 100 },
    added_value: { type: "integer", minimum: 0, maximum: 100 },
    claims_supported: { type: "boolean" },
    mostly_paraphrase: { type: "boolean" },
    speculative_or_invented: { type: "boolean" },
    invented_quotes: { type: "boolean" },
    invented_statistics: { type: "boolean" },
    should_publish: { type: "boolean" },
    rejection_reasons: { type: "array", items: { type: "string" } },
  },
  required: AUDIT_FIELDS,
} as const;

export const ARTICLE_QUALITY_AUDIT_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "article_quality_audit",
    strict: true,
    schema: ARTICLE_QUALITY_AUDIT_JSON_SCHEMA,
  },
} as const;

function auditObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Groq response omitted the quality review.");
  }
  return value as Record<string, unknown>;
}

export function parseArticleQualityReview(value: unknown): ArticleQualityReview {
  const review = auditObject(value);
  const keys = Object.keys(review);
  if (keys.length !== AUDIT_FIELDS.length || keys.some((key) => !AUDIT_FIELDS.includes(key as typeof AUDIT_FIELDS[number]))) {
    throw new Error("Groq returned undeclared quality-review fields.");
  }
  for (const field of AUDIT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(review, field)) {
      throw new Error(`Groq response omitted ${field}.`);
    }
  }
  for (const field of SCORE_FIELDS) {
    const score = review[field];
    if (!Number.isInteger(score) || Number(score) < 0 || Number(score) > 100) {
      throw new Error(`Groq returned an invalid ${field} score.`);
    }
  }
  for (const field of BOOLEAN_FIELDS) {
    if (typeof review[field] !== "boolean") {
      throw new Error(`Groq returned an invalid ${field} flag.`);
    }
  }
  if (!Array.isArray(review.rejection_reasons) || review.rejection_reasons.some((reason) => typeof reason !== "string")) {
    throw new Error("Groq returned invalid rejection reasons.");
  }
  return review as ArticleQualityReview;
}

export type SanitizedArticleAuditTelemetry = Omit<ArticleQualityReview, "rejection_reasons"> & {
  rejection_reasons: string[];
  rejection_reason_count: number;
};

export function sanitizeArticleAuditTelemetry(
  review: ArticleQualityReview,
  reasonLimit = 5,
  reasonCharacterLimit = 160
): SanitizedArticleAuditTelemetry {
  return {
    ...review,
    rejection_reasons: review.rejection_reasons.slice(0, Math.max(0, reasonLimit)).map((reason) =>
      reason.replace(/\s+/g, " ").trim().slice(0, Math.max(0, reasonCharacterLimit))
    ),
    rejection_reason_count: review.rejection_reasons.length,
  };
}
