"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useTransition } from "react";
import { supabase } from "@/lib/supabase";
import { ARTICLE_SELECT, type Article } from "@/types/article";

const PAGE_SIZE = 6;

function dedupeByTitle(articles: Article[]) {
  const seen = new Set<string>();
  return articles.filter((article) => {
    const key = article.title.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
}

function CategoryCard({ article, isNew }: { article: Article; isNew?: boolean }) {
  return (
    <article className={isNew ? "story-card load-more-new-card" : "story-card"}>
      <Link href={`/article/${article.id}`} className="story-card-link">
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
          <div className="article-meta article-meta-compact">
            <span className={article.category === "Opinion" ? "opinion-badge" : "category-badge"}>
              {article.category}
            </span>
            {article.region ? <span className="region-badge">{article.region}</span> : null}
            <time dateTime={article.created_at}>{formatDate(article.created_at)}</time>
          </div>
          <h3>{article.title}</h3>
          <p>{article.summary}</p>
          <div className="card-footer-meta">
            <span>World News Simply Staff</span>
          </div>
        </div>
      </Link>
    </article>
  );
}

export default function CategoryLoadMoreSection({
  category,
  initialArticles,
  accentColor,
}: {
  category: string;
  initialArticles: Article[];
  accentColor: string;
}) {
  const [articles, setArticles] = useState(() => dedupeByTitle(initialArticles).slice(0, PAGE_SIZE));
  const [offset, setOffset] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(initialArticles.length >= PAGE_SIZE);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  if (articles.length === 0) return null;

  const loadMore = () => {
    startTransition(async () => {
      const { data, error } = await supabase
        .from("articles")
        .select(ARTICLE_SELECT)
        .eq("category", category)
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        console.error(`Failed to load more ${category} articles:`, error.message);
        setHasMore(false);
        return;
      }

      const existingTitles = new Set(articles.map((article) => article.title.trim().toLowerCase()));
      const nextArticles = dedupeByTitle((data ?? []) as Article[]).filter(
        (article) => !existingTitles.has(article.title.trim().toLowerCase())
      );

      setArticles((current) => [...current, ...nextArticles]);
      setNewIds(new Set(nextArticles.map((article) => article.id)));
      setOffset((current) => current + PAGE_SIZE);
      setHasMore((data ?? []).length === PAGE_SIZE && nextArticles.length > 0);
    });
  };

  return (
    <section className="category-section">
      <div className="category-section-header">
        <h2 style={{ borderLeftColor: accentColor }}>{category}</h2>
        <Link href={`/?category=${category}`} className="see-all-link">
          See all {category} -&gt;
        </Link>
      </div>
      <div className="category-card-grid">
        {articles.map((article) => (
          <CategoryCard key={article.id} article={article} isNew={newIds.has(article.id)} />
        ))}
      </div>
      <div className="load-more-row">
        {hasMore ? (
          <button type="button" onClick={loadMore} disabled={isPending} suppressHydrationWarning>
            {isPending ? "Loading..." : "Load More"}
          </button>
        ) : (
          <span>No more articles</span>
        )}
      </div>
    </section>
  );
}
