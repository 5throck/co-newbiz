import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, defaultLocale, isLocale, locales, masterLocale, type Locale } from "./config.ts";

type Messages = Record<string, unknown>;

/**
 * D2 fail-closed merge: the active locale's messages are laid over the ko
 * master catalog, so a key missing from the active catalog resolves to the
 * ko string — never to a raw key or an empty string.
 */
function isPlainObject(v: unknown): v is Messages {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(master: Messages, override: Messages): Messages {
  const out: Messages = { ...master };
  for (const [k, v] of Object.entries(override)) {
    const m = out[k];
    out[k] = isPlainObject(m) && isPlainObject(v) ? deepMerge(m, v) : v;
  }
  return out;
}

/** D3 negotiation step 2: Accept-Language with q-values, matched against the
 * active locale set (exact tag first, then language subtag). */
function negotiateAcceptLanguage(header: string): Locale | null {
  const entries = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      let q = 1;
      for (const p of params) {
        const m = p.trim().match(/^q=([^\s]+)$/);
        if (m) q = Number.parseFloat(m[1]);
      }
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 1 };
    })
    .filter((e) => e.tag.length > 0 && e.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of entries) {
    const exact = locales.find((l) => l.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const base = (tag.split("-")[0] ?? tag).toLowerCase();
    const byBase = locales.find((l) => l.toLowerCase() === base);
    if (byBase) return byBase;
  }
  return null;
}

export default getRequestConfig(async () => {
  // D3: cookie → Accept-Language → defaultLocale. No [locale] route segment;
  // every URL is unchanged.
  const cookieValue = (await cookies()).get(LOCALE_COOKIE)?.value;
  const headerValue = (await headers()).get("accept-language");
  const locale: Locale =
    (isLocale(cookieValue) ? cookieValue : undefined) ??
    (headerValue ? negotiateAcceptLanguage(headerValue) : undefined) ??
    defaultLocale;

  const masterMessages = (await import(`../locales/${masterLocale}.json`)).default as Messages;
  const activeMessages =
    locale === masterLocale ? masterMessages : ((await import(`../locales/${locale}.json`)).default as Messages);

  return {
    locale,
    messages: deepMerge(masterMessages, activeMessages),
    // The deep merge pre-fills every ko key, so MISSING_MESSAGE only fires
    // for keys absent from both catalogs — a bug, but never a render breaker.
    onError() {},
    getMessageFallback({ namespace, key }: { namespace?: string; key: string }) {
      return [namespace, key].filter(Boolean).join(".");
    },
  };
});
