// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.

import type {
  CriteriaProjection,
  DirectionCounts,
  DirectionDrafted,
  DirectionOrigin,
  DirField,
  DirItem,
  EvidenceView,
  Grade,
  StoredDirection,
  SupportSegment,
  UniverseDirectionView,
} from "../../../lib/universe-direction.ts";

// The direction-review types live in lib/universe-direction.ts; re-exported here for the stage components.
export type {
  CriteriaProjection,
  DirectionCounts,
  DirectionDrafted,
  DirectionOrigin,
  DirField,
  DirItem,
  EvidenceView,
  Grade,
  StoredDirection,
  SupportSegment,
  UniverseDirectionView,
};

export interface OppRow {
  id: string;
  name: string;
  market_scope: string | null;
  synergy_score: number | null;
  track: string | null;
  sub_track: string | null;
  target_count: number;
  shortlist_count: number;
}
export interface ChecklistItem {
  id: string;
  text: string;
  mandatory: boolean;
  waiver_eligible: boolean;
}
/** One category of `eval_summary`: the live score, judged weight coverage, and the verdict-origin split (ADR-0200). */
export interface EvalSummaryCategory {
  score: number | null;
  scoredWeight?: number;
  totalWeight?: number;
  excludedWeight?: number;
  /** Judged items over all non-excluded items (shown as n/m). */
  judgedCount?: number;
  totalCount?: number;
  /** Judged weight by verdict origin (sums to scoredWeight). */
  judged_by_source?: { human: number; auto_rule: number; ai_draft: number };
  /** Non-pending, non-human verdicts in this category. */
  unreviewed?: number;
}

export interface TargetRow {
  id: string;
  opportunity_id: string;
  company_name: string;
  dart_corp_code: string | null;
  universe_note: string | null;
  status: "pending" | "shortlisted" | "excluded";
  rank: number | null;
  exclusion_reason: string | null;
  screening_json: string | null;
  company_id: string | null;
  screening_summary?: {
    assessed: number;
    total: number;
    knockOutsPassed: boolean;
    anyKnockOutFail: boolean;
    mandatoryOpen: string[];
  };
  // design 2026-11-21-s67-completion-visibility §API C — longListCandidateGaps
  // output verbatim ([] = qualified; [] for every row when grandfathered).
  // Optional: an older cached payload without the field reads as "unknown", not
  // as qualified (chips and the coverage fraction just don't render for it).
  gaps?: Array<"attributes" | "source">;
  // 재무·기술 평가(ADR-0139) 기반 랭킹 점수 — 서버가 계산해 붙여준다.
  // 위원회 심의(9개 항목)와 역할을 분리한다(사용자 요청, 2026-09-15).
  eval_summary?: {
    financial: EvalSummaryCategory;
    technical: EvalSummaryCategory;
    combined: number | null;
    complete?: boolean;
    // ADR-0200 §5.1: non-pending, non-human verdicts across both categories (AI / rule verdicts nobody reviewed yet).
    unreviewed_total?: number;
  };
  // ADR-0200 §8 A8 — version history + run state only (no provisional score: verdicts are applied directly).
  eval_draft?: import("./aiEvalTypes.ts").EvalDraftView;
}
// 재무 참고 패널 — GET /api/companies/[companyId]/financials 응답의 필요한 부분만.
export interface FinancialsResp {
  financials: unknown[];
  analysis: {
    years: string[];
    series: Array<{ key: string; label: string; points: Array<{ year: string; value: number | null }> }>;
    ratios: Array<{
      year: string;
      revenueGrowth?: number | null;
      operatingMargin?: number | null;
      netMargin?: number | null;
      debtRatio?: number | null;
    }>;
  };
}
export interface OppDetail {
  opportunity: { id: string; name: string };
  universe?: {
    definition: string;
    criteria?: string[];
    scope?: string | null;
    financial_criteria?: string | null;
    min_long_list?: number;
    // Direction review (design 2026-11-17 §5.4) — additive keys; legacy records omit them.
    direction_version?: 1;
    direction?: StoredDirection | null;
    evidence?: EvidenceView[];
    origin?: DirectionOrigin;
    drafted?: DirectionDrafted;
  } | null;
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
  // design 2026-11-13-proposal-ignore-suppression §3.5 — 무시 1회 칩 페이로드.
  // 키별 무시 이벤트가 정확히 1건일 때만 1로 온다(0은 필드 없음, 2 이상은
  // 서버가 억제해 응답에 도달하지 않는다). Additive — 구버전 응답도 그대로 소비.
  ignore_count?: number;
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
  // 수익성·지속가능성 조건 (DEC-20261111-05) — 근거가 없으면 `검증 필요` +
  // 필요 데이터 명시(honest unset), 빈 문자열은 미확정으로 렌더링한다.
  viability: string;
  rationale: string;
}
// 초안 봉투의 근원 정보 (DEC-20261111-05, design §4.4) — 선택적 필드로 추가되어
// 구버전 응답(필드 없음)도 그대로 소비된다.
export interface UniRecoProvenance {
  s1: {
    resolution: "pinned" | "industry_fk" | "name_fallback" | "unset";
    version_id: string | null;
    version_no: number | null;
    data_confidence_grade: string | null;
    anchor_total_b: number | null;
  };
  chain_financials: "present" | "absent";
}
export interface UniRecoResponse {
  source: "llm" | "synthesis";
  provider: string;
  note: string | null;
  criteria: UniCriteria | null;
  /** Validated evaluation-target direction (design 2026-11-17); null on no-grounding or parse failure. */
  draft?: UniverseDirectionView | null;
  /** Emptied fields / dropped refs / clamps — the modal preview counts. */
  counts?: DirectionCounts;
  manifest: string[];
  /** 호출점 프롬프트 버전 상수 (s6.universe_criteria_draft@3). */
  prompt_version?: string;
  provenance?: UniRecoProvenance | null;
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
export interface PrecheckDraftItem {
  verdict: string;
  rationale?: string;
  source_url?: string | null;
  kind?: string;
}
// S7 재무·기술 평가 (ADR-0139) — 대상 사전 검토 체크리스트과 병행하는 별도 레이어.
// 항목별 weight(가중치)로 카테고리(재무/기술)마다 별도 100점 점수를 낸다 —
// 두 영역을 합치지 않는다(사용자 요구, 2026-09-15).
export interface EvalItem {
  id: string;
  category: "financial" | "technical";
  source: "builtin" | "seeded" | "custom";
  label: string;
  description: string | null;
  is_mandatory: 0 | 1;
  is_deletable: 0 | 1;
  weight: number;
  state: { status: "pending" | "pass" | "partial" | "fail" | "na" | "waived"; note: string | null } | null;
}
export interface EvalCategoryScore {
  score: number | null;
  scoredWeight: number;
  totalWeight: number;
  excludedWeight: number;
}

export interface Suggestion {
  id: string;
  name_ko: string;
  dart_corp_code: string | null;
}
