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
// (target "<projectId>#step<n>@<via>") in one transaction.
//
// ADR-0165 addendum (migration 0141): every event row records `via` (how the
// mutation arrived: ui cookie session / api bearer token / mcp in-process);
// reopen and assignment notify the project lead(s) and the step's assignee
// (never the actor) through the existing `notification` table, deduped per
// recipient; `reopenedAfterGate` is the single server-side derivation of the
// post-approval reopen warning (UI, IC package and process-flow consume it).
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { ulid } from "../../../db/lib/ulid.ts";

export const ESTABLISHMENT_STATUSES = ["pending", "in_progress", "done", "halted", "escalated"] as const;
export type EstablishmentStatus = (typeof ESTABLISHMENT_STATUSES)[number];

export const ESTABLISHMENT_ORIGINS = ["internal", "joint"] as const;
export type EstablishmentOrigin = (typeof ESTABLISHMENT_ORIGINS)[number];

/** How a mutation arrived (audit trail, ADR-0165 addendum). */
export const CALL_PATHS = ["ui", "api", "mcp", "unknown"] as const;
export type CallPath = (typeof CALL_PATHS)[number];

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
  via: CallPath;
  created_at: string;
}

/** Latest transition events for the project (newest first). */
export function listEstablishmentEvents(projectId: string, limit = 20): EstablishmentEventRow[] {
  const rows = getDb()
    .query(
      `SELECT e.id, e.step_id, e.step_no, e.kind, e.from_status, e.to_status, e.from_assignee, e.to_assignee,
              e.reason, e.evidence_url, e.actor_user_id, u.display_name AS actor_name, e.audit_id, e.via, e.created_at
       FROM entity_establishment_step_event e LEFT JOIN app_user u ON u.user_id = e.actor_user_id
       WHERE e.project_id = ? ORDER BY e.created_at DESC, e.id DESC LIMIT ?`,
    )
    .all(projectId, limit) as EstablishmentEventRow[];
  return rows.map((r) => ({ ...r, actor_name: r.actor_name?.trim() || r.actor_user_id }));
}

/** Gates whose GO the reopen warning is measured against (ADR-0165 addendum). */
export const REOPEN_WARNING_GATES = ["dd", "entity_ic", "group_ic"] as const;

export interface ReopenedAfterGate {
  /** True when a reopen event is newer than the latest valid GO of the dd / entity_ic / group_ic gate. */
  reopened_after_gate: boolean;
  /** Present only when reopened_after_gate is true. */
  reopened_after_gate_detail: { steps: number[]; count: number; since: string } | null;
}

/** Timestamps arrive as ISO ("...T...Z") or SQLite ("YYYY-MM-DD HH:MM:SS", UTC). */
function tsMs(ts: string): number {
  const t = ts.includes("T") ? ts : ts.replace(" ", "T");
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(t) ? t : `${t}Z`);
}

/**
 * The single derivation of the post-approval reopen warning. "Valid GO" = a
 * gate's current verdict (latest decision that is not marked stale, ADR-0157)
 * is GO; the reference time is the newest such GO among dd / entity_ic /
 * group_ic. No valid GO -> false (nothing was approved that a reopen could
 * undermine). A reopen never revokes a gate decision; this only flags it.
 */
export function reopenedAfterGate(projectId: string): ReopenedAfterGate {
  const none: ReopenedAfterGate = { reopened_after_gate: false, reopened_after_gate_detail: null };
  const db = getDb();
  const gates = db
    .query(
      `SELECT decision, decided_at FROM (
         SELECT g.gate, g.decision, g.decided_at,
                ROW_NUMBER() OVER (PARTITION BY g.gate ORDER BY g.decided_at DESC, g.id DESC) AS rn
         FROM gate_decision g
         WHERE g.entity_type = 'project' AND g.entity_id = ? AND g.gate IN ('dd', 'entity_ic', 'group_ic')
           AND NOT EXISTS (SELECT 1 FROM gate_decision_stale s WHERE s.decision_id = g.id)
       ) WHERE rn = 1`,
    )
    .all(projectId) as Array<{ decision: string; decided_at: string }>;
  const goTimes = gates.filter((g) => g.decision === "go").map((g) => tsMs(g.decided_at)).filter(Number.isFinite);
  if (goTimes.length === 0) return none;
  const lastGo = Math.max(...goTimes);
  const reopens = db
    .query("SELECT step_no, created_at FROM entity_establishment_step_event WHERE project_id = ? AND kind = 'reopen'")
    .all(projectId) as Array<{ step_no: number; created_at: string }>;
  const after = reopens.filter((e) => tsMs(e.created_at) > lastGo);
  if (after.length === 0) return none;
  return {
    reopened_after_gate: true,
    reopened_after_gate_detail: {
      steps: [...new Set(after.map((e) => e.step_no))].sort((a, b) => a - b),
      count: after.length,
      since: new Date(lastGo).toISOString().slice(0, 10),
    },
  };
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
  via: CallPath;
  now: string;
}

function insertEvent(db: Database, e: EventInput): string {
  const id = ulid();
  db.run(
    `INSERT INTO entity_establishment_step_event
       (id, step_id, project_id, step_no, kind, from_status, to_status, from_assignee, to_assignee,
        reason, evidence_url, actor_user_id, audit_id, via, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, e.stepId, e.projectId, e.stepNo, e.kind, e.fromStatus ?? null, e.toStatus ?? null,
      e.fromAssignee ?? null, e.toAssignee ?? null, e.reason ?? null, e.evidenceUrl ?? null, e.actor, e.auditId, e.via, e.now],
  );
  return id;
}

/** audit_log has no detail column, so the call path rides in the target: "<projectId>#step<n>@<via>". */
const auditTarget = (projectId: string, stepNo: number, via: CallPath) => `${projectId}#step${stepNo}@${via}`;

const NOTIFY_MESSAGE_REASON_MAX = 80;
const NOTIFY_PAYLOAD_REASON_MAX = 300;

/**
 * In-app notifications for an establishment mutation (caller owns the
 * transaction). One row per recipient; the actor is never notified; the
 * (user_id, dedupe_key) unique index makes a repeat a no-op.
 */
function notifyEstablishment(db: Database, n: {
  kind: "reopened" | "assigned";
  projectId: string;
  stepNos: number[];
  eventId: string;
  actor: string;
  /** Users to notify in addition to the leads (reopen: the reopened rows' assignees; assign: the new assignee). */
  extraRecipients: Array<string | null>;
  includeLeads: boolean;
  reason?: string;
  via: CallPath;
  now: string;
}): number {
  const recipients = new Set<string>();
  if (n.includeLeads) {
    const leads = db
      .query("SELECT user_id FROM project_member WHERE project_id = ? AND project_role = 'lead' AND revoked_at IS NULL")
      .all(n.projectId) as Array<{ user_id: string }>;
    for (const l of leads) recipients.add(l.user_id);
  }
  for (const u of n.extraRecipients) if (u && isActiveMember(n.projectId, u)) recipients.add(u);
  recipients.delete(n.actor);
  if (recipients.size === 0) return 0;

  const actorName = userDisplayName(n.actor) ?? n.actor;
  const stepsText = n.stepNos.map((no) => `${no}단계(${ESTABLISHMENT_STEP_TITLES[no] ?? ""})`).join(", ");
  const reason = n.reason?.trim();
  const message = n.kind === "reopened"
    ? `설립 실행 ${stepsText}가 ${actorName}님에 의해 재개되었습니다${reason ? ` — ${reason.length > NOTIFY_MESSAGE_REASON_MAX ? `${reason.slice(0, NOTIFY_MESSAGE_REASON_MAX)}…` : reason}` : ""}`
    : `설립 실행 ${stepsText}의 담당자로 지정되었습니다 (지정: ${actorName})`;
  const payload = JSON.stringify({
    message,
    event_id: n.eventId,
    step_nos: n.stepNos,
    actor_user_id: n.actor,
    actor_name: actorName,
    ...(reason ? { reason: reason.slice(0, NOTIFY_PAYLOAD_REASON_MAX) } : {}),
    via: n.via,
    href: `/deals/${encodeURIComponent(n.projectId)}/s11`,
  });
  const triggerType = n.kind === "reopened" ? "establishment_step_reopened" : "establishment_step_assigned";
  const severity = n.kind === "reopened" ? "warning" : "info";
  let inserted = 0;
  for (const userId of recipients) {
    const r = db.run(
      `INSERT OR IGNORE INTO notification
         (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, dedupe_key)
       VALUES (?,?,?,?,?,?,'in_app','immediate',?,?)`,
      [ulid(), userId, n.projectId, triggerType, severity, payload, n.now, `establishment:${n.eventId}`],
    );
    inserted += r.changes;
  }
  return inserted;
}

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
  from: string | null, to: string | null, actor: string, via: CallPath, now: string,
): void {
  db.run("UPDATE entity_establishment_step SET assignee_user_id = ?, assigned_by = ?, assigned_at = ? WHERE id = ?", [to, actor, now, stepId]);
  const auditId = appendAudit(db, { actor, action: "entity_establishment.assign", target: auditTarget(projectId, stepNo, via), now });
  const eventId = insertEvent(db, { stepId, projectId, stepNo, kind: "assign", fromAssignee: from, toAssignee: to, actor, auditId, via, now });
  // ADR-0165 addendum: the new assignee hears about it (clearing notifies nobody).
  if (to) notifyEstablishment(db, { kind: "assigned", projectId, stepNos: [stepNo], eventId, actor, extraRecipients: [to], includeLeads: false, via, now });
}

/**
 * Change one establishment step's status (ADR-0165). Writes are ALWAYS
 * project_id-keyed (ADR-0100 §2). Rules, in order: origin applies; `done`
 * needs evidence (URL or note); a `done` row cannot be changed here
 * (reopen_required); step 5 `done` needs steps 1–4 done. Row update, event
 * and audit entries share one transaction.
 */
export function changeEstablishmentStatus(projectId: string, input: UpsertInput, actor: string, via: CallPath = "unknown"): UpsertResult {
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
    const auditId = appendAudit(db, { actor, action: "entity_establishment.update", target: auditTarget(projectId, input.step_no, via), now });
    insertEvent(db, {
      stepId: rowId, projectId, stepNo: input.step_no, kind: "status_change",
      fromStatus, toStatus: input.status, evidenceUrl, actor, auditId, via, now,
    });
    if (input.status === "done") {
      appendAudit(db, { actor, action: "entity_establishment.complete", target: auditTarget(projectId, input.step_no, via), now });
    }
    let assignee = fromAssignee;
    if (input.assignee_user_id !== undefined && (input.assignee_user_id ?? null) !== fromAssignee) {
      applyAssign(db, projectId, rowId, input.step_no, fromAssignee, input.assignee_user_id ?? null, actor, via, now);
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
export function assignEstablishmentStep(
  projectId: string, stepNo: number, assignee: string | null, actor: string, statedOrigin?: string | null, via: CallPath = "unknown",
): AssignResult {
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
      applyAssign(db, projectId, existing.id, stepNo, existing.assignee_user_id, assignee, actor, via, now);
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
    applyAssign(db, projectId, rowId, stepNo, null, assignee, actor, via, now);
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
  projectId: string, stepNo: number, reason: string, actor: string, opts: { cascadeStep5?: boolean; via?: CallPath } = {},
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
  const via: CallPath = opts.via ?? "unknown";
  return db.transaction((): ReopenResult => {
    const eventIds: string[] = [];
    const assignees: Array<string | null> = [];
    const reopened: Array<{ id: string; step_no: number; cascade: boolean }> = [];
    const reopenOne = (row: LocatedRow, no: number, cascade: boolean) => {
      adopt(db, row, projectId);
      const auditId = appendAudit(db, {
        actor, action: cascade ? "entity_establishment.reopen_cascade" : "entity_establishment.reopen",
        target: auditTarget(projectId, no, via), now,
      });
      eventIds.push(insertEvent(db, {
        stepId: row.id, projectId, stepNo: no, kind: "reopen", fromStatus: "done", toStatus: "in_progress",
        reason: why, evidenceUrl: row.evidence_url, actor, auditId, via, now,
      }));
      assignees.push(row.assignee_user_id);
      db.run(
        "UPDATE entity_establishment_step SET status = 'in_progress', evidence_url = NULL, owner = ?, updated_at = ? WHERE id = ?",
        [actor, now, row.id],
      );
      reopened.push({ id: row.id, step_no: no, cascade });
    };
    for (const r of target) reopenOne(r, stepNo, false);
    for (const r of dependents) reopenOne(r, 5, true);
    // ADR-0165 addendum: ONE notification per recipient per reopen action (a
    // cascade is a single act), keyed by the first event so a repeat is a no-op.
    notifyEstablishment(db, {
      kind: "reopened", projectId, stepNos: [...new Set(reopened.map((r) => r.step_no))], eventId: eventIds[0],
      actor, extraRecipients: assignees, includeLeads: true, reason: why, via, now,
    });
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
