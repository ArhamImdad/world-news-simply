"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ScrollLink from "./scroll-link";
import ThemeToggle from "./theme-toggle";

type MobileMenuProps = {
  categories: string[];
  regions: string[];
  activeCategory?: string;
};

const footerLinks = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

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
  const drawerId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const trigger = triggerRef.current;
    const closeMenuAtDesktopWidth = () => {
      if (window.innerWidth > 1080) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;

      const focusableElements = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);

      if (!firstElement || !lastElement) return;
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.body.classList.add("mobile-menu-locked");
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeMenuAtDesktopWidth);
    closeButtonRef.current?.focus();

    return () => {
      document.body.classList.remove("mobile-menu-locked");
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeMenuAtDesktopWidth);
      trigger?.focus();
    };
  }, [isOpen]);

  const closeMenu = () => setIsOpen(false);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="mobile-menu-trigger"
        aria-label="Open navigation menu"
        aria-controls={drawerId}
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
        suppressHydrationWarning
      >
        <MenuIcon />
      </button>

      {isOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="mobile-overlay mobile-overlay-open"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeMenu();
              }}
            >
              <div
                id={drawerId}
                className="mobile-overlay-panel"
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label="Mobile navigation"
              >
                <div className="mobile-overlay-header">
                  <strong>World News Simply</strong>
                  <button
                    ref={closeButtonRef}
                    type="button"
                    aria-label="Close navigation menu"
                    onClick={closeMenu}
                    suppressHydrationWarning
                  >
                    <CloseIcon />
                  </button>
                </div>

                <div className="mobile-overlay-scroll">
                  <nav aria-label="Mobile categories">
                    <p>Sections</p>
                    {categories.map((category) => {
                      const label = category === "All" ? "Home" : category;
                      const href = category === "All" ? "/" : `/?category=${category}`;
                      const isActive = activeCategory === category;
                      return (
                        <ScrollLink
                          key={category}
                          href={href}
                          className={isActive ? "mobile-overlay-link mobile-overlay-link-active" : "mobile-overlay-link"}
                          aria-current={isActive ? "page" : undefined}
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

                  <nav className="mobile-overlay-footer" aria-label="Mobile utility links">
                    {footerLinks.map((link) => (
                      <ScrollLink key={link.href} href={link.href} onClick={closeMenu}>
                        {link.label}
                      </ScrollLink>
                    ))}
                  </nav>

                  <div className="mobile-overlay-actions">
                    <span>Appearance</span>
                    <ThemeToggle label="Toggle dark mode in mobile menu" />
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
