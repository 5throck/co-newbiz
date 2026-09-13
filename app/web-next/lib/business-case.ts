// business-case — read/model helpers for the S8 surface (ADR-0098 §3/§4).
// Both write paths (automatic generation via lib/business-case-generator.ts
// and manual CRUD via the API) land in the same tables, so every read here is
// write-path-agnostic — the S8 completion check cannot tell the difference
// and does not need to.
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { SCENARIOS, recommendedFromDb, type Scenario } from "./business-case-generator.ts";

export interface SimulationRow {
  id: string;
  model_id: string;
  scenario: string;
  percentile: string;
  npv_krw_m: number;
  irr: number | null;
  note: string | null;
}

export interface LineRow {
  id: string;
  category: "labor" | "opex" | "capex" | "revenue";
  name: string;
  annual_amount_krw_m: number;
  start_year: number;
  growth_rate: number;
  note: string | null;
}

export interface BusinessCaseView {
  id: string;
  kind: string;
  name: string;
  horizon_years: number;
  scenario: Scenario | null;
  /** ADR-0117 dual-perspective valuation — market_forward (진행 1차) or
   *  historical (비교 근거). Legacy rows default to market_forward. */
  variant: "market_forward" | "historical";
  source: "generated" | "manual";
  recommended: boolean;
  adopted: boolean;
  created_by: string;
  created_at: string;
  lines: LineRow[];
  simulations: SimulationRow[];
}

/** The adoption marker: a human-only process_run row (stage s8_case_adopt) —
 * generation never writes this stage, and the adopt API is its only writer. */
export interface AdoptionRecord {
  modelId: string;
  adoptedBy: string;
  adoptedAt: string;
}

export function latestAdoption(projectId: string): AdoptionRecord | null {
  const row = getDb()
    .query(
      `SELECT meta_json, started_by, started_at FROM process_run
       WHERE entity_type = 'project' AND entity_id = ? AND stage = 's8_case_adopt' AND status = 'done'
       ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .get(projectId) as { meta_json: string | null; started_by: string; started_at: string } | undefined;
  if (!row?.meta_json) return null;
  try {
    const meta = JSON.parse(row.meta_json) as { model_id?: string };
    if (!meta.model_id) return null;
    return { modelId: meta.model_id, adoptedBy: row.started_by, adoptedAt: row.started_at };
  } catch {
    return null;
  }
}

/** Full S8 read model: every case for the project with lines, simulations,
 * the engine's RECOMMENDED flag, and the human adoption marker. */
export function listBusinessCases(projectId: string): {
  cases: BusinessCaseView[];
  recommendedScenario: Scenario | null;
  adoption: AdoptionRecord | null;
} {
  const db = getDb();
  const models = db
    .query("SELECT id, kind, name, horizon_years, created_by, created_at, COALESCE(variant, 'market_forward') AS variant FROM business_case_model WHERE project_id = ? ORDER BY created_at, id")
    .all(projectId) as Array<{ id: string; kind: string; name: string; horizon_years: number; created_by: string; created_at: string; variant: "market_forward" | "historical" }>;
  const lines = db
    .query(
      `SELECT id, model_id, category, name, annual_amount_krw_m, start_year, growth_rate, note
       FROM business_case_line
       WHERE model_id IN (SELECT id FROM business_case_model WHERE project_id = ?)
       ORDER BY category, start_year, id`,
    )
    .all(projectId) as unknown as Array<LineRow & { model_id: string }>;
  const sims = db
    .query("SELECT id, model_id, scenario, percentile, npv_krw_m, irr, note FROM valuation_simulation WHERE project_id = ? ORDER BY scenario, percentile")
    .all(projectId) as unknown as SimulationRow[];
  const recommended = recommendedFromDb(projectId);
  const adoption = latestAdoption(projectId);
  const cases: BusinessCaseView[] = models.map((m) => {
    const modelSims = sims.filter((s) => s.model_id === m.id);
    const scenario = SCENARIOS.find((s) => modelSims.some((sim) => sim.scenario === s)) ?? null;
    return {
      id: m.id,
      kind: m.kind,
      name: m.name,
      horizon_years: m.horizon_years,
      scenario,
      variant: m.variant,
      source: m.created_by === "business-case-generator" || scenario !== null ? "generated" : "manual",
      // ADR-0117: the RECOMMENDED badge belongs to the gate-primary variant only.
      recommended: scenario !== null && scenario === recommended && m.variant === "market_forward",
      adopted: adoption?.modelId === m.id,
      created_by: m.created_by,
      created_at: m.created_at,
      lines: lines.filter((l) => l.model_id === m.id).map(({ model_id: _m, ...rest }) => rest),
      simulations: modelSims,
    };
  });
  return { cases, recommendedScenario: recommended, adoption };
}

/** Human-only adoption (boundary #2): record WHICH case feeds the fs gate.
 * The engine may recommend; only this write — reached through the analyst's
 * explicit click — marks adoption. */
export function adoptBusinessCase(projectId: string, modelId: string, adoptedBy: string): AdoptionRecord {
  const db = getDb();
  const model = db.query("SELECT id FROM business_case_model WHERE id = ? AND project_id = ?").get(modelId, projectId) as
    | { id: string }
    | undefined;
  if (!model) throw new Error(`business case '${modelId}' not found for project '${projectId}'`);
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [ulid(), "project", projectId, projectId, "unknown", "s8_case_adopt", "done", "web", adoptedBy, now, now, JSON.stringify({ model_id: modelId })],
  );
  appendAudit(db, { actor: adoptedBy, action: "business_case_adopted", target: `${projectId}:${modelId}`, now });
  return { modelId, adoptedBy, adoptedAt: now };
}
