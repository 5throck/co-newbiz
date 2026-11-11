// @version 1.0.0
/**
 * deal-intake.repository.ts — the client-request intake record (ADR-0197,
 * migration 0190; design 2026-11-11-owner-decisions-intake-batch §3).
 *
 * One row = one board-entry request for a deal review: WHO asked (requested_by,
 * free text — the external requester is not an app_user account), through which
 * board entry (source, closed vocabulary byte-identical to the migration CHECK),
 * and any free-form note. Created at board-CTA time, BEFORE the opportunity
 * exists — the market CTA path creates only an industry + analysis in S1, and
 * the opportunity arrives in S2 at POST /api/opportunities.
 *
 * opportunity_id is NULLABLE on purpose (same pattern as opportunity.project_id,
 * migration 0042): an intake whose deal never materializes stays unlinked as
 * the honest record that a request was made and no deal resulted. Linking is
 * idempotent and refuses re-linking via the `opportunity_id IS NULL` predicate —
 * one intake links to at most one opportunity, and there is no intake editing
 * in this batch (create + one optional link; no updated_at, no status column).
 *
 * `created_by` is the calling human's user id taken from the session, never
 * from a request body (Boundary 1).
 */
import type { Database } from "bun:sqlite";
import { ulid } from "../lib/ulid.ts";

/** Closed vocabulary, byte-identical to the migration 0190 CHECK. */
export const DEAL_INTAKE_SOURCES = ["board_new_deal", "board_known_target"] as const;
export type DealIntakeSource = (typeof DEAL_INTAKE_SOURCES)[number];

export interface DealIntakeRow {
  id: string;
  opportunity_id: string | null;
  source: DealIntakeSource;
  requested_by: string | null;
  note: string | null;
  created_by: string;
  created_at: string;
}

export interface CreateDealIntakeInput {
  source: DealIntakeSource;
  requestedBy?: string | null;
  note?: string | null;
  /** The session user who submitted the intake modal — never a request-body identity. */
  createdBy: string;
  now: string;
}

const COLUMNS = "id, opportunity_id, source, requested_by, note, created_by, created_at";

/** Create one intake row (unlinked — the opportunity does not exist yet). Returns the new row id. */
export function createDealIntake(db: Database, input: CreateDealIntakeInput): string {
  const id = ulid();
  db.run(
    `INSERT INTO deal_intake (id, opportunity_id, source, requested_by, note, created_by, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?)`,
    [id, input.source, input.requestedBy ?? null, input.note ?? null, input.createdBy, input.now],
  );
  return id;
}

/**
 * Link an unlinked intake to its opportunity. Single UPDATE with the
 * `opportunity_id IS NULL` predicate: idempotent (re-linking the same intake
 * is a no-op) and refusing (an already-linked intake can never be re-pointed).
 * False means the intake was already linked (or does not exist).
 */
export function linkDealIntakeToOpportunity(db: Database, input: { intakeId: string; opportunityId: string }): boolean {
  const res = db.run("UPDATE deal_intake SET opportunity_id = ? WHERE id = ? AND opportunity_id IS NULL", [
    input.opportunityId,
    input.intakeId,
  ]);
  return res.changes > 0;
}

/** The intake linked to one opportunity (origin-line read), or null when none is linked. */
export function getIntakeByOpportunity(db: Database, opportunityId: string): DealIntakeRow | null {
  return (
    (db
      .query(`SELECT ${COLUMNS} FROM deal_intake WHERE opportunity_id = ? ORDER BY created_at, id LIMIT 1`)
      .get(opportunityId) as DealIntakeRow | undefined) ?? null
  );
}

/** One intake by id (backfill validation at POST /api/opportunities), or null. */
export function getIntakeById(db: Database, intakeId: string): DealIntakeRow | null {
  return (
    (db.query(`SELECT ${COLUMNS} FROM deal_intake WHERE id = ?`).get(intakeId) as DealIntakeRow | undefined) ?? null
  );
}
