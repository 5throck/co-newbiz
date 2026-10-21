// @version 1.1.0
/**
 * Financing-plan repository — the single write path for
 * `financing_sources_uses` rows (migration 0075, flow.spec v2.2.0 S10
 * 투자구조 설계). financing-plan-review's evidence pack starts as a balanced
 * sources & uses table; the S10 completion predicate requires sources ==
 * uses > 0, so this layer keeps the arithmetic honest and auditable:
 * every write carries the actor's identity (FR-SEC-08 membership enforced
 * here), lands in the append-only audit log, and deletes are refusals for
 * rows that would be needed to explain a past gate record — deletes are
 * allowed but always logged, because a silently vanishing funding line is
 * exactly the kind of edit certainty-of-funds exists to prevent.
 *
 * v1.1.0 (2026-10-21, migration 0162): a funding line may carry its certainty
 * evidence (evidence_kind + evidence_ref). financingCertainty() reports which
 * SOURCE lines are evidenced — the fact S11 entity-ic-review step 4 reads.
 */

import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";
import { appendAudit, logDataAccess, requireActiveMember } from "../lib/access-control.ts";

export const FINANCING_EVIDENCE_KINDS = ["commitment_letter", "internal_approval", "term_sheet", "subsidy_grant", "other"] as const;
export type FinancingEvidenceKind = (typeof FINANCING_EVIDENCE_KINDS)[number];

export interface FinancingRow {
  id: string;
  project_id: string;
  kind: "source" | "use";
  name: string;
  amount_krw_m: number;
  note: string | null;
  evidence_kind: FinancingEvidenceKind | null;
  evidence_ref: string | null;
  created_by: string;
  created_at: string;
}

export interface FinancingTotals {
  sources: number;
  uses: number;
  balanced: boolean;
}

/** Certainty-of-funds fact over the SOURCE lines: evidenced = both evidence_kind and evidence_ref present. */
export interface FinancingCertainty {
  source_lines: number;
  evidenced_lines: number;
  unevidenced_lines: number;
  evidenced_amount_krw_m: number;
  unevidenced_amount_krw_m: number;
  /** True only when every source line is evidenced (and at least one exists). */
  all_sources_evidenced: boolean;
  unevidenced: Array<{ id: string; name: string; amount_krw_m: number }>;
}

export interface AddFinancingEntryInput {
  project_id: string;
  kind: "source" | "use";
  name: string;
  amount_krw_m: number;
  note?: string | null;
  evidence_kind?: string | null;
  evidence_ref?: string | null;
  created_by: string;
  now?: string;
}

const SELECT_COLS = "id, project_id, kind, name, amount_krw_m, note, evidence_kind, evidence_ref, created_by, created_at";

export function listFinancingEntries(projectId: string, db: ReturnType<typeof getDb> = getDb()): FinancingRow[] {
  return db
    .query(`SELECT ${SELECT_COLS} FROM financing_sources_uses WHERE project_id = ? ORDER BY kind, created_at, id`)
    .all(projectId) as FinancingRow[];
}

export function financingTotals(projectId: string, db: ReturnType<typeof getDb> = getDb()): FinancingTotals {
  const row = db
    .query(
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'source' THEN amount_krw_m END), 0) AS sources,
         COALESCE(SUM(CASE WHEN kind = 'use' THEN amount_krw_m END), 0) AS uses
       FROM financing_sources_uses WHERE project_id = ?`,
    )
    .get(projectId) as { sources: number; uses: number };
  return { ...row, balanced: row.sources > 0 && row.uses > 0 && Math.abs(row.sources - row.uses) <= 0.001 };
}

export function financingCertainty(projectId: string, db: ReturnType<typeof getDb> = getDb()): FinancingCertainty {
  const sources = listFinancingEntries(projectId, db).filter((r) => r.kind === "source");
  const evidenced = sources.filter((r) => r.evidence_kind && r.evidence_ref?.trim());
  const unevidenced = sources.filter((r) => !(r.evidence_kind && r.evidence_ref?.trim()));
  const sum = (rows: FinancingRow[]) => Math.round(rows.reduce((a, r) => a + r.amount_krw_m, 0) * 1000) / 1000;
  return {
    source_lines: sources.length,
    evidenced_lines: evidenced.length,
    unevidenced_lines: unevidenced.length,
    evidenced_amount_krw_m: sum(evidenced),
    unevidenced_amount_krw_m: sum(unevidenced),
    all_sources_evidenced: sources.length > 0 && unevidenced.length === 0,
    unevidenced: unevidenced.map((r) => ({ id: r.id, name: r.name, amount_krw_m: r.amount_krw_m })),
  };
}

export function addFinancingEntry(input: AddFinancingEntryInput, db: ReturnType<typeof getDb> = getDb()): FinancingRow {
  const now = input.now ?? new Date().toISOString();
  if (!input.name?.trim()) {
    throw new Error("financing_plan_write_rejected: name is mandatory — an unnamed funding line is unauditable.");
  }
  if (!Number.isFinite(input.amount_krw_m) || input.amount_krw_m < 0) {
    throw new Error("financing_plan_write_rejected: amount_krw_m must be a non-negative finite number.");
  }
  const evidenceKind = input.evidence_kind?.trim() || null;
  if (evidenceKind && !(FINANCING_EVIDENCE_KINDS as readonly string[]).includes(evidenceKind)) {
    throw new Error(`financing_plan_write_rejected: evidence_kind must be one of ${FINANCING_EVIDENCE_KINDS.join(" | ")}.`);
  }
  const evidenceRef = input.evidence_ref?.trim() || null;
  if ((evidenceKind === null) !== (evidenceRef === null)) {
    throw new Error("financing_plan_write_rejected: evidence_kind and evidence_ref go together — a kind without a reference (or a reference without a kind) is not evidence.");
  }
  requireActiveMember(db, input.project_id, input.created_by);

  const id = ulid();
  db.transaction(() => {
    db.run(
      `INSERT INTO financing_sources_uses (id, project_id, kind, name, amount_krw_m, note, evidence_kind, evidence_ref, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, input.project_id, input.kind, input.name.trim(), input.amount_krw_m, input.note ?? null, evidenceKind, evidenceRef, input.created_by, now],
    );
    logDataAccess(db, {
      userId: input.created_by,
      tableKey: "financing_sources_uses",
      recordRef: `${input.project_id}:${id}`,
      projectId: input.project_id,
      action: "write",
      at: now,
    });
    appendAudit(db, {
      actor: input.created_by,
      action: "financing_plan_entry_added",
      target: `${input.project_id}:${id}${evidenceKind ? `:${evidenceKind}` : ""}`,
      now,
    });
  })();
  return db.query(`SELECT ${SELECT_COLS} FROM financing_sources_uses WHERE id = ?`).get(id) as FinancingRow;
}

export function removeFinancingEntry(projectId: string, entryId: string, removedBy: string, db: ReturnType<typeof getDb> = getDb()): boolean {
  requireActiveMember(db, projectId, removedBy);
  const row = db
    .query("SELECT id, project_id FROM financing_sources_uses WHERE id = ? AND project_id = ?")
    .get(entryId, projectId) as { id: string; project_id: string } | undefined;
  if (!row) return false;
  const now = new Date().toISOString();
  db.transaction(() => {
    db.run("DELETE FROM financing_sources_uses WHERE id = ?", [entryId]);
    logDataAccess(db, {
      userId: removedBy,
      tableKey: "financing_sources_uses",
      recordRef: `${projectId}:${entryId}`,
      projectId,
      action: "write", // logDataAccess has no "delete" kind — the audit row records the removal
      at: now,
    });
    appendAudit(db, { actor: removedBy, action: "financing_plan_entry_removed", target: `${projectId}:${entryId}`, now });
  })();
  return true;
}
