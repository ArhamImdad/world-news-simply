import ScrollEnhancements from "@/app/scroll-enhancements";

export default function ArticleLoading() {
  return (
    <main className="news-shell article-shell">
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

      <article className="article-page article-page-skeleton animate-pulse">
        <div className="breadcrumb">
          <span className="skeleton skeleton-line skeleton-line-short" />
        </div>
        <header className="article-header">
          <div className="skeleton skeleton-line skeleton-line-short" />
          <div className="skeleton skeleton-article-title" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line skeleton-line-medium" />
          <div className="skeleton skeleton-button-row" />
        </header>
        <div className="article-hero-image skeleton" />
        <div className="article-loading-layout">
          <div className="article-body">
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <div key={item}>
                <div className="skeleton skeleton-line" />
                <div className="skeleton skeleton-line" />
                <div className="skeleton skeleton-line skeleton-line-medium" />
              </div>
            ))}
          </div>
          <aside className="article-loading-sidebar">
            <div className="skeleton skeleton-heading" />
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="trending-skeleton-row">
                <div className="skeleton skeleton-number" />
                <div>
                  <div className="skeleton skeleton-line skeleton-line-short" />
                  <div className="skeleton skeleton-line" />
                </div>
              </div>
            ))}
          </aside>
        </div>
      </article>

      <div className="page-wrap">
        <section className="related-section animate-pulse" aria-label="Related articles loading">
          <div className="section-heading-row">
            <div className="skeleton skeleton-heading" />
            <div className="skeleton skeleton-button" />
          </div>
          <div className="related-grid">
            {[0, 1, 2].map((item) => (
              <article key={item} className="story-card">
                <div className="story-card-image skeleton" />
                <div className="story-card-body">
                  <div className="skeleton skeleton-line skeleton-line-short" />
                  <div className="skeleton skeleton-line" />
                  <div className="skeleton skeleton-line" />
                  <div className="skeleton skeleton-line skeleton-line-medium" />
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
