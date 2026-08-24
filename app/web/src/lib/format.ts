/**
 * Shared formatting utilities for KRW-millions money fields (ADR-0061).
 * All monetary quantities in the system are INTEGER KRW millions; this
 * module renders them with explicit unit labels so the UI never shows a
 * bare number without context.
 */

/** Format a KRW-millions integer for display: 15,000 → "150억" (15,000M = 15B). */
export function formatKrwMillions(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  if (value === 0) return "0 백만원";
  const abs = Math.abs(value);
  if (abs >= 10_000) return `${(value / 10_000).toLocaleString("ko-KR")}조`;
  if (abs >= 100) return `${(value / 100).toLocaleString("ko-KR")}억`;
  return `${value.toLocaleString("ko-KR")}백만`;
}

/** Format a basis-point value (e.g. run_rate_bp 9200 → "92%"). */
export function formatBp(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${(value / 100).toFixed(0)}%`;
}
