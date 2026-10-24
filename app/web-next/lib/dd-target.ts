// dd-target — the optional per-target DD axis (ADR-0157, design
// 2026-10-09-optional-per-target-dd).
//
// DD state rows carry a nullable target_id. NULL = "the selected target, or the
// legacy single DD subject" and is the ONLY scope the S9 predicate and the dd
// gate read. A non-NULL value is an explicitly opened comparison target: it has
// its own judgements, custom items, findings and waivers, and nothing recorded
// there can satisfy, block or waive anything for the selected target.
//
// Opening a target is a human act (the route enforces a cookie session); this
// module is the one place that resolves a caller-supplied target_id into a
// scope, writes the open record, and re-points the scope when the S8 selection
// changes. Greenfield never accepts a target_id.

import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { ulid } from "../../../db/lib/ulid.ts";

/** 409 body text for a write/read against a target whose DD was never opened. */
export const DD_TARGET_NOT_OPEN_MESSAGE = "DD가 열리지 않은 대상입니다";

export class DdTargetError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DdTargetError";
  }
}

export type DdScope = { ok: true; targetId: string | null } | { ok: false; error: DdTargetError };

/** The target recorded by the latest `s8_target_select` run (mirrors latestTargetSelection without importing business-case). */
export function selectedTargetId(projectId: string, db: Database = getDb()): string | null {
  const row = db
    .query(
      `SELECT meta_json FROM process_run
       WHERE entity_type = 'project' AND entity_id = ? AND stage = 's8_target_select' AND status = 'done'
       ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .get(projectId) as { meta_json: string | null } | undefined;
  if (!row?.meta_json) return null;
  try {
    const meta = JSON.parse(row.meta_json) as { target_id?: string };
    return meta.target_id ?? null;
  } catch {
    return null;
  }
}

interface ProjectLite {
  id: string;
  track: "greenfield" | "brownfield" | null;
  source_opportunity_id: string | null;
}

function projectLite(db: Database, projectId: string): ProjectLite | undefined {
  return db.query("SELECT id, track, source_opportunity_id FROM md_project WHERE id = ?").get(projectId) as ProjectLite | undefined;
}

function shortlistedTarget(db: Database, project: ProjectLite, targetId: string): { id: string; company_name: string } | undefined {
  return db
    .query("SELECT id, company_name FROM brownfield_target WHERE id = ? AND opportunity_id = ? AND status = 'shortlisted'")
    .get(targetId, project.source_opportunity_id ?? "") as { id: string; company_name: string } | undefined;
}

export function isDdTargetOpen(projectId: string, targetId: string, db: Database = getDb()): boolean {
  return !!db.query("SELECT 1 FROM dd_target_open WHERE project_id = ? AND target_id = ?").get(projectId, targetId);
}

/**
 * Resolve a caller-supplied target_id into a DD scope. Omitted/blank = the
 * selected/legacy scope (NULL), so every existing caller is unchanged. The
 * selected target's own id is normalised to NULL. Any other id must be opened
 * (409 otherwise); greenfield projects never accept one (400).
 */
export function resolveDdScope(projectId: string, raw: unknown, db: Database = getDb()): DdScope {
  if (raw === undefined || raw === null || raw === "") return { ok: true, targetId: null };
  if (typeof raw !== "string") return { ok: false, error: new DdTargetError(400, "invalid_request", "target_id must be a string.") };
  const targetId = raw.trim();
  if (!targetId) return { ok: true, targetId: null };
  const project = projectLite(db, projectId);
  if (!project) return { ok: false, error: new DdTargetError(404, "not_found", "project not found") };
  if (project.track !== "brownfield") {
    return { ok: false, error: new DdTargetError(400, "invalid_request", "Target DD applies only to brownfield projects.") };
  }
  if (targetId === selectedTargetId(projectId, db)) return { ok: true, targetId: null };
  if (!shortlistedTarget(db, project, targetId)) {
    return { ok: false, error: new DdTargetError(400, "invalid_target", "Not a Short List target of this project.") };
  }
  if (!isDdTargetOpen(projectId, targetId, db)) {
    return { ok: false, error: new DdTargetError(409, "dd_target_not_open", DD_TARGET_NOT_OPEN_MESSAGE) };
  }
  return { ok: true, targetId };
}

export interface DdTargetOpenRecord {
  id: string;
  projectId: string;
  targetId: string;
  openedBy: string;
  openedAt: string;
  rationale: string;
  source: "manual" | "reselection";
  /** false when the target was already open (idempotent re-open). */
  created: boolean;
}

interface OpenRow {
  id: string;
  project_id: string;
  target_id: string;
  opened_by: string;
  opened_at: string;
  rationale: string;
  source: "manual" | "reselection";
}

function toRecord(r: OpenRow, created: boolean): DdTargetOpenRecord {
  return { id: r.id, projectId: r.project_id, targetId: r.target_id, openedBy: r.opened_by, openedAt: r.opened_at, rationale: r.rationale, source: r.source, created };
}

/**
 * Open DD on a shortlisted, non-selected target (human act — the route enforces
 * the session). Requires a rationale; idempotent on (project, target); writes an
 * audit entry on first open.
 */
export function openDdTarget(projectId: string, targetId: string, rationale: string, openedBy: string): DdTargetOpenRecord {
  const db = getDb();
  const project = projectLite(db, projectId);
  if (!project) throw new DdTargetError(404, "not_found", "project not found");
  if (project.track !== "brownfield") throw new DdTargetError(400, "invalid_request", "Target DD applies only to brownfield projects.");
  const trimmed = rationale?.trim() ?? "";
  if (!trimmed) throw new DdTargetError(400, "invalid_request", "The rationale for opening DD is required.");
  if (trimmed.length > 4000) throw new DdTargetError(400, "invalid_request", "The rationale must be at most 4,000 characters.");
  if (!shortlistedTarget(db, project, targetId)) throw new DdTargetError(400, "invalid_target", "Not a Short List target of this project.");
  const selected = selectedTargetId(projectId, db);
  if (!selected) throw new DdTargetError(400, "selection_required", "Select a target in S8 before opening another target's DD.");
  if (targetId === selected) throw new DdTargetError(400, "already_selected", "The selected target is already the default DD scope — no need to open it separately.");
  const existing = db.query("SELECT * FROM dd_target_open WHERE project_id = ? AND target_id = ?").get(projectId, targetId) as OpenRow | undefined;
  if (existing) return toRecord(existing, false);
  const now = new Date().toISOString();
  const id = ulid();
  db.run(
    "INSERT INTO dd_target_open (id, project_id, target_id, opened_by, opened_at, rationale, source) VALUES (?,?,?,?,?,?, 'manual')",
    [id, projectId, targetId, openedBy, now, trimmed],
  );
  appendAudit(db, { actor: openedBy, action: "dd_target_opened", target: `${projectId}:${targetId}`, now });
  return toRecord({ id, project_id: projectId, target_id: targetId, opened_by: openedBy, opened_at: now, rationale: trimmed, source: "manual" }, true);
}

// ── Summary (GET /dd targets[]) ────────────────────────────────────────────

export interface DdTargetSummary {
  target_id: string;
  name: string;
  is_selected: boolean;
  opened: boolean;
  opened_at: string | null;
  opened_by: string | null;
  rationale: string | null;
  total: number;
  unassessed: number;
  pending: number;
  mandatory_unmet: number;
  /** dd_finding rows on this scope. */
  findings: number;
  /** dd_finding rows on this scope that carry a value_impact. */
  findings_with_value_impact: number;
}

/** The DD tables a scope owns; the re-selection transaction moves all four together. */
export const DD_SCOPED_TABLES = ["project_checklist_item_state", "project_checklist_item_custom", "dd_finding", "waiver"] as const;

// ── Re-selection (S8 selection changes A to B) ─────────────────────────────

/**
 * Called inside the target-selection transaction when the selected target
 * changes from `fromTargetId` (A) to `toTargetId` (B). No row is deleted:
 *   1. A's gate-scope rows (target_id IS NULL) are stamped with A's id;
 *   2. an open record for A is inserted if absent (source 'reselection');
 *   3. B's opened rows become the gate scope (target_id = NULL), B's open row
 *      is kept for the audit trail;
 *   4. every existing dd gate decision is marked stale in gate_decision_stale
 *      (re-judgement required; the decision rows are never edited).
 */
export function applyDdReselection(db: Database, projectId: string, fromTargetId: string | null, toTargetId: string, actor: string, now: string): void {
  if (!fromTargetId || fromTargetId === toTargetId) return;
  for (const table of DD_SCOPED_TABLES) {
    db.run(`UPDATE ${table} SET target_id = ? WHERE project_id = ? AND target_id IS NULL`, [fromTargetId, projectId]);
  }
  if (!db.query("SELECT 1 FROM dd_target_open WHERE project_id = ? AND target_id = ?").get(projectId, fromTargetId)) {
    db.run(
      "INSERT INTO dd_target_open (id, project_id, target_id, opened_by, opened_at, rationale, source) VALUES (?,?,?,?,?,?, 'reselection')",
      [ulid(), projectId, fromTargetId, actor, now, "S8 대상 재선정으로 기존 선정 대상의 DD를 대상별 근거로 보존함"],
    );
  }
  for (const table of DD_SCOPED_TABLES) {
    db.run(`UPDATE ${table} SET target_id = NULL WHERE project_id = ? AND target_id = ?`, [projectId, toTargetId]);
  }
  // The decision row itself stays untouched (an immutable human record); the marker
  // table is what makes the process engine stop counting it.
  db.run(
    `INSERT OR IGNORE INTO gate_decision_stale (decision_id, stale_at, stale_reason)
     SELECT id, ?, ? FROM gate_decision WHERE entity_type = 'project' AND entity_id = ? AND gate = 'dd'`,
    [now, `S8 선정 대상이 ${fromTargetId}에서 ${toTargetId}로 바뀌어 재판정이 필요합니다.`, projectId],
  );
}
