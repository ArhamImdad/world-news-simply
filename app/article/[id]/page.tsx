import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import MobileMenu from "@/app/mobile-menu";
import ScrollEnhancements from "@/app/scroll-enhancements";
import ScrollLink from "@/app/scroll-link";
import SearchPanel from "@/app/search-panel";
import ThemeToggle from "@/app/theme-toggle";
import { getArticlePath } from "@/lib/article-url";
import { getPublicSiteUrl } from "@/lib/env";
import { supabase, type Article } from "@/lib/supabase";
import { ARTICLE_SELECT } from "@/types/article";

export const dynamic = "force-dynamic";
const navCategories = ["All", "World", "Politics", "Technology", "Business", "Sports", "Health", "Opinion"];
const navRegions = ["All", "Asia", "Europe", "Middle East", "Americas", "Africa"];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatTimeAgo(value: string) {
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;

  if (diff < hour) {
    return `${Math.max(1, Math.floor(diff / 60000))} min ago`;
  }

  if (diff < day) {
    const hours = Math.floor(diff / hour);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.floor(diff / day);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function estimateReadingTime(article: Article) {
  if (article.read_time) {
    return `${article.read_time} min read`;
  }

  const words = `${article.title} ${article.summary} ${article.content}`
    .trim()
    .split(/\s+/).length;
  const fallback = Math.max(1, Math.ceil(words / 220));
  const minutes = article.article_type === "long-read"
    ? Math.min(12, Math.max(8, fallback))
    : fallback;
  return `${minutes} min read`;
}

function getViewCount(article: Article) {
  if (article.views && article.views > 0) {
    return article.views.toLocaleString("en-US");
  }

  const seed = article.id.split("").reduce((total, char) => total + char.charCodeAt(0), 0);
  return (1800 + (seed * 37) % 47000).toLocaleString("en-US");
}

function isRecent(article: Article, hours: number) {
  return Date.now() - new Date(article.created_at).getTime() < hours * 60 * 60 * 1000;
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

async function getArticle(id: string) {
  const query = supabase
    .from("articles")
    .select(ARTICLE_SELECT);
  const { data, error } = uuidPattern.test(id)
    ? await query.eq("id", id).single()
    : await query.eq("slug", id).single();

  if (error) {
    console.error("Failed to load article:", error.message);
    return null;
  }

  return data as Article;
}

async function getRelatedArticles(article: Article) {
  const { data, error } = await supabase
    .from("articles")
    .select(ARTICLE_SELECT)
    .eq("category", article.category)
    .neq("id", article.id)
    .order("created_at", { ascending: false })
    .limit(3);

  if (error) {
    console.error("Failed to load related articles:", error.message);
    return [];
  }

  return (data ?? []) as Article[];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const article = await getArticle(id);
  const siteUrl = getPublicSiteUrl();

  if (!article) {
    return {
      title: "Article not found | World News Simply",
      description: "The requested article could not be found.",
    };
  }

  const url = `${siteUrl}${getArticlePath(article)}`;

  return {
    title: {
      absolute: `${article.title} | World News Simply`,
    },
    description: article.summary,
    keywords: article.title.split(/\s+/).filter(Boolean).join(", "),
    alternates: {
      canonical: url,
    },
    openGraph: {
      title: article.title,
      description: article.summary,
      url,
      siteName: "World News Simply",
      type: "article",
      publishedTime: article.created_at,
      images: [{ url: article.image_url, alt: article.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: article.title,
      description: article.summary,
      images: [article.image_url],
    },
  };
}

function Icon({ name }: { name: "search" | "sun" | "moon" | "globe" }) {
  if (name === "search") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="m21 21-4.3-4.3m1.3-5.2a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />
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

function ArticleNavbar() {
  return (
    <header className="site-header">
      <div className="top-accent" />
      <nav className="site-navbar" aria-label="Article navigation">
        <div className="site-navbar-inner">
          <Link href="/" className="brand-logo" aria-label="World News Simply home">
            <span className="brand-globe">
              <Icon name="globe" />
            </span>
            <span>World News Simply</span>
          </Link>
          <div className="desktop-nav">
            <ScrollLink href="/">Home</ScrollLink>
            <ScrollLink href="/?category=World">World</ScrollLink>
            <ScrollLink href="/?category=Politics">Politics</ScrollLink>
            <ScrollLink href="/?category=Technology">Technology</ScrollLink>
            <ScrollLink href="/?category=Business">Business</ScrollLink>
            <ScrollLink href="/?category=Sports">Sports</ScrollLink>
            <ScrollLink href="/?category=Health">Health</ScrollLink>
            <ScrollLink href="/?category=Opinion">Opinion</ScrollLink>
          </div>
          <div className="nav-actions">
            <SearchPanel />
            <ThemeToggle />
            <MobileMenu categories={navCategories} regions={navRegions} />
          </div>
        </div>
      </nav>
    </header>
  );
}

function ShareButtons({ article }: { article: Article }) {
  return (
    <div className="share-buttons article-share-buttons" aria-label={`Share ${article.title}`}>
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
      <span>{estimateReadingTime(article)}</span>
    </div>
  );
}

function AuthorAvatar() {
  return (
    <div className="author-chip article-author-chip">
      <span aria-hidden="true">W</span>
      <strong>World News Simply Staff</strong>
    </div>
  );
}

function RelatedArticles({ articles }: { articles: Article[] }) {
  if (articles.length === 0) {
    return null;
  }

  return (
    <section className="related-section" aria-labelledby="related-heading">
      <div className="section-heading-row">
        <h2 id="related-heading">Related Articles</h2>
        <span>More from this section</span>
      </div>
      <div className="related-grid">
        {articles.map((article) => (
          <article key={article.id} className="story-card">
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
                <h3>{article.title}</h3>
                <p>{article.summary}</p>
              </div>
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const article = await getArticle(id);

  if (!article) {
    notFound();
  }

  const relatedArticles = await getRelatedArticles(article);
  const paragraphs = article.content
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const siteUrl = getPublicSiteUrl();
  const articleUrl = `${siteUrl}${getArticlePath(article)}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title,
    description: article.summary,
    image: article.image_url,
    datePublished: article.created_at,
    dateModified: article.created_at,
    author: {
      "@type": "Organization",
      name: "World News Simply",
    },
    publisher: {
      "@type": "Organization",
      name: "World News Simply",
      logo: {
        "@type": "ImageObject",
        url: `${siteUrl}/favicon.ico`,
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": articleUrl,
    },
  };
  const breadcrumbData = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: siteUrl,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: article.category,
        item: `${siteUrl}/?category=${encodeURIComponent(article.category)}`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: article.title,
      },
    ],
  };

  return (
    <main className="news-shell article-shell">
      <ScrollEnhancements />
      <ArticleNavbar />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbData) }}
      />

      <article className="article-page">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link href="/">Home</Link>
          <span>/</span>
          <ScrollLink href={`/?category=${article.category}`}>{article.category}</ScrollLink>
          <span>/</span>
          <span>{article.title}</span>
        </nav>

        <header className="article-header">
          <StatusBadges article={article} />
          <ArticleMeta article={article} />
          <h1>{article.title}</h1>
          <p>{article.summary}</p>
          {article.category === "Opinion" || article.article_type === "opinion" ? (
            <AuthorAvatar />
          ) : null}
          <div className="article-byline">
            <span>By World News Simply Staff</span>
            <time dateTime={article.created_at}>{formatDate(article.created_at)}</time>
            <span>{getViewCount(article)} views</span>
            <span>Updated {formatTimeAgo(article.created_at)}</span>
          </div>
          <ShareButtons article={article} />
        </header>

        <div className="article-hero-image">
          <Image
            src={article.image_url}
            alt={article.title}
            fill
            priority
            sizes="(max-width: 768px) 100vw, 1120px"
          />
        </div>

        <div className={article.article_type === "long-read" ? "article-body long-read-body" : "article-body"}>
          {paragraphs.length > 0 ? (
            paragraphs.map((paragraph, index) => (
              <div key={paragraph}>
                {article.article_type === "long-read" && index === 2 ? (
                  <blockquote className="pull-quote">{article.summary}</blockquote>
                ) : null}
                {paragraph.startsWith("## ") ? <h2>{paragraph.replace(/^##\s+/, "")}</h2> : <p>{paragraph}</p>}
              </div>
            ))
          ) : (
            <p>{article.content}</p>
          )}
        </div>

        <div className="article-footer-actions">
          <Link href="/">Back to homepage</Link>
          {article.source_url ? (
            <a href={article.source_url} target="_blank" rel="noopener noreferrer">
              Read original article
            </a>
          ) : null}
        </div>
      </article>

      <div className="page-wrap">
        <RelatedArticles articles={relatedArticles} />
      </div>
    </main>
  );
}
