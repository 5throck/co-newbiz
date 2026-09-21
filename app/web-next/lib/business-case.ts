// business-case — read/model helpers for the S8 surface (ADR-0098 §3/§4).
// Both write paths (automatic generation via lib/business-case-generator.ts
// and manual CRUD via the API) land in the same tables, so every read here is
// write-path-agnostic — the S8 completion check cannot tell the difference
// and does not need to.
// ADR-0143: brownfield cases carry a target axis (business_case_model
// .target_id); target selection is a human process_run record
// (s8_target_select) and brownfield adoption is constrained to the selected
// target's cases.
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { SCENARIOS, recommendedFromDb, recommendTargetsFromDb, type Scenario, type TargetComparisonRow } from "./business-case-generator.ts";
import { resolveOrCreateCompany } from "./brownfield-targets.ts";

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
  /** ADR-0143 target axis — the brownfield shortlist subject this case
   *  analyzes. NULL for greenfield/project-level cases. */
  target_id: string | null;
  target_name: string | null;
  source: "generated" | "manual";
  recommended: boolean;
  adopted: boolean;
  created_by: string;
  inputs_json?: string | null;
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

/** The human target-selection record (ADR-0143): a process_run row
 * (stage s8_target_select) — the selection API is its only writer. */
export interface TargetSelectionRecord {
  targetId: string;
  rationale: string;
  selectedBy: string;
  selectedAt: string;
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

export function latestTargetSelection(projectId: string): TargetSelectionRecord | null {
  const row = getDb()
    .query(
      `SELECT meta_json, started_by, started_at FROM process_run
       WHERE entity_type = 'project' AND entity_id = ? AND stage = 's8_target_select' AND status = 'done'
       ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .get(projectId) as { meta_json: string | null; started_by: string; started_at: string } | undefined;
  if (!row?.meta_json) return null;
  try {
    const meta = JSON.parse(row.meta_json) as { target_id?: string; rationale?: string };
    if (!meta.target_id) return null;
    return { targetId: meta.target_id, rationale: meta.rationale ?? "", selectedBy: row.started_by, selectedAt: row.started_at };
  } catch {
    return null;
  }
}

/** Human-only target selection (ADR-0143, boundary #2): records WHICH
 * shortlisted target the project proceeds with and finalizes
 * md_project.company_id (the rank-1 binding at promotion was provisional).
 * Re-selection is allowed — the latest record wins and the audit trail keeps
 * every earlier one. */
export function selectTarget(projectId: string, targetId: string, rationale: string, selectedBy: string): TargetSelectionRecord {
  const db = getDb();
  const project = db
    .query("SELECT id, track, source_opportunity_id FROM md_project WHERE id = ?")
    .get(projectId) as { id: string; track: "greenfield" | "brownfield" | null; source_opportunity_id: string | null } | undefined;
  if (!project) throw new Error(`project '${projectId}' not found`);
  if (project.track !== "brownfield") throw new Error("target selection applies to brownfield projects only");
  const target = db
    .query("SELECT id, company_name, dart_corp_code, status FROM brownfield_target WHERE id = ? AND opportunity_id = ?")
    .get(targetId, project.source_opportunity_id ?? "") as { id: string; company_name: string; dart_corp_code: string | null; status: string } | undefined;
  if (!target || target.status !== "shortlisted") throw new Error(`target '${targetId}' is not on this project's Short List`);
  if (!rationale?.trim()) throw new Error("rationale is mandatory for a target selection record (ADR-0053)");
  const now = new Date().toISOString();
  db.transaction(() => {
    db.run(
      `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [ulid(), "project", projectId, projectId, "unknown", "s8_target_select", "done", "web", selectedBy, now, now, JSON.stringify({ target_id: targetId, rationale: rationale.trim() })],
    );
    const companyId = resolveOrCreateCompany(db, target.company_name, target.dart_corp_code);
    db.run("UPDATE md_project SET company_id = ? WHERE id = ?", [companyId, projectId]);
  })();
  appendAudit(db, { actor: selectedBy, action: "s8_target_selected", target: `${projectId}:${targetId}`, now });
  return { targetId, rationale: rationale.trim(), selectedBy, selectedAt: now };
}

/** Full S8 read model: every case for the project with lines, simulations,
 * the engine's RECOMMENDED flag, the human adoption marker, and — for
 * brownfield — the target comparison rows and the selection record. */
export function listBusinessCases(projectId: string): {
  cases: BusinessCaseView[];
  recommendedScenario: Scenario | null;
  adoption: AdoptionRecord | null;
  targetSelection: TargetSelectionRecord | null;
  targets: TargetComparisonRow[];
} {
  const db = getDb();
  const models = db
    .query(
      `SELECT m.id, m.kind, m.name, m.horizon_years, m.created_by, m.created_at,
              COALESCE(m.variant, 'market_forward') AS variant, m.inputs_json, m.target_id,
              bt.company_name AS target_name
       FROM business_case_model m LEFT JOIN brownfield_target bt ON bt.id = m.target_id
       WHERE m.project_id = ? ORDER BY m.created_at, m.id`,
    )
    .all(projectId) as Array<{ id: string; kind: string; name: string; horizon_years: number; created_by: string; created_at: string; variant: "market_forward" | "historical"; inputs_json: string | null; target_id: string | null; target_name: string | null }>;
  const lines = db
    .query(
      `SELECT id, model_id, category, name, annual_amount_krw_m, sales_volume, unit_price_krw, start_year, growth_rate, note
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
  const targetSelection = latestTargetSelection(projectId);
  const targets = recommendTargetsFromDb(projectId);
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
      target_id: m.target_id,
      target_name: m.target_name,
      source: m.created_by === "business-case-generator" || scenario !== null ? "generated" : "manual",
      // ADR-0117: the RECOMMENDED badge belongs to the gate-primary variant only.
      recommended: scenario !== null && scenario === recommended && m.variant === "market_forward" && m.target_id === null,
      adopted: adoption?.modelId === m.id,
      created_by: m.created_by,
      created_at: m.created_at,
      inputs_json: m.inputs_json ?? null,
      lines: lines.filter((l) => l.model_id === m.id).map(({ model_id: _m, ...rest }) => rest),
      simulations: modelSims,
    };
  });
  return { cases, recommendedScenario: recommended, adoption, targetSelection, targets };
}

/** Human-only adoption (boundary #2): record WHICH case feeds the fs gate.
 * The engine may recommend; only this write — reached through the analyst's
 * explicit click — marks adoption. ADR-0143: a brownfield case (target_id
 * set) can only be adopted after the human target selection, and only when it
 * belongs to the selected target. */
export function adoptBusinessCase(projectId: string, modelId: string, adoptedBy: string): AdoptionRecord {
  const db = getDb();
  const model = db.query("SELECT id, target_id FROM business_case_model WHERE id = ? AND project_id = ?").get(modelId, projectId) as
    | { id: string; target_id: string | null }
    | undefined;
  if (!model) throw new Error(`business case '${modelId}' not found for project '${projectId}'`);
  if (model.target_id) {
    const selection = latestTargetSelection(projectId);
    if (!selection) throw new Error("대상 선정이 먼저 필요합니다 — 비교 분석 후 분석 대상을 선정하세요 (ADR-0143)");
    if (selection.targetId !== model.target_id) throw new Error("선정된 대상의 케이스만 채택할 수 있습니다 (ADR-0143)");
  }
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [ulid(), "project", projectId, projectId, "unknown", "s8_case_adopt", "done", "web", adoptedBy, now, now, JSON.stringify({ model_id: modelId })],
  );
  appendAudit(db, { actor: adoptedBy, action: "business_case_adopted", target: `${projectId}:${modelId}`, now });
  return { modelId, adoptedBy, adoptedAt: now };
}
