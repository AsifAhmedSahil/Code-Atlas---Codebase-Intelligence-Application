"use client";

import { useSyncExternalStore } from "react";

type ThemeChoice = "system" | "light" | "dark";

const CHOICES: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const THEME_EVENT = "cartograph:theme";

function readThemeCookie(): ThemeChoice {
  const match = document.cookie.match(/(?:^|; )theme=([^;]*)/);
  const value = match ? decodeURIComponent(match[1]) : "system";
  return value === "light" || value === "dark" ? value : "system";
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(THEME_EVENT, callback);
  return () => window.removeEventListener(THEME_EVENT, callback);
}

const SERVER_THEME: ThemeChoice = "system";
function getServerTheme(): ThemeChoice {
  return SERVER_THEME;
}

/*
 * Writes the chosen theme to the root element and remembers it in a cookie.
 * This lives outside the component so the mutation of shared globals stays out
 * of render. The stored choice is applied before paint by the inline script in
 * the root layout; this only needs to react to a click.
 */
function applyTheme(next: ThemeChoice): void {
  document.documentElement.setAttribute("data-theme", next);
  document.cookie = `theme=${next}; path=/; max-age=31536000; SameSite=Lax`;
  window.dispatchEvent(new Event(THEME_EVENT));
}

/*
 * Three states, read from the cookie the inline script also honours. The value
 * comes from an external store rather than effect-driven state, so there is no
 * cascading render and no hydration mismatch.
 */
export function ThemeToggle() {
  const choice = useSyncExternalStore(
    subscribe,
    readThemeCookie,
    getServerTheme
  );

  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex items-center overflow-hidden rounded border border-border text-[11px] leading-none"
    >
      {CHOICES.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => applyTheme(option.value)}
          aria-pressed={choice === option.value}
          className={`px-2 py-1 transition-colors ${
            choice === option.value
              ? "bg-accent text-white"
              : "text-muted hover:text-text"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
