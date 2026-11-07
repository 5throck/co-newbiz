// @version 1.0.0
// Stable engine blocker keys (ADR-0187 phase P3, finding H8).
//
// Every artifact an S1-S12 completion predicate (lib/process-flow.ts and the
// modules it delegates to) can report as missing has ONE stable key here. The
// key - not the Korean label - is what process/flow.spec.yaml `blockers:`
// declares and what scripts/co-newbiz/process-ssot-check.ts
// (check-engine-spec-parity) compares. The label stays the exact string the
// engine has always emitted (it is persisted in gate_decision.missing_artifacts_json
// and mirrored by flow.spec requiredArtifacts in STAGES), so no stored record
// and no consumer changes meaning.
//
// Display text goes through i18n: every key has a `processBlockers.<key>`
// message in locales/ko.json and locales/en.json (tests/unit/
// process-blocker-keys.test.ts enforces ko/en parity and full coverage).
// `blockerMessageKey(label, stage)` resolves a stored label back to its
// catalog key so a surface can render the localized text.
//
// Key format: `s<stage number>.<snake_case>`; the prefix is the stage the
// blocker belongs to (the parity validator relies on it).

export const BLOCKER_LABELS = {
  // S1 market analysis
  "s1.market_size_growth": "시장 규모·성장 추정",
  "s1.value_chain_structure": "가치사슬 구조",
  "s1.competitive_structure": "경쟁 구조",
  "s1.data_confidence_grade": "데이터 신뢰도 등급",
  // S2 opportunity
  "s2.attractiveness_assessment": "기회 매력도 평가",
  "s2.entry_market": "진입시장 산정 (S1 링크·대상 범위·도출 사슬)",
  // S3 synergy and strategic fit
  "s3.synergy_assessment": "시너지 평가",
  "s3.strategic_fit_judgement": "시너지 점수 확정·근거 (전략적 적합성 판단)",
  "s3.capability_register": "필요 역량 목록(출처 포함)",
  "s3.opportunity_selected": "기회 선택(selected)",
  // S4 route decision
  "s4.route_decision": "route_decision(트랙)",
  "s4.brownfield_sub_track": "brownfield sub_track",
  "s4.five_criteria_scores": "5-criteria 채점",
  "s4.alternatives_considered": "검토한 대안",
  "s4.legal_regulatory_screening": "법무·규제 스크리닝 판정 (chk-legal-regulatory lr-01~lr-07 — regulatory-screening 활동)",
  // S5 greenfield self-entry
  "s5.capability_gap_register": "역량 격차·해소 방식",
  "s5.capability_assessment": "역량 격차 평가",
  "s5.entry_strategy": "진출전략",
  "s5.alternatives_considered": "검토한 대안",
  "s5.greenfield_feasibility_checklist": "그린필드 실현가능성 체크리스트 판정 (chk-greenfield-feasibility gf-01~gf-12)",
  "s5.site_selection_checklist": "부지 선정 체크리스트 판정 (chk-site-selection ss-01~ss-09)",
  // S6 target candidates
  "s6.target_universe": "Target Universe 정의",
  "s6.longlist_attributes": "Long List 후보 필수 속성·출처",
  "s6.longlist_coverage": "Long List 최소 커버리지",
  // S7 target selection
  "s7.candidate_screening": "대상 후보 스크리닝",
  "s7.candidate_verdict": "후보별 스크리닝 판정",
  "s7.candidate_evidence": "후보별 스크리닝 근거",
  "s7.knockout_shortlist": "knock-out 통과 Short List",
  // S8 feasibility
  "s8.business_case_per_target": "Business Case(비용·수익 라인 또는 밸류에이션 — brownfield는 대상별)",
  "s8.business_case": "Business Case(비용·수익 라인 또는 밸류에이션)",
  "s8.npv_quantiles": "시뮬레이션 NPV 분위수",
  "s8.bep_input_snapshot": "BEP 시점과 시뮬레이션 입력 스냅샷",
  "s8.target_selection_record": "대상 선정 기록 (brownfield)",
  "s8.wacc_hurdle_confirmed": "WACC and hurdle IRR confirmed by a person",
  // S9 due diligence
  "s9.dd_checklist_judgement": "DD 체크리스트 판정(필수 항목 해소)",
  "s9.dd_mandatory_resolved": "필수 항목 해소",
  // S10 investment structure
  "s10.deal_structure_hypothesis": "투자구조 가설(4축 검토 완료)",
  "s10.sources_uses_balance": "자금조달 계획(sources & uses 균형)",
  "s10.uses_reconcile_adopted_investment": "자금 사용(uses)과 S8 채택 투자금 대사 (허용 오차 ±5%)",
  "s10.downside_covenant_headroom": "다운사이드 커버넌트 여력 (DSCR 1.3배 이상)",
  "s10.funding_evidence": "자금 확정성 증빙(조달원별)",
  // S11 investment review and execution
  "s11.entity_ic_approval": "법인 투자심의위원회 승인",
  "s11.group_ic_approval": "그룹 투자심의위원회 승인",
  "s11.adopted_business_case": "투자심의 자료(채택 Business Case)",
  "s11.charter_baseline": "추진계획(차터) 기준선",
  "s11.human_reviewer_record": "사람 최종 승인(reviewer 기록)",
  "s11.pmi_kickoff": "PMI 킥오프 기록 (brownfield)",
  "s11.establishment_mode": "설립 방식 선택 (신규 법인 설립 / 신규 사업부 추진)",
  "s11.business_unit_execution": "사업부 신설 실행 기록(5단계 완료)",
  "s11.entity_establishment_execution": "설립 실행 기록(5단계 완료)",
  "s11.condition_precedents": "IC condition precedents cleared",
  "s11.classification_conflict": "트랙 분류 정리 (case_type ↔ route)",
  "s11.execution_baseline": "실행 기준선 확인 (greenfield)",
  // S12 post-management
  "s12.venture_scorecard": "벤처 스코어카드",
  "s12.scorecard_refresh": "분기별 스코어카드 갱신",
  "s12.transition_decision": "사람 전환 결정 기록(어휘 5종)",
  "s12.tranche_condition": "차기 트랜치 조건(tranche_condition)",
  "s12.core_handoff": "핵심사업 인계 기록(core_handoff)",
  "s12.divest_plan": "매각/청산 계획(divest_plan)",
  "s12.learning_capture": "학습 포착 기록(kill_with_learning_captured)",
} as const;

export type BlockerKey = keyof typeof BLOCKER_LABELS;

/** The label the engine reports in `missing` / `requiredArtifacts` for a key. */
export function blocker(key: BlockerKey): string {
  return BLOCKER_LABELS[key];
}

/** Stage id ("S3") a key belongs to. */
export function blockerStage(key: BlockerKey): string {
  return key.split(".")[0]!.toUpperCase();
}

/**
 * Resolve a stored/reported label to its key. Labels are unique within a stage
 * (two stages may share one, e.g. "검토한 대안"), so a caller that knows the
 * stage passes it; without a stage the first match wins.
 */
export function blockerKeyForLabel(label: string, stage?: string): BlockerKey | undefined {
  const keys = Object.keys(BLOCKER_LABELS) as BlockerKey[];
  const hit = keys.filter((k) => BLOCKER_LABELS[k] === label);
  if (stage) return hit.find((k) => blockerStage(k) === stage.toUpperCase());
  return hit[0];
}

/** i18n catalog key (`processBlockers.<key>`) for a reported label, or undefined for free-form text. */
export function blockerMessageKey(label: string, stage?: string): string | undefined {
  const key = blockerKeyForLabel(label, stage);
  return key ? `processBlockers.${key.replace(".", "_")}` : undefined;
}
