import Parser from "rss-parser";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

export type FeedConfig = {
  url: string;
  categoryHint: string;
  regionHint?: string;
  articleTypeHint?: "news" | "opinion" | "long-read" | "video";
  isBreakingHint?: boolean;
};

export const RSS_FEEDS: FeedConfig[] = [
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml", categoryHint: "World", regionHint: "Global" },
  { url: "http://www.aljazeera.com/xml/rss/all.xml", categoryHint: "World", regionHint: "Middle East" },
  { url: "https://www.theverge.com/rss/index.xml", categoryHint: "Technology", regionHint: "Global" },
  { url: "https://techcrunch.com/feed/", categoryHint: "Technology", regionHint: "Global" },
  { url: "https://www.cnbc.com/id/10001147/device/rss/rss.html", categoryHint: "Business", regionHint: "Americas" },
  { url: "https://www.espn.com/espn/rss/news", categoryHint: "Sports", regionHint: "Americas" },
  { url: "https://feeds.bbci.co.uk/news/politics/rss.xml", categoryHint: "Politics", regionHint: "Europe" },
  { url: "https://rss.politico.com/politics-news.xml", categoryHint: "Politics", regionHint: "Americas" },
  { url: "https://feeds.bbci.co.uk/news/health/rss.xml", categoryHint: "Health", regionHint: "Global" },
  { url: "https://www.who.int/rss-feeds/news-english.xml", categoryHint: "Health", regionHint: "Global" },
  { url: "https://feeds.bbci.co.uk/news/magazine/rss.xml", categoryHint: "Opinion", regionHint: "Global", articleTypeHint: "opinion" },
  { url: "https://www.theguardian.com/uk/commentisfree/rss", categoryHint: "Opinion", regionHint: "Europe", articleTypeHint: "opinion" },
  { url: "https://feeds.bbci.co.uk/news/world/asia/rss.xml", categoryHint: "World", regionHint: "Asia" },
  { url: "https://feeds.bbci.co.uk/news/world/europe/rss.xml", categoryHint: "World", regionHint: "Europe" },
  { url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml", categoryHint: "World", regionHint: "Middle East" },
  { url: "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml", categoryHint: "World", regionHint: "Americas" },
  { url: "https://feeds.bbci.co.uk/news/world/africa/rss.xml", categoryHint: "World", regionHint: "Africa" },
  { url: "https://www.wired.com/feed/rss", categoryHint: "Technology", regionHint: "Americas", articleTypeHint: "long-read" },
  { url: "https://feeds.feedburner.com/TheAtlantic", categoryHint: "World", regionHint: "Americas", articleTypeHint: "long-read" },
];

const parser = new Parser();

export async function parseFeed(feedUrl: string) {
  const response = await fetchWithTimeout(feedUrl, {
    headers: { "User-Agent": "World News Simply/1.0" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`RSS request failed with status ${response.status}`);
  }

  return parser.parseString(await response.text());
}
