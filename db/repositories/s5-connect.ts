// ADR-0178 follow-up (decider feedback 2026-10-16): `S5와 연결하기` / `복사본으로 되돌리기`.
// One person-triggered act that does, in ONE transaction with ONE audit row, what slice 0 needed
// three separate steps for: pin the live S5 plan (reusing the slice-0 pin / re-pin repository),
// set bc.investment_basis to `S5 투자 계획` (s5_plan) when it is still `비율 추정`, and set
// bc.s5_source = 1. Existing cases, simulations and adopted results are NEVER recalculated or
// altered - `자동 생성` must be run again. Callers own the guards (human-only, analyst+, visibility).
import type { Database } from "bun:sqlite";
import { loadInvestmentVectorsInput } from "../../app/web-next/lib/investment-simulation-input.ts";
import { s5SourceOptedIn, s5SourceReverted, getCurrentS5PlanPin } from "../../app/web-next/lib/s5-plan-pin-s8.ts";
import { appendAudit } from "../lib/access-control.ts";
import { recordAssumption } from "../lib/assumption.ts";
import { createRun } from "../lib/versioning.ts";
import { createS5PlanPin, previewS5Repin, repinS5Plan, S5PinError, type S5RepinPreview } from "./s5-plan-pin.ts";
import { planS5Import, previewS5Reimport, type S5ReimportPreview } from "./s5-cost-import.ts";

export class S5ConnectError extends Error {
  constructor(public code: "not_found" | "not_greenfield" | "no_importable_lines" | "not_connected", message: string) { super(message); }
}

/** Latest user value of one bc.* key (same ordering as resolveBusinessCaseParams), or null. */
function bcScalar(db: Database, projectId: string, key: string): number | null {
  const row = db
    .query(
      `SELECT a.value FROM assumption a JOIN run r ON r.id = a.run_id
       WHERE r.project_id = ? AND a.assumption_key = ? AND a.kind = 'user'
       ORDER BY a.as_of DESC, r.created_at DESC, a.id DESC LIMIT 1`,
    )
    .get(projectId, key) as { value: number } | undefined;
  return row && Number.isFinite(row.value) ? row.value : null;
}

function greenfieldOpportunity(db: Database, projectId: string): string {
  const p = db.query("SELECT track, source_opportunity_id FROM md_project WHERE id = ?").get(projectId) as { track: string | null; source_opportunity_id: string | null } | undefined;
  if (!p) throw new S5ConnectError("not_found", "project not found");
  if (p.track !== "greenfield" || !p.source_opportunity_id) throw new S5ConnectError("not_greenfield", "S5 연결은 Green Field 프로젝트에서만 사용할 수 있습니다.");
  return p.source_opportunity_id;
}

export interface S5ConnectPreview {
  /** Lines the S5 plan would contribute (confirmed-unit KRW lines + reflected priced capability lines). */
  import: S5ReimportPreview;
  /** Pinned-vs-current totals; `pinned` is null when no pin exists yet. */
  pin: S5RepinPreview;
  /** True when a confirmed S5 simulation run exists (the pin would reference it). */
  confirmed_run_exists: boolean;
  current: { investment_basis: "ratio" | "s5_plan" | "s5_plan_full" | "s5_pnl"; s5_source: 0 | 1 };
  /** What the confirm will change. basis is null when the unified S5 basis is already in force. */
  will_set: { investment_basis: "s5_plan_full" | null; s5_source: 1 };
}

const BASIS_OF_CODE: Record<number, "ratio" | "s5_plan" | "s5_plan_full" | "s5_pnl"> = { 0: "ratio", 1: "s5_plan", 2: "s5_plan_full", 3: "s5_pnl" };

function currentBasis(db: Database, projectId: string): "ratio" | "s5_plan" | "s5_plan_full" | "s5_pnl" {
  const v = bcScalar(db, projectId, "bc.investment_basis");
  return v != null && BASIS_OF_CODE[v] ? BASIS_OF_CODE[v] : "ratio";
}

/** Pure read of what `S5와 연결하기` would do. Throws when there is nothing to connect. */
export function previewS5Connect(db: Database, projectId: string): S5ConnectPreview {
  const opp = greenfieldOpportunity(db, projectId);
  if (planS5Import(db, opp).importable === 0) {
    throw new S5ConnectError("no_importable_lines", "연결할 수 있는 S5 투자비 라인이 없습니다 (단위 확정·KRW 라인 없음).");
  }
  if (!loadInvestmentVectorsInput(db, opp)) {
    throw new S5ConnectError("no_importable_lines", "연결할 S5 투자 계획이 없습니다 (저장된 라인 없음).");
  }
  const pin = previewS5Repin(db, projectId);
  const basis = currentBasis(db, projectId);
  return {
    import: previewS5Reimport(db, projectId),
    pin,
    confirmed_run_exists: pin.current.s5_sim_run_id != null,
    current: { investment_basis: basis as "ratio" | "s5_plan" | "s5_plan_full" | "s5_pnl", s5_source: s5SourceOptedIn(db, projectId) ? 1 : 0 },
    will_set: { investment_basis: basis === "s5_plan_full" ? null : "s5_plan_full", s5_source: 1 },
  };
}

/** A fresh run carrying only the given bc.* user values (the write side of the resolution chain). */
function writeBc(db: Database, projectId: string, actor: string, now: string, rationale: string, values: Array<[string, number]>): string {
  const run = createRun(db, { projectId, label: "Business case parameter session", createdBy: actor, overrides: {}, now });
  for (const [key, value] of values) {
    recordAssumption(db, { runId: run.run_id, assumptionKey: key, kind: "user", value, asOf: now.slice(0, 10), rationale, actor, now });
  }
  return run.run_id;
}

export interface S5ConnectResult {
  pin_id: string;
  pin_written: boolean;
  superseded_pin_id: string | null;
  investment_basis_set: boolean;
  s5_source: 1;
  params_run_id: string;
  audit_action: "s5_plan_pin.connected";
}

/** Connect: pin (or re-pin) + unified basis + s5_source, one transaction, one `s5_plan_pin.connected` audit row.
 * The unified basis is stored as the existing s5_plan_full code (2): capex + labor/opex in plan-covered years.
 * A stored legacy s5_plan (1, capex-only) also moves to 2 on connect; only an already-unified 2 is kept. */
export function connectS5(db: Database, projectId: string, actor: string, now: string = new Date().toISOString()): S5ConnectResult {
  return db.transaction((): S5ConnectResult => {
    previewS5Connect(db, projectId); // throws not_found / not_greenfield / no_importable_lines before any write
    const hadPin = !!getCurrentS5PlanPin(db, projectId);
    const pinned = hadPin ? repinS5Plan(db, projectId, actor, now) : { ...createS5PlanPin(db, { projectId, actor, now }) };
    const basis = currentBasis(db, projectId);
    const values: Array<[string, number]> = [];
    if (basis !== "s5_plan_full") values.push(["bc.investment_basis", 2]);
    values.push(["bc.s5_source", 1]);
    const runId = writeBc(db, projectId, actor, now, "S5와 연결 (사람이 확정)", values);
    appendAudit(db, {
      actor,
      action: "s5_plan_pin.connected",
      target: `${projectId}#${pinned.pin.id}:basis=${basis}->s5_plan_full;s5_source=1;pin_written=${pinned.written};run=${runId}`,
      now,
    });
    return {
      pin_id: pinned.pin.id,
      pin_written: pinned.written,
      superseded_pin_id: pinned.superseded_pin_id,
      investment_basis_set: basis !== "s5_plan_full",
      s5_source: 1,
      params_run_id: runId,
      audit_action: "s5_plan_pin.connected",
    };
  })();
}

export interface S5DisconnectResult {
  s5_source: 0;
  params_run_id: string;
  pin_id: string | null;
  audit_action: "s5_plan_pin.disconnected";
}

/** `복사본으로 되돌리기`: bc.s5_source = 0. The pin history and the investment basis are kept. */
export function disconnectS5(db: Database, projectId: string, actor: string, now: string = new Date().toISOString()): S5DisconnectResult {
  return db.transaction((): S5DisconnectResult => {
    greenfieldOpportunity(db, projectId);
    if (!s5SourceOptedIn(db, projectId)) throw new S5ConnectError("not_connected", "S5 고정 참조를 사용 중이 아닙니다 (이미 복사본을 사용 중).");
    const pin = getCurrentS5PlanPin(db, projectId);
    const runId = writeBc(db, projectId, actor, now, "복사본으로 되돌림 (사람이 확정)", [["bc.s5_source", 0]]);
    appendAudit(db, { actor, action: "s5_plan_pin.disconnected", target: `${projectId}#${pin?.id ?? "-"}:s5_source=1->0;run=${runId}`, now });
    return { s5_source: 0, params_run_id: runId, pin_id: pin?.id ?? null, audit_action: "s5_plan_pin.disconnected" };
  })();
}

export { S5PinError };

// ── ADR-0178 Amendment 2026-10-16 (DEC-20261016-01): S5 linkage is the DEFAULT ───────────────

export interface S5AutoDefaultResult {
  /** False when nothing was written: Brown Field / no importable plan / a person's revert. */
  applied: boolean;
  pin_created: boolean;
  pin_id: string | null;
  basis_switched: boolean;
  prior_basis: "ratio" | "s5_plan" | "s5_plan_full" | "s5_pnl" | null;
}

/**
 * The amended default, applied lazily at generation (자동 생성) for a Green Field project with an
 * importable S5 plan: if no current pin exists, create the INITIAL pin (snapshot of the current
 * S5 source); and when the stored investment basis is not yet the unified `S5 투자 계획` (code 2)
 * — i.e. the ratio default or a legacy capex-only 1 — move it to 2 with an `auto_default` audit.
 * Existing cases, simulations and adopted results are NEVER recalculated; regeneration reflects
 * the new basis. A person's revert (`bc.s5_source = 0`) is never re-linked.
 *
 * Reading of the amendment followed here: a person-SET ratio (0) on a greenfield with an
 * importable plan is ALSO moved to the unified basis — the decider overrode the basis when
 * accepting the unified default, so the stored 0 survives only on projects without an importable
 * plan or after a revert (which keeps the basis, so it is moved at the last switch before it).
 *
 * Own small transaction (createS5PlanPin nests its own — bun:sqlite allows it): the generation
 * write path (runActivityChain) is not one transaction and input resolution is read-only, so
 * there is no outer transaction to join; an independent atomic unit keeps pin + basis + audit
 * consistent and a failure fails generation loudly instead of half-linking.
 */
export function ensureDefaultS5Link(db: Database, projectId: string, actor: string, now: string): S5AutoDefaultResult {
  const none: S5AutoDefaultResult = { applied: false, pin_created: false, pin_id: null, basis_switched: false, prior_basis: null };
  return db.transaction((): S5AutoDefaultResult => {
    const opp = greenfieldOpportunity(db, projectId); // throws not_found / not_greenfield
    // A person's revert wins over the default: never re-linked by the lazy path.
    if (s5SourceReverted(db, projectId)) return none;
    // Same importability rule as previewS5Connect: confirmed-unit KRW lines or reflected priced
    // capability lines must exist, and the shared S5 input must be loadable.
    if (planS5Import(db, opp).importable === 0) return none;
    if (!loadInvestmentVectorsInput(db, opp)) return none;
    const hadPin = !!getCurrentS5PlanPin(db, projectId);
    if (!hadPin) createS5PlanPin(db, { projectId, actor, now }); // audited s5_plan_pin.pinned, reason initial
    const basis = currentBasis(db, projectId);
    // ADR-0178 slice 2: a person-set `s5_pnl` basis is a deliberate choice too — the lazy default
    // must never flip it back to the unified basis (only ratio / legacy s5_plan get auto-moved).
    if (basis === "s5_plan_full" || basis === "s5_pnl") {
      return { applied: hadPin, pin_created: !hadPin, pin_id: getCurrentS5PlanPin(db, projectId)?.id ?? null, basis_switched: false, prior_basis: basis };
    }
    const runId = writeBc(db, projectId, actor, now, "S5 연결 기본 적용 (자동 생성, ADR-0178 개정)", [["bc.investment_basis", 2]]);
    appendAudit(db, { actor, action: "bc.investment_basis.auto_default", target: `${projectId}#basis=${basis}->s5_plan_full;run=${runId}`, now });
    return { applied: true, pin_created: !hadPin, pin_id: getCurrentS5PlanPin(db, projectId)?.id ?? null, basis_switched: true, prior_basis: basis };
  })();
}
