import { normalizeText, textSimilarity } from "@/lib/article-quality";
import type { SourceMaterial } from "@/types/article";

export type EvidenceContext = "definition" | "measurement" | "change" | "scope" | "limitation" | "implication";

export type EvidenceFact = {
  id: string;
  fact: string;
  sourceId: string;
  sourceUrl: string;
  publisher: string;
  date: string | null;
  entities: string[];
  numbers: string[];
  event: string | null;
  context: EvidenceContext;
  support: "direct";
};

export type EvidenceBoundInsight = {
  statement: string;
  factIds: string[];
};

export type ComparisonRelation = EvidenceContext | "complementary-context";

export type EvidenceComparison = {
  leftFactId: string;
  rightFactId: string;
  relation: ComparisonRelation;
  sharedConcepts: string[];
  interpretation: EvidenceBoundInsight;
  limitation: string;
  strength: number;
};

export type EvidencePlan = {
  angle: string;
  centralReaderQuestion: string;
  evidenceShows: EvidenceBoundInsight;
  sourceRelationship: EvidenceBoundInsight;
  legitimateComparison: EvidenceBoundInsight;
  combinedInsight: EvidenceBoundInsight;
  practicalInterpretation: EvidenceBoundInsight;
  limitations: EvidenceBoundInsight[];
  prohibitedConclusions: string[];
  headlineBrief: string;
  headlineFallback: string;
  leadFactIds: string[];
  sections: Array<{ readerQuestion: string; purpose: string; factIds: string[]; requiresCrossSourceSynthesis: boolean }>;
  comparisonOpportunities: EvidenceComparison[];
  readerValue: string;
  synthesisValueScore: number;
};

export type EvidenceBundle = {
  candidateHash: string;
  sources: Array<{ id: string; publisher: string; url: string; date: string | null }>;
  facts: EvidenceFact[];
  plan: EvidencePlan;
  richnessScore: number;
};

const boilerplate = /\b(cookie|subscribe|newsletter|privacy policy|terms of use|contact us|share this|skip to|javascript|download pdf)\b/i;

function hashText(value: string) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function candidateHash(value: string) {
  return hashText(value).slice(0, 8);
}

function sentences(value: string) {
  return value.split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= 45 && sentence.length <= 360 && !boilerplate.test(sentence));
}

function contextFor(value: string): EvidenceContext {
  if (/\b(limit|limitation|caution|exclude|excluding|not include|cannot|uncertain|revision)\b/i.test(value)) return "limitation";
  if (/\b(increase|decrease|change|rose|fell|grew|declined|compared|previous|quarter|month|year)\b/i.test(value)) return "change";
  if (/\b(sample|calculate|method|weight|index|estimate|measure|compile|survey|data)\b/i.test(value)) return "measurement";
  if (/\b(cover|scope|population|include|represent|geography|sector|category)\b/i.test(value)) return "scope";
  if (/\b(means|matters|use|interpret|indicate|shows|helps|decision)\b/i.test(value)) return "implication";
  return "definition";
}

function eventFor(value: string) {
  const events = ["approval", "enforcement", "merger", "employment", "inflation", "trade", "output", "income", "banking", "energy", "health", "weather", "space"];
  return events.find((event) => new RegExp(`\\b${event}\w*\\b`, "i").test(value)) ?? null;
}

function entities(value: string) {
  return [...new Set(value.match(/\b[A-Z][A-Za-z&.-]{2,}(?:\s+[A-Z][A-Za-z&.-]{2,}){0,3}\b/g) ?? [])].slice(0, 6);
}

function numbers(value: string) {
  return [...new Set(value.match(/\b(?:\d[\d,.]*%?|Q[1-4]|20\d{2})\b/gi) ?? [])].slice(0, 8);
}

function factScore(value: string) {
  return Math.min(8, numbers(value).length * 2) + Math.min(4, entities(value).length) +
    (/\b(method|measure|sample|include|exclude|change|compared|limit|use)\b/i.test(value) ? 3 : 0) +
    (value.length >= 90 && value.length <= 260 ? 2 : 0);
}

function sourceFacts(source: SourceMaterial, sourceIndex: number) {
  const selected: string[] = [];
  for (const sentence of sentences(source.text).sort((left, right) => factScore(right) - factScore(left))) {
    if (selected.some((existing) => textSimilarity(existing, sentence) >= 0.76)) continue;
    selected.push(sentence);
    if (selected.length >= 6) break;
  }
  return selected.map((fact, index): EvidenceFact => ({
    id: `S${sourceIndex + 1}F${index + 1}`,
    fact,
    sourceId: source.registryId,
    sourceUrl: source.url,
    publisher: source.publisher,
    date: source.publishedAt,
    entities: entities(fact),
    numbers: numbers(fact),
    event: eventFor(fact),
    context: contextFor(fact),
    support: "direct",
  }));
}

function sharedMeaningfulTokens(left: string, right: string) {
  const generic = new Set(["agenc", "official", "publish", "report", "record", "current", "annual", "month",
    "statistic", "estimate", "compare", "review", "document", "federal"]);
  const concepts = (value: string) => normalizeText(value).split(" ").filter((token) => token.length >= 5)
    .map((token) => token.replace(/(?:ing|ed|es|s)$/, "")).filter((token) => !generic.has(token));
  const leftTokens = new Set(concepts(left));
  return [...new Set(concepts(right).filter((token) => leftTokens.has(token)))];
}

const complementaryContexts = new Set(["measurement:scope", "scope:measurement", "change:limitation", "limitation:change",
  "definition:scope", "scope:definition", "measurement:limitation", "limitation:measurement",
  "change:measurement", "measurement:change", "limitation:scope", "scope:limitation"]);

function comparisonCandidate(left: EvidenceFact, right: EvidenceFact): EvidenceComparison | null {
  if (left.sourceId === right.sourceId) return null;
  const sharedConcepts = sharedMeaningfulTokens(left.fact, right.fact).slice(0, 4);
  const nonEntityLabels = new Set(["the", "this", "these", "published", "annual", "monthly"]);
  const sharedEntities = left.entities.filter((entity) => !nonEntityLabels.has(normalizeText(entity)) &&
    right.entities.some((candidate) => normalizeText(candidate) === normalizeText(entity)));
  const sameEvent = Boolean(left.event && left.event === right.event);
  const complementary = complementaryContexts.has(`${left.context}:${right.context}`);
  const anchored = sharedConcepts.length > 0 || sharedEntities.length > 0 || sameEvent;
  const strength = (left.context === right.context ? 4 : 0) + Math.min(4, sharedConcepts.length * 2) +
    Math.min(4, sharedEntities.length * 2) + (sameEvent ? 3 : 0) + (complementary ? 2 : 0);
  if (!anchored || strength < 4) return null;
  const relation: ComparisonRelation = left.context === right.context ? left.context
    : complementary ? "complementary-context" : left.context;
  return {
    leftFactId: left.id,
    rightFactId: right.id,
    relation,
    sharedConcepts,
    interpretation: {
      statement: `Use ${left.id} and ${right.id} together to explain their ${relation.replace("-", " ")} relationship without extending beyond either fact.`,
      factIds: [left.id, right.id],
    },
    limitation: `Do not treat ${left.id} and ${right.id} as equivalent measures or evidence of causation unless both facts explicitly say so.`,
    strength,
  };
}

function interleaveFacts(facts: EvidenceFact[]) {
  const queues = [...new Set(facts.map((fact) => fact.sourceId))].map((sourceId) =>
    facts.filter((fact) => fact.sourceId === sourceId)
  );
  const result: EvidenceFact[] = [];
  for (let index = 0; result.length < facts.length; index += 1) {
    for (const queue of queues) if (queue[index]) result.push(queue[index]);
  }
  return result;
}

function buildPlan(angle: string, facts: EvidenceFact[], publishers: string[]): EvidencePlan {
  const sourceIds = [...new Set(facts.map((fact) => fact.sourceId))];
  const leadFactIds = sourceIds.flatMap((sourceId) => facts.find((fact) => fact.sourceId === sourceId)?.id ?? []).slice(0, 3);
  const comparisonOpportunities: EvidencePlan["comparisonOpportunities"] = [];
  for (const left of facts) {
    for (const right of facts) {
      const candidate = comparisonCandidate(left, right);
      if (!candidate || comparisonOpportunities.some((pair) =>
        (pair.leftFactId === candidate.leftFactId && pair.rightFactId === candidate.rightFactId) ||
        (pair.leftFactId === candidate.rightFactId && pair.rightFactId === candidate.leftFactId))) continue;
      comparisonOpportunities.push(candidate);
    }
  }
  comparisonOpportunities.sort((left, right) => right.strength - left.strength);
  comparisonOpportunities.splice(5);

  const comparisonSections = comparisonOpportunities.slice(0, 3).map((comparison) => ({
    readerQuestion: `How do the facts about ${comparison.relation.replace("-", " ")} compare?`,
    purpose: comparison.interpretation.statement,
    factIds: comparison.interpretation.factIds,
    requiresCrossSourceSynthesis: true,
  }));
  const limitationFacts = interleaveFacts(facts.filter((fact) => fact.context === "limitation" || fact.context === "scope"));
  const sections = [
    {
      readerQuestion: "What does the official evidence establish?",
      purpose: "Open with the strongest supported finding and define the scope of the comparison.",
      factIds: leadFactIds,
      requiresCrossSourceSynthesis: true,
    },
    ...comparisonSections,
    ...(limitationFacts.length ? [{
      readerQuestion: "What are the limits of this comparison?",
      purpose: "Explain what the supplied evidence measures and what cannot safely be inferred.",
      factIds: limitationFacts.slice(0, 4).map((fact) => fact.id),
      requiresCrossSourceSynthesis: new Set(limitationFacts.slice(0, 4).map((fact) => fact.sourceId)).size > 1,
    }] : []),
  ];
  const primaryComparison = comparisonOpportunities[0];
  const comparisonIds = primaryComparison?.interpretation.factIds ?? leadFactIds;
  const allComparisonIds = [...new Set(comparisonOpportunities.flatMap((comparison) => comparison.interpretation.factIds))];
  const limitations = limitationFacts.length ? [{
    statement: "Use these scope or limitation facts to state what the comparison cannot establish.",
    factIds: limitationFacts.slice(0, 4).map((fact) => fact.id),
  }] : comparisonOpportunities.slice(0, 2).map((comparison) => ({
    statement: comparison.limitation,
    factIds: comparison.interpretation.factIds,
  }));
  const relationDiversity = new Set(comparisonOpportunities.map((comparison) => comparison.relation)).size;
  const mixedSections = sections.filter((section) => new Set(section.factIds.map((id) =>
    facts.find((fact) => fact.id === id)?.sourceId).filter(Boolean)).size > 1).length;
  const synthesisValueScore = Math.min(100, comparisonOpportunities.length * 12 + relationDiversity * 8 +
    Math.min(20, mixedSections * 7) + (limitations.length ? 12 : 0) +
    Math.min(12, new Set(facts.map((fact) => fact.context)).size * 3));
  const publisherLabel = publishers.slice(0, 2).join(" and ");
  return {
    angle,
    centralReaderQuestion: `What does the combined official evidence clarify about ${angle.replace(/[?.!]+$/, "")}?`,
    evidenceShows: { statement: "Establish the strongest directly supported finding from both sources before interpreting it.", factIds: leadFactIds },
    sourceRelationship: { statement: "Relate the sources only through the explicit comparison dimensions identified below.", factIds: allComparisonIds },
    legitimateComparison: { statement: primaryComparison?.interpretation.statement ?? "No defensible cross-source comparison was identified.", factIds: comparisonIds },
    combinedInsight: { statement: "Explain what becomes clearer when the linked facts are organized together, without adding a new factual claim.", factIds: allComparisonIds },
    practicalInterpretation: { statement: "Tell readers how to interpret the supplied measures or findings and where comparison stops.", factIds: [...new Set([...allComparisonIds, ...limitations.flatMap((item) => item.factIds)])] },
    limitations,
    prohibitedConclusions: [
      "Do not infer causation from association, timing, or shared vocabulary.",
      "Do not treat unlike definitions, populations, periods, or measurements as interchangeable.",
      "Do not claim a broader trend, motive, forecast, or outcome absent from the cited facts.",
    ],
    headlineBrief: "State the evidence-backed combined insight, not either source headline; avoid causality unless explicitly supported.",
    headlineFallback: `${publisherLabel}: where the official evidence aligns and differs`,
    leadFactIds,
    sections,
    comparisonOpportunities,
    readerValue: "Give readers a clearer evidence-bound comparison than separate source summaries would provide, including practical interpretation and explicit limits.",
    synthesisValueScore,
  };
}

export function buildEvidenceBundle(angle: string, sources: SourceMaterial[], hashSeed: string): EvidenceBundle {
  const bySource = sources.map(sourceFacts);
  const facts: EvidenceFact[] = [];
  const maxFacts = Math.max(0, ...bySource.map((source) => source.length));
  for (let index = 0; index < maxFacts; index += 1) {
    for (const source of bySource) if (source[index]) facts.push(source[index]);
  }
  const contexts = new Set(facts.map((fact) => fact.context)).size;
  const numericFacts = facts.filter((fact) => fact.numbers.length > 0).length;
  const representedSources = new Set(facts.map((fact) => fact.sourceId)).size;
  const richnessScore = Math.min(100, Math.round(
    Math.min(45, facts.length * 4) + Math.min(25, representedSources * 12.5) +
    Math.min(15, contexts * 3) + Math.min(15, numericFacts * 2)
  ));
  return {
    candidateHash: candidateHash(hashSeed),
    sources: sources.map((source) => ({ id: source.registryId, publisher: source.publisher, url: source.url, date: source.publishedAt })),
    facts,
    plan: buildPlan(angle, facts, sources.map((source) => source.publisher)),
    richnessScore,
  };
}

export function evidenceBundleFailures(bundle: EvidenceBundle) {
  const failures: string[] = [];
  if (bundle.sources.length < 2 || new Set(bundle.sources.map((source) => new URL(source.url).hostname.replace(/^www\./, ""))).size < 2) {
    failures.push("evidence lacks two independent domains");
  }
  for (const source of bundle.sources) {
    if (bundle.facts.filter((fact) => fact.sourceId === source.id).length < 3) failures.push("insufficient evidence from one source");
  }
  if (bundle.facts.length < 8 || bundle.richnessScore < 65) failures.push("insufficient structured evidence");
  if (bundle.plan.comparisonOpportunities.length < 2) failures.push("insufficient cross-source comparison evidence");
  if (bundle.plan.synthesisValueScore < 70) failures.push("insufficient evidence-backed synthesis value");
  if (bundle.plan.sections.filter((section) => section.requiresCrossSourceSynthesis).length < 2) {
    failures.push("plan would produce source-shaped paraphrasing");
  }
  return [...new Set(failures)];
}

export function preGroqQualificationScore(bundle: EvidenceBundle, sourcePreflightScore: number, curated: boolean) {
  return Math.min(100, Math.round(sourcePreflightScore * 0.35 + bundle.richnessScore * 0.5 +
    Math.min(10, bundle.plan.synthesisValueScore / 10) + (curated ? 5 : 0)));
}

export function compactEvidencePayload(bundle: EvidenceBundle, includePlan = true) {
  return {
    sources: bundle.sources.map(({ id, publisher, date }) => ({ id, publisher, date })),
    facts: bundle.facts.map(({ id, fact, sourceId, numbers, event, context, support }) => ({
      id, fact, sourceId, numbers, event, context, support,
    })),
    ...(includePlan ? { plan: bundle.plan } : {}),
  };
}

/** Provider-facing evidence deliberately omits internal fact and source IDs.
 * Numeric positions describe JSON-array relationships only; the canonical
 * EvidenceBundle remains unchanged for deterministic traceability. */
export function modelVisibleEvidencePayload(bundle: EvidenceBundle, includePlan = true) {
  const position = new Map(bundle.facts.map((fact, index) => [fact.id, index + 1]));
  const positions = (ids: string[]) => ids.flatMap((id) => position.has(id) ? [position.get(id)!] : []);
  const semanticText = (value: string) => value.replace(/S\d+F\d+/g, (id) =>
    position.has(id) ? `evidence entry ${position.get(id)}` : "linked evidence entry");
  const insight = (value: EvidenceBoundInsight) => ({
    statement: semanticText(value.statement),
    supportingEvidencePositions: positions(value.factIds),
  });
  return {
    sources: bundle.sources.map(({ publisher, date }) => ({ publisher, date })),
    evidence: bundle.facts.map(({ fact, publisher, context }) => ({ fact, publisher, context })),
    ...(includePlan ? { plan: {
      angle: semanticText(bundle.plan.angle),
      centralReaderQuestion: semanticText(bundle.plan.centralReaderQuestion),
      evidenceShows: insight(bundle.plan.evidenceShows),
      sourceRelationship: insight(bundle.plan.sourceRelationship),
      legitimateComparison: insight(bundle.plan.legitimateComparison),
      combinedInsight: insight(bundle.plan.combinedInsight),
      practicalInterpretation: insight(bundle.plan.practicalInterpretation),
      limitations: bundle.plan.limitations.map(insight),
      prohibitedConclusions: bundle.plan.prohibitedConclusions.map(semanticText),
      headlineBrief: semanticText(bundle.plan.headlineBrief),
      headlineFallback: semanticText(bundle.plan.headlineFallback),
      leadEvidencePositions: positions(bundle.plan.leadFactIds),
      sections: bundle.plan.sections.map((section) => ({
        readerQuestion: semanticText(section.readerQuestion),
        purpose: semanticText(section.purpose),
        supportingEvidencePositions: positions(section.factIds),
        requiresCrossSourceSynthesis: section.requiresCrossSourceSynthesis,
      })),
      comparisonOpportunities: bundle.plan.comparisonOpportunities.map((comparison) => ({
        leftEvidencePosition: position.get(comparison.leftFactId),
        rightEvidencePosition: position.get(comparison.rightFactId),
        relation: comparison.relation,
        sharedConcepts: comparison.sharedConcepts,
        interpretation: insight(comparison.interpretation),
        limitation: semanticText(comparison.limitation),
        strength: comparison.strength,
      })),
      readerValue: semanticText(bundle.plan.readerValue),
      synthesisValueScore: bundle.plan.synthesisValueScore,
    } } : {}),
  };
}
