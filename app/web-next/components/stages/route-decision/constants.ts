import { TranslatorFn } from "../../../i18n/config.ts";
// Split from components/stages/RouteDecisionStage.tsx (Wave U-3 decomposition); behavior unchanged.

// i18n (T3-6): sub-track IDs per track (option order + validation). Display names resolve
// common.subTrack.* via lib/label-keys.ts SUB_TRACK_KEY at render.
export const GF_SUB = ["existing_business_rbd", "intra_venture"] as const;
export const BF_SUB = ["m_and_a", "jv", "strategic_investment", "minority_investment", "partnership", "rbd", "corporate_venture"] as const;
// Stage 2 채점 기준 (각 20% × 1–3점) — 라벨·힌트는 카탈로그 키, 렌더 시 TranslatorFn으로 푼다.
export const CRITERIA: Array<{ key: string; label: string; hint: string }> = [
  { key: "control_need", label: "stages.s4.constants.controlNeed", hint: "stages.s4.constants.resultsSufficesToWithoutOperational" },
  { key: "capability_criticality", label: "stages.s4.constants.capabilityCriticality", hint: "stages.s4.constants.toKnowledgeNotSubstitutable" },
  { key: "market_uncertainty", label: "stages.s4.constants.marketUncertainty", hint: "stages.s4.constants.verifiedToAndRegulationUncertain" },
  { key: "integration_capacity", label: "stages.s4.constants.integratedCapability", hint: "stages.s4.constants.integrationExperienceAndCapacityTo" },
  { key: "speed_to_capability", label: "stages.s4.constants.capabilityAcquisitionSpeed", hint: "stages.s4.constants.buildSlowlyToSecureImmediately" },
];
export const SCORE_LABEL = (tr: TranslatorFn): Record<number, string> => ({ 1: tr("common.low"), 2: tr("common.medium"), 3: tr("common.high") });
// 사전배제 대상 라우트 — 통제 필요도=高 + 역량접근 의도에서 선택 불가
export const OVERRIDDEN_SUBS = ["partnership", "rbd", "corporate_venture"];

// ── Table column sizing (2026-10-11-table-column-sizing-system, batch 2) ──
// 진출방식 결정 이력 (DecisionTab) — 트랙·라우트·의도·채점은 좁게, 근거·대안(긴 텍스트)에
// 폭을 주고 cell-truncate로 한 줄 유지.
export const DECISION_COL_PCT = [9, 9, 7, 9, 21, 21, 16, 8] as const;
// 경쟁 구조 — 주요 기업 (CompetitiveTab, S4) — 티어 칩은 좁게, 비고에 나머지.
export const S4_COMPETITIVE_COL_PCT = [24, 16, 60] as const;
// 필요 역량 수준 레지스터 (EvalTab, S3 연계) — 역량명·보유 근거가 본문.
export const CAPABILITY_REG_COL_PCT = [24, 10, 22, 28, 16] as const;