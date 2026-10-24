"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { LOCALE_COOKIE, locales, type Locale } from "../i18n/config.ts";

// Locale switcher — writes the NEXT_LOCALE cookie (the D3 negotiation seam;
// no route restructure) and refreshes so the server re-negotiates. Endonym
// labels come from the catalog (common.locale.*, same value in every
// catalog file). Compact pill styling follows ThemeToggle.
export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("common");

  function select(next: Locale) {
    if (next === locale) return;
    // secure only when the page itself is https (dev/local http must keep a working cookie)
    const secure = location.protocol === "https:" ? "; secure" : "";
    // biome-ignore lint/suspicious/noDocumentCookie: the locale preference cookie is intentionally client-set (the D3 negotiation seam); httpOnly is not applicable to a value the client writes
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax${secure}`;
    router.refresh();
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> would need UA-chrome resets that break the compact pill styling following ThemeToggle; role="group" + aria-label is the ARIA-equivalent for this labeled button group
    <div className="locale-switcher" role="group" aria-label={t("languageSwitcher")}>
      {locales.map((l) => (
        <button
          key={l}
          type="button"
          className="theme-toggle-compact"
          aria-pressed={l === locale}
          onClick={() => select(l)}
        >
          {t(`locale.${l}`)}
        </button>
      ))}
    </div>
  );
}
