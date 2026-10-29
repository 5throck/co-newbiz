// API client — docs/architecture/api-spec.md §9's response envelope, consumed everywhere.
// The SPA never talks to the DB directly (ui-spec §7); this is the one file
// that knows the fetch/cookie/error-shape details so every page component
// only sees typed data.

import { resolveApiErrorText } from "./error-messages.ts";
export interface Envelope<T> {
  data: T;
  meta: Record<string, unknown>;
  error: { code: string; message: string; details?: Record<string, unknown> } | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** Response envelope meta (e.g. open_findings / missing_sections on a 409). */
    public meta: Record<string, unknown> = {},
    /** Error `details` from the envelope (e.g. the fresh snapshot on a 409 snapshot_stale). */
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Read a cookie by name from document.cookie (for the CSRF double-submit pattern). */
function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Dev 서버 재시작·재컴파일 창에서 요청이 끊기면 응답 헤더만 오고 본문이 비어
// res.json()이 브라우저 원문 에러("Unexpected end of JSON input")를 던진다.
// 그 원문이 UI에 그대로 노출되지 않도록 판독 가능한 ApiError로 바꾼다.
function invalidResponse(res: Response): ApiError {
  return new ApiError(res.status || 0, "invalid_response", resolveApiErrorText("invalid_response", "The server response was empty or malformed — retry shortly."));
}

/** JSON 본문 파싱 — 빈·손상 본문이면 undefined (호출부가 재시도를 결정한다). */
async function parseJson<T>(res: Response): Promise<Envelope<T> | undefined> {
  try {
    return (await res.json()) as Envelope<T>;
  } catch {
    return undefined;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init?.headers as Record<string, string>) };
  // multipart 업로드는 브라우저가 boundary를 설정해야 하므로 Content-Type을 제거한다.
  if (init?.body instanceof FormData) delete headers["Content-Type"];
  const method = init?.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    // Double-submit CSRF: echo the readable csrf cookie in a custom header.
    const csrf = readCookie("co_newbiz_csrf");
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  const send = () => fetch(path, { credentials: "include", headers, ...init });
  let res = await send();
  let body = await parseJson<T>(res);
  if (body === undefined) {
    // 빈 본문은 일시적 끊김일 뿐 서버 판정이 아니므로, 멱등한 GET에 한해 재시도한다.
    // 재컴파일 창은 수백 ms~수 s에 이르므로 즉시 재시도로는 같은 창에 다시 걸린다 — 백오프를 둔다.
    if (method !== "GET") throw invalidResponse(res);
    for (const delayMs of [400, 1200]) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      res = await send();
      body = await parseJson<T>(res);
      if (body !== undefined) break;
    }
    if (body === undefined) throw invalidResponse(res);
  }
  if (!res.ok) {
    const code = body.error?.code ?? "unknown_error";
    // §3.5: localized text resolves from errors.codes.<code> at this single
    // choke point; unknown codes pass the (English) server message through.
    throw new ApiError(res.status, code, resolveApiErrorText(code, body.error?.message ?? "Request failed."), body.meta ?? {}, body.error?.details ?? {});
  }
  return body;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: "DELETE", body: body ? JSON.stringify(body) : undefined }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
};

export interface Me {
  userId: string;
  role: "admin" | "analyst" | "viewer";
  via: "cookie" | "bearer";
  scopes: string[];
  mustChangePassword: boolean;
}

export interface ProjectSummary {
  id: string;
  project_no: string;
  created_at: string;
  rag_overall?: "green" | "amber" | "red" | null;
  rag_assessed_at?: string | null;
  gate_stage?: string | null;
  is_stale?: boolean;
  stale_reasons?: string[];
  stage_summary?: {
    track: "greenfield" | "brownfield" | null;
    routeDecided: boolean;
    stages: Array<{ id: string; status: "complete" | "current" | "locked" }>;
  };
}

// FR-SYS-03 provenance — the envelope `meta` fields a source tooltip may
// show. The server's ok() injects `as_of` on every response; the other
// fields appear only where a route actually derives them from the rows it
// returns (per api-spec §9: POST dd-findings links assumption_key/run_id/
// anchor_ref to the assumption registry; series observations set source
// when rows share one source_id). Routes that do not carry provenance in
// meta stay bare, so callers may also merge in per-row provenance columns
// the payload already carries (RagDimension.run_id/assessed_at) — both
// sources are API-sourced, and neither is ever hand-typed.
export interface ProvenanceMeta {
  assumption_key?: string;
  as_of?: string;
  source?: string;
  anchor_ref?: string;
  run_id?: string;
  assessed_at?: string;
}

const PROVENANCE_FIELDS = ["assumption_key", "as_of", "source", "anchor_ref", "run_id", "assessed_at"] as const;

/**
 * Pick only the known provenance fields out of an envelope meta block (or an
 * already-partially-built provenance object). Non-provenance meta entries
 * (count, limit, include_mnpi, ...) never leak into a source tooltip, and
 * absent fields stay absent — the tooltip omits them rather than rendering
 * empty placeholders.
 */
export function provenanceOf(meta: ProvenanceMeta | Record<string, unknown> | undefined): ProvenanceMeta {
  const out: ProvenanceMeta = {};
  if (!meta) return out;
  const record = meta as Record<string, unknown>;
  for (const key of PROVENANCE_FIELDS) {
    const v = record[key];
    if (typeof v === "string" && v.trim() !== "") out[key] = v;
  }
  return out;
}

// GET /api/notifications rows (monitoring.ts). Wave D adds per-recipient
// read_at, so callers can render a true unread count instead of a recent-total.
export interface NotificationRow {
  id: string;
  project_id: string | null;
  trigger_type: string;
  severity: "opportunity" | "warning" | "urgent" | "info" | "ops";
  payload: string;
  channel: string;
  bundle: "immediate" | "daily";
  sent_at: string;
  read_at: string | null;
}

export interface RagDimension {
  dimension: string;
  grade: "green" | "amber" | "red";
  triggered_rules: string;
  rationale: string;
  run_id: string;
  assessed_at: string;
}

export interface GlossaryTermSummary {
  key: string;
  ko: string;
  en: string;
  category: string;
  /** Old/alternate wordings; auto-linked too (min length applies). */
  aliases?: string[];
}

export interface GlossaryTerm extends GlossaryTermSummary {
  definition_ko: string;
  why_it_matters_ko: string;
  related?: string[];
}

export interface ProcedureStep {
  id: number | string;
  gate: string;
  agent_key: string;
  skill_key: string;
  output_type: string;
  _source: "shared" | "region" | "entity";
}

export interface ResolvedProcedure {
  procedureKey: string;
  layersApplied: string[];
  steps: ProcedureStep[];
  thresholds: Record<string, unknown>;
}

export interface AdminUser {
  user_id: string;
  display_name: string | null;
  role: "admin" | "analyst" | "viewer";
  status: string;
  created_at: string;
  approved_at: string | null;
}

export interface AuditLogRow {
  id: string;
  actor_user_id: string;
  action: string;
  target: string;
  created_at: string;
}

export interface DataSourceRow {
  code: string;
  reliability_grade: string | null;
  key_var: string | null;
  key_present: boolean;
  key_source: "process_env" | "root_env" | null;
}

// --- PR #65: Data / Assumptions / DD / Regulatory & Permits tabs ---
// Appended only — no existing exports above this line are touched, per the
// PR #65 boundary (a parallel backend PR may extend ProjectSummary).

export interface SeriesRow {
  series_id: string;
  unit_id: string;
  source_id: string;
  observation_count: number;
  min_period_id: string;
  max_period_id: string;
  last_fetched_at: string | null;
  days_since_fetch: number | null;
  stale: boolean;
}

export interface ObservationRow {
  period_id: string;
  revision_no: number;
  value: number;
  unit_id: string;
  source_id: string;
  fetched_at: string;
}

export interface DataChangeRow {
  id: string;
  series_id: string;
  detected_at: string;
  change_type: string;
  old_value: string | null;
  new_value: string | null;
}

export interface AssumptionRow {
  id: string;
  run_id: string;
  assumption_key: string;
  kind: "live" | "user" | "derived" | "assumed";
  value: number;
  rationale: string | null;
  anchor_ref: string | null;
  as_of: string;
  ttl_days: number | null;
}

export interface RunSummary {
  id: string;
  label: string;
  input_hash: string;
  created_by: string;
  created_at: string;
  superseded_by: string | null;
  input_count: number;
}

export interface DdFindingRow {
  id: string;
  category: string;
  description: string;
  value_impact: number | null;
  assumption_key: string | null;
  evidence_ref: string | null;
  trl_grade: string | null;
  ip_ownership_status: string | null;
  commercialization_path: string | null;
  parent_relationship_json: string | null;
  rbd_source: string | null;
  created_at: string;
}

export interface PermitRow {
  id: string;
  name: string;
  agency: string;
  statutory_days: number | null;
  status: string;
}

export interface PermitDag {
  permit_edges: { from: string; to: string }[];
  permit_critical_path: string[];
  certification_edges: { from: string; to: string }[];
  certification_critical_path: string[];
}

export interface PermitsResponse {
  permits: PermitRow[];
  certifications: PermitRow[];
  dag?: PermitDag;
}

// --- PR #65 batch 2: M&A review tab (antitrust / incentives /
// liabilities / sites / partners / value-chain links) — appended only,
// same boundary as batch 1. ---

export interface AntitrustRow {
  id: string;
  market_definition: string;
  hhi_before: number | null;
  hhi_after: number | null;
  combination_type: string | null;
  filing_jurisdictions: string | null;
  remedy_type: string;
  remedy_detail: string | null;
  discharge_confirmed_at: string | null;
  created_at: string;
}

export interface IncentiveRow {
  id: string;
  site_id: string | null;
  direction: "prospective" | "granted";
  type: string;
  grantor: string | null;
  program_name: string | null;
  amount: number | null;
  npv_value: number | null;
  currency_id: string | null;
  granted_on: string | null;
  application_deadline: string | null;
  construction_deadline: string | null;
  obligation_json: string | null;
  clawback_rule: string | null;
  estimated_clawback: number | null;
  negotiability: string | null;
  status: string;
  evidence_ref: string | null;
}

export interface DebtInstrumentRow {
  id: string;
  lender: string | null;
  principal: number;
  currency_id: string | null;
  rate_type: "fixed" | "floating";
  rate: number;
  maturity: string | null;
  amortization: string | null;
  covenant_json: string | null;
  coc_acceleration: number;
  security: string | null;
  seniority: string | null;
}

export interface ContingentLiabilityRow {
  id: string;
  category: string;
  description: string;
  probability: number | null;
  amount_low: number | null;
  amount_expected: number | null;
  amount_high: number | null;
  distribution: string | null;
  expected_timing_year: number | null;
  evidence_ref: string | null;
  value_impact: number | null;
}

// SQLite INTEGER 0/1 — the server does not coerce to boolean.
export interface CovenantTestRow {
  period_id: string;
  covenant_key: string;
  threshold: number;
  projected_value: number;
  breached: number;
}

export interface LiabilitiesResponse {
  debt_instruments: DebtInstrumentRow[];
  contingent_liabilities: ContingentLiabilityRow[];
  covenant_tests: CovenantTestRow[];
}

export interface SiteRow {
  id: string;
  name: string;
  region_code: string | null;
  infra_score: number | null;
  infra_capex: number | null;
  incentive_npv: number | null;
  logistics_cost: number | null;
  labor_availability: number | null;
  permit_lead_time_days: number | null;
  affected_area_notification_status: string | null;
  total_score: number | null;
  rank: number | null;
}

export interface PartnerRow {
  id: string;
  name: string;
  partner_type: string;
  region_code: string | null;
  capability_score: number | null;
  capacity_score: number | null;
  financial_score: number | null;
  compliance_risk: string | null;
  customer_base_fit: number | null;
  dependency_risk: string | null;
  status: string;
  contacted_at: string | null;
  nda_signed: number;
  evidence_ref: string | null;
}

// management_package — role-based executive comp (FR-MA-06/SEC-05: the
// response carries executive_ref only; the schema has no name field).
export interface ManagementPackageRow {
  id: string;
  executive_ref: string;
  role: string | null;
  base_pay: number | null;
  coc_trigger: string | null;
  coc_payout_estimate: number | null;
  accelerated_vesting: string | null;
  non_compete_months: number | null;
  non_compete_enforceable: string | null;
  flight_risk: string | null;
  value_impact: number | null;
}

// comp_benchmark — aggregate-only pay-parity rows (never individual rows).
export interface CompBenchmarkRow {
  id: string;
  job_family: string;
  grade: string | null;
  headcount: number | null;
  target_median: number | null;
  acquirer_median: number | null;
  gap_pct: number | null;
  annual_cost_delta: number | null;
}

// contract_coc_clause — the customer-attrition validator's structured record
// (ma-07/ma-08, ADR-0072): CoC clauses across customer/supplier contracts
// plus concentration, churn estimate, and competitive-overlap notes.
export interface ContractCocRow {
  id: string;
  counterparty: string;
  direction: string;
  coc_clause_present: number;
  clause_summary: string | null;
  concentration_pct: number | null;
  est_churn_pct: number | null;
  overlap_note: string | null;
  value_impact: number | null;
  evidence_ref: string | null;
  created_at: string;
}

// analysis_task — the human-final-approval gate mechanism (design boundary
// #2: gate approval belongs to humans). reviewed_by stays NULL until a
// human explicitly signs off; no "PASS" happens implicitly.
export interface AnalysisTaskRow {
  id: string;
  project_id: string;
  deliverable_type: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

// review_stage — the 3-stage review pipeline (design §10.1-2): AI 1st ->
// AI 2nd (different domain than the 1st-stage author) -> human final.
export interface ReviewStageRow {
  id: string;
  run_id: string;
  stage: "ai_1st" | "ai_2nd" | "human_final";
  reviewer_agent_or_user: string;
  reviewer_domain: string | null;
  unverified_items_json: string;
  result: string | null;
  created_at: string;
  // Migration 0124 (ADR-0153) — artifact addressing + 3-bucket payload.
  artifact_key?: string | null;
  entity_type?: "project" | "opportunity" | null;
  entity_id?: string | null;
  stage_id?: string | null;
  content_hash?: string | null;
  buckets_json?: string | null;
  author_domain?: string | null;
  model_id?: string | null;
  cost_tokens?: number;
  performed?: number;
  not_performed_reason?: string | null;
  requested_by?: string | null;
  reviewed_refs_json?: string | null;
}

// review_audit_sample — measures the "AI 검토 신뢰도" governance KPI
// (design §6.6): sampled ai_2nd conclusions checked against human_final.
export interface ReviewAuditSampleRow {
  id: string;
  review_stage_id: string;
  sampled_by: string;
  agreed: number;
  note: string | null;
  created_at: string;
}

export interface ValueChainLinkRow {
  id: string;
  direction: "upstream" | "downstream";
  elasticity: number | null;
  lag_months: number | null;
  correlation: number | null;
  r2: number | null;
  pass_through_rate: number | null;
  pass_through_lag_months: number | null;
  concentration_hhi: number | null;
  switching_cost_grade: string | null;
  substitution_threat: string | null;
  evidence_ref: string | null;
  assessed_at: string;
  from_industry_ko: string;
  from_industry_en: string;
  to_industry_ko: string;
  to_industry_en: string;
}

// --- PR #65 batch 4: admin schedule/retention sections (the glossary list
// reuses GlossaryTermSummary above) — appended only. ---

// GET /api/admin/schedule-jobs rows: job registry plus the latest job_run
// per job (null when the job has never run).
export interface ScheduleJobRow {
  id: string;
  job_key: string;
  cron_expr: string;
  enabled: number; // SQLite INTEGER 0/1
  created_at: string;
  last_run: { job_key: string; status: string; finished_at: string | null; error: string | null } | null;
}

// GET /api/admin/retention rows (retention_policy table).
export interface RetentionPolicyRow {
  table_key: string;
  basis: string;
  retention_months: number;
  action: string;
  last_run_at: string | null;
}

// --- PR-3b: portfolio scorecard (E.4) — appended only, same boundary as
// the PR #65 batches: no existing export above this line is touched (a
// parallel backend PR may extend earlier interfaces). ---

export type ScorecardVentureClass = "driving" | "enabling" | "emergent" | "passive" | "jv";
export type ScorecardSection = "financial" | "strategic";
export type ScorecardStatus = "on_target" | "deviation" | "insufficient_evidence";

// GET /api/portfolio-scorecard data rows: one measure per venture per
// review cycle, split into financial / strategic sections.
export interface PortfolioScorecardRow {
  id: string;
  run_id: string;
  project_id: string;
  project_no: string;
  source_procedure: string;
  review_cycle: string;
  venture_class: ScorecardVentureClass;
  section: ScorecardSection;
  measure_key: string;
  target_value: string | null;
  actual_value: string | null;
  status: ScorecardStatus;
  evidence_ref: string;
  observed_at: string;
  created_at: string;
}

export interface ScorecardClassRollup {
  venture_class: ScorecardVentureClass;
  ventures: number;
  measures: number;
  on_target: number;
  deviation: number;
  insufficient_evidence: number;
}

export interface ScorecardInsufficientEvidence {
  project_id: string;
  section: ScorecardSection;
  measure_key: string;
}

export interface PortfolioScorecard {
  review_cycle: string | null;
  resolved_from: "explicit" | "latest";
  financial: PortfolioScorecardRow[];
  strategic: PortfolioScorecardRow[];
  class_rollup: ScorecardClassRollup[];
  insufficient_evidence: ScorecardInsufficientEvidence[];
  provenance: { runs: string[]; review_cycles_available: string[] };
}

export interface PortfolioScorecardMeta {
  scope: "membership-filtered";
  projects_visible: number;
  projects_with_rows_total: number;
  scope_incomplete: boolean;
  projects_excluded: number;
  review_cycle: string | null;
  review_cycles_available: string[];
  as_of?: string; // additive: the server's ok() injects as_of on every response
}

// Narrow the envelope's Record<string, unknown> meta into the typed
// PortfolioScorecardMeta using the same defensive typeof guards the tabs
// apply to as_of/seed/iterations — a malformed or absent field degrades to
// its empty value instead of crashing the page.
function toScorecardMeta(meta: Record<string, unknown>): PortfolioScorecardMeta {
  const cycles = Array.isArray(meta.review_cycles_available)
    ? meta.review_cycles_available.filter((c): c is string => typeof c === "string")
    : [];
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    scope: "membership-filtered",
    projects_visible: num(meta.projects_visible),
    projects_with_rows_total: num(meta.projects_with_rows_total),
    scope_incomplete: meta.scope_incomplete === true,
    projects_excluded: num(meta.projects_excluded),
    review_cycle: typeof meta.review_cycle === "string" ? meta.review_cycle : null,
    review_cycles_available: cycles,
    as_of: typeof meta.as_of === "string" ? meta.as_of : undefined,
  };
}

// GET /api/portfolio-scorecard?review_cycle=YYYY-Qn — omit reviewCycle for
// the latest recorded cycle (response carries resolved_from: "latest").
export async function getPortfolioScorecard(
  reviewCycle?: string,
): Promise<{ data: PortfolioScorecard; meta: PortfolioScorecardMeta }> {
  const path =
    reviewCycle !== undefined && reviewCycle !== ""
      ? `/api/portfolio-scorecard?review_cycle=${encodeURIComponent(reviewCycle)}`
      : "/api/portfolio-scorecard";
  const res = await api.get<PortfolioScorecard>(path);
  return { data: res.data, meta: toScorecardMeta(res.meta) };
}

// ── ADR-0063 Class C evidence surfaces (PMI / deal-shape / deadlines) ──
// Money fields are INTEGER KRW millions (ADR-0061); run_rate_bp is basis
// points of committed cost-synergy run-rate.


// ── ADR-0066 value-chain scenario simulation (Phase A/C surfaces) ──

export interface ChainLayer {
  layer: number;
  industryIds: string[];
}

export interface ChainLinkLite {
  id: string;
  from_industry_id: string;
  to_industry_id: string;
  direction: "upstream" | "downstream";
  elasticity: number | null;
  pass_through_rate: number | null;
}


