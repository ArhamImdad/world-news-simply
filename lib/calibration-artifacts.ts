import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import {
  CalibrationArtifactError,
  identitiesFromCalibrationArtifact,
  type CanonicalArticleIdentity,
} from "@/lib/article-identity";

export type CalibrationArtifactClassification = "identity-replay-source" | "non-identity-artifact" | "unknown-artifact";

export type CalibrationArtifactDiscoveryMetrics = {
  calibrationJsonFilesDiscovered: number;
  identityReplayArtifactsAccepted: number;
  knownNonIdentityArtifactsSkipped: number;
  unknownArtifactsSkipped: number;
  historicalIdentitiesLoaded: number;
};

export type CalibrationArtifactRoute = {
  relativePath: string;
  classification: CalibrationArtifactClassification;
  schemaVersion: string | number | null;
  scope: "general" | "identity";
};

const NON_IDENTITY_SCHEMAS = new Set([
  "replenishment-run-telemetry-v1",
  "replenishment-run-telemetry-v2",
  "replenishment-run-telemetry-v3",
  "replenishment-run-telemetry-v4",
  "authoritative-eight-article-reserve-v1",
  "authoritative-eight-article-reserve-aborted-v1",
  "staging-reserve-inspection-v1",
  "staging-reserve-cleanup-v1",
  "source-expansion-v1",
  "controlled-source-expansion-v1",
  "source-expansion-replay-v1",
  "source-preflight-replay-v1",
]);

const NON_IDENTITY_DIRECTORIES = new Set(["replenishment-runs", "staging-control", "experiments", "source-expansion"]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function declaredVersion(value: unknown) {
  const artifact = record(value);
  const version = artifact?.artifactVersion ?? artifact?.schemaVersion;
  return typeof version === "string" || typeof version === "number" ? version : null;
}

function hasLegacySelectionContract(artifact: Record<string, unknown>) {
  const selection = record(artifact.selection);
  const finalEvaluation = record(artifact.finalEvaluation);
  return Boolean(selection && finalEvaluation && "candidate" in selection && "sourcePair" in selection &&
    "readyQualified" in finalEvaluation);
}

function hasLegacyResultsContract(artifact: Record<string, unknown>) {
  if (!Array.isArray(artifact.results)) return false;
  return artifact.results.some((result) => {
    const item = record(result);
    return Boolean(item && ("disposition" in item || "finalDisposition" in item));
  });
}

export function classifyCalibrationArtifact(value: unknown, options: {
  relativePath?: string;
  identityScope?: boolean;
} = {}): CalibrationArtifactClassification {
  if (options.identityScope) return "identity-replay-source";
  const artifact = record(value);
  if (!artifact) return "unknown-artifact";
  const schema = declaredVersion(artifact);
  if (typeof schema === "string" && NON_IDENTITY_SCHEMAS.has(schema)) return "non-identity-artifact";
  const firstDirectory = options.relativePath?.split(/[\\/]/)[0];
  if (firstDirectory && NON_IDENTITY_DIRECTORIES.has(firstDirectory)) return "non-identity-artifact";
  if (hasLegacySelectionContract(artifact) || hasLegacyResultsContract(artifact)) return "identity-replay-source";
  return "unknown-artifact";
}

function jsonFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return jsonFiles(path);
    return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
  }).sort();
}

function identityScope(relativePath: string) {
  return relativePath.split(/[\\/]/)[0] === "identities";
}

export function discoverCalibrationIdentityHistory(directory: string): {
  identities: CanonicalArticleIdentity[];
  metrics: CalibrationArtifactDiscoveryMetrics;
  routes: CalibrationArtifactRoute[];
} {
  const root = resolve(directory);
  const files = jsonFiles(root);
  const identities: CanonicalArticleIdentity[] = [];
  const routes: CalibrationArtifactRoute[] = [];
  const metrics: CalibrationArtifactDiscoveryMetrics = {
    calibrationJsonFilesDiscovered: files.length,
    identityReplayArtifactsAccepted: 0,
    knownNonIdentityArtifactsSkipped: 0,
    unknownArtifactsSkipped: 0,
    historicalIdentitiesLoaded: 0,
  };
  for (const path of files) {
    const relativePath = relative(root, path).split(sep).join("/");
    const scoped = identityScope(relativePath);
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      if (scoped) throw new CalibrationArtifactError([{ code: "artifact-not-object", resultIndex: null }]);
      routes.push({ relativePath, classification: "unknown-artifact", schemaVersion: null, scope: "general" });
      metrics.unknownArtifactsSkipped += 1;
      continue;
    }
    const classification = classifyCalibrationArtifact(value, { relativePath, identityScope: scoped });
    routes.push({ relativePath, classification, schemaVersion: declaredVersion(value), scope: scoped ? "identity" : "general" });
    if (classification === "non-identity-artifact") {
      metrics.knownNonIdentityArtifactsSkipped += 1;
      continue;
    }
    if (classification === "unknown-artifact") {
      metrics.unknownArtifactsSkipped += 1;
      continue;
    }
    const loaded = identitiesFromCalibrationArtifact(value);
    identities.push(...loaded);
    metrics.identityReplayArtifactsAccepted += 1;
  }
  metrics.historicalIdentitiesLoaded = identities.length;
  return { identities, metrics, routes };
}
