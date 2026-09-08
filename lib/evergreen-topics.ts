import { SYNTHESIS_SOURCES } from "@/lib/source-registry";
import type { SupportingItem } from "@/lib/source-material";

export type EvergreenCandidate = SupportingItem & { corroboration: SupportingItem[] };

function registeredSource(id: string) {
  const source = SYNTHESIS_SOURCES.find((entry) => entry.id === id);
  if (!source) throw new Error(`Evergreen source ${id} is not enabled by the permission registry.`);
  return source;
}

function topic(
  title: string,
  primarySourceId: string,
  primaryUrl: string,
  supportingSourceId: string,
  supportingUrl: string
): EvergreenCandidate {
  const primarySource = registeredSource(primarySourceId);
  const supportingSource = registeredSource(supportingSourceId);
  const context = `Official methodology material for an evergreen explainer about ${title}.`;
  const primary: SupportingItem = { title, content: context, url: primaryUrl, publishedAt: null, source: primarySource };
  const supporting: SupportingItem = { title, content: context, url: supportingUrl, publishedAt: null, source: supportingSource };
  return { ...primary, corroboration: [supporting] };
}

// These are curated methodology pairs, not generic prompts. Both pages are
// fetched and license-checked; a missing or changed page fails the candidate.
export const EVERGREEN_TOPICS: readonly EvergreenCandidate[] = [
  topic(
    "How consumer price inflation measures are constructed and interpreted",
    "bls-latest",
    "https://www.bls.gov/cpi/questions-and-answers.htm",
    "ons-release-calendar",
    "https://www.ons.gov.uk/economy/inflationandpriceindices/methodologies/consumerpriceinflationincludesall3indicescpihcpiandrpiqmi"
  ),
  topic(
    "How official employment and unemployment measures classify the labour force",
    "bls-latest",
    "https://www.bls.gov/cps/definitions.htm",
    "ons-release-calendar",
    "https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/methodologies/aguidetolabourmarketstatistics"
  ),
  topic(
    "How official agencies construct, revise, and interpret gross domestic product",
    "bea-news-releases",
    "https://www.bea.gov/resources/learning-center/what-to-know-gdp",
    "ons-release-calendar",
    "https://www.ons.gov.uk/economy/grossdomesticproductgdp/methodologies/grossdomesticproductgdpqmi"
  ),
  topic(
    "How labour productivity connects economic output with hours, workers, and jobs",
    "bls-latest",
    "https://www.bls.gov/opub/hom/msp/home.htm",
    "ons-release-calendar",
    "https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/labourproductivity/methodologies/labourproductivityqmi"
  ),
  topic(
    "How official statistics distinguish household income, spending, and saving",
    "bea-news-releases",
    "https://www.bea.gov/resources/learning-center/what-to-know-income-saving",
    "ons-release-calendar",
    "https://www.ons.gov.uk/economy/nationalaccounts/uksectoraccounts/methodologies/quarterlysectoraccountsqmi"
  ),
  topic(
    "How United States trade statistics measure imports, exports, deficits, and investment",
    "bea-news-releases",
    "https://www.bea.gov/resources/learning-center/what-to-know-international-trade-investment",
    "census-economic-indicators",
    "https://www.census.gov/foreign-trade/reference/definitions/index.html"
  ),
  topic(
    "How energy costs enter household price statistics and why electricity prices vary",
    "eia-today-in-energy",
    "https://www.eia.gov/energyexplained/electricity/prices-and-factors-affecting-prices.php",
    "bls-latest",
    "https://www.bls.gov/cpi/factsheets/household-energy.htm"
  ),
  topic(
    "How the United States reviews mergers for risks to competition",
    "ftc-press-releases",
    "https://www.ftc.gov/advice-guidance/competition-guidance/guide-antitrust-laws/mergers/premerger-notification-merger-review-process",
    "doj-news",
    "https://www.justice.gov/atr/merger-guidelines/overview"
  ),
  topic(
    "How FDA review and truth-in-advertising rules scrutinize health product claims",
    "fda-press-announcements",
    "https://www.fda.gov/patients/drug-development-process/step-4-fda-drug-review",
    "ftc-press-releases",
    "https://www.ftc.gov/business-guidance/resources/health-products-compliance-guidance"
  ),
  topic(
    "How civil and criminal authorities investigate securities misconduct",
    "sec-press-releases",
    "https://www.sec.gov/about/divisions-offices/division-enforcement/how-investigations-work",
    "doj-news",
    "https://www.justice.gov/fraud/about-national-fraud-enforcement-division"
  ),
  topic(
    "How federal market regulators investigate and enforce trading misconduct",
    "cftc-press-releases",
    "https://www.cftc.gov/LawRegulation/EnforcementActions/index.htm",
    "sec-press-releases",
    "https://www.sec.gov/about/divisions-offices/division-enforcement/how-investigations-work"
  ),
  topic(
    "How federal agencies enforce consumer financial protection laws",
    "cfpb-newsroom",
    "https://www.consumerfinance.gov/enforcement/life-cycle-of-enforcement-action/",
    "ftc-press-releases",
    "https://www.ftc.gov/news-events/topics/consumer-finance"
  ),
  topic(
    "How monetary policy connects interest rates with employment, output, and inflation data",
    "federal-reserve-press",
    "https://www.federalreserve.gov/monetarypolicy/monetary-policy-what-are-its-goals-how-does-it-work.htm",
    "bea-news-releases",
    "https://www.bea.gov/resources/learning-center/what-to-know-gdp"
  ),
  topic(
    "How European and United States consumer price statistics measure inflation",
    "eurostat-news-releases",
    "https://ec.europa.eu/eurostat/web/hicp/methodology",
    "bls-latest",
    "https://www.bls.gov/cpi/questions-and-answers.htm"
  ),
  topic(
    "How European and United Kingdom consumer price measures are constructed",
    "eurostat-news-releases",
    "https://ec.europa.eu/eurostat/web/hicp/information-data",
    "ons-release-calendar",
    "https://www.ons.gov.uk/economy/inflationandpriceindices/methodologies/consumerpriceinflationincludesall3indicescpihcpiandrpiqmi"
  ),
  topic(
    "How European and United States labour force statistics classify employment and unemployment",
    "eurostat-news-releases",
    "https://ec.europa.eu/eurostat/web/lfs/methodology",
    "bls-latest",
    "https://www.bls.gov/cps/definitions.htm"
  ),
  topic(
    "How European and United States national accounts construct gross domestic product",
    "eurostat-news-releases",
    "https://ec.europa.eu/eurostat/web/national-accounts/methodology/european-accounts/main-aggregates",
    "bea-news-releases",
    "https://www.bea.gov/resources/learning-center/what-to-know-gdp"
  ),
  topic(
    "How European and United States agencies measure international goods trade",
    "eurostat-news-releases",
    "https://ec.europa.eu/eurostat/web/international-trade-in-goods/methodology",
    "census-economic-indicators",
    "https://www.census.gov/foreign-trade/reference/definitions/index.html"
  ),
  topic(
    "How Canadian and United States consumer price statistics measure inflation",
    "statcan-daily",
    "https://www.statcan.gc.ca/en/subjects-start/prices_and_price_indexes/consumer_price_indexes/faq",
    "bls-latest",
    "https://www.bls.gov/cpi/questions-and-answers.htm"
  ),
  topic(
    "How Canadian and United States labour force surveys classify employment and unemployment",
    "statcan-daily",
    "https://www150.statcan.gc.ca/n1/pub/71-543-g/71-543-g2025001-eng.htm",
    "bls-latest",
    "https://www.bls.gov/cps/definitions.htm"
  ),
  topic(
    "How Canadian and United States national accounts construct gross domestic product",
    "statcan-daily",
    "https://www150.statcan.gc.ca/n1/pub/13-606-g/2016001/article/14618-eng.htm",
    "bea-news-releases",
    "https://www.bea.gov/resources/learning-center/what-to-know-gdp"
  ),
  topic(
    "How Canadian and United States agencies define international merchandise trade",
    "statcan-daily",
    "https://www150.statcan.gc.ca/n1/pub/71-607-x/2021004/concepts-eng.htm",
    "census-economic-indicators",
    "https://www.census.gov/foreign-trade/reference/definitions/index.html"
  ),
  topic(
    "How European and United States agencies measure electricity and natural gas prices",
    "eurostat-news-releases",
    "https://ec.europa.eu/eurostat/web/energy/methodology",
    "eia-today-in-energy",
    "https://www.eia.gov/energyexplained/electricity/prices-and-factors-affecting-prices.php"
  ),
  topic(
    "How Canadian and United States official statistics define and measure residential property",
    "statcan-daily",
    "https://www23.statcan.gc.ca/imdb/p2SV.pl?Function=getSurvey&SDDS=5257",
    "census-news-releases",
    "https://www.census.gov/housing/hvs/methodology/index.html"
  ),
  topic(
    "How European and United States agencies construct industrial production indicators",
    "eurostat-news-releases",
    "https://ec.europa.eu/eurostat/web/short-term-business-statistics/methodology",
    "census-economic-indicators",
    "https://www.census.gov/manufacturing/m3/how_the_data_are_collected/index.html"
  ),
  topic(
    "How European and United States statistics distinguish household income and disposable resources",
    "eurostat-news-releases",
    "https://ec.europa.eu/eurostat/web/income-and-living-conditions/methodology",
    "bea-news-releases",
    "https://www.bea.gov/resources/learning-center/what-to-know-income-saving"
  ),
  topic(
    "How Canadian and United States agencies compile official energy supply and use statistics",
    "statcan-daily",
    "https://www.statcan.gc.ca/en/our-data/data-sources/energy",
    "eia-today-in-energy",
    "https://www.eia.gov/energyexplained/us-energy-facts/"
  ),
];
