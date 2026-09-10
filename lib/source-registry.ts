export type LicenseType = "public-domain-us" | "ogl-3.0" | "cc-by-4.0" | "cc-by" | "cc0" | "licensed-api" | "unknown";
export type SourceType = "government-statistics" | "government-news" | "government-press-release" | "regulatory-filing" | "court-decision" | "official-dataset" | "licensed-feed" | "publisher-rss";
export type ContentPool = "breaking" | "government-records" | "economic-data" | "evergreen";

export type SourceRegistryEntry = {
  id: string;
  publisher: string;
  domain: string;
  feedApiUrl: string;
  commercialUseAllowed: boolean;
  aiProcessingAllowed: boolean;
  transformationAllowed: boolean;
  attributionRequired: boolean;
  licenseType: LicenseType;
  sourceType: SourceType;
  notes: string;
  categoryHint: string;
  regionHint?: string;
  articleTypeHint?: "news" | "opinion" | "long-read" | "video";
  isBreakingHint?: boolean;
  discoveryAllowed: boolean;
  synthesisEnabled: boolean;
  contentFetchAllowed: boolean;
  reliability: number;
  maxSourceCharacters: number;
  allowedArticleDomains: string[];
  requiredLicenseMarker?: RegExp;
  permissionUrl: string;
  permissionReviewedAt: string;
  contentPool: ContentPool;
  freshnessClass: "BREAKING" | "CURRENT" | "ANALYSIS" | "EVERGREEN";
  freshnessHours: number;
  topicTags: string[];
  updateFrequency: string;
  articleDepth: "thin" | "moderate" | "deep";
  discoveryFormat?: "rss" | "abs-release-index";
  additionalDiscoveryUrls?: readonly string[];
  currentDiscoveryLimit?: number;
};

const restricted = (
  id: string,
  publisher: string,
  domain: string,
  feedApiUrl: string,
  categoryHint: string,
  regionHint: string,
  articleTypeHint?: SourceRegistryEntry["articleTypeHint"]
): SourceRegistryEntry => ({
  id, publisher, domain, feedApiUrl, categoryHint, regionHint, articleTypeHint,
  commercialUseAllowed: false,
  aiProcessingAllowed: false,
  transformationAllowed: false,
  attributionRequired: true,
  licenseType: "unknown",
  sourceType: "publisher-rss",
  notes: "Discovery-only registry record. Automated use is disabled until written commercial and AI-processing permission is documented.",
  discoveryAllowed: false,
  synthesisEnabled: false,
  contentFetchAllowed: false,
  reliability: 0,
  maxSourceCharacters: 0,
  allowedArticleDomains: [domain],
  permissionUrl: "",
  permissionReviewedAt: "",
  contentPool: "breaking",
  freshnessClass: "CURRENT",
  freshnessHours: 24,
  topicTags: [],
  updateFrequency: "unknown",
  articleDepth: "thin",
});

export const SOURCE_REGISTRY: readonly SourceRegistryEntry[] = [
  {
    id: "bls-latest", publisher: "U.S. Bureau of Labor Statistics", domain: "bls.gov",
    feedApiUrl: "https://www.bls.gov/feed/bls_latest.rss", categoryHint: "Business", regionHint: "Americas",
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    attributionRequired: true, licenseType: "public-domain-us", sourceType: "government-statistics",
    notes: "BLS-published textual material is public domain. Third-party photographs and illustrations are excluded and are never ingested.",
    discoveryAllowed: true, synthesisEnabled: true, contentFetchAllowed: true, reliability: 98,
    maxSourceCharacters: 4500, allowedArticleDomains: ["bls.gov"],
    permissionUrl: "https://www.bls.gov/bls/linksite.htm", permissionReviewedAt: "2026-08-13",
    contentPool: "economic-data", freshnessClass: "ANALYSIS", freshnessHours: 744,
    topicTags: ["employment", "unemployment", "inflation", "prices", "wages", "productivity"],
    updateFrequency: "several releases per week", articleDepth: "deep", currentDiscoveryLimit: 30,
    additionalDiscoveryUrls: [
      "https://www.bls.gov/feed/cpi.rss", "https://www.bls.gov/feed/empsit.rss",
      "https://www.bls.gov/feed/ppi.rss", "https://www.bls.gov/feed/prod2.rss",
    ],
  },
  {
    id: "govuk-news", publisher: "UK Government", domain: "gov.uk",
    feedApiUrl: "https://www.gov.uk/search/news-and-communications.atom", categoryHint: "World", regionHint: "Europe",
    additionalDiscoveryUrls: [
      "https://www.gov.uk/search/news-and-communications.atom?keywords=sport",
      "https://www.gov.uk/search/news-and-communications.atom?keywords=artificial+intelligence",
      "https://www.gov.uk/search/news-and-communications.atom?keywords=science",
      "https://www.gov.uk/search/news-and-communications.atom?keywords=health",
      "https://www.gov.uk/search/news-and-communications.atom?keywords=election",
    ],
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    attributionRequired: true, licenseType: "ogl-3.0", sourceType: "government-news",
    notes: "Only GOV.UK pages that expose the Open Government Licence marker are eligible. Item-level exceptions fail closed.",
    discoveryAllowed: true, synthesisEnabled: true, contentFetchAllowed: true, reliability: 96,
    maxSourceCharacters: 4500, allowedArticleDomains: ["gov.uk"],
    requiredLicenseMarker: /Open Government Licence v3\.0/i,
    permissionUrl: "https://www.gov.uk/help/terms-conditions", permissionReviewedAt: "2026-08-13",
    contentPool: "government-records", freshnessClass: "CURRENT", freshnessHours: 72,
    topicTags: ["government", "policy", "regulation", "economy", "health", "science"],
    updateFrequency: "multiple releases daily", articleDepth: "moderate",
  },
  {
    id: "sec-press-releases", publisher: "U.S. Securities and Exchange Commission", domain: "sec.gov",
    feedApiUrl: "https://www.sec.gov/news/pressreleases.rss", categoryHint: "Business", regionHint: "Americas",
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    attributionRequired: true, licenseType: "public-domain-us", sourceType: "government-press-release",
    notes: "SEC says government-created SEC.gov content is free to access and reuse. Text only; seals, logos, art, and third-party exhibits are excluded.",
    discoveryAllowed: true, synthesisEnabled: true, contentFetchAllowed: true, reliability: 98,
    maxSourceCharacters: 4500, allowedArticleDomains: ["sec.gov"],
    permissionUrl: "https://www.sec.gov/about/webmaster-frequently-asked-questions", permissionReviewedAt: "2026-08-13",
    contentPool: "government-records", freshnessClass: "CURRENT", freshnessHours: 336,
    topicTags: ["securities", "fraud", "enforcement", "markets", "filings", "investment"],
    updateFrequency: "several releases per week", articleDepth: "deep",
  },
  {
    id: "census-economic-indicators", publisher: "U.S. Census Bureau", domain: "census.gov",
    feedApiUrl: "https://www.census.gov/economic-indicators/indicator.xml", categoryHint: "Economy", regionHint: "Americas",
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    attributionRequired: true, licenseType: "public-domain-us", sourceType: "government-statistics",
    notes: "U.S. government-authored Census text and data are public domain. The pipeline excludes photographs, logos, and credited third-party material.",
    discoveryAllowed: true, synthesisEnabled: true, contentFetchAllowed: true, reliability: 98,
    maxSourceCharacters: 4500, allowedArticleDomains: ["census.gov"],
    permissionUrl: "https://www2.census.gov/foia/ds_policies/ds027.pdf", permissionReviewedAt: "2026-08-13",
    contentPool: "economic-data", freshnessClass: "ANALYSIS", freshnessHours: 744,
    topicTags: ["trade", "retail", "construction", "manufacturing", "services", "population"],
    updateFrequency: "several indicators per week", articleDepth: "moderate", currentDiscoveryLimit: 20,
  },
  {
    id: "census-news-releases", publisher: "U.S. Census Bureau", domain: "census.gov",
    feedApiUrl: "https://www.census.gov/content/census/en/newsroom/press-releases.xml", categoryHint: "World", regionHint: "Americas",
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    attributionRequired: true, licenseType: "public-domain-us", sourceType: "government-press-release",
    notes: "Official Census releases; text only. Third-party material, photographs, and marks are not ingested.",
    discoveryAllowed: true, synthesisEnabled: true, contentFetchAllowed: true, reliability: 97,
    maxSourceCharacters: 4500, allowedArticleDomains: ["census.gov"],
    permissionUrl: "https://www2.census.gov/foia/ds_policies/ds027.pdf", permissionReviewedAt: "2026-08-13",
    contentPool: "government-records", freshnessClass: "CURRENT", freshnessHours: 336,
    topicTags: ["population", "demographics", "business", "housing", "survey", "government"],
    updateFrequency: "several releases per week", articleDepth: "moderate",
  },
  {
    id: "ons-release-calendar", publisher: "Office for National Statistics", domain: "ons.gov.uk",
    feedApiUrl: "https://www.ons.gov.uk/releasecalendar?highlight=true&limit=50&page=1&release-type=type-published&rss=&sort=date-newest",
    categoryHint: "Economy", regionHint: "Europe",
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    attributionRequired: true, licenseType: "ogl-3.0", sourceType: "government-statistics",
    notes: "ONS publishes most site content and its feeds under OGL 3.0. Only pages carrying the OGL footer are eligible; media exceptions are excluded.",
    discoveryAllowed: true, synthesisEnabled: true, contentFetchAllowed: true, reliability: 98,
    maxSourceCharacters: 4500, allowedArticleDomains: ["ons.gov.uk"], requiredLicenseMarker: /Open Government Licence v3\.0/i,
    permissionUrl: "https://www.ons.gov.uk/help/terms-conditions", permissionReviewedAt: "2026-08-13",
    contentPool: "economic-data", freshnessClass: "ANALYSIS", freshnessHours: 744,
    topicTags: ["employment", "unemployment", "inflation", "prices", "trade", "gdp", "population", "productivity"],
    updateFrequency: "multiple releases per week", articleDepth: "deep", currentDiscoveryLimit: 50,
  },
  {
    id: "nasa-news-releases", publisher: "NASA", domain: "nasa.gov",
    feedApiUrl: "https://www.nasa.gov/news-release/feed/", categoryHint: "Science", regionHint: "Global",
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    attributionRequired: true, licenseType: "public-domain-us", sourceType: "government-press-release",
    notes: "Official NASA news text only. The pipeline excludes images, insignia, identifiable-person publicity uses, and marked third-party content.",
    discoveryAllowed: true, synthesisEnabled: true, contentFetchAllowed: true, reliability: 97,
    maxSourceCharacters: 4500, allowedArticleDomains: ["nasa.gov", "science.nasa.gov"],
    permissionUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/", permissionReviewedAt: "2026-08-13",
    contentPool: "government-records", freshnessClass: "CURRENT", freshnessHours: 336,
    topicTags: ["space", "earth", "climate", "aviation", "satellite", "mission", "science"],
    updateFrequency: "multiple items daily", articleDepth: "deep",
  },
  {
    id: "eia-today-in-energy", publisher: "U.S. Energy Information Administration", domain: "eia.gov",
    feedApiUrl: "https://www.eia.gov/rss/todayinenergy.xml", categoryHint: "Economy", regionHint: "Americas",
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    attributionRequired: true, licenseType: "public-domain-us", sourceType: "government-statistics",
    notes: "Today in Energy text is public domain unless a page says otherwise. Only textual article material is ingested; charts, marks, and identified third-party material are excluded.",
    discoveryAllowed: true, synthesisEnabled: true, contentFetchAllowed: true, reliability: 98,
    maxSourceCharacters: 8000, allowedArticleDomains: ["eia.gov"],
    permissionUrl: "https://www.eia.gov/about/copyrights_reuse.php", permissionReviewedAt: "2026-08-21",
    contentPool: "economic-data", freshnessClass: "ANALYSIS", freshnessHours: 744,
    topicTags: ["energy", "oil", "gas", "electricity", "prices", "production", "trade", "climate"],
    updateFrequency: "several articles per week", articleDepth: "deep",
  },
  {
    id: "bea-news-releases", publisher: "U.S. Bureau of Economic Analysis", domain: "bea.gov",
    feedApiUrl: "https://apps.bea.gov/rss/rss.xml", categoryHint: "Economy", regionHint: "Americas",
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    attributionRequired: true, licenseType: "public-domain-us", sourceType: "government-statistics",
    notes: "BEA states that, unless otherwise noted, its site information is public domain and may be used and reproduced. The pipeline ingests release text only and excludes marked third-party content.",
    discoveryAllowed: true, synthesisEnabled: true, contentFetchAllowed: true, reliability: 99,
    maxSourceCharacters: 8000, allowedArticleDomains: ["bea.gov"],
    permissionUrl: "https://www.bea.gov/help/faq/147", permissionReviewedAt: "2026-08-21",
    contentPool: "economic-data", freshnessClass: "ANALYSIS", freshnessHours: 744,
    topicTags: ["gdp", "income", "spending", "trade", "inflation", "investment", "industry"],
    updateFrequency: "scheduled several times per month", articleDepth: "deep", currentDiscoveryLimit: 20,
  },
  {
    id: "federal-reserve-press", publisher: "Federal Reserve Board", domain: "federalreserve.gov",
    feedApiUrl: "https://www.federalreserve.gov/feeds/press_all.xml", categoryHint: "Business", regionHint: "Americas",
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    attributionRequired: true, licenseType: "public-domain-us", sourceType: "government-press-release",
    notes: "Board-authored website information is public domain unless indicated otherwise. Text only; seals, models, visualizations, and identified non-Board material are excluded.",
    discoveryAllowed: true, synthesisEnabled: true, contentFetchAllowed: true, reliability: 99,
    maxSourceCharacters: 8000, allowedArticleDomains: ["federalreserve.gov"],
    permissionUrl: "https://www.federalreserve.gov/disclaimer.htm", permissionReviewedAt: "2026-08-21",
    contentPool: "government-records", freshnessClass: "CURRENT", freshnessHours: 336,
    topicTags: ["banking", "monetary-policy", "interest-rates", "enforcement", "payments", "economy"],
    updateFrequency: "several releases per week", articleDepth: "moderate",
  },
  {
    id: "fda-press-announcements", publisher: "U.S. Food and Drug Administration", domain: "fda.gov",
    feedApiUrl: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml",
    categoryHint: "Health", regionHint: "Americas",
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    attributionRequired: true, licenseType: "public-domain-us", sourceType: "government-press-release",
    notes: "FDA states its website text is public domain unless otherwise noted and may be republished or otherwise used freely. The pipeline excludes graphics and marked third-party material.",
    discoveryAllowed: true, synthesisEnabled: true, contentFetchAllowed: true, reliability: 98,
    maxSourceCharacters: 8000, allowedArticleDomains: ["fda.gov"],
    permissionUrl: "https://www.fda.gov/about-fda/about-website/website-policies", permissionReviewedAt: "2026-08-21",
    contentPool: "government-records", freshnessClass: "CURRENT", freshnessHours: 336,
    topicTags: ["health", "drug", "device", "approval", "authorization", "recall", "food", "regulation"],
    updateFrequency: "several releases per week", articleDepth: "deep",
  },
  {
    id: "ftc-press-releases", publisher: "Federal Trade Commission", domain: "ftc.gov",
    feedApiUrl: "https://www.ftc.gov/feeds/press-release.xml", categoryHint: "Business", regionHint: "Americas",
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    attributionRequired: true, licenseType: "public-domain-us", sourceType: "government-press-release",
    notes: "FTC says most site material is U.S. Government work in the public domain. Only FTC-authored release text is ingested; exhibits, filings, graphics, seals, and marked third-party work are excluded.",
    discoveryAllowed: true, synthesisEnabled: true, contentFetchAllowed: true, reliability: 98,
    maxSourceCharacters: 8000, allowedArticleDomains: ["ftc.gov"],
    permissionUrl: "https://www.ftc.gov/policy-notices/website-policy", permissionReviewedAt: "2026-08-21",
    contentPool: "government-records", freshnessClass: "CURRENT", freshnessHours: 336,
    topicTags: ["competition", "consumer-protection", "fraud", "enforcement", "merger", "pricing", "privacy"],
    updateFrequency: "several releases per week", articleDepth: "deep",
  },
  {
    id: "cftc-press-releases", publisher: "Commodity Futures Trading Commission", domain: "cftc.gov",
    feedApiUrl: "https://www.cftc.gov/RSS/RSSGP/rssgp.xml", categoryHint: "Business", regionHint: "Americas",
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    attributionRequired: true, licenseType: "public-domain-us", sourceType: "government-press-release",
    notes: "Only CFTC-authored press-release text is eligible. Private-party documents, filings, illustrations, photographs, the CFTC seal, and other credited or licensed material are excluded.",
    discoveryAllowed: true, synthesisEnabled: true, contentFetchAllowed: true, reliability: 98,
    maxSourceCharacters: 8000, allowedArticleDomains: ["cftc.gov"],
    permissionUrl: "https://www.cftc.gov/WebPolicy/index.htm", permissionReviewedAt: "2026-08-26",
    contentPool: "government-records", freshnessClass: "CURRENT", freshnessHours: 336,
    topicTags: ["commodities", "derivatives", "markets", "fraud", "enforcement", "digital-assets", "trading"],
    updateFrequency: "several releases per week", articleDepth: "deep",
  },
  {
    id: "cfpb-newsroom", publisher: "Consumer Financial Protection Bureau", domain: "consumerfinance.gov",
    feedApiUrl: "https://www.consumerfinance.gov/about-us/newsroom/feed/", categoryHint: "Business", regionHint: "Americas",
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    attributionRequired: true, licenseType: "public-domain-us", sourceType: "government-press-release",
    notes: "Only CFPB-created newsroom text is eligible. External copyrighted material, linked documents not authored by CFPB, logos, trademarks, images, and other credited third-party material are excluded.",
    discoveryAllowed: true, synthesisEnabled: true, contentFetchAllowed: true, reliability: 98,
    maxSourceCharacters: 8000, allowedArticleDomains: ["consumerfinance.gov"],
    permissionUrl: "https://www.consumerfinance.gov/privacy/website-privacy-policy/", permissionReviewedAt: "2026-08-26",
    contentPool: "government-records", freshnessClass: "CURRENT", freshnessHours: 336,
    topicTags: ["consumer-protection", "banking", "credit", "debt", "payments", "fraud", "enforcement", "privacy"],
    updateFrequency: "several releases per month", articleDepth: "deep",
  },
  {
    id: "eurostat-news-releases", publisher: "Eurostat", domain: "ec.europa.eu",
    feedApiUrl: "https://ec.europa.eu/eurostat/en/search?_estatsearchportlet_WAR_estatsearchportlet_collection=CAT_PREREL&p_p_id=estatsearchportlet_WAR_estatsearchportlet&p_p_lifecycle=2&p_p_mode=view&p_p_resource_id=atom&p_p_state=maximized",
    categoryHint: "Economy", regionHint: "Europe",
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    attributionRequired: true, licenseType: "cc-by-4.0", sourceType: "government-statistics",
    notes: "Eurostat editorial content is reusable under CC BY 4.0 and Eurostat data may be reused commercially with attribution and disclosure of changes. Only Eurostat-authored text and data are eligible; logos, trademarks, photographs, co-publications, and credited third-party material are excluded.",
    discoveryAllowed: true, synthesisEnabled: true, contentFetchAllowed: true, reliability: 98,
    maxSourceCharacters: 6000, allowedArticleDomains: ["ec.europa.eu"],
    permissionUrl: "https://ec.europa.eu/eurostat/help/copyright-notice", permissionReviewedAt: "2026-08-26",
    contentPool: "economic-data", freshnessClass: "ANALYSIS", freshnessHours: 744,
    topicTags: ["employment", "unemployment", "inflation", "prices", "trade", "gdp", "production", "population", "energy"],
    updateFrequency: "several statistical releases per week", articleDepth: "deep", currentDiscoveryLimit: 30,
  },
  {
    id: "statcan-daily", publisher: "Statistics Canada", domain: "statcan.gc.ca",
    feedApiUrl: "https://www150.statcan.gc.ca/n1/rss/dai-quo/0-eng.atom", categoryHint: "Economy", regionHint: "Americas",
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    attributionRequired: true, licenseType: "licensed-api", sourceType: "government-statistics",
    notes: "The Statistics Canada Open Licence permits commercial reproduction, distribution, and value-added products with attribution. Only Statistics Canada-authored information is eligible; symbols, logos, trademarks, photographs, and identified third-party material are excluded.",
    discoveryAllowed: true, synthesisEnabled: true, contentFetchAllowed: true, reliability: 98,
    maxSourceCharacters: 6000, allowedArticleDomains: ["statcan.gc.ca"],
    permissionUrl: "https://www.statcan.gc.ca/en/terms-conditions/open-licence", permissionReviewedAt: "2026-08-26",
    contentPool: "economic-data", freshnessClass: "ANALYSIS", freshnessHours: 744,
    topicTags: ["employment", "unemployment", "inflation", "prices", "trade", "gdp", "income", "housing", "population", "energy"],
    updateFrequency: "multiple releases each business day", articleDepth: "deep", currentDiscoveryLimit: 30,
  },
  {
    id: "abs-latest-releases", publisher: "Australian Bureau of Statistics", domain: "abs.gov.au",
    feedApiUrl: "https://www.abs.gov.au/release-calendar/latest-releases?page=0", categoryHint: "Economy", regionHint: "Oceania",
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    attributionRequired: true, licenseType: "cc-by-4.0", sourceType: "government-statistics",
    notes: "ABS website material is CC BY 4.0. Only ABS-authored statistical release text is eligible; the coat of arms, ABS logo, trade marks, microdata, sub-brands, Census artwork, other artwork, and identified third-party material are excluded.",
    discoveryAllowed: true, synthesisEnabled: true, contentFetchAllowed: true, reliability: 98,
    maxSourceCharacters: 6000, allowedArticleDomains: ["abs.gov.au"],
    permissionUrl: "https://www.abs.gov.au/website-privacy-copyright-and-disclaimer", permissionReviewedAt: "2026-08-26",
    contentPool: "economic-data", freshnessClass: "ANALYSIS", freshnessHours: 744,
    topicTags: ["employment", "unemployment", "inflation", "prices", "trade", "gdp", "income", "wages", "construction", "population"],
    updateFrequency: "multiple statistical releases per week", articleDepth: "deep", discoveryFormat: "abs-release-index",
    currentDiscoveryLimit: 60, additionalDiscoveryUrls: [
      "https://www.abs.gov.au/release-calendar/latest-releases?page=1",
      "https://www.abs.gov.au/release-calendar/latest-releases?page=2",
    ],
  },
  {
    id: "doj-news", publisher: "U.S. Department of Justice", domain: "justice.gov",
    feedApiUrl: "https://www.justice.gov/news/rss", categoryHint: "World", regionHint: "Americas",
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    attributionRequired: true, licenseType: "public-domain-us", sourceType: "government-press-release",
    notes: "DOJ website information is public domain unless otherwise indicated. Only DOJ-authored release text is ingested; seals, images, attachments, and attributed third-party material are excluded.",
    discoveryAllowed: true, synthesisEnabled: true, contentFetchAllowed: true, reliability: 98,
    maxSourceCharacters: 8000, allowedArticleDomains: ["justice.gov"],
    permissionUrl: "https://www.justice.gov/legalpolicies", permissionReviewedAt: "2026-08-21",
    contentPool: "government-records", freshnessClass: "CURRENT", freshnessHours: 336,
    topicTags: ["justice", "fraud", "enforcement", "antitrust", "crime", "health", "securities"],
    updateFrequency: "multiple releases daily", articleDepth: "deep",
  },
  {
    id: "noaa-nhc-atlantic", publisher: "NOAA National Hurricane Center", domain: "nhc.noaa.gov",
    feedApiUrl: "https://www.nhc.noaa.gov/index-at.xml", categoryHint: "Science", regionHint: "Americas",
    commercialUseAllowed: true, aiProcessingAllowed: true, transformationAllowed: true,
    attributionRequired: true, licenseType: "public-domain-us", sourceType: "government-news",
    notes: "NWS states that information on its government servers is public domain unless annotated otherwise. Only official NHC text products are ingested; graphics and external material are excluded.",
    discoveryAllowed: true, synthesisEnabled: true, contentFetchAllowed: true, reliability: 99,
    maxSourceCharacters: 8000, allowedArticleDomains: ["nhc.noaa.gov"],
    permissionUrl: "https://www.nhc.noaa.gov/mobile/disclaimer.html", permissionReviewedAt: "2026-08-21",
    contentPool: "breaking", freshnessClass: "BREAKING", freshnessHours: 24,
    topicTags: ["hurricane", "tropical", "storm", "weather", "ocean", "forecast", "earth"],
    updateFrequency: "at least every six hours during active systems", articleDepth: "moderate",
  },
  restricted("bbc-world", "BBC", "bbc.co.uk", "https://feeds.bbci.co.uk/news/world/rss.xml", "World", "Global"),
  restricted("al-jazeera", "Al Jazeera", "aljazeera.com", "http://www.aljazeera.com/xml/rss/all.xml", "World", "Middle East"),
  restricted("the-verge", "The Verge", "theverge.com", "https://www.theverge.com/rss/index.xml", "Technology", "Global"),
  restricted("techcrunch", "TechCrunch", "techcrunch.com", "https://techcrunch.com/feed/", "Technology", "Global"),
  restricted("cnbc", "CNBC", "cnbc.com", "https://www.cnbc.com/id/10001147/device/rss/rss.html", "Business", "Americas"),
  restricted("espn", "ESPN", "espn.com", "https://www.espn.com/espn/rss/news", "Sports", "Americas"),
  restricted("bbc-politics", "BBC", "bbc.co.uk", "https://feeds.bbci.co.uk/news/politics/rss.xml", "Politics", "Europe"),
  restricted("politico", "Politico", "politico.com", "https://rss.politico.com/politics-news.xml", "Politics", "Americas"),
  restricted("bbc-health", "BBC", "bbc.co.uk", "https://feeds.bbci.co.uk/news/health/rss.xml", "Health", "Global"),
  restricted("who-news", "World Health Organization", "who.int", "https://www.who.int/rss-feeds/news-english.xml", "Health", "Global"),
  restricted("bbc-magazine", "BBC", "bbc.co.uk", "https://feeds.bbci.co.uk/news/magazine/rss.xml", "Opinion", "Global", "opinion"),
  restricted("guardian-comment", "The Guardian", "theguardian.com", "https://www.theguardian.com/uk/commentisfree/rss", "Opinion", "Europe", "opinion"),
  restricted("bbc-asia", "BBC", "bbc.co.uk", "https://feeds.bbci.co.uk/news/world/asia/rss.xml", "World", "Asia"),
  restricted("bbc-europe", "BBC", "bbc.co.uk", "https://feeds.bbci.co.uk/news/world/europe/rss.xml", "World", "Europe"),
  restricted("bbc-middle-east", "BBC", "bbc.co.uk", "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml", "World", "Middle East"),
  restricted("bbc-americas", "BBC", "bbc.co.uk", "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml", "World", "Americas"),
  restricted("bbc-africa", "BBC", "bbc.co.uk", "https://feeds.bbci.co.uk/news/world/africa/rss.xml", "World", "Africa"),
  restricted("wired", "Wired", "wired.com", "https://www.wired.com/feed/rss", "Technology", "Americas", "long-read"),
  restricted("the-atlantic", "The Atlantic", "theatlantic.com", "https://feeds.feedburner.com/TheAtlantic", "World", "Americas", "long-read"),
];

export function sourceCanBeSynthesized(source: SourceRegistryEntry) {
  return source.synthesisEnabled && source.discoveryAllowed && source.commercialUseAllowed &&
    source.aiProcessingAllowed && source.transformationAllowed && source.licenseType !== "unknown" &&
    source.maxSourceCharacters > 0 && Boolean(source.permissionUrl) && Boolean(source.permissionReviewedAt) &&
    source.topicTags.length > 0 && source.updateFrequency !== "unknown";
}

export const SYNTHESIS_SOURCES = SOURCE_REGISTRY.filter(sourceCanBeSynthesized);

export function sourceUrlIsAllowed(source: SourceRegistryEntry, value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return ["http:", "https:"].includes(url.protocol) && source.allowedArticleDomains.some(
      (domain) => host === domain || host.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}
