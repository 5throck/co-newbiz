/**
 * Korean data values stored in payloads, API messages, and DB columns (design
 * 2026-10-23-i18n-ui-adoption §4: business/analysis content stays Korean).
 * UI code must match these values against the constants below instead of
 * inlining Korean literals — display text resolves through the i18n catalogs
 * (components.* / common.* keys), never by comparing translated strings.
 */
export const KO_DATA = {
  /** industry_links.relation values (value-chain direction, ADR-0181 era payloads) */
  relationDown2: "전전방",
  relationDown: "전방",
  relationUp: "후방",
  relationUp2: "후후방",
  /** four-axis note sentinel meaning "needs verification" (S10 payloads) */
  needsVerification: "검증 필요",
  /** lib/staffing-plan.ts flag text (labor cost not accrued) */
  staffingFlagSalaryMissing: "급여 미입력 — 인건비 미계상",
  /** lib/staffing-plan.ts flag prefix (uplift rates) */
  staffingFlagUpliftPrefix: "가산율",
  /** market analysis error_message prefixes (server-side Korean prose) */
  analysisErrorPrereqFailed: "선행 분석 실패",
  analysisErrorRoot: "루트 재분석",
  analysisErrorPrereqLong: "선행 분석 장기",
  /** business target source metadata prefix meaning "user-entered" */
  sourceUserPrefix: "사용자",
  /** WACC derivation chain text prefix (observed values) */
  waccChainObservedPrefix: "관측",
  /** dd-checklist-tailor payload: the seven DD domain titles (UI tabs, payload and reports agree). Display rendering resolves common.ddDomain.* instead. */
  ddDomainCommercial: "상업 실사",
  ddDomainTechnical: "기술 실사",
  ddDomainLegal: "법무 실사",
  ddDomainFinancial: "재무 실사",
  ddDomainHr: "인사 실사",
  ddDomainMarket: "시장 실사",
  ddDomainFinancing: "자금조달 계획",
} as const;

/**
 * Suggested greenfield funding-source / funding-use row names (lib/labels.ts GF_FUNDING_*_PRESETS).
 * These free-text suggestions are STORED as financing-plan rows (design §4) — payload Korean;
 * they are datalist suggestions, not display-only labels.
 */
export const KO_GF_FUNDING_SOURCE_PRESETS = [
  "자기자본(출자)",
  "프로젝트 파이낸싱",
  "정부 자금·보조금",
  "차입금(금융기관)",
] as const;
export const KO_GF_FUNDING_USE_PRESETS = [
  "부지·설비 자체 건설(build)",
  "부지·설비 임차(lease)",
  "연구개발·인력",
  "운전자금",
] as const;

/** True when the relation points toward demand (downstream direction). */
export function isDownstreamRelation(relation: string): boolean {
  return relation === KO_DATA.relationDown || relation === KO_DATA.relationDown2;
}

/** S3 register level column names used as narrative field discriminators (capability-judgement payloads). */
export const KO_NARRATIVE_FIELDS = {
  requiredLevel: "필요 수준",
  heldLevel: "보유 수준",
  expectedLevel: "기대 수준",
} as const;
export type KoNarrativeField = (typeof KO_NARRATIVE_FIELDS)[keyof typeof KO_NARRATIVE_FIELDS];
