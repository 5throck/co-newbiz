"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { LOCALE_COOKIE, locales, type Locale } from "../i18n/config.ts";

// Locale switcher — disclosure dropdown (house pattern: crud.tsx RowMenu /
// StageTabs More menu; form amendment 2026-10-24, user-directed). The trigger
// pill shows the ACTIVE locale's endonym plus a caret; the popup lists every
// locale in `i18n/config.ts` `locales` order as endonyms (common.locale.*,
// same value in every catalog file) with single-select semantics: the active
// entry is role="menuitemradio" + aria-checked under a role="menu" popup.
// Scales to the 16-locale baseline without growing the topbar row. Selection
// writes the NEXT_LOCALE cookie (the D3 negotiation seam; no route
// restructure) and refreshes so the server re-negotiates. Trigger pill
// styling follows ThemeToggle.
export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Focus the first item once the menu renders.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[0]?.focus({ preventScroll: true });
  }, [open]);

  // Outside pointerdown closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) close(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, close]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const els = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") close(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus({ preventScroll: true });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus({ preventScroll: true });
    } else if (e.key === "Home") {
      e.preventDefault();
      els[0]?.focus({ preventScroll: true });
    } else if (e.key === "End") {
      e.preventDefault();
      els[els.length - 1]?.focus({ preventScroll: true });
    }
  }

  function select(next: Locale) {
    if (next === locale) return;
    // secure only when the page itself is https (dev/local http must keep a working cookie)
    const secure = location.protocol === "https:" ? "; secure" : "";
    // biome-ignore lint/suspicious/noDocumentCookie: the locale preference cookie is intentionally client-set (the D3 negotiation seam); httpOnly is not applicable to a value the client writes
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax${secure}`;
    router.refresh();
  }

  return (
    <div className="locale-switcher">
      <button
        ref={triggerRef}
        type="button"
        className="theme-toggle-compact"
        aria-label={t("languageSwitcher")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {t(`locale.${locale}`)}
        <ChevronDown size={12} aria-hidden="true" focusable="false" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("languageSwitcher")}
          className="stage-tab-menu"
          onKeyDown={onMenuKeyDown}
        >
          {locales.map((l) => (
            <button
              key={l}
              type="button"
              role="menuitemradio"
              aria-checked={l === locale}
              className="stage-tab-menu-item row-menu-item"
              onClick={() => {
                close(true);
                select(l);
              }}
            >
              {t(`locale.${l}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
