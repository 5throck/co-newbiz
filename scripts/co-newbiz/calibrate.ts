#!/usr/bin/env bun
// @version 1.0.0
/**
 * calibrate.ts — statistical proxy-hop calibration (Wave A2).
 *
 * Wraps python/correlation.py (OLS + lead-lag search + 95% CI, the
 * unit-conversion-calibration methodology) and lands the result as a
 * statistical `proxy_link` hop plus a single-hop `proxy_chain` whose grade
 * follows the proxy-industry-chain skill's rule: grade_eligible (R² >= 0.6)
 * → B, else C. The hop's betas are never shared with value_chain_link
 * (ADR-0025 — the two answer different questions).
 *
 * Usage:
 *   bun scripts/co-newbiz/newbiz.ts calibrate \
 *     --from-industry <id> --to-industry <id> \
 *     --from-series <id> --to-series <id> \
 *     --from YYYY-MM --to YYYY-MM \
 *     [--max-lag 6] [--evidence-ref <ref>] [--db-path <path>]
 *
 * Recalibration replaces the previous statistical hop for the same industry
 * pair (the old row is deleted, the new one carries the fresh calibration) —
 * a chain is always the latest calibration, and run-level reproducibility is
 * not lost because the series revisions remain in fact_market_observation.
 */

import { getDb } from "../../db/client.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Prefer the project venv (python/requirements.txt) when present — same
// PEP 668 discipline as fin-pipeline.ts/simulate.ts.
function resolvePythonBin(): string {
  if (process.platform !== "win32") {
    const venvBin = resolve(import.meta.dirname, "..", "..", ".venv", "bin", "python3");
    if (existsSync(venvBin)) return venvBin;
  }
  return process.platform === "win32" ? "python" : "python3";
}

export interface CalibrateOptions {
  fromIndustryId: string;
  toIndustryId: string;
  fromSeriesId: string;
  toSeriesId: string;
  periodFrom: string; // YYYY-MM
  periodTo: string; // YYYY-MM
  maxLagMonths?: number;
  evidenceRef?: string;
}

export interface CalibrateResult {
  proxyLinkId: string;
  chainId: string;
  beta: number;
  r2: number;
  lagMonths: number;
  ciLow: number;
  ciHigh: number;
  grade: "B" | "C";
  gradeRationale: string;
}

function seriesPoints(
  db: ReturnType<typeof getDb>,
  seriesId: string,
  from: string,
  to: string,
): Array<{ period: string; value: number }> {
  const rows = db
    .query(
      `SELECT p.start_date AS period, o.value
       FROM fact_market_observation o
       JOIN md_period p ON p.id = o.period_id
       WHERE o.series_id = ?
         AND o.revision_no = (SELECT MAX(revision_no) FROM fact_market_observation o2
                              WHERE o2.series_id = o.series_id AND o2.period_id = o.period_id)
         AND substr(p.start_date, 1, 7) >= ? AND substr(p.start_date, 1, 7) <= ?
       ORDER BY p.start_date`,
    )
    .all(seriesId, from, to) as Array<{ period: string; value: number }>;
  return rows;
}

export async function runCalibrate(opts: CalibrateOptions): Promise<CalibrateResult> {
  const db = getDb();
  const from = seriesPoints(db, opts.fromSeriesId, opts.periodFrom, opts.periodTo);
  const to = seriesPoints(db, opts.toSeriesId, opts.periodFrom, opts.periodTo);
  if (from.length < 8 || to.length < 8) {
    throw new Error(`calibrate: need >= 8 aligned observations per series (got ${from.length} / ${to.length}) — fetch more history first.`);
  }

  // Spawn the methodology owner (args array, never shell) — same discipline
  // as db/lib/simulation.ts's monte_carlo spawn.
  const inputPath = `/tmp/calibrate-${ulid().toLowerCase()}.json`;
  const { writeFileSync, unlinkSync } = await import("node:fs");
  writeFileSync(inputPath, JSON.stringify({ from_series: from, to_series: to, max_lag_months: opts.maxLagMonths ?? 6 }));
  let result: { beta: number; r2: number; lag_months: number; ci_low: number; ci_high: number; grade_eligible: boolean; grade_note: string };
  try {
    const proc = Bun.spawnSync([resolvePythonBin(), resolve(import.meta.dirname, "..", "..", "python", "correlation.py"), inputPath]);
    const out = proc.stdout.toString();
    if (proc.exitCode !== 0) {
      throw new Error(`correlation.py exited ${proc.exitCode}: ${proc.stderr.toString().slice(0, 300)}`);
    }
    result = JSON.parse(out);
  } finally {
    if (existsSync(inputPath)) unlinkSync(inputPath);
  }

  // Recalibration replaces the previous statistical hop for this pair.
  db.run("DELETE FROM proxy_link WHERE from_industry_id = ? AND to_industry_id = ? AND hop_type = 'statistical'", [
    opts.fromIndustryId,
    opts.toIndustryId,
  ]);
  const evidenceRef = opts.evidenceRef ?? `correlation.py ${opts.fromSeriesId}→${opts.toSeriesId} ${opts.periodFrom}..${opts.periodTo}`;
  const linkId = ulid();
  db.run(
    `INSERT INTO proxy_link (id, from_industry_id, to_industry_id, hop_type, beta, r2, lag_months, ci_low, ci_high, evidence_ref, calibrated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [linkId, opts.fromIndustryId, opts.toIndustryId, "statistical", result.beta, result.r2, result.lag_months, result.ci_low, result.ci_high, evidenceRef, new Date().toISOString()],
  );

  // Single-hop chain grade (proxy-industry-chain skill rule 4): the hop's own
  // grade_eligibility (R² >= 0.6) decides B vs C.
  const grade: "B" | "C" = result.grade_eligible ? "B" : "C";
  const chainId = ulid();
  const gradeRationale = `single statistical hop — ${result.grade_note}`;
  db.run(
    `INSERT INTO proxy_chain (id, target_industry_id, hop_ids, reliability_grade, grade_rationale, compounded_ci_low, compounded_ci_high, calibrated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [chainId, opts.toIndustryId, JSON.stringify([linkId]), grade, gradeRationale, result.ci_low, result.ci_high, new Date().toISOString()],
  );

  return {
    proxyLinkId: linkId,
    chainId,
    beta: result.beta,
    r2: result.r2,
    lagMonths: result.lag_months,
    ciLow: result.ci_low,
    ciHigh: result.ci_high,
    grade,
    gradeRationale,
  };
}
