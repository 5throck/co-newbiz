// @version 1.0.0
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
 */

import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";
import { appendAudit, logDataAccess, requireActiveMember } from "../lib/access-control.ts";

export interface FinancingRow {
  id: string;
  project_id: string;
  kind: "source" | "use";
  name: string;
  amount_krw_m: number;
  note: string | null;
  created_by: string;
  created_at: string;
}

export interface FinancingTotals {
  sources: number;
  uses: number;
  balanced: boolean;
}

export interface AddFinancingEntryInput {
  project_id: string;
  kind: "source" | "use";
  name: string;
  amount_krw_m: number;
  note?: string | null;
  created_by: string;
  now?: string;
}

export function listFinancingEntries(projectId: string, db: ReturnType<typeof getDb> = getDb()): FinancingRow[] {
  return db
    .query(
      `SELECT id, project_id, kind, name, amount_krw_m, note, created_by, created_at
       FROM financing_sources_uses WHERE project_id = ? ORDER BY kind, created_at, id`,
    )
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

export function addFinancingEntry(input: AddFinancingEntryInput, db: ReturnType<typeof getDb> = getDb()): FinancingRow {
  const now = input.now ?? new Date().toISOString();
  if (!input.name?.trim()) {
    throw new Error("financing_plan_write_rejected: name is mandatory — an unnamed funding line is unauditable.");
  }
  if (!Number.isFinite(input.amount_krw_m) || input.amount_krw_m < 0) {
    throw new Error("financing_plan_write_rejected: amount_krw_m must be a non-negative finite number.");
  }
  requireActiveMember(db, input.project_id, input.created_by);

  const id = ulid();
  db.transaction(() => {
    db.run(
      `INSERT INTO financing_sources_uses (id, project_id, kind, name, amount_krw_m, note, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, input.project_id, input.kind, input.name.trim(), input.amount_krw_m, input.note ?? null, input.created_by, now],
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
      target: `${input.project_id}:${id}`,
      now,
    });
  })();
  return db
    .query(
      `SELECT id, project_id, kind, name, amount_krw_m, note, created_by, created_at
       FROM financing_sources_uses WHERE id = ?`,
    )
    .get(id) as FinancingRow;
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
