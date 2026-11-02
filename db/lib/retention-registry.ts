// @version 1.1.0
// 1.1.0: dba-adjudication reconciliation (dba 2026-11-02 + owner adoption; PM follow-up before P7).
// The eligible set now mirrors the executor's allow-list table-for-table (scripts/co-newbiz/jobs/
// retention-registry alignment): job_run, execution_job, session and llm_call_log are eligible with
// the D2/dba defaults (defaultBasis/defaultMonths), dry_run_session moved to the excluded set (its
// expired rows are purged on the read path per migration 0172's header, and the retention executor
// refuses it), and the handling vocabulary was reconciled with the executor's ACTUAL per-table
// behavior: a new "delete_only" handling covers the plain-delete tables (job_run, execution_job,
// session). INVARIANT (guarded by tests/unit/retention-cleanup.test.ts and
// tests/unit/admin-retention-registry.test.ts): a policy row created from this registry - seeded or
// admin-created - always passes the executor's action_mismatch guard, because the stored action is
// derived from handlingToStoredAction(entry.handling) on BOTH sides (the seeder and the admin route
// derive it from this module; the executor compares against the same function over the same
// handling).
/**
 * Retention-eligible table registry — the authoritative allowlist for
 * `retention_policy` rows. Only tables listed here may carry a policy; the
 * date column ("basis"), the default months and the action must also come from
 * the entry. Everything else is denied by default (append-only, integrity,
 * identity, master-data and decision-record tables must never be pruned).
 *
 * This set is kept table-for-table identical to the retention executor's
 * RETENTION_ALLOW_LIST (scripts/co-newbiz/jobs/retention-cleanup.ts): the
 * executor list is authoritative for the nightly 03:00 run, and this registry
 * must never name a table the executor refuses (or omit one it runs), so that
 * admin-created policies can never hit the executor's fail-loud guards.
 *
 * Executing a policy is NOT done by the web server; the scheduled-jobs
 * executor reads its own mirrored allow-list. Adding a table here is a
 * governance decision: it must be a pure operational/derived log with no
 * integrity, audit or lineage role, and it must be mirrored into the executor
 * allow-list in the same change.
 */

export type RetentionAction = "archive" | "delete";

export interface RetentionDateColumn {
  column: string;
  label: { ko: string; en: string };
}

/**
 * Fixed per-table handling — what the retention executor actually does with
 * rows past the cutoff (this is the vocabulary of record; the executor's
 * allow-list entries carry the same value):
 *
 *  - archive_then_delete: qualifying rows are archived first
 *    (db/archive/<table>/<yyyy-mm>.jsonl.gz, D6), the archive is verified, and
 *    only then are the rows deleted. Stored action: 'delete'.
 *  - archive_only: qualifying rows are archived; they are NEVER deleted
 *    (raw_payload — lineage underpinning). Stored action: 'archive'.
 *  - delete_only: qualifying rows are deleted outright, nothing is archived
 *    (job_run, execution_job, session — operational logs with no archive
 *    requirement). Stored action: 'delete'.
 *
 * NOTE the stored-action collision is intentional and harmless: the
 * `retention_policy.action` CHECK column (archive|delete, migration 0005/0033)
 * cannot express "archive-then-delete" vs "plain delete" for stored 'delete'.
 * The behavior is NOT read from the stored action — it is pinned per table by
 * `handling` here and mirrored in the executor allow-list, so the stored
 * action is descriptive metadata and the handling is the operative contract.
 */
export type RetentionHandling = "archive_then_delete" | "archive_only" | "delete_only";

/**
 * Stored `retention_policy.action` (CHECK archive|delete, no schema change):
 * archive_then_delete -> 'delete', archive_only -> 'archive', delete_only -> 'delete'.
 */
export function handlingToStoredAction(h: RetentionHandling): RetentionAction {
  return h === "archive_only" ? "archive" : "delete";
}

export interface RetentionEligibleTable {
  table: string;
  label: { ko: string; en: string };
  description: { ko: string; en: string };
  /**
   * Eligible date columns. Exactly the executor-declared basis column is
   * listed: the executor fails any policy whose basis differs from its
   * declared basis, so a wider list here would let the admin route accept a
   * policy the executor refuses — breaking the always-passes invariant.
   */
  dateColumns: RetentionDateColumn[];
  handling: RetentionHandling;
  /** D2 default (owner decision 2026-10-29) or dba ruling 2026-11-02 — the seeder's default months. */
  defaultMonths: number;
  /** The basis column the seeder (and the executor) pin — always dateColumns[0].column. */
  defaultBasis: string;
}

export const RETENTION_ELIGIBLE_TABLES: readonly RetentionEligibleTable[] = [
  {
    table: "notification",
    label: { ko: "알림", en: "Notifications" },
    description: {
      ko: "사용자에게 보낸 알림 기록입니다. 오래된 알림은 판단 근거로 쓰이지 않습니다.",
      en: "Notifications sent to users. Old notifications are not used as decision evidence.",
    },
    dateColumns: [{ column: "sent_at", label: { ko: "발송일", en: "Sent at" } }],
    handling: "archive_then_delete",
    defaultMonths: 12,
    defaultBasis: "sent_at",
  },
  {
    table: "llm_call_log",
    label: { ko: "AI 호출 기록", en: "AI call log" },
    description: {
      ko: "AI 초안을 만들 때 남긴 호출 기록(누가, 어떤 목적으로, 성공 여부)입니다. 본문은 담기지 않습니다.",
      en: "Log of AI draft calls (who, purpose, success). Does not contain the generated text.",
    },
    dateColumns: [{ column: "created_at", label: { ko: "기록일", en: "Logged at" } }],
    // dba recommendation adopted by the owner (2026-11-02): the volume table —
    // 12 months archive-then-delete. Stored action 'delete' (vocabulary above).
    handling: "archive_then_delete",
    defaultMonths: 12,
    defaultBasis: "created_at",
  },
  {
    table: "job_run",
    label: { ko: "작업 실행 이력", en: "Scheduled-job run history" },
    description: {
      ko: "예약 작업의 실행 결과 기록입니다. 오래된 실행 이력은 운영 참고용으로만 쓰입니다.",
      en: "Run results of scheduled jobs. Old run history is operational reference only.",
    },
    dateColumns: [{ column: "started_at", label: { ko: "시작일", en: "Started at" } }],
    // D2 (owner decision 2026-10-29): 12 months, plain delete — run history is
    // monitoring reference, not lineage; nothing is archived.
    handling: "delete_only",
    defaultMonths: 12,
    defaultBasis: "started_at",
  },
  {
    table: "execution_job",
    label: { ko: "분석 실행 작업", en: "Analysis execution jobs" },
    description: {
      ko: "분석 엔진 실행 작업 기록입니다. 완료된(터미널 상태) 작업만 보존 기간이 적용됩니다.",
      en: "Analysis-engine execution job records. Only terminal-status rows age out.",
    },
    dateColumns: [{ column: "created_at", label: { ko: "생성일", en: "Created at" } }],
    // D2 (owner decision 2026-10-29): 6 months, plain delete, TERMINAL rows only
    // (queued/running are never touched — the executor enforces the status filter).
    handling: "delete_only",
    defaultMonths: 6,
    defaultBasis: "created_at",
  },
  {
    table: "session",
    label: { ko: "인증 세션", en: "Auth sessions" },
    description: {
      ko: "만료된 인증 세션 토큰 기록입니다. 토큰 해시는 재사용할 수 없으므로 만료 후 1개월이 지나면 삭제됩니다.",
      en: "Expired auth session records. Token hashes are non-replayable; rows expire out after one month.",
    },
    dateColumns: [{ column: "expires_at", label: { ko: "만료일", en: "Expires at" } }],
    // dba ruling 2026-11-02: IN with 1-month delete on expires_at. Session TTL
    // is 12 hours (db/lib/accounts.ts SESSION_HOURS) and token_hash is a
    // non-replayable SHA-256, so a session expired >= 1 month is dead beyond
    // any operational or forensic need. expires_at (not created_at) is the age
    // semantic: a live session can never match, whatever its created_at.
    handling: "delete_only",
    defaultMonths: 1,
    defaultBasis: "expires_at",
  },
  {
    table: "raw_payload",
    label: { ko: "외부 자료 원본", en: "Raw external payloads" },
    description: {
      ko: "외부 자료원에서 받은 원본 응답입니다. 출처 추적의 바탕이라 보관만 허용하고 삭제는 허용하지 않습니다.",
      en: "Raw responses fetched from external sources. They underpin lineage, so only archiving is allowed, never deletion.",
    },
    dateColumns: [{ column: "fetched_at", label: { ko: "수집일", en: "Fetched at" } }],
    // D2: 24 months, archive-only. No ingest path writes raw_payload today, so
    // the seeded row governs an empty table (executor no-op until then).
    handling: "archive_only",
    defaultMonths: 24,
    defaultBasis: "fetched_at",
  },
];

/** Tables that must never carry a retention policy, with the reason (documentation + test guard). */
export const RETENTION_EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  audit_log: "append-only audit trail (ADR-0012, FR-SEC-07); no delete path for any role",
  data_access_log: "security access trail (FR-SEC-06); append-only evidence",
  gate_decision: "recorded human gate decisions; integrity record",
  gate_decision_snapshot: "frozen inputs of a gate decision; integrity record",
  gate_decision_stale: "integrity flag history of gate decisions",
  gate_integrity_cutoff: "integrity cutoff marker for gate decisions",
  investment_decision: "recorded human investment decisions",
  decision: "recorded decisions",
  project_policy_pin: "pins in-flight projects to the policy version they started under",
  s5_plan_pin: "pins the approved S5 plan; integrity record",
  report_snapshot: "frozen report evidence",
  report_render: "rows point at files on disk; deleting rows would orphan the files",
  waiver: "approved exceptions; compliance evidence",
  kill_criteria_override: "approved overrides of kill criteria; compliance evidence",
  closure_record: "project closure evidence",
  schema_migrations: "migration ledger; the database cannot start without it",
  // dba adjudication 2026-11-02: executor-refused — expired dry-run sessions are
  // purged on the READ path (lib/dry-run.ts purgeExpiredDryRunSessions), per the
  // migration 0172 header (TTL §6.8); the retention executor never touches it.
  dry_run_session: "expired sessions are purged on the read path (lib/dry-run.ts purgeExpiredDryRunSessions, migration 0172 TTL); the retention executor refuses it",
  api_token: "active authentication state, managed by the auth lifecycle (revocation, not age-based pruning)",
  oauth_code: "short-lived authentication state, managed by the auth lifecycle",
  password_history: "credential reuse protection",
  app_user: "accounts; deactivate instead of pruning",
  retention_policy: "the policy table itself",
};

const BY_TABLE = new Map(RETENTION_ELIGIBLE_TABLES.map((t) => [t.table, t]));

export function getEligibleTable(table: string): RetentionEligibleTable | undefined {
  return BY_TABLE.get(table);
}

export type RetentionValidation =
  | { ok: true; entry: RetentionEligibleTable }
  | { ok: false; code: "table_not_eligible" | "column_not_eligible" | "action_not_allowed"; message: string };

/** Authoritative check for a proposed policy: table, then date column, then action. */
export function validateRetentionPolicy(table: string, column: string, action?: string): RetentionValidation {
  const entry = BY_TABLE.get(table);
  if (!entry) {
    return { ok: false, code: "table_not_eligible", message: `Table '${table}' is not eligible for a retention policy.` };
  }
  if (!entry.dateColumns.some((c) => c.column === column)) {
    return { ok: false, code: "column_not_eligible", message: `Column '${column}' is not an eligible date column of '${table}'.` };
  }
  if (action !== undefined && action !== handlingToStoredAction(entry.handling)) {
    return { ok: false, code: "action_not_allowed", message: `Action '${action}' conflicts with the fixed handling '${entry.handling}' of '${table}'.` };
  }
  return { ok: true, entry };
}

/** ISO cutoff: rows with column < cutoff are older than `months` months (UTC calendar months). */
export function retentionCutoff(months: number, now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString();
}
