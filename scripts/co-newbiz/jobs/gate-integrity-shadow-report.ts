// @version 1.0.0
/**
 * gate_integrity.shadow_report - the weekly ADR-0186 shadow review report as a scheduler handler (design 3.1). Wraps
 * buildShadowReport (READ-ONLY on the database) and writes the JSON to <reportDir>/<ISO year>-W<ISO week>.json. The file
 * is keyed by ISO week, so a rerun in the same week overwrites it (idempotent).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildShadowReport } from "../gate-integrity-shadow-report.ts";
import type { JobHandler } from "./types.ts";

/** ISO-8601 week label (e.g. 2026-W44) for an instant, computed on UTC. */
export function isoWeekLabel(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const WINDOW_DAYS = 7;

export const gateIntegrityShadowReport: JobHandler = {
  key: "gate_integrity.shadow_report",
  displayName: "Gate integrity shadow report",
  description: "Weekly read-only summary of gate-integrity shadow-mode would-block/refusal audit rows and enforce-flip readiness.",
  defaultCron: "0 8 * * 1",
  timeoutSec: 900,
  maxRetries: 1,
  catchup: { mode: "once", maxAgeHours: 7 * 24 },
  run(ctx) {
    const to = ctx.now.toISOString();
    const from = new Date(ctx.now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
    const report = buildShadowReport(ctx.db, { from, to, now: to });
    mkdirSync(ctx.reportDir, { recursive: true });
    const file = join(ctx.reportDir, `${isoWeekLabel(ctx.now)}.json`);
    writeFileSync(file, JSON.stringify(report, null, 2));
    const total = report.totals.would_block + report.totals.refused;
    return {
      rowsRead: total,
      rowsWritten: 1,
      rowsChanged: 0,
      detail: { report_path: file, window: report.window, totals: report.totals, migration_pending: report.migration_pending.length },
    };
  },
};
