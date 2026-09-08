export const DEFAULT_READY_QUEUE_TARGET = 18;
export const DEFAULT_READY_QUEUE_MINIMUM = 8;
export const DEFAULT_READY_QUEUE_MAXIMUM = 30;

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

export type PublicationConfig = ReturnType<typeof getPublicationConfig>;

export function getPublicationConfig() {
  const minimum = boundedInteger("READY_QUEUE_MINIMUM", DEFAULT_READY_QUEUE_MINIMUM, 1, 100);
  const target = boundedInteger("READY_QUEUE_TARGET", DEFAULT_READY_QUEUE_TARGET, 1, 100);
  const maximum = boundedInteger("READY_QUEUE_MAXIMUM", DEFAULT_READY_QUEUE_MAXIMUM, 1, 100);
  if (!(minimum <= target && target <= maximum)) {
    throw new Error("Ready queue configuration must satisfy minimum <= target <= maximum.");
  }

  return {
    minimum,
    target,
    maximum,
    normalCandidateLimit: boundedInteger("REPLENISH_NORMAL_CANDIDATES", 6, 1, 30),
    lowCandidateLimit: boundedInteger("REPLENISH_LOW_CANDIDATES", 12, 1, 40),
    criticalCandidateLimit: boundedInteger("REPLENISH_CRITICAL_CANDIDATES", 18, 1, 50),
    criticalGroqCandidateLimit: boundedInteger("MAX_GROQ_CANDIDATES_CRITICAL", 3, 1, 12),
    lowGroqCandidateLimit: boundedInteger("MAX_GROQ_CANDIDATES_LOW", 2, 1, 8),
    normalGroqCandidateLimit: boundedInteger("MAX_GROQ_CANDIDATES_NORMAL", 1, 1, 6),
  };
}

export function groqCandidateLimit(mode: ReserveMode, config: PublicationConfig) {
  if (mode === "healthy") return 0;
  if (mode === "critical") return config.criticalGroqCandidateLimit;
  if (mode === "low") return config.lowGroqCandidateLimit;
  return config.normalGroqCandidateLimit;
}

export type ReserveMode = "healthy" | "normal" | "low" | "critical";

export function reserveMode(depth: number, config: PublicationConfig): ReserveMode {
  if (depth <= 0) return "critical";
  if (depth < config.minimum) return "low";
  if (depth < config.target) return "normal";
  return "healthy";
}

export function replenishmentLimit(depth: number, config: PublicationConfig) {
  const mode = reserveMode(depth, config);
  const configuredLimit = mode === "critical" ? config.criticalCandidateLimit
    : mode === "low" ? config.lowCandidateLimit
      : mode === "normal" ? config.normalCandidateLimit
        : 0;
  return { mode, limit: Math.max(0, Math.min(configuredLimit, config.maximum - depth)) };
}

/**
 * Critical/low runs restore the operational floor without overshooting it in a
 * single cycle. Once the floor is satisfied, later normal cycles may continue
 * filling toward the configured reserve target. The hard maximum remains an
 * independent database safety fence.
 */
export function replenishmentFillTarget(depth: number, config: PublicationConfig) {
  return depth < config.minimum ? config.minimum : config.target;
}

export function replenishmentDeficit(depth: number, config: PublicationConfig) {
  return Math.max(0, replenishmentFillTarget(depth, config) - depth);
}

export function candidateReserveOrder(mode: ReserveMode, contentPool: string, curatedEvergreen = false) {
  if (mode === "critical") {
    if (curatedEvergreen) return -1;
    if (contentPool === "evergreen") return 0;
    if (contentPool === "economic-data") return 1;
    if (contentPool === "government-records") return 2;
  }
  return contentPool === "breaking" ? 0 : contentPool === "government-records" ? 1 : 2;
}
