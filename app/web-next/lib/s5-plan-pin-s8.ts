// ADR-0178 slice 0: read side of the S5 plan pin for S8 - which pin is in force, the pinned plan
// and S5 simulation run it resolves to, and the stale state (rules of design section 4A.4).
// Pure reads. Amendment 2026-10-16 (DEC-20261016-01): the pinned reference is the DEFAULT for
// Green Field — a current pin applies unless a person explicitly reverted (`bc.s5_source = 0`
// wins over everything; the latest user row decides). Stale state is informational: it never
// blocks a gate, changes a grade or alters an adopted result.
import { getInvestmentSimulationRun, getLatestConfirmedInvestmentSimulationRun } from "../../../db/repositories/investment-simulation-run.repository.ts";
import { drawInvestmentFactors } from "./investment-simulation.ts";
import { loadInvestmentVectorsInput } from "./investment-simulation-input.ts";
import type { S5SimConsumption } from "./investment-simulation-s8.ts";
import type { effectiveAssumptions } from "./investment-vectors.ts";
import { parsePinSnapshot, s5PinFragmentOfNote, s5PlanHashOf } from "./s5-plan-pin.ts";
import type { InvestmentVectorsInput } from "./investment-vectors.ts";
import type { Database } from "bun:sqlite";

/** Structural subset of bun:sqlite Database (resolveBusinessCaseParams takes the loose form). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LooseDb = { query: (sql: string) => { get: (...args: any[]) => unknown; all: (...args: any[]) => unknown[] } };

export interface S5PlanPinRow {
  id: string;
  project_id: string;
  opportunity_id: string;
  plan_hash: string;
  s5_sim_run_id: string | null;
  s5_sim_input_hash: string | null;
  input_snapshot_json: string;
  pinned_by: string;
  pinned_at: string;
  superseded_at: string | null;
  superseded_by: string | null;
  reason: "initial" | "repin";
  audit_id: string | null;
}

const PIN_COLUMNS = "id, project_id, opportunity_id, plan_hash, s5_sim_run_id, s5_sim_input_hash, input_snapshot_json, pinned_by, pinned_at, superseded_at, superseded_by, reason, audit_id";

/** The current pin row of a project, or null (no row, or migration 0147 pending). */
export function getCurrentS5PlanPin(db: LooseDb, projectId: string): S5PlanPinRow | null {
  try {
    return (db.query(`SELECT ${PIN_COLUMNS} FROM s5_plan_pin WHERE project_id = ? AND superseded_at IS NULL`).get(projectId) as S5PlanPinRow | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Every pin row of a project, newest first (the supersede chain). */
export function listS5PlanPins(db: LooseDb, projectId: string): S5PlanPinRow[] {
  try {
    return db.query(`SELECT ${PIN_COLUMNS} FROM s5_plan_pin WHERE project_id = ? ORDER BY pinned_at DESC, id DESC`).all(projectId) as S5PlanPinRow[];
  } catch {
    return [];
  }
}

/** `bc.s5_source = 1` (a person's explicit connect/re-opt-in), latest user row wins. Never set by promotion. */
export function s5SourceOptedIn(db: LooseDb, projectId: string): boolean {
  const row = latestS5SourceRow(db, projectId);
  return !!row && row.value === 1;
}

/**
 * A person's explicit revert (`복사본으로 되돌리기`, `bc.s5_source = 0`), latest user row wins.
 * Under the amended default this is the ONLY way a Green Field project with an importable plan
 * stays on the copy path — the lazy default at generation never re-links a reverted project.
 */
export function s5SourceReverted(db: LooseDb, projectId: string): boolean {
  const row = latestS5SourceRow(db, projectId);
  return !!row && row.value === 0;
}

function latestS5SourceRow(db: LooseDb, projectId: string): { value: 0 | 1 } | undefined {
  return db
    .query(
      `SELECT a.value FROM assumption a JOIN run r ON r.id = a.run_id
       WHERE r.project_id = ? AND a.assumption_key = 'bc.s5_source' AND a.kind = 'user'
       ORDER BY a.as_of DESC, r.created_at DESC, a.id DESC LIMIT 1`,
    )
    .get(projectId) as { value: 0 | 1 } | undefined;
}

export interface ActiveS5Pin {
  pin: S5PlanPinRow;
  input: InvestmentVectorsInput;
}

/**
 * The pin S8 computes against, under the AMENDED DEFAULT (ADR-0178 Amendment 2026-10-16): the
 * latest user `bc.s5_source` row decides. 0 = a person reverted -> the copy path. Any other
 * state (no row, or an explicit 1) with a current pin whose snapshot parses -> the PINNED path.
 * A corrupt snapshot is treated as "no pin", never half-read.
 */
export function resolveActivePin(db: LooseDb, projectId: string): ActiveS5Pin | null {
  if (s5SourceReverted(db, projectId)) return null;
  const pin = getCurrentS5PlanPin(db, projectId);
  if (!pin) return null;
  const input = parsePinSnapshot(pin.input_snapshot_json);
  return input ? { pin, input } : null;
}

/**
 * Pinned variant of resolveS5SimConsumption (design 4A.7): the run is the one the pin names
 * (`pin.s5_sim_run_id`), not "the latest confirmed run". Still requires the run to be confirmed
 * (a person's act) - an unconfirmed pinned run is treated as none.
 */
export function resolvePinnedS5SimConsumption(db: Database, pin: Pick<S5PlanPinRow, "opportunity_id" | "s5_sim_run_id">): S5SimConsumption | null {
  if (!pin.s5_sim_run_id) return null;
  try {
    const run = getInvestmentSimulationRun(pin.opportunity_id, pin.s5_sim_run_id, db);
    if (!run || !run.confirmed_at) return null;
    const eff = run.assumptions as ReturnType<typeof effectiveAssumptions>;
    const factors = drawInvestmentFactors(run.seed, run.draw_count, eff);
    return {
      runId: run.id,
      inputHash: run.input_hash,
      seed: run.seed,
      drawCount: run.draw_count,
      capFactors: factors.map((f) => f.cap),
      manFactors: factors.map((f) => f.man),
      salaryFactors: factors.map((f) => f.salary),
      increaseFactorsPp: factors.map((f) => f.inc),
      onCostFactorsPp: factors.map((f) => f.onc),
      rampFactors: factors.map((f) => f.ramp),
    };
  } catch {
    return null;
  }
}

// ── Stale state (design 4A.4) ───────────────────────────────────────────────

export type S5PinStaleReason =
  | "source_changed" //            rule 1: live S5 source no longer hashes to the pin
  | "newer_confirmed_run" //       rule 2: a newer confirmed S5 run than the pinned one
  | "pinned_run_superseded" //     rule 2: the pinned run was superseded
  | "case_on_older_pin"; //        rule 3: the latest case was generated against a pin no longer current

export type S5PinState = "not_applicable" | "in_effect" | "stale";

export interface S5PinStatus {
  /** Which path S8 computes on right now. */
  path: "copy" | "pinned";
  /** True when a person explicitly connected (bc.s5_source = 1). */
  optedIn: boolean;
  /** True when a person explicitly reverted (bc.s5_source = 0); the copy path then persists across generations. */
  reverted: boolean;
  pin: { id: string; planHash: string; pinnedAt: string; pinnedBy: string; reason: "initial" | "repin"; s5SimRunId: string | null } | null;
  /** `not_applicable` = no pin row. Otherwise `stale` when any rule fires. Computed even off the pinned path (display only). */
  state: S5PinState;
  stale: boolean;
  reasons: S5PinStaleReason[];
  /** `s5_pin=` of the project's latest case note (null = none / copy-path case). */
  caseGeneratedOnPin: string | null;
  label: string;
}

const LABEL: Record<S5PinState, string> = { not_applicable: "", in_effect: "S5 고정 참조 최신", stale: "재평가 필요" };

/**
 * Stale state of a project's pin. Reads only: the live S5 source (hash), the confirmed S5 runs and
 * the latest case note. Never recomputes a case.
 */
export function s5PinStatusForProject(db: Database, projectId: string): S5PinStatus {
  const optedIn = s5SourceOptedIn(db, projectId);
  const reverted = s5SourceReverted(db, projectId);
  const pin = getCurrentS5PlanPin(db, projectId);
  const base = (state: S5PinState, reasons: S5PinStaleReason[], caseOn: string | null): S5PinStatus => ({
    path: !reverted && pin ? "pinned" : "copy",
    optedIn,
    reverted,
    pin: pin ? { id: pin.id, planHash: pin.plan_hash, pinnedAt: pin.pinned_at, pinnedBy: pin.pinned_by, reason: pin.reason, s5SimRunId: pin.s5_sim_run_id } : null,
    state,
    stale: state === "stale",
    reasons,
    caseGeneratedOnPin: caseOn,
    label: LABEL[state],
  });
  if (!pin) return base("not_applicable", [], null);
  const reasons: S5PinStaleReason[] = [];
  // Rule 1: the live source no longer hashes to the pin (a removed plan counts as changed).
  const live = loadInvestmentVectorsInput(db, pin.opportunity_id);
  if (!live || s5PlanHashOf(live) !== pin.plan_hash) reasons.push("source_changed");
  // Rule 2: a newer confirmed run than the pinned one, or the pinned run was superseded.
  try {
    const latest = getLatestConfirmedInvestmentSimulationRun(pin.opportunity_id, db);
    if (latest && latest.id !== pin.s5_sim_run_id) reasons.push("newer_confirmed_run");
    if (pin.s5_sim_run_id) {
      const pinned = getInvestmentSimulationRun(pin.opportunity_id, pin.s5_sim_run_id, db);
      if (pinned && pinned.status === "superseded") reasons.push("pinned_run_superseded");
    }
  } catch { /* migration 0144/0146 pending: no run rules */ }
  // Rule 3: the latest case of the project was generated against an older pin.
  const row = db
    .query("SELECT note FROM valuation_simulation WHERE project_id = ? AND note LIKE '%s5_pin=%' ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(projectId) as { note: string | null } | null;
  const caseOn = s5PinFragmentOfNote(row?.note);
  if (caseOn && caseOn !== pin.id) reasons.push("case_on_older_pin");
  return base(reasons.length > 0 ? "stale" : "in_effect", reasons, caseOn);
}
