// establishment — shared read/write model for the S11 설립 실행 5단계 record
// (entity-establishment-execution, ADR-0085; project key ADR-0100 §1/§2).
//
// One ledger, two projections. entity_establishment_step rows carry BOTH
// opportunity_id (origin of record, NOT NULL since 0059) and project_id
// (backfilled in 0070). Reads resolve through project_id first and fall back
// to the source_opportunity_id backlink ONLY for legacy rows that predate the
// backfill (project_id IS NULL); writes always land on project_id-keyed rows.
// The project route is therefore a projection of the same rows the
// opportunity route serves — never a second ledger.
//
// Sequence enforcement (ADR-0085/0059): 완료확인 (step 5) may only be marked
// done after steps 1–4 are all done. Status vocabulary matches the procedure
// kill-criteria actions 1:1: pending | in_progress | done | halted | escalated.
// origin∈{internal, joint} only (ADR-0047, the procedure's applies_when).
//
// ADR-0165 (migration 0140): per-step assignee distinct from the last recorder
// (owner), server-enforced status rules (evidence for done, origin applies),
// and an audited reopen. `done` rows are immutable through the status change;
// only reopenEstablishmentStep returns them to in_progress. Every mutation
// writes an entity_establishment_step_event row and an audit_log entry
// (target "<projectId>#step<n>") in one transaction.
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { ulid } from "../../../db/lib/ulid.ts";

export const ESTABLISHMENT_STATUSES = ["pending", "in_progress", "done", "halted", "escalated"] as const;
export type EstablishmentStatus = (typeof ESTABLISHMENT_STATUSES)[number];

export const ESTABLISHMENT_ORIGINS = ["internal", "joint"] as const;
export type EstablishmentOrigin = (typeof ESTABLISHMENT_ORIGINS)[number];

export const ESTABLISHMENT_STEP_TITLES: Record<number, string> = {
  1: "설립준비(관할·주식구조·이사회 결의)",
  2: "법인등기·정관·사업자등록",
  3: "인허가 이전/재발급 분류",
  4: "인력이전(신 근로계약+PIIA)",
  5: "완료확인(IP양도체인·거버넌스 베이스라인)",
};

export interface EstablishmentStepRow {
  id: string;
  step_no: number;
  status: EstablishmentStatus;
  origin: EstablishmentOrigin;
  checklist_item: string | null;
  evidence_url: string | null;
  note: string | null;
  owner: string;
  /** Alias of owner — the last human/agent who recorded the row (ADR-0165). */
  last_recorded_by: string;
  assignee_user_id: string | null;
  assignee_name: string | null;
  /** False when the assignee's project membership was revoked (or never existed). */
  assignee_active: boolean;
  assigned_by: string | null;
  assigned_at: string | null;
  reopen_count: number;
  updated_at: string;
  /** How this row was reached — project_id key, or the legacy opportunity backlink. */
  keyed_by: "project" | "backlink";
}

interface ProjectKeyRow {
  id: string;
  source_opportunity_id: string | null;
}

function projectKeyRow(projectId: string): ProjectKeyRow | undefined {
  return getDb()
    .query("SELECT id, source_opportunity_id FROM md_project WHERE id = ?")
    .get(projectId) as ProjectKeyRow | undefined;
}

const STEP_COLS = `id, step_no, status, origin, checklist_item, evidence_url, note, owner,
  assignee_user_id, assigned_by, assigned_at, updated_at,
  (SELECT COUNT(*) FROM entity_establishment_step_event e
     WHERE e.step_id = entity_establishment_step.id AND e.kind = 'reopen') AS reopen_count`;

type RawStepRow = Omit<EstablishmentStepRow, "keyed_by" | "last_recorded_by" | "assignee_name" | "assignee_active">;

export function userDisplayName(userId: string | null): string | null {
  if (!userId) return null;
  const row = getDb().query("SELECT display_name FROM app_user WHERE user_id = ?").get(userId) as
    | { display_name: string | null }
    | null;
  return row?.display_name?.trim() || null;
}

function isActiveMember(projectId: string, userId: string): boolean {
  return !!getDb()
    .query("SELECT 1 FROM project_member WHERE project_id = ? AND user_id = ? AND revoked_at IS NULL")
    .get(projectId, userId);
}

/** All establishment steps visible for a project — project_id-keyed rows
 * plus, as fallback, un-backfilled rows reached through the opportunity
 * backlink (ADR-0100 §1). Sorted by step_no. */
export function listEstablishmentSteps(projectId: string): EstablishmentStepRow[] {
  const project = projectKeyRow(projectId);
  if (!project) return [];
  const db = getDb();
  const direct = db
    .query(`SELECT ${STEP_COLS} FROM entity_establishment_step WHERE project_id = ? ORDER BY step_no, id`)
    .all(projectId) as RawStepRow[];
  const seen = new Set(direct.map((r) => r.id));
  let fallback: RawStepRow[] = [];
  if (project.source_opportunity_id) {
    fallback = db
      .query(
        `SELECT ${STEP_COLS} FROM entity_establishment_step
         WHERE project_id IS NULL AND opportunity_id = ?
         ORDER BY step_no, id`,
      )
      .all(project.source_opportunity_id) as RawStepRow[];
  }
  const enrich = (r: RawStepRow, keyed_by: "project" | "backlink"): EstablishmentStepRow => ({
    ...r,
    last_recorded_by: r.owner,
    assignee_name: userDisplayName(r.assignee_user_id) ?? r.assignee_user_id,
    assignee_active: r.assignee_user_id ? isActiveMember(projectId, r.assignee_user_id) : false,
    keyed_by,
  });
  const all = [
    ...direct.map((r) => enrich(r, "project")),
    ...fallback.filter((r) => !seen.has(r.id)).map((r) => enrich(r, "backlink")),
  ];
  // One row per step_no: a stray duplicate (e.g. an empty pending row) is hidden
  // behind the most advanced row, chosen deterministically.
  const byStep = new Map<number, EstablishmentStepRow>();
  for (const r of all) {
    const cur = byStep.get(r.step_no);
    if (!cur || compareStepRows(r, cur) < 0) byStep.set(r.step_no, r);
  }
  return [...byStep.values()].sort((a, b) => a.step_no - b.step_no);
}

const STATUS_RANK: Record<string, number> = { done: 0, in_progress: 1, halted: 1, escalated: 1, pending: 2 };

/** Negative when `a` is the better representative of a step than `b`:
 * most advanced status, then has an assignee, then oldest id. */
function compareStepRows(
  a: { status: string; assignee_user_id: string | null; id: string },
  b: { status: string; assignee_user_id: string | null; id: string },
): number {
  return (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3)
    || Number(!!b.assignee_user_id) - Number(!!a.assignee_user_id)
    || a.id.localeCompare(b.id);
}

export interface EstablishmentMember {
  user_id: string;
  name: string;
  project_role: string;
}

/** Active project members — the assignee picker source. */
export function listEstablishmentMembers(projectId: string): EstablishmentMember[] {
  const rows = getDb()
    .query(
      `SELECT pm.user_id AS user_id, COALESCE(NULLIF(TRIM(u.display_name), ''), pm.user_id) AS name, pm.project_role AS project_role
       FROM project_member pm LEFT JOIN app_user u ON u.user_id = pm.user_id
       WHERE pm.project_id = ? AND pm.revoked_at IS NULL
       ORDER BY name, pm.user_id`,
    )
    .all(projectId) as EstablishmentMember[];
  return rows;
}

export interface EstablishmentEventRow {
  id: string;
  step_id: string;
  step_no: number;
  kind: "status_change" | "assign" | "reopen";
  from_status: EstablishmentStatus | null;
  to_status: EstablishmentStatus | null;
  from_assignee: string | null;
  to_assignee: string | null;
  reason: string | null;
  evidence_url: string | null;
  actor_user_id: string;
  actor_name: string | null;
  audit_id: string | null;
  created_at: string;
}

/** Latest transition events for the project (newest first). */
export function listEstablishmentEvents(projectId: string, limit = 20): EstablishmentEventRow[] {
  const rows = getDb()
    .query(
      `SELECT e.id, e.step_id, e.step_no, e.kind, e.from_status, e.to_status, e.from_assignee, e.to_assignee,
              e.reason, e.evidence_url, e.actor_user_id, u.display_name AS actor_name, e.audit_id, e.created_at
       FROM entity_establishment_step_event e LEFT JOIN app_user u ON u.user_id = e.actor_user_id
       WHERE e.project_id = ? ORDER BY e.created_at DESC, e.id DESC LIMIT ?`,
    )
    .all(projectId, limit) as EstablishmentEventRow[];
  return rows.map((r) => ({ ...r, actor_name: r.actor_name?.trim() || r.actor_user_id }));
}

export interface EstablishmentProgress {
  done: number;
  total: 5;
  complete: boolean;
}

/** Distinct completed step numbers for the project — the S11 predicate input
 * (process-flow) and the IC-package progress (n/5) both read this, so the
 * count cannot drift between surfaces. */
export function establishmentProgress(projectId: string): EstablishmentProgress {
  const project = projectKeyRow(projectId);
  if (!project) return { done: 0, total: 5, complete: false };
  const db = getDb();
  const rows = db
    .query(
      `SELECT DISTINCT step_no FROM entity_establishment_step
       WHERE status = 'done' AND (
         project_id = ?
         OR (project_id IS NULL AND opportunity_id = ?)
       )`,
    )
    .all(projectId, project.source_opportunity_id ?? "") as Array<{ step_no: number }>;
  return { done: rows.length, total: 5, complete: rows.length >= 5 };
}

export type EstablishmentError =
  | "sequence_violation"
  | "no_origin_opportunity"
  | "not_applicable"
  | "invalid_status"
  | "evidence_required"
  | "invalid_evidence_url"
  | "reopen_required"
  | "assignee_not_member"
  | "not_done"
  | "dependent_step_done"
  | "invalid_reason";

export type UpsertResult =
  | { ok: true; id: string; step_no: number; status: EstablishmentStatus; title: string; step_done: boolean; updated_at: string; assignee_user_id: string | null }
  | { ok: false; error: EstablishmentError; dependent_steps?: number[] };

export interface UpsertInput {
  step_no: number;
  status: EstablishmentStatus;
  origin: EstablishmentOrigin;
  checklist_item?: string | null;
  evidence_url?: string | null;
  note?: string | null;
  /** undefined = leave unchanged; null = clear; string = assign (active member required). */
  assignee_user_id?: string | null;
}

export const REOPEN_REASON_MIN = 10;
export const REOPEN_REASON_MAX = 2000;

interface LocatedRow {
  id: string;
  status: EstablishmentStatus;
  evidence_url: string | null;
  assignee_user_id: string | null;
  legacy: boolean;
}

/** Origin of the project must be internal/joint (ADR-0047) and, when the caller states one, match it. */
function originApplies(projectId: string, stated?: string | null): boolean {
  const row = getDb().query("SELECT origin FROM md_project WHERE id = ?").get(projectId) as { origin: string | null } | null;
  const o = row?.origin ?? null;
  if (!o || !ESTABLISHMENT_ORIGINS.includes(o as EstablishmentOrigin)) return false;
  return stated == null || stated === o;
}

function locateRow(db: Database, project: ProjectKeyRow, stepNo: number, itemKey: string | null): LocatedRow | undefined {
  // itemKey given: exact checklist_item match. itemKey null (assign / plain status
  // change): ANY row of the step, whatever its checklist_item, so a row created by
  // the seeding flow (checklist_item set) is never shadowed by a duplicate.
  const itemClause = itemKey === null ? "" : "AND checklist_item IS ?";
  const itemArgs = itemKey === null ? [] : [itemKey];
  const pick = (rows: Array<Omit<LocatedRow, "legacy">>, legacy: boolean): LocatedRow | undefined => {
    const best = [...rows].sort(compareStepRows)[0];
    return best ? { ...best, legacy } : undefined;
  };
  const direct = pick(
    db
      .query(
        `SELECT id, status, evidence_url, assignee_user_id FROM entity_establishment_step
         WHERE project_id = ? AND step_no = ? ${itemClause}`,
      )
      .all(project.id, stepNo, ...itemArgs) as Array<Omit<LocatedRow, "legacy">>,
    false,
  );
  if (direct) return direct;
  if (!project.source_opportunity_id) return undefined;
  // ADOPT, never duplicate: a legacy backlink row (project_id NULL, pre-backfill)
  // is the same ledger row — the caller promotes it onto the project key.
  return pick(
    db
      .query(
        `SELECT id, status, evidence_url, assignee_user_id FROM entity_establishment_step
         WHERE project_id IS NULL AND opportunity_id = ? AND step_no = ? ${itemClause}`,
      )
      .all(project.source_opportunity_id, stepNo, ...itemArgs) as Array<Omit<LocatedRow, "legacy">>,
    true,
  );
}

function adopt(db: Database, row: LocatedRow, projectId: string): void {
  if (row.legacy) db.run("UPDATE entity_establishment_step SET project_id = ? WHERE id = ?", [projectId, row.id]);
}

interface EventInput {
  stepId: string;
  projectId: string;
  stepNo: number;
  kind: "status_change" | "assign" | "reopen";
  fromStatus?: EstablishmentStatus | null;
  toStatus?: EstablishmentStatus | null;
  fromAssignee?: string | null;
  toAssignee?: string | null;
  reason?: string | null;
  evidenceUrl?: string | null;
  actor: string;
  auditId: string | null;
  now: string;
}

function insertEvent(db: Database, e: EventInput): void {
  db.run(
    `INSERT INTO entity_establishment_step_event
       (id, step_id, project_id, step_no, kind, from_status, to_status, from_assignee, to_assignee,
        reason, evidence_url, actor_user_id, audit_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [ulid(), e.stepId, e.projectId, e.stepNo, e.kind, e.fromStatus ?? null, e.toStatus ?? null,
      e.fromAssignee ?? null, e.toAssignee ?? null, e.reason ?? null, e.evidenceUrl ?? null, e.actor, e.auditId, e.now],
  );
}

const auditTarget = (projectId: string, stepNo: number) => `${projectId}#step${stepNo}`;

function isHttpUrl(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Write the assignee on an existing row + `assign` event + audit (caller owns the transaction). */
function applyAssign(
  db: Database, projectId: string, stepId: string, stepNo: number,
  from: string | null, to: string | null, actor: string, now: string,
): void {
  db.run("UPDATE entity_establishment_step SET assignee_user_id = ?, assigned_by = ?, assigned_at = ? WHERE id = ?", [to, actor, now, stepId]);
  const auditId = appendAudit(db, { actor, action: "entity_establishment.assign", target: auditTarget(projectId, stepNo), now });
  insertEvent(db, { stepId, projectId, stepNo, kind: "assign", fromAssignee: from, toAssignee: to, actor, auditId, now });
}

/**
 * Change one establishment step's status (ADR-0165). Writes are ALWAYS
 * project_id-keyed (ADR-0100 §2). Rules, in order: origin applies; `done`
 * needs evidence (URL or note); a `done` row cannot be changed here
 * (reopen_required); step 5 `done` needs steps 1–4 done. Row update, event
 * and audit entries share one transaction.
 */
export function changeEstablishmentStatus(projectId: string, input: UpsertInput, actor: string): UpsertResult {
  const db = getDb();
  const project = projectKeyRow(projectId);
  if (!project || !originApplies(projectId, input.origin)) return { ok: false, error: "not_applicable" };
  if (input.status === "pending" || !ESTABLISHMENT_STATUSES.includes(input.status)) return { ok: false, error: "invalid_status" };

  const itemKey = input.checklist_item?.trim() || null;
  const evidenceUrl = input.evidence_url?.trim() || null;
  const note = input.note?.trim() || null;
  if (evidenceUrl && !isHttpUrl(evidenceUrl)) return { ok: false, error: "invalid_evidence_url" };
  if (input.status === "done" && !evidenceUrl && !note) return { ok: false, error: "evidence_required" };

  const existing = locateRow(db, project, input.step_no, itemKey);
  if (existing?.status === "done") return { ok: false, error: "reopen_required" };

  if (input.assignee_user_id && !isActiveMember(projectId, input.assignee_user_id)) {
    return { ok: false, error: "assignee_not_member" };
  }
  // 순서 강제 — 완료확인(5)은 선행 4단계가 모두 done일 때만 완료할 수 있다.
  if (input.step_no === 5 && input.status === "done" && establishmentPriorDone(projectId) < 4) {
    return { ok: false, error: "sequence_violation" };
  }
  if (!existing && !project.source_opportunity_id) return { ok: false, error: "no_origin_opportunity" };

  const now = new Date().toISOString();
  return db.transaction((): UpsertResult => {
    let rowId: string;
    let fromStatus: EstablishmentStatus | null;
    let fromAssignee: string | null;
    if (existing) {
      adopt(db, existing, projectId);
      rowId = existing.id;
      fromStatus = existing.status;
      fromAssignee = existing.assignee_user_id;
      db.run(
        `UPDATE entity_establishment_step SET status = ?, evidence_url = ?, note = ?, owner = ?, updated_at = ? WHERE id = ?`,
        [input.status, evidenceUrl, note, actor, now, rowId],
      );
    } else {
      rowId = ulid();
      fromStatus = null;
      fromAssignee = null;
      db.run(
        `INSERT INTO entity_establishment_step
           (id, opportunity_id, project_id, step_no, status, origin, checklist_item, evidence_url, note, owner, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [rowId, project.source_opportunity_id, projectId, input.step_no, input.status, input.origin, itemKey, evidenceUrl, note, actor, now],
      );
    }
    const auditId = appendAudit(db, { actor, action: "entity_establishment.update", target: auditTarget(projectId, input.step_no), now });
    insertEvent(db, {
      stepId: rowId, projectId, stepNo: input.step_no, kind: "status_change",
      fromStatus, toStatus: input.status, evidenceUrl, actor, auditId, now,
    });
    if (input.status === "done") {
      appendAudit(db, { actor, action: "entity_establishment.complete", target: auditTarget(projectId, input.step_no), now });
    }
    let assignee = fromAssignee;
    if (input.assignee_user_id !== undefined && (input.assignee_user_id ?? null) !== fromAssignee) {
      applyAssign(db, projectId, rowId, input.step_no, fromAssignee, input.assignee_user_id ?? null, actor, now);
      assignee = input.assignee_user_id ?? null;
    }
    return {
      ok: true, id: rowId, step_no: input.step_no, status: input.status,
      title: ESTABLISHMENT_STEP_TITLES[input.step_no], step_done: input.status === "done", updated_at: now,
      assignee_user_id: assignee,
    };
  })();
}

export type AssignResult =
  | { ok: true; id: string; step_no: number; assignee_user_id: string | null; changed: boolean; updated_at: string }
  | { ok: false; error: "not_applicable" | "assignee_not_member" | "no_origin_opportunity" };

/** Set/change/clear the step's responsible person. Allowed on a `done` step; creates a `pending` row when none exists. */
export function assignEstablishmentStep(projectId: string, stepNo: number, assignee: string | null, actor: string, statedOrigin?: string | null): AssignResult {
  const db = getDb();
  const project = projectKeyRow(projectId);
  if (!project || !originApplies(projectId, statedOrigin)) return { ok: false, error: "not_applicable" };
  if (assignee && !isActiveMember(projectId, assignee)) return { ok: false, error: "assignee_not_member" };
  const existing = locateRow(db, project, stepNo, null);
  if (!existing && !project.source_opportunity_id) return { ok: false, error: "no_origin_opportunity" };
  const now = new Date().toISOString();
  return db.transaction((): AssignResult => {
    if (existing) {
      adopt(db, existing, projectId);
      if ((existing.assignee_user_id ?? null) === assignee) {
        return { ok: true, id: existing.id, step_no: stepNo, assignee_user_id: assignee, changed: false, updated_at: now };
      }
      applyAssign(db, projectId, existing.id, stepNo, existing.assignee_user_id, assignee, actor, now);
      return { ok: true, id: existing.id, step_no: stepNo, assignee_user_id: assignee, changed: true, updated_at: now };
    }
    const origin = (db.query("SELECT origin FROM md_project WHERE id = ?").get(projectId) as { origin: string }).origin;
    const rowId = ulid();
    db.run(
      `INSERT INTO entity_establishment_step
         (id, opportunity_id, project_id, step_no, status, origin, checklist_item, evidence_url, note, owner, updated_at)
       VALUES (?,?,?,?,'pending',?,NULL,NULL,NULL,?,?)`,
      [rowId, project.source_opportunity_id, projectId, stepNo, origin, actor, now],
    );
    if (assignee === null) return { ok: true, id: rowId, step_no: stepNo, assignee_user_id: null, changed: false, updated_at: now };
    applyAssign(db, projectId, rowId, stepNo, null, assignee, actor, now);
    return { ok: true, id: rowId, step_no: stepNo, assignee_user_id: assignee, changed: true, updated_at: now };
  })();
}

export type ReopenResult =
  | { ok: true; reopened: Array<{ id: string; step_no: number; cascade: boolean }>; updated_at: string }
  | { ok: false; error: "not_applicable" | "invalid_reason" | "not_done" | "dependent_step_done"; dependent_steps?: number[] };

function doneRowsForStep(db: Database, project: ProjectKeyRow, stepNo: number): LocatedRow[] {
  const rows = db
    .query(
      `SELECT id, status, evidence_url, assignee_user_id, project_id FROM entity_establishment_step
       WHERE status = 'done' AND step_no = ? AND (project_id = ? OR (project_id IS NULL AND opportunity_id = ?))
       ORDER BY id`,
    )
    .all(stepNo, project.id, project.source_opportunity_id ?? "") as Array<Omit<LocatedRow, "legacy"> & { project_id: string | null }>;
  return rows.map(({ project_id, ...r }) => ({ ...r, legacy: project_id === null }));
}

/**
 * done -> in_progress with a mandatory reason (ADR-0165). Clears the row's
 * evidence (snapshotted in the reopen event), keeps the note, records the
 * actor as last recorder. Reopening steps 1–4 while step 5 is done needs
 * `cascadeStep5` (step 5 is reopened in the same transaction); gate
 * decisions are never touched.
 */
export function reopenEstablishmentStep(
  projectId: string, stepNo: number, reason: string, actor: string, opts: { cascadeStep5?: boolean } = {},
): ReopenResult {
  const db = getDb();
  const project = projectKeyRow(projectId);
  if (!project || !originApplies(projectId)) return { ok: false, error: "not_applicable" };
  const why = reason.trim();
  if (why.length < REOPEN_REASON_MIN || why.length > REOPEN_REASON_MAX) return { ok: false, error: "invalid_reason" };
  const target = doneRowsForStep(db, project, stepNo);
  if (target.length === 0) return { ok: false, error: "not_done" };
  const dependents = stepNo < 5 ? doneRowsForStep(db, project, 5) : [];
  if (dependents.length > 0 && !opts.cascadeStep5) return { ok: false, error: "dependent_step_done", dependent_steps: [5] };

  const now = new Date().toISOString();
  return db.transaction((): ReopenResult => {
    const reopened: Array<{ id: string; step_no: number; cascade: boolean }> = [];
    const reopenOne = (row: LocatedRow, no: number, cascade: boolean) => {
      adopt(db, row, projectId);
      const auditId = appendAudit(db, {
        actor, action: cascade ? "entity_establishment.reopen_cascade" : "entity_establishment.reopen",
        target: auditTarget(projectId, no), now,
      });
      insertEvent(db, {
        stepId: row.id, projectId, stepNo: no, kind: "reopen", fromStatus: "done", toStatus: "in_progress",
        reason: why, evidenceUrl: row.evidence_url, actor, auditId, now,
      });
      db.run(
        "UPDATE entity_establishment_step SET status = 'in_progress', evidence_url = NULL, owner = ?, updated_at = ? WHERE id = ?",
        [actor, now, row.id],
      );
      reopened.push({ id: row.id, step_no: no, cascade });
    };
    for (const r of target) reopenOne(r, stepNo, false);
    for (const r of dependents) reopenOne(r, 5, true);
    return { ok: true, reopened, updated_at: now };
  })();
}

/** Done count across steps 1–4, project-keyed rows plus the backlink fallback. */
function establishmentPriorDone(projectId: string): number {
  const project = projectKeyRow(projectId);
  if (!project) return 0;
  const row = getDb()
    .query(
      `SELECT COUNT(DISTINCT step_no) AS c FROM entity_establishment_step
       WHERE status = 'done' AND step_no < 5 AND (
         project_id = ?
         OR (project_id IS NULL AND opportunity_id = ?)
       )`,
    )
    .get(projectId, project.source_opportunity_id ?? "") as { c: number };
  return row.c;
}
