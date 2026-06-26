import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import ScrollEnhancements from "./scroll-enhancements";
import { supabase, type Article } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const categories = [
  "All",
  "World",
  "Politics",
  "Technology",
  "Business",
  "Sports",
  "Health",
];

const categorySectionNames = categories.filter((category) => category !== "All");

const categoryAccentColors: Record<string, string> = {
  World: "#dc2626",
  Politics: "#7c3aed",
  Technology: "#2563eb",
  Business: "#059669",
  Sports: "#ea580c",
  Health: "#0891b2",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function getSourceName(sourceUrl: string) {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return "Original source";
  }
}

async function getArticles(category?: string) {
  let query = supabase
    .from("articles")
    .select("id,title,content,summary,image_url,source_url,category,created_at")
    .order("created_at", { ascending: false })
    .limit(90);

  if (category && categories.includes(category) && category !== "All") {
    query = query.eq("category", category);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Failed to load articles:", error.message);
    return [];
  }

  return (data ?? []) as Article[];
}

function Logo() {
  return (
    <Link href="/" className="brand-logo" aria-label="World News Simply home">
      <span className="brand-mark" aria-hidden="true">
        <span className="brand-mark-ring" />
        <span className="brand-mark-latitude" />
        <span className="brand-mark-meridian" />
      </span>
      <span className="brand-wordmark">
        <span>World News</span>
        <span>Simply</span>
      </span>
    </Link>
  );
}

function MobileCategoryMenu({ activeCategory }: { activeCategory: string }) {
  return (
    <details className="mobile-category-menu">
      <summary aria-label={`Open news categories. Current category: ${activeCategory}`}>
        <span className="sr-only">Open news categories</span>
        <span className="hamburger-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </summary>
      <div className="mobile-category-list">
        {categories.map((category) => {
          const isActive = activeCategory === category;
          const href = category === "All" ? "/" : `/?category=${category}`;

          return (
            <Link
              key={category}
              href={href}
              className={`mobile-category-link ${
                isActive ? "mobile-category-link-active" : ""
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              {category}
            </Link>
          );
        })}
      </div>
    </details>
  );
}

function Navbar({ activeCategory = "All" }: { activeCategory?: string }) {
  return (
    <nav className="site-navbar sticky top-0 z-40 bg-zinc-950 text-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-4 sm:px-8">
        <div className="nav-left">
          <Logo />
        </div>
        <MobileCategoryMenu activeCategory={activeCategory} />
        <div className="hidden items-center gap-4 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400 sm:flex">
          <span>Simple English</span>
          <span className="h-1 w-1 rounded-full bg-zinc-600" />
          <span>Global Briefing</span>
        </div>
      </div>
    </nav>
  );
}

function CategoryFilter({ activeCategory }: { activeCategory: string }) {
  return (
    <div className="category-nav">
      <div className="category-rail" aria-label="Article categories">
        {categories.map((category) => {
          const isActive = activeCategory === category;
          const href = category === "All" ? "/" : `/?category=${category}`;

          return (
            <Link
              key={category}
              href={href}
              className={`category-pill ${isActive ? "category-pill-active" : ""}`}
              aria-current={isActive ? "page" : undefined}
            >
              {category}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function NewsTicker({ articles }: { articles: Article[] }) {
  const headlines = articles.slice(0, 10).map((article) => article.title);

  if (headlines.length === 0) {
    return null;
  }

  const tickerText = headlines.join("  |  ");

  return (
    <section className="news-ticker" aria-label="Live latest headlines">
      <div className="news-ticker-label">
        <span aria-hidden="true" />
        <strong>LIVE</strong>
      </div>
      <div className="news-ticker-track">
        <div className="news-ticker-content">
          <span>{tickerText}</span>
          <span aria-hidden="true">{tickerText}</span>
        </div>
      </div>
    </section>
  );
}

function SectionHeader({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: string;
  detail?: string;
}) {
  return (
    <div className="section-header">
      <div>
        <p className="section-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}

function CategorySection({
  category,
  articles,
}: {
  category: string;
  articles: Article[];
}) {
  const sectionArticles = articles.slice(0, 3);

  if (sectionArticles.length === 0) {
    return null;
  }

  return (
    <section className="category-section">
      <div className="category-section-header">
        <h2 style={{ borderLeftColor: categoryAccentColors[category] }}>
          {category}
        </h2>
        <Link href={`/?category=${category}`} className="see-more-link">
          See More -&gt;
        </Link>
      </div>
      <div className="category-section-grid">
        {sectionArticles.map((article, index) => (
          <CompactArticleCard key={article.id} article={article} index={index} />
        ))}
      </div>
    </section>
  );
}

function CompactArticleCard({
  article,
  index,
}: {
  article: Article;
  index: number;
}) {
  return (
    <article
      className="compact-card-stagger"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <Link href={`/article/${article.id}`} className="compact-article-card">
        <div className="compact-article-media">
          <Image
            src={article.image_url}
            alt={article.title}
            fill
            sizes="(max-width: 640px) 78vw, (max-width: 1024px) 33vw, 360px"
          />
        </div>
        <div className="compact-article-body">
          <div className="compact-article-meta">
            <span>{article.category}</span>
            <time dateTime={article.created_at}>
              {formatDate(article.created_at)}
            </time>
          </div>
          <h3>{article.title}</h3>
          <p>{article.summary}</p>
        </div>
      </Link>
    </article>
  );
}

function ArticleCard({ article, index }: { article: Article; index: number }) {
  return (
    <article className="card-stagger" style={{ animationDelay: `${index * 80}ms` }}>
      <Link href={`/article/${article.id}`} className="article-card group">
        <div className="article-card-media">
          <Image
            src={article.image_url}
            alt={article.title}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 420px"
          />
        </div>
        <div className="article-card-body">
          <div className="article-meta">
            <span>{article.category}</span>
            <time dateTime={article.created_at}>{formatDate(article.created_at)}</time>
          </div>
          <h3>{article.title}</h3>
          <p>{article.summary}</p>
          <div className="article-source">
            <span>{getSourceName(article.source_url)}</span>
            <span>Read article</span>
          </div>
        </div>
      </Link>
    </article>
  );
}

function PageSkeleton() {
  return (
    <main className="min-h-screen bg-[#f7f7f4] text-zinc-950">
      <ScrollEnhancements />
      <Navbar />
      <div className="h-11 bg-zinc-950" />
      <section className="mx-auto max-w-7xl px-5 py-6 sm:px-8">
        <div className="mb-8 flex gap-3 overflow-hidden">
          {categories.map((category) => (
            <div key={category} className="skeleton h-11 w-28 shrink-0 rounded-full" />
          ))}
        </div>
        <div className="skeleton h-[520px] rounded-lg" />
      </section>
      <section className="mx-auto grid max-w-7xl gap-5 px-5 pb-16 sm:grid-cols-2 sm:px-8 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div key={item} className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="skeleton aspect-[16/10]" />
            <div className="space-y-4 p-5">
              <div className="skeleton h-4 w-28 rounded" />
              <div className="skeleton h-7 w-full rounded" />
              <div className="skeleton h-4 w-5/6 rounded" />
              <div className="skeleton h-4 w-2/3 rounded" />
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}

async function NewsContent({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const selectedCategory = (await searchParams).category ?? "All";
  const activeCategory = categories.includes(selectedCategory)
    ? selectedCategory
    : "All";
  const allArticles = await getArticles();
  const activeArticles =
    activeCategory === "All"
      ? allArticles
      : allArticles.filter((article) => article.category === activeCategory);
  const [latestArticle, ...otherArticles] = activeArticles;
  const featuredArticles = otherArticles.slice(0, 2);
  const gridArticles = otherArticles.slice(2);

  return (
    <main className="min-h-screen bg-[#f7f7f4] text-zinc-950">
      <ScrollEnhancements />
      <Navbar activeCategory={activeCategory} />
      <NewsTicker articles={allArticles} />

      <section className="front-page">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="front-page-header">
            <p className="section-eyebrow">World News Simply</p>
            <h1>Today&apos;s global briefing, written simply.</h1>
            <p>
              Fresh AI-assisted summaries from trusted sources, rewritten for
              clarity and quick reading.
            </p>
          </div>

          <CategoryFilter activeCategory={activeCategory} />

          {latestArticle ? (
            <Link href={`/article/${latestArticle.id}`} className="lead-story">
              <div className="lead-media">
                <Image
                  src={latestArticle.image_url}
                  alt={latestArticle.title}
                  fill
                  priority
                  sizes="(max-width: 1024px) 100vw, 58vw"
                />
                <div className="lead-overlay" />
                <div className="lead-label">
                  <span>{latestArticle.category}</span>
                  <time dateTime={latestArticle.created_at}>
                    {formatDate(latestArticle.created_at)}
                  </time>
                </div>
              </div>
              <div className="lead-content">
                <p className="section-eyebrow">Latest Story</p>
                <h2>{latestArticle.title}</h2>
                <p>{latestArticle.summary}</p>
                <div className="lead-footer">
                  <span>{getSourceName(latestArticle.source_url)}</span>
                  <span>Read the full briefing</span>
                </div>
              </div>
            </Link>
          ) : (
            <div className="empty-state">
              <p className="section-eyebrow">No Stories Yet</p>
              <h2>Your newsroom is ready.</h2>
              <p>Run the news fetcher to publish the first automated briefings.</p>
            </div>
          )}
        </div>
      </section>

      {featuredArticles.length > 0 ? (
        <section className="mx-auto max-w-7xl px-5 pb-14 sm:px-8">
          <SectionHeader
            eyebrow="Editor Picks"
            title="Worth reading next"
            detail="Fresh stories selected from the latest run."
          />
          <div className="featured-grid">
            {featuredArticles.map((article, index) => (
              <ArticleCard key={article.id} article={article} index={index} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mx-auto max-w-7xl px-5 pb-16 sm:px-8">
        <SectionHeader
          eyebrow="Browse by Category"
          title="Sections"
          detail="Three latest stories from each desk"
        />
        <div className="category-sections">
          {categorySectionNames.map((category) => (
            <CategorySection
              key={category}
              category={category}
              articles={allArticles.filter(
                (article) => article.category === category
              )}
            />
          ))}
        </div>
      </section>

      {gridArticles.length > 0 ? (
        <section className="mx-auto max-w-7xl px-5 pb-20 sm:px-8">
          <SectionHeader
            eyebrow="Latest Briefings"
            title="More from the newsroom"
            detail="Newest first"
          />
          <div className="news-grid">
            {gridArticles.map((article, index) => (
              <ArticleCard key={article.id} article={article} index={index + 2} />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

export default function Home({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewsContent searchParams={searchParams} />
    </Suspense>
  );
}
