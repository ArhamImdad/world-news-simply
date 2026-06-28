"use client";

import { useTheme } from "./theme-provider";

function SunIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2-1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" />
    </svg>
  );
}

export default function ThemeToggle({ label = "Toggle dark mode" }: { label?: string }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={label}
      aria-pressed={theme === "dark"}
      onClick={toggleTheme}
      suppressHydrationWarning
    >
      <span className="theme-toggle-sun" aria-hidden="true">
        <SunIcon />
      </span>
      <span className="theme-toggle-moon" aria-hidden="true">
        <MoonIcon />
      </span>
    </button>
  );
}
