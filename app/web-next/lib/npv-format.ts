import { formatNumber, type Locale } from "./format.ts";

/** Display-only: NPV in 백만 KRW rounded to whole numbers with thousand separators. Stored values are unchanged. */
export function fmtNpvKrwM(n: number | null | undefined, locale: Locale | string = "ko"): string {
  if (n == null || !Number.isFinite(n)) return "-";
  const r = Math.round(n);
  return formatNumber(r === 0 ? 0 : r, locale, { maximumFractionDigits: 0 });
}

/** Display-only: a plain number rounded to a whole value with separators (unit stated by the caller). */
export const fmtNpvInteger = fmtNpvKrwM;

/** Display-only: NPV given in 백만 KRW, shown in whole 억원 (1억 = 100 백만). */
export function fmtNpvEok(krwM: number | null | undefined, locale: Locale | string = "ko"): string {
  if (krwM == null || !Number.isFinite(krwM)) return "-";
  return `${fmtNpvKrwM(krwM / 100, locale)}억원`;
}
