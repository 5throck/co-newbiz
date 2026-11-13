// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import type { SizingMatrix } from "../../../lib/market-sizing.ts";

export interface AnalysisInfo {
  id: string;
  status: "in_progress" | "completed" | "failed" | "pending";
  current_step: number;
  latest_version: number | null;
  created_at: string;
  completed_at: string | null;
  error_message?: string | null;
  after_analysis_id?: string | null;
  linked_relation?: string | null;
  // ADR-0131 — 완료된 분석의 재분석이 진행 중이면 status는 여전히 'completed'로
  // 이전 버전을 가리킨 채 이 플래그만 1이 된다(재분석 성공 시에만 status/
  // completed_at이 새 버전으로 "교체"된다 — 조용한 데이터 훼손 방지).
  rerun_in_progress?: number;
  // ADR-0131 후속 — 최신 완료 버전의 stepSummaries 소스를 서버가 미리 집계한
  // 값. all_synthesis: 전 단계 결정론 합성(수치 신뢰 불가) — partial_synthesis:
  // 일부 단계만 합성(대개 정성/규제 등 텍스트 섹션, 수치는 대부분 정상일 수
  // 있으나 확인 필요) — null: 완전히 LLM 산출이거나 완료 버전 없음.
  data_quality?: "all_synthesis" | "partial_synthesis" | null;
}
export interface IndustryRow {
  id: string;
  name_ko: string;
  name_en: string | null;
  ksic_code: string | null;
  driver_count: number;
  analysis: AnalysisInfo | null;
  pinned?: number;
}
export interface DriverRow {
  id: string;
  code: string;
  label_ko: string;
  description: string;
}
export interface IndustryLink {
  from_industry_id: string;
  to_industry_id: string;
  relation: string;
}
export interface MarketOverview {
  industries: IndustryRow[];
  drivers: DriverRow[];
  industryLinks?: IndustryLink[];
  stats: { value_chain_links: number; proxy_links: number; series_count: number; observation_count: number };
}
export interface DriverSensitivity {
  driver_label: string;
  sensitivity: number;
  lag_months: number | null;
  region_code: string | null;
  segment_code: string | null;
}
export interface AssumptionRow {
  assumption_key: string;
  kind: string;
  value: number;
  rationale: string | null;
  anchor_ref: string | null;
  as_of: string;
  ttl_days: number | null;
}
export interface VersionInfo {
  version_no: number;
  changelog: string | null;
  created_by: string;
  created_at: string;
}
export interface ChainLink {
  id: string;
  hop_type: "engineering" | "statistical" | "structural";
  coefficient: number | null;
  beta: number | null;
  r2: number | null;
  lag_months: number | null;
  evidence_ref: string;
  industry_id: string;
  name_ko: string;
  direction: "upstream" | "downstream";
  relation: string | null;
  hop_distance: number | null;
  source: string;
  status: string;
}
export interface ChainProposal {
  industry_id: string;
  name_ko: string;
  relation: string;
  note: string | null;
}
export interface LinkableIndustry {
  id: string;
  name_ko: string;
}
export interface IndustryDetail {
  industry: { id: string; name_ko: string; name_en: string | null; ksic_code: string | null };
  chain: {
    links: ChainLink[];
    legacyUntagged: ChainLink[];
    grade: { reliability_grade: string; grade_rationale: string } | null;
  };
  proposals?: ChainProposal[];
  unmatchedProposals?: Array<{ name: string; relation: string; note: string | null }>;
  linkableIndustries?: LinkableIndustry[];
  driver_sensitivities: DriverSensitivity[];
  sizing: { run_id: string; run_label: string; assumptions: AssumptionRow[] } | null;
  versions: VersionInfo[];
}
export interface AnalysisDetail {
  id: string;
  status: "in_progress" | "completed";
  current_step: number;
  name_ko: string;
  versions: Array<{
    version_no: number;
    payload: {
      matrix?: SizingMatrix;
      stepSummaries?: Array<{ step: number; summary: string; source: string; pendingInputs: string[] }>;
    } | null;
    changelog: string | null;
    created_by: string;
    created_at: string;
    data_confidence_grade?: string | null;
    confidence_basis?: string | null;
  }>;
}
export interface LlmStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
}
export interface KsicEntryView {
  code: string;
  name_ko: string;
  detail: string | null;
  profile: boolean;
  matched_by?: "alias" | "name";
  alias?: string;
}

// 산업 간 가치사슬 관계도 — 큐레이션된 수요 산업 연계(전방/전전방/후방/후후방,
// ADR-0129)를 SVG로 시각화한다. 레이어(서버가 Kahn 레이어링으로 계산)를
// 가로축, 같은 레이어 안에서는 세로로 노드를 배치하고 화살표로 방향을 그린다.
export interface ChainGraphNode {
  id: string;
  name_ko: string;
  analyzed: boolean;
  layer: number;
}
export interface ChainGraphEdge {
  from: string;
  to: string;
  relation: string;
  hopDistance: number | null;
}

// Calibration panel row payloads (design 2026-09-18-s1-growth-gap-calibration;
// GET /api/market-overview/industry/[id]/calibration). Moved out of
// CalibrationPanel.tsx (addendum 2026-11-12b) to keep the component under the
// 400-line decomposition cap.
export interface CalibrationProposalRow {
  id: string;
  driver: string;
  direction: "upside" | "downside";
  impact_pct: number;
  rationale: string;
  /** GET 라우트가 proposed_by 마커를 번역해 내려보내는 행 종류 플래그 —
   *  true면 드라이버 제외 제안(기각 확정 = 제외 확정, 수용 버튼 없음,
   *  amendment 2026-11-13b). */
  is_exclusion?: boolean;
}
export interface CalibrationAcceptedRow {
  id: string;
  driver: string;
  direction: "upside" | "downside";
  impact_pct: number;
}
export interface CalibrationTrendRow {
  version_no: number;
  created_at: string;
  gap_pct: number;
  our_cagr_pct: number | null;
  external_cagr_pct: number | null;
  triggered: boolean;
}
export interface CalibrationReferenceRow {
  id: string;
  superseded_at: string | null;
  superseded_by: string | null;
  source_label: string;
  source_url: string | null;
  target_year: number;
  external_cagr_pct: number;
  external_size_b: number | null;
  captured_from: string;
}
export interface CalibrationEscalationRow {
  id: string;
  base_our_cagr_pct: number;
  external_cagr_pct: number;
  scaled_cagr_pct: number;
  residual_gap_pct: number;
  rationale: string;
  decided_by: string;
  created_at: string;
}
