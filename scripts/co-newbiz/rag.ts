#!/usr/bin/env bun
// @version 1.2.0
/**
 * rag — evaluate and persist a six-dimension RAG assessment from a scenario
 * JSON. Design v1.0 §4-2, docs/rag-framework.md, FR-RAG-01..08, Wave 5.3.
 *
 * Follows the simulate <scenario-json-path> CLI pattern (design §4-8), with
 * one difference simulate does not need: rag_assessment.run_id references
 * run(id), so the command creates a run row whose input_hash is the SHA-256
 * of the canonical scenario JSON (run-based full versioning, ADR-0005).
 *
 * Scenario JSON shape (all grade inputs optional — missing dimensions
 * default to Amber with an explicit rationale, see db/lib/rag-engine.ts):
 * {
 *   "project_no": "NP-2026-001",        // md_project.project_no
 *   "stage_gate": "fs",                 // screening|pre_fs|fs|dd|entity_ic|group_ic
 *   "chain_grade": "A",                 // A|B|C — proxy-chain reliability
 *   "staleness_violated": false,
 *   "kill_criteria": false,
 *   "financial": { "irr": 0.13, "hurdle": 0.10, "dscr_downside": 1.4 },
 *   "market_grade": "green",
 *   "regulatory": { "remedy_type": "none" },
 *   "technical_grade": "green",
 *   "risk_grade": "green",
 *   "irr_over_hurdle_pp": 3.0,          // hysteresis input, this run
 *   "previous_irr_over_hurdle_pp": 2.5, // hysteresis input, previous run
 *   "now": "2026-08-20T10:00:00Z"       // optional; default = wall clock
 * }
 *
 * Usage:
 *   bun scripts/co-newbiz/rag.ts <scenario-json-path> [--db-path <path>]
 */

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { getDb } from "../../db/client.ts";
import { ulid } from "../../db/lib/ulid.ts";
import {
  assessRun,
  type RagEvaluationInput,
  type RagGrade,
  type StageGate,
} from "../../db/lib/rag-engine.ts";

export interface RagScenario {
  project_no: string;
  stage_gate: StageGate;
  chain_grade?: "A" | "B" | "C";
  staleness_violated?: boolean;
  kill_criteria?: boolean;
  financial?: { irr: number; hurdle: number; dscr_downside: number };
  market_grade?: RagGrade;
  regulatory?: { remedy_type: "none" | "behavioral" | "structural" | "prohibited"; obligation_active?: boolean; discharge_confirmed_at?: string | null };
  technical_grade?: RagGrade;
  risk_grade?: RagGrade;
  irr_over_hurdle_pp?: number;
  previous_irr_over_hurdle_pp?: number | null;
  now?: string;
}

export interface RagCliResult {
  run_id: string;
  project_id: string;
  complete: boolean;
  /** Null when the assessment is incomplete (see rag-engine.ts's evaluateRag doc comment). */
  recorded_overall: string | null;
  dimensions: { dimension: string; grade: string; assessed: boolean; remedy_shape?: string; rationale: string }[];
  overall_rationale: string;
  transition: { from: string | null; to: string } | null;
}

/**
 * DB-object-based core: shared by the `rag` CLI (reads a scenario file) and
 * `watch-run.ts` (re-assesses in-process on a detected data change, no
 * filesystem round-trip). Both callers get identical run/hash/persistence
 * semantics from one place.
 */
export function assessScenario(
  db: Database,
  scenario: RagScenario,
  options?: { runLabelPrefix?: string; createdBy?: string },
): RagCliResult {
  if (!scenario.project_no) {
    throw new Error("Scenario is missing 'project_no' (md_project.project_no).");
  }
  if (!scenario.stage_gate) {
    throw new Error("Scenario is missing 'stage_gate'.");
  }

  const project = db
    .query("SELECT id FROM md_project WHERE project_no = ?")
    .get(scenario.project_no) as { id: string } | null;
  if (!project) {
    throw new Error(`Project '${scenario.project_no}' not found in md_project — create it before assessing (FR-DATA-04: no silent auto-creation of master data).`);
  }

  const now = scenario.now ?? new Date().toISOString();
  const inputHash = createHash("sha256")
    .update(JSON.stringify(scenario, Object.keys(scenario).sort()))
    .digest("hex");

  // The run row anchors the assessment in run-based versioning: same
  // scenario -> same hash, and every RAG row cites the run that produced it.
  const runId = ulid();
  db.run(
    "INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [
      runId,
      project.id,
      `${options?.runLabelPrefix ?? "rag"} ${scenario.stage_gate} ${now}`,
      inputHash,
      options?.createdBy ?? "cli",
      now,
    ],
  );

  const input: RagEvaluationInput = {
    stageGate: scenario.stage_gate,
    chainGrade: scenario.chain_grade,
    stalenessViolated: scenario.staleness_violated,
    financial: scenario.financial
      ? { irr: scenario.financial.irr, hurdle: scenario.financial.hurdle, dscrDownside: scenario.financial.dscr_downside }
      : undefined,
    regulatory: scenario.regulatory
      ? {
          remedyType: scenario.regulatory.remedy_type,
          obligationActive: scenario.regulatory.obligation_active,
          dischargeConfirmedAt: scenario.regulatory.discharge_confirmed_at ?? null,
        }
      : undefined,
    marketGrade: scenario.market_grade,
    technicalGrade: scenario.technical_grade,
    riskGrade: scenario.risk_grade,
    killCriteriaTriggered: scenario.kill_criteria,
  };

  const result = assessRun(db, {
    projectId: project.id,
    runId,
    input,
    irrOverHurdlePp: scenario.irr_over_hurdle_pp ?? (scenario.financial ? (scenario.financial.irr - scenario.financial.hurdle) * 100 : 0),
    previousIrrOverHurdlePp: scenario.previous_irr_over_hurdle_pp ?? null,
    now,
  });

  return {
    run_id: runId,
    project_id: project.id,
    complete: result.complete,
    recorded_overall: result.recordedOverall,
    dimensions: result.dimensions.map((d) => ({
      dimension: d.dimension,
      grade: d.grade,
      assessed: d.assessed,
      ...(d.remedyShape ? { remedy_shape: d.remedyShape } : {}),
      rationale: d.rationale,
    })),
    overall_rationale: result.overall
      ? `${result.overall.rationale} ${result.hysteresisRationale}`
      : "Assessment incomplete — fewer than six dimensions assessed and no assessed dimension is Red, so no overall grade is produced (docs/rag-framework.md; an incomplete assessment never defaults to a color).",
    transition: result.transition,
  };
}

export function runRagAssessment(scenarioPath: string, dbPath?: string): RagCliResult {
  const absPath = resolve(scenarioPath);
  if (!existsSync(absPath)) {
    throw new Error(`Scenario file not found: ${absPath}`);
  }
  const scenario: RagScenario = JSON.parse(readFileSync(absPath, "utf-8"));
  const db = getDb(dbPath);
  return assessScenario(db, scenario);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const [scenarioPath] = argv;
  if (!scenarioPath) {
    console.error("Usage: bun scripts/co-newbiz/rag.ts <scenario-json-path> [--db-path <path>]");
    process.exit(1);
  }
  const dbPathIdx = argv.indexOf("--db-path");
  const dbPath = dbPathIdx >= 0 ? argv[dbPathIdx + 1] : undefined;
  try {
    const result = runRagAssessment(scenarioPath, dbPath);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`rag failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
