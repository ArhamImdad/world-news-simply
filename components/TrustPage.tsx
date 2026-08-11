import Link from "next/link";
import Footer from "@/components/Footer";

export default function TrustPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <main className="news-shell">
      <header className="site-header">
        <div className="top-accent" />
        <nav className="site-navbar" aria-label="Publication navigation">
          <div className="site-navbar-inner">
            <Link href="/" className="brand-logo">World News Simply</Link>
            <Link href="/" className="nav-link">Back to news</Link>
          </div>
        </nav>
      </header>
      <article className="trust-page">
        <p className="section-kicker">Publication information</p>
        <h1>{title}</h1>
        <p className="trust-intro">{intro}</p>
        <div className="trust-content">{children}</div>
      </article>
      <Footer />
    </main>
  );
}
