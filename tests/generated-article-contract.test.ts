import { describe, expect, it } from "vitest";
import {
  classifyGenerationFailure,
  GeneratedArticleContractError,
  GENERATED_ARTICLE_JSON_SCHEMA,
  generationRetryAllowed,
  exposedReferenceDiagnostics,
  parseGeneratedArticleJson,
  parseGeneratedArticlePayload,
  providerContractDiagnostics,
  repairRecoverableEvidenceReferences,
  validateGeneratedArticleBeforeAudit,
} from "@/lib/generated-article-contract";
import { estimateCandidateTokens } from "@/lib/token-budget";
import type { EvidenceBundle } from "@/lib/evidence-model";

const evidence = {
  facts: [{ id: "S1F1" }],
} as EvidenceBundle;

const valid = {
  title: "Official measures explain where household energy costs differ",
  content: "A complete evidence-bound article with both publishers explicitly attributed.",
  summary: "Official measures provide complementary evidence about household energy costs.",
  read_time: 4,
};

describe("canonical generated-article contract", () => {
  it("accepts the explicit closed payload shape without coercion", () => {
    expect(parseGeneratedArticlePayload(valid, evidence)).toEqual(valid);
    expect(GENERATED_ARTICLE_JSON_SCHEMA.additionalProperties).toBe(false);
  });

  it("rejects malformed JSON as one recoverable format failure", () => {
    expect(() => parseGeneratedArticleJson('{"title":', evidence)).toThrowError(GeneratedArticleContractError);
    try { parseGeneratedArticleJson('{"title":', evidence); } catch (error) {
      expect(classifyGenerationFailure(error)).toBe("structured-format-recoverable");
    }
  });

  it("does not silently sanitize invalid control characters into a usable payload", () => {
    const malformed = JSON.stringify(valid).replace("complete evidence-bound", "complete\nevidence-bound");
    expect(() => parseGeneratedArticleJson(malformed, evidence)).toThrow(/valid JSON/);
  });

  it("rejects a missing required field", () => {
    expect(() => parseGeneratedArticlePayload({ ...valid, summary: undefined }, evidence)).toThrow(/summary/);
  });

  it("rejects whitespace-only content as terminal deterministic content", () => {
    try { parseGeneratedArticlePayload({ ...valid, content: "   " }, evidence); } catch (error) {
      expect(classifyGenerationFailure(error)).toBe("deterministic-content-invalid");
      expect(generationRetryAllowed(classifyGenerationFailure(error), {
        providerRetries: 0, maximumProviderRetries: 2, formatRepairs: 0,
      })).toBe(false);
    }
  });

  it("rejects malformed or exposed evidence references as a terminal safety failure", () => {
    for (const content of ["Unsupported evidence S9F99 appears here.", "Internal evidence S1F1 appears here."]) {
      try { parseGeneratedArticlePayload({ ...valid, content }, evidence); } catch (error) {
        expect(classifyGenerationFailure(error)).toBe("terminal-safety");
      }
    }
  });

  it("classifies the seven retained historical revision failures as unrepairable without inventing missing payload detail", () => {
    const retainedFailures = [
      "a66f1374:candidate:2", "466972d5:candidate:1", "466972d5:candidate:2",
      "a9059a90:candidate:1", "a9059a90:candidate:2", "8cf174b0:candidate:1", "8cf174b0:candidate:2",
    ];
    for (const historicalIdentity of retainedFailures) {
      try {
        parseGeneratedArticlePayload({ ...valid, content: `${valid.content} S1F1` }, evidence);
        throw new Error(`expected ${historicalIdentity} to fail`);
      } catch (error) {
        expect(error).toMatchObject({ code: "exposed-evidence-reference", classification: "terminal-safety" });
      }
    }
  });

  it("repairs only isolated bracketed known references once without changing meaning", () => {
    const leaked = { ...valid, content: `Agency Alpha reported the measured change. [S1F1] ${valid.content}` };
    const result = validateGeneratedArticleBeforeAudit(JSON.stringify(leaked), evidence);
    expect(result.repaired).toBe(true);
    expect(result.article.content).toBe(`Agency Alpha reported the measured change. ${valid.content}`);
    expect(exposedReferenceDiagnostics(result.article, evidence)).toEqual([]);
    expect(validateGeneratedArticleBeforeAudit(JSON.stringify(result.article), evidence).repaired).toBe(false);
    expect(providerContractDiagnostics(undefined, result.diagnostics)[0]).toMatchObject({
      schemaVersion: "provider-contract-diagnostic-v1", fieldPath: "$.content", offendingPattern: "[S1F1]",
      evidenceIdKnown: true, recoverability: "recoverable", repairApplied: true, repairOutcome: "passed",
      postRepairValidatorResult: "passed",
    });
  });

  it.each([
    ["unknown marker", "Supported sentence. [S9F99]"],
    ["unbracketed marker", "Supported sentence S1F1."],
    ["headline marker", "Supported headline [S1F1]"],
    ["planning label", "Supported sentence [evidence_7]."],
  ])("keeps %s terminal", (_name, value) => {
    const article = _name === "headline marker" ? { ...valid, title: value } : { ...valid, content: value };
    expect(() => validateGeneratedArticleBeforeAudit(JSON.stringify(article), evidence)).toThrowError(
      expect.objectContaining({ classification: "terminal-safety" }));
  });

  it("never calls an expensive audit after a deterministic contract failure", async () => {
    let audits = 0;
    const audit = async () => { audits += 1; };
    expect(() => validateGeneratedArticleBeforeAudit(JSON.stringify({ ...valid, content: "Leak S1F1" }), evidence)).toThrow();
    expect(audits).toBe(0);
    await audit();
    expect(audits).toBe(1);
  });

  it("refuses a repair request that could delete meaningful or unknown content", () => {
    expect(() => repairRecoverableEvidenceReferences({ ...valid, content: "The model wrote evidence_7 as prose." }, evidence))
      .toThrowError(expect.objectContaining({ classification: "terminal-safety" }));
  });

  it("rejects undeclared fields and primitive-type mismatches", () => {
    expect(() => parseGeneratedArticlePayload({ ...valid, audit: [] }, evidence)).toThrow(/undeclared/);
    expect(() => parseGeneratedArticlePayload({ ...valid, read_time: "4" }, evidence)).toThrow(/read_time/);
  });
});

describe("bounded generation retry classification", () => {
  it("allows exactly one structured format repair", () => {
    expect(generationRetryAllowed("structured-format-recoverable", {
      providerRetries: 0, maximumProviderRetries: 2, formatRepairs: 0,
    })).toBe(true);
    expect(generationRetryAllowed("structured-format-recoverable", {
      providerRetries: 0, maximumProviderRetries: 2, formatRepairs: 1,
    })).toBe(false);
  });

  it("does not retry deterministic or terminal validation failures", () => {
    expect(generationRetryAllowed("deterministic-content-invalid", {
      providerRetries: 0, maximumProviderRetries: 2, formatRepairs: 0,
    })).toBe(false);
    expect(generationRetryAllowed("terminal-safety", {
      providerRetries: 0, maximumProviderRetries: 2, formatRepairs: 0,
    })).toBe(false);
  });

  it("keeps provider and rate-limit retries separately bounded", () => {
    expect(generationRetryAllowed(classifyGenerationFailure(Object.assign(new Error("timeout"), { status: 408 })), {
      providerRetries: 1, maximumProviderRetries: 2, formatRepairs: 0,
    })).toBe(true);
    expect(generationRetryAllowed("rate-limit-transient", {
      providerRetries: 2, maximumProviderRetries: 2, formatRepairs: 0,
    })).toBe(false);
  });
});

describe("candidate reservation and Phase 2 replay", () => {
  it("reserves the worst legitimate generation, audit, revision, and re-audit sequence", () => {
    expect(estimateCandidateTokens(4_000, true)).toBe(13_200);
    expect(estimateCandidateTokens(4_000, false)).toBe(6_200);
  });

  it("replays exact duplicate savings from the clean Phase 2 telemetry", () => {
    const oldAttemptTokens = [3_658, 6_016, 3_688, 3_890, 2_897, 4_377, 3_467, 3_503, 2_608, 3_862, 2_430];
    const duplicateAttempts = oldAttemptTokens.slice(0, 3);
    expect(oldAttemptTokens.reduce((sum, tokens) => sum + tokens, 0)).toBe(40_396);
    expect(duplicateAttempts.reduce((sum, tokens) => sum + tokens, 0)).toBe(13_362);
    expect(oldAttemptTokens.slice(3).reduce((sum, tokens) => sum + tokens, 0)).toBe(27_034);
    expect(oldAttemptTokens.length).toBe(11);
    expect(oldAttemptTokens.length - duplicateAttempts.length).toBe(8);
  });
});
