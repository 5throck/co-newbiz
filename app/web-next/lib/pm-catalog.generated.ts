// GENERATED from prompts/prompts.json × process/flow.spec.yaml × agents/*.md —
// do not edit by hand; edit the SSOTs (prompt activity mapping lives in prompts.json)
// and regenerate via: bun scripts/co-newbiz/generate-pm-catalog.ts
// (--check mode exits 1 on drift; tests/unit/pm-catalog.test.ts asserts this
// catalog mirrors the SSOTs and the roster.)
// ADR-0183 D1 — PM 활동 카탈로그 (design 2026-09-15-runtime-pm-agent-orchestration §6.2).
// pm-router의 허용 목록·규칙 에이전트 대상·LLM 분류 로스터 문자열은 이 카탈로그에서
// 유도된다 — 코드에 에이전트 목록을 두지 않는다.
// D2/DEC-20261025-01: 프롬프트 agent ≠ 활동 agent는 DUAL_ASSIGNMENTS 예외로만
// 허용된다(제너레이터 die 검증). DEC-20261025-02 §11.3: SPECIALIST_TRACK_AFFINITY는
// 표시·인지 전용 큐레이션 배열이다(적용 범위·술어·라우팅 키 없음 — ADR-0161).
import type { PromptKey } from "./prompts.generated.ts";

export interface PmCatalogEntry {
  /** prompts.json 프롬프트 키 (PromptKey와 1:1). */
  promptKey: PromptKey;
  /** 프롬프트 소유 에이전트 키. null = 동적 항목 — 호출 시점 에이전트 선언으로 귀속된다. */
  agentKey: string | null;
  /** 매핑된 flow.spec 활동 id (예: "target-screening"). 자연 매핑이 없으면 null. */
  activityId: string | null;
  /** 활동이 속한 단계 id (예: "S7"). 미매핑 null. */
  stageId: string | null;
  purpose: string;
  /** 단계 applicableTracks (greenfield/brownfield). 미매핑 []. */
  trackScope: string[];
}

/** 문서화된 이중 배정 — 프롬프트 관점 ≠ 활동 소유의 유일하게 인가된 예외 (D2). */
export interface DualAssignment {
  promptKey: PromptKey;
  /** 매핑된 flow.spec 활동 ("S11.ic-preparation" 형 stage.activity 키). */
  activity: string;
  rationale: string;
}

/** 트랙 전문가×공통 단계 마커 — 표시·인지 전용 (DEC-20261025-02 §11.3). */
export type SpecialistAffinityKind = "affinity" | "scoped" | "override";
export interface SpecialistTrackAffinity {
  /** flow.spec 활동 참조 ("S2.business-model-sketch" 형 stage.activity 키). */
  ref: string;
  agent: string;
  kind: SpecialistAffinityKind;
  track: "greenfield" | "brownfield";
  /** 한국어 툴팁 1문장 (/flows 마커). */
  note: string;
  /** 판정 기록 id. */
  decision: string;
}

export const CATALOG_VERSION = "1.0.0";
export const SPEC_VERSION = "2.20.0";
/** SSOT 원문 해시(앞 16자) — 드리프트 원인 규명용. */
export const CATALOG_SOURCES = {
  "promptsJson": "2763b522c3588953",
  "flowSpecYaml": "d2789c7b1f65127e",
  "agentRoster": "4f4cf81169a7e46f"
};

export const PM_CATALOG: Record<PromptKey, PmCatalogEntry> = {
  "s2.discover": {
    "promptKey": "s2.discover",
    "agentKey": "market-intelligence-agent",
    "activityId": "opportunity-discovery",
    "stageId": "S2",
    "purpose": "S2 기회 발굴 — 산업 근거 기반 기회 후보 도출",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s1.sizing_ask_json": {
    "promptKey": "s1.sizing_ask_json",
    "agentKey": "market-intelligence-agent",
    "activityId": "market-research",
    "stageId": "S1",
    "purpose": "S1 시장규모 산정 — 근거 기반 도출",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s1.sizing_summarize": {
    "promptKey": "s1.sizing_summarize",
    "agentKey": "market-intelligence-agent",
    "activityId": "market-research",
    "stageId": "S1",
    "purpose": "S1 시장규모 단계 요약",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s1.ksic_classify": {
    "promptKey": "s1.ksic_classify",
    "agentKey": "market-intelligence-agent",
    "activityId": "market-research",
    "stageId": "S1",
    "purpose": "산업 KSIC 코드 분류 제안",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "market.related_candidates": {
    "promptKey": "market.related_candidates",
    "agentKey": "market-intelligence-agent",
    "activityId": "value-chain-analysis",
    "stageId": "S1",
    "purpose": "1차 가치사슬 연계 산업 분석 — 가치사슬 인접 산업 제안",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s2.opportunity_factors": {
    "promptKey": "s2.opportunity_factors",
    "agentKey": "market-intelligence-agent",
    "activityId": "opportunity-discovery",
    "stageId": "S2",
    "purpose": "S2 기회/위험 요인 자동 도출",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "company_profile.qualitative": {
    "promptKey": "company_profile.qualitative",
    "agentKey": "financial-analyst",
    "activityId": "our-company-profile",
    "stageId": "S3",
    "purpose": "S3 그룹/계열사 프로파일 산출",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "company_profile.competitive": {
    "promptKey": "company_profile.competitive",
    "agentKey": "financial-analyst",
    "activityId": "our-company-profile",
    "stageId": "S3",
    "purpose": "S3 프로파일 보정",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "company_profile.crosscheck": {
    "promptKey": "company_profile.crosscheck",
    "agentKey": "financial-analyst",
    "activityId": "our-company-profile",
    "stageId": "S3",
    "purpose": "프로파일 공시 대조 검증",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s3.synergy_fa": {
    "promptKey": "s3.synergy_fa",
    "agentKey": "financial-analyst",
    "activityId": "synergy-analysis",
    "stageId": "S3",
    "purpose": "시너지 재무·사업 분석 — 근거 기반 강약점 도출",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s3.synergy_synergy": {
    "promptKey": "s3.synergy_synergy",
    "agentKey": "market-intelligence-agent",
    "activityId": "synergy-analysis",
    "stageId": "S3",
    "purpose": "시너지 산출 — 정량·정성 시너지 도출",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s3.synergy_ic": {
    "promptKey": "s3.synergy_ic",
    "agentKey": "risk-officer",
    "activityId": "synergy-red-team",
    "stageId": "S3",
    "purpose": "시너지 종합 — IC 관점 검토",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s3.attractiveness_recommendation": {
    "promptKey": "s3.attractiveness_recommendation",
    "agentKey": "risk-officer",
    "activityId": "strategic-fit-screening",
    "stageId": "S3",
    "purpose": "매력도 점수 초안 제안",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s3.capability_gap_draft": {
    "promptKey": "s3.capability_gap_draft",
    "agentKey": "greenfield-agent",
    "activityId": "capability-register-greenfield",
    "stageId": "S3",
    "purpose": "S3 필요 역량 수준 필요도·필요 수준·보유 판정 초안",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s5.capability_judgement_draft": {
    "promptKey": "s5.capability_judgement_draft",
    "agentKey": "greenfield-agent",
    "activityId": "capability-assessment",
    "stageId": "S5",
    "purpose": "S5 필요 역량 달성 가능성 판정 입력 제안 (해소 방식·기대 수준·비용·기간·달성 가능성·분류·근거)",
    "trackScope": [
      "greenfield"
    ]
  },
  "s5.entry_strategy_draft": {
    "promptKey": "s5.entry_strategy_draft",
    "agentKey": "greenfield-agent",
    "activityId": "entry-strategy",
    "stageId": "S5",
    "purpose": "S5 진출전략 제안 (진출 방식 선택·선택 근거·검토한 대안)",
    "trackScope": [
      "greenfield"
    ]
  },
  "opportunity.gate_brief": {
    "promptKey": "opportunity.gate_brief",
    "agentKey": "risk-officer",
    "activityId": null,
    "stageId": null,
    "purpose": "진행 브리프 — 권고·근거 초안 작성",
    "trackScope": []
  },
  "project.gate_brief": {
    "promptKey": "project.gate_brief",
    "agentKey": "risk-officer",
    "activityId": null,
    "stageId": null,
    "purpose": "진행 브리프 — 권고·근거 초안 작성",
    "trackScope": []
  },
  "s4.route_recommendation": {
    "promptKey": "s4.route_recommendation",
    "agentKey": "pm",
    "activityId": "route-strategy",
    "stageId": "S4",
    "purpose": "S4 트랙·라우트·5기준 채점 초안",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "opportunity.sketch": {
    "promptKey": "opportunity.sketch",
    "agentKey": "greenfield-agent",
    "activityId": "business-model-sketch",
    "stageId": "S2",
    "purpose": "비즈니스 모델 검토 초안",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s5.greenfield_recommendation": {
    "promptKey": "s5.greenfield_recommendation",
    "agentKey": "greenfield-agent",
    "activityId": "capability-assessment",
    "stageId": "S5",
    "purpose": "S5 역량 평가 추천 초안",
    "trackScope": [
      "greenfield"
    ]
  },
  "s6.universe_criteria_draft": {
    "promptKey": "s6.universe_criteria_draft",
    "agentKey": "brownfield-agent",
    "activityId": "target-universe-definition",
    "stageId": "S6",
    "purpose": "S6 유니버스 선정 기준 초안 — S1·S3 산출물 기반 제안",
    "trackScope": [
      "brownfield"
    ]
  },
  "s6.target_proposal_web_search": {
    "promptKey": "s6.target_proposal_web_search",
    "agentKey": "market-intelligence-agent",
    "activityId": "target-longlist",
    "stageId": "S6",
    "purpose": "S6 대상 후보 웹검색 제안 — 실검색 근거 기반 후보 도출",
    "trackScope": [
      "brownfield"
    ]
  },
  "s7.screening_draft": {
    "promptKey": "s7.screening_draft",
    "agentKey": "brownfield-agent",
    "activityId": "target-screening",
    "stageId": "S7",
    "purpose": "S7 사전 검토 판정 제안 — 기확보 정보(재무·프로파일·공시)와 웹검색 근거 기반 5단 판정",
    "trackScope": [
      "brownfield"
    ]
  },
  "s8.business_case_prose": {
    "promptKey": "s8.business_case_prose",
    "agentKey": null,
    "activityId": "business-case-modeling",
    "stageId": "S8",
    "purpose": "S8 사업성 분석 단계 산출 해석 보강",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s8.business_case_adoption": {
    "promptKey": "s8.business_case_adoption",
    "agentKey": "valuation-agent",
    "activityId": "valuation",
    "stageId": "S8",
    "purpose": "채택 추천 초안",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s10.deal_structure_recommendation": {
    "promptKey": "s10.deal_structure_recommendation",
    "agentKey": "brownfield-agent",
    "activityId": "deal-structure-hypothesis",
    "stageId": "S10",
    "purpose": "딜 구조 추천 초안",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s9.dd_tailor": {
    "promptKey": "s9.dd_tailor",
    "agentKey": "technical-dd-agent",
    "activityId": "technical-dd",
    "stageId": "S9",
    "purpose": "S9 산업 맞춤 DD 체크리스트 항목 제안",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s12.monitoring_brief": {
    "promptKey": "s12.monitoring_brief",
    "agentKey": "group-review-agent",
    "activityId": "portfolio-monitoring",
    "stageId": "S12",
    "purpose": "모니터링 브리프 — 관찰 요약 제안",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "pm.query_classify": {
    "promptKey": "pm.query_classify",
    "agentKey": "pm",
    "activityId": null,
    "stageId": null,
    "purpose": "질의 분류 — 수행 에이전트 배정",
    "trackScope": []
  },
  "committee.position": {
    "promptKey": "committee.position",
    "agentKey": null,
    "activityId": null,
    "stageId": null,
    "purpose": "위원회 심의 포지션 초안 — 제안 전용",
    "trackScope": []
  },
  "company_profile.competitor_web_search": {
    "promptKey": "company_profile.competitor_web_search",
    "agentKey": "market-intelligence-agent",
    "activityId": "our-company-profile",
    "stageId": "S3",
    "purpose": "S3 경쟁사 웹검색 재제안 (ADR-0142 후속)",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s8.price_evidence": {
    "promptKey": "s8.price_evidence",
    "agentKey": "quant-methodologist",
    "activityId": "quant-methods",
    "stageId": "S8",
    "purpose": "S8 타겟코스팅 — 웹검색 근거에서 시장가격 후보 추출 (제안 전용, 확정은 사람)",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s2.entry_market_draft": {
    "promptKey": "s2.entry_market_draft",
    "agentKey": "market-intelligence-agent",
    "activityId": "entry-market-sizing",
    "stageId": "S2",
    "purpose": "S2 진입 시장 도출 사슬 AI 배수 추천 초안 (제안 전용, 저장은 사람)",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s8.ev_band_recommend": {
    "promptKey": "s8.ev_band_recommend",
    "agentKey": "valuation-agent",
    "activityId": "valuation",
    "stageId": "S8",
    "purpose": "S8 브라운필드 — EV/매출 밴드 AI 추천 초안 (제안 전용, 확정은 사람)",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s11.integrated_insight": {
    "promptKey": "s11.integrated_insight",
    "agentKey": "process-governance-manager",
    "activityId": "ic-preparation",
    "stageId": "S11",
    "purpose": "S11 투자심사 step 4.5 — 통합 인사이트 리뷰 초안 (제안 전용, 기록은 사람)",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s10.site_regulatory_draft": {
    "promptKey": "s10.site_regulatory_draft",
    "agentKey": "legal-counsel",
    "activityId": null,
    "stageId": null,
    "purpose": "S10 부지·시설 — 주소 기반 건축법·인허가 법규 사전검토 초안 (제안 전용, 확정은 사람·법무)",
    "trackScope": []
  },
  "s11.report_narration": {
    "promptKey": "s11.report_narration",
    "agentKey": "pm",
    "activityId": "ic-preparation",
    "stageId": "S11",
    "purpose": "S11 보고서 — 경영 요약 초안 (AI 초안, 사람이 검토 후 스냅샷 저장)",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "s12.milestone_suggest": {
    "promptKey": "s12.milestone_suggest",
    "agentKey": "process-governance-manager",
    "activityId": "portfolio-monitoring",
    "stageId": "S12",
    "purpose": "S12 마일스톤 — 트랙·사업 케이스 기반 마일스톤 추천 (제안 전용, 등록은 사람)",
    "trackScope": [
      "greenfield",
      "brownfield"
    ]
  },
  "pm.flow_suggest": {
    "promptKey": "pm.flow_suggest",
    "agentKey": "pm",
    "activityId": null,
    "stageId": null,
    "purpose": "플로우 콘솔 개선 제안 — 프롬프트 개선 초안 또는 에이전트 재배정 후보를 근거와 함께 산출(제안 전용)",
    "trackScope": []
  }
};

/** agent=null 동적 항목 — 실행 시점 활동 맥락(호출자가 선언한 agent 메타)으로 귀속된다. */
export const DYNAMIC_AGENT_PROMPTS: PromptKey[] = ["s8.business_case_prose","committee.position"];

/** 문서화된 이중 배정 — 유일한 "보조 관점" 예외 (근거 필수, 신규는 게이트 판정 요구). */
export const DUAL_ASSIGNMENTS: DualAssignment[] = [
  {
    "promptKey": "s3.synergy_fa",
    "activity": "S3.synergy-analysis",
    "rationale": "Sanctioned dual assignment (owner decision D6' 2026-10-28, amends ADR-0187 D6; DEC-20261028-03): financial-analyst supports the market-intelligence-agent-led synergy-analysis activity by quantifying each synergy line against the assumption register (greenfield-screening step 1.55, brownfield-screening step 2.55); the activity lead is unchanged."
  },
  {
    "promptKey": "s11.integrated_insight",
    "activity": "S11.ic-preparation",
    "rationale": "Cross-domain integrated insight is the process-governance-manager charter (auxiliary review lens) layered on the pm-owned ic-preparation activity; procedure schema supports one agent_key per step (ADR-0161 Q6 pattern)."
  },
  {
    "promptKey": "s3.attractiveness_recommendation",
    "activity": "S3.strategic-fit-screening",
    "rationale": "Sanctioned dual assignment (ADR-0185, owner-approved 2026-10-26): the attractiveness score is the risk-officer's own recommendation (red-team scoring seat) layered on the process-governance-manager-led strategic-fit-screening activity."
  },
  {
    "promptKey": "company_profile.competitor_web_search",
    "activity": "S3.our-company-profile",
    "rationale": "Sanctioned dual assignment (ADR-0185, owner-approved 2026-10-26): prompt agent market-intelligence-agent is a sanctioned secondary lens on the financial-analyst-led S3.our-company-profile activity; the activity lead is unchanged."
  },
  {
    "promptKey": "s12.milestone_suggest",
    "activity": "S12.portfolio-monitoring",
    "rationale": "Sanctioned dual assignment (ADR-0185, owner-approved 2026-10-26): prompt agent process-governance-manager is a sanctioned secondary lens on the group-review-agent-led S12.portfolio-monitoring activity; the activity lead is unchanged."
  }
];

/** 트랙 전문가×공통 단계 마커 4곳 — 표시 전용, die 검증으로 스펙 일치 강제됨. */
export const SPECIALIST_TRACK_AFFINITY: SpecialistTrackAffinity[] = [
  {
    "ref": "S2.business-model-sketch",
    "agent": "greenfield-agent",
    "kind": "affinity",
    "track": "greenfield",
    "note": "S2는 트랙 미결정 — 모든 기회가 후보 신사업이며 스케치는 트랙 중립 가설 산출물(requiredCapabilities→S3→S4)이다",
    "decision": "DEC-20261025-02"
  },
  {
    "ref": "S9.capability-dd",
    "agent": "brownfield-agent",
    "kind": "scoped",
    "track": "brownfield",
    "note": "brownfield 전용 실행(절차 [brownfield-dd]) — greenfield는 S5 capability-assessment에서 답한다",
    "decision": "DEC-20261025-02"
  },
  {
    "ref": "S11.investment-structuring",
    "agent": "brownfield-agent",
    "kind": "override",
    "track": "brownfield",
    "note": "활동 필드 소유는 Q6상 brownfield-agent — greenfield 실효 소유는 entity-ic-review step 3.1(greenfield-agent + financing-agent 공동검토)",
    "decision": "DEC-20261025-02"
  }
];
