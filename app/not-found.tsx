import Link from "next/link";

export default function NotFound() {
  return (
    <main className="news-shell error-shell">
      <section className="not-found-card">
        <p className="section-kicker">World News Simply</p>
        <h1>404</h1>
        <h2>This page could not be found</h2>
        <p>The article you&apos;re looking for may have been removed or doesn&apos;t exist.</p>
        <div className="error-actions">
          <Link href="/">Go Home</Link>
          <Link href="/?category=World">Latest News</Link>
        </div>
      </section>
    </main>
  );
}
