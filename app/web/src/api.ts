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

async function request<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
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
  // Client-gated card enrichment: GET /api/projects returns only
  // id/project_no/created_at today, so the RAG and staleness badges render
  // only if a future list payload carries these fields — never a fabricated
  // default grade on the card.
  rag_overall?: "green" | "amber" | "red";
  rag_assessed_at?: string;
  stale?: boolean;
}

// FR-SYS-03 provenance — the envelope `meta` fields a source tooltip may
// show. The server's ok() injects `as_of` on every response; the other
// fields appear only where a route actually carries them (e.g.
// /api/projects/:id/rag adds `assessed_at`). No route populates
// assumption_key/source/anchor_ref in meta yet, so callers may also merge
// in per-row provenance columns the payload already carries
// (RagDimension.run_id/assessed_at) — both sources are API-sourced, and
// neither is ever hand-typed.
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
