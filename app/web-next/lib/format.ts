/**
 * Shared formatting utilities for KRW-millions money fields (ADR-0061).
 * All monetary quantities in the system are INTEGER KRW millions; this
 * module renders them with explicit unit labels so the UI never shows a
 * bare number without context.
 *
 * Locale-aware helpers (design 2026-10-23-i18n-ui-adoption §3.4): every
 * helper takes an optional locale (default "ko") and renders through Intl
 * with the BCP 47 tag from i18n/config. The ko rendering of every helper is
 * byte-identical to the pre-centralization `toLocaleString("ko-KR", …)`
 * call sites — pinned by unit tests.
 */

import { intlTag, isLocale } from "../i18n/config.ts";

export type { Locale } from "../i18n/config.ts";
import type { Locale } from "../i18n/config.ts";

/**
 * Locale inputs accept plain strings (next-intl's useLocale()/getLocale()
 * return string) and fail closed to "ko" for anything outside the active
 * set — same direction as the request-time negotiation fallback.
 */
function asLocale(locale: Locale | string): Locale {
  return isLocale(locale) ? locale : "ko";
}

/** Thousand-grouped number (ko convention == the old `toLocaleString("ko-KR", opts)` sites). */
export function formatNumber(
  value: number,
  locale: Locale | string = "ko",
  opts: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(intlTag(asLocale(locale)), opts).format(value);
}

/** Thousand-grouped whole number (rounding to Intl's default half-expand, like `maximumFractionDigits: 0`). */
export function formatInteger(value: number, locale: Locale | string = "ko"): string {
  return new Intl.NumberFormat(intlTag(asLocale(locale)), { maximumFractionDigits: 0 }).format(value);
}

/**
 * Ratio (0.07) → percent string ("7%") via Intl percent style; the format
 * options apply to the scaled value, matching the old `(v * 100).toLocaleString(…) + "%"` sites.
 */
export function formatPercent(
  value: number,
  locale: Locale | string = "ko",
  opts: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(intlTag(asLocale(locale)), { style: "percent", ...opts }).format(value);
}

function parseIso(iso: string | number | Date): Date | null {
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Locale date ("2026. 10. 23." for ko). An unparseable input renders as-is. */
export function formatDate(iso: string | number | Date, locale: Locale | string = "ko"): string {
  const d = parseIso(iso);
  return d ? new Intl.DateTimeFormat(intlTag(asLocale(locale)), { dateStyle: "medium" }).format(d) : String(iso);
}

/** Locale date+time, default Intl style — byte-identical to the old `new Date(iso).toLocaleString(locale)` sites. */
export function formatDateTime(iso: string | number | Date, locale: Locale | string = "ko"): string {
  const d = parseIso(iso);
  return d ? new Intl.DateTimeFormat(intlTag(asLocale(locale))).format(d) : String(iso);
}

/** Unit label for raw KRW-millions columns (npv_krw_m etc.); put it in the column header. */
export const KRW_MILLIONS_UNIT = "백만 원";

const KRW_MILLIONS_UNITS: Record<Locale, string> = {
  ko: "백만 원",
  en: "KRW millions",
};

/** Localized unit label for KRW-millions columns (ko value == KRW_MILLIONS_UNIT). */
export function krwMillionsUnit(locale: Locale | string = "ko"): string {
  return KRW_MILLIONS_UNITS[asLocale(locale)];
}

/** Format a KRW-millions integer for display: ko keeps the 조/억/백만 convention
 * (15,000 → "150억"); en uses compact notation ("KRW 1.2B" / "KRW 340M" / "KRW 5.0M"). */
export function formatKrwMillions(value: number | null | undefined, locale: Locale | string = "ko"): string {
  if (value === null || value === undefined) return "-";
  if (asLocale(locale) === "ko") {
    if (value === 0) return "0 백만원";
    const abs = Math.abs(value);
    if (abs >= 10_000) return `${(value / 10_000).toLocaleString("ko-KR")}조`;
    if (abs >= 100) return `${(value / 100).toLocaleString("ko-KR")}억`;
    return `${value.toLocaleString("ko-KR")}백만`;
  }
  if (value === 0) return "KRW 0M";
  // Compact magnitude of the underlying KRW amount; two significant digits,
  // with a lone-digit mantissa padded to one decimal ("5M" → "5.0M").
  const compact = new Intl.NumberFormat(intlTag(asLocale(locale)), {
    notation: "compact",
    maximumSignificantDigits: 2,
  }).format(value * 1_000_000);
  return `KRW ${compact.replace(/^(-?\d)([A-Za-z]*)$/, "$1.0$2")}`;
}

/** Format a basis-point value (e.g. run_rate_bp 9200 → "92%"). */
export function formatBp(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${(value / 100).toFixed(0)}%`;
}

/** Full-precision KRW-millions number for table cells whose header carries KRW_MILLIONS_UNIT. */
export function formatKrwMillionsPlain(value: number, locale: Locale | string = "ko"): string {
  return formatNumber(Math.round(value), asLocale(locale));
}
