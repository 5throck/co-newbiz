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
//
// ADR-0167 (migration 0142): Green Field establishment mode. A project runs
// either the new_entity step set (the five entity-formation steps above) or the
// business_unit step set (new business unit inside the existing legal entity),
// decided at S10 by a human (setEstablishmentMode). Step rows, events, progress,
// sequence and reopen rules are all scoped to the project's ACTIVE mode; rows of
// a previous mode stay as read-only history (listEstablishmentHistory). New Green
// Field projects have NO default: until a human chooses, writes fail with
// mode_not_chosen and the S11 completion check says so.
import type { Database } from "bun:sqlite";
import { conditionsEnforced, s11OpenConditions } from "./gate-conditions.ts";
import { getDb } from "../../../db/client.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { effectiveGoTimes } from "../../../db/lib/gate-effective.ts";
import { ulid } from "../../../db/lib/ulid.ts";

export const ESTABLISHMENT_STATUSES = ["pending", "in_progress", "done", "halted", "escalated"] as const;
export type EstablishmentStatus = (typeof ESTABLISHMENT_STATUSES)[number];

export const ESTABLISHMENT_ORIGINS = ["internal", "joint"] as const;
export type EstablishmentOrigin = (typeof ESTABLISHMENT_ORIGINS)[number];

/** How a mutation arrived (audit trail, ADR-0165 addendum). */
export const CALL_PATHS = ["ui", "api", "mcp", "unknown"] as const;
export type CallPath = (typeof CALL_PATHS)[number];

/** ADR-0167 — which step set a Green Field project executes at S11. */
export const ESTABLISHMENT_MODES = ["new_entity", "business_unit"] as const;
export type EstablishmentMode = (typeof ESTABLISHMENT_MODES)[number];

/** Korean display labels (D1). */
export const ESTABLISHMENT_MODE_LABELS: Record<EstablishmentMode, string> = {
  new_entity: "신규 법인 설립",
  business_unit: "신규 사업부 추진",
};

export const ESTABLISHMENT_STEP_COUNT = 5;

export const ESTABLISHMENT_STEP_TITLES_BY_MODE: Record<EstablishmentMode, Record<number, string>> = {
  new_entity: {
    1: "설립준비(관할·주식구조·이사회 결의)",
    2: "법인등기·정관·사업자등록",
    3: "인허가 이전/재발급 분류",
    4: "인력이전(신 근로계약+PIIA)",
    5: "완료확인(IP양도체인·거버넌스 베이스라인)",
  },
  business_unit: {
    1: "사업부 신설 결의",
    2: "사업자등록 사업장·업종 추가/변경",
    3: "인허가 명의 확인",
    4: "인력 배치·조직 개편",
    5: "완료 확인(조직·예산·권한 기준선)",
  },
};

/** Step titles of a mode (new_entity when omitted — the pre-ADR-0167 behaviour). */
export function stepTitles(mode: EstablishmentMode = "new_entity"): Record<number, string> {
  return ESTABLISHMENT_STEP_TITLES_BY_MODE[mode];
}

/** @deprecated kept for old call sites — the new_entity titles. Use stepTitles(mode). */
export const ESTABLISHMENT_STEP_TITLES: Record<number, string> = ESTABLISHMENT_STEP_TITLES_BY_MODE.new_entity;

export interface EstablishmentStepRow {
  id: string;
  mode: EstablishmentMode;
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
  origin: string | null;
  track: string | null;
  establishment_mode: string | null;
}

function projectKeyRow(projectId: string): ProjectKeyRow | undefined {
  return getDb()
    .query("SELECT id, source_opportunity_id, origin, track, establishment_mode FROM md_project WHERE id = ?")
    .get(projectId) as ProjectKeyRow | undefined;
}

/**
 * The step set a project executes now (ADR-0167). An explicit mode wins. With
 * none: a Green Field project has NOT chosen yet (null — no silent default);
 * every other project (Brown Field, unclassified track, pre-0142 rows) keeps the
 * new_entity behaviour it always had.
 */
function activeModeOf(p: ProjectKeyRow): EstablishmentMode | null {
  if (p.establishment_mode && (ESTABLISHMENT_MODES as readonly string[]).includes(p.establishment_mode)) {
    return p.establishment_mode as EstablishmentMode;
  }
  return p.track === "greenfield" ? null : "new_entity";
}

/** Active establishment mode of a project; null = Green Field project that has not chosen yet (or unknown project). */
export function activeEstablishmentMode(projectId: string): EstablishmentMode | null {
  const p = projectKeyRow(projectId);
  return p ? activeModeOf(p) : null;
}

const STEP_COLS = `id, mode, step_no, status, origin, checklist_item, evidence_url, note, owner,
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
export function listEstablishmentSteps(projectId: string, modeOverride?: EstablishmentMode): EstablishmentStepRow[] {
  const project = projectKeyRow(projectId);
  if (!project) return [];
  const mode = modeOverride ?? activeModeOf(project);
  if (!mode) return [];
  const db = getDb();
  const direct = db
    .query(`SELECT ${STEP_COLS} FROM entity_establishment_step WHERE project_id = ? AND mode = ? ORDER BY step_no, id`)
    .all(projectId, mode) as RawStepRow[];
  const seen = new Set(direct.map((r) => r.id));
  let fallback: RawStepRow[] = [];
  if (project.source_opportunity_id) {
    fallback = db
      .query(
        `SELECT ${STEP_COLS} FROM entity_establishment_step
         WHERE project_id IS NULL AND opportunity_id = ? AND mode = ?
         ORDER BY step_no, id`,
      )
      .all(project.source_opportunity_id, mode) as RawStepRow[];
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

/** Rows of every mode OTHER than the active one — read-only history after an audited mode change (ADR-0167). */
export function listEstablishmentHistory(projectId: string): EstablishmentStepRow[] {
  const project = projectKeyRow(projectId);
  if (!project) return [];
  const mode = activeModeOf(project);
  const others = ESTABLISHMENT_MODES.filter((m) => m !== mode);
  return others.flatMap((m) => listEstablishmentSteps(projectId, m));
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
  mode: EstablishmentMode;
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
      `SELECT e.id, e.mode, e.step_id, e.step_no, e.kind, e.from_status, e.to_status, e.from_assignee, e.to_assignee,
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
  // ADR-0186 D6: only a decision really in force counts (an IC GO awaiting its countersign does not).
  const goTimes = effectiveGoTimes(db, projectId, ["dd", "entity_ic", "group_ic"]).map((t) => tsMs(t)).filter(Number.isFinite);
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
  /** Mode the count belongs to; null = a Green Field project that has not chosen one (never complete). */
  mode: EstablishmentMode | null;
}

/** Distinct completed step numbers for the project — the S11 predicate input
 * (process-flow) and the IC-package progress (n/5) both read this, so the
 * count cannot drift between surfaces. */
export function establishmentProgress(projectId: string): EstablishmentProgress {
  const project = projectKeyRow(projectId);
  if (!project) return { done: 0, total: 5, complete: false, mode: null };
  const mode = activeModeOf(project);
  if (!mode) return { done: 0, total: 5, complete: false, mode: null };
  const db = getDb();
  const rows = db
    .query(
      `SELECT DISTINCT step_no FROM entity_establishment_step
       WHERE status = 'done' AND mode = ? AND (
         project_id = ?
         OR (project_id IS NULL AND opportunity_id = ?)
       )`,
    )
    .all(mode, projectId, project.source_opportunity_id ?? "") as Array<{ step_no: number }>;
  return { done: rows.length, total: 5, complete: rows.length >= 5, mode };
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
  | "invalid_reason"
  | "mode_not_chosen"
  | "mode_mismatch"
  | "condition_open";

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
  /** Optional statement of the mode the caller believes is active; a mismatch is refused (mode_mismatch). It can never SET the mode. */
  mode?: EstablishmentMode | null;
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

function locateRow(db: Database, project: ProjectKeyRow, mode: EstablishmentMode, stepNo: number, itemKey: string | null): LocatedRow | undefined {
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
         WHERE project_id = ? AND mode = ? AND step_no = ? ${itemClause}`,
      )
      .all(project.id, mode, stepNo, ...itemArgs) as Array<Omit<LocatedRow, "legacy">>,
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
         WHERE project_id IS NULL AND opportunity_id = ? AND mode = ? AND step_no = ? ${itemClause}`,
      )
      .all(project.source_opportunity_id, mode, stepNo, ...itemArgs) as Array<Omit<LocatedRow, "legacy">>,
    true,
  );
}

function adopt(db: Database, row: LocatedRow, projectId: string): void {
  if (row.legacy) db.run("UPDATE entity_establishment_step SET project_id = ? WHERE id = ?", [projectId, row.id]);
}

interface EventInput {
  mode: EstablishmentMode;
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
        reason, evidence_url, actor_user_id, audit_id, via, created_at, mode)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, e.stepId, e.projectId, e.stepNo, e.kind, e.fromStatus ?? null, e.toStatus ?? null,
      e.fromAssignee ?? null, e.toAssignee ?? null, e.reason ?? null, e.evidenceUrl ?? null, e.actor, e.auditId, e.via, e.now, e.mode],
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
  mode: EstablishmentMode;
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
  const stepsText = n.stepNos.map((no) => `${no}단계(${stepTitles(n.mode)[no] ?? ""})`).join(", ");
  const reason = n.reason?.trim();
  const message = n.kind === "reopened"
    ? `설립 실행 ${stepsText}가 ${actorName}님에 의해 재개되었습니다${reason ? ` — ${reason.length > NOTIFY_MESSAGE_REASON_MAX ? `${reason.slice(0, NOTIFY_MESSAGE_REASON_MAX)}…` : reason}` : ""}`
    : `설립 실행 ${stepsText}의 담당자로 지정되었습니다 (지정: ${actorName})`;
  const payload = JSON.stringify({
    message,
    event_id: n.eventId,
    step_nos: n.stepNos,
    mode: n.mode,
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
  db: Database, projectId: string, mode: EstablishmentMode, stepId: string, stepNo: number,
  from: string | null, to: string | null, actor: string, via: CallPath, now: string,
): void {
  db.run("UPDATE entity_establishment_step SET assignee_user_id = ?, assigned_by = ?, assigned_at = ? WHERE id = ?", [to, actor, now, stepId]);
  const auditId = appendAudit(db, { actor, action: "entity_establishment.assign", target: auditTarget(projectId, stepNo, via), now });
  const eventId = insertEvent(db, { mode, stepId, projectId, stepNo, kind: "assign", fromAssignee: from, toAssignee: to, actor, auditId, via, now });
  // ADR-0165 addendum: the new assignee hears about it (clearing notifies nobody).
  if (to) notifyEstablishment(db, { kind: "assigned", mode, projectId, stepNos: [stepNo], eventId, actor, extraRecipients: [to], includeLeads: false, via, now });
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
  const mode = activeModeOf(project);
  if (!mode) return { ok: false, error: "mode_not_chosen" };
  if (input.mode && input.mode !== mode) return { ok: false, error: "mode_mismatch" };
  if (input.status === "pending" || !ESTABLISHMENT_STATUSES.includes(input.status)) return { ok: false, error: "invalid_status" };

  const itemKey = input.checklist_item?.trim() || null;
  const evidenceUrl = input.evidence_url?.trim() || null;
  const note = input.note?.trim() || null;
  if (evidenceUrl && !isHttpUrl(evidenceUrl)) return { ok: false, error: "invalid_evidence_url" };
  if (input.status === "done" && !evidenceUrl && !note) return { ok: false, error: "evidence_required" };

  const existing = locateRow(db, project, mode, input.step_no, itemKey);
  if (existing?.status === "done") return { ok: false, error: "reopen_required" };

  if (input.assignee_user_id && !isActiveMember(projectId, input.assignee_user_id)) {
    return { ok: false, error: "assignee_not_member" };
  }
  // 순서 강제 — 완료확인(5)은 선행 4단계가 모두 done일 때만 완료할 수 있다.
  if (input.step_no === 5 && input.status === "done" && establishmentPriorDone(projectId, mode) < 4) {
    return { ok: false, error: "sequence_violation" };
  }
  // ADR-0186 D4 (family `validators` = enforce): the closure step cannot complete while an establishment / closing condition precedent is open.
  if (input.step_no === 5 && input.status === "done" && conditionsEnforced() && s11OpenConditions(db, projectId).length > 0) {
    return { ok: false, error: "condition_open" };
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
           (id, opportunity_id, project_id, step_no, status, origin, checklist_item, evidence_url, note, owner, updated_at, mode)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [rowId, project.source_opportunity_id, projectId, input.step_no, input.status, input.origin, itemKey, evidenceUrl, note, actor, now, mode],
      );
    }
    const auditId = appendAudit(db, { actor, action: "entity_establishment.update", target: auditTarget(projectId, input.step_no, via), now });
    insertEvent(db, {
      mode, stepId: rowId, projectId, stepNo: input.step_no, kind: "status_change",
      fromStatus, toStatus: input.status, evidenceUrl, actor, auditId, via, now,
    });
    if (input.status === "done") {
      appendAudit(db, { actor, action: "entity_establishment.complete", target: auditTarget(projectId, input.step_no, via), now });
    }
    let assignee = fromAssignee;
    if (input.assignee_user_id !== undefined && (input.assignee_user_id ?? null) !== fromAssignee) {
      applyAssign(db, projectId, mode, rowId, input.step_no, fromAssignee, input.assignee_user_id ?? null, actor, via, now);
      assignee = input.assignee_user_id ?? null;
    }
    return {
      ok: true, id: rowId, step_no: input.step_no, status: input.status,
      title: stepTitles(mode)[input.step_no], step_done: input.status === "done", updated_at: now,
      assignee_user_id: assignee,
    };
  })();
}

export type AssignResult =
  | { ok: true; id: string; step_no: number; assignee_user_id: string | null; changed: boolean; updated_at: string }
  | { ok: false; error: "not_applicable" | "assignee_not_member" | "no_origin_opportunity" | "mode_not_chosen" };

/** Set/change/clear the step's responsible person. Allowed on a `done` step; creates a `pending` row when none exists. */
export function assignEstablishmentStep(
  projectId: string, stepNo: number, assignee: string | null, actor: string, statedOrigin?: string | null, via: CallPath = "unknown",
): AssignResult {
  const db = getDb();
  const project = projectKeyRow(projectId);
  if (!project || !originApplies(projectId, statedOrigin)) return { ok: false, error: "not_applicable" };
  const mode = activeModeOf(project);
  if (!mode) return { ok: false, error: "mode_not_chosen" };
  if (assignee && !isActiveMember(projectId, assignee)) return { ok: false, error: "assignee_not_member" };
  const existing = locateRow(db, project, mode, stepNo, null);
  if (!existing && !project.source_opportunity_id) return { ok: false, error: "no_origin_opportunity" };
  const now = new Date().toISOString();
  return db.transaction((): AssignResult => {
    if (existing) {
      adopt(db, existing, projectId);
      if ((existing.assignee_user_id ?? null) === assignee) {
        return { ok: true, id: existing.id, step_no: stepNo, assignee_user_id: assignee, changed: false, updated_at: now };
      }
      applyAssign(db, projectId, mode, existing.id, stepNo, existing.assignee_user_id, assignee, actor, via, now);
      return { ok: true, id: existing.id, step_no: stepNo, assignee_user_id: assignee, changed: true, updated_at: now };
    }
    const origin = (db.query("SELECT origin FROM md_project WHERE id = ?").get(projectId) as { origin: string }).origin;
    const rowId = ulid();
    db.run(
      `INSERT INTO entity_establishment_step
         (id, opportunity_id, project_id, step_no, status, origin, checklist_item, evidence_url, note, owner, updated_at, mode)
       VALUES (?,?,?,?,'pending',?,NULL,NULL,NULL,?,?,?)`,
      [rowId, project.source_opportunity_id, projectId, stepNo, origin, actor, now, mode],
    );
    if (assignee === null) return { ok: true, id: rowId, step_no: stepNo, assignee_user_id: null, changed: false, updated_at: now };
    applyAssign(db, projectId, mode, rowId, stepNo, null, assignee, actor, via, now);
    return { ok: true, id: rowId, step_no: stepNo, assignee_user_id: assignee, changed: true, updated_at: now };
  })();
}

export type ReopenResult =
  | { ok: true; reopened: Array<{ id: string; step_no: number; cascade: boolean }>; updated_at: string }
  | { ok: false; error: "not_applicable" | "invalid_reason" | "not_done" | "dependent_step_done" | "mode_not_chosen"; dependent_steps?: number[] };

function doneRowsForStep(db: Database, project: ProjectKeyRow, mode: EstablishmentMode, stepNo: number): LocatedRow[] {
  const rows = db
    .query(
      `SELECT id, status, evidence_url, assignee_user_id, project_id FROM entity_establishment_step
       WHERE status = 'done' AND mode = ? AND step_no = ? AND (project_id = ? OR (project_id IS NULL AND opportunity_id = ?))
       ORDER BY id`,
    )
    .all(mode, stepNo, project.id, project.source_opportunity_id ?? "") as Array<Omit<LocatedRow, "legacy"> & { project_id: string | null }>;
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
  const mode = activeModeOf(project);
  if (!mode) return { ok: false, error: "mode_not_chosen" };
  const why = reason.trim();
  if (why.length < REOPEN_REASON_MIN || why.length > REOPEN_REASON_MAX) return { ok: false, error: "invalid_reason" };
  const target = doneRowsForStep(db, project, mode, stepNo);
  if (target.length === 0) return { ok: false, error: "not_done" };
  const dependents = stepNo < 5 ? doneRowsForStep(db, project, mode, 5) : [];
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
        mode, stepId: row.id, projectId, stepNo: no, kind: "reopen", fromStatus: "done", toStatus: "in_progress",
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
      kind: "reopened", mode, projectId, stepNos: [...new Set(reopened.map((r) => r.step_no))], eventId: eventIds[0],
      actor, extraRecipients: assignees, includeLeads: true, reason: why, via, now,
    });
    return { ok: true, reopened, updated_at: now };
  })();
}

/** Done count across steps 1–4, project-keyed rows plus the backlink fallback. */
function establishmentPriorDone(projectId: string, mode: EstablishmentMode): number {
  const project = projectKeyRow(projectId);
  if (!project) return 0;
  const row = getDb()
    .query(
      `SELECT COUNT(DISTINCT step_no) AS c FROM entity_establishment_step
       WHERE status = 'done' AND mode = ? AND step_no < 5 AND (
         project_id = ?
         OR (project_id IS NULL AND opportunity_id = ?)
       )`,
    )
    .get(mode, projectId, project.source_opportunity_id ?? "") as { c: number };
  return row.c;
}

// ── Establishment mode (ADR-0167) ──────────────────────────────────────────

export type EstablishmentModeError =
  | "not_applicable"
  | "invalid_mode"
  | "mode_not_allowed"
  | "reason_required"
  | "invalid_reason";

export interface EstablishmentModeEventRow {
  id: string;
  kind: "set" | "change";
  from_mode: EstablishmentMode | null;
  to_mode: EstablishmentMode;
  reason: string | null;
  actor_user_id: string;
  actor_name: string | null;
  via: CallPath;
  created_at: string;
}

export interface EstablishmentModeState {
  /** The stored column; null = not chosen (Green Field) or not applicable. */
  mode: EstablishmentMode | null;
  /** Mode the S11 step set follows now (null = a Green Field project that has not chosen). */
  active_mode: EstablishmentMode | null;
  mode_label: string | null;
  /** Non-binding hint (S5 promotion); never takes effect without a human choice. */
  suggested: EstablishmentMode | null;
  /** Modes a human may choose now (business_unit needs origin internal and a Green Field track). */
  allowed_modes: EstablishmentMode[];
  /** True when the mode applies at all (origin internal or joint). */
  applicable: boolean;
  /** True once any step of the current mode left `pending` — a later change keeps those rows as history. */
  steps_started: boolean;
  history: EstablishmentModeEventRow[];
  /** True when a mode change is newer than the latest valid dd / entity_ic / group_ic GO (warning only). */
  changed_after_gate: boolean;
}

function allowedModes(p: ProjectKeyRow): EstablishmentMode[] {
  if (p.origin !== "internal" && p.origin !== "joint") return [];
  return p.origin === "internal" && p.track === "greenfield" ? ["new_entity", "business_unit"] : ["new_entity"];
}

/** Validate a mode (and optionally its non-binding use as a hint) against the project's origin/track. */
export function modeAllowedFor(origin: string | null, track: string | null, mode: string): mode is EstablishmentMode {
  if (!(ESTABLISHMENT_MODES as readonly string[]).includes(mode)) return false;
  return allowedModes({ id: "", source_opportunity_id: null, origin, track, establishment_mode: null }).includes(mode as EstablishmentMode);
}

function stepsStarted(db: Database, projectId: string, mode: EstablishmentMode | null): boolean {
  if (!mode) return false;
  return !!db
    .query("SELECT 1 FROM entity_establishment_step WHERE project_id = ? AND mode = ? AND status <> 'pending' LIMIT 1")
    .get(projectId, mode);
}

/** A mode change newer than the latest valid GO of the dd / entity_ic / group_ic gates (same reference time as reopenedAfterGate). */
function modeChangedAfterGate(projectId: string): boolean {
  const db = getDb();
  // ADR-0186 D6: only a decision really in force counts (an IC GO awaiting its countersign does not).
  const goTimes = effectiveGoTimes(db, projectId, ["dd", "entity_ic", "group_ic"]).map((t) => tsMs(t)).filter(Number.isFinite);
  if (goTimes.length === 0) return false;
  const lastGo = Math.max(...goTimes);
  const changes = db
    .query("SELECT created_at FROM establishment_mode_event WHERE project_id = ? AND kind = 'change'")
    .all(projectId) as Array<{ created_at: string }>;
  return changes.some((c) => tsMs(c.created_at) > lastGo);
}

export function getEstablishmentModeState(projectId: string): EstablishmentModeState | null {
  const p = projectKeyRow(projectId);
  if (!p) return null;
  const db = getDb();
  const sug = db.query("SELECT establishment_mode_suggested AS s FROM md_project WHERE id = ?").get(projectId) as { s: string | null } | null;
  const history = (db
    .query(
      `SELECT e.id, e.kind, e.from_mode, e.to_mode, e.reason, e.actor_user_id, u.display_name AS actor_name, e.via, e.created_at
       FROM establishment_mode_event e LEFT JOIN app_user u ON u.user_id = e.actor_user_id
       WHERE e.project_id = ? ORDER BY e.created_at DESC, e.id DESC LIMIT 20`,
    )
    .all(projectId) as EstablishmentModeEventRow[]).map((r) => ({ ...r, actor_name: r.actor_name?.trim() || r.actor_user_id }));
  const active = activeModeOf(p);
  const stored = (ESTABLISHMENT_MODES as readonly string[]).includes(p.establishment_mode ?? "") ? (p.establishment_mode as EstablishmentMode) : null;
  return {
    mode: stored,
    active_mode: active,
    mode_label: active ? ESTABLISHMENT_MODE_LABELS[active] : null,
    suggested: (ESTABLISHMENT_MODES as readonly string[]).includes(sug?.s ?? "") ? (sug!.s as EstablishmentMode) : null,
    allowed_modes: allowedModes(p),
    applicable: p.origin === "internal" || p.origin === "joint",
    steps_started: stepsStarted(db, projectId, active),
    history,
    changed_after_gate: modeChangedAfterGate(projectId),
  };
}

export type SetModeResult =
  | { ok: true; mode: EstablishmentMode; previous_mode: EstablishmentMode | null; changed: boolean; kind: "set" | "change" | null; updated_at: string }
  | { ok: false; error: EstablishmentModeError };

/**
 * Record the establishment mode (ADR-0167) — a human act at S10; the route
 * enforces human-only, this function enforces the data rules:
 *  - origin must be internal/joint; business_unit needs origin internal AND a
 *    Green Field track (D2); an unknown value is invalid_mode;
 *  - the first choice (no stored mode) needs no reason;
 *  - changing an already stored mode needs a reason of >= 10 chars (D5). Rows
 *    of the old mode stay untouched as read-only history; the new mode's steps
 *    start empty (pending).
 * Row update, audit entry and mode event share one transaction.
 */
export function setEstablishmentMode(
  projectId: string, mode: string, reason: string | null | undefined, actor: string, via: CallPath = "unknown",
): SetModeResult {
  const db = getDb();
  const project = projectKeyRow(projectId);
  if (!project || (project.origin !== "internal" && project.origin !== "joint")) return { ok: false, error: "not_applicable" };
  if (!(ESTABLISHMENT_MODES as readonly string[]).includes(mode)) return { ok: false, error: "invalid_mode" };
  if (!modeAllowedFor(project.origin, project.track, mode)) return { ok: false, error: "mode_not_allowed" };
  const next = mode as EstablishmentMode;
  const previous = (ESTABLISHMENT_MODES as readonly string[]).includes(project.establishment_mode ?? "")
    ? (project.establishment_mode as EstablishmentMode)
    : null;
  const now = new Date().toISOString();
  if (previous === next) return { ok: true, mode: next, previous_mode: previous, changed: false, kind: null, updated_at: now };
  const why = reason?.trim() ?? "";
  if (previous !== null) {
    if (why.length === 0) return { ok: false, error: "reason_required" };
    if (why.length < REOPEN_REASON_MIN || why.length > REOPEN_REASON_MAX) return { ok: false, error: "invalid_reason" };
  } else if (why.length > REOPEN_REASON_MAX) {
    return { ok: false, error: "invalid_reason" };
  }
  const kind = previous === null ? "set" : "change";
  return db.transaction((): SetModeResult => {
    db.run("UPDATE md_project SET establishment_mode = ? WHERE id = ?", [next, projectId]);
    const auditId = appendAudit(db, {
      actor, action: kind === "set" ? "establishment_mode.set" : "establishment_mode.change",
      target: `${projectId}#mode@${via}`, now,
    });
    db.run(
      `INSERT INTO establishment_mode_event (id, project_id, kind, from_mode, to_mode, reason, actor_user_id, audit_id, via, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [ulid(), projectId, kind, previous, next, why || null, actor, auditId, via, now],
    );
    return { ok: true, mode: next, previous_mode: previous, changed: true, kind, updated_at: now };
  })();
}

/** Store the non-binding S5 hint (never takes effect; setEstablishmentMode is the only binding write). Caller validates via modeAllowedFor. */
export function storeSuggestedMode(db: Database, projectId: string, mode: EstablishmentMode | null): void {
  db.run("UPDATE md_project SET establishment_mode_suggested = ? WHERE id = ?", [mode, projectId]);
}
