// Korean display catalog for the M&A sub-track DD checklists (UX round 2, R2-B item 5).
// Display only: the checklist yaml files, item ids and every stored judgement stay untouched.
// The English source text remains available (tooltip / developer detail) so a reviewer can
// always check a translation against the governing text. Unlisted items fall back to the source.

const KO: Record<string, string> = {
  // chk-brownfield-feasibility-checklist
  "chk-brownfield-feasibility-checklist:bf-01": "M&A 필수 검증 6종(반독점, 고객 이탈, 인센티브, 인사 통합, 인증 이전 가능성, 지역 리드 노동 검토)을 모두 수행하고 기록했다",
  "chk-brownfield-feasibility-checklist:bf-02": "FS 진행을 열기 전에 WACC와 허들 IRR이 가정값이 아닌 사용자 확정값으로 확인되었다",
  "chk-brownfield-feasibility-checklist:bf-03": "거래 논리에 핵심적인 경우, 인증의 경영권 변경 시 이전 가능성을 대상 기업의 설명이 아닌 인증기관 자체 규정으로 확인했다",
  "chk-brownfield-feasibility-checklist:bf-04": "골든 파라슈트·경영권 변경 조건 임원 보상을 식별하고 인수 첫날의 현금 유출로 모델링했다",
  "chk-brownfield-feasibility-checklist:bf-05": "보상 조화 비용을 상향 편향 기본값으로 추정했다(절감 항목으로 모델링하지 않음)",
  "chk-brownfield-feasibility-checklist:bf-06": "고객 계약의 경영권 변경 해지 조항을 점검했다",
  "chk-brownfield-feasibility-checklist:bf-07": "이익의 질 정상화를 마쳤다(일회성 항목 제거, 오너 보상 정상화)",
  "chk-brownfield-feasibility-checklist:bf-08": "우발부채를 서술이 아닌 확률 x 금액 x 시점 분포로 모델링해 몬테카를로에 반영했다",
  "chk-brownfield-feasibility-checklist:bf-09": "하방 시나리오(+200bp)에서 재무약정 위반 여부를 시험했다",
  "chk-brownfield-feasibility-checklist:bf-10": "PMI 시너지 가정을 가치평가 에이전트의 거래 모델과 대조했다(독자적으로 낙관하지 않음)",
  "chk-brownfield-feasibility-checklist:bf-11": "공동행위 선행 금지(gun-jumping) 준수를 확인했다 - 신고 의무가 있는 모든 관할에서 승인 전 통합 활동이 없다",
  "chk-brownfield-feasibility-checklist:bf-12": "투자 주체 구조화를 ADR-0045 4대 축(절세 구조, 책임 격리, 재무 레버리지, 엑싯 구조)으로 검토했다 - 인수 방식(지분/구조)만이 아니다",
  // chk-ma-special-topics-checklist
  "chk-ma-special-topics-checklist:ma-01": "관련 시장(제품·지역)을 정의하고 HHI와 HHI 변화량을 계산했다 - 대상 기업끼리의 직접 합병뿐 아니라 공동 소유·공동 통제 결합(예: 경쟁사 한 곳을 이미 통제하는 재무적 투자자가 다른 경쟁사를 인수)도 포함한다",
  "chk-ma-special-topics-checklist:ma-02": "해당되는 모든 관할의 기업결합 신고 요건을 확인했다(주 시장만이 아닌 다관할 신고 점검)",
  "chk-ma-special-topics-checklist:ma-03": "공동행위 선행 금지(gun-jumping)를 인지했다 - 승인 전 통합 행위를 하지 않는다",
  "chk-ma-special-topics-checklist:ma-04": "임원 보상 패키지(경영권 변경 조건, 골든 파라슈트 추정액, 가속 베스팅)를 경영진 패키지 기록에 반영했다",
  "chk-ma-special-topics-checklist:ma-05": "핵심 인력 유지를 위해 경업금지에 의존하기 전에 관할별 유효성을 확인했다",
  "chk-ma-special-topics-checklist:ma-06": "직무군·직급 수준의 직원 보상 벤치마크를 마치고 양방향 상향 편향 조화 비용을 계산했다",
  "chk-ma-special-topics-checklist:ma-07": "고객·공급사 계약, 차입 약정, 임원 보상 전반의 경영권 변경 조항을 점검했다 - 이후에도 공급자로 남는 매도인은 고객 계약과 같은 위험 범주다",
  "chk-ma-special-topics-checklist:ma-08": "인수 후 이탈에 대한 고객·공급사 집중도와 경쟁 중복 위험을 평가했다 - 거래 전후 집중도를 모두 측정하고, 매도인이 거래 후에도 상거래 관계를 유지하는 경우를 포함한다",
  "chk-ma-special-topics-checklist:ma-09": "계획된 이전·구조조정에 대해 인센티브(예정분·수령분)의 환수 위험을 검토했다",
  "chk-ma-special-topics-checklist:ma-10": "우발부채(소송, 환경, 미적립 연금, 보증·리콜)를 확률·금액 분포로 입력해 몬테카를로에 반영했다 - 서술만 있는 항목은 없다",
  "chk-ma-special-topics-checklist:ma-11": "금리 +200bp 충격에서 재무약정 위반을 시험하고, 차입 계약의 경영권 변경 기한이익상실 조항을 식별했다",
  "chk-ma-special-topics-checklist:ma-12": "인증의 경영권 변경 시 이전 가능성을 마지막에 인증기관 자체 규정으로 확인했다 - 추론 금지(설계상 명시 규칙)",
};

/** Korean display text for a checklist item; the source text when no translation exists. */
export function koChecklistText(checklistId: string, itemId: string, source: string): { text: string; translated: boolean } {
  const ko = KO[`${checklistId}:${itemId}`];
  return ko ? { text: ko, translated: true } : { text: source, translated: false };
}

/** Why an item has no waiver path (shown on the row, not only in a tooltip). */
export function nonWaivableReason(checklistId: string, itemId: string): string {
  if (itemId === "bf-01") return "면제 불가 - 6종 검증의 완비는 면제 경로가 없는 설계 규칙입니다. 누락은 중단 기준(Kill Criterion)입니다.";
  if (itemId === "bf-02") return "면제 불가 - 잠정 할인율은 분석 자체를 무효로 하므로 가정값으로 면제할 수 없습니다.";
  if (itemId === "bf-03") return "면제 불가 - 인증 이전 가능성은 추론이 금지되어 면제로 대신할 수 없고 인증기관 규정으로 확인해야 합니다.";
  return `면제 불가 - ${checklistId} ${itemId}에는 면제 경로가 없습니다.`;
}
