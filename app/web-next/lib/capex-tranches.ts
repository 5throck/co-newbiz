// capex-tranches — phased capex tranches with release conditions (capex_tranche,
// migration 0136; deal-structuring v1.1.0 step 6, ADR-0160 addendum). Greenfield
// only. Writes are human-only (the route enforces cookie session + CSRF + human
// principal); no hard delete — retire stamps retired_*. Status: planned ->
// released | withheld; withheld -> planned | released; released is terminal.
// Every write appends one audit entry in the same transaction.
// Release is two-person: the first set_status('released') records a release
// request (audit capex_tranche.release_requested, status unchanged); a second
// call by someone other than the tranche creator and the requester releases it.
// The pending state is derived from the audit log (no schema change). While a
// request is pending the tranche cannot be edited (409 release_pending), and
// nobody who edited it since the request may approve it. Audit targets are
// `<project>:<tranche>` optionally followed by `|<json detail>` (update before/
// after values, the requester's reason).
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { currentRoute } from "./greenfield-subtrack.ts";

export const TRANCHE_STATUSES = ["planned", "released", "withheld"] as const;
export type TrancheStatus = (typeof TRANCHE_STATUSES)[number];
export const TRANCHE_SOURCE_STAGES = ["S10", "S11", "S12"] as const;

export interface CapexTrancheRow {
  id: string;
  project_id: string;
  tranche_no: number;
  amount: number;
  currency: string;
  release_condition: string;
  status: TrancheStatus;
  status_reason: string | null;
  source_stage: string;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
  status_changed_by: string | null;
  status_changed_at: string | null;
  retired_at: string | null;
  retired_by: string | null;
  retire_reason: string | null;
  /** Open release request awaiting a second, distinct person; null when none. */
  pending_release: { requested_by: string; requested_at: string } | null;
}

export type TrancheErrorCode = "invalid_request" | "not_found" | "not_greenfield" | "tranche_exists" | "invalid_transition" | "second_person_required" | "release_pending";
export type TrancheResult<T> = ({ ok: true } & T) | { ok: false; code: TrancheErrorCode; message: string };
const fail = (code: TrancheErrorCode, message: string) => ({ ok: false as const, code, message });

const COLS = `id, project_id, tranche_no, amount, currency, release_condition, status, status_reason, source_stage,
  created_by, created_at, updated_by, updated_at, status_changed_by, status_changed_at, retired_at, retired_by, retire_reason`;

const ALLOWED: Record<TrancheStatus, TrancheStatus[]> = {
  planned: ["released", "withheld"],
  withheld: ["planned", "released"],
  released: [],
};

export function listCapexTranches(projectId: string, opts: { includeRetired?: boolean } = {}, db: Database = getDb()): CapexTrancheRow[] {
  const where = opts.includeRetired ? "" : "AND retired_at IS NULL";
  const rows = db
    .query(`SELECT ${COLS} FROM capex_tranche WHERE project_id = ? ${where} ORDER BY tranche_no, created_at, id`)
    .all(projectId) as unknown as CapexTrancheRow[];
  return rows.map((r) => withPending(r, db));
}

const RELEASE_REQUESTED = "capex_tranche.release_requested";
export const MAX_CONDITION_LEN = 2000;
export const MAX_REASON_LEN = 2000;

/** SQL fragment matching an audit target for `base` with or without a `|detail` suffix. */
const TARGET_MATCH = "(target = ? OR substr(target, 1, ?) = ?)";
const targetArgs = (base: string) => [base, base.length + 1, `${base}|`] as const;

function withPending(row: CapexTrancheRow, db: Database): CapexTrancheRow {
  if (row.status === "released") return { ...row, pending_release: null };
  const req = db
    .query(
      `SELECT actor_user_id AS requested_by, created_at AS requested_at FROM audit_log
       WHERE action = ? AND ${TARGET_MATCH} AND created_at > ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(RELEASE_REQUESTED, ...targetArgs(`${row.project_id}:${row.id}`), row.status_changed_at ?? "") as { requested_by: string; requested_at: string } | null;
  return { ...row, pending_release: req ?? null };
}

function getLive(projectId: string, id: unknown, db: Database): CapexTrancheRow | null {
  if (typeof id !== "string" || !id) return null;
  const row = db.query(`SELECT ${COLS} FROM capex_tranche WHERE id = ? AND project_id = ? AND retired_at IS NULL`).get(id, projectId) as CapexTrancheRow | null;
  return row ? withPending(row, db) : null;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function parseAmount(v: unknown): number | null {
  if (typeof v === "string" && v.trim() === "") return null;
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseCurrency(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return "KRW";
  return typeof v === "string" && /^[A-Z]{3}$/.test(v.trim()) ? v.trim() : null;
}

function requireGreenfield(projectId: string, db: Database) {
  const route = currentRoute(projectId, db);
  return route?.track === "greenfield";
}

export function createCapexTranche(
  input: { projectId: string; trancheNo: unknown; amount: unknown; currency?: unknown; releaseCondition: unknown; sourceStage?: unknown; actor: string; now?: string },
  db: Database = getDb(),
): TrancheResult<{ tranche: CapexTrancheRow }> {
  if (!requireGreenfield(input.projectId, db)) return fail("not_greenfield", "capex 트랜치는 greenfield 경로 프로젝트에만 기록합니다.");
  const no = Number(input.trancheNo);
  if (!Number.isInteger(no) || no < 1) return fail("invalid_request", "tranche_no는 1 이상의 정수여야 합니다.");
  const amount = parseAmount(input.amount);
  if (amount === null) return fail("invalid_request", "amount는 0보다 큰 숫자여야 합니다.");
  const currency = parseCurrency(input.currency);
  if (!currency) return fail("invalid_request", "currency는 ISO 4217 세 글자 대문자 코드여야 합니다.");
  const cond = text(input.releaseCondition);
  if (!cond) return fail("invalid_request", "release_condition(집행 조건)이 필요합니다.");
  if (cond.length > MAX_CONDITION_LEN) return fail("invalid_request", `release_condition은 ${MAX_CONDITION_LEN}자 이하여야 합니다.`);
  const stage = input.sourceStage === undefined || input.sourceStage === null || input.sourceStage === "" ? "S10" : input.sourceStage;
  if (!(TRANCHE_SOURCE_STAGES as readonly unknown[]).includes(stage)) return fail("invalid_request", "source_stage는 S10 | S11 | S12 중 하나입니다.");
  const now = input.now ?? new Date().toISOString();
  const id = ulid();
  const exists = () => fail("tranche_exists", `트랜치 ${no}번이 이미 있습니다 — 수정하거나 먼저 폐기하세요.`);
  try {
    const dup = db.transaction(() => {
      if (db.query("SELECT id FROM capex_tranche WHERE project_id = ? AND tranche_no = ? AND retired_at IS NULL").get(input.projectId, no)) return true;
      db.run(
        `INSERT INTO capex_tranche (id, project_id, tranche_no, amount, currency, release_condition, status, source_stage, created_by, created_at)
         VALUES (?,?,?,?,?,?, 'planned', ?,?,?)`,
        [id, input.projectId, no, amount, currency, cond, stage as string, input.actor, now],
      );
      appendAudit(db, { actor: input.actor, action: "capex_tranche.create", target: `${input.projectId}:${id}`, now });
      return false;
    }).immediate();
    if (dup) return exists();
  } catch (e) {
    if (/UNIQUE constraint failed/i.test((e as Error).message)) return exists();
    throw e;
  }
  return { ok: true, tranche: getLive(input.projectId, id, db)! };
}

export function updateCapexTranche(
  input: { projectId: string; trancheId: unknown; amount?: unknown; currency?: unknown; releaseCondition?: unknown; actor: string; now?: string },
  db: Database = getDb(),
): TrancheResult<{ tranche: CapexTrancheRow }> {
  const row = getLive(input.projectId, input.trancheId, db);
  if (!row) return fail("not_found", "트랜치를 찾을 수 없습니다.");
  if (row.status === "released") return fail("invalid_transition", "집행된 트랜치는 수정할 수 없습니다.");
  if (row.pending_release) {
    return fail("release_pending", "집행 요청이 대기 중인 트랜치는 수정할 수 없습니다 — 먼저 보류(withheld)로 요청을 무효화하세요.");
  }
  const amount = input.amount === undefined ? row.amount : parseAmount(input.amount);
  if (amount === null) return fail("invalid_request", "amount는 0보다 큰 숫자여야 합니다.");
  const currency = input.currency === undefined ? row.currency : parseCurrency(input.currency);
  if (!currency) return fail("invalid_request", "currency는 ISO 4217 세 글자 대문자 코드여야 합니다.");
  const cond = input.releaseCondition === undefined ? row.release_condition : text(input.releaseCondition);
  if (!cond) return fail("invalid_request", "release_condition(집행 조건)이 필요합니다.");
  if (cond.length > MAX_CONDITION_LEN) return fail("invalid_request", `release_condition은 ${MAX_CONDITION_LEN}자 이하여야 합니다.`);
  const now = input.now ?? new Date().toISOString();
  const detail = JSON.stringify({
    before: { amount: row.amount, currency: row.currency, release_condition: row.release_condition },
    after: { amount, currency, release_condition: cond },
  });
  const blocked = db.transaction(() => {
    // Re-check inside the write transaction so a request landing between the read and the write still blocks the edit.
    if (getLive(input.projectId, row.id, db)?.pending_release) return true;
    db.run("UPDATE capex_tranche SET amount = ?, currency = ?, release_condition = ?, updated_by = ?, updated_at = ? WHERE id = ?", [
      amount, currency, cond, input.actor, now, row.id,
    ]);
    appendAudit(db, { actor: input.actor, action: "capex_tranche.update", target: `${input.projectId}:${row.id}|${detail}`, now });
    return false;
  }).immediate();
  if (blocked) return fail("release_pending", "집행 요청이 대기 중인 트랜치는 수정할 수 없습니다.");
  return { ok: true, tranche: getLive(input.projectId, row.id, db)! };
}

export function setCapexTrancheStatus(
  input: { projectId: string; trancheId: unknown; status: unknown; reason?: unknown; actor: string; now?: string },
  db: Database = getDb(),
): TrancheResult<{ tranche: CapexTrancheRow; release_pending: boolean }> {
  const row = getLive(input.projectId, input.trancheId, db);
  if (!row) return fail("not_found", "트랜치를 찾을 수 없습니다.");
  if (!(TRANCHE_STATUSES as readonly unknown[]).includes(input.status)) return fail("invalid_request", "status는 planned | released | withheld 중 하나입니다.");
  const next = input.status as TrancheStatus;
  if (!ALLOWED[row.status].includes(next)) return fail("invalid_transition", `${row.status} → ${next} 전환은 허용되지 않습니다.`);
  const reason = text(input.reason);
  if (!reason) return fail("invalid_request", "상태 변경 사유(reason)가 필요합니다 — 집행 조건 충족 근거 또는 보류 사유.");
  if (reason.length > MAX_REASON_LEN) return fail("invalid_request", `reason은 ${MAX_REASON_LEN}자 이하여야 합니다.`);
  const now = input.now ?? new Date().toISOString();
  const target = `${input.projectId}:${row.id}`;
  if (next === "released") {
    const pending = row.pending_release;
    if (!pending) {
      db.transaction(() => appendAudit(db, { actor: input.actor, action: RELEASE_REQUESTED, target: `${target}|${JSON.stringify({ reason })}`, now }))();
      return { ok: true, tranche: getLive(input.projectId, row.id, db)!, release_pending: true };
    }
    if (input.actor === pending.requested_by) return { ok: true, tranche: row, release_pending: true };
    if (input.actor === row.created_by) {
      return fail("second_person_required", "집행(released)은 트랜치 작성자와 집행 요청자가 아닌 다른 사람이 승인해야 합니다.");
    }
    // Anyone who edited the tranche since the request (or is its last editor) cannot be the approver.
    const editedSince = db
      .query(`SELECT 1 FROM audit_log WHERE action = 'capex_tranche.update' AND ${TARGET_MATCH} AND actor_user_id = ? AND created_at >= ? LIMIT 1`)
      .get(...targetArgs(target), input.actor, pending.requested_at);
    if (editedSince || (row.updated_by === input.actor && (row.updated_at ?? "") >= pending.requested_at)) {
      return fail("second_person_required", "집행 요청 이후 트랜치를 수정한 사람은 집행을 승인할 수 없습니다.");
    }
    db.transaction(() => {
      db.run("UPDATE capex_tranche SET status = ?, status_reason = ?, status_changed_by = ?, status_changed_at = ? WHERE id = ?", [
        next, reason, input.actor, now, row.id,
      ]);
      appendAudit(db, { actor: input.actor, action: "capex_tranche.released", target: `${target}:requested_by=${pending.requested_by}`, now });
    })();
    return { ok: true, tranche: getLive(input.projectId, row.id, db)!, release_pending: false };
  }
  db.transaction(() => {
    db.run("UPDATE capex_tranche SET status = ?, status_reason = ?, status_changed_by = ?, status_changed_at = ? WHERE id = ?", [
      next, reason, input.actor, now, row.id,
    ]);
    appendAudit(db, { actor: input.actor, action: `capex_tranche.${next}`, target, now });
  })();
  return { ok: true, tranche: getLive(input.projectId, row.id, db)!, release_pending: false };
}

export function retireCapexTranche(
  input: { projectId: string; trancheId: unknown; reason: unknown; actor: string; now?: string },
  db: Database = getDb(),
): TrancheResult<{ tranche_id: string; retired_at: string }> {
  const row = getLive(input.projectId, input.trancheId, db);
  if (!row) return fail("not_found", "트랜치를 찾을 수 없습니다.");
  if (row.status === "released") return fail("invalid_transition", "집행된 트랜치는 폐기할 수 없습니다.");
  const reason = text(input.reason);
  if (!reason) return fail("invalid_request", "폐기 사유(reason)가 필요합니다.");
  if (reason.length > MAX_REASON_LEN) return fail("invalid_request", `reason은 ${MAX_REASON_LEN}자 이하여야 합니다.`);
  const now = input.now ?? new Date().toISOString();
  db.transaction(() => {
    db.run("UPDATE capex_tranche SET retired_at = ?, retired_by = ?, retire_reason = ? WHERE id = ?", [now, input.actor, reason, row.id]);
    appendAudit(db, { actor: input.actor, action: "capex_tranche.retire", target: `${input.projectId}:${row.id}`, now });
  })();
  return { ok: true, tranche_id: row.id, retired_at: now };
}
