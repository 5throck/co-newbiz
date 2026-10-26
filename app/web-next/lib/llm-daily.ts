// Run-ledger daily buckets (design 2026-10-26-ledger-daily-buckets-design).
// Server-side per-day aggregation for the /flows call-trend chart, over the same
// WHERE as the summary cards. Day key = server-local calendar date (YYYY-MM-DD),
// matching bucketLlmCallsByDay (flows-view-lib.ts), which also uses local getters.
// Classification: ok === 1 -> ok, anything else -> failed (same as the client helper).
import type { Database } from "bun:sqlite";
import type { SQLQueryBindings } from "bun:sqlite";

export interface DailyBucket {
  day: string; // YYYY-MM-DD, server-local
  ok: number;
  failed: number;
  costUsd: number;
}

export function localDayKey(d: Date): string {
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Every local calendar day from windowStart's day through now's day, ascending. */
export function windowDays(windowStart: Date, now: Date = new Date()): string[] {
  const days: string[] = [];
  const cur = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  while (cur.getTime() <= end.getTime()) {
    days.push(localDayKey(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/** `where` must already include the window lower bound (caller's summaryWhere). */
export function llmDailyBuckets(
  db: Database,
  where: string,
  params: SQLQueryBindings[],
  windowStart: Date,
  now: Date = new Date(),
): DailyBucket[] {
  const rows = db
    .query(
      `SELECT strftime('%Y-%m-%d', l.created_at, 'localtime') AS day,
              SUM(CASE WHEN l.ok = 1 THEN 1 ELSE 0 END) AS ok,
              SUM(CASE WHEN l.ok = 1 THEN 0 ELSE 1 END) AS failed,
              COALESCE(SUM(l.cost_usd), 0) AS cost
       FROM llm_call_log l WHERE ${where} GROUP BY day`,
    )
    .all(...params) as Array<{ day: string | null; ok: number; failed: number; cost: number }>;
  const byDay = new Map(rows.filter((r) => r.day).map((r) => [r.day as string, r]));
  return windowDays(windowStart, now).map((day) => {
    const r = byDay.get(day);
    return { day, ok: r?.ok ?? 0, failed: r?.failed ?? 0, costUsd: r?.cost ?? 0 };
  });
}
