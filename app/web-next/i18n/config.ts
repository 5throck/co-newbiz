// Single import point for all locale knowledge (design 2026-10-23-i18n-ui-adoption, D1/D2).
//
// Catalog key mapping: the design's keys are flat dot-namespaced paths
// ("common.appName"); next-intl resolves nested JSON objects, so the catalog
// files under ../locales/ use nested objects whose leaf paths equal the dot
// keys — {"common": {"appName": ...}} ↔ "common.appName".
//
// Extension surface: the workspace i18n-locale-config skill's 16-locale
// baseline (en, ko, ja, zh-CN, zh-TW, de, es, fr, pt, vi, ms, id, th, ru,
// it, ar). Adding a locale = a catalog file + an entry in `locales` (plus a
// direction/intlTag entry here). BCP 47 canonical tags only.

export const locales = ["ko", "en"] as const;
export type Locale = (typeof locales)[number];

/** Locale served when nothing negotiates, and the catalog master locale: a
 * missing key in any other catalog fails closed to the ko string (D2). */
export const defaultLocale: Locale = "ko";
export const masterLocale: Locale = "ko";

/** Locale cookie read by i18n/request.ts and written by LocaleSwitcher. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

const DIRECTIONS: Record<Locale, "ltr" | "rtl"> = {
  ko: "ltr",
  en: "ltr",
  // RTL seam — future additions go here instead of layout branches (§3.3):
  // ar: "rtl",
};

/** The 16-locale baseline of skills/i18n-locale-config (extension surface only). */
export const LOCALE_BASELINE = [
  "en",
  "ko",
  "ja",
  "zh-CN",
  "zh-TW",
  "de",
  "es",
  "fr",
  "pt",
  "vi",
  "ms",
  "id",
  "th",
  "ru",
  "it",
  "ar",
] as const;

/** Intl-compatible BCP 47 tag for Intl.* APIs. */
const INTL_TAGS: Record<Locale, string> = {
  ko: "ko-KR",
  en: "en-US",
};

export function isLocale(x: unknown): x is Locale {
  return typeof x === "string" && (locales as readonly string[]).includes(x);
}

export function localeDirection(locale: Locale): "ltr" | "rtl" {
  return DIRECTIONS[locale];
}

export function intlTag(locale: Locale): string {
  return INTL_TAGS[locale];
}

/** A resolved-message lookup bound to a locale (the shape of next-intl's t(), including its optional ICU values argument). Label-map constants store full catalog keys; components resolve them through a TranslatorFn at render. */
export type TranslatorFn = (key: string, values?: Record<string, string | number | Date>) => string;
