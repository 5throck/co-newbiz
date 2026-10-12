// project-goals — project-level business goals (project_business_goal,
// migration 0135 / ADR-0159). Analysts set them per deal in S8; they resolve
// above the affiliate and group standards (ADR-0114) but keep the same
// reference-evidence boundary: a miss never blocks a gate. Versions are
// append-only: supersede writes a NEW row and stamps only superseded_* on the
// old one; retire stamps retired_*. Every write appends one audit entry in the
// same transaction.
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { CUSTOM_METRIC_KEY, parseDirection, presetFor, type TargetDirection } from "./business-targets-format.ts";

export interface ProjectGoalRow {
  id: string;
  project_id: string;
  metric_key: string;
  label: string | null;
  direction: TargetDirection;
  target_value: number;
  rationale: string;
  source_note: string | null;
  supersedes_id: string | null;
  superseded_at: string | null;
  superseded_by: string | null;
  created_by: string;
  created_at: string;
  retired_at: string | null;
  retired_by: string | null;
  retire_reason: string | null;
}

export type GoalErrorCode = "invalid_request" | "not_found" | "goal_exists" | "goal_not_active";
export type GoalResult<T> = ({ ok: true } & T) | { ok: false; code: GoalErrorCode; message: string };

const COLS = `id, project_id, metric_key, label, direction, target_value, rationale, source_note, supersedes_id,
  superseded_at, superseded_by, created_by, created_at, retired_at, retired_by, retire_reason`;

export function listProjectGoals(projectId: string, opts: { includeHistory?: boolean } = {}): ProjectGoalRow[] {
  const where = opts.includeHistory ? "" : "AND superseded_at IS NULL AND retired_at IS NULL";
  return getDb()
    .query(`SELECT ${COLS} FROM project_business_goal WHERE project_id = ? ${where} ORDER BY metric_key, COALESCE(label, ''), created_at, id`)
    .all(projectId) as unknown as ProjectGoalRow[];
}

function getGoal(projectId: string, goalId: string): ProjectGoalRow | null {
  return (getDb().query(`SELECT ${COLS} FROM project_business_goal WHERE id = ? AND project_id = ?`).get(goalId, projectId) as ProjectGoalRow | null) ?? null;
}

export const MAX_GOAL_TEXT_LEN = 2000;
const bad = (message: string): { ok: false; code: GoalErrorCode; message: string } => ({ ok: false, code: "invalid_request", message });

/** Goal values are non-negative finite numbers; strings are accepted only when
 * they parse as a finite number (an empty string is not zero). */
function parseValue(v: unknown): number | null {
  if (typeof v === "string" && v.trim() === "") return null;
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function trimmed(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export interface CreateGoalInput {
  projectId: string;
  metricKey: unknown;
  label?: unknown;
  direction?: unknown;
  targetValue: unknown;
  rationale: unknown;
  sourceNote?: unknown;
  actor: string;
}

export function createProjectGoal(input: CreateGoalInput): GoalResult<{ goal: ProjectGoalRow }> {
  const metricKey = trimmed(input.metricKey);
  const preset = presetFor(metricKey);
  if (!preset && metricKey !== CUSTOM_METRIC_KEY) return bad("metric_key는 지표 프리셋 또는 custom이어야 합니다.");
  const label = metricKey === CUSTOM_METRIC_KEY ? trimmed(input.label) : "";
  if (metricKey === CUSTOM_METRIC_KEY && !label) return bad("사용자 지정 지표에는 label이 필요합니다.");
  const direction = input.direction == null ? preset?.direction ?? null : parseDirection(input.direction);
  if (!direction) return bad("direction은 gte | lte 중 하나입니다.");
  const value = parseValue(input.targetValue);
  if (value == null) return bad("target_value는 0 이상의 유한한 숫자여야 합니다.");
  const rationale = trimmed(input.rationale);
  if (!rationale) return bad("rationale(근거)은 필수입니다.");
  if (rationale.length > MAX_GOAL_TEXT_LEN) return bad(`rationale은 ${MAX_GOAL_TEXT_LEN}자 이하여야 합니다.`);
  const sourceNote = trimmed(input.sourceNote) || null;

  const db = getDb();
  const id = ulid();
  const now = new Date().toISOString();
  const exists = { ok: false, code: "goal_exists", message: "같은 지표의 활성 목표가 이미 있습니다 — 새 버전으로 수정(supersede)하세요." } as const;
  try {
    const dup = db.transaction(() => {
      const found = db
        .query(
          `SELECT id FROM project_business_goal WHERE project_id = ? AND metric_key = ? AND COALESCE(label,'') = ?
           AND superseded_at IS NULL AND retired_at IS NULL`,
        )
        .get(input.projectId, metricKey, label);
      if (found) return true;
      db.run(
        `INSERT INTO project_business_goal (id, project_id, metric_key, label, direction, target_value, rationale, source_note, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [id, input.projectId, metricKey, label || null, direction, value, rationale, sourceNote, input.actor, now],
      );
      appendAudit(db, { actor: input.actor, action: "project_goal.create", target: `${input.projectId}:${id}`, now });
      return false;
    }).immediate();
    if (dup) return exists;
  } catch (e) {
    if (/UNIQUE constraint failed/i.test((e as Error).message)) return exists;
    throw e;
  }
  return { ok: true, goal: getGoal(input.projectId, id)! };
}

export interface SupersedeGoalInput {
  projectId: string;
  goalId: unknown;
  direction?: unknown;
  targetValue: unknown;
  rationale: unknown;
  sourceNote?: unknown;
  actor: string;
}

export function supersedeProjectGoal(input: SupersedeGoalInput): GoalResult<{ goal: ProjectGoalRow; superseded_id: string }> {
  const goalId = trimmed(input.goalId);
  if (!goalId) return bad("goal_id는 필수입니다.");
  const value = parseValue(input.targetValue);
  if (value == null) return bad("target_value는 0 이상의 유한한 숫자여야 합니다.");
  const rationale = trimmed(input.rationale);
  if (!rationale) return bad("rationale(근거)은 필수입니다.");
  if (rationale.length > MAX_GOAL_TEXT_LEN) return bad(`rationale은 ${MAX_GOAL_TEXT_LEN}자 이하여야 합니다.`);
  const prev = getGoal(input.projectId, goalId);
  if (!prev) return { ok: false, code: "not_found", message: "목표를 찾을 수 없습니다." };
  if (prev.superseded_at || prev.retired_at) return { ok: false, code: "goal_not_active", message: "이미 교체되었거나 폐기된 목표입니다." };
  const direction = input.direction == null ? prev.direction : parseDirection(input.direction);
  if (!direction) return bad("direction은 gte | lte 중 하나입니다.");
  const sourceNote = input.sourceNote === undefined ? prev.source_note : trimmed(input.sourceNote) || null;

  const db = getDb();
  const id = ulid();
  const now = new Date().toISOString();
  db.transaction(() => {
    // Stamp the old row first: the unique active index admits one active row per metric.
    db.run("UPDATE project_business_goal SET superseded_at = ?, superseded_by = ? WHERE id = ?", [now, id, prev.id]);
    db.run(
      `INSERT INTO project_business_goal (id, project_id, metric_key, label, direction, target_value, rationale, source_note, supersedes_id, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, prev.project_id, prev.metric_key, prev.label, direction, value, rationale, sourceNote, prev.id, input.actor, now],
    );
    appendAudit(db, { actor: input.actor, action: "project_goal.supersede", target: `${input.projectId}:${id}`, now });
  })();
  return { ok: true, goal: getGoal(input.projectId, id)!, superseded_id: prev.id };
}

export interface RetireGoalInput {
  projectId: string;
  goalId: unknown;
  reason: unknown;
  actor: string;
}

export function retireProjectGoal(input: RetireGoalInput): GoalResult<{ goal_id: string; retired_at: string }> {
  const goalId = trimmed(input.goalId);
  if (!goalId) return bad("goal_id는 필수입니다.");
  const reason = trimmed(input.reason);
  if (!reason) return bad("reason(폐기 사유)은 필수입니다.");
  if (reason.length > MAX_GOAL_TEXT_LEN) return bad(`reason은 ${MAX_GOAL_TEXT_LEN}자 이하여야 합니다.`);
  const prev = getGoal(input.projectId, goalId);
  if (!prev) return { ok: false, code: "not_found", message: "목표를 찾을 수 없습니다." };
  if (prev.superseded_at || prev.retired_at) return { ok: false, code: "goal_not_active", message: "이미 교체되었거나 폐기된 목표입니다." };
  const db = getDb();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.run("UPDATE project_business_goal SET retired_at = ?, retired_by = ?, retire_reason = ? WHERE id = ?", [now, input.actor, reason, prev.id]);
    appendAudit(db, { actor: input.actor, action: "project_goal.retire", target: `${input.projectId}:${prev.id}`, now });
  })();
  return { ok: true, goal_id: prev.id, retired_at: now };
}
