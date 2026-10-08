// Glossary-backed label map (R2-C 8): the one place that turns machine keys (gate ids, decisions,
// stages, enums, record keys, English error text) into the Korean wording shown to people.
// Terms follow glossary/*.yaml (FS = 타당성 분석, IC = 투자심사위원회, DD = 실사, WACC = 가중평균자본비용).
// A key without an entry falls back to itself so nothing ever renders blank.

export const GATE_LABEL: Record<string, string> = {
  screening: "스크리닝",
  pre_fs: "사전 타당성(Pre-FS)",
  target_screening: "대상 선정",
  fs: "타당성 분석(FS)",
  dd: "실사(DD)",
  entity_ic: "법인 투자심사(Entity IC)",
  group_ic: "그룹 투자심사(Group IC)",
};

export const DECISION_LABEL: Record<string, string> = {
  go: "진행(GO)",
  hold: "보류(HOLD)",
  kill: "중단(KILL)",
  pending: "대기",
};

export const TRACK_LABEL: Record<string, string> = { greenfield: "그린필드(신규 설립)", brownfield: "브라운필드(인수합병)" };

export const ORIGIN_LABEL: Record<string, string> = { internal: "내부 추진", joint: "합작", external: "외부 인수" };

export const DD_DOMAIN_LABEL: Record<string, string> = { commercial: "상업 실사", technical: "기술 실사", legal: "법무 실사" };

/** Closure precondition record keys (db/repositories/closure.repository.ts) shown in the closure modal. */
export const CLOSURE_RECORD_LABEL: Record<string, { label: string; message: string }> = {
  "gate_decision(kill)": { label: "게이트 중단(KILL) 결정", message: "사람이 기록한 게이트 중단(KILL) 결정이 필요합니다." },
  "gate_decision.decided_by": { label: "결정자", message: "중단(KILL) 결정은 에이전트가 아니라 사람이 기록해야 합니다." },
  "gate_decision.learning_capture": { label: "학습 포착", message: "게이트 중단(KILL) 결정에 학습 포착이 없습니다." },
  "gate_decision(hold)": { label: "보류(HOLD) 결정", message: "보류(HOLD) 결정이 위원회 결과를 기다리는 중입니다. 먼저 게이트 결정을 기록하세요." },
  "gate_decision(none)": { label: "기존 게이트 결정", message: "이미 게이트 결정이 있어 '제외'를 쓸 수 없습니다. '게이트 KILL로 종료' 또는 '철회'를 사용하세요." },
  "opportunity.project_id(null)": { label: "프로젝트 승격 여부", message: "이미 프로젝트로 승격된 건입니다. 프로젝트 단위로 종료하세요." },
  basisId: { label: "근거 기록", message: "선택한 근거가 이 건의 최신 중단(KILL) 결정과 일치하지 않습니다." },
  closure_type: { label: "종료 유형", message: "이 건에는 사용할 수 없는 종료 유형입니다." },
  venture_transition_decision: { label: "S12 전환 결정", message: "S12 전환 결정이 기록되어야 합니다." },
};

export function closureRecordLabel(record: string): string {
  return CLOSURE_RECORD_LABEL[record]?.label ?? record;
}

/** Known English system messages → Korean. Unknown text passes through unchanged. */
const MESSAGE_RULES: Array<[RegExp, string]> = [
  [/LLM provider is not configured[^.]*\.?/i, "AI 모델이 연결되어 있지 않아 이 기능을 실행할 수 없습니다. 관리자에게 AI 모델 설정을 요청하거나, 값을 직접 입력하세요."],
  [/Administrator role required\.?/i, "관리자 권한이 필요합니다."],
  [/Request failed\.?/i, "요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요."],
];

export function localizeMessage(message: string): string {
  for (const [re, ko] of MESSAGE_RULES) if (re.test(message)) return ko;
  return localizeRequirement(message);
}

/** Stage requirement text coming from the process spec: keep the meaning, drop set notation. */
export function localizeRequirement(text: string): string {
  return text
    .replace(/origin\s*∈\s*\{\s*internal\s*,\s*joint\s*\}/g, "내부 추진·합작 프로젝트에 한함")
    .replace(/gate_decision\(kill\)/g, "게이트 중단(KILL) 결정")
    .replace(/missing_artifacts/g, "미완료 산출물 목록");
}

/** Shown beside every action a read-only viewer cannot use. */
export const VIEWER_READONLY_TEXT = "보기 권한만 있습니다";
