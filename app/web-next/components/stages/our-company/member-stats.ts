// Pure helpers for the /our-company group header and member rows (derived client-side from loaded members).
import { PROFILE_STALE_DAYS } from "./constants.ts";
import type { MemberRow } from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** True when `analyzedAt` exists and is more than `staleDays` days before `now`. */
export function isStaleAnalysis(analyzedAt: string | null | undefined, now: Date = new Date(), staleDays: number = PROFILE_STALE_DAYS): boolean {
  if (!analyzedAt) return false;
  const t = Date.parse(analyzedAt);
  if (Number.isNaN(t)) return false;
  return (now.getTime() - t) / DAY_MS > staleDays;
}

export interface GroupAnalysisMeta {
  analyzed: number;
  total: number;
  /** newest analyzed_at (YYYY-MM-DD) among members, or null when none analyzed */
  lastDate: string | null;
  stale: boolean;
}

export function groupAnalysisMeta(members: Pick<MemberRow, "latest_version" | "analyzed_at">[], now: Date = new Date()): GroupAnalysisMeta {
  const analyzed = members.filter((m) => m.latest_version !== null).length;
  let newest: string | null = null;
  for (const m of members) {
    if (m.analyzed_at && (newest === null || Date.parse(m.analyzed_at) > Date.parse(newest))) newest = m.analyzed_at;
  }
  return { analyzed, total: members.length, lastDate: newest ? newest.slice(0, 10) : null, stale: isStaleAnalysis(newest, now) };
}
