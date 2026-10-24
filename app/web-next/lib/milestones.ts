// @version 1.0.0
/**
 * milestones — the project milestone register (2026-10-21, migration 0167).
 * S12's schedule surfaces were computed-only (stage SLA elapsed, ADR-0122 #1);
 * nothing let a person RUN a schedule. This ledger holds person-managed
 * milestones — manual entries plus rows imported from the greenfield
 * execution baseline (permit/certification target dates, source column).
 * Status is ALWAYS derived (overdue / due_soon(≤7d) / planned / done) — it is
 * never stored. Reference display only: S12 has no gate, and a late milestone
 * blocks nothing.
 */
import type { getDb } from "../../../db/client.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { latestConfirmedBaseline } from "./greenfield-execution.ts";

type Db = ReturnType<typeof getDb>;

// Client-safe constants/types live in lib/milestone-view.ts (SSOT); this server
// module re-exports them so existing server-side imports keep working.
export {
  MILESTONE_CATEGORIES,
  DUE_SOON_DAYS,
} from "./milestone-view.ts";
export type {
  MilestoneCategory,
  MilestoneStatus,
} from "./milestone-view.ts";
import {
  DUE_SOON_DAYS,
  MILESTONE_CATEGORIES,
  type MilestoneCategory,
  type MilestoneStatus,
} from "./milestone-view.ts";
export const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface MilestoneRow {
  id: string;
  project_id: string;
  title: string;
  category: MilestoneCategory;
  due_date: string;
  owner: string | null;
  source: "manual" | "execution_baseline";
  done_at: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
}

export interface MilestoneView extends MilestoneRow {
  status: MilestoneStatus;
  days_to_due: number | null;
}

export interface MilestoneSummary {
  total: number;
  open: number;
  done: number;
  overdue: number;
  due_soon: number;
}

const today = (now?: string) => (now ?? new Date().toISOString()).slice(0, 10);

export function milestoneStatus(dueDate: string, doneAt: string | null, now?: string): MilestoneStatus {
  if (doneAt) return "done";
  const t = today(now);
  const diff = Math.round((Date.parse(dueDate) - Date.parse(t)) / 86_400_000);
  if (diff < 0) return "overdue";
  if (diff <= DUE_SOON_DAYS) return "due_soon";
  return "planned";
}

export function withStatus(row: MilestoneRow, now?: string): MilestoneView {
  const t = today(now);
  const days = Number.isFinite(Date.parse(row.due_date)) ? Math.round((Date.parse(row.due_date) - Date.parse(t)) / 86_400_000) : null;
  return { ...row, status: milestoneStatus(row.due_date, row.done_at, now), days_to_due: days };
}

export function listMilestones(db: Db, projectId: string, now?: string): MilestoneView[] {
  const rows = db
    .query("SELECT * FROM project_milestone WHERE project_id = ? ORDER BY due_date ASC, done_at IS NULL DESC, created_at ASC")
    .all(projectId) as MilestoneRow[];
  return rows.map((r) => withStatus(r, now));
}

export function milestoneSummary(db: Db, projectId: string, now?: string): MilestoneSummary {
  const list = listMilestones(db, projectId, now);
  return {
    total: list.length,
    open: list.filter((m) => m.status !== "done").length,
    done: list.filter((m) => m.status === "done").length,
    overdue: list.filter((m) => m.status === "overdue").length,
    due_soon: list.filter((m) => m.status === "due_soon").length,
  };
}

export class MilestoneError extends Error {}

export interface CreateMilestoneInput {
  projectId: string;
  title: string;
  category: MilestoneCategory;
  dueDate: string;
  owner?: string | null;
  notes?: string | null;
  source?: "manual" | "execution_baseline";
  by: string;
  now?: string;
}

function validDate(v: string): boolean {
  return DUE_DATE_PATTERN.test(v) && Number.isFinite(Date.parse(v));
}

export function createMilestone(db: Db, input: CreateMilestoneInput): MilestoneRow {
  const title = input.title.trim();
  if (!title) throw new MilestoneError("title is required.");
  if (title.length > 200) throw new MilestoneError("title must be at most 200 characters.");
  if (!validDate(input.dueDate)) throw new MilestoneError("due_date must be a YYYY-MM-DD date.");
  const now = input.now ?? new Date().toISOString();
  const id = ulid();
  db.transaction(() => {
    db.run(
      `INSERT INTO project_milestone (id, project_id, title, category, due_date, owner, source, done_at, notes, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,NULL,?,?,?)`,
      [id, input.projectId, title, input.category, input.dueDate, input.owner?.trim() || null,
       input.source ?? "manual", input.notes?.trim() || null, input.by, now],
    );
    appendAudit(db, { actor: input.by, action: "project_milestone.created", target: `${input.projectId}:${id}:${input.dueDate}`, now });
  })();
  return db.query("SELECT * FROM project_milestone WHERE id = ?").get(id) as MilestoneRow;
}

export interface UpdateMilestoneInput {
  projectId: string;
  milestoneId: string;
  title?: string;
  category?: MilestoneCategory;
  dueDate?: string;
  owner?: string | null;
  done?: boolean;
  notes?: string | null;
  by: string;
  now?: string;
}

export function updateMilestone(db: Db, input: UpdateMilestoneInput): MilestoneRow {
  const row = db
    .query("SELECT * FROM project_milestone WHERE id = ? AND project_id = ?")
    .get(input.milestoneId, input.projectId) as MilestoneRow | undefined;
  if (!row) throw new MilestoneError("milestone not found");
  const sets: string[] = [];
  const params: Array<string | null> = [];
  if (input.title !== undefined) {
    const t = input.title.trim();
    if (!t || t.length > 200) throw new MilestoneError("title must be 1-200 characters.");
    sets.push("title = ?"); params.push(t);
  }
  if (input.category !== undefined) {
    if (!(MILESTONE_CATEGORIES as readonly string[]).includes(input.category)) throw new MilestoneError("Invalid category.");
    sets.push("category = ?"); params.push(input.category);
  }
  if (input.dueDate !== undefined) {
    if (!validDate(input.dueDate)) throw new MilestoneError("due_date must be a YYYY-MM-DD date.");
    sets.push("due_date = ?"); params.push(input.dueDate);
  }
  if (input.owner !== undefined) { sets.push("owner = ?"); params.push(input.owner?.trim() || null); }
  if (input.notes !== undefined) { sets.push("notes = ?"); params.push(input.notes?.trim() || null); }
  if (input.done !== undefined) { sets.push("done_at = ?"); params.push(input.done ? (input.now ?? new Date().toISOString()) : null); }
  if (sets.length === 0) throw new MilestoneError("No fields to change.");
  const now = input.now ?? new Date().toISOString();
  sets.push("updated_by = ?", "updated_at = ?");
  params.push(input.by, now, input.milestoneId, input.projectId);
  db.transaction(() => {
    db.run(`UPDATE project_milestone SET ${sets.join(", ")} WHERE id = ? AND project_id = ?`, ...params);
    appendAudit(db, { actor: input.by, action: "project_milestone.updated", target: `${input.projectId}:${input.milestoneId}`, now });
  })();
  return db.query("SELECT * FROM project_milestone WHERE id = ?").get(input.milestoneId) as MilestoneRow;
}

export function deleteMilestone(db: Db, projectId: string, milestoneId: string, by: string): boolean {
  const row = db
    .query("SELECT id FROM project_milestone WHERE id = ? AND project_id = ?")
    .get(milestoneId, projectId) as { id: string } | undefined;
  if (!row) return false;
  const now = new Date().toISOString();
  db.transaction(() => {
    db.run("DELETE FROM project_milestone WHERE id = ?", [milestoneId]);
    appendAudit(db, { actor: by, action: "project_milestone.deleted", target: `${projectId}:${milestoneId}`, now });
  })();
  return true;
}

/**
 * Import the confirmed greenfield execution baseline's permit/certification
 * milestones as register rows (source='execution_baseline'). Rows whose title
 * already exists (same source, same title) are skipped, so re-importing is
 * idempotent. Returns how many rows were added.
 */
export function importBaselineMilestones(db: Db, projectId: string, by: string, now?: string): { added: number; skipped: number } {
  const baseline = latestConfirmedBaseline(projectId, db);
  if (!baseline?.confirmation) throw new MilestoneError("No confirmed execution baseline — confirm the baseline in S11 first.");
  const entries = baseline.entries;
  const existing = new Set(
    (db.query("SELECT title FROM project_milestone WHERE project_id = ? AND source = 'execution_baseline'").all(projectId) as Array<{ title: string }>)
      .map((r) => r.title),
  );
  let added = 0, skipped = 0;
  const at = now ?? new Date().toISOString();
  for (const [category, list] of [["permit", entries.permit_milestones], ["certification", entries.certification_milestones]] as const) {
    for (const m of list) {
      if (existing.has(m.name)) { skipped += 1; continue; }
      createMilestone(db, {
        projectId, title: m.name, category, dueDate: m.target_date,
        owner: m.issuer || null, notes: m.gates_ref ? `gates_ref: ${m.gates_ref}` : null,
        source: "execution_baseline", by, now: at,
      });
      existing.add(m.name);
      added += 1;
    }
  }
  return { added, skipped };
}
