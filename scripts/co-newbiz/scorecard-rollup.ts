#!/usr/bin/env bun
// @version 1.0.0
/**
 * scorecard-rollup — the E.4 portfolio rollup surface over the
 * venture_scorecard table (ADR-0059): one review cycle's scorecard rows
 * across the venture portfolio as JSON — bifurcated financial/strategic
 * sections, class rollup over both sections, the insufficient_evidence
 * exception list, and run/cycle provenance. Output shape targets
 * templates/deliverables/portfolio-scorecard-rollup-template.md.
 *
 * CLI-group-operator posture (same as rag / watch:run): NO actor guard runs
 * here — visibility for an individual caller belongs to the server route
 * (PR-3); this command is the group operator's aggregate view and performs
 * no writes, so there is no data_access row to log (getPortfolioRollup is a
 * pure query by design).
 *
 * An empty (migrated) database is a valid state, not an error: exit 0 with
 * review_cycle null and empty sections — "nothing recorded yet" is the
 * trend-and-trigger instrument's zero point, never a silent pass.
 *
 * Usage:
 *   bun scripts/co-newbiz/scorecard-rollup.ts [--review-cycle <YYYY-Qn>] [--db-path <path>]
 */

import { getDb } from "../../db/client.ts";
import { getPortfolioRollup } from "../../db/repositories/venture-scorecard.repository.ts";

export interface ScorecardRollupOptions {
  /** Explicit 'YYYY-Qn'; omit to resolve the latest recorded cycle. */
  reviewCycle?: string;
  dbPath?: string;
}

/** Print-shape core: the JSON the CLI emits (2-space indented, parse-stable for tests). */
export function runScorecardRollup(opts: ScorecardRollupOptions = {}): string {
  const rollup = getPortfolioRollup({ reviewCycle: opts.reviewCycle }, getDb(opts.dbPath));
  return JSON.stringify(rollup, null, 2);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const cycleIdx = argv.indexOf("--review-cycle");
  const dbPathIdx = argv.indexOf("--db-path");
  const reviewCycle = cycleIdx >= 0 ? argv[cycleIdx + 1] : undefined;
  const dbPath = dbPathIdx >= 0 ? argv[dbPathIdx + 1] : undefined;
  try {
    console.log(runScorecardRollup({ reviewCycle, dbPath }));
  } catch (err) {
    console.error(`scorecard:rollup failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
