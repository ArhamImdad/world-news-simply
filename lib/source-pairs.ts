import type { SourceRegistryEntry } from "@/lib/source-registry";
import { recurringReleaseMatch } from "@/lib/release-series";

export type MatchableStory = {
  title: string;
  content: string;
  publishedAt: string | null;
  source: SourceRegistryEntry;
};

export type SourcePairRule = {
  id: string;
  sourceIds: readonly string[];
  topicKeys: readonly string[];
  maxDistanceHours: number;
};

// These groups are deliberately narrow. Membership only permits comparison;
// the story-level evidence checks below must still demonstrate a real topical
// relationship before two items can be used together.
export const SOURCE_PAIR_RULES: readonly SourcePairRule[] = [
  {
    id: "sports-participation-and-policy",
    sourceIds: ["govuk-news", "statcan-daily", "abs-latest-releases", "ons-release-calendar"],
    topicKeys: ["sport", "sports", "participation", "athletes", "physical activity"],
    maxDistanceHours: 24 * 31,
  },
  {
    id: "technology-and-science-policy",
    sourceIds: ["govuk-news", "nasa-news-releases", "ftc-press-releases", "doj-news", "statcan-daily"],
    topicKeys: ["artificial intelligence", "technology", "cybersecurity", "computing", "privacy", "space", "satellite"],
    maxDistanceHours: 24 * 21,
  },
  {
    id: "economic-indicators",
    sourceIds: ["bls-latest", "census-economic-indicators", "census-news-releases", "ons-release-calendar", "bea-news-releases", "federal-reserve-press", "eia-today-in-energy", "eurostat-news-releases", "statcan-daily", "abs-latest-releases"],
    topicKeys: ["employment", "inflation", "prices", "trade", "gdp", "income", "spending", "investment", "production", "productivity", "services", "manufacturing", "construction", "energy"],
    maxDistanceHours: 24 * 45,
  },
  {
    id: "financial-enforcement",
    sourceIds: ["sec-press-releases", "federal-reserve-press", "ftc-press-releases", "cftc-press-releases", "cfpb-newsroom", "doj-news"],
    topicKeys: ["fraud", "enforcement", "securities", "banking", "merger", "antitrust", "competition", "privacy", "markets"],
    maxDistanceHours: 24 * 21,
  },
  {
    id: "consumer-finance-enforcement",
    sourceIds: ["cfpb-newsroom", "ftc-press-releases", "doj-news", "federal-reserve-press"],
    topicKeys: ["fraud", "enforcement", "banking", "credit", "debt", "payments", "privacy"],
    maxDistanceHours: 24 * 21,
  },
  {
    id: "health-regulation",
    sourceIds: ["fda-press-announcements", "ftc-press-releases", "doj-news", "govuk-news"],
    topicKeys: ["health", "drug", "device", "approval", "authorization", "recall", "fraud", "enforcement"],
    maxDistanceHours: 24 * 21,
  },
  {
    id: "uk-official-statistics",
    sourceIds: ["ons-release-calendar", "govuk-news"],
    topicKeys: ["employment", "inflation", "prices", "trade", "gdp", "population", "health", "policy"],
    maxDistanceHours: 24 * 31,
  },
  {
    id: "earth-and-energy-science",
    sourceIds: ["nasa-news-releases", "eia-today-in-energy", "noaa-nhc-atlantic"],
    topicKeys: ["earth", "climate", "satellite", "energy", "electricity", "water", "weather", "storm"],
    maxDistanceHours: 24 * 31,
  },
];

const ignored = new Set([
  "about", "after", "against", "agency", "announces", "announcement", "before", "board", "bureau",
  "commission", "department", "federal", "first", "from", "government", "latest", "more", "news", "official",
  "over", "press", "release", "report", "reports", "says", "statement", "their", "there", "these", "this", "through",
  "under", "united", "with", "years",
]);

const phraseAliases: readonly [RegExp, string][] = [
  [/\bu\.?s\.?\b|\bunited states\b/gi, " us "],
  [/\bu\.?k\.?\b|\bunited kingdom\b/gi, " uk "],
  [/\bfederal reserve (?:board|system)?\b/gi, " federalreserve "],
  [/\bbureau of labor statistics\b/gi, " bls "],
  [/\bbureau of economic analysis\b/gi, " bea "],
  [/\bfood and drug administration\b/gi, " fda "],
  [/\bsecurities and exchange commission\b/gi, " sec "],
  [/\bfederal trade commission\b/gi, " ftc "],
  [/\bcommodity futures trading commission\b/gi, " cftc "],
  [/\bconsumer financial protection bureau\b/gi, " cfpb "],
  [/\bstatistics canada\b/gi, " statcan "],
  [/\baustralian bureau of statistics\b/gi, " abs "],
  [/\beurostat\b/gi, " eurostat "],
  [/\bdepartment of justice\b/gi, " doj "],
  [/\bconsumer price index\b/gi, " cpi "],
  [/\bgross domestic product\b/gi, " gdp "],
  [/\bpersonal consumption expenditures\b/gi, " pce "],
];

const eventGroups: Record<string, readonly string[]> = {
  sports: ["sport", "sports", "participation", "athletes", "olympic", "paralympic"],
  technology: ["technology", "artificial intelligence", "cybersecurity", "computing", "software"],
  approval: ["approve", "approved", "approval", "authorize", "authorized", "authorization", "clearance"],
  enforcement: ["charge", "charged", "charges", "settle", "settlement", "fine", "penalty", "enforcement", "indict", "indicted", "sentenced", "fraud", "alleged", "allegations"],
  regulation: ["rule", "rules", "regulation", "regulatory", "proposal", "proposes", "comment", "guidance", "policy"],
  merger: ["merger", "acquisition", "acquire", "competition", "antitrust"],
  employment: ["employment", "unemployment", "jobs", "job", "labor", "labour", "workforce", "wages", "earnings"],
  inflation: ["inflation", "cpi", "pce", "prices", "price", "cost"],
  trade: ["trade", "exports", "export", "imports", "import", "deficit", "surplus", "shipments"],
  output: ["gdp", "output", "production", "productivity", "manufacturing", "services", "construction"],
  income: ["income", "spending", "outlays", "consumption", "retail", "sales"],
  banking: ["bank", "banks", "banking", "credit", "interest", "rates", "monetary", "fomc", "payments"],
  markets: ["market", "markets", "trading", "commodity", "commodities", "derivative", "derivatives", "futures", "swap", "swaps", "digital", "asset", "assets"],
  energy: ["energy", "oil", "petroleum", "gas", "electricity", "power", "battery", "fuel", "renewable"],
  health: ["health", "drug", "therapy", "device", "medical", "disease", "outbreak", "recall", "food"],
  earth: ["earth", "climate", "weather", "water", "river", "ocean", "satellite", "drought", "flood", "storm", "hurricane", "tropical", "forecast"],
  space: ["space", "mission", "spacecraft", "moon", "mars", "artemis", "orbit", "telescope"],
};

const placeAliases: Record<string, readonly string[]> = {
  us: ["us", "america", "american"],
  uk: ["uk", "britain", "british", "england", "scotland", "wales", "northern ireland"],
  europe: ["europe", "european", "eu", "euro area", "eurozone"],
  global: ["global", "world", "international"],
};

function normalize(value: string) {
  let normalized = value.normalize("NFKD");
  for (const [pattern, replacement] of phraseAliases) normalized = normalized.replace(pattern, replacement);
  return normalized.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(value: string) {
  return normalize(value).split(" ").filter((token) => token.length > 2 && !ignored.has(token));
}

function overlap(left: readonly string[], right: readonly string[]) {
  const rightSet = new Set(right);
  return new Set(left.filter((value) => rightSet.has(value))).size;
}

function dice(left: readonly string[], right: readonly string[]) {
  if (!left.length || !right.length) return 0;
  return (2 * overlap(left, right)) / (new Set(left).size + new Set(right).size);
}

function eventKeys(value: string) {
  const haystack = new Set(tokens(value));
  return Object.entries(eventGroups).flatMap(([key, words]) => words.some((word) => haystack.has(word)) ? [key] : []);
}

function places(value: string) {
  const normalized = ` ${normalize(value)} `;
  return Object.entries(placeAliases).flatMap(([key, aliases]) =>
    aliases.some((alias) => normalized.includes(` ${alias} `)) ? [key] : []);
}

function dateKeys(value: string, publishedAt: string | null) {
  const normalized = normalize(value);
  const keys: string[] = normalized.match(/\b(?:20\d{2}|q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december)\b/g) ?? [];
  if (publishedAt) {
    const date = new Date(publishedAt);
    if (!Number.isNaN(date.getTime())) keys.push(`published-${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`);
  }
  return [...new Set(keys)];
}

function entities(value: string) {
  const generic = new Set(["federal", "united", "new", "current", "first", "official", "government", "board"]);
  const acronyms = value.match(/\b[A-Z][A-Z0-9&.-]{1,8}\b/g) ?? [];
  const names = value.match(/\b[A-Z][a-zA-Z0-9&'.-]{2,}(?:\s+[A-Z][a-zA-Z0-9&'.-]{2,}){0,3}\b/g) ?? [];
  return [...new Set([...acronyms, ...names]
    .map((entity) => normalize(entity))
    .filter((entity) => entity.length > 2 && !generic.has(entity) && !ignored.has(entity)))];
}

function sharedRule(leftId: string, rightId: string) {
  return SOURCE_PAIR_RULES.find((rule) => rule.sourceIds.includes(leftId) && rule.sourceIds.includes(rightId));
}

export function compatibleSourceIds(sourceId: string) {
  return [...new Set(SOURCE_PAIR_RULES.filter((rule) => rule.sourceIds.includes(sourceId))
    .flatMap((rule) => rule.sourceIds).filter((id) => id !== sourceId))];
}

export type StoryMatch = {
  accepted: boolean;
  score: number;
  ruleId: string | null;
  signals: string[];
};

export function matchOfficialStories(left: MatchableStory, right: MatchableStory): StoryMatch {
  if (left.source.id === right.source.id || left.source.domain === right.source.domain) {
    return { accepted: false, score: 0, ruleId: null, signals: [] };
  }
  const rule = sharedRule(left.source.id, right.source.id);
  if (!rule) return { accepted: false, score: 0, ruleId: null, signals: [] };

  const leftTime = Date.parse(left.publishedAt ?? "");
  const rightTime = Date.parse(right.publishedAt ?? "");
  if (leftTime && rightTime && Math.abs(leftTime - rightTime) > rule.maxDistanceHours * 3_600_000) {
    return { accepted: false, score: 0, ruleId: rule.id, signals: ["outside-time-window"] };
  }

  const recurring = recurringReleaseMatch(
    { sourceId: left.source.id, title: left.title, periodContext: `${left.title} ${left.content.slice(0, 900)}`,
      publishedAt: left.publishedAt },
    { sourceId: right.source.id, title: right.title, periodContext: `${right.title} ${right.content.slice(0, 900)}`,
      publishedAt: right.publishedAt },
  );
  if (recurring) {
    return { accepted: true, score: 0.78, ruleId: rule.id,
      signals: ["release-series", `period:${recurring.period}`, `series:${recurring.seriesId}`] };
  }

  const leftTitleTokens = tokens(left.title);
  const rightTitleTokens = tokens(right.title);
  const titleOverlap = overlap(leftTitleTokens, rightTitleTokens);
  const titleSimilarity = dice(leftTitleTokens, rightTitleTokens);
  const bodySimilarity = dice(tokens(`${left.title} ${left.content.slice(0, 700)}`), tokens(`${right.title} ${right.content.slice(0, 700)}`));
  const sharedEvents = overlap(eventKeys(`${left.title} ${left.content.slice(0, 400)}`), eventKeys(`${right.title} ${right.content.slice(0, 400)}`));
  const sharedEntities = overlap(entities(left.title), entities(right.title));
  const sharedPlaces = overlap(places(`${left.title} ${left.content.slice(0, 300)}`), places(`${right.title} ${right.content.slice(0, 300)}`));
  const sharedDates = overlap(dateKeys(left.title, left.publishedAt), dateKeys(right.title, right.publishedAt));
  const sharedRegistryTopics = overlap(left.source.topicTags, right.source.topicTags);

  const score = Math.min(1,
    titleSimilarity * 0.34 + Math.min(bodySimilarity, 0.6) * 0.16 +
    Math.min(sharedEvents, 2) * 0.13 + Math.min(sharedEntities, 2) * 0.14 +
    Math.min(sharedDates, 2) * 0.06 + Math.min(sharedPlaces, 1) * 0.05 +
    Math.min(sharedRegistryTopics, 3) * 0.04
  );
  const signals = [
    sharedEvents ? "event" : "", sharedEntities ? "entity" : "", sharedDates ? "date" : "",
    sharedPlaces ? "place" : "", titleOverlap >= 2 ? "title" : "", bodySimilarity >= 0.2 ? "context" : "",
  ].filter(Boolean);
  const evidence = (sharedEntities >= 1 && (sharedEvents >= 1 || titleOverlap >= 2)) ||
    (sharedEvents >= 1 && titleOverlap >= 2 && (sharedDates >= 1 || sharedPlaces >= 1 || bodySimilarity >= 0.28)) ||
    (sharedEvents >= 1 && sharedDates >= 2 && titleOverlap >= 1 && bodySimilarity >= 0.24) ||
    (titleOverlap >= 4 && titleSimilarity >= 0.38);
  const topical = sharedEvents >= 1 && rule.topicKeys.some((topic) =>
    eventKeys(`${left.title} ${right.title} ${left.content.slice(0, 250)} ${right.content.slice(0, 250)}`).includes(topic) ||
    left.source.topicTags.includes(topic) && right.source.topicTags.includes(topic));

  return { accepted: evidence && topical && score >= 0.44, score, ruleId: rule.id, signals };
}
