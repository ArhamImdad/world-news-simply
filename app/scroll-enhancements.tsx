"use client";

import { useEffect, useState } from "react";

export default function ScrollEnhancements() {
  const [progress, setProgress] = useState(0);
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    const updateScrollState = () => {
      const scrollTop = window.scrollY;
      const scrollHeight =
        document.documentElement.scrollHeight - window.innerHeight;
      const nextProgress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;

      setProgress(nextProgress);
      setShowBackToTop(scrollTop > 300);
      document.documentElement.classList.toggle("is-scrolled", scrollTop > 8);
    };

    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);

    return () => {
      window.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
      document.documentElement.classList.remove("is-scrolled");
    };
  }, []);

  return (
    <>
      <div className="scroll-progress" style={{ width: `${progress}%` }} />
      <button
        type="button"
        aria-label="Back to top"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className={`back-to-top ${showBackToTop ? "back-to-top-visible" : ""}`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 5l-7 7m7-7 7 7M12 5v14" />
        </svg>
      </button>
    </>
  );
}
