// API client — docs/api-spec.md §9's response envelope, consumed everywhere.
// The SPA never talks to the DB directly (ui-spec §7); this is the one file
// that knows the fetch/cookie/error-shape details so every page component
// only sees typed data.

export interface Envelope<T> {
  data: T;
  meta: Record<string, unknown>;
  error: { code: string; message: string } | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Read a cookie by name from document.cookie (for the CSRF double-submit pattern). */
function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function request<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init?.headers as Record<string, string>) };
  const method = init?.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    // Double-submit CSRF: echo the readable csrf cookie in a custom header.
    const csrf = readCookie("co_newbiz_csrf");
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  const res = await fetch(path, {
    credentials: "include",
    headers,
    ...init,
  });
  const body = (await res.json()) as Envelope<T>;
  if (!res.ok) {
    throw new ApiError(res.status, body.error?.code ?? "unknown_error", body.error?.message ?? "Request failed.");
  }
  return body;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
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

// GET /api/notifications rows (monitoring.ts). The notification table has no
// read/unread state — sent_at is the only lifecycle timestamp — so any UI
// count derived from this is a recent-total, never an unread count.
export interface NotificationRow {
  project_id: string;
  trigger_type: string;
  severity: "opportunity" | "warning" | "urgent" | "info" | "ops";
  payload: string;
  channel: string;
  bundle: "immediate" | "daily";
  sent_at: string;
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
}

export interface GlossaryTerm extends GlossaryTermSummary {
  definition_ko: string;
  why_it_matters_ko: string;
  aliases?: string[];
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
  reliability_grade: string;
  key_var: string;
  key_present: boolean;
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

// --- PR #65 batch 3: Model / Simulation / Version-comparison tabs
// (engine-1 run versioning + engine-2 simulations) — appended only. ---

// POST /api/projects/:id/runs response (db/lib/versioning.ts
// CreateRunResult) — only the fields this UI reads are typed.
export interface CreateRunResult {
  run_id: string;
  input_hash: string;
}

// GET /api/runs/:id — run row plus its immutable run_input snapshot.
export interface RunInputRow {
  assumption_key: string;
  value: number;
}

export interface RunDetail {
  run: RunSummary & { project_id: string };
  inputs: RunInputRow[];
}

// GET /api/runs/:id/diff/:otherId — variable-level bridge, A -> B
// (added = only in B, removed = only in A, changed delta = to - from).
export interface DiffChangedRow {
  key: string;
  from: number;
  to: number;
  delta: number;
}

export interface DiffValueRow {
  key: string;
  value: number;
}

export interface RunDiff {
  run_a: string;
  run_b: string;
  input_hash_a: string;
  input_hash_b: string;
  changed: DiffChangedRow[];
  added: DiffValueRow[];
  removed: DiffValueRow[];
}

// POST /api/simulations response (db/lib/simulation.ts SimulationRunResult).
export interface SimulationRunResult {
  simulation_id: string;
  run_id: string;
  project_id: string;
  seed: number;
  iterations: number;
  discount_rate: number;
  base_npv: number;
  p05: number;
  p50: number;
  p95: number;
  mean: number;
  std: number;
  contingent_liability_count: number;
  irr?: number;
  payback_year?: number;
}

// GET /api/simulations/:id/results — quantile summary ONLY; raw draws are
// never exposed (retention_policy archives them, the permanent record is
// this summary). meta carries seed + iterations.
export interface SimulationSummary {
  id: string;
  run_id: string;
  seed: number;
  iterations: number;
  discount_rate: number;
  created_at: string;
}

export interface SimulationResultRow {
  metric: string;
  p05: number;
  p50: number;
  p95: number;
  mean: number;
  std: number;
}

// Server-side aggregate over the persisted simulation_draw rows (simulation.ts
// 1.1.0). Raw draw rows are never exposed — the API serves this histogram/CDF
// reduction instead; null for simulations that predate draw persistence.
export interface SimulationDistribution {
  metric: string;
  draws: number;
  bins: { start: number; end: number; count: number }[];
  cdf: { value: number; p: number }[];
}

export interface SimulationResultsResponse {
  simulation: SimulationSummary;
  results: SimulationResultRow[];
  distribution: SimulationDistribution | null;
  /** A2 input snapshot — the run's sim.* inputs consumed by this simulation. */
  inputs?: Array<{ assumption_key: string; value: number }>;
  contingent_liability_count?: number;
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

export interface KeyTalentRow {
  id: string;
  role_ref: string;
  status: "active" | "departed_regretted" | "departed_planned";
  exit_date: string | null;
  locked_at: string;
}

export interface SynergyCertificationRow {
  id: string;
  run_rate_bp: number;
  sustained_quarters: number;
  certified_by: string;
  baseline_locked_at: string;
  signed_at: string;
}

export interface DealShapeEvaluationRow {
  id: string;
  shape: string;
  intent: "integration" | "capability_access";
  viable: number;
  evaluated_by: string;
  evaluated_at: string;
}

export interface IncentiveDeadlineRow {
  id: string;
  incentive_ref: string;
  deadline: string;
  source: string | null;
  created_at: string;
}

export interface DimensionInputRow {
  id: string;
  run_id: string;
  var_key: string;
  value_kind: "num" | "text" | "bool";
  value_text: string | null;
  value_num: number | null;
  unit: string | null;
  evidence_ref: string;
  asserted_by: string;
  reviewed_by: string | null;
  rationale: string;
  observed_at: string;
}

export interface DimensionInputsMeta {
  count: number;
  reviewed: number;
}

export const pmiApi = {
  keyTalent: (projectId: string) => api.get<KeyTalentRow[]>(`/api/projects/${encodeURIComponent(projectId)}/pmi/key-talent`),
  addKeyTalent: (
    projectId: string,
    body: { role_ref: string; status?: KeyTalentRow["status"]; exit_date?: string | null; locked_at: string },
  ) => api.post<KeyTalentRow>(`/api/projects/${encodeURIComponent(projectId)}/pmi/key-talent`, body),
  synergyCertifications: (projectId: string) =>
    api.get<SynergyCertificationRow[]>(`/api/projects/${encodeURIComponent(projectId)}/pmi/synergy-certifications`),
  addSynergyCertification: (
    projectId: string,
    body: { run_rate_bp: number; sustained_quarters: number; certified_by: string; baseline_locked_at: string; signed_at: string },
  ) => api.post<SynergyCertificationRow>(`/api/projects/${encodeURIComponent(projectId)}/pmi/synergy-certifications`, body),
  dealShapeEvaluations: (projectId: string) =>
    api.get<DealShapeEvaluationRow[]>(`/api/projects/${encodeURIComponent(projectId)}/deal-shape-evaluations`),
  addDealShapeEvaluation: (
    projectId: string,
    body: { shape: string; intent: "integration" | "capability_access"; viable: boolean; evaluated_at?: string },
  ) => api.post<DealShapeEvaluationRow>(`/api/projects/${encodeURIComponent(projectId)}/deal-shape-evaluations`, body),
  incentiveDeadlines: (projectId: string) =>
    api.get<IncentiveDeadlineRow[]>(`/api/projects/${encodeURIComponent(projectId)}/incentive-deadlines`),
  addIncentiveDeadline: (projectId: string, body: { incentive_ref: string; deadline: string; source?: string }) =>
    api.post<IncentiveDeadlineRow>(`/api/projects/${encodeURIComponent(projectId)}/incentive-deadlines`, body),
  dimensionInputs: (projectId: string, varKey?: string) =>
    api.get<DimensionInputRow[]>(
      `/api/projects/${encodeURIComponent(projectId)}/dimension-inputs${varKey ? `?var_key=${encodeURIComponent(varKey)}` : ""}`,
    ),
  assertDimensionInput: (
    projectId: string,
    body: { run_id: string; var_key: string; value: { kind: "num" | "text" | "bool"; value: unknown }; evidence_ref: string; rationale: string },
  ) => api.post<{ id: string }>(`/api/projects/${encodeURIComponent(projectId)}/dimension-inputs`, body),
  reviewDimensionInput: (projectId: string, rowId: string) =>
    api.post<{ id: string; reviewed_by: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/dimension-inputs/${encodeURIComponent(rowId)}/review`,
    ),
};
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

export interface ChainTopologyResponse {
  layers: ChainLayer[];
  links: ChainLinkLite[];
  nodeCount: number;
}

export interface StageFinancialRow {
  fiscal_year: number;
  metric_key: string;
  value: number;
}

export interface StructureSimQuantileRow {
  run_id: string;
  scenario: string;
  industry_id: string;
  metric: string;
  p05: number;
  p50: number;
  p95: number;
  created_at: string;
  region_code: string | null;
  segment_code: string | null;
}

export interface RunSummaryRow {
  id: string;
  label: string | null;
  created_at: string;
}

export const marketApi = {
  topology: (projectId: string) =>
    api.get<ChainTopologyResponse>(`/api/projects/${encodeURIComponent(projectId)}/value-chain/topology`),
  stageFinancials: (projectId: string, industryId: string, years = 5) =>
    api.get<StageFinancialRow[]>(
      `/api/projects/${encodeURIComponent(projectId)}/industries/${encodeURIComponent(industryId)}/financials?years=${years}`,
    ),
  importFinancials: (
    projectId: string,
    body: { industry_id: string; source?: string; rows: Array<{ fiscal_year: number; metric_key: string; value: number }> },
  ) => api.post<{ imported: number }>(`/api/projects/${encodeURIComponent(projectId)}/financial-imports`, body),
  runs: (projectId: string) => api.get<RunSummaryRow[]>(`/api/projects/${encodeURIComponent(projectId)}/runs`),
  runStructureSimulation: (
    projectId: string,
    body: { run_id: string; seed?: number; iterations?: number; scenario?: "downside" | "base" | "upside" | "custom" },
  ) => api.post<unknown>(`/api/projects/${encodeURIComponent(projectId)}/structure-simulations`, body),
  structureResults: (projectId: string, runId?: string) =>
    api.get<StructureSimQuantileRow[]>(`/api/projects/${encodeURIComponent(projectId)}/structure-simulations${runId ? `?run_id=${encodeURIComponent(runId)}` : ""}`),
  screeningLonglist: (projectId: string) =>
    api.get<Array<{ id: string; candidate_name: string; knock_out_passed: number; notes: string | null; created_at: string }>>(
      `/api/projects/${encodeURIComponent(projectId)}/screening-longlist`,
    ),
  addScreeningLonglistEntry: (projectId: string, body: { candidate_name: string; knock_out_passed: boolean; notes?: string }) =>
    api.post<{ id: string }>(`/api/projects/${encodeURIComponent(projectId)}/screening-longlist`, body),
  partnerDDFindings: (projectId: string) =>
    api.get<Array<{ id: string; partner_id: string; workstream: string; severity: string; description: string; created_at: string }>>(
      `/api/projects/${encodeURIComponent(projectId)}/partner-dd-findings`,
    ),
  addPartnerDDFinding: (
    projectId: string,
    body: { partner_id: string; workstream: string; severity: string; description: string },
  ) => api.post<{ id: string }>(`/api/projects/${encodeURIComponent(projectId)}/partner-dd-findings`, body),
  chainSensitivities: (projectId: string, industryId?: string) =>
    api.get<Array<{ id: string; industry_id: string; driver_code: string; sensitivity: number; lag_months: number; region_code: string | null; segment_code: string | null }>>(
      `/api/projects/${encodeURIComponent(projectId)}/chain-sensitivities${industryId ? `?industry_id=${encodeURIComponent(industryId)}` : ""}`,
    ),
  upsertChainSensitivity: (
    projectId: string,
    body: { industry_id: string; driver_code: string; sensitivity: number; lag_months?: number; region_code?: string; segment_code?: string },
  ) => api.post<{ id: string }>(`/api/projects/${encodeURIComponent(projectId)}/chain-sensitivities`, body),
};
