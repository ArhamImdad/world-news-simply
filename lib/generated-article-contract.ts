import type { EvidenceBundle } from "@/lib/evidence-model";
import type { ProviderContractDiagnostic } from "@/lib/provider-runtime";

const GENERATED_FIELDS = ["title", "content", "summary", "read_time"] as const;

export const GENERATED_ARTICLE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 1, maxLength: 200 },
    content: { type: "string", minLength: 1, maxLength: 20_000 },
    summary: { type: "string", minLength: 1, maxLength: 1_000 },
    read_time: { type: "integer", minimum: 1, maximum: 15 },
  },
  required: GENERATED_FIELDS,
} as const;

export const GENERATED_ARTICLE_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "generated_article",
    strict: true,
    schema: GENERATED_ARTICLE_JSON_SCHEMA,
  },
} as const;

export type GenerationFailureClass =
  | "provider-network-transient"
  | "rate-limit-transient"
  | "structured-format-recoverable"
  | "deterministic-content-invalid"
  | "terminal-safety";

export class GeneratedArticleContractError extends Error {
  constructor(
    readonly classification: Extract<GenerationFailureClass,
      "structured-format-recoverable" | "deterministic-content-invalid" | "terminal-safety">,
    readonly code: string,
    message: string,
    readonly diagnostics: ExposedReferenceDiagnostic[] = [],
    readonly recoverableArticle: GeneratedArticlePayload | null = null,
  ) {
    super(message);
    this.name = "GeneratedArticleContractError";
  }
}

export type GeneratedArticlePayload = {
  title: string;
  content: string;
  summary: string;
  read_time: number;
};

export type ExposedReferenceDiagnostic = {
  field: "title" | "summary" | "content";
  token: string;
  reference: string;
  bracketed: boolean;
  knownEvidenceId: boolean;
  sanitizedContext: string;
};

const INTERNAL_REFERENCE_PATTERN = /\[(?:S\d+F\d+|E\d+|FACT[_-]\d+|evidence[_-]\d+|source[_-]\d+)\]|\bS\d+F\d+\b|\b(?:FACT[_-]\d+|evidence[_-]\d+|source[_-]\d+)\b/gi;

export function exposedReferenceDiagnostics(article: Pick<GeneratedArticlePayload, "title" | "summary" | "content">,
  evidence?: EvidenceBundle): ExposedReferenceDiagnostic[] {
  const known = new Set(evidence?.facts.map((fact) => fact.id.toUpperCase()) ?? []);
  return (["title", "summary", "content"] as const).flatMap((field) =>
    [...article[field].matchAll(INTERNAL_REFERENCE_PATTERN)].map((match) => {
      const token = match[0];
      const bracketed = token.startsWith("[") && token.endsWith("]");
      const reference = bracketed ? token.slice(1, -1) : token;
      const start = Math.max(0, (match.index ?? 0) - 48);
      const end = Math.min(article[field].length, (match.index ?? 0) + token.length + 48);
      const sanitizedContext = article[field].slice(start, end).replace(/\s+/g, " ").trim().slice(0, 120);
      return { field, token, reference, bracketed, knownEvidenceId: known.has(reference.toUpperCase()), sanitizedContext };
    }));
}

function fieldFromCode(code: string) {
  const match = code.match(/(?:invalid|missing|empty)-(.+?)(?:-type|-too-long)?$/);
  return match?.[1] ? `$.${match[1]}` : null;
}

export function providerContractDiagnostics(error: unknown, repairedDiagnostics: ExposedReferenceDiagnostic[] = []): ProviderContractDiagnostic[] {
  if (repairedDiagnostics.length > 0) return repairedDiagnostics.map((diagnostic) => ({
    schemaVersion: "provider-contract-diagnostic-v1", errorCode: "exposed-evidence-reference",
    fieldPath: `$.${diagnostic.field}`, offendingPattern: diagnostic.token,
    sanitizedContext: diagnostic.sanitizedContext, matchedInternalEvidenceIdentifier: diagnostic.reference,
    bracketed: diagnostic.bracketed, evidenceIdKnown: diagnostic.knownEvidenceId,
    location: diagnostic.field === "title" ? "headline" : diagnostic.field === "content" ? "body" : "metadata",
    recoverability: "recoverable", repairApplied: true, repairOutcome: "passed",
    postRepairValidatorResult: "passed",
  }));
  if (!(error instanceof GeneratedArticleContractError)) return [];
  if (error.diagnostics.length === 0) return [{
    schemaVersion: "provider-contract-diagnostic-v1", errorCode: error.code,
    fieldPath: fieldFromCode(error.code), offendingPattern: null, sanitizedContext: null,
    matchedInternalEvidenceIdentifier: null, bracketed: null, evidenceIdKnown: null, location: null,
    recoverability: error.classification === "structured-format-recoverable" ? "recoverable" : "terminal",
    repairApplied: false, repairOutcome: "not-attempted", postRepairValidatorResult: "not-run",
  }];
  return error.diagnostics.map((diagnostic) => ({
    schemaVersion: "provider-contract-diagnostic-v1", errorCode: error.code,
    fieldPath: `$.${diagnostic.field}`, offendingPattern: diagnostic.token,
    sanitizedContext: diagnostic.sanitizedContext, matchedInternalEvidenceIdentifier: diagnostic.reference,
    bracketed: diagnostic.bracketed, evidenceIdKnown: diagnostic.knownEvidenceId,
    location: diagnostic.field === "title" ? "headline" : diagnostic.field === "content" ? "body" : "metadata",
    recoverability: error.classification === "structured-format-recoverable" ? "recoverable" : "terminal",
    repairApplied: false, repairOutcome: "not-attempted", postRepairValidatorResult: "not-run",
  }));
}

export function exposedReferencesAreRecoverable(diagnostics: ExposedReferenceDiagnostic[]) {
  return diagnostics.length > 0 && diagnostics.every((diagnostic) =>
    diagnostic.field !== "title" && diagnostic.bracketed && diagnostic.knownEvidenceId && /^S\d+F\d+$/i.test(diagnostic.reference));
}

/** Removes only isolated, bracketed, known evidence markers. No prose, claims,
 * attribution, or unsupported material is changed. */
export function repairRecoverableEvidenceReferences(article: GeneratedArticlePayload, evidence: EvidenceBundle) {
  const diagnostics = exposedReferenceDiagnostics(article, evidence);
  if (!exposedReferencesAreRecoverable(diagnostics)) {
    throw new GeneratedArticleContractError("terminal-safety", "exposed-evidence-reference",
      "Generated article evidence references are not safely repairable.", diagnostics);
  }
  const repaired = { ...article };
  for (const field of ["summary", "content"] as const) {
    repaired[field] = repaired[field].replace(/\[S\d+F\d+\]/gi, "").replace(/[ \t]{2,}/g, " ");
  }
  const remaining = exposedReferenceDiagnostics(repaired, evidence);
  if (remaining.length > 0) {
    throw new GeneratedArticleContractError("terminal-safety", "exposed-evidence-reference",
      "Generated article still exposes evidence references after its one bounded repair.", remaining);
  }
  return { article: repaired, diagnostics };
}

function payloadObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GeneratedArticleContractError("structured-format-recoverable", "not-object",
      "Generated article payload must be an object.");
  }
  return value as Record<string, unknown>;
}

function requiredText(payload: Record<string, unknown>, field: "title" | "content" | "summary", maximum: number) {
  const value = payload[field];
  if (typeof value !== "string") {
    throw new GeneratedArticleContractError("structured-format-recoverable", `invalid-${field}-type`,
      `Generated article ${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new GeneratedArticleContractError("deterministic-content-invalid", `empty-${field}`,
      `Generated article ${field} must not be empty.`);
  }
  if (trimmed.length > maximum) {
    throw new GeneratedArticleContractError("deterministic-content-invalid", `${field}-too-long`,
      `Generated article ${field} exceeds the safe length bound.`);
  }
  return trimmed;
}

export function parseGeneratedArticlePayload(value: unknown, evidence?: EvidenceBundle) {
  const payload = payloadObject(value);
  const keys = Object.keys(payload);
  if (keys.length !== GENERATED_FIELDS.length || keys.some((key) =>
    !GENERATED_FIELDS.includes(key as typeof GENERATED_FIELDS[number]))) {
    throw new GeneratedArticleContractError("structured-format-recoverable", "undeclared-fields",
      "Generated article payload contains undeclared or missing fields.");
  }
  for (const field of GENERATED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) {
      throw new GeneratedArticleContractError("structured-format-recoverable", `missing-${field}`,
        `Generated article payload omitted ${field}.`);
    }
  }
  const title = requiredText(payload, "title", 200);
  const content = requiredText(payload, "content", 20_000);
  const summary = requiredText(payload, "summary", 1_000);
  if (!Number.isInteger(payload.read_time) || Number(payload.read_time) < 1 || Number(payload.read_time) > 15) {
    throw new GeneratedArticleContractError("structured-format-recoverable", "invalid-read-time",
      "Generated article read_time must be an integer from 1 through 15.");
  }
  const article = { title, content, summary, read_time: Number(payload.read_time) };
  const diagnostics = exposedReferenceDiagnostics(article, evidence);
  if (diagnostics.length) {
    const unknown = diagnostics.some((diagnostic) => !diagnostic.knownEvidenceId);
    const recoverable = !unknown && exposedReferencesAreRecoverable(diagnostics);
    throw new GeneratedArticleContractError(recoverable ? "structured-format-recoverable" : "terminal-safety",
      unknown ? "unknown-evidence-reference" : "exposed-evidence-reference",
      "Generated article exposed internal or unknown evidence references.", diagnostics,
      recoverable ? article : null);
  }
  return article;
}

export function parseGeneratedArticleJson(text: string, evidence?: EvidenceBundle) {
  const clean = text.replace(/```json|```/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new GeneratedArticleContractError("structured-format-recoverable", "malformed-json",
      "Generated article response was not valid JSON.");
  }
  return parseGeneratedArticlePayload(parsed, evidence);
}

export function validateGeneratedArticleBeforeAudit(text: string, evidence: EvidenceBundle) {
  try {
    return { article: parseGeneratedArticleJson(text, evidence), repaired: false, diagnostics: [] as ExposedReferenceDiagnostic[] };
  } catch (error) {
    if (!(error instanceof GeneratedArticleContractError) || error.code !== "exposed-evidence-reference" ||
        !error.recoverableArticle) throw error;
    const repaired = repairRecoverableEvidenceReferences(error.recoverableArticle, evidence);
    return { article: parseGeneratedArticlePayload(repaired.article, evidence), repaired: true, diagnostics: repaired.diagnostics };
  }
}

export function classifyGenerationFailure(error: unknown): GenerationFailureClass {
  if (error instanceof GeneratedArticleContractError) return error.classification;
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status) : 0;
  if (status === 429) return "rate-limit-transient";
  if (status === 0 || status === 408 || status === 409 || status >= 500) return "provider-network-transient";
  return "terminal-safety";
}

export function generationRetryAllowed(classification: GenerationFailureClass, state: {
  providerRetries: number;
  maximumProviderRetries: number;
  formatRepairs: number;
}) {
  if (classification === "structured-format-recoverable") return state.formatRepairs < 1;
  if (classification === "provider-network-transient" || classification === "rate-limit-transient") {
    return state.providerRetries < state.maximumProviderRetries;
  }
  return false;
}
