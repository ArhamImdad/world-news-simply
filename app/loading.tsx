import ScrollEnhancements from "./scroll-enhancements";

function CardSkeleton({ index }: { index: number }) {
  return (
    <article className="story-card card-skeleton animate-pulse" style={{ animationDelay: `${index * 60}ms` }}>
      <div className="story-card-image skeleton" />
      <div className="story-card-body">
        <div className="skeleton skeleton-line skeleton-line-short" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line skeleton-line-medium" />
      </div>
    </article>
  );
}

function SectionSkeleton({ title }: { title: string }) {
  return (
    <section className="category-section section-skeleton animate-pulse" aria-label={`${title} loading`}>
      <div className="category-section-header">
        <div className="skeleton skeleton-heading" />
        <div className="skeleton skeleton-button" />
      </div>
      <div className="category-card-grid">
        {[0, 1, 2].map((item) => (
          <CardSkeleton key={item} index={item} />
        ))}
      </div>
    </section>
  );
}

export default function Loading() {
  return (
    <main className="news-shell">
      <ScrollEnhancements />
      <header className="site-header">
        <div className="top-accent" />
        <div className="site-navbar">
          <div className="site-navbar-inner animate-pulse">
            <div className="skeleton skeleton-logo" />
            <div className="skeleton skeleton-nav" />
            <div className="skeleton skeleton-actions" />
          </div>
        </div>
      </header>
      <div className="skeleton ticker-skeleton animate-pulse" />
      <div className="skeleton market-skeleton animate-pulse" />

      <div className="page-wrap">
        <nav className="region-tabs animate-pulse" aria-label="Loading regional filters">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <span key={item} className="skeleton skeleton-tab" />
          ))}
        </nav>

        <section className="hero-grid hero-skeleton animate-pulse" aria-label="Homepage hero loading">
          <div className="hero-lead">
            <div className="hero-image skeleton" />
            <div className="hero-copy">
              <div className="skeleton skeleton-line skeleton-line-short" />
              <div className="skeleton skeleton-title-xl" />
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line skeleton-line-medium" />
            </div>
          </div>
          <div className="hero-stack">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="stack-story stack-story-skeleton">
                <div className="stack-thumb skeleton" />
                <div>
                  <div className="skeleton skeleton-line skeleton-line-short" />
                  <div className="skeleton skeleton-line" />
                  <div className="skeleton skeleton-line skeleton-line-medium" />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="editors-section animate-pulse" aria-label="Editor's Pick loading">
          <div className="section-heading-row">
            <div className="skeleton skeleton-heading" />
            <div className="skeleton skeleton-button" />
          </div>
          <div className="editors-grid">
            {[0, 1, 2].map((item) => (
              <div key={item} className="editors-card skeleton" />
            ))}
          </div>
        </section>

        <section className="breaking-section animate-pulse" aria-label="Breaking News loading">
          <div className="section-heading-row">
            <div className="skeleton skeleton-heading" />
            <div className="skeleton skeleton-button" />
          </div>
          <div className="breaking-grid">
            {[0, 1, 2, 3].map((item) => (
              <CardSkeleton key={item} index={item} />
            ))}
          </div>
        </section>
      </div>

      <section className="featured-banner featured-banner-skeleton animate-pulse" aria-label="Featured story loading">
        <div className="featured-banner-content">
          <div className="skeleton skeleton-line skeleton-line-short" />
          <div className="skeleton skeleton-title-xl" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line skeleton-line-medium" />
        </div>
      </section>

      <section className="video-section page-wrap animate-pulse" aria-label="Video News loading">
        <div className="section-heading-row">
          <div className="skeleton skeleton-heading" />
          <div className="skeleton skeleton-button" />
        </div>
        <div className="video-grid">
          {[0, 1, 2, 3].map((item) => (
            <CardSkeleton key={item} index={item} />
          ))}
        </div>
      </section>

      <section className="opinion-section animate-pulse" aria-label="Opinion loading">
        <div className="opinion-inner">
          <div className="section-heading-row">
            <div className="skeleton skeleton-heading" />
            <div className="skeleton skeleton-button" />
          </div>
          <div className="opinion-grid">
            {[0, 1, 2].map((item) => (
              <CardSkeleton key={item} index={item} />
            ))}
          </div>
        </div>
      </section>

      <div className="page-wrap content-with-sidebar">
        <div className="category-sections">
          {["World", "Politics", "Technology", "Business", "Sports", "Health"].map((section) => (
            <SectionSkeleton key={section} title={section} />
          ))}
        </div>
        <aside className="homepage-sidebar animate-pulse" aria-label="Trending Now loading">
          <div className="weather-widget">
            <div className="skeleton skeleton-weather-icon" />
            <div>
              <div className="skeleton skeleton-line skeleton-line-short" />
              <div className="skeleton skeleton-heading" />
            </div>
          </div>
          <div className="trending-now">
            <div className="skeleton skeleton-heading" />
            {[0, 1, 2, 3, 4].map((item) => (
              <div key={item} className="trending-skeleton-row">
                <div className="skeleton skeleton-number" />
                <div>
                  <div className="skeleton skeleton-line skeleton-line-short" />
                  <div className="skeleton skeleton-line" />
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <section className="long-reads-section animate-pulse" aria-label="Long Reads loading">
        <div className="page-wrap">
          <div className="section-heading-row">
            <div className="skeleton skeleton-heading" />
            <div className="skeleton skeleton-button" />
          </div>
          <div className="long-read-hero skeleton" />
        </div>
      </section>
    </main>
  );
}
