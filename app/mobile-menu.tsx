"use client";

import { useEffect, useRef, useState } from "react";
import ScrollLink from "./scroll-link";
import SearchPanel from "./search-panel";
import ThemeToggle from "./theme-toggle";

type MobileMenuProps = {
  categories: string[];
  regions: string[];
  activeCategory?: string;
};

function MenuIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 7h16M4 12h16M4 17h16" />
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

export default function MobileMenu({ categories, regions, activeCategory = "All" }: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.body.classList.add("mobile-menu-locked");
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.body.classList.remove("mobile-menu-locked");
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen]);

  const closeMenu = () => setIsOpen(false);

  return (
    <>
      <button
        type="button"
        className="mobile-menu-trigger"
        aria-label="Open navigation menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
        suppressHydrationWarning
      >
        <MenuIcon />
      </button>
      <div className={isOpen ? "mobile-overlay mobile-overlay-open" : "mobile-overlay"} aria-hidden={!isOpen}>
        <div className="mobile-overlay-panel" ref={panelRef}>
          <div className="mobile-overlay-header">
            <strong>World News Simply</strong>
            <button type="button" aria-label="Close navigation menu" onClick={closeMenu} suppressHydrationWarning>
              <CloseIcon />
            </button>
          </div>

          <div className="mobile-overlay-actions">
            <SearchPanel />
            <ThemeToggle label="Toggle dark mode in mobile menu" />
          </div>

          <nav aria-label="Mobile categories">
            <p>Sections</p>
            {categories.map((category) => {
              const label = category === "All" ? "Home" : category;
              const href = category === "All" ? "/" : `/?category=${category}`;
              return (
                <ScrollLink
                  key={category}
                  href={href}
                  className={activeCategory === category ? "mobile-overlay-link mobile-overlay-link-active" : "mobile-overlay-link"}
                  onClick={closeMenu}
                >
                  {label}
                </ScrollLink>
              );
            })}
          </nav>

          <nav aria-label="Mobile regions">
            <p>Regions</p>
            {regions
              .filter((region) => region !== "All")
              .map((region) => (
                <ScrollLink
                  key={region}
                  href={`/?region=${region}`}
                  className="mobile-overlay-link"
                  onClick={closeMenu}
                >
                  {region}
                </ScrollLink>
              ))}
          </nav>
        </div>
      </div>
    </>
  );
}
