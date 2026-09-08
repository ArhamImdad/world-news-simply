export type ReleaseSeriesId =
  | "consumer-prices" | "producer-prices" | "labour-force" | "labour-productivity"
  | "gross-domestic-product" | "international-trade" | "household-income-spending"
  | "retail-sales" | "industrial-production" | "energy-prices";

type SeriesRule = { sourceId: string; seriesId: ReleaseSeriesId; pattern: RegExp; cadence: "monthly" | "quarterly" };

// Explicit publisher-specific mappings only. These identify comparable release
// families for discovery; they never bypass source depth or evidence gates.
const rules: readonly SeriesRule[] = [
  { sourceId: "bls-latest", seriesId: "consumer-prices", pattern: /consumer price index|\bcpi\b/i, cadence: "monthly" },
  { sourceId: "ons-release-calendar", seriesId: "consumer-prices", pattern: /consumer price inflation/i, cadence: "monthly" },
  { sourceId: "eurostat-news-releases", seriesId: "consumer-prices", pattern: /annual inflation|consumer prices|\bhicp\b/i, cadence: "monthly" },
  { sourceId: "statcan-daily", seriesId: "consumer-prices", pattern: /^consumer price index\b/i, cadence: "monthly" },
  { sourceId: "abs-latest-releases", seriesId: "consumer-prices", pattern: /consumer price index|\bcpi (?:rose|fell|increased|decreased)\b/i, cadence: "monthly" },

  { sourceId: "bls-latest", seriesId: "producer-prices", pattern: /producer price index|\bppi\b/i, cadence: "monthly" },
  { sourceId: "ons-release-calendar", seriesId: "producer-prices", pattern: /producer price inflation/i, cadence: "monthly" },
  { sourceId: "eurostat-news-releases", seriesId: "producer-prices", pattern: /industrial producer prices/i, cadence: "monthly" },
  { sourceId: "statcan-daily", seriesId: "producer-prices", pattern: /industrial product and raw materials price indexes/i, cadence: "monthly" },

  { sourceId: "bls-latest", seriesId: "labour-force", pattern: /employment situation/i, cadence: "monthly" },
  { sourceId: "ons-release-calendar", seriesId: "labour-force", pattern: /labour market(?: overview| statistics| in the uk)?/i, cadence: "monthly" },
  { sourceId: "eurostat-news-releases", seriesId: "labour-force", pattern: /(?:euro area|eu).*unemployment|unemployment.*(?:euro area|eu)/i, cadence: "monthly" },
  { sourceId: "statcan-daily", seriesId: "labour-force", pattern: /^labour force survey\b/i, cadence: "monthly" },
  { sourceId: "abs-latest-releases", seriesId: "labour-force", pattern: /labour force, australia|unemployment rate (?:rises|falls|remains)/i, cadence: "monthly" },

  { sourceId: "bls-latest", seriesId: "labour-productivity", pattern: /productivity and costs/i, cadence: "quarterly" },
  { sourceId: "ons-release-calendar", seriesId: "labour-productivity", pattern: /productivity flash estimate and overview/i, cadence: "quarterly" },

  { sourceId: "bea-news-releases", seriesId: "gross-domestic-product", pattern: /\bgdp\b|gross domestic product/i, cadence: "quarterly" },
  { sourceId: "ons-release-calendar", seriesId: "gross-domestic-product", pattern: /^(?!.*monthly estimate).*?(?:\bgdp\b|gross domestic product)/i, cadence: "quarterly" },
  { sourceId: "eurostat-news-releases", seriesId: "gross-domestic-product", pattern: /\bgdp\b|gross domestic product/i, cadence: "quarterly" },
  { sourceId: "statcan-daily", seriesId: "gross-domestic-product", pattern: /gross domestic product/i, cadence: "quarterly" },
  { sourceId: "abs-latest-releases", seriesId: "gross-domestic-product", pattern: /australian national accounts|australian economy (?:grew|contracted)/i, cadence: "quarterly" },

  { sourceId: "census-economic-indicators", seriesId: "international-trade", pattern: /international trade in goods and services/i, cadence: "monthly" },
  { sourceId: "bea-news-releases", seriesId: "international-trade", pattern: /international trade in goods and services/i, cadence: "monthly" },
  { sourceId: "ons-release-calendar", seriesId: "international-trade", pattern: /\buk trade\b/i, cadence: "monthly" },
  { sourceId: "eurostat-news-releases", seriesId: "international-trade", pattern: /international trade in goods|trade in goods (?:surplus|deficit)/i, cadence: "monthly" },
  { sourceId: "statcan-daily", seriesId: "international-trade", pattern: /canadian international merchandise trade/i, cadence: "monthly" },
  { sourceId: "abs-latest-releases", seriesId: "international-trade", pattern: /international trade in goods and services|balance on goods/i, cadence: "monthly" },

  { sourceId: "bea-news-releases", seriesId: "household-income-spending", pattern: /personal income and outlays/i, cadence: "monthly" },
  { sourceId: "ons-release-calendar", seriesId: "household-income-spending", pattern: /household income/i, cadence: "monthly" },
  { sourceId: "eurostat-news-releases", seriesId: "household-income-spending", pattern: /household (?:income|saving)/i, cadence: "quarterly" },
  { sourceId: "statcan-daily", seriesId: "household-income-spending", pattern: /household income/i, cadence: "monthly" },
  { sourceId: "abs-latest-releases", seriesId: "household-income-spending", pattern: /monthly household spending|household spending (?:up|down)/i, cadence: "monthly" },

  { sourceId: "ons-release-calendar", seriesId: "retail-sales", pattern: /retail sales/i, cadence: "monthly" },
  { sourceId: "eurostat-news-releases", seriesId: "retail-sales", pattern: /retail trade/i, cadence: "monthly" },
  { sourceId: "statcan-daily", seriesId: "retail-sales", pattern: /^retail trade\b/i, cadence: "monthly" },
  { sourceId: "abs-latest-releases", seriesId: "retail-sales", pattern: /retail trade, australia/i, cadence: "monthly" },

  { sourceId: "ons-release-calendar", seriesId: "industrial-production", pattern: /index of production|production output/i, cadence: "monthly" },
  { sourceId: "eurostat-news-releases", seriesId: "industrial-production", pattern: /industrial production/i, cadence: "monthly" },
  { sourceId: "statcan-daily", seriesId: "industrial-production", pattern: /monthly survey of manufacturing/i, cadence: "monthly" },

  { sourceId: "eia-today-in-energy", seriesId: "energy-prices", pattern: /electricity|natural gas|gasoline|energy prices/i, cadence: "monthly" },
  { sourceId: "eurostat-news-releases", seriesId: "energy-prices", pattern: /electricity prices|natural gas prices|energy prices/i, cadence: "monthly" },
  { sourceId: "statcan-daily", seriesId: "energy-prices", pattern: /natural gas supply|refined petroleum products/i, cadence: "monthly" },
];

const months: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export type NormalizedReleasePeriod = { key: string; cadence: "monthly" | "quarterly"; year: number };

export function publishedMonthPeriodHint(title: string, publishedAt?: string | null) {
  if (/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d{2}\b/i.test(title) ||
      !publishedAt) return null;
  const month = title.toLowerCase().match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i)?.[1];
  if (!month) return null;
  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) return null;
  const referenceMonth = months[month.toLowerCase()];
  const publicationMonth = published.getUTCMonth() + 1;
  const lag = (publicationMonth - referenceMonth + 12) % 12;
  if (lag > 2) return null;
  const year = referenceMonth > publicationMonth ? published.getUTCFullYear() - 1 : published.getUTCFullYear();
  return `${month} ${year}`;
}

export function normalizeReleasePeriod(value: string): NormalizedReleasePeriod | null {
  const normalized = value.toLowerCase().replace(/[–—]/g, "-");
  const range = normalized.match(/\b(january to march|april to june|july to september|october to december)\s+(20\d{2})\b/i);
  if (range) {
    const q = range[1].startsWith("january") ? 1 : range[1].startsWith("april") ? 2
      : range[1].startsWith("july") ? 3 : 4;
    const year = Number(range[2]);
    return { key: `${year}-Q${q}`, cadence: "quarterly", year };
  }
  const quarter = normalized.match(/\b(?:q([1-4])|(?:first|1st|january to march|march) quarter|(?:second|2nd|april to june|june) quarter|(?:third|3rd|july to september|september) quarter|(?:fourth|4th|october to december|december) quarter)\D{0,18}(20\d{2})\b/i);
  if (quarter) {
    const phrase = quarter[0];
    const q = Number(quarter[1] ?? (/first|1st|january|march/.test(phrase) ? 1 : /second|2nd|april|june/.test(phrase) ? 2 : /third|3rd|july|september/.test(phrase) ? 3 : 4));
    const year = Number(quarter[2]);
    return { key: `${year}-Q${q}`, cadence: "quarterly", year };
  }
  const month = normalized.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\b/i);
  if (!month) return null;
  const year = Number(month[2]);
  return { key: `${year}-${String(months[month[1].toLowerCase()]).padStart(2, "0")}`, cadence: "monthly", year };
}

export function identifyReleaseSeries(sourceId: string, title: string, periodContext = title) {
  const match = rules.find((rule) => rule.sourceId === sourceId && rule.pattern.test(title));
  if (!match) return null;
  return { seriesId: match.seriesId, cadence: match.cadence, period: normalizeReleasePeriod(periodContext) };
}

export function recurringReleaseMatch(
  left: { sourceId: string; title: string; periodContext?: string; publishedAt?: string | null },
  right: { sourceId: string; title: string; periodContext?: string; publishedAt?: string | null },
) {
  const leftContext = `${left.periodContext ?? left.title} ${publishedMonthPeriodHint(left.title, left.publishedAt) ?? ""}`;
  const rightContext = `${right.periodContext ?? right.title} ${publishedMonthPeriodHint(right.title, right.publishedAt) ?? ""}`;
  const a = identifyReleaseSeries(left.sourceId, left.title, leftContext);
  const b = identifyReleaseSeries(right.sourceId, right.title, rightContext);
  if (!a || !b || a.seriesId !== b.seriesId || !a.period || !b.period || a.period.key !== b.period.key) return null;
  return { seriesId: a.seriesId, period: a.period.key, cadence: a.cadence,
    comparisonClassification: "comparable-with-definition-methodology-caveat" as const };
}

export function releaseIdentityKey(input: {
  sourceId: string; title: string; periodContext?: string; publishedAt?: string | null;
}) {
  const context = `${input.periodContext ?? input.title} ${publishedMonthPeriodHint(input.title, input.publishedAt) ?? ""}`;
  const release = identifyReleaseSeries(input.sourceId, input.title, context);
  return release?.period ? `${release.seriesId}:${release.period.key}` : null;
}

export function classifyReleaseSupply(
  primary: { sourceId: string; title: string; periodContext?: string; publishedAt?: string | null },
  partners: Array<{ sourceId: string; title: string; periodContext?: string; publishedAt?: string | null }>,
  evergreen = false,
) {
  if (evergreen) return { supplyClass: "evergreen" as const, releaseSeries: null,
    releasePeriod: null, recurringCadence: null, comparisonClassification: null };
  const primaryContext = `${primary.periodContext ?? primary.title} ${publishedMonthPeriodHint(primary.title, primary.publishedAt) ?? ""}`;
  const release = identifyReleaseSeries(primary.sourceId, primary.title, primaryContext);
  const explicit = partners.some((partner) => recurringReleaseMatch(primary, partner));
  return explicit && release?.period ? { supplyClass: "recurring-current" as const,
    releaseSeries: release.seriesId, releasePeriod: release.period.key, recurringCadence: release.cadence,
    comparisonClassification: "comparable-with-definition-methodology-caveat" as const }
    : { supplyClass: "occasional-current" as const, releaseSeries: release?.seriesId ?? null,
      releasePeriod: release?.period?.key ?? null, recurringCadence: release?.cadence ?? null,
      comparisonClassification: null };
}
