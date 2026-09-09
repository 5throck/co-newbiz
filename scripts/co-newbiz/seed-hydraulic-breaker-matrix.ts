#!/usr/bin/env bun
// @version 1.1.0
/**
 * Ingests the hydraulic-breaker region×segment×scenario demand matrix from
 * docs/research/hydraulic-breaker-market-2026-driver-analysis.md §4 into
 * the ADR-0066 chain-scenario tables, now that they carry region_code/
 * segment_code (migration 0034). The doc's figures are final/frozen (see
 * its own §7 "Next Steps for Formal Registration"), so this script
 * hardcodes them rather than parsing markdown — re-run only if the source
 * doc's §4 numbers are revised.
 *
 * Creates, under the given project:
 *   - one industry_driver row (code 'hydraulic-breaker-demand') if absent
 *   - one md_industry row (KSIC 29241) if absent, to satisfy the
 *     industry_id FK on both target tables
 *   - one run row (label 'hydraulic-breaker-matrix-seed') to satisfy the
 *     run_id FK on structure_simulation_result
 *   - chain_node_sensitivity rows: one per region×segment, sensitivity =
 *     the segment's base-scenario CAGR (§4.3) as a placeholder elasticity
 *     record (evidence_ref points back to the doc)
 *   - structure_simulation_result rows: one per region×segment×scenario
 *     (downside/base/upside), metric='demand_delta_pct', p05/p50/p95 =
 *     the scenario CAGR band (§4.5's global band shape applied per
 *     region×segment via the same ±spread used elsewhere in this schema)
 *
 * Idempotent: re-running against the same project is a no-op if rows
 * with the same UNIQUE keys already exist (INSERT OR IGNORE).
 *
 * Usage:
 *   bun scripts/co-newbiz/seed-hydraulic-breaker-matrix.ts --project-id <id>
 */

import { getDb } from "../../db/client.ts";
import { ulid } from "../../db/lib/ulid.ts";

const SOURCE_DOC = "docs/research/hydraulic-breaker-market-2026-driver-analysis.md";

interface RegionSegment {
  region: string;
  segment: "construction" | "mining" | "other";
  cagrBase: number; // §4.3, fraction (e.g. 0.06 for 6%)
}

// §4.3 Segment-specific CAGR assumptions (base scenario)
const MATRIX: RegionSegment[] = [
  { region: "china", segment: "construction", cagrBase: 0.06 },
  { region: "china", segment: "mining", cagrBase: 0.05 },
  { region: "china", segment: "other", cagrBase: 0.05 },
  { region: "apac_ex_china", segment: "construction", cagrBase: 0.07 },
  { region: "apac_ex_china", segment: "mining", cagrBase: 0.09 },
  { region: "apac_ex_china", segment: "other", cagrBase: 0.06 },
  { region: "north_america", segment: "construction", cagrBase: 0.05 },
  { region: "north_america", segment: "mining", cagrBase: 0.06 },
  { region: "north_america", segment: "other", cagrBase: 0.05 },
  { region: "europe", segment: "construction", cagrBase: 0.05 },
  { region: "europe", segment: "mining", cagrBase: 0.04 },
  { region: "europe", segment: "other", cagrBase: 0.06 },
  { region: "mea", segment: "construction", cagrBase: 0.07 },
  { region: "mea", segment: "mining", cagrBase: 0.06 },
  { region: "mea", segment: "other", cagrBase: 0.05 },
  { region: "latam_row", segment: "construction", cagrBase: 0.04 },
  { region: "latam_row", segment: "mining", cagrBase: 0.08 },
  { region: "latam_row", segment: "other", cagrBase: 0.04 },
];

// North America mining carries the widest documented band (§4.5): 2%–11%.
const WIDE_BAND: Record<string, { region: string; segment: string }> = {
  "north_america|mining": { region: "north_america", segment: "mining" },
};

function scenarioBand(row: RegionSegment): { downside: number; base: number; upside: number } {
  const key = `${row.region}|${row.segment}`;
  if (key in WIDE_BAND) return { downside: 0.02, base: row.cagrBase, upside: 0.11 };
  // Default spread mirrors §4.5's global band shape (~-50%/+55% around base).
  return { downside: row.cagrBase * 0.5, base: row.cagrBase, upside: row.cagrBase * 1.55 };
}

function parseArgs(): { projectId: string } {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--project-id");
  if (idx === -1 || !args[idx + 1]) {
    console.error("Usage: bun scripts/co-newbiz/seed-hydraulic-breaker-matrix.ts --project-id <id>");
    process.exit(1);
  }
  return { projectId: args[idx + 1] };
}

function main(): void {
  const { projectId } = parseArgs();
  const db = getDb();

  const project = db.query("SELECT id FROM md_project WHERE id = ?").get(projectId);
  if (!project) {
    console.error(`Project '${projectId}' does not exist.`);
    process.exit(1);
  }

  const now = new Date().toISOString();

  db.transaction(() => {
    // industry_driver
    let driver = db.query("SELECT id FROM industry_driver WHERE code = ?").get("hydraulic-breaker-demand") as { id: string } | null;
    if (!driver) {
      const id = ulid();
      db.run(
        "INSERT INTO industry_driver (id, code, label_ko, description, source_series_id, created_at) VALUES (?,?,?,?,?,?)",
        [id, "hydraulic-breaker-demand", "유압브레이커 수요", `Region×segment×scenario demand matrix, see ${SOURCE_DOC} §4`, null, now],
      );
      driver = { id };
    }

    // md_industry row for hydraulic breaker — real KSIC 29241 (건설 및 채광용
    // 기계장비 제조업, DART-verified via Soosan group affiliates). The legacy
    // 'HYD-BRK' sentinel was retired in ADR-0112; migrate it if encountered.
    let industry = db.query("SELECT id FROM md_industry WHERE ksic_code IN (?, ?)").get("29241", "HYD-BRK") as { id: string } | null;
    if (!industry) {
      const id = ulid();
      db.run(
        "INSERT INTO md_industry (id, ksic_code, naics_code, isic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?,?,?)",
        [id, "29241", null, null, "유압브레이커", "Hydraulic Breaker", now],
      );
      industry = { id };
    } else {
      db.run("UPDATE md_industry SET ksic_code = '29241' WHERE id = ? AND ksic_code = 'HYD-BRK'", [industry.id]);
    }

    // run row to satisfy structure_simulation_result's run_id FK — reused
    // across re-runs (not recreated each time) so the result rows' UNIQUE
    // key (run_id, scenario, industry_id, metric, region_code, segment_code)
    // actually collapses duplicates on re-run, keeping this script idempotent.
    let run = db.query("SELECT id FROM run WHERE project_id = ? AND label = ?").get(projectId, "hydraulic-breaker-matrix-seed") as { id: string } | null;
    if (!run) {
      const runId = ulid();
      db.run(
        "INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)",
        [runId, projectId, "hydraulic-breaker-matrix-seed", "seed-script-no-input-hash", "seed-hydraulic-breaker-matrix.ts", now],
      );
      run = { id: runId };
    }
    const runId = run.id;

    for (const row of MATRIX) {
      db.run(
        `INSERT OR IGNORE INTO chain_node_sensitivity
           (id, project_id, industry_id, driver_id, sensitivity, lag_months, evidence_ref, assessed_by, assessed_at, region_code, segment_code)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          ulid(),
          projectId,
          industry.id,
          driver.id,
          row.cagrBase * 10, // scale into the -10..10 sensitivity range
          0,
          `${SOURCE_DOC} §4.3`,
          "seed-hydraulic-breaker-matrix.ts",
          now,
          row.region,
          row.segment,
        ],
      );

      const band = scenarioBand(row);
      for (const [scenario, val] of Object.entries(band) as Array<[string, number]>) {
        db.run(
          `INSERT OR IGNORE INTO structure_simulation_result
             (id, run_id, scenario, industry_id, metric, p05, p50, p95, created_at, region_code, segment_code)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [ulid(), runId, scenario, industry.id, "demand_delta_pct", val, val, val, now, row.region, row.segment],
        );
      }
    }
  })();

  console.log(`Seeded hydraulic-breaker matrix for project '${projectId}': ${MATRIX.length} region×segment nodes, ${MATRIX.length * 3} scenario results.`);
}

main();
