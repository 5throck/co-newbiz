// Shared label utilities + the §4 Korean surfaces that stay Korean by design
// (design 2026-10-23-i18n-ui-adoption). Display vocabulary that used to live here as
// Korean maps moved to `common.*` catalog keys pinned in lib/label-keys.ts (T3-6);
// render sites resolve those keys with the ROOT translator.
//
// Kept here:
//   - resolveLabel/labelText/LabelResult: the generic "unknown key never shows raw" helpers
//     (RawKey's disclosure contract). New code should prefer catalog keys via label-keys.ts.
//   - localizeMessage/localizeRequirement: server-English → Korean rewriters at the
//     data boundary (lib/api.ts, ClosureModal fallback) — §4 server-message passthrough.
//   - GLOSSARY_CATEGORY_LABEL: still consumed by app/glossary/page.tsx (extraction pending).
// Client-safe: NO imports (consumed by client components).

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

/** Known English system messages → Korean. Unknown text passes through unchanged. */
const MESSAGE_RULES: Array<[RegExp, string]> = [
  [/LLM provider is not configured[^.]*\.?/i, "AI 모델이 연결되어 있지 않아 이 기능을 실행할 수 없습니다. 관리자에게 AI 모델 설정을 요청하거나, 값을 직접 입력하세요."],
  [/Administrator role required\.?/i, "관리자 권한이 필요합니다."],
  [/Request failed\.?/i, "요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요."],
  [/Failed to fetch\.?/i, "서버에 연결하지 못했습니다. 네트워크 상태를 확인하고 잠시 후 다시 시도하세요."],
];

export function localizeMessage(message: string): string {
  for (const [re, ko] of MESSAGE_RULES) if (re.test(message)) return ko;
  return localizeRequirement(message)
    // closure.repository.ts의 영어 전제조건 문구 → 한글 (레코드 키는 common.closureRecord.* 키가 처리)
    .replace(/The latest S12 transition decision must be '([a-z_]+)'\.?/g, (_m, key: string) => {
      // §4 (ko): the S12 transition term names are payload vocabulary (lib/label-keys.ts TRANSITION_DECISION_KEY)
      const KO_TRANSITION: Record<string, string> = {
        next_tranche_released: "다음 트랜치 집행",
        held_evidence_incomplete: "보류 — 근거 미완결",
        graduate_to_core: "코어 사업 전환",
        reduce_or_divest: "축소·매각",
        kill_with_learning_captured: "중단 — 학습 내용 회수",
      };
      return `최신 S12 전환 결정이 '${KO_TRANSITION[key] ?? key}'(으)로 기록되어 있어야 합니다.`;
    });
}

/** Stage requirement text coming from the process spec: keep the meaning, drop set notation. */
export function localizeRequirement(text: string): string {
  return text
    // ADR-0167: the backend blocker carries an English parenthetical next to the Korean wording
    .replace(/\s*\(establishment mode not chosen(?:,\s*ADR-0167)?\)/gi, "")
    // raw enum token glued to Korean text, e.g. "기회 선택(selected)" -> "기회 선택"
    .replace(/(?<=[가-힣])\s*\([a-z]+(?:_[a-z]+)*\)/g, "")
    // lower-case gate id opening a parenthetical, e.g. "(fs 진행 입력)" -> "(FS 진행 입력)"
    .replace(/\((screening|pre_fs|target_screening|fs|dd|entity_ic|group_ic)(?=\s)/g, (_m, g: string) => `(${KO_GATE_NAME[g] ?? g}`)
    .replace(/origin\s*∈\s*\{\s*internal\s*,\s*joint\s*\}/g, "내부 추진·합작 프로젝트에 한함")
    .replace(/gate_decision\(kill\)/g, "게이트 중단(KILL) 결정")
    .replace(/missing_artifacts/g, "미완료 산출물 목록")
    // S12 전환 결정 요건 문장의 raw 식별자 → 한국어 (사람이 읽는 용도)
    .replace(/어휘 5종:\s*next_tranche_released\s*\/\s*held_evidence_incomplete\s*\/\s*graduate_to_core\s*\/\s*reduce_or_divest\s*\/\s*kill_with_learning_captured/g, "어휘 5종")
    .replace(/decided_by=venture-portfolio-ic/g, "결정자는 사람(벤처 포트폴리오 심의역)")
    .replace(/venture_transition_decision 원장/g, "S12 전환 결정 원장");
}

// §4 (ko): gate display names embedded in spec-requirement rewriting above (KO_GATE_NAME) —
// display rendering resolves common.gate.* via lib/label-keys.ts GATE_LABEL_KEY instead.
const KO_GATE_NAME: Record<string, string> = {
  screening: "스크리닝",
  pre_fs: "예비타당성 검토(Pre-FS)",
  target_screening: "대상 선정",
  fs: "타당성 분석(FS)",
  dd: "실사(DD)",
  entity_ic: "법인 투자심의위원회",
  group_ic: "그룹 투자심의위원회",
};

/** Shown for a null/empty fact on a detail surface (single path for "not recorded"). */
export const NOT_RECORDED_LABEL = "기록 없음";

/** Display text for a possibly empty value; `empty` tells the caller to use the muted style. */
export function displayOrNotRecorded(value: string | number | null | undefined): { text: string; empty: boolean } {
  if (value === null || value === undefined) return { text: NOT_RECORDED_LABEL, empty: true };
  const text = String(value).trim();
  return text === "" ? { text: NOT_RECORDED_LABEL, empty: true } : { text, empty: false };
}

/** Glossary category (glossary/_schema.yaml enum, stored lowercase; matched case-insensitively).
 *  Still consumed by app/glossary/page.tsx — extraction to common.* keys is a follow-up batch. */
export const GLOSSARY_CATEGORY_LABEL: Record<string, string> = {
  business: "사업", // INTERIM-WORDING Q4
  financial: "재무", // INTERIM-WORDING Q4
  legal: "법무", // INTERIM-WORDING Q4 (cf. common.ddDomain.legal "법무 실사")
  technical: "기술", // INTERIM-WORDING Q4
  unit: "단위", // INTERIM-WORDING Q4
  industry: "산업", // INTERIM-WORDING Q4 (cf. common.ragDimension.market "시장")
};
export const glossaryCategoryLabel = (category: string | null | undefined): LabelResult =>
  resolveLabel(GLOSSARY_CATEGORY_LABEL, (category ?? "").toLowerCase());

/** Show the English term only when it adds information (case/space-insensitive equal -> null). */
export function dedupTermNames(ko: string | null | undefined, en: string | null | undefined): { primary: string; secondary: string | null } {
  const k = (ko ?? "").trim();
  const e = (en ?? "").trim();
  if (!k) return { primary: e, secondary: null };
  if (!e || e.toLowerCase() === k.toLowerCase()) return { primary: k, secondary: null };
  return { primary: k, secondary: e };
}
