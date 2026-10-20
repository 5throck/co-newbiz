// @version 1.0.0
/**
 * Deal-structure-hypothesis repository — the single write path for
 * `deal_structure_hypothesis` rows (PR-5b, ADR-0045's four mandatory axes,
 * migration 0013).
 *
 * LAYERING (certification-repository doctrine): migration 0013's CHECKs
 * constrain the axis enums' SHAPE; THIS layer enforces governance —
 * FR-SEC-08 membership and FR-SEC-06 insider status for hypothesized_by,
 * write logging, and the no-naked-flag-writes rule:
 *
 *   four_axis_review_completed has exactly ONE setter,
 *   completeFourAxisReview(), which requires the reviewer's identity plus a
 *   reference to the deal_structure_review artifact (PR-10's brownfield-fs
 *   step output). hypothesize() cannot set the flag (the input type has no
 *   such field and the INSERT does not carry one) and no generic update()
 *   exists on this repository — the deliberate-act default (0) from 0013 is
 *   only ever left by an attributable, artifact-referenced completion.
 *
 * The artifact reference lives in the append-only audit_log (action
 * 'four_axis_review_completed', target `${hypothesisId}:${artifactRef}`) —
 * 0013's schema has no artifact column, and the audit trail is exactly
 * where a deliberate governance act belongs; the hypothesis row itself
 * records only the completed state.
 */

import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";
import { appendAudit, logDataAccess, requireActiveMember, requireInsiderIfMnpi } from "../lib/access-control.ts";

export interface HypothesisRow {
  id: string;
  project_id: string;
  run_id: string | null;
  asset_or_stock: "asset" | "stock" | "mixed" | null;
  stake_type: "full" | "majority" | "minority" | "joint_control" | null;
  instrument_mix: "primary" | "secondary" | "mixed" | null;
  vehicle: "direct" | "spc" | "holdco" | "internal_venture_spinoff" | "jv" | null;
  commercialization_path: "build" | "license_in" | "license_out" | "spin_off" | "minority_venture_investment" | null;
  tax_structure_note: string | null;
  liability_isolation_note: string | null;
  financing_leverage_note: string | null;
  exit_structure_note: string | null;
  four_axis_review_completed: number;
  hypothesized_by: string;
  hypothesized_at: string;
  rationale: string;
  /** Derived (2026-10-21) from the audit trail — the completion's artifact reference, reviewer and time; null until completed. */
  four_axis_artifact_ref?: string | null;
  four_axis_reviewed_by?: string | null;
  four_axis_reviewed_at?: string | null;
}

/** ADR-0045's four mandatory axes — each note must be present before the review can be completed. */
export const FOUR_AXIS_NOTE_FIELDS = [
  ["tax_structure_note", "절세 구조"],
  ["liability_isolation_note", "책임 격리"],
  ["financing_leverage_note", "재무 레버리지"],
  ["exit_structure_note", "엑싯 구조"],
] as const;

/** Axis notes still empty on a hypothesis (empty array = all four written). */
export function missingFourAxisNotes(row: Pick<HypothesisRow, "tax_structure_note" | "liability_isolation_note" | "financing_leverage_note" | "exit_structure_note">): string[] {
  return FOUR_AXIS_NOTE_FIELDS.filter(([field]) => !row[field]?.trim()).map(([field]) => field);
}

export interface HypothesizeInput {
  project_id: string;
  /** Nullable by 0013: a hypothesis can precede any analysis run. */
  run_id?: string | null;
  asset_or_stock?: HypothesisRow["asset_or_stock"];
  stake_type?: HypothesisRow["stake_type"];
  instrument_mix?: HypothesisRow["instrument_mix"];
  vehicle?: HypothesisRow["vehicle"];
  commercialization_path?: HypothesisRow["commercialization_path"];
  tax_structure_note?: string | null;
  liability_isolation_note?: string | null;
  financing_leverage_note?: string | null;
  exit_structure_note?: string | null;
  hypothesized_by: string;
  rationale: string;
  now?: string;
  // NOTE: deliberately no four_axis_review_completed field — completion is
  // a separate deliberate act (completeFourAxisReview), never an insert-time
  // default carried by the hypothesis author.
}

export interface CompleteFourAxisReviewInput {
  /** The hypothesis whose four axes were reviewed. */
  hypothesis_id: string;
  /** Reviewer identity — must be an active member (FR-SEC-08) / insider on MNPI projects (FR-SEC-06). */
  reviewed_by: string;
  /** Reference to the deal_structure_review artifact (PR-10 brownfield-fs step output) — mandatory. */
  artifact_ref: string;
  now?: string;
}

const SELECT_BY_ID = `SELECT id, project_id, run_id, asset_or_stock, stake_type, instrument_mix, vehicle,
  commercialization_path, tax_structure_note, liability_isolation_note, financing_leverage_note,
  exit_structure_note, four_axis_review_completed, hypothesized_by, hypothesized_at, rationale
  FROM deal_structure_hypothesis WHERE id = ?`;

export function getHypotheses(projectId: string, db: ReturnType<typeof getDb> = getDb()): HypothesisRow[] {
  const rows = db
    .query(
      `SELECT id, project_id, run_id, asset_or_stock, stake_type, instrument_mix, vehicle,
       commercialization_path, tax_structure_note, liability_isolation_note, financing_leverage_note,
       exit_structure_note, four_axis_review_completed, hypothesized_by, hypothesized_at, rationale
       FROM deal_structure_hypothesis WHERE project_id = ? ORDER BY hypothesized_at DESC, id DESC`
    )
    .all(projectId) as HypothesisRow[];
  // 2026-10-21: surface the completion's artifact reference from the audit trail
  // (its only home by design) so the IC reader sees the evidence, not just a flag.
  for (const row of rows) {
    if (row.four_axis_review_completed !== 1) {
      row.four_axis_artifact_ref = null; row.four_axis_reviewed_by = null; row.four_axis_reviewed_at = null;
      continue;
    }
    const audit = db
      .query(
        `SELECT actor_user_id, target, created_at FROM audit_log
         WHERE action = 'four_axis_review_completed' AND target LIKE ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(`${row.id}:%`) as { actor_user_id: string; target: string; created_at: string } | undefined;
    row.four_axis_artifact_ref = audit ? audit.target.slice(row.id.length + 1) : null;
    row.four_axis_reviewed_by = audit?.actor_user_id ?? null;
    row.four_axis_reviewed_at = audit?.created_at ?? null;
  }
  return rows;
}

/**
 * Record an early deal-structure hypothesis. The five axis enums are all
 * optional at hypothesis time (0013's deliberate deviation — an early
 * hypothesis may have settled the vehicle but not the instrument mix);
 * four_axis_review_completed is ALWAYS born 0 here regardless of input.
 */
export function hypothesize(input: HypothesizeInput, db: ReturnType<typeof getDb> = getDb()): HypothesisRow {
  const now = input.now ?? new Date().toISOString();

  if (!input.rationale?.trim()) {
    throw new Error(
      `deal_structure_hypothesis_write_rejected: rationale is mandatory for every hypothesis — an unexplained structure hypothesis is unauditable.`,
    );
  }
  if (input.run_id) {
    const run = db.query("SELECT id, project_id FROM run WHERE id = ?").get(input.run_id) as
      | { id: string; project_id: string }
      | undefined;
    if (!run) {
      throw new Error(
        `deal_structure_hypothesis_write_rejected: run '${input.run_id}' does not exist — a hypothesis may precede any run (omit run_id) but never cite a phantom one.`,
      );
    }
    if (run.project_id !== input.project_id) {
      throw new Error(
        `deal_structure_hypothesis_write_rejected: run '${input.run_id}' belongs to project '${run.project_id}', not '${input.project_id}' — a hypothesis cannot borrow another project's run.`,
      );
    }
  }

  requireActiveMember(db, input.project_id, input.hypothesized_by);
  requireInsiderIfMnpi(db, input.project_id, input.hypothesized_by);

  let id = "";
  db.transaction(() => {
    id = ulid();
    db.run(
      `INSERT INTO deal_structure_hypothesis
         (id, project_id, run_id, asset_or_stock, stake_type, instrument_mix, vehicle,
          commercialization_path, tax_structure_note, liability_isolation_note,
          financing_leverage_note, exit_structure_note, four_axis_review_completed,
          hypothesized_by, hypothesized_at, rationale)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
      [
        id,
        input.project_id,
        input.run_id ?? null,
        input.asset_or_stock ?? null,
        input.stake_type ?? null,
        input.instrument_mix ?? null,
        input.vehicle ?? null,
        input.commercialization_path ?? null,
        input.tax_structure_note ?? null,
        input.liability_isolation_note ?? null,
        input.financing_leverage_note ?? null,
        input.exit_structure_note ?? null,
        input.hypothesized_by,
        now,
        input.rationale,
      ]
    );
    logDataAccess(db, {
      userId: input.hypothesized_by,
      tableKey: "deal_structure_hypothesis",
      recordRef: `${input.project_id}:${id}`,
      projectId: input.project_id,
      action: "write",
      at: now,
    });
    appendAudit(db, {
      actor: input.hypothesized_by,
      action: "deal_structure_hypothesized",
      target: `${input.project_id}:${id}`,
      now,
    });
  })();
  return db.query(SELECT_BY_ID).get(id) as HypothesisRow;
}

/**
 * The ONLY path that sets four_axis_review_completed 0→1 (constraint 9).
 * Requires the reviewer identity AND a reference to the deal_structure_review
 * artifact — "review completed" without its artifact is an unsupported claim,
 * the same shape the certification repository rejects. Completing an
 * already-completed hypothesis is refused (a second completion would
 * silently replace the first completion's artifact reference in the audit
 * trail's meaning — re-review belongs in a new artifact + a new hypothesis).
 */
export function completeFourAxisReview(
  input: CompleteFourAxisReviewInput,
  db: ReturnType<typeof getDb> = getDb()
): HypothesisRow {
  const now = input.now ?? new Date().toISOString();
  const row = db.query(SELECT_BY_ID).get(input.hypothesis_id) as HypothesisRow | undefined;
  if (!row) {
    throw new Error(
      `deal_structure_hypothesis_write_rejected: hypothesis '${input.hypothesis_id}' does not exist — there is nothing to complete.`,
    );
  }
  if (!input.artifact_ref?.trim()) {
    throw new Error(
      `deal_structure_hypothesis_write_rejected: completeFourAxisReview requires a deal_structure_review artifact_ref — a completed four-axis review without its artifact reference is an unsupported claim (PR-10 brownfield-fs step output).`,
    );
  }
  if (row.four_axis_review_completed === 1) {
    throw new Error(
      `deal_structure_hypothesis_write_rejected: hypothesis '${input.hypothesis_id}' already has four_axis_review_completed=1 — completion is one deliberate act; re-review by a new hypothesis, not by re-completing.`,
    );
  }
  // 2026-10-21: a "four-axis review" with an empty axis is not a review of four
  // axes — the spec's completion criterion names all four (절세·책임격리·레버리지·엑싯).
  const missing = missingFourAxisNotes(row);
  if (missing.length > 0) {
    throw new Error(
      `deal_structure_hypothesis_write_rejected: four_axis_note_missing:${missing.join(",")} — every ADR-0045 axis note must be written on the hypothesis before its review can be completed.`,
    );
  }

  requireActiveMember(db, row.project_id, input.reviewed_by);
  requireInsiderIfMnpi(db, row.project_id, input.reviewed_by);

  db.transaction(() => {
    db.run(
      "UPDATE deal_structure_hypothesis SET four_axis_review_completed = 1 WHERE id = ? AND four_axis_review_completed = 0",
      [input.hypothesis_id]
    );
    logDataAccess(db, {
      userId: input.reviewed_by,
      tableKey: "deal_structure_hypothesis",
      recordRef: `${row.project_id}:${row.id}:four_axis_review`,
      projectId: row.project_id,
      action: "write",
      at: now,
    });
    appendAudit(db, {
      actor: input.reviewed_by,
      action: "four_axis_review_completed",
      target: `${row.id}:${input.artifact_ref.trim()}`,
      now,
    });
  })();
  return db.query(SELECT_BY_ID).get(input.hypothesis_id) as HypothesisRow;
}
