#!/usr/bin/env bun
// @version 1.0.0
/**
 * Registers the hydraulic-breaker region×segment×scenario matrix from
 * docs/research/hydraulic-breaker-market-2026-driver-analysis.md §4 into the
 * assumption registry (kind='assumed', one row per combination), per that
 * file's §7 "Next Steps for Formal Registration" and the registry-backed
 * evidence-plane contract (docs/evidence/README.md).
 *
 * Rows written, on the target run:
 *   - hb.baseline_2026.<region>.<segment>  — 2026 baseline market size, $B (§4.2)
 *   - hb.cagr.<scenario>.<region>.<segment> — 2026→2030 CAGR as a fraction,
 *     scenario ∈ {down, base, up} (§4.3 base; §4.5 band shape down=base×0.5,
 *     up=base×1.55; North America mining carries its documented 2–11% band)
 *
 * Post-Epiroc-calibration figures (source #22: global construction −2pp /
 * mining +2pp; North America construction −8pp / other +8pp for the Stanley
 * Infrastructure acquisition) are already reflected in the source doc's
 * frozen §4 tables — this script hardcodes them like its seed sibling.
 *
 * Append-safe: a key whose latest stored value already equals the target is
 * skipped; a key with a different value gets a new row (the registry is
 * append-only — no overwrite), so re-runs never mutate history.
 *
 * Usage:
 *   bun scripts/co-newbiz/register-hydraulic-breaker-assumptions.ts [--run-id <id>]
 * Without --run-id, resolves the project's 'hydraulic-breaker-matrix-seed' run.
 */

import { getDb } from "../../db/client.ts";
import { recordAssumption } from "../../db/lib/assumption.ts";

const SOURCE_DOC = "docs/research/hydraulic-breaker-market-2026-driver-analysis.md";
const RUN_LABEL = "hydraulic-breaker-matrix-seed";
const AS_OF = "2026-08-31";
const TTL_DAYS = 365;

type Segment = "construction" | "mining" | "other";

interface Node {
  region: string;
  segment: Segment;
  baseline2026: number; // §4.2, $B
  cagrBase: number; // §4.3, fraction
  bandDown?: number; // §4.5 override
  bandUp?: number;
}

const RATIONALE_ADJUSTMENT =
  "Post-calibration per source #22 (Epiroc FY2025, primary filed): global construction -2pp / mining +2pp; " +
  "North America construction -8pp / other +8pp (Stanley Infrastructure acquisition).";

// §4.2 baselines + §4.3 CAGRs; band overrides per §4.5 (NA mining).
const NODES: Node[] = [
  { region: "china", segment: "construction", baseline2026: 0.239, cagrBase: 0.06 },
  { region: "china", segment: "mining", baseline2026: 0.187, cagrBase: 0.05 },
  { region: "china", segment: "other", baseline2026: 0.094, cagrBase: 0.05 },
  { region: "apac_ex_china", segment: "construction", baseline2026: 0.081, cagrBase: 0.07 },
  { region: "apac_ex_china", segment: "mining", baseline2026: 0.16, cagrBase: 0.09 },
  { region: "apac_ex_china", segment: "other", baseline2026: 0.039, cagrBase: 0.06 },
  { region: "north_america", segment: "construction", baseline2026: 0.101, cagrBase: 0.05 },
  { region: "north_america", segment: "mining", baseline2026: 0.151, cagrBase: 0.06, bandDown: 0.02, bandUp: 0.11 },
  { region: "north_america", segment: "other", baseline2026: 0.108, cagrBase: 0.05 },
  { region: "europe", segment: "construction", baseline2026: 0.168, cagrBase: 0.05 },
  { region: "europe", segment: "mining", baseline2026: 0.072, cagrBase: 0.04 },
  { region: "europe", segment: "other", baseline2026: 0.24, cagrBase: 0.06 },
  { region: "mea", segment: "construction", baseline2026: 0.072, cagrBase: 0.07 },
  { region: "mea", segment: "mining", baseline2026: 0.067, cagrBase: 0.06 },
  { region: "mea", segment: "other", baseline2026: 0.021, cagrBase: 0.05 },
  { region: "latam_row", segment: "construction", baseline2026: 0.041, cagrBase: 0.04 },
  { region: "latam_row", segment: "mining", baseline2026: 0.121, cagrBase: 0.08 },
  { region: "latam_row", segment: "other", baseline2026: 0.018, cagrBase: 0.04 },
];

function bands(node: Node): { down: number; base: number; up: number } {
  return {
    down: node.bandDown ?? node.cagrBase * 0.5,
    base: node.cagrBase,
    up: node.bandUp ?? node.cagrBase * 1.55,
  };
}

function parseArgs(): { runId?: string } {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--run-id");
  return idx === -1 ? {} : { runId: args[idx + 1] };
}

function main(): void {
  const { runId } = parseArgs();
  const db = getDb();

  const run = runId
    ? db.query("SELECT id FROM run WHERE id = ?").get(runId) as { id: string } | null
    : db.query("SELECT id FROM run WHERE label = ? ORDER BY created_at DESC").get(RUN_LABEL) as { id: string } | null;
  if (!run) {
    console.error(`No run found${runId ? ` with id '${runId}'` : ` with label '${RUN_LABEL}'`}. Seed it first.`);
    process.exit(1);
  }

  const now = new Date().toISOString();
  let written = 0;
  let skipped = 0;

  db.transaction(() => {
    const rows: Array<{ key: string; value: number; rationale: string; section: string }> = [];
    for (const node of NODES) {
      rows.push({
        key: `hb.baseline_2026.${node.region}.${node.segment}`,
        value: node.baseline2026,
        rationale: `2026 baseline market size ($B), region×segment mix post-calibration. ${RATIONALE_ADJUSTMENT}`,
        section: "§4.2",
      });
      const b = bands(node);
      for (const [scenario, value] of Object.entries(b) as Array<["down" | "base" | "up", number]>) {
        rows.push({
          key: `hb.cagr.${scenario}.${node.region}.${node.segment}`,
          value,
          rationale:
            scenario === "base"
              ? `Base-scenario CAGR 2026→2030 (fraction). ${RATIONALE_ADJUSTMENT}`
              : `${scenario === "down" ? "Downside" : "Upside"} CAGR band (${scenario === "down" ? "base×0.5" : "base×1.55"} global band shape${node.bandDown !== undefined ? "; documented 2–11% NA-mining override" : ""}).`,
          section: scenario === "base" ? "§4.3" : "§4.5",
        });
      }
    }

    for (const row of rows) {
      const latest = db.query(
        "SELECT value FROM assumption WHERE run_id = ? AND assumption_key = ? ORDER BY as_of DESC, rowid DESC LIMIT 1",
      ).get(run.id, row.key) as { value: number } | null;
      if (latest && Math.abs(latest.value - row.value) < 1e-9) {
        skipped++;
        continue;
      }
      recordAssumption(db, {
        runId: run.id,
        assumptionKey: row.key,
        kind: "assumed",
        value: row.value,
        asOf: AS_OF,
        rationale: row.rationale,
        anchorRef: `${SOURCE_DOC} ${row.section}`,
        ttlDays: TTL_DAYS,
        actor: "register-hydraulic-breaker-assumptions.ts",
        now,
      });
      written++;
    }
  })();

  console.log(
    `Registered hydraulic-breaker assumptions on run '${run.id}': ${written} rows written, ${skipped} already current (skipped).`,
  );
}

main();
