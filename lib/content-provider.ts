import { createGroqRuntime, GROQ_MODEL, reviseWithGroq, rewriteWithGroq, validateWithGroq } from "@/lib/groq";
import type { DeterministicOriginalityResult } from "@/lib/article-quality";
import type { EvidenceBundle } from "@/lib/evidence-model";
import type { ProviderAttemptRecord, ProviderUsageEvent } from "@/lib/provider-runtime";
import type { ArticleQualityReview, RewrittenArticle } from "@/types/article";

export type { ProviderUsageEvent } from "@/lib/provider-runtime";

export type RevisionGuidance = {
  focus: "originality" | "attribution" | "depth" | "factual-support" | "multi-source-synthesis";
  reasons: string[];
  review?: ArticleQualityReview;
  deterministicOriginality?: DeterministicOriginalityResult;
};

export interface ContentGenerationProvider {
  readonly id: string;
  readonly model: string;
  generate(evidence: EvidenceBundle): Promise<RewrittenArticle>;
  revise?(article: RewrittenArticle, guidance: RevisionGuidance, evidence: EvidenceBundle): Promise<RewrittenArticle>;
}

export interface ContentValidationProvider {
  readonly id: string;
  validate(article: RewrittenArticle, evidence: EvidenceBundle): Promise<ArticleQualityReview>;
}

export type ContentProvider = ContentGenerationProvider & ContentValidationProvider;

export type InstrumentedContentProvider = ContentProvider & {
  setRunContext?(runId: string, beforeRequest: () => Promise<void>): void;
  beginCandidate?(candidateHash: string, candidateTelemetryId: string): void;
  finishCandidate?(disposition: string, revisionRequired: boolean): void;
  drainUsage?(): ProviderUsageEvent[];
  setAttemptObserver?(observer: (event: ProviderUsageEvent) => void): void;
};

export class GroqContentProvider implements ContentProvider {
  readonly id = "groq";
  readonly model = GROQ_MODEL;

  private currentCandidateHash = "unassigned";
  private currentCandidateTelemetryId = "unassigned";
  private usageEvents: ProviderUsageEvent[] = [];
  private auditCount = 0;
  private runtime: ReturnType<typeof createGroqRuntime>;
  private attemptObserver?: (event: ProviderUsageEvent) => void;

  constructor(runId = crypto.randomUUID(), beforeRequest?: () => Promise<void>) {
    this.runtime = createGroqRuntime(runId, beforeRequest);
  }

  setRunContext(runId: string, beforeRequest: () => Promise<void>) {
    if (this.usageEvents.length > 0) throw new Error("Cannot replace provider run context after usage begins.");
    this.runtime = createGroqRuntime(runId, beforeRequest);
  }

  beginCandidate(candidateHash: string, candidateTelemetryId: string) {
    this.currentCandidateHash = candidateHash;
    this.currentCandidateTelemetryId = candidateTelemetryId;
    this.auditCount = 0;
  }

  setAttemptObserver(observer: (event: ProviderUsageEvent) => void) {
    this.attemptObserver = observer;
  }

  private recordUsage = (event: ProviderAttemptRecord) => {
    const usageEvent = { ...event, candidateTelemetryId: this.currentCandidateTelemetryId,
      candidateHash: this.currentCandidateHash, revisionRequired: false, finalDisposition: "pending" };
    this.usageEvents.push(usageEvent);
    this.attemptObserver?.(structuredClone(usageEvent));
  };

  generate(evidence: EvidenceBundle) {
    return rewriteWithGroq(evidence, this.recordUsage, 3, this.runtime);
  }

  revise(article: RewrittenArticle, guidance: RevisionGuidance, evidence: EvidenceBundle) {
    return reviseWithGroq(article, guidance, evidence, this.recordUsage, 3, this.runtime);
  }

  validate(article: RewrittenArticle, evidence: EvidenceBundle) {
    const operation = this.auditCount++ === 0 ? "audit" : "revision-audit";
    return validateWithGroq(article, evidence, operation, this.recordUsage, 3, this.runtime);
  }

  finishCandidate(disposition: string, revisionRequired: boolean) {
    for (const event of this.usageEvents) {
      if (event.candidateTelemetryId === this.currentCandidateTelemetryId && event.finalDisposition === "pending") {
        event.finalDisposition = disposition;
        event.revisionRequired = revisionRequired;
        this.attemptObserver?.(structuredClone(event));
      }
    }
  }

  drainUsage() {
    const events = this.usageEvents;
    this.usageEvents = [];
    return events;
  }
}
