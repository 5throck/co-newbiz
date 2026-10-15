// ADR-0178 slice 0 (migration 0147): write side of the S5 plan pin. A pin is one append-only row
// holding the S5 investment input as loadInvestmentVectorsInput builds it (OPEN-1 snapshot) and its
// hash; a re-pin supersedes the current row and inserts the next one in ONE transaction with an
// audit row. Nothing here recomputes or alters a case, a simulation or an adopted result.
// Callers own the guards (human-only, analyst+, Green Field): promotion calls createS5PlanPin as the
// promoting person, the s5-pin route enforces the principal/role rules before calling.
import type { Database } from "bun:sqlite";
import { loadInvestmentVectorsInput } from "../../app/web-next/lib/investment-simulation-input.ts";
import { buildInvestmentVectors, type InvestmentVectorsInput } from "../../app/web-next/lib/investment-vectors.ts";
import { aggregatePlanLines, pinPlanLinesOf, s5PlanHashOf, serializePinSnapshot, parsePinSnapshot } from "../../app/web-next/lib/s5-plan-pin.ts";
import { getCurrentS5PlanPin, type S5PlanPinRow } from "../../app/web-next/lib/s5-plan-pin-s8.ts";
import { getLatestConfirmedInvestmentSimulationRun } from "./investment-simulation-run.repository.ts";
import { appendAudit } from "../lib/access-control.ts";
import { ulid } from "../lib/ulid.ts";
import { applyS5Reimport, planS5Import } from "./s5-cost-import.ts";

export class S5PinError extends Error {
  constructor(public code: "not_found" | "not_greenfield" | "no_s5_plan", message: string) { super(message); }
}

function greenfieldOpportunity(db: Database, projectId: string): string {
  const p = db.query("SELECT track, source_opportunity_id FROM md_project WHERE id = ?").get(projectId) as { track: string | null; source_opportunity_id: string | null } | undefined;
  if (!p) throw new S5PinError("not_found", "project not found");
  if (p.track !== "greenfield" || !p.source_opportunity_id) throw new S5PinError("not_greenfield", "S5 고정 참조는 Green Field 프로젝트에서만 사용할 수 있습니다.");
  return p.source_opportunity_id;
}

export interface S5PlanSummary {
  plan_hash: string | null;
  s5_sim_run_id: string | null;
  horizon: number;
  /** Plan totals by category group (백만원), whole horizon. */
  totals: { capex: number; labor_opex: number; gov_rnd: number; staffing: number };
  /** Per-year plan vectors, index 0 = year 1. */
  by_year: { capex: number[]; labor_opex: number[]; gov_rnd: number[]; staffing: number[] };
  /** Slice 1 introduces startYear 0; until then there is no pre-launch amount. */
  pre_launch_total: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const sum = (v: number[]): number => round2(v.reduce((a, n) => a + n, 0));

function summarize(input: InvestmentVectorsInput, hash: string | null, runId: string | null): S5PlanSummary {
  const { horizon, lines } = pinPlanLinesOf(input);
  const agg = aggregatePlanLines(horizon, lines);
  const staffing = buildInvestmentVectors(input).mode.staffingByYear;
  return {
    plan_hash: hash,
    s5_sim_run_id: runId,
    horizon: agg.horizonYears,
    totals: { capex: sum(agg.capexByYear), labor_opex: sum(agg.laborOpexByYear), gov_rnd: sum(agg.govRndByYear), staffing: sum(staffing) },
    by_year: { capex: agg.capexByYear.map(round2), labor_opex: agg.laborOpexByYear.map(round2), gov_rnd: agg.govRndByYear.map(round2), staffing },
    pre_launch_total: 0,
  };
}

export interface S5RepinPreview {
  has_pin: boolean;
  pin: { id: string; pinned_at: string; pinned_by: string; reason: "initial" | "repin" } | null;
  pinned: S5PlanSummary | null;
  current: S5PlanSummary;
  /** True when a re-pin would move the reference (hash or confirmed run differ). */
  changed: boolean;
  changes: { plan: boolean; run: boolean };
  /** Lines the copy refresh would import (copy path stays consistent for line views). */
  copy_importable: number;
}

/** Pure read of what a (re-)pin would do. Throws S5PinError when there is nothing to pin. */
export function previewS5Repin(db: Database, projectId: string): S5RepinPreview {
  const opp = greenfieldOpportunity(db, projectId);
  const live = loadInvestmentVectorsInput(db, opp);
  if (!live) throw new S5PinError("no_s5_plan", "고정할 S5 투자 계획이 없습니다 (저장된 라인 없음).");
  const run = getLatestConfirmedInvestmentSimulationRun(opp, db);
  const hash = s5PlanHashOf(live);
  const cur = getCurrentS5PlanPin(db, projectId);
  const pinnedInput = cur ? parsePinSnapshot(cur.input_snapshot_json) : null;
  const plan = !cur || cur.plan_hash !== hash;
  const runChanged = !cur || (cur.s5_sim_run_id ?? null) !== (run?.id ?? null);
  return {
    has_pin: !!cur,
    pin: cur ? { id: cur.id, pinned_at: cur.pinned_at, pinned_by: cur.pinned_by, reason: cur.reason } : null,
    pinned: cur && pinnedInput ? summarize(pinnedInput, cur.plan_hash, cur.s5_sim_run_id) : null,
    current: summarize(live, hash, run?.id ?? null),
    changed: plan || runChanged,
    changes: { plan, run: runChanged },
    copy_importable: planS5Import(db, opp).importable,
  };
}

export interface S5PinWriteResult {
  /** Row now in force (the new one, or the unchanged current one when nothing moved). */
  pin: S5PlanPinRow;
  /** False when a re-pin found the pin already equal to the live source and confirmed run (no row written). */
  written: boolean;
  superseded_pin_id: string | null;
  action: "s5_plan_pin.pinned" | "s5_plan_pin.repinned" | null;
}

/**
 * Pin the project's live S5 input. No current pin -> the initial pin (`reason=initial`, audit
 * `s5_plan_pin.pinned`); a current pin -> supersede it and insert the next (`reason=repin`, audit
 * `s5_plan_pin.repinned`), unless hash and confirmed run are unchanged (then nothing is written).
 * Caller owns the surrounding transaction when nesting; this opens its own otherwise.
 */
export function createS5PlanPin(db: Database, opts: { projectId: string; actor: string; now?: string }): S5PinWriteResult {
  const now = opts.now ?? new Date().toISOString();
  return db.transaction((): S5PinWriteResult => {
    const opp = greenfieldOpportunity(db, opts.projectId);
    const live = loadInvestmentVectorsInput(db, opp);
    if (!live) throw new S5PinError("no_s5_plan", "고정할 S5 투자 계획이 없습니다 (저장된 라인 없음).");
    const hash = s5PlanHashOf(live);
    const run = getLatestConfirmedInvestmentSimulationRun(opp, db);
    const cur = getCurrentS5PlanPin(db, opts.projectId);
    if (cur && cur.plan_hash === hash && (cur.s5_sim_run_id ?? null) === (run?.id ?? null)) {
      return { pin: cur, written: false, superseded_pin_id: null, action: null };
    }
    const id = ulid();
    const action = cur ? "s5_plan_pin.repinned" : "s5_plan_pin.pinned";
    const auditId = appendAudit(db, {
      actor: opts.actor,
      action,
      target: `${opts.projectId}#${id}:old=${cur?.id ?? "-"};hash=${cur?.plan_hash ?? "-"}->${hash};run=${cur?.s5_sim_run_id ?? "-"}->${run?.id ?? "-"}`,
      now,
    });
    if (cur) db.run("UPDATE s5_plan_pin SET superseded_at = ?, superseded_by = ? WHERE id = ? AND superseded_at IS NULL", [now, id, cur.id]);
    db.run(
      `INSERT INTO s5_plan_pin (id, project_id, opportunity_id, plan_hash, s5_sim_run_id, s5_sim_input_hash, input_snapshot_json, pinned_by, pinned_at, superseded_at, superseded_by, reason, audit_id)
       VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)`,
      [id, opts.projectId, opp, hash, run?.id ?? null, run?.input_hash ?? null, serializePinSnapshot(live), opts.actor, now, cur ? "repin" : "initial", auditId],
    );
    return { pin: getCurrentS5PlanPin(db, opts.projectId)!, written: true, superseded_pin_id: cur?.id ?? null, action };
  })();
}

export interface S5RepinResult extends S5PinWriteResult {
  /** The compat copy was refreshed through the PR #590 re-import (so line views stay consistent). */
  copy_refreshed: boolean;
  copy_model_id: string | null;
  archived_model_ids: string[];
}

/**
 * `최신 S5로 갱신` for a pinned project: re-pin AND refresh the compat copy, one transaction. The
 * copy refresh is skipped (reported, not failed) when the live plan has nothing importable. Existing
 * cases are never regenerated; bc.s5_source and bc.investment_basis are never changed.
 */
export function repinS5Plan(db: Database, projectId: string, actor: string, now: string = new Date().toISOString()): S5RepinResult {
  return db.transaction((): S5RepinResult => {
    const opp = greenfieldOpportunity(db, projectId);
    const pinned = createS5PlanPin(db, { projectId, actor, now });
    let copyModelId: string | null = null;
    let archived: string[] = [];
    let refreshed = false;
    if (planS5Import(db, opp).importable > 0) {
      const r = applyS5Reimport(db, projectId, actor, now);
      copyModelId = r.model_id;
      archived = r.archived_model_ids;
      refreshed = true;
    }
    return { ...pinned, copy_refreshed: refreshed, copy_model_id: copyModelId, archived_model_ids: archived };
  })();
}
