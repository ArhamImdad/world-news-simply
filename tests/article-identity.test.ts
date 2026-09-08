import { describe, expect, it } from "vitest";
import {
  CalibrationArtifactError,
  anyDuplicateIdentity,
  articleIdentitiesAreDuplicate,
  buildCanonicalArticleIdentity,
  canonicalIdentityFromStored,
  duplicateIdentityEvidence,
  identitiesFromCalibrationArtifact,
  normalizeCalibrationArtifact,
} from "@/lib/article-identity";

const topic = "How energy costs enter household price statistics and why electricity prices vary";
const pair = ["eia-today-in-energy", "bls-latest"];
const urls = ["https://eia.gov/energy/prices", "https://bls.gov/cpi/energy"];

function identity(overrides: Parameters<typeof buildCanonicalArticleIdentity>[0] = {}) {
  return buildCanonicalArticleIdentity({
    candidateHash: "0c454b24",
    topic,
    sourceRegistryIds: pair,
    sourceUrls: urls,
    category: "Economy",
    ...overrides,
  });
}

describe("canonical URL-independent duplicate identity", () => {
  it("detects the same article with complete URLs", () => {
    expect(articleIdentitiesAreDuplicate(identity(), identity())).toBe(true);
  });

  it("detects the same article when the primary URL is missing", () => {
    expect(articleIdentitiesAreDuplicate(identity(), identity({ sourceUrls: [urls[1]] }))).toBe(true);
  });

  it("detects the same retained article with both URLs missing", () => {
    const retained = identity({ candidateHash: undefined, sourceUrls: [] });
    expect(articleIdentitiesAreDuplicate(identity({ candidateHash: undefined }), retained)).toBe(true);
  });

  it("does not conflate the same source pair covering a materially different topic", () => {
    const different = identity({
      candidateHash: "deadcafe",
      topic: "How employment surveys classify temporary layoffs and labor force participation",
      sourceUrls: ["https://eia.gov/new-release", "https://bls.gov/jobs/new-release"],
    });
    expect(articleIdentitiesAreDuplicate(identity(), different)).toBe(false);
  });

  it("blocks different source pairs when existing material-similarity policy identifies the same event", () => {
    const otherPair = identity({
      candidateHash: "beefcafe",
      sourceRegistryIds: ["energy-agency-c", "statistics-agency-d"],
      sourceUrls: ["https://c.gov/event", "https://d.gov/event-support"],
    });
    expect(articleIdentitiesAreDuplicate(identity(), otherPair)).toBe(true);
  });

  it("blocks an in-batch READY identity before another provider call", () => {
    expect(anyDuplicateIdentity(identity({ candidateHash: undefined, sourceUrls: [] }), [identity()])).toBe(true);
  });

  it("restores a historical calibration READY identity without source URLs", () => {
    const [retained] = identitiesFromCalibrationArtifact({
      selection: {
        candidate: topic,
        sourcePair: pair.map((registryId) => ({ registryId })),
      },
      finalEvaluation: { readyQualified: true },
    });
    expect(retained.sourceUrls).toEqual([]);
    expect(articleIdentitiesAreDuplicate(identity({ candidateHash: undefined }), retained)).toBe(true);
  });

  it("blocks a recent database article through canonical fallback metadata", () => {
    const recent = canonicalIdentityFromStored(undefined, {
      topic,
      sourceRegistryIds: pair,
      sourceUrls: [urls[0]],
      category: "Economy",
    });
    expect(articleIdentitiesAreDuplicate(identity(), recent)).toBe(true);
  });

  it("does not throw when optional metadata is absent", () => {
    expect(() => canonicalIdentityFromStored(undefined)).not.toThrow();
    expect(articleIdentitiesAreDuplicate(buildCanonicalArticleIdentity({}), identity())).toBe(false);
  });

  it("marks malformed stored metadata and falls back safely", () => {
    const malformed = canonicalIdentityFromStored({ sourceRegistryIds: "not-an-array" }, { topic });
    expect(malformed.malformed).toBe(true);
    expect(() => articleIdentitiesAreDuplicate(malformed, identity())).not.toThrow();
  });

  it("normalizes current result.disposition artifacts into the canonical field", () => {
    const normalized = normalizeCalibrationArtifact({
      artifactVersion: 1,
      results: [{ disposition: "ready-qualified-no-insert", candidateHash: "0c454b24", candidate: topic,
        category: "Economy", sourcePair: pair.map((registryId) => ({ registryId })) }],
    });
    expect(normalized.safe).toBe(true);
    expect(normalized.results[0].disposition).toBe("ready-qualified-no-insert");
    expect(normalized.identities).toHaveLength(1);
  });

  it("normalizes historical finalDisposition artifacts into the canonical field", () => {
    const normalized = normalizeCalibrationArtifact({
      results: [{ finalDisposition: "ready-qualified-no-insert", candidateHash: "0c454b24", candidate: topic,
        category: "Economy", sourcePair: pair.map((registryId) => ({ registryId })) }],
    });
    expect(normalized.safe).toBe(true);
    expect(normalized.results[0].disposition).toBe("ready-qualified-no-insert");
    expect(normalized.identities).toHaveLength(1);
  });

  it("rejects invalid and conflicting dispositions conservatively", () => {
    const invalid = normalizeCalibrationArtifact({ results: [{ disposition: "ready-ish" }] });
    const conflicting = normalizeCalibrationArtifact({
      results: [{ disposition: "ready-qualified-no-insert", finalDisposition: "rejected:provider" }],
    });
    expect(invalid.safe).toBe(false);
    expect(invalid.diagnostics).toEqual([{ code: "invalid-disposition", resultIndex: 0 }]);
    expect(conflicting.safe).toBe(false);
    expect(() => identitiesFromCalibrationArtifact({ results: [{ disposition: "ready-ish" }] }))
      .toThrow(CalibrationArtifactError);
  });

  it("rejects unknown versions and malformed READY records with sanitized diagnostics", () => {
    const unknown = normalizeCalibrationArtifact({ artifactVersion: 99, results: [] });
    const malformed = normalizeCalibrationArtifact({
      results: [{ finalDisposition: "ready-qualified-no-insert", candidate: topic, sourcePair: "invalid" }],
    });
    expect(unknown.safe).toBe(false);
    expect(unknown.diagnostics[0].code).toBe("unsupported-artifact-version");
    expect(malformed.safe).toBe(false);
    expect(malformed.diagnostics[0].code).toBe("invalid-ready-result");
  });

  it("replays the historical GDP finalDisposition artifact as a pre-provider duplicate", () => {
    const gdpTopic = "How official agencies construct, revise, and interpret gross domestic product";
    const gdpPair = ["bea-news-releases", "ons-release-calendar"];
    const [retained] = identitiesFromCalibrationArtifact({
      results: [{ finalDisposition: "ready-qualified-no-insert", candidateHash: "70a5b2e9", candidate: gdpTopic,
        category: "Economy", sourcePair: gdpPair.map((registryId) => ({ registryId })) }],
    });
    const candidate = buildCanonicalArticleIdentity({ candidateHash: "70a5b2e9", topic: gdpTopic,
      sourceRegistryIds: gdpPair, sourceUrls: ["https://bea.gov/gdp", "https://ons.gov.uk/gdp"] });
    expect(anyDuplicateIdentity(candidate, [retained])).toBe(true);
  });

  it("replays a materially identical BEA and Census READY artifact", () => {
    const tradeTopic = "How United States trade statistics measure imports, exports, deficits, and investment";
    const tradePair = ["bea-news-releases", "census-economic-indicators"];
    const [retained] = identitiesFromCalibrationArtifact({
      results: [{ disposition: "ready-qualified-no-insert", candidateHash: "cfe3a8bb", candidate: tradeTopic,
        category: "Economy", sourcePair: tradePair.map((registryId) => ({ registryId })) }],
    });
    expect(articleIdentitiesAreDuplicate(retained, buildCanonicalArticleIdentity({
      candidateHash: "cfe3a8bb", topic: tradeTopic, sourceRegistryIds: tradePair,
    }))).toBe(true);
  });

  it("does not block one shared supporting URL without topic evidence", () => {
    const shared = "https://bea.gov/shared-release";
    const monetary = buildCanonicalArticleIdentity({
      candidateHash: "11111111", topic: "How monetary policy connects rates with employment and output",
      sources: [
        { url: "https://federalreserve.gov/policy", registryId: "federal-reserve", isPrimary: true },
        { url: shared, registryId: "bea", isPrimary: false },
      ],
    });
    const income = buildCanonicalArticleIdentity({
      candidateHash: "22222222", topic: "How household income accounts separate saving from spending",
      sources: [
        { url: "https://ons.gov.uk/income", registryId: "ons", isPrimary: true },
        { url: shared, registryId: "bea", isPrimary: false },
      ],
    });
    expect(duplicateIdentityEvidence(monetary, income)).toBeNull();
  });

  it("blocks the same primary URL only when combined with materially similar topic evidence", () => {
    const primary = "https://agency.gov/event";
    const first = buildCanonicalArticleIdentity({ candidateHash: "11111111", topic,
      sources: [{ url: primary, registryId: "agency", isPrimary: true },
        { url: "https://support-a.gov/a", registryId: "support-a", isPrimary: false }] });
    const sameTopic = buildCanonicalArticleIdentity({ candidateHash: "22222222", topic,
      sources: [{ url: primary, registryId: "agency", isPrimary: true },
        { url: "https://support-b.gov/b", registryId: "support-b", isPrimary: false }] });
    const differentTopic = buildCanonicalArticleIdentity({ candidateHash: "11111111",
      topic: "How employment surveys classify seasonal and temporary workers",
      sources: [{ url: primary, registryId: "agency", isPrimary: true },
        { url: "https://support-c.gov/c", registryId: "support-c", isPrimary: false }] });
    expect(articleIdentitiesAreDuplicate(first, sameTopic)).toBe(true);
    expect(articleIdentitiesAreDuplicate(first, differentTopic)).toBe(false);
  });

  it("blocks multiple shared URLs with the same event topic but allows the same pair for different material", () => {
    const first = identity({ candidateHash: "11111111", eventDate: "2026-08-01" });
    const sameEvent = identity({ candidateHash: "22222222", eventDate: "2026-08-20" });
    const differentMaterial = identity({ candidateHash: "33333333",
      topic: "How labor surveys classify workers and temporary layoffs", eventDate: "2026-08-20" });
    expect(articleIdentitiesAreDuplicate(first, sameEvent)).toBe(true);
    expect(articleIdentitiesAreDuplicate(first, differentMaterial)).toBe(false);
  });

  it("does not let primary/supporting role inversion bypass the same material", () => {
    const shared = "https://agency.gov/event";
    const primary = buildCanonicalArticleIdentity({ candidateHash: "11111111", topic,
      sources: [{ url: shared, registryId: "agency", isPrimary: true },
        { url: "https://other.gov/a", registryId: "other", isPrimary: false }] });
    const inverted = buildCanonicalArticleIdentity({ candidateHash: "22222222", topic,
      sources: [{ url: "https://third.gov/b", registryId: "third", isPrimary: true },
        { url: shared, registryId: "agency", isPrimary: false }] });
    expect(articleIdentitiesAreDuplicate(primary, inverted)).toBe(true);
  });

  it("handles missing role metadata without making one shared URL independently decisive", () => {
    const shared = "https://agency.gov/shared";
    const first = buildCanonicalArticleIdentity({ candidateHash: "11111111", topic,
      sourceRegistryIds: pair, sourceUrls: [shared] });
    const same = buildCanonicalArticleIdentity({ candidateHash: "22222222", topic,
      sourceRegistryIds: ["other-a", "other-b"], sourceUrls: [shared] });
    const different = buildCanonicalArticleIdentity({ candidateHash: "33333333",
      topic: "How workforce surveys distinguish employment from participation",
      sourceRegistryIds: ["other-a", "other-b"], sourceUrls: [shared] });
    expect(articleIdentitiesAreDuplicate(first, same)).toBe(true);
    expect(articleIdentitiesAreDuplicate(first, different)).toBe(false);
  });

  it("uses date windows to distinguish recurring materially similar events", () => {
    const august = identity({ candidateHash: "11111111", eventDate: "2026-08-20" });
    const september = identity({ candidateHash: "11111111", eventDate: "2026-09-20" });
    expect(articleIdentitiesAreDuplicate(august, september)).toBe(false);
  });
});
