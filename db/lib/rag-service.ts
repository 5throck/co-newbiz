// @version 1.1.0
/**
 * RAG recompute service (Wave F-5, design 2026-10-08-wave-f-process-closure §5).
 *
 * `assessRun` used to be reachable only from the CLI, so the web never wrote
 * `rag_assessment` and the IC package read an empty table. `recomputeRag` is
 * the web-callable wrapper: it gathers the inputs that ARE persisted, carries
 * forward the directly-scored dimensions an agent/CLI scenario supplied, runs
 * the unchanged engine (`assessRun` — hysteresis and the data-confidence cap
 * live there), and records the run.
 *
 * Boundaries:
 *  - The grade is a PROPOSAL. Nothing here writes a gate decision, an
 *    approval, or a transition (boundary #2). `actor` is the calling user's
 *    id (boundary #1: no service account) and lands in run.created_by.
 *  - Data confidence caps the overall grade (boundary #4): the S1 sizing
 *    grade (migration 0125) feeds the data_confidence dimension; Grade B is
 *    Amber and C is Red, so a capped estimate can never read Green.
 *  - An incomplete assessment has NO overall grade. `readRagView` reports it
 *    as `not_graded`; it never invents a default color.
 *
 * Idempotence: the inputs hash is stored on the run row. If it equals the
 * latest web run's hash nothing is written ("unchanged"), so calling this on
 * every IC-package read is cheap and is also the stale-read recompute.
 */
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { ulid } from "./ulid.ts";
import { effectiveState } from "./gate-effective.ts";
import {
  assessRun,
  RAG_DIMENSIONS,
  type RagDimension,
  type RagEvaluationInput,
  type RagGrade,
  type StageGate,
} from "./rag-engine.ts";
import { worseGrade, type DataConfidenceGrade } from "./data-confidence.ts";

export type RagTrigger = "gate_brief" | "ic_package" | "stale_read" | "manual";

const WEB_RUN_PREFIX = "rag-web";
/** Project gates in pipeline order — the first one not yet 'go' is the stage being assessed. */
const GATE_ORDER: StageGate[] = ["fs", "dd", "entity_ic", "group_ic"];

export interface RecomputeResult {
  status: "assessed" | "unchanged" | "nothing_to_assess" | "project_not_found";
  runId: string | null;
  complete: boolean;
  /** Grade of record after hysteresis; null = not graded. */
  overall: RagGrade | null;
  stageGate: StageGate | null;
  dataConfidenceGrade: DataConfidenceGrade | null;
}

interface GatheredInputs {
  input: RagEvaluationInput;
  irrOverHurdlePp: number;
  dataConfidenceGrade: DataConfidenceGrade | null;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function deriveStageGate(db: Database, projectId: string): StageGate {
  const rows = db
    .query(
      `SELECT id, gate, decision, decided_by FROM (
         SELECT id, gate, decision, decided_by, ROW_NUMBER() OVER (PARTITION BY gate ORDER BY decided_at DESC, id DESC) rn
         FROM gate_decision WHERE entity_type = 'project' AND entity_id = ?
       ) WHERE rn = 1`,
    )
    .all(projectId) as Array<{ id: string; gate: string; decision: string; decided_by: string }>;
  // ADR-0186 D6: an IC GO awaiting its countersign is not the stage the project has reached (strict only under maker_checker = enforce).
  const verdict = new Map(rows.map((r) => [r.gate, effectiveState(db, projectId, r).verdict as string]));
  return GATE_ORDER.find((g) => verdict.get(g) !== "go") ?? "group_ic";
}

/** Worst S1 data-confidence grade across the project's live industries. */
function deriveDataConfidence(db: Database, projectId: string): DataConfidenceGrade | null {
  const industries = db
    .query(
      `SELECT industry_id AS id FROM project_industry WHERE project_id = ? AND superseded_by IS NULL
       UNION
       SELECT o.industry_id AS id FROM md_project p JOIN opportunity o ON o.id = p.source_opportunity_id
       WHERE p.id = ? AND o.industry_id IS NOT NULL`,
    )
    .all(projectId, projectId) as Array<{ id: string }>;
  let worst: DataConfidenceGrade | null = null;
  for (const { id } of industries) {
    const v = db
      .query(
        `SELECT v.data_confidence_grade AS g FROM market_sizing_version v
         JOIN market_sizing_analysis a ON a.id = v.analysis_id
         WHERE a.industry_id = ? AND a.status = 'completed' AND v.data_confidence_grade IS NOT NULL
         ORDER BY v.version_no DESC LIMIT 1`,
      )
      .get(id) as { g: DataConfidenceGrade } | undefined;
    if (v) worst = worst ? worseGrade(worst, v.g) : v.g;
  }
  // ADR-0123 #3 — a human-APPROVED backtest grade adjustment (migration 0161)
  // can only tighten the cap: take the worse of the derived grade and the
  // approved grade, never a better one (boundary #4).
  const approved = approvedConfidenceAdjustment(db, projectId);
  if (approved) worst = worst ? worseGrade(worst, approved) : approved;
  return worst;
}

/**
 * Worst approved grade across the LATEST org-scope and the LATEST
 * project-scope confidence adjustment (a newer approval supersedes the older
 * one within its scope); null when none is approved. The result only ever
 * lowers the derived grade — the caller takes the worse of the two.
 */
export function approvedConfidenceAdjustment(db: Database, projectId: string): DataConfidenceGrade | null {
  let worst: DataConfidenceGrade | null = null;
  try {
    const latest = (scopeSql: string, params: string[]) =>
      db
        .query(
          `SELECT proposed_grade AS g FROM confidence_grade_adjustment_proposal
           WHERE status = 'approved' AND ${scopeSql} ORDER BY decided_at DESC, id DESC LIMIT 1`,
        )
        .get(...params) as { g: DataConfidenceGrade } | undefined;
    for (const r of [latest("scope = 'org'", []), latest("scope = 'project' AND project_id = ?", [projectId])]) {
      if (r) worst = worst ? worseGrade(worst, r.g) : r.g;
    }
  } catch {
    // Table absent on a pre-0161 database: no adjustment applies.
    return null;
  }
  return worst;
}

function deriveIrrMargin(db: Database, projectId: string): number {
  const row = db
    .query(
      `SELECT m.inputs_json AS inputs, v.irr AS irr
       FROM business_case_model m
       JOIN valuation_simulation v ON v.model_id = m.id AND v.scenario = 'base' AND v.percentile = 'p50'
       WHERE m.project_id = ? AND m.archived_at IS NULL AND COALESCE(m.variant, 'market_forward') = 'market_forward'
       ORDER BY m.created_at DESC, m.id DESC LIMIT 1`,
    )
    .get(projectId) as { inputs: string | null; irr: number | null } | undefined;
  if (!row || row.irr === null || !row.inputs) return 0;
  try {
    const rate = (JSON.parse(row.inputs) as { discount_rate?: { value?: number } }).discount_rate?.value;
    return typeof rate === "number" ? Math.round((row.irr - rate) * 100 * 1e6) / 1e6 : 0;
  } catch {
    return 0;
  }
}

/** Latest persisted row per directly-scored dimension, to carry forward. */
function latestDimensionRows(db: Database, projectId: string): Map<string, { grade: RagGrade; rationale: string; remedy_shape: string | null; assessed_at: string }> {
  const rows = db
    .query(
      `SELECT dimension, grade, rationale, remedy_shape, assessed_at FROM (
         SELECT dimension, grade, rationale, remedy_shape, assessed_at,
                ROW_NUMBER() OVER (PARTITION BY dimension ORDER BY assessed_at DESC, id DESC) rn
         FROM rag_assessment WHERE project_id = ? AND dimension != 'overall'
       ) WHERE rn = 1`,
    )
    .all(projectId) as Array<{ dimension: string; grade: RagGrade; rationale: string; remedy_shape: string | null; assessed_at: string }>;
  return new Map(rows.map((r) => [r.dimension, r]));
}

function gather(db: Database, projectId: string): GatheredInputs {
  const stageGate = deriveStageGate(db, projectId);
  const dataConfidenceGrade = deriveDataConfidence(db, projectId);
  const prior = latestDimensionRows(db, projectId);
  // A row that was itself carried keeps its original note — re-prefixing on
  // every recompute would grow the text and defeat the inputs-hash idempotence.
  const carriedNote = (r: { assessed_at: string; rationale: string }) =>
    r.rationale.startsWith("Carried forward") ? "" : `Carried forward from the ${r.assessed_at} assessment (raw inputs are not persisted on the web side). `;

  const input: RagEvaluationInput = { stageGate };
  if (dataConfidenceGrade) input.chainGrade = dataConfidenceGrade;
  const market = prior.get("market");
  if (market) input.marketGrade = market.grade;
  const tech = prior.get("technical_execution");
  if (tech) input.technicalGrade = tech.grade;
  const risk = prior.get("risk");
  if (risk) input.riskGrade = risk.grade;

  const carried: NonNullable<RagEvaluationInput["carried"]> = {};
  const fin = prior.get("financial");
  if (fin) carried.financial = { grade: fin.grade, rationale: carriedNote(fin) + fin.rationale };
  const reg = prior.get("regulatory_permit");
  if (reg) {
    carried.regulatory_permit = {
      grade: reg.grade,
      rationale: carriedNote(reg) + reg.rationale,
      remedyShape: (reg.remedy_shape as "structural" | "behavioral" | "none" | null) ?? undefined,
    };
  }
  if (carried.financial || carried.regulatory_permit) input.carried = carried;

  return { input, irrOverHurdlePp: deriveIrrMargin(db, projectId), dataConfidenceGrade };
}

function anyAssessed(input: RagEvaluationInput): boolean {
  return Boolean(
    input.chainGrade || input.marketGrade || input.technicalGrade || input.riskGrade ||
      input.carried?.financial || input.carried?.regulatory_permit ||
      input.financial || input.regulatory || input.stageGate === "screening" || input.stageGate === "pre_fs",
  );
}

/**
 * Recompute and persist the proposed RAG for a project. Safe to call on every
 * read: an unchanged input set writes nothing.
 */
export function recomputeRag(
  db: Database,
  projectId: string,
  trigger: RagTrigger,
  opts: { actor: string; now?: string },
): RecomputeResult {
  const project = db.query("SELECT id FROM md_project WHERE id = ?").get(projectId);
  if (!project) {
    return { status: "project_not_found", runId: null, complete: false, overall: null, stageGate: null, dataConfidenceGrade: null };
  }
  const { input, irrOverHurdlePp, dataConfidenceGrade } = gather(db, projectId);
  if (!anyAssessed(input)) {
    return { status: "nothing_to_assess", runId: null, complete: false, overall: null, stageGate: input.stageGate, dataConfidenceGrade };
  }

  // Hash GRADES only: rationale text and timestamps must not make an
  // otherwise-identical input set look changed.
  const inputsHash = sha256({
    stageGate: input.stageGate,
    chain: input.chainGrade ?? null,
    market: input.marketGrade ?? null,
    technical: input.technicalGrade ?? null,
    risk: input.riskGrade ?? null,
    financial: input.carried?.financial?.grade ?? null,
    regulatory: input.carried?.regulatory_permit?.grade ?? null,
    irrOverHurdlePp,
  });
  const lastRun = db
    .query("SELECT id, input_hash, label FROM run WHERE project_id = ? AND label LIKE ? ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(projectId, `${WEB_RUN_PREFIX}%`) as { id: string; input_hash: string; label: string } | undefined;
  if (lastRun && lastRun.input_hash === inputsHash) {
    const view = readRagView(db, projectId);
    return {
      status: "unchanged",
      runId: lastRun.id,
      complete: view.status === "graded",
      overall: view.overall?.grade ?? null,
      stageGate: input.stageGate,
      dataConfidenceGrade,
    };
  }

  const previousMargin = (() => {
    const m = lastRun?.label.match(/irrpp=(-?[\d.]+)/);
    return m ? Number(m[1]) : null;
  })();
  const now = opts.now ?? new Date().toISOString();
  const runId = ulid();
  db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [
    runId,
    projectId,
    `${WEB_RUN_PREFIX}:${trigger} ${input.stageGate} irrpp=${irrOverHurdlePp}`,
    inputsHash,
    opts.actor,
    now,
  ]);
  const result = assessRun(db, {
    projectId,
    runId,
    input,
    irrOverHurdlePp,
    previousIrrOverHurdlePp: previousMargin,
    now,
    // Boundary #4 on the web path only: the confidence cap demotes
    // immediately, never holds a grade above what the data supports.
    enforceConfidenceCeiling: true,
  });
  db.run("UPDATE rag_assessment SET trigger_source = ?, inputs_hash = ? WHERE run_id = ?", [trigger, inputsHash, runId]);
  return {
    status: "assessed",
    runId,
    complete: result.complete,
    overall: result.recordedOverall,
    stageGate: input.stageGate,
    dataConfidenceGrade,
  };
}

export interface RagDimensionView {
  grade: RagGrade;
  rationale: string;
  assessed_at: string;
}

export interface RagView {
  /**
   * graded     — the latest assessment produced an overall grade of record.
   * not_graded — the latest assessment is incomplete (or none exists): there
   *              is NO overall grade and callers must not render a color.
   */
  status: "graded" | "not_graded";
  overall: RagDimensionView | null;
  dimensions: Partial<Record<RagDimension, RagDimensionView>>;
  missing_dimensions: RagDimension[];
  assessed_at: string | null;
}

/**
 * The IC-facing view of the LATEST assessment run. Unlike a per-dimension
 * "latest row" read, an older overall grade is never shown once a newer,
 * incomplete assessment exists — that would present a stale color as current.
 */
export function readRagView(db: Database, projectId: string): RagView {
  const latest = db
    .query("SELECT run_id, assessed_at FROM rag_assessment WHERE project_id = ? ORDER BY assessed_at DESC, id DESC LIMIT 1")
    .get(projectId) as { run_id: string; assessed_at: string } | undefined;
  if (!latest) {
    return { status: "not_graded", overall: null, dimensions: {}, missing_dimensions: [...RAG_DIMENSIONS], assessed_at: null };
  }
  const rows = db
    .query("SELECT dimension, grade, rationale, assessed_at FROM rag_assessment WHERE project_id = ? AND run_id = ?")
    .all(projectId, latest.run_id) as Array<{ dimension: string; grade: RagGrade; rationale: string; assessed_at: string }>;
  const dimensions: Partial<Record<RagDimension, RagDimensionView>> = {};
  let overall: RagDimensionView | null = null;
  for (const r of rows) {
    const v = { grade: r.grade, rationale: r.rationale, assessed_at: r.assessed_at };
    if (r.dimension === "overall") overall = v;
    else dimensions[r.dimension as RagDimension] = v;
  }
  return {
    status: overall ? "graded" : "not_graded",
    overall,
    dimensions,
    missing_dimensions: RAG_DIMENSIONS.filter((d) => !dimensions[d]),
    assessed_at: latest.assessed_at,
  };
}
