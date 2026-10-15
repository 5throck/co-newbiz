// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition); behavior unchanged.

export interface TargetDetail {
  id: string; opportunity_id: string; company_name: string; dart_corp_code: string | null;
  universe_note: string | null; status: "pending" | "shortlisted" | "excluded";
  rank: number | null; exclusion_reason: string | null; screening_json: string | null;
  screening_evidence_json: string | null;
  company_id: string | null;
}
export interface EvalItem {
  id: string; category: "financial" | "technical"; source: "builtin" | "seeded" | "custom";
  label: string; description: string | null; is_mandatory: 0 | 1; is_deletable: 0 | 1; weight: number;
  data_ref: string | null; rubric_json: string | null;
  state: { status: "pending" | "pass" | "partial" | "fail" | "na" | "waived"; note: string | null } | null;
}
// 재무 평가 자동 초안(ADR-0140) — 서버가 만든 제안. 클라이언트 상태로만
// 존재하고 확인·수정 후 기존 판정 저장(PUT eval-state)으로 확정된다.
export interface EvalDraftItem {
  criterion_id: string; label: string; data_ref: string;
  status: "pass" | "partial" | "fail" | null; reason: string | null;
  metrics: Array<{ label: string; value: string }>; note: string;
}
export interface EvalDraftResp { source: string; years: string[]; latest_sync_at: string | null; drafts: EvalDraftItem[]; note: string }
export interface EvalCategoryScore { score: number | null; scoredWeight: number; totalWeight: number; excludedWeight: number }
// 사전 검토(대상 사전 검토 체크리스트) 근거 — 위원회 추천 검토·등록·재분석에서
// 수집된 "나중에 참고할" 정보(사용자 결정, 2026-09-16). 이 화면은 읽기 전용
// 저장소다 — 판정 기록은 /brownfield 최종 후보 목록 "사전 검토" 섹션에서 한다.
export interface ScreeningItem { id: string; text: string; mandatory: boolean; waiver_eligible: boolean }
export interface ScreeningSummary { assessed: number; total: number; knockOutsPassed: boolean; anyKnockOutFail: boolean; mandatoryOpen: string[] }
export interface ScreeningItemEvidence { verdict?: string; rationale?: string; source_url?: string | null; kind?: string }
export interface EvidenceRow {
  id: string; kind: string; title: string; detail: string | null;
  source_url: string | null; source_kind: string | null; created_by: string | null; created_at: string;
}
// ADR-0171 D6: S3 rows vs the seeded technical criteria (read-only detection; reconcile is an explicit action).
export interface ReconcilePlan {
  missing: Array<{ rowId: string; capability: string }>;
  retire: Array<{ criterionId: string; label: string; seedRef: string; assessedTargets: number }>;
  relabel: Array<{ criterionId: string; from: string; to: string }>;
  reinstate: Array<{ criterionId: string; label: string }>;
  inSync: boolean;
}
export interface DetailResponse {
  target: TargetDetail;
  opportunity: { id: string; name: string; market_scope: string | null };
  evalItems: EvalItem[];
  scores: Record<"financial" | "technical", EvalCategoryScore> & { combined: number | null };
  checklist: ScreeningItem[];
  screening_summary: ScreeningSummary;
  evidence: EvidenceRow[];
  reconcile?: ReconcilePlan;
}
export interface FinancialsResp {
  latest_sync_at: string | null;
  analysis: {
    years: string[];
    series: Array<{ key: string; label: string; points: Array<{ year: string; value: number | null }> }>;
    ratios: Array<{ year: string; operatingMargin?: number | null; netMargin?: number | null; debtRatio?: number | null }>;
  };
}
export interface DisclosureRow { rcept_no: string; report_nm: string; rcept_dt: string; viewer_url: string | null }
export interface DisclosuresResp {
  dart_linked: boolean;
  presets: Array<{ key: string; label: string }>;
  error: string | null;
  disclosures: DisclosureRow[];
}
// 회사 AI 프로파일 — 그룹/계열사 프로파일과 동일한 파이프라인 재사용(일반화,
// 2026-09-15). 전체 필드는 company-profile-pipeline.ts CompanyProfilePayload
// 참조 — 화면에서 쓰는 필드만 좁혀 선언한다.
export interface CompanyProfile {
  companyName: string;
  strengths: string[];
  weaknesses: string[];
  businessAssessment: string;
  industryExposure: string[];
  degraded?: string | null;
  researchSources: Array<{ title: string; url: string; snippet?: string }>;
  dataSources: { dart: boolean; dartYear: string | null; webResearchCount: number };
  swot?: { opportunities: string[]; threats: string[] };
  competitive?: { competitors: Array<{ name: string; note: string }>; positioning: string; degraded?: string | null };
  ragCapRecommendation?: { grade: "green" | "amber" | "red"; rationale: string };
  // DART 원계정 상세(자산총계·영업이익 등 전 계정 × 연도) — AI 분석 파이프라인
  // 1단계에서 이미 입수된 데이터를 재무 탭의 그래프·표에 재사용한다.
  dartFinancials?: {
    available?: boolean;
    year?: string;
    items?: Array<{ name: string; value: number; year?: string }>;
    reportUrl?: string;
    error?: string;
  };
}
export interface CompanyProfileResp {
  profile: CompanyProfile | null;
  status: "completed" | "in_progress" | "failed" | "not_started";
  error?: string;
}