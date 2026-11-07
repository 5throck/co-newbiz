// @version 1.0.0
/**
 * ISO calendar-date helpers for human-recorded event dates (ADR-0194 item B: site_announcement.announced_on and
 * dimension_input.effective_on). Dates are plain TEXT `YYYY-MM-DD` (ADR-0002 portability: no engine date type).
 *
 * "Today" is the Asia/Seoul calendar date: the system's users and deals are Korea-anchored, and a server clock in UTC
 * must not reject a date that is already "today" in Seoul (UTC+9 has no DST, so the offset is a constant). Risk-officer
 * B-2: a date later than the evaluation date is rejected at write time, and the snapshot filler ignores one that slipped
 * in by another path.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in `YYYY-MM-DD` form (2026-02-30 and 2026-13-01 are not). */
export function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = value.match(ISO_DATE);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

const SEOUL_OFFSET_MS = 9 * 3600 * 1000;

/** The Asia/Seoul calendar date (`YYYY-MM-DD`) of an instant (ISO string or Date). */
export function seoulToday(now: string | Date): string {
  const at = now instanceof Date ? now : new Date(now);
  return new Date(at.getTime() + SEOUL_OFFSET_MS).toISOString().slice(0, 10);
}
