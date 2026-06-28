"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <main className="news-shell error-shell">
      <section className="not-found-card">
        <p className="section-kicker">Something went wrong</p>
        <h1>500</h1>
        <h2>Something went wrong</h2>
        <p>Please try again. If the issue continues, return to the homepage.</p>
        <div className="error-actions">
          <button type="button" onClick={reset}>
            Try Again
          </button>
          <Link href="/">Go Home</Link>
        </div>
      </section>
    </main>
  );
}
