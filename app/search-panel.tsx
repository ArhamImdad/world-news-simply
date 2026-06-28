"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, type Article } from "@/lib/supabase";

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m21 21-4.3-4.3m1.3-5.2a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function SearchSkeleton() {
  return (
    <div className="search-results-grid" aria-label="Loading search results">
      {[0, 1, 2].map((item) => (
        <article key={item} className="search-card search-card-skeleton animate-pulse">
          <div className="search-card-image skeleton" />
          <div className="search-card-body">
            <div className="skeleton skeleton-line skeleton-line-short" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line skeleton-line-medium" />
          </div>
        </article>
      ))}
    </div>
  );
}

function highlightSafeText(value: string) {
  return value.length > 150 ? `${value.slice(0, 150)}...` : value;
}

export default function SearchPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Article[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = useMemo(() => query.trim(), [query]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    window.setTimeout(() => inputRef.current?.focus(), 80);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    if (normalizedQuery.length < 2) {
      return;
    }

    let isCurrent = true;
    const timeout = window.setTimeout(async () => {
      setIsLoading(true);
      setHasSearched(true);

      const escapedQuery = normalizedQuery
        .replace(/[,%()]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const { data, error } = await supabase
        .from("articles")
        .select("*")
        .or(`title.ilike.%${escapedQuery}%,content.ilike.%${escapedQuery}%`)
        .order("created_at", { ascending: false })
        .limit(12);

      if (!isCurrent) return;

      if (error) {
        console.error("Search failed:", error.message);
        setResults([]);
      } else {
        setResults((data ?? []) as Article[]);
      }

      setIsLoading(false);
    }, 300);

    return () => {
      isCurrent = false;
      window.clearTimeout(timeout);
    };
  }, [isOpen, normalizedQuery]);

  const closeSearch = () => {
    setIsOpen(false);
    setQuery("");
    setResults([]);
    setHasSearched(false);
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);

    if (value.trim().length < 2) {
      setResults([]);
      setIsLoading(false);
      setHasSearched(false);
    }
  };

  return (
    <>
      <button
        className="icon-button"
        type="button"
        aria-label="Search"
        aria-expanded={isOpen}
        suppressHydrationWarning
        onClick={() => setIsOpen(true)}
      >
        <SearchIcon />
      </button>
      <section className={isOpen ? "search-panel search-panel-open" : "search-panel"} aria-hidden={!isOpen}>
        <div className="search-panel-inner" ref={panelRef}>
          <div className="search-input-row">
            <SearchIcon />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              type="search"
              placeholder="Search headlines, topics, and full articles"
              aria-label="Search articles"
            />
            <button
              type="button"
              aria-label="Close search"
              suppressHydrationWarning
              onClick={closeSearch}
            >
              <CloseIcon />
            </button>
          </div>

          {isLoading ? <SearchSkeleton /> : null}

          {!isLoading && results.length > 0 ? (
            <div className="search-results-grid">
              {results.map((article) => (
                <article key={article.id} className="search-card">
                  <Link href={`/article/${article.id}`} onClick={closeSearch}>
                    <div className="search-card-image">
                      <Image
                        src={article.image_url}
                        alt={article.title}
                        fill
                        sizes="(max-width: 768px) 90vw, 320px"
                      />
                    </div>
                    <div className="search-card-body">
                      <span>{article.category}</span>
                      <h3>{article.title}</h3>
                      <p>{highlightSafeText(article.summary || article.content)}</p>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          ) : null}

          {!isLoading && hasSearched && results.length === 0 ? (
            <div className="search-empty">
              <h2>No results found</h2>
              <p>Try another keyword or a broader topic.</p>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
