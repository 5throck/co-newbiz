"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

// Light/dark toggle for the Onyx 3.0 theme system. The chosen theme is
// persisted in localStorage ("cn-theme") and applied pre-paint by the inline
// script in app/layout.tsx; this component flips the html[data-theme]
// attribute, which both the CSS tokens ([data-theme="dark"] block) and the
// ECharts palette (useChartTheme MutationObserver) react to.
export function ThemeToggle({ compact = false }: { compact?: boolean } = {}) {
  const t = useTranslations("components.themeToggle");
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setTheme(current);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("cn-theme", next);
    } catch {
      // localStorage unavailable (private mode) — theme applies for this page view only.
    }
    setTheme(next);
  }

  const label = theme === "dark" ? t("light") : t("dark");
  return (
    <button
      type="button"
      onClick={toggle}
      className={compact ? "theme-toggle-compact" : "side-nav-link theme-toggle"}
      aria-label={label}
      aria-pressed={theme === "dark"}
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      <span>{label}</span>
    </button>
  );
}
