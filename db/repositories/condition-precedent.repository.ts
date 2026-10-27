// @version 1.0.0
/**
 * Condition precedents - ADR-0186 D4 / design 3.4 (migration 0175). Plain
 * persistence; the policy (who may clear, flag families, S11 blocking) lives
 * in app/web-next/lib/gate-conditions.ts and the routes authorize first.
 *
 * A condition is created with an IC GO (or its countersign), is `open` until a
 * DIFFERENT person clears or withdraws it, and is never deleted (trigger).
 */
import type { Database } from "bun:sqlite";
import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";

export const CLEAR_BY = ["group_ic", "establishment", "closing"] as const;
export type ClearBy = (typeof CLEAR_BY)[number];
export type ConditionOrigin = "recorder" | "countersign" | "kill_conditional";
export type ConditionStatus = "open" | "cleared" | "withdrawn";

export interface ConditionRow {
  id: string;
  project_id: string;
  source_decision_id: string;
  gate: "entity_ic" | "group_ic";
  text: string;
  clear_by: ClearBy;
  owner_role: string | null;
  origin: ConditionOrigin;
  status: ConditionStatus;
  created_by: string;
  created_at: string;
  cleared_by: string | null;
  cleared_at: string | null;
  clear_note: string | null;
  evidence_ref: string | null;
}

export interface NewCondition {
  text: string;
  clear_by: ClearBy;
  owner_role?: string | null;
  origin?: ConditionOrigin;
}

export class ConditionError extends Error {
  constructor(readonly code: "not_found" | "not_open" | "same_person" | "evidence_required", message: string) {
    super(message);
  }
}

export function insertConditions(
  db: Database,
  input: { projectId: string; decisionId: string; gate: "entity_ic" | "group_ic"; items: readonly NewCondition[]; createdBy: string; now: string },
): string[] {
  const ids: string[] = [];
  for (const item of input.items) {
    const id = ulid();
    db.run(
      `INSERT INTO condition_precedent (id, project_id, source_decision_id, gate, text, clear_by, owner_role, origin, status, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?, 'open', ?, ?)`,
      [id, input.projectId, input.decisionId, input.gate, item.text, item.clear_by, item.owner_role ?? null, item.origin ?? "recorder", input.createdBy, input.now],
    );
    ids.push(id);
  }
  return ids;
}

export function listConditions(projectId: string, opts: { status?: ConditionStatus; db?: Database } = {}): ConditionRow[] {
  const db = opts.db ?? getDb();
  return db
    .query(`SELECT * FROM condition_precedent WHERE project_id = ? ${opts.status ? "AND status = ?" : ""} ORDER BY created_at, id`)
    .all(...(opts.status ? [projectId, opts.status] : [projectId])) as ConditionRow[];
}

export function getCondition(db: Database, projectId: string, id: string): ConditionRow | null {
  return (db.query("SELECT * FROM condition_precedent WHERE id = ? AND project_id = ?").get(id, projectId) as ConditionRow | null) ?? null;
}

/** Open conditions whose clear_by is one of `clearBy`. */
export function openConditions(db: Database, projectId: string, clearBy: readonly ClearBy[]): ConditionRow[] {
  const marks = clearBy.map(() => "?").join(",");
  return db
    .query(`SELECT * FROM condition_precedent WHERE project_id = ? AND status = 'open' AND clear_by IN (${marks}) ORDER BY created_at, id`)
    .all(projectId, ...clearBy) as ConditionRow[];
}

/**
 * Close an open condition (cleared or withdrawn). The closer is never the person who created it, and a
 * `closing` condition cannot be cleared without an evidence reference (design 3.4).
 */
export function closeCondition(
  db: Database,
  input: { projectId: string; id: string; to: "cleared" | "withdrawn"; by: string; note: string; evidenceRef?: string | null; now: string },
): ConditionRow {
  const row = getCondition(db, input.projectId, input.id);
  if (!row) throw new ConditionError("not_found", `condition ${input.id} not found on this project.`);
  if (row.status !== "open") throw new ConditionError("not_open", `condition ${input.id} is already ${row.status}.`);
  if (row.created_by === input.by) throw new ConditionError("same_person", "The person who created a condition cannot clear it.");
  // Security review J1: nor can the person who recorded the decision the condition belongs to (the maker would otherwise
  // clear a condition a checker attached to the maker's own GO).
  const recorder = (db.query("SELECT decided_by FROM gate_decision WHERE id = ?").get(row.source_decision_id) as { decided_by: string } | null)?.decided_by;
  if (recorder === input.by) throw new ConditionError("same_person", "The person who recorded the decision a condition belongs to cannot clear it.");
  const evidence = input.evidenceRef?.trim() || null;
  if (input.to === "cleared" && row.clear_by === "closing" && !evidence) {
    throw new ConditionError("evidence_required", "A closing condition is cleared with an evidence reference.");
  }
  db.run(
    "UPDATE condition_precedent SET status = ?, cleared_by = ?, cleared_at = ?, clear_note = ?, evidence_ref = ? WHERE id = ?",
    [input.to, input.by, input.now, input.note, evidence, row.id],
  );
  return getCondition(db, input.projectId, input.id)!;
}
