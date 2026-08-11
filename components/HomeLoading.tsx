import ScrollEnhancements from "@/app/scroll-enhancements";

export default function HomeLoading() {
  return (
    <main className="news-shell" aria-label="News homepage loading">
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
      <div className="page-wrap">
        <section className="hero-grid hero-skeleton animate-pulse" aria-label="Top stories loading">
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
                <div className="skeleton skeleton-line" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
