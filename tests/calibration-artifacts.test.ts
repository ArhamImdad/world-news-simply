import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyCalibrationArtifact,
  discoverCalibrationIdentityHistory,
} from "@/lib/calibration-artifacts";
import { CalibrationArtifactError } from "@/lib/article-identity";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function directory() {
  const path = mkdtempSync(join(tmpdir(), "calibration-routing-"));
  directories.push(path);
  return path;
}

function writeJson(root: string, relativePath: string, value: unknown) {
  const path = join(root, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value), "utf8");
}

function identityArtifact(overrides: Record<string, unknown> = {}) {
  return {
    artifactVersion: 1,
    results: [{ disposition: "ready-qualified-no-insert", candidateHash: "0c454b24",
      candidate: "How official agencies compare energy prices with household inflation",
      sourcePair: [{ registryId: "eia" }, { registryId: "bls" }] }],
    ...overrides,
  };
}

describe("calibration artifact routing", () => {
  it("reproduces the exact retained aggregate regression without parsing the aggregate", () => {
    const root = directory();
    writeJson(root, "historical.json", identityArtifact());
    writeJson(root, "authoritative-eight-article-reserve-20260826.json", {
      schemaVersion: "authoritative-eight-article-reserve-v1", reserve: { candidateHash: "diagnostic-only" },
    });
    const result = discoverCalibrationIdentityHistory(root);
    expect(result.identities).toHaveLength(1);
    expect(result.metrics).toMatchObject({ calibrationJsonFilesDiscovered: 2, identityReplayArtifactsAccepted: 1,
      knownNonIdentityArtifactsSkipped: 1, historicalIdentitiesLoaded: 1 });
  });

  it.each([
    ["replenishment-run-telemetry-v1", "replenishment-runs/v1.json"],
    ["replenishment-run-telemetry-v2", "replenishment-runs/v2.json"],
    ["staging-reserve-inspection-v1", "staging-control/inspection.json"],
    ["staging-reserve-cleanup-v1", "staging-control/cleanup.json"],
    ["source-expansion-v1", "source-expansion/round.json"],
  ])("classifies %s as non-identity", (schemaVersion, relativePath) => {
    const artifact = { schemaVersion, results: identityArtifact().results, candidateHash: "diagnostic-only" };
    expect(classifyCalibrationArtifact(artifact, { relativePath })).toBe("non-identity-artifact");
  });

  it("loads exactly the identity source from a mixed artifact directory", () => {
    const root = directory();
    writeJson(root, "historical.json", identityArtifact());
    writeJson(root, "reserve.json", { schemaVersion: "authoritative-eight-article-reserve-v1", results: identityArtifact().results });
    writeJson(root, "staging-control/inspection.json", { schemaVersion: "staging-reserve-inspection-v1" });
    writeJson(root, "staging-control/cleanup.json", { schemaVersion: "staging-reserve-cleanup-v1" });
    writeJson(root, "replenishment-runs/run.json", { schemaVersion: "replenishment-run-telemetry-v2", candidates: [] });
    writeJson(root, "source-expansion/round.json", { schemaVersion: "source-expansion-replay-v1", results: identityArtifact().results });
    const result = discoverCalibrationIdentityHistory(root);
    expect(result.identities).toHaveLength(1);
    expect(result.metrics).toMatchObject({ calibrationJsonFilesDiscovered: 6, identityReplayArtifactsAccepted: 1,
      knownNonIdentityArtifactsSkipped: 5, unknownArtifactsSkipped: 0, historicalIdentitiesLoaded: 1 });
  });

  it("skips unknown general artifacts without seeding candidate-like fields", () => {
    const root = directory();
    writeJson(root, "unknown.json", { schemaVersion: "future-diagnostic-v9", candidateHash: "0c454b24",
      title: "Candidate-like diagnostic", sourceUrls: ["https://example.gov/source"] });
    const result = discoverCalibrationIdentityHistory(root);
    expect(result.identities).toEqual([]);
    expect(result.metrics.unknownArtifactsSkipped).toBe(1);
  });

  it("fails closed on an unknown artifact in explicit identity storage", () => {
    const root = directory();
    writeJson(root, "identities/unknown.json", { schemaVersion: "historical-identity-v99", results: [] });
    expect(() => discoverCalibrationIdentityHistory(root)).toThrow(CalibrationArtifactError);
    try { discoverCalibrationIdentityHistory(root); } catch (error) {
      expect((error as CalibrationArtifactError).diagnostics).toContainEqual({ code: "unsupported-artifact-version", resultIndex: null });
    }
  });

  it("fails closed on a malformed supported historical identity artifact", () => {
    const root = directory();
    writeJson(root, "malformed.json", identityArtifact({ results: [{ disposition: "ready-qualified-no-insert",
      candidate: "Malformed historical READY", sourcePair: "invalid" }] }));
    expect(() => discoverCalibrationIdentityHistory(root)).toThrow(CalibrationArtifactError);
  });

  it("fails closed on an unsupported version of an identity-shaped artifact", () => {
    const root = directory();
    writeJson(root, "unsupported.json", identityArtifact({ artifactVersion: 99 }));
    expect(() => discoverCalibrationIdentityHistory(root)).toThrow(CalibrationArtifactError);
    try { discoverCalibrationIdentityHistory(root); } catch (error) {
      expect((error as CalibrationArtifactError).diagnostics[0].code).toBe("unsupported-artifact-version");
    }
  });

  it("fails closed on truncated JSON in explicit identity storage", () => {
    const root = directory();
    mkdirSync(join(root, "identities"), { recursive: true });
    writeFileSync(join(root, "identities", "truncated.json"), "{", "utf8");
    expect(() => discoverCalibrationIdentityHistory(root)).toThrow(CalibrationArtifactError);
  });

  it("preserves missing-primary-URL historical replay", () => {
    const root = directory();
    writeJson(root, "historical.json", { selection: { candidate: "How official agencies compare energy prices",
      sourcePair: [{ registryId: "eia" }, { registryId: "bls" }] }, finalEvaluation: { readyQualified: true } });
    const result = discoverCalibrationIdentityHistory(root);
    expect(result.identities).toHaveLength(1);
    expect(result.identities[0].sourceUrls).toEqual([]);
  });
});
