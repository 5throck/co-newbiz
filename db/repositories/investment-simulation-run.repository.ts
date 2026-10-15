// @version 1.0.0
/**
 * Investment-simulation run repository (ADR-0176 slice 2, migration 0144).
 * Opportunity-keyed run log for the S5 seeded Monte Carlo. A new run supersedes the previous
 * current one inside one transaction (history is kept, never deleted); the audit row
 * (`investment_simulation.run`) is appended in the same transaction. Per-draw vectors are not stored.
 */
import type { Database } from "bun:sqlite";
import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";
import { appendAudit } from "../lib/access-control.ts";

export interface InvestmentSimulationRunRow {
  id: string;
  opportunity_id: string;
  input_hash: string;
  seed: number;
  draw_count: number;
  horizon_years: number;
  envelope_krw_m: number | null;
  assumptions: unknown;
  results: unknown;
  status: "current" | "superseded";
  superseded_by: string | null;
  created_by: string;
  created_at: string;
  audit_id: string | null;
  /** ADR-0176 slice 3 (migration 0146): the person who confirmed the run; null = not confirmed. */
  confirmed_by: string | null;
  confirmed_at: string | null;
  confirm_audit_id: string | null;
}

export interface NewInvestmentSimulationRun {
  opportunityId: string;
  inputHash: string;
  seed: number;
  drawCount: number;
  horizonYears: number;
  envelopeKrwM: number | null;
  assumptions: unknown;
  results: unknown;
  actor: string;
  now: string;
}

const COLUMNS = "id, opportunity_id, input_hash, seed, draw_count, horizon_years, envelope_krw_m, assumptions_json, results_json, status, superseded_by, created_by, created_at, audit_id, confirmed_by, confirmed_at, confirm_audit_id";

function hydrate(r: Record<string, unknown>): InvestmentSimulationRunRow {
  const { assumptions_json, results_json, ...rest } = r;
  return { ...(rest as Omit<InvestmentSimulationRunRow, "assumptions" | "results">), assumptions: JSON.parse(String(assumptions_json)), results: JSON.parse(String(results_json)) };
}

/** The current (latest, non-superseded) run of an opportunity, or null. */
export function getLatestInvestmentSimulationRun(opportunityId: string, db: Database = getDb()): InvestmentSimulationRunRow | null {
  const row = db.query(`SELECT ${COLUMNS} FROM investment_simulation_run WHERE opportunity_id = ? AND status = 'current'`).get(opportunityId) as Record<string, unknown> | null;
  return row ? hydrate(row) : null;
}

/** Insert a run, supersede the previous current one, and append the audited `investment_simulation.run` row. */
export function insertInvestmentSimulationRun(run: NewInvestmentSimulationRun, db: Database = getDb()): InvestmentSimulationRunRow {
  const id = ulid();
  const tx = db.transaction(() => {
    db.run("UPDATE investment_simulation_run SET status = 'superseded', superseded_by = ? WHERE opportunity_id = ? AND status = 'current'", [id, run.opportunityId]);
    const auditId = appendAudit(db, { actor: run.actor, action: "investment_simulation.run", target: `${run.opportunityId}#${id}`, now: run.now });
    db.run(
      `INSERT INTO investment_simulation_run (id, opportunity_id, input_hash, seed, draw_count, horizon_years, envelope_krw_m, assumptions_json, results_json, status, superseded_by, created_by, created_at, audit_id)
       VALUES (?,?,?,?,?,?,?,?,?, 'current', NULL, ?,?,?)`,
      [id, run.opportunityId, run.inputHash, run.seed, run.drawCount, run.horizonYears, run.envelopeKrwM, JSON.stringify(run.assumptions), JSON.stringify(run.results), run.actor, run.now, auditId],
    );
  });
  tx();
  return getLatestInvestmentSimulationRun(run.opportunityId, db)!;
}

/** Run by id within an opportunity, or null. */
export function getInvestmentSimulationRun(opportunityId: string, runId: string, db: Database = getDb()): InvestmentSimulationRunRow | null {
  const row = db.query(`SELECT ${COLUMNS} FROM investment_simulation_run WHERE opportunity_id = ? AND id = ?`).get(opportunityId, runId) as Record<string, unknown> | null;
  return row ? hydrate(row) : null;
}

/**
 * The most recent CONFIRMED run of an opportunity (superseded runs included: an unconfirmed re-run
 * does not revoke an earlier confirmation), or null. This is the only run S8 may consume.
 */
export function getLatestConfirmedInvestmentSimulationRun(opportunityId: string, db: Database = getDb()): InvestmentSimulationRunRow | null {
  const row = db
    .query(`SELECT ${COLUMNS} FROM investment_simulation_run WHERE opportunity_id = ? AND confirmed_at IS NOT NULL ORDER BY confirmed_at DESC, id DESC LIMIT 1`)
    .get(opportunityId) as Record<string, unknown> | null;
  return row ? hydrate(row) : null;
}

export type ConfirmResult = { ok: true; run: InvestmentSimulationRunRow } | { ok: false; reason: "not_found" | "already_confirmed" };

/**
 * Record a person's confirmation of a run and append the audited `investment_simulation.confirmed`
 * row (actor, seed, draw count and input_hash) in one transaction. The caller MUST have passed the
 * human-only guard - this function does not know who is calling.
 */
export function confirmInvestmentSimulationRun(opportunityId: string, runId: string, actor: string, now: string, db: Database = getDb()): ConfirmResult {
  const tx = db.transaction((): ConfirmResult => {
    const run = getInvestmentSimulationRun(opportunityId, runId, db);
    if (!run) return { ok: false, reason: "not_found" };
    if (run.confirmed_at) return { ok: false, reason: "already_confirmed" };
    const auditId = appendAudit(db, {
      actor,
      action: "investment_simulation.confirmed",
      target: `${opportunityId}#${runId}:seed=${run.seed};draws=${run.draw_count};hash=${run.input_hash}`,
      now,
    });
    db.run("UPDATE investment_simulation_run SET confirmed_by = ?, confirmed_at = ?, confirm_audit_id = ? WHERE id = ? AND confirmed_at IS NULL", [actor, now, auditId, runId]);
    return { ok: true, run: getInvestmentSimulationRun(opportunityId, runId, db)! };
  });
  return tx();
}
