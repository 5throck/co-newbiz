// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.

export interface AuditStats {
  total: number;
  daily: Array<{ day: string; count: number }>;
  byAction: Array<{ action: string; count: number }>;
  byActor: Array<{ actor: string; count: number }>;
}

export interface ReviewAuditRate { key: string; sampled: number; agreed: number; rate: number | null }
export interface ReviewAuditSummary {
  overall: ReviewAuditRate;
  by_domain: ReviewAuditRate[];
  by_quarter: ReviewAuditRate[];
  suggested_sample_rate: number;
  note: string | null;
}

export type Section = "users" | "audit" | "data-sources" | "schedule" | "database" | "notifications" | "glossary" | "governance" | "master-data" | "adr";

// ── P4 notifications & watches (design 2026-10-29-scheduled-jobs-design §13.5–13.7) ──
// Shapes mirror the B1 Route Handler contracts verbatim (app/api/admin/notifications*,
// app/api/admin/watches*, app/api/admin/watch-rules*).

/** Per-channel delivery STATUS COUNTS of one list row ({} = in-app only — the row IS the in-app delivery). */
export type DeliverySummary = Record<string, Record<string, number>>;

/** Paging meta of GET /api/admin/notifications (page/page_size ≤ 100/total/total_pages — the old count meta is gone). */
export interface PageMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

/** One row of GET /api/admin/notifications (paged list; the old uncapped shape is gone). */
export interface AdminNotificationListRow {
  id: string;
  sent_at: string;
  read_at: string | null;
  trigger_type: string;
  severity: string;
  title: string | null;
  project: { id: string; project_no: string | null } | null;
  delivery: DeliverySummary;
}

/** GET /api/admin/notifications/[id] — the detail-drawer payload. */
export interface AdminNotificationDetail {
  id: string;
  user_id: string;
  project: { id: string; project_no: string | null } | null;
  trigger_type: string;
  severity: string;
  title: string | null;
  payload: unknown;
  channel: string;
  bundle: string;
  sent_at: string;
  read_at: string | null;
  dedupe_key: string | null;
  source_ref: string | null;
  deliveries: NotificationDeliveryRow[];
}

/** One notification_delivery ledger row — masked values are rendered as-is (never unmuted client-side). */
export interface NotificationDeliveryRow {
  id: string;
  channel: string;
  recipient_user_id: string | null;
  recipient_address_masked: string | null;
  target_key: string | null;
  status: string;
  attempt: number;
  next_attempt_at: string | null;
  last_error: string | null;
  provider_message_id: string | null;
  digest_id: string | null;
  is_test: number;
  created_at: string;
  sent_at: string | null;
}

/** One row of GET /api/admin/watches — `enabled` is DERIVED (enabled_rule_count > 0; no watch.enabled column). */
export interface WatchListRow {
  id: string;
  project: { id: string; project_no: string | null };
  user_id: string;
  created_at: string;
  last_checked_at: string | null;
  rule_count: number;
  enabled_rule_count: number;
  enabled: boolean;
}

/** One watch_rule row (GET/POST .../watches/[id]/rules, PATCH/DELETE /api/admin/watch-rules/[id]). */
export interface WatchRuleRow {
  id: string;
  watch_id: string;
  trigger_type: string;
  threshold: number | null;
  cooldown_hours: number;
  channel: string;
  enabled: number;
  adr_ref: string | null;
}

/** Rule draft sent to POST /api/admin/watch-rules/preview (threshold only when the trigger bears one). */
export interface WatchRuleDraft {
  trigger_type: string;
  threshold: number | null;
  cooldown_hours: number;
  channel: string;
}

/** POST /api/admin/watch-rules/preview response — zero-write evaluation; recipients arrive MASKED (§13.8). */
export interface WatchRulePreview {
  watch_id: string;
  project: { id: string; project_no: string | null };
  trigger_type: string;
  threshold: number | null;
  cooldown_hours: number;
  channel: string;
  evaluated: boolean;
  would_fire: boolean;
  suppressed_by_cooldown: boolean;
  reason: string;
  severity: string | null;
  recipients: Array<{ user_id: string; email_masked: string | null; channels: string[] }>;
  in_app_user_ids: string[];
}

export interface GlossaryTermRow {
  key: string;
  ko: string;
  en: string;
  category: string;
  aliases?: string[];
}

// glossary-lint 미정의어 큐 (ADR-0022) — scripts/co-newbiz/glossary-lint.ts의
// report-only 스캐너 결과. 큐는 큐레이터 심사 대상이지 자동 진행이 아니다.
export interface GlossaryLintFinding {
  token: string;
  file: string;
  line: number;
  count: number;
}

export interface GlossaryLintQueue {
  scanned_files: number;
  known_count: number;
  undefined: GlossaryLintFinding[];
}
export interface AdrRow {
  id: string;
  title: string;
  status: string;
  file: string;
}


export interface GovernanceDocRow {
  id: string;
  layer: string;
  key: string;
  title: string;
  scope: string;
  version: string;
  enforceability: string;
  owner_agent: string;
  doc_path: string;
  effective_from: string;
  superseded_by: string | null;
  review_cycle_months: number | null;
  next_review?: string | null;
  review_status?: "none" | "ok" | "due_soon" | "overdue";
  days_to_review?: number | null;
  active_waivers?: number;
  waiver_clauses?: Array<{ clause_ref: string; count: number }>;
  waiver_concentrated?: boolean;
  library_id?: string | null;
}