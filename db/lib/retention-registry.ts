// @version 1.0.0
/**
 * Retention-eligible table registry — the authoritative allowlist for
 * `retention_policy` rows. Only tables listed here may carry a policy; the
 * date column ("basis") and the action must also come from the entry.
 * Everything else is denied by default (append-only, integrity, identity,
 * master-data and decision-record tables must never be pruned).
 *
 * Executing a policy is NOT done by the web server; the scheduled-jobs
 * feature (in design) will read this registry. Adding a table here is a
 * governance decision: it must be a pure operational/derived log with no
 * integrity, audit or lineage role.
 */

export type RetentionAction = "archive" | "delete";

export interface RetentionDateColumn {
  column: string;
  label: { ko: string; en: string };
}

export interface RetentionEligibleTable {
  table: string;
  label: { ko: string; en: string };
  description: { ko: string; en: string };
  dateColumns: RetentionDateColumn[];
  actions: RetentionAction[];
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
    actions: ["archive", "delete"],
  },
  {
    table: "llm_call_log",
    label: { ko: "AI 호출 기록", en: "AI call log" },
    description: {
      ko: "AI 초안을 만들 때 남긴 호출 기록(누가, 어떤 목적으로, 성공 여부)입니다. 본문은 담기지 않습니다.",
      en: "Log of AI draft calls (who, purpose, success). Does not contain the generated text.",
    },
    dateColumns: [{ column: "created_at", label: { ko: "기록일", en: "Logged at" } }],
    actions: ["archive", "delete"],
  },
  {
    table: "dry_run_session",
    label: { ko: "프롬프트 시험 실행", en: "Prompt dry-run sessions" },
    description: {
      ko: "프롬프트를 시험해 본 임시 세션입니다. 만료된 세션은 다시 쓰이지 않습니다.",
      en: "Temporary sessions for trying out prompts. Expired sessions are never reused.",
    },
    dateColumns: [
      { column: "created_at", label: { ko: "생성일", en: "Created at" } },
      { column: "expires_at", label: { ko: "만료일", en: "Expires at" } },
    ],
    actions: ["archive", "delete"],
  },
  {
    table: "raw_payload",
    label: { ko: "외부 자료 원본", en: "Raw external payloads" },
    description: {
      ko: "외부 자료원에서 받은 원본 응답입니다. 출처 추적의 바탕이라 보관만 허용하고 삭제는 허용하지 않습니다.",
      en: "Raw responses fetched from external sources. They underpin lineage, so only archiving is allowed, never deletion.",
    },
    dateColumns: [{ column: "fetched_at", label: { ko: "수집일", en: "Fetched at" } }],
    actions: ["archive"],
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
  job_run: "execution history that monitoring and the integrity checks read; owned by the scheduled-jobs feature",
  project_policy_pin: "pins in-flight projects to the policy version they started under",
  s5_plan_pin: "pins the approved S5 plan; integrity record",
  report_snapshot: "frozen report evidence",
  report_render: "rows point at files on disk; deleting rows would orphan the files",
  waiver: "approved exceptions; compliance evidence",
  kill_criteria_override: "approved overrides of kill criteria; compliance evidence",
  closure_record: "project closure evidence",
  schema_migrations: "migration ledger; the database cannot start without it",
  session: "authentication state, managed by the auth lifecycle",
  api_token: "authentication state, managed by the auth lifecycle",
  oauth_code: "authentication state, managed by the auth lifecycle",
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
  if (action !== undefined && !entry.actions.includes(action as RetentionAction)) {
    return { ok: false, code: "action_not_allowed", message: `Action '${action}' is not allowed for '${table}'.` };
  }
  return { ok: true, entry };
}

/** ISO cutoff: rows with column < cutoff are older than `months` months (UTC calendar months). */
export function retentionCutoff(months: number, now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString();
}
