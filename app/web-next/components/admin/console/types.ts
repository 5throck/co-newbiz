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

export interface AdminNotificationRow {
  id: string;
  user_id: string;
  project_id: string | null;
  trigger_type: string;
  severity: string;
  payload: string;
  channel: string;
  bundle: string;
  sent_at: string;
  read_at: string | null;
}

export interface GlossaryTermRow {
  key: string;
  ko: string;
  en: string;
  category: string;
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