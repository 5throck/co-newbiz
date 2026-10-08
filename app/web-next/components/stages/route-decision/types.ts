// Split from components/stages/RouteDecisionStage.tsx (Wave U-3 decomposition); behavior unchanged.

// flow.spec v2.4.0 — 결정론 어드바이저(ADR-0104) + S1 시장·경쟁·역량 근거.
// GET /api/opportunities/{id}/route-advisory 응답. 권고·신호는 제안이며 결정
// 기록은 사람의 행위다(경계 #2).
export interface AdvisorySignalView { key: string; label: string; leans: "greenfield" | "brownfield" | "neutral"; weight: number; note: string }
export interface AdvisoryResponse {
  recommendedTrack: "greenfield" | "brownfield" | "neutral";
  greenfieldScore: number;
  brownfieldScore: number;
  signals: AdvisorySignalView[];
  reReviewTriggers: string[];
  s1Evidence: {
    industryName: string; versionNo: number | null;
    marketSizeUsdB: number | null; cagr: number | null;
    competitive: { structure: string; players: Array<{ name: string; tier: string; note: string }> } | null;
  } | null;
  capabilityGap: {
    total: number; evaluated: number; met: number; partial: number; unmet: number;
    coveragePct: number | null;
    unmetRows: Array<{ capability: string; resolution: string | null }>;
    // S3에서 확정한 필요 역량 수준 전체 행 (역량 관련 5기준 채점 근거)
    rows?: Array<{
      capability: string;
      source: string;
      held: { status: string; holders: string[]; evidence: string };
      resolution: string | null;
    }>;
  } | null;
}

export interface OpportunityRow {
  id: string; name: string; market_scope: string | null; value_chain_node: string | null;
  attractiveness_score: number | null; synergy_score: number | null;
  rationale: string | null; synergy_rationale: string | null;
  market_size_krw_m: number | null; growth_rate: number | null;
  status: "identified" | "assessed" | "selected" | "dropped";
  project_id: string | null;
  deleted_at: string | null;
}
export interface ScoreRow { criterion: string; score: number; evidence_note: string }
export interface RouteDecision {
  id: string; track: "greenfield" | "brownfield"; sub_track: string | null;
  rationale: string; alternatives_considered: string | null; decided_by: string; decided_at: string;
  intent: string | null; override_flagged: number | null; staging_recommended: string | null;
  total_score: number | null; scores: ScoreRow[];
  // ADR-0135 — 권위 행 표시. 대체된 결정은 이력에 남되 is_current=0이다.
  is_current: number; superseded_by: string | null;
}
// ADR-0124 — 열린 초안(status='draft'). 완결성 검증이 없어 필드가 비어있을 수 있다.
export interface RouteDecisionDraft {
  id: string; track: "greenfield" | "brownfield"; sub_track: string | null;
  rationale: string | null; alternatives_considered: string | null; intent: string | null;
  updated_at: string | null; scores: ScoreRow[];
}
// LLM 추천 (결정 지원) — POST /api/opportunities/[id]/route-recommendation 응답.
// 제안일 뿐이며 source("llm"|"synthesis")로 출처를 화면에 명시한다.
export interface RecoScore { criterion: string; score: number; evidence_note: string }
export interface RouteRecommendation {
  source: "llm" | "synthesis";
  provider: string | null;
  note: string | null;
  recommendation: {
    track: "greenfield" | "brownfield";
    sub_track: string | null;
    intent: string | null;
    confidence: string | null;
    scores: RecoScore[] | null;
    rationale_draft: string;
    alternatives_draft: string | null;
    key_evidence: string[];
    cautions: string[];
  };
}