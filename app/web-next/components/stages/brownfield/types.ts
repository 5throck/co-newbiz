// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.

export interface OppRow {
  id: string; name: string; market_scope: string | null; synergy_score: number | null;
  track: string | null; sub_track: string | null; target_count: number; shortlist_count: number;
}
export interface ChecklistItem { id: string; text: string; mandatory: boolean; waiver_eligible: boolean }
export interface TargetRow {
  id: string; opportunity_id: string; company_name: string; dart_corp_code: string | null;
  universe_note: string | null; status: "pending" | "shortlisted" | "excluded";
  rank: number | null; exclusion_reason: string | null; screening_json: string | null;
  company_id: string | null;
  screening_summary?: { assessed: number; total: number; knockOutsPassed: boolean; anyKnockOutFail: boolean; mandatoryOpen: string[] };
  // 재무·기술 평가(ADR-0139) 기반 랭킹 점수 — 서버가 계산해 붙여준다.
  // 위원회 심의(9개 항목)와 역할을 분리한다(사용자 요청, 2026-09-15).
  eval_summary?: { financial: { score: number | null }; technical: { score: number | null }; combined: number | null; complete?: boolean };
}
// 재무 참고 패널 — GET /api/companies/[companyId]/financials 응답의 필요한 부분만.
export interface FinancialsResp {
  financials: unknown[];
  analysis: {
    years: string[];
    series: Array<{ key: string; label: string; points: Array<{ year: string; value: number | null }> }>;
    ratios: Array<{ year: string; revenueGrowth?: number | null; operatingMargin?: number | null; netMargin?: number | null; debtRatio?: number | null }>;
  };
}
export interface OppDetail {
  opportunity: { id: string; name: string };
  universe?: { definition: string; criteria?: string[]; scope?: string | null; min_long_list?: number } | null;
  checklist: ChecklistItem[];
  targets: TargetRow[];
}

// ── ADR-0118 제안 표면 (B: 웹검색 후보 · D: 유니버스 기준 · E: 판정 초안) ──
export interface WebSuggestion {
  company_name: string;
  dart_corp_code?: string | null;
  rationale: string;
  sources: Array<{ title: string; url: string; snippet: string }>;
  reliability: "A" | "B" | "C";
}
export interface WebProposalResponse {
  source: "llm" | "llm_knowledge" | "synthesis";
  provider: string;
  note: string | null;
  query_count: number;
  suggestions: WebSuggestion[];
}
export interface UniCriteria {
  industry: string;
  region: string;
  size: string;
  rationale: string;
}
export interface UniRecoResponse {
  source: "llm" | "synthesis";
  provider: string;
  note: string | null;
  criteria: UniCriteria | null;
  manifest: string[];
}
// 사전 검토 판정 초안(웹 검색 + 기확보 근거) — screening-draft 라우트 응답.
export interface ScreeningItemDraft {
  verdict: "pass" | "fail" | "na" | "waived";
  rationale: string;
  source_url: string | null;
  kind?: "secured" | "web";
}
export interface ScreeningDraftResponse {
  source: "llm" | "synthesis";
  provider: string;
  note: string | null;
  drafts: Record<string, ScreeningItemDraft>;
  manifest: string[];
}
// 사전 검토 인라인 판정 1건 — 판정값과 수집 근거(사유·출처·구분)를 함께 보관.
// 저장 시 evidence로 함께 보내 후보 상세 참고 저장소에 적립된다.
export interface PrecheckDraftItem { verdict: string; rationale?: string; source_url?: string | null; kind?: string }
// S7 재무·기술 평가 (ADR-0139) — 대상 사전 검토 체크리스트과 병행하는 별도 레이어.
// 항목별 weight(가중치)로 카테고리(재무/기술)마다 별도 100점 점수를 낸다 —
// 두 영역을 합치지 않는다(사용자 요구, 2026-09-15).
export interface EvalItem {
  id: string; category: "financial" | "technical"; source: "builtin" | "seeded" | "custom";
  label: string; description: string | null; is_mandatory: 0 | 1; is_deletable: 0 | 1; weight: number;
  state: { status: "pending" | "pass" | "partial" | "fail" | "na" | "waived"; note: string | null } | null;
}
export interface EvalCategoryScore { score: number | null; scoredWeight: number; totalWeight: number; excludedWeight: number }


  export interface Suggestion { id: string; name_ko: string; dart_corp_code: string | null }
