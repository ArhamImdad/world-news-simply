import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import Parser from "rss-parser";
import { Suspense } from "react";
import CategoryLoadMoreSection from "./category-load-more-section";
import HomeLoading from "./loading";
import MobileMenu from "./mobile-menu";
import ScrollEnhancements from "./scroll-enhancements";
import ScrollLink from "./scroll-link";
import SearchPanel from "./search-panel";
import ThemeToggle from "./theme-toggle";
import { getArticlePath } from "@/lib/article-url";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { supabase, type Article } from "@/lib/supabase";
import { ARTICLE_SELECT } from "@/types/article";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "World News Simply | Breaking News in Simple English",
  description: "World News Simply - Get the latest breaking news from around the world in simple English. Read clear updates on politics, technology, business, sports, health, and more.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "World News Simply | Breaking News in Simple English",
    description: "World News Simply - Get the latest breaking news from around the world in simple English.",
    url: "/",
    type: "website",
    images: [{ url: "/globe.svg", alt: "World News Simply" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "World News Simply | Breaking News in Simple English",
    description: "World News Simply - Get the latest breaking news from around the world in simple English.",
    images: ["/globe.svg"],
  },
};

const categories = [
  "All",
  "World",
  "Politics",
  "Technology",
  "Business",
  "Sports",
  "Health",
  "Opinion",
];

const sectionCategories = categories.filter((category) => category !== "All");
const regions = ["All", "Asia", "Europe", "Middle East", "Americas", "Africa"];

const categoryAccentColors: Record<string, string> = {
  World: "#cc0000",
  Politics: "#6d28d9",
  Technology: "#1d4ed8",
  Business: "#047857",
  Sports: "#c2410c",
  Health: "#0e7490",
  Opinion: "#a16207",
};

const youtubeFeeds = [
  {
    channel: "CNN",
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCupvZG-5ko_eiXAupbDfxWw",
  },
  {
    channel: "ABC News",
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCBi2mrWuNuyYy4gbM6fU18Q",
  },
];

type VideoItem = {
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  channel: string;
  duration: string;
};

type WeatherData = {
  temperature: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  icon: string;
};

type MarketItem = {
  label: string;
  value: string;
  change: number;
};

type SidebarMarketItem = {
  label: string;
  value: string;
  change: string;
  direction: "up" | "down";
};

const PAGE_SIZE = 12;
const sidebarMarkets: SidebarMarketItem[] = [
  { label: "S&P 500", value: "5,234.18", change: "+0.42%", direction: "up" },
  { label: "NASDAQ", value: "16,428.82", change: "+0.68%", direction: "up" },
  { label: "DOW", value: "38,654.42", change: "-0.12%", direction: "down" },
  { label: "BTC", value: "$67,234.00", change: "+2.34%", direction: "up" },
  { label: "Gold", value: "$2,312.40", change: "+0.18%", direction: "up" },
];

function getDate(value: string) {
  return new Date(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(getDate(value));
}

function formatTimeAgo(value: string) {
  const now = Date.now();
  const diff = Math.max(0, now - getDate(value).getTime());
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < hour) {
    const minutes = Math.max(1, Math.floor(diff / minute));
    return `${minutes} min ago`;
  }

  if (diff < day) {
    const hours = Math.floor(diff / hour);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.floor(diff / day);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function isRecent(article: Article, hours: number) {
  return Date.now() - getDate(article.created_at).getTime() < hours * 60 * 60 * 1000;
}

function dedupeArticlesByTitle(articles: Article[]) {
  const seen = new Set<string>();

  return articles.filter((article) => {
    const key = article.title.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getReadTime(article: Article, longRead = false) {
  if (article.read_time) {
    return `${article.read_time} min read`;
  }

  const words = `${article.title} ${article.summary} ${article.content}`
    .trim()
    .split(/\s+/).length;
  const fallback = Math.max(1, Math.ceil(words / 220));
  const minutes = longRead ? Math.min(12, Math.max(8, fallback)) : fallback;
  return `${minutes} min read`;
}

function getViews(article: Article) {
  if (article.views && article.views > 0) {
    return article.views.toLocaleString("en-US");
  }

  const seed = article.id
    .split("")
    .reduce((total, char) => total + char.charCodeAt(0), 0);
  return (1600 + (seed * 31) % 38000).toLocaleString("en-US");
}

function getArticleType(article: Article) {
  if (article.article_type) return article.article_type;
  if (article.category === "Opinion") return "opinion";
  return "news";
}

function getShareLinks(article: Article) {
  const path = getArticlePath(article);
  const text = encodeURIComponent(article.title);
  const url = encodeURIComponent(path);

  return [
    { label: "Twitter", href: `https://twitter.com/intent/tweet?text=${text}&url=${url}` },
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${url}` },
    { label: "WhatsApp", href: `https://wa.me/?text=${text}%20${url}` },
  ];
}

async function getArticles(filters: { category?: string; region?: string } = {}) {
  let query = supabase
    .from("articles")
    .select(ARTICLE_SELECT)
    .order("created_at", { ascending: false });

  if (filters.category) {
    query = query.eq("category", filters.category);
  }

  if (filters.region) {
    query = query.in("region", [filters.region, "Global"]);
  }

  const { data, error } = await query.limit(120);

  if (error) {
    console.error("Failed to load articles:", error.message);
    return [];
  }

  return dedupeArticlesByTitle((data ?? []) as Article[]);
}

async function getVideos() {
  const parser: Parser<Record<string, unknown>, Record<string, unknown>> = new Parser({
    customFields: {
      item: [
        ["yt:videoId", "videoId"],
        ["media:group", "mediaGroup"],
      ],
    },
  });
  const videos: VideoItem[] = [];

  for (const feed of youtubeFeeds) {
    try {
      const response = await fetchWithTimeout(feed.url, {
        headers: { "User-Agent": "World News Simply/1.0" },
        next: { revalidate: 600 },
      });

      if (!response.ok) {
        throw new Error(`YouTube feed failed with status ${response.status}`);
      }

      const parsed = await parser.parseString(await response.text());
      for (const item of parsed.items.slice(0, 2)) {
        const videoId = String(item.videoId || "");
        const mediaGroup = item.mediaGroup as
          | { "media:thumbnail"?: Array<{ $?: { url?: string } }> }
          | undefined;
        const thumbnail =
          mediaGroup?.["media:thumbnail"]?.[0]?.$?.url ||
          `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

        if (!item.title || !videoId) continue;

        videos.push({
          id: videoId,
          title: item.title,
          url: item.link || `https://www.youtube.com/watch?v=${videoId}`,
          thumbnail,
          channel: feed.channel,
          duration: "Video",
        });
      }
    } catch (error) {
      console.error(`Failed to load video feed ${feed.channel}:`, error);
    }
  }

  return videos.slice(0, 4);
}

function getWeatherCondition(code: number) {
  if ([0, 1].includes(code)) return { condition: "Sunny", icon: "sun" };
  if ([2, 3, 45, 48].includes(code)) return { condition: "Cloudy", icon: "cloud" };
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) {
    return { condition: "Rainy", icon: "rain" };
  }
  return { condition: "Clear", icon: "sun" };
}

async function getWeather(): Promise<WeatherData> {
  try {
    const response = await fetchWithTimeout(
      "https://api.open-meteo.com/v1/forecast?latitude=31.5497&longitude=74.3436&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code",
      { next: { revalidate: 900 } }
    );
    const data = await response.json();
    const condition = getWeatherCondition(Number(data.current?.weather_code));

    return {
      temperature: Math.round(Number(data.current?.temperature_2m ?? 29)),
      condition: condition.condition,
      humidity: Math.round(Number(data.current?.relative_humidity_2m ?? 55)),
      windSpeed: Math.round(Number(data.current?.wind_speed_10m ?? 8)),
      icon: condition.icon,
    };
  } catch (error) {
    console.error("Failed to load weather:", error);
    return {
      temperature: 29,
      condition: "Sunny",
      humidity: 55,
      windSpeed: 8,
      icon: "sun",
    };
  }
}

async function getMarkets(): Promise<MarketItem[]> {
  const fallback = [
    { label: "S&P 500", value: "Market", change: 0.42 },
    { label: "NASDAQ", value: "Market", change: 0.51 },
    { label: "DOW", value: "Market", change: -0.18 },
    { label: "BTC", value: "Crypto", change: 1.2 },
    { label: "Gold", value: "Futures", change: -0.24 },
  ];

  try {
    const symbols = "%5EGSPC,%5EIXIC,%5EDJI,BTC-USD,GC=F";
    const response = await fetchWithTimeout(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`,
      { next: { revalidate: 300 } }
    );
    const data = await response.json();
    const quotes = data.quoteResponse?.result ?? [];
    const labels: Record<string, string> = {
      "^GSPC": "S&P 500",
      "^IXIC": "NASDAQ",
      "^DJI": "DOW",
      "BTC-USD": "BTC",
      "GC=F": "Gold",
    };

    return quotes.slice(0, 5).map((quote: Record<string, unknown>) => ({
      label: labels[String(quote.symbol)] || String(quote.shortName || quote.symbol),
      value: Number(quote.regularMarketPrice || 0).toLocaleString("en-US"),
      change: Number(quote.regularMarketChangePercent || 0),
    }));
  } catch (error) {
    console.error("Failed to load markets:", error);
    return fallback;
  }
}

function Icon({ name }: { name: "search" | "menu" | "sun" | "moon" | "globe" }) {
  if (name === "search") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="m21 21-4.3-4.3m1.3-5.2a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />
      </svg>
    );
  }

  if (name === "menu") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    );
  }

  if (name === "sun") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2-1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
      </svg>
    );
  }

  if (name === "moon") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3.6 9h16.8M3.6 15h16.8M12 3c2.1 2.2 3.2 5.2 3.2 9S14.1 18.8 12 21c-2.1-2.2-3.2-5.2-3.2-9S9.9 5.2 12 3Z" />
    </svg>
  );
}

function Logo() {
  return (
    <Link href="/" className="brand-logo" aria-label="World News Simply home">
      <span className="brand-globe">
        <Icon name="globe" />
      </span>
      <span>World News Simply</span>
    </Link>
  );
}

function Navbar({ activeCategory }: { activeCategory: string }) {
  return (
    <header className="site-header">
      <div className="top-accent" />
      <nav className="site-navbar" aria-label="Main navigation">
        <div className="site-navbar-inner">
          <Logo />
          <div className="desktop-nav">
            {categories.map((category) => {
              const href = category === "All" ? "/" : `/?category=${category}`;
              const label = category === "All" ? "Home" : category;
              const isActive = activeCategory === category;

              return (
                <ScrollLink
                  key={category}
                  href={href}
                  className={isActive ? "nav-link nav-link-active" : "nav-link"}
                  aria-current={isActive ? "page" : undefined}
                >
                  {label}
                </ScrollLink>
              );
            })}
          </div>
          <div className="nav-actions">
            <SearchPanel />
            <ThemeToggle />
            <MobileMenu categories={categories} regions={regions} activeCategory={activeCategory} />
          </div>
        </div>
      </nav>
    </header>
  );
}

function NewsTicker({ articles }: { articles: Article[] }) {
  const headlines = articles.slice(0, 10).map((article) => article.title);

  if (headlines.length === 0) return null;

  const tickerText = headlines.join("  /  ");

  return (
    <section className="news-ticker" aria-label="Breaking headlines">
      <div className="breaking-label">Breaking</div>
      <div className="ticker-viewport">
        <div className="ticker-track">
          <span>{tickerText}</span>
          <span aria-hidden="true">{tickerText}</span>
        </div>
      </div>
    </section>
  );
}

function StockTicker({ markets }: { markets: MarketItem[] }) {
  if (markets.length === 0) return null;

  return (
    <section className="market-ticker" aria-label="Market ticker">
      <div className="market-track">
        {[...markets, ...markets].map((market, index) => {
          const isUp = market.change >= 0;
          return (
            <span key={`${market.label}-${index}`} className={isUp ? "market-up" : "market-down"}>
              <strong>{market.label}</strong>
              {market.value}
              <em>{isUp ? "up" : "down"} {Math.abs(market.change).toFixed(2)}%</em>
            </span>
          );
        })}
      </div>
    </section>
  );
}

function RegionTabs({ activeCategory, activeRegion }: { activeCategory: string; activeRegion: string }) {
  return (
    <nav className="region-tabs" aria-label="Regional news filters">
      {regions.map((region) => {
        const params = new URLSearchParams();
        if (activeCategory !== "All") params.set("category", activeCategory);
        if (region !== "All") params.set("region", region);
        const href = params.toString() ? `/?${params.toString()}` : "/";
        const isActive = activeRegion === region;

        return (
          <ScrollLink
            key={region}
            href={href}
            className={isActive ? "region-tab region-tab-active" : "region-tab"}
            aria-current={isActive ? "page" : undefined}
          >
            {region}
          </ScrollLink>
        );
      })}
    </nav>
  );
}

function Pagination({
  activeCategory,
  activeRegion,
  currentPage,
  totalPages,
}: {
  activeCategory: string;
  activeRegion: string;
  currentPage: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav className="pagination" aria-label="Article pagination">
      {Array.from({ length: totalPages }).map((_, index) => {
        const page = index + 1;
        const params = new URLSearchParams();
        if (activeCategory !== "All") params.set("category", activeCategory);
        if (activeRegion !== "All") params.set("region", activeRegion);
        if (page > 1) params.set("page", String(page));

        return (
          <ScrollLink
            key={page}
            href={params.toString() ? `/?${params.toString()}` : "/"}
            className={page === currentPage ? "pagination-link pagination-link-active" : "pagination-link"}
            aria-current={page === currentPage ? "page" : undefined}
          >
            {page}
          </ScrollLink>
        );
      })}
    </nav>
  );
}

function StatusBadges({ article }: { article: Article }) {
  const showLive = isRecent(article, 1);
  const showNew = isRecent(article, 3);

  return (
    <div className="status-badges">
      {showLive ? (
        <span className="live-badge">
          <span />
          LIVE
        </span>
      ) : null}
      {article.is_breaking ? <span className="breaking-status">BREAKING</span> : null}
      {showNew ? <span className="new-status">NEW</span> : null}
      {article.article_type === "long-read" ? <span className="long-read-badge">Long Read</span> : null}
    </div>
  );
}

function ArticleMeta({ article, compact = false }: { article: Article; compact?: boolean }) {
  return (
    <div className={compact ? "article-meta article-meta-compact" : "article-meta"}>
      <span className={article.category === "Opinion" ? "opinion-badge" : "category-badge"}>
        {article.category}
      </span>
      {article.region ? <span className="region-badge">{article.region}</span> : null}
      <time dateTime={article.created_at}>{formatTimeAgo(article.created_at)}</time>
      <span>{getReadTime(article)}</span>
    </div>
  );
}

function ShareButtons({ article }: { article: Article }) {
  return (
    <div className="share-buttons" aria-label={`Share ${article.title}`}>
      {getShareLinks(article).map((link) => (
        <a
          key={link.label}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className={`share-button-${link.label.toLowerCase()}`}
          aria-label={`Share on ${link.label}`}
          title={link.label}
        >
          <span aria-hidden="true">
            {link.label === "Twitter" ? "T" : link.label === "Facebook" ? "f" : "W"}
          </span>
        </a>
      ))}
    </div>
  );
}

function AuthorAvatar() {
  return (
    <div className="author-chip">
      <span aria-hidden="true">W</span>
      <strong>World News Simply Staff</strong>
    </div>
  );
}

function HeroSection({ articles }: { articles: Article[] }) {
  const [lead, ...sideStories] = articles;

  if (!lead) {
    return (
      <section className="empty-state">
        <p className="section-kicker">No Stories Yet</p>
        <h1>Your newsroom is ready.</h1>
        <p>Run the news fetcher to publish the first automated briefings.</p>
      </section>
    );
  }

  return (
    <section className="hero-grid" aria-label="Top stories">
      <article className="hero-lead">
        <Link href={getArticlePath(lead)} className="hero-lead-link">
          <div className="hero-image">
            <Image
              src={lead.image_url}
              alt={lead.title}
              fill
              priority
              sizes="(max-width: 960px) 100vw, 60vw"
            />
          </div>
          <div className="hero-copy">
            <StatusBadges article={lead} />
            <ArticleMeta article={lead} />
            <h1>{lead.title}</h1>
            <p>{lead.summary}</p>
            <div className="byline-row">
              <span>By World News Simply Staff</span>
              <span>{formatDate(lead.created_at)}</span>
              <span>Updated {formatTimeAgo(lead.created_at)}</span>
            </div>
          </div>
        </Link>
        <ShareButtons article={lead} />
      </article>

      <div className="hero-stack">
        {sideStories.slice(0, 4).map((article) => (
          <article key={article.id} className="stack-story">
            <Link href={getArticlePath(article)} className="stack-story-link">
              <div className="stack-thumb">
                <Image src={article.image_url} alt={article.title} fill sizes="140px" loading="lazy" />
              </div>
              <div>
                <StatusBadges article={article} />
                <ArticleMeta article={article} compact />
                <h2>{article.title}</h2>
                <time dateTime={article.created_at}>{formatDate(article.created_at)}</time>
              </div>
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

function EditorsPickSection({ articles }: { articles: Article[] }) {
  const picks = articles.slice(0, 3);
  if (picks.length === 0) return null;

  return (
    <section className="editors-section" aria-labelledby="editors-pick-heading">
      <div className="section-heading-row">
        <h2 id="editors-pick-heading">Editor&apos;s Pick</h2>
        <span>Magazine edit</span>
      </div>
      <div className="editors-grid">
        {picks.map((article) => (
          <article key={article.id} className="editors-card">
            <Link href={getArticlePath(article)}>
              <Image
                src={article.image_url}
                alt={article.title}
                fill
                sizes="(max-width: 768px) 90vw, 33vw"
                loading="lazy"
              />
              <div className="editors-overlay" />
              <div className="editors-copy">
                <span className="editors-badge">Editor&apos;s Pick</span>
                <h3>{article.title}</h3>
                <p>{getReadTime(article)} / {formatTimeAgo(article.created_at)}</p>
              </div>
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

function BreakingNewsSection({ articles }: { articles: Article[] }) {
  if (articles.length === 0) return null;

  return (
    <section className="breaking-section" aria-labelledby="breaking-news-heading">
      <div className="section-heading-row">
        <h2 id="breaking-news-heading">Breaking News</h2>
        <span>Latest desk updates</span>
      </div>
      <div className="breaking-grid">
        {articles.slice(0, 4).map((article) => (
          <article key={article.id} className="breaking-card">
            <Link href={getArticlePath(article)}>
              <div className="breaking-card-image">
                <Image
                  src={article.image_url}
                  alt={article.title}
                  fill
                  sizes="(max-width: 768px) 50vw, 25vw"
                  loading="lazy"
                />
              </div>
              <StatusBadges article={article} />
              <h3>{article.title}</h3>
              <p>Updated {formatTimeAgo(article.created_at)}</p>
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

function StoryCard({ article }: { article: Article }) {
  const isOpinion = getArticleType(article) === "opinion" || article.category === "Opinion";

  return (
    <article className={isOpinion ? "story-card opinion-card" : "story-card"}>
      <Link href={getArticlePath(article)} className="story-card-link">
        <div className="story-card-image">
          <Image
            src={article.image_url}
            alt={article.title}
            fill
            sizes="(max-width: 768px) 90vw, 320px"
            loading="lazy"
          />
        </div>
        <div className="story-card-body">
          <StatusBadges article={article} />
          <ArticleMeta article={article} compact />
          {isOpinion ? <AuthorAvatar /> : null}
          <h3>{article.title}</h3>
          <p>{article.summary}</p>
          <div className="card-footer-meta">
            <span>World News Simply Staff</span>
            <span>{getViews(article)} views</span>
          </div>
        </div>
      </Link>
      <ShareButtons article={article} />
    </article>
  );
}

function OpinionSection({ articles }: { articles: Article[] }) {
  const opinions = articles
    .filter((article) => getArticleType(article) === "opinion" || article.category === "Opinion")
    .slice(0, 3);

  if (opinions.length === 0) return null;

  return (
    <section className="opinion-section" aria-labelledby="opinion-heading">
      <div className="opinion-inner">
        <div className="section-heading-row">
          <h2 id="opinion-heading">Opinion</h2>
          <span>Editorial voices</span>
        </div>
        <div className="opinion-grid">
          {opinions.map((article) => (
            <StoryCard key={article.id} article={article} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturedBanner({ article }: { article?: Article }) {
  if (!article) return null;

  return (
    <section className="featured-banner" aria-label="Featured editorial story">
      <Image src={article.image_url} alt={article.title} fill sizes="100vw" loading="lazy" />
      <div className="featured-banner-overlay" />
      <div className="featured-banner-content">
        <p className="section-kicker">Featured Story</p>
        <h2>{article.title}</h2>
        <p>{article.summary}</p>
        <div className="featured-meta">
          <span>By World News Simply Staff</span>
          <span>{getReadTime(article)}</span>
          <span>{formatTimeAgo(article.created_at)}</span>
        </div>
      </div>
    </section>
  );
}

function VideoNewsSection({ videos }: { videos: VideoItem[] }) {
  if (videos.length === 0) return null;

  return (
    <section className="video-section page-wrap" aria-labelledby="video-news-heading">
      <div className="section-heading-row">
        <h2 id="video-news-heading">Video News</h2>
        <span>YouTube news channels</span>
      </div>
      <div className="video-grid">
        {videos.map((video) => (
          <article key={video.id} className="video-card">
            <a href={video.url} target="_blank" rel="noopener noreferrer">
              <div className="video-thumb">
                <Image
                  src={video.thumbnail}
                  alt={video.title}
                  fill
                  sizes="(max-width: 768px) 50vw, 25vw"
                  loading="lazy"
                />
                <span>{video.duration}</span>
              </div>
              <div className="video-card-body">
                <p>{video.channel}</p>
                <h3>{video.title}</h3>
              </div>
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}

function LongReadsSection({ articles }: { articles: Article[] }) {
  const longReads = articles.filter((article) => getArticleType(article) === "long-read").slice(0, 3);
  const [lead, ...secondary] = longReads;

  if (!lead) return null;

  return (
    <section className="long-reads-section" aria-labelledby="long-reads-heading">
      <div className="page-wrap">
        <div className="section-heading-row">
          <h2 id="long-reads-heading">Long Reads</h2>
          <span>Deep editorial reads</span>
        </div>
        <article className="long-read-hero">
          <Link href={getArticlePath(lead)}>
            <Image src={lead.image_url} alt={lead.title} fill sizes="100vw" loading="lazy" />
            <div className="long-read-overlay" />
            <div className="long-read-copy">
              <span className="long-read-badge">Long Read</span>
              <h3>{lead.title}</h3>
              <p>{lead.summary}</p>
              <strong>{getReadTime(lead, true)}</strong>
            </div>
          </Link>
        </article>
        {secondary.length > 0 ? (
          <div className="long-read-row">
            {secondary.map((article) => (
              <StoryCard key={article.id} article={article} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function WeatherWidget({ weather }: { weather: WeatherData }) {
  return (
    <section className="weather-widget" aria-label="Weather in Lahore Pakistan">
      <div className="sidebar-widget-heading">
        <span className="widget-heading-icon weather-heading-icon" aria-hidden="true" />
        <h2>Weather</h2>
      </div>
      <div className={`weather-icon weather-${weather.icon}`} aria-hidden="true" />
      <div>
        <p>Lahore Weather</p>
        <h3>{weather.temperature}°C</h3>
        <span>{weather.condition}</span>
      </div>
      <dl>
        <div>
          <dt>Humidity</dt>
          <dd>{weather.humidity}%</dd>
        </div>
        <div>
          <dt>Wind</dt>
          <dd>{weather.windSpeed} km/h</dd>
        </div>
      </dl>
    </section>
  );
}

function TrendingNow({ articles }: { articles: Article[] }) {
  if (articles.length === 0) return null;

  return (
    <aside className="trending-now" aria-labelledby="trending-heading">
      <h2 id="trending-heading">Trending Now</h2>
      <ol>
        {articles.slice(0, 5).map((article) => (
          <li key={article.id}>
            <Link href={getArticlePath(article)}>
              <span>{article.category}</span>
              <strong>{article.title}</strong>
              <time dateTime={article.created_at}>{formatTimeAgo(article.created_at)}</time>
            </Link>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function MarketsWidget() {
  return (
    <section className="markets-widget" aria-labelledby="markets-heading">
      <div className="sidebar-widget-heading">
        <span className="widget-heading-icon markets-heading-icon" aria-hidden="true" />
        <h2 id="markets-heading">Markets</h2>
      </div>
      <div className="markets-table">
        {sidebarMarkets.map((market) => (
          <div key={market.label} className="markets-row">
            <strong>{market.label}</strong>
            <span>{market.value}</span>
            <em className={market.direction === "up" ? "sidebar-market-up" : "sidebar-market-down"}>
              {market.change} {market.direction === "up" ? "▲" : "▼"}
            </em>
          </div>
        ))}
      </div>
      <p>Data delayed 15 min</p>
    </section>
  );
}

function NewsletterWidget() {
  return (
    <section className="sidebar-newsletter" aria-labelledby="sidebar-newsletter-heading">
      <h2 id="sidebar-newsletter-heading">Stay Informed</h2>
      <p>Get the latest news delivered to your inbox</p>
      <form>
        <input
          type="email"
          placeholder="Email address"
          aria-label="Email address"
          suppressHydrationWarning
        />
        <button type="button" suppressHydrationWarning>
          Subscribe
        </button>
      </form>
    </section>
  );
}

function FollowUsWidget() {
  const links = [
    { platform: "Twitter", count: "124K followers", initial: "T" },
    { platform: "Facebook", count: "89K followers", initial: "f" },
    { platform: "Instagram", count: "56K followers", initial: "I" },
    { platform: "YouTube", count: "41K subscribers", initial: "Y" },
  ];

  return (
    <section className="follow-widget" aria-labelledby="follow-heading">
      <h2 id="follow-heading">Follow Us</h2>
      <div>
        {links.map((link) => (
          <a key={link.platform} href="https://example.com" target="_blank" rel="noopener noreferrer">
            <span aria-hidden="true">{link.initial}</span>
            <strong>{link.platform}</strong>
            <em>{link.count}</em>
          </a>
        ))}
      </div>
    </section>
  );
}

function Sidebar({ articles, weather }: { articles: Article[]; weather: WeatherData }) {
  return (
    <div className="homepage-sidebar">
      <TrendingNow articles={articles} />
      <WeatherWidget weather={weather} />
      <MarketsWidget />
      <NewsletterWidget />
      <FollowUsWidget />
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div>
          <h2>World News Simply</h2>
          <p>Clear, fast briefings from around the world, written for everyday reading.</p>
        </div>
        <div>
          <h3>Categories</h3>
          {sectionCategories.map((category) => (
            <ScrollLink key={category} href={`/?category=${category}`}>
              {category}
            </ScrollLink>
          ))}
        </div>
        <div>
          <h3>Follow Us</h3>
          <div className="social-links">
            <a href="https://twitter.com" aria-label="Twitter">T</a>
            <a href="https://facebook.com" aria-label="Facebook">F</a>
            <a href="https://instagram.com" aria-label="Instagram">I</a>
            <a href="/rss" aria-label="RSS">RSS</a>
          </div>
        </div>
        <form className="newsletter-form">
          <h3>Newsletter</h3>
          <label htmlFor="newsletter-email">Email address</label>
          <div>
            <input
              id="newsletter-email"
              type="email"
              placeholder="you@example.com"
              suppressHydrationWarning
            />
            <button type="button" suppressHydrationWarning>
              Sign up
            </button>
          </div>
        </form>
      </div>
      <p className="copyright">Copyright 2026 World News Simply. All rights reserved.</p>
    </footer>
  );
}

function PageSkeleton() {
  return <HomeLoading />;
}

async function NewsContent({
  searchParams,
}: {
  searchParams: { category?: string; region?: string; page?: string };
}) {
  const selectedCategory = searchParams.category ?? "All";
  const selectedRegion = searchParams.region ?? "All";
  const requestedPage = Number(searchParams.page ?? "1");
  const currentPage = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const activeCategory = categories.includes(selectedCategory) ? selectedCategory : "All";
  const activeRegion = regions.includes(selectedRegion) ? selectedRegion : "All";
  const activeFilters = {
    category: activeCategory === "All" ? undefined : activeCategory,
    region: activeRegion === "All" ? undefined : activeRegion,
  };
  const shouldUseFilteredQuery = Boolean(activeFilters.category || activeFilters.region);
  const [allArticles, filteredArticles, videos, weather, markets] = await Promise.all([
    getArticles(),
    shouldUseFilteredQuery ? getArticles(activeFilters) : Promise.resolve<Article[]>([]),
    getVideos(),
    getWeather(),
    getMarkets(),
  ]);
  const activeArticles = shouldUseFilteredQuery ? filteredArticles : allArticles;
  const totalPages = Math.max(1, Math.ceil(activeArticles.length / PAGE_SIZE));
  const pageArticles = activeArticles.slice(
    (Math.min(currentPage, totalPages) - 1) * PAGE_SIZE,
    Math.min(currentPage, totalPages) * PAGE_SIZE
  );
  const visibleCategories = activeCategory === "All" ? sectionCategories : [activeCategory];
  const bannerArticle = pageArticles[5] ?? pageArticles[0] ?? activeArticles[0];

  return (
    <main className="news-shell">
      <ScrollEnhancements />
      <Navbar activeCategory={activeCategory} />
      <NewsTicker articles={allArticles} />
      <StockTicker markets={markets} />

      <div className="page-wrap">
        <RegionTabs activeCategory={activeCategory} activeRegion={activeRegion} />
        <HeroSection articles={pageArticles.slice(0, 5)} />
        <EditorsPickSection articles={pageArticles} />
        <BreakingNewsSection articles={pageArticles.slice(1, 5)} />
        <Pagination
          activeCategory={activeCategory}
          activeRegion={activeRegion}
          currentPage={Math.min(currentPage, totalPages)}
          totalPages={totalPages}
        />
      </div>

      <FeaturedBanner article={bannerArticle} />

      <VideoNewsSection videos={videos} />
      <OpinionSection articles={allArticles} />

      <div className="page-wrap content-with-sidebar">
        <div className="category-sections">
          {visibleCategories.map((category) => (
            <CategoryLoadMoreSection
              key={category}
              category={category}
              accentColor={categoryAccentColors[category]}
              initialArticles={dedupeArticlesByTitle(
                allArticles.filter((article) => article.category === category)
              ).slice(0, 6)}
            />
          ))}
        </div>
        <Sidebar articles={allArticles} weather={weather} />
      </div>

      <LongReadsSection articles={allArticles} />
      <SiteFooter />
    </main>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; region?: string; page?: string }>;
}) {
  const params = await searchParams;
  const suspenseKey = `${params.category ?? "All"}-${params.region ?? "All"}-${params.page ?? "1"}`;

  return (
    <Suspense key={suspenseKey} fallback={<PageSkeleton />}>
      <NewsContent searchParams={params} />
    </Suspense>
  );
}
