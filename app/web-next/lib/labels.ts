// Glossary-backed label map (R2-C 8): the one place that turns machine keys (gate ids, decisions,
// stages, enums, record keys, English error text) into the Korean wording shown to people.
// Terms follow glossary/*.yaml `ko` (Pre-FS = 예비타당성 검토, Entity IC = 각사 투자심의위원회,
// Group IC = 그룹 투자심의위원회, Green/Brown Field = 그린필드/브라운필드); WACC/FS/DD wording follows the
// existing labels. Client-safe: NO imports (consumed by client components).
//
// Wording that is not yet confirmed by glossary-curator / the product owner carries a machine-greppable
// INTERIM-WORDING marker (design 2026-10-11-ui-label-and-mobile-table-sweep-design.md section 5,
// Q1-Q7). `grep -rn INTERIM-WORDING app/web-next/lib/labels.ts` lists every entry to confirm.
//
// Legacy maps/functions (GATE_LABEL, DECISION_LABEL, closureRecordLabel ...) keep their original
// "unknown key falls back to itself" behaviour. New code should use `resolveLabel()` so the UI can hide
// the raw key inside a developer-details disclosure.

/** Result of `resolveLabel`: `label` is what the UI shows; `raw` goes only into a developer-details disclosure. */
export interface LabelResult {
  label: string;
  raw: string;
  /** True when no map entry matched (label is the placeholder, never the raw key). */
  isFallback: boolean;
}

/** INTERIM-WORDING Q7: neutral placeholder for an unmapped key ("unclassified" option of the design). */
export const UNCLASSIFIED_LABEL = "분류 미정";
/** Shown for an absent (null/empty) value. */
export const EMPTY_LABEL = "—";

/** Look `key` up in `map`. Never returns the raw key as the label and never returns blank. */
export function resolveLabel(map: Readonly<Record<string, string>>, key: string | null | undefined): LabelResult {
  const raw = (key ?? "").trim();
  if (!raw) return { label: EMPTY_LABEL, raw: "", isFallback: true };
  const hit = Object.prototype.hasOwnProperty.call(map, raw) ? map[raw] : undefined;
  return hit ? { label: hit, raw, isFallback: false } : { label: UNCLASSIFIED_LABEL, raw, isFallback: true };
}

/** Convenience: only the display text of `resolveLabel`. */
export function labelText(map: Readonly<Record<string, string>>, key: string | null | undefined): string {
  return resolveLabel(map, key).label;
}

export const GATE_LABEL: Record<string, string> = {
  screening: "스크리닝",
  pre_fs: "예비타당성 검토(Pre-FS)", // glossary Pre-FS.ko
  target_screening: "대상 선정",
  fs: "타당성 분석(FS)",
  dd: "실사(DD)",
  entity_ic: "각사 투자심의위원회(Entity IC)", // glossary Entity IC.ko
  group_ic: "그룹 투자심의위원회(Group IC)", // glossary Group IC.ko
  transition: "S12 전환", // lib/review/review-display.ts GATE_DISPLAY
};

export const gateLabel = (id: string | null | undefined): string => labelText(GATE_LABEL, id);

export const DECISION_LABEL: Record<string, string> = {
  go: "진행(GO)",
  hold: "보류(HOLD)",
  kill: "중단(KILL)",
  pending: "대기",
};

// glossary Green Field.ko / Brown Field.ko
export const TRACK_LABEL: Record<string, string> = { greenfield: "그린필드(신규 설립)", brownfield: "브라운필드(인수합병)" };

/** Sub-track names. Source: components/stages/route-decision/constants.ts (GF_SUB / BF_SUB, moved here). */
export const GF_SUB: Record<string, string> = {
  existing_business_rbd: "기존 사업 R&BD 확장", // INTERIM-WORDING Q1 (existing route-decision wording, no glossary term)
  intra_venture: "사내벤처(CVC)",
};
export const BF_SUB: Record<string, string> = {
  m_and_a: "M&A",
  jv: "JV(합작)",
  strategic_investment: "전략적 투자",
  minority_investment: "소수지분 투자",
  partnership: "전략 제휴", // human-approved 2026-10-11 (was "파트너십"; design Q1 resolution)
  rbd: "R&BD(공동연구)",
  corporate_venture: "사내벤처(CVC)",
};
export const SUB_TRACK_LABEL: Record<string, string> = { ...GF_SUB, ...BF_SUB };

/** Undecided track wording (process page / deal page). */
export const TRACK_UNDECIDED_LABEL = "미결정";

/** Track (+ optional sub-track) as text, e.g. "브라운필드(인수합병) · M&A". Null track -> "미결정". */
export function trackLabel(track: string | null | undefined, subTrack?: string | null): string {
  const parts = trackLabelParts(track, subTrack);
  return parts.map((p) => p.label).join(" · ");
}

/** Same as `trackLabel` but per part, so the UI can list the raw keys in a developer-details disclosure. */
export function trackLabelParts(track: string | null | undefined, subTrack?: string | null): LabelResult[] {
  if (!track) return [{ label: TRACK_UNDECIDED_LABEL, raw: "", isFallback: true }];
  const parts = [resolveLabel(TRACK_LABEL, track)];
  if (subTrack) parts.push(resolveLabel(SUB_TRACK_LABEL, subTrack));
  return parts;
}

export const ORIGIN_LABEL: Record<string, string> = {
  internal: "내부 추진",
  joint: "합작",
  external: "외부 인수",
  hybrid: "하이브리드", // components/PromotionPanel.tsx origin option
};

/** Route-decision intent. Source: DecisionTab.tsx option text. */
export const INTENT_LABEL: Record<string, string> = { integration: "통합", capability_access: "역량접근" };

/** Stage status. Source: app/projects/[id]/page.tsx + process/page.tsx STATUS_LABEL (moved here). */
export const STAGE_STATUS_LABEL: Record<string, string> = {
  complete: "완료",
  completed: "완료",
  current: "진행",
  in_progress: "진행", // same wording as `current`
  blocked: "차단",
  locked: "대기",
  pending: "대기", // DECISION_LABEL.pending
  skipped: "미적용",
  terminated: "종료",
};

/** Committee decision mode. Source: components/CommitteePanel.tsx option descriptions. */
export const DECISION_MODE_LABEL: Record<string, string> = {
  agent_team: "위원회 심의 후 제안", // INTERIM-WORDING Q5
  hybrid: "라운드별 인간 입장 포함", // INTERIM-WORDING Q5
  human_only: "인간 심의만", // INTERIM-WORDING Q5
};

/** S12 transition decisions (flow.spec v2.0.0). Source: PortfolioStage.tsx TRANSITION_LABELS (moved here). */
export const TRANSITION_DECISION_LABEL: Record<string, string> = {
  next_tranche_released: "다음 트랜치 집행", // INTERIM-WORDING Q2 (PortfolioStage interim wording)
  held_evidence_incomplete: "보류 — 근거 미완결", // INTERIM-WORDING Q2 (PortfolioStage interim wording)
  graduate_to_core: "코어 사업 전환",
  reduce_or_divest: "축소·매각",
  kill_with_learning_captured: "중단 — 학습 내용 회수",
};

/** RAG dimensions (packages/core-scoring RAG_DIMENSIONS, canonical order). */
export const RAG_DIMENSION_ORDER = ["financial", "market", "data_confidence", "regulatory_permit", "technical_execution", "risk"] as const;
export const RAG_DIMENSION_LABEL: Record<string, string> = {
  // Verbatim from glossary/technical.yaml "RAG Dimension" definition_ko: 재무성·시장·데이터 신뢰도·규제인허가·기술실행·리스크 (Q6 resolved 2026-10-11).
  financial: "재무성",
  market: "시장",
  data_confidence: "데이터 신뢰도",
  regulatory_permit: "규제인허가",
  technical_execution: "기술실행",
  risk: "리스크",
};

/** Korean list of RAG dimension names in canonical order (unknown keys last, input order, as placeholder). */
export function ragDimensionsLabel(keys: readonly string[] | null | undefined): string {
  const given = [...new Set((keys ?? []).filter(Boolean))];
  const known = (RAG_DIMENSION_ORDER as readonly string[]).filter((k) => given.includes(k));
  const unknown = given.filter((k) => !(RAG_DIMENSION_ORDER as readonly string[]).includes(k));
  return [...known.map((k) => RAG_DIMENSION_LABEL[k]!), ...unknown.map(() => UNCLASSIFIED_LABEL)].join(", ");
}

/** Record / field keys that leak into prose. Sources: PortfolioStage RECORD_FIELD, CLOSURE_RECORD_LABEL. */
export const RECORD_KEY_LABEL: Record<string, string> = {
  venture_transition_decision: "S12 전환 결정", // CLOSURE_RECORD_LABEL
  decided_by: "결정자", // CLOSURE_RECORD_LABEL
  learning_capture: "학습 포착", // CLOSURE_RECORD_LABEL
  tranche_condition: "차기 트랜치 조건", // PortfolioStage RECORD_FIELD
  core_handoff: "핵심사업 인계 기록", // PortfolioStage RECORD_FIELD
  divest_plan: "매각/청산 계획", // PortfolioStage RECORD_FIELD
  deal_structure: "투자구조", // INTERIM-WORDING Qx (S10 stage name "투자구조 설계")
  deal_structure_review: "투자구조 검토", // INTERIM-WORDING Qx
};

/** Glossary category (glossary/_schema.yaml enum, stored lowercase; matched case-insensitively). */
export const GLOSSARY_CATEGORY_LABEL: Record<string, string> = {
  business: "사업", // INTERIM-WORDING Q4
  financial: "재무", // INTERIM-WORDING Q4
  legal: "법무", // INTERIM-WORDING Q4 (cf. DD_DOMAIN_LABEL "법무 실사")
  technical: "기술", // INTERIM-WORDING Q4
  unit: "단위", // INTERIM-WORDING Q4
  industry: "산업", // INTERIM-WORDING Q4 (cf. REVIEW_DOMAIN_LABEL.industry)
};
export const glossaryCategoryLabel = (category: string | null | undefined): LabelResult =>
  resolveLabel(GLOSSARY_CATEGORY_LABEL, (category ?? "").toLowerCase());

/** Glossary term `corp_code` -> glossary/industry.yaml corp_code.ko. INTERIM-WORDING Q3 (whether it stays a term). */
export const DART_CORP_CODE_LABEL = "DART 고유번호";

/** Show the English term only when it adds information (case/space-insensitive equal -> null). */
export function dedupTermNames(ko: string | null | undefined, en: string | null | undefined): { primary: string; secondary: string | null } {
  const k = (ko ?? "").trim();
  const e = (en ?? "").trim();
  if (!k) return { primary: e, secondary: null };
  if (!e || e.toLowerCase() === k.toLowerCase()) return { primary: k, secondary: null };
  return { primary: k, secondary: e };
}


export const DD_DOMAIN_LABEL: Record<string, string> = { commercial: "상업 실사", technical: "기술 실사", legal: "법무 실사", financial: "재무 실사", hr: "인사 실사", market: "시장 실사", financing: "자금조달 계획" };

/** DD finding category (dd_finding.category): the DD domains plus `rbd` (db migration 0019 rbd_source rule). */
export const FINDING_CATEGORY_LABEL: Record<string, string> = {
  ...DD_DOMAIN_LABEL,
  rbd: "R&BD 실사", // INTERIM-WORDING Qx (cf. BF_SUB.rbd "R&BD(공동연구)")
};

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
  const hit = CLOSURE_RECORD_LABEL[record];
  if (hit) return hit.label;
  // parameterized keys (e.g. `venture_transition_decision(reduce_or_divest)`) fall back to their base record
  const base = record.replace(/\(.*\)$/, "");
  return CLOSURE_RECORD_LABEL[base]?.label ?? record;
}

/** Closure type (ADR-0152, md_project.closure_type / deal_archive) → Korean
 * name. Same wording as ClosureModal TYPE_LABEL — the archive list and the
 * modal must not drift (R2-E finding 11). Unknown keys fall through. */
export const CLOSURE_TYPE_LABEL: Record<string, string> = {
  killed_at_gate: "게이트 KILL로 종료",
  withdrawn: "철회",
  graduated_to_core: "핵심사업 편입",
  divested: "매각/청산",
  killed_with_learning: "중단(학습 포착)",
  dropped: "제외",
};

export function closureTypeLabel(closureType: string | null | undefined): string {
  return (closureType && CLOSURE_TYPE_LABEL[closureType]) || "—";
}

/** Known English system messages → Korean. Unknown text passes through unchanged. */
const MESSAGE_RULES: Array<[RegExp, string]> = [
  [/LLM provider is not configured[^.]*\.?/i, "AI 모델이 연결되어 있지 않아 이 기능을 실행할 수 없습니다. 관리자에게 AI 모델 설정을 요청하거나, 값을 직접 입력하세요."],
  [/Administrator role required\.?/i, "관리자 권한이 필요합니다."],
  [/Request failed\.?/i, "요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요."],
];

export function localizeMessage(message: string): string {
  for (const [re, ko] of MESSAGE_RULES) if (re.test(message)) return ko;
  return localizeRequirement(message)
    // closure.repository.ts의 영어 전제조건 문구 → 한글 (레코드 키는 라벨 맵이 처리)
    .replace(/The latest S12 transition decision must be '([a-z_]+)'\.?/g, (_m, key) => {
      return `최신 S12 전환 결정이 '${TRANSITION_DECISION_LABEL[key] ?? key}'(으)로 기록되어 있어야 합니다.`;
    });
}

/** Stage requirement text coming from the process spec: keep the meaning, drop set notation. */
export function localizeRequirement(text: string): string {
  return text
    // raw enum token glued to Korean text, e.g. "기회 선택(selected)" -> "기회 선택"
    .replace(/(?<=[가-힣])\s*\([a-z]+(?:_[a-z]+)*\)/g, "")
    // lower-case gate id opening a parenthetical, e.g. "(fs 진행 입력)" -> "(FS 진행 입력)"
    .replace(/\((screening|pre_fs|target_screening|fs|dd|entity_ic|group_ic)(?=\s)/g, (_m, g: string) => `(${GATE_LABEL[g] ?? g}`)
    .replace(/origin\s*∈\s*\{\s*internal\s*,\s*joint\s*\}/g, "내부 추진·합작 프로젝트에 한함")
    .replace(/gate_decision\(kill\)/g, "게이트 중단(KILL) 결정")
    .replace(/missing_artifacts/g, "미완료 산출물 목록");
}

/** Shown beside every action a read-only viewer cannot use. */
export const VIEWER_READONLY_TEXT = "보기 권한만 있습니다";

/** Shown for a null/empty fact on a detail surface (single path for "not recorded"). */
export const NOT_RECORDED_LABEL = "기록 없음";

/** Display text for a possibly empty value; `empty` tells the caller to use the muted style. */
export function displayOrNotRecorded(value: string | number | null | undefined): { text: string; empty: boolean } {
  if (value === null || value === undefined) return { text: NOT_RECORDED_LABEL, empty: true };
  const text = String(value).trim();
  return text === "" ? { text: NOT_RECORDED_LABEL, empty: true } : { text, empty: false };
}

// ── Greenfield S9 plan verification / S10 establishment structure (ADR-0160) ──
// Wording for the greenfield-facing screens. Final terms belong to glossary-curator and the human
// (design 2026-10-11-greenfield-dd-and-investment-structure-by-subtrack-design.md, Q1).

/** Greenfield-facing S9 heading wording (non-default sub-tracks only; the null sub-track keeps the legacy heading). */
export const GF_S9_STAGE_LABEL = "계획 검증"; // INTERIM-WORDING Q1 ("plan verification" family)
/** Greenfield-facing S10 heading wording. */
export const GF_S10_STAGE_LABEL = "설립 구조"; // INTERIM-WORDING Q1 ("establishment structure" family)

/** `greenfield-dd` step ids (procedure v1.1.0) -> display name. */
export const GF_DD_STEP_LABEL: Record<number, string> = {
  1: "부지 방문 실사", // INTERIM-WORDING Q1
  2: "인력 확보 계획(talent pipeline)", // INTERIM-WORDING Q1
  3: "지역사회 수용성", // INTERIM-WORDING Q1
  4: "실사 결과의 가치평가 반영", // INTERIM-WORDING Q1
  5: "게이트 통과 기록", // INTERIM-WORDING Q1
  6: "핵심 인력·역량 준비도", // INTERIM-WORDING Q1
  7: "기술·시장 계획 검증", // INTERIM-WORDING Q1
  8: "설립 준비도(사내벤처)", // INTERIM-WORDING Q1
};

/** Sub-track class shown on the S9 panel (class is 'none' | sub-track | 'unknown'). */
export const GF_SUB_TRACK_CLASS_LABEL: Record<string, string> = {
  none: "신규 부지 설립(세부 트랙 없음)", // INTERIM-WORDING Q1
  existing_business_rbd: GF_SUB.existing_business_rbd,
  intra_venture: GF_SUB.intra_venture,
  unknown: "알 수 없는 세부 트랙", // INTERIM-WORDING Q1
};

/** Establishment legal-entity form wording (UI: '설립 법인 형태') for greenfield routes (stored enum values unchanged). */
export const GF_VEHICLE_LABEL: Record<string, string> = {
  direct: "사내 직접 추진(사업부 내 조직)", // INTERIM-WORDING Q1
  spc: "SPC/SPV(목적법인)",
  holdco: "자회사 설립(홀딩스 경유)", // INTERIM-WORDING Q1
  internal_venture_spinoff: "내부 벤처 분사", // INTERIM-WORDING Q1
  jv: "합작회사(JV) 설립", // INTERIM-WORDING Q1
};

/** JV share wording ("our share in JV") for greenfield; the full-acquisition value is not offered. */
export const GF_JV_STAKE_LABEL: Record<string, string> = {
  majority: "합작 지분 과반",
  minority: "합작 지분 소수",
  joint_control: "공동 통제",
};

/** Suggested funding-source / use row names for greenfield (stored as free-text financing-plan rows). */
export const GF_FUNDING_SOURCE_PRESETS = [
  "자기자본(출자)",
  "프로젝트 파이낸싱",
  "정부 자금·보조금",
  "차입금(금융기관)",
] as const; // INTERIM-WORDING Q1
export const GF_FUNDING_USE_PRESETS = [
  "부지·설비 자체 건설(build)",
  "부지·설비 임차(lease)",
  "연구개발·인력",
  "운전자금",
] as const; // INTERIM-WORDING Q1

/** Capex tranche status wording. */
export const TRANCHE_STATUS_LABEL: Record<string, string> = {
  planned: "집행 예정",
  released: "집행 완료",
  withheld: "보류",
}; // INTERIM-WORDING Q1

// ── ADR-0161 (greenfield S11 execution baseline, S12 post-management) ──
// All strings below are INTERIM-WORDING until the glossary review of ADR-0161 is accepted.

/** pmi_key_talent.status — the DB CHECK allows exactly these three values. */
export const KEY_TALENT_STATUS_LABEL: Record<string, string> = {
  active: "재직 중 (잔존)",
  departed_regretted: "이탈 — 아쉬운 퇴사",
  departed_planned: "이탈 — 계획된 퇴사·이동",
}; // INTERIM-WORDING ADR-0161

/** venture_scorecard.venture_class (Q7 defaults: driving / enabling / emergent). */
export const VENTURE_CLASS_LABEL: Record<string, string> = {
  driving: "성장 주도형 (driving)",
  enabling: "역량 지원형 (enabling)",
  emergent: "신생 탐색형 (emergent)",
}; // INTERIM-WORDING ADR-0161

/** S8 goal judgement shown next to a ramp-up measure; unjudged goals never read as met. */
export const GOAL_JUDGEMENT_LABEL: Record<string, string> = {
  not_judged: "판정 안 됨",
  on_target: "목표 달성",
  deviation: "이탈",
  insufficient_evidence: "근거 부족",
}; // INTERIM-WORDING ADR-0161

/** Korean meaning of the five transition terms for a 신규 사업 (greenfield) project. Terms themselves stay in TRANSITION_DECISION_LABEL. */
export const GREENFIELD_TRANSITION_HELP: Record<string, string> = {
  next_tranche_released: "S10에서 기록한 다음 capex 트랜치의 집행 조건이 충족되어 집행을 진행합니다 (집행 자체는 두 사람이 하는 별도 절차).",
  held_evidence_incomplete: "집행 조건의 근거가 아직 완결되지 않아 트랜치를 보류합니다.",
  graduate_to_core: "손익분기·안정 가동에 도달해 운영 사업부로 인계합니다.",
  reduce_or_divest: "신규 사업 규모를 줄이거나 매각·정리합니다.",
  kill_with_learning_captured: "사업을 중단하고 학습 내용을 S1·S2 기준 비율(base rate)에 환류합니다.",
}; // INTERIM-WORDING ADR-0161

/** S12 post-management items introduced by ADR-0161 (procedure id -> Korean name). */
export const POST_MANAGEMENT_ITEM_LABEL: Record<string, string> = {
  portfolio_venture_monitoring: "포트폴리오 벤처 모니터링 (신규 사업 가동·성과 추적 포함)",
  integration_monitoring: "통합 모니터링 (인수 후 시너지·핵심인력)",
  partnership_monitoring: "파트너십 모니터링 (JV·제휴 조건·성과)",
}; // INTERIM-WORDING ADR-0161

/** API error codes of the PMI write routes and the ADR-0161 routes -> Korean explanation. */
export const ADR0161_ERROR_LABEL: Record<string, string> = {
  not_applicable_track: "PMI는 인수합병·JV·전략적 투자 Route에만 적용됩니다. 신규 사업(greenfield)과 PMI 비대상 세부 트랙에서는 기록할 수 없습니다.",
  needs_classification: "트랙 분류가 확정되지 않아 기록할 수 없습니다 — 먼저 사람이 트랙(case_type)을 분류해야 합니다.",
  human_only: "이 기록은 사람만 할 수 있습니다 (에이전트 불가).",
  lead_required: "정책 이행 기록은 프로젝트 lead만 남길 수 있습니다.",
  already_migrated: "이 프로젝트의 정책 이행 기록이 이미 있습니다.",
  insider_required: "비공개 정보(MNPI) 접근 권한이 있는 사람만 기록할 수 있습니다.",
}; // INTERIM-WORDING ADR-0161
