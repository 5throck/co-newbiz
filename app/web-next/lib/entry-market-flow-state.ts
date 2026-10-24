// Entry-market flow state — the pure logic of the consolidated 진입시장 산정
// card, folded from lib/entry-market-flow.ts (OD-4 of the 2026-10-17 entry-
// market flow redesign) and extended with the 4-state machine + header-strip
// derivation (design §4/§5.1). The state is DERIVED, never stored — computed
// from data the existing GETs already return (plus the additive
// scope_set/scope_unit_basis/legacy_anchor fields on the entry-market GET),
// so no migration and no new server state.
//
// Everything exported below that lived in entry-market-flow.ts keeps its
// exact name and shape; that path is now a one-release re-export shim.
// Korean strings live here as exported constants so the ASCII-only tests
// compare identities, never literals.
import { unitBasisLabel } from "./target-scope.ts";
import { formatNumber, type Locale } from "./format.ts";

export type LinkProvenance = "auto" | "manual" | "none";

export interface RailChip {
  label: string;
  tone: "info" | "warn" | "muted";
}

export interface EntryFlowStatus {
  /** Step 1 (S1 링크) rail chip: 자동/수동/없음 + 최신 버전 힌트 suffix. */
  step1: RailChip;
  /** Step 2 (대상 범위) rail chip: 설정/미설정. */
  step2: RailChip;
  /** Step 3 (진입시장 유도) rail chip: 유도 있음/없음. */
  step3: RailChip;
  /** False → steps 2-3 render disabled (no S1 link). */
  steps23Enabled: boolean;
  /** Why steps 2-3 are disabled + what re-enables them (visible path forward). */
  disableReason: string | null;
  /** Step-3 warning when a link exists but no scope is set (verdict ungradeable). */
  step3ScopeWarning: string | null;
  /** Chip shown when a newer S1 version exists while a manual link is kept. */
  newerHint: string | null;
}

export const STEP1_LINK_AUTO = "자동 연결";
export const STEP1_LINK_MANUAL = "수동 연결";
export const STEP1_LINK_NONE = "연결 없음";
export const STEP2_SET = "설정";
export const STEP2_UNSET = "미설정";
export const STEP3_SET = "유도 있음";
export const STEP3_UNSET = "유도 없음";
export const NEWER_HINT = "최신 버전 힌트";
export const DISABLE_REASON =
  "S1 시장규모 분석이 연결되지 않았습니다 — " +
  "1단계에서 버전 ID로 S1 분석을 연결하면 2·3단계가 활성화됩니다.";
export const SCOPE_WARNING =
  "대상 범위가 미설정이어서 사슬 도달 범위 판정을 매길 수 없습니다 — " +
  "2단계에서 범위를 설정하면 판정이 매겨집니다.";

/** Derive the consolidated flow status. Pure — no fetch, no write. */
export function deriveEntryFlowStatus(input: {
  linkProvenance: LinkProvenance;
  newerVersionAvailable: boolean;
  scopeSet: boolean;
  derivationSet: boolean;
}): EntryFlowStatus {
  const linked = input.linkProvenance !== "none";
  const step1: RailChip = linked
    ? { label: input.linkProvenance === "auto" ? STEP1_LINK_AUTO : STEP1_LINK_MANUAL, tone: "info" }
    : { label: STEP1_LINK_NONE, tone: "muted" };
  return {
    step1,
    step2: input.scopeSet ? { label: STEP2_SET, tone: "info" } : { label: STEP2_UNSET, tone: "muted" },
    step3: input.derivationSet ? { label: STEP3_SET, tone: "info" } : { label: STEP3_UNSET, tone: "muted" },
    steps23Enabled: linked,
    disableReason: linked ? null : DISABLE_REASON,
    step3ScopeWarning: linked && !input.scopeSet ? SCOPE_WARNING : null,
    newerHint: linked && input.newerVersionAvailable ? NEWER_HINT : null,
  };
}

// --- Step headers (2026-10-17 decider feedback: the PR 615 3-tab structure
// is REVERTED — the three steps render STACKED and always visible; these
// labels are the step SECTION headers now, not tab labels; the tab model
// (the tab key/type/derivation trio) is removed. -----------------------------

export const TAB1_LABEL = "1. S1 링크";
export const TAB2_LABEL = "2. 대상 범위";
export const TAB3_LABEL = "3. 진입시장 유도";
/** Shown in tab 1's body when the industry has no completed S1 version to pick. */
export const NO_COMPLETED_VERSIONS =
  "연결 가능한 완료된 S1 시장규모 버전이 없습니다 — 먼저 S1 시장규모 분석을 완료하세요.";
/** Select placeholder — the default selection is the auto-linked (latest
 *  completed) version; empty value = no pick yet. */
export const VERSION_PLACEHOLDER = "연결할 S1 시장규모 버전 선택";

/**
 * Placeholder for `진입 시장 정보` (market_brief). 2026-10-19 decider report:
 * the old hardcoded example named a construction-equipment breaker market, which
 * is meaningless on an unrelated opportunity (e.g. an M&A robotics deal). The
 * example is now composed from the LINKED S1 version's industry and the matrix
 * scope, so it shows the domain the person is actually working in; with no
 * linked version it degrades to a domain-neutral prompt instead of another
 * industry's example.
 */
export function marketBriefExample(input: {
  industryName?: string | null;
  regionLabels?: readonly string[];
  segmentLabels?: readonly string[];
}): string {
  const industry = (input.industryName ?? "").trim();
  const region = (input.regionLabels ?? [])[0]?.trim() ?? "";
  const segment = (input.segmentLabels ?? [])[0]?.trim() ?? "";
  if (industry) {
    const scope = [region, segment].filter(Boolean).join(" ");
    return scope ? `예: ${scope} — ${industry} 수요 중심` : `예: ${industry} — 진입 대상 수요 중심`;
  }
  return "예: 진입할 지역·고객군·제품(서비스)과 핵심 수요 동인을 한 줄로 적어 주세요";
}

// --- FlowState machine (2026-10-17 redesign, design §4/§5.1) -----------------
// UNLINKED → LINKED_UNSCOPED → LINKED_SCOPED → DERIVED, plus the advisory
// +STALE flag (manual link pinned to a non-latest version — never blocks).

export type FlowStateName = "UNLINKED" | "LINKED_UNSCOPED" | "LINKED_SCOPED" | "DERIVED";
/** Which anchor S8 actually uses (business-case-generator order:
 *  derived ?? legacy opportunity fields ?? the 50,000 default). */
export type AnchorInForce = "derived" | "legacy_opportunity" | "legacy_default";

/** Raw opportunity anchor columns (opportunity.market_size_krw_m/growth_rate)
 *  — never UI inputs; shown in the header strip only (design §5.5, OD-2). */
export interface LegacyAnchor {
  market_size_krw_m: number | null;
  growth_rate: number | null;
}

export const STATE_CHIP_DERIVED = "도출값 사용 중";
export const STATE_CHIP_LEGACY_ANCHOR = "레거시 기회 필드 앵커";
export const STATE_CHIP_UNLINKED = "S1 미연결";
/** Legacy anchor visible in the strip (formatting helper below). */
export const ANCHOR_LEGACY_LINE_PREFIX = "앵커: 레거시 기회 필드";
export const ANCHOR_DEFAULT_LINE = "앵커: 기본값 50,000 — 시장규모 미확정";
/** Advisory STALE line: re-pinning re-bases the chain's anchor (warn, OD-6). */
export const STALE_LINE =
  "더 최신 S1 버전 있음 — S1 버전을 바꾸면 사슬 앵커가 새 버전 값으로 다시 계산됩니다";
/** Confirm-styled inline warning before re-pinning S1 with a chain present. */
export const REPIN_WARNING =
  "도출 사슬이 연결되어 있습니다 — S1 버전을 바꾸면 사슬의 앵커가 새 버전의 1차년도 값으로 다시 계산됩니다.";
/** Warning before clearing the link with a chain present (GET turns 409
 *  not_linked and the anchor falls back to legacy — server truth). */
export const UNLINK_CHAIN_WARNING =
  "도출 사슬이 연결되어 있습니다 — 연결을 해제하면 사슬이 도달 불가(not_linked)가 되고 앵커는 레거시 기회 필드로 되돌아갑니다.";

export interface FlowStateHeader {
  /** Persistent card-header state chip: 도출값 사용 중 / 레거시 기회 필드
   *  앵커 / S1 미연결 — the single place the anchor-in-force appears. */
  stateChipLabel: string;
  stateChipTone: "info" | "muted";
  /** The anchor actually in force, one line: derived value / legacy fields /
   *  the 50,000 default. */
  anchorLine: string;
  /** Linked S1 summary `vN · 신뢰도 G` — null when unlinked. */
  s1Line: string | null;
}

export interface FlowState {
  state: FlowStateName;
  /** Advisory: manual link kept while a newer completed version exists. */
  stale: boolean;
  anchorInForce: AnchorInForce;
  chips: { step1: RailChip; step2: RailChip; step3: RailChip };
  warnings: {
    /** Why steps 2-3 are locked (UNLINKED) — rendered in the locked bodies. */
    disableReason: string | null;
    /** Step-3 범위 미설정 warning (LINKED_UNSCOPED). */
    scopeWarning: string | null;
    /** Advisory STALE line for the header strip. */
    staleLine: string | null;
  };
  header: FlowStateHeader;
}

/** Format the strip's legacy-opportunity anchor line (design §5.5). */
export function anchorLegacyLine(legacy: LegacyAnchor | null, locale: Locale | string = "ko"): string {
  const n = legacy?.market_size_krw_m;
  return `${ANCHOR_LEGACY_LINE_PREFIX} (${typeof n === "number" ? formatNumber(n, locale) : "-"} KRW M)`;
}

/** Format the strip's derived-value line: value + the 배율 곱 (design §5.1).
 *  ADR-0181 amendment: the value is in the DECLARED anchor unit (십억 USD/년
 *  etc.) — never labelled KRW M unless the declaration says so; undeclared
 *  renders an honest 미선언 marker. */
export function derivedValueLine(entryMarketKrwM: number, factorProduct: number, unitBasis?: string | null, locale: Locale | string = "ko"): string {
  const label = unitBasis ? unitBasisLabel(unitBasis) : "앵커 단위 미선언";
  return `진입시장 ${formatNumber(entryMarketKrwM, locale)} ${label} (배율 곱 ${factorProduct.toFixed(4)})`;
}

/** Format the linked-S1 summary `vN · 신뢰도 G`. */
export function s1Line(versionNo: number, confidenceGrade: string | null): string {
  return `v${versionNo} · 신뢰도 ${confidenceGrade ?? "-"}`;
}

export interface FlowStateInput {
  linkProvenance: LinkProvenance;
  newerVersionAvailable: boolean;
  scopeSet: boolean;
  derivationSet: boolean;
  /** Server-computed chain value — present only in DERIVED with a computable anchor. */
  computed: { entry_market_krw_m: number; factor_product: number } | null;
  /** Raw opportunity anchor columns (additive on the entry-market GET). */
  legacyAnchor: LegacyAnchor | null;
  /** Linked S1 reference summary for the strip (null when unlinked). */
  s1: { version_no: number; confidence_grade: string | null } | null;
  /** ADR-0181 amendment — the declared anchor unit; null = undeclared. */
  unitBasis?: string | null;
}

/** Derive the whole-card FlowState. Pure — no fetch, no write, no server
 *  coupling: it quotes the same underlying data S8's live resolvers use. */
export function deriveFlowState(input: FlowStateInput): FlowState {
  const linked = input.linkProvenance !== "none";
  const state: FlowStateName = !linked
    ? "UNLINKED"
    : input.derivationSet
      ? "DERIVED"
      : input.scopeSet
        ? "LINKED_SCOPED"
        : "LINKED_UNSCOPED";
  const stale = input.linkProvenance === "manual" && input.newerVersionAvailable;
  const derived = state === "DERIVED" && input.computed != null;
  const anchorInForce: AnchorInForce = derived
    ? "derived"
    : (input.legacyAnchor?.market_size_krw_m ?? null) != null
      ? "legacy_opportunity"
      : "legacy_default";
  const status = deriveEntryFlowStatus({
    linkProvenance: input.linkProvenance,
    newerVersionAvailable: input.newerVersionAvailable,
    scopeSet: input.scopeSet,
    derivationSet: input.derivationSet,
  });
  const header: FlowStateHeader = {
    stateChipLabel: state === "UNLINKED" ? STATE_CHIP_UNLINKED : derived ? STATE_CHIP_DERIVED : STATE_CHIP_LEGACY_ANCHOR,
    stateChipTone: state === "UNLINKED" ? "muted" : "info",
    anchorLine: derived
      ? derivedValueLine(input.computed!.entry_market_krw_m, input.computed!.factor_product, input.unitBasis)
      : anchorInForce === "legacy_opportunity"
        ? anchorLegacyLine(input.legacyAnchor)
        : ANCHOR_DEFAULT_LINE,
    s1Line: input.s1 && linked ? s1Line(input.s1.version_no, input.s1.confidence_grade) : null,
  };
  return {
    state,
    stale,
    anchorInForce,
    chips: { step1: status.step1, step2: status.step2, step3: status.step3 },
    warnings: {
      disableReason: status.disableReason,
      scopeWarning: status.step3ScopeWarning,
      staleLine: stale ? STALE_LINE : null,
    },
    header,
  };
}

// --- Derivation-step form mappers (2026-10-17 redesign slice 2, §5.3) --------
// The derivation step becomes a FIXED 2-step shape (지역 비중 → 세그먼트 비율);
// free 단계 추가 is removed. The names are labels over positions, not new
// schema — the save payload is byte-identical to the previous UI's
// (base: s1_anchor, step:0, step:1 ...).

/** The always-present base steps: 1. 지역 비중, 2. 세그먼트 비율. */
export const DERIVATION_BASE_STEP_COUNT = 2;
export const BASE_STEP_LABELS = ["지역 비중", "세그먼트 비율"] as const;
/** Label over position 3+ — only AI-draft-justified or legacy-stored rows. */
export const EXTRA_STEP_LABEL = "AI 초안 추가 인자";

export interface DerivationStepForm {
  factor: string;
  source: string;
  as_of: string;
  note: string;
  region_tags: string;
  segment_tags: string;
  origin: "ai_suggested" | null;
}

export const EMPTY_DERIVATION_STEP: DerivationStepForm = {
  factor: "", source: "", as_of: "", note: "", region_tags: "", segment_tags: "", origin: null,
};

/** Two always-present empty base cards — the empty state's exact shape. */
export function emptyDerivationSteps(count: number = DERIVATION_BASE_STEP_COUNT): DerivationStepForm[] {
  return Array.from({ length: Math.max(0, count) }, () => ({ ...EMPTY_DERIVATION_STEP }));
}

/** Stored/draft step JSON → form row (tolerant: non-conforming fields degrade
 *  to their empty value; origin marker preserved). */
export function derivationStepToForm(s: Record<string, unknown>): DerivationStepForm {
  const tags = (v: unknown): string => (Array.isArray(v) ? v.filter((t): t is string => typeof t === "string").join(", ") : "");
  return {
    factor: typeof s.factor === "number" ? String(s.factor) : "",
    source: typeof s.source === "string" ? s.source : "",
    as_of: typeof s.as_of === "string" ? s.as_of : "",
    note: typeof s.note === "string" ? s.note : "",
    region_tags: tags(s.region_tags),
    segment_tags: tags(s.segment_tags),
    origin: s.origin === "ai_suggested" ? "ai_suggested" : null,
  };
}

/** Form row → server payload fragment (optional keys omitted exactly as the
 *  previous UI did — the PUT body stays byte-identical). */
export function derivationStepFromForm(s: DerivationStepForm): Record<string, unknown> {
  const tags = (v: string): string[] => v.split(",").map((t) => t.trim()).filter(Boolean);
  const out: Record<string, unknown> = {
    base: "",
    factor: Number(s.factor),
    source: s.source.trim(),
    as_of: s.as_of.trim(),
  };
  if (s.note.trim() !== "") out.note = s.note.trim();
  if (tags(s.region_tags).length > 0) out.region_tags = tags(s.region_tags);
  if (tags(s.segment_tags).length > 0) out.segment_tags = tags(s.segment_tags);
  if (s.origin === "ai_suggested") out.origin = "ai_suggested";
  return out;
}

/** Build the PUT body: the same base chain as before (s1_anchor → step:0 →
 *  step:1 ...). Byte-equal to the previous inline builder for identical form
 *  values — tested against a fixed fixture. */
export function buildDerivationSavePayload(steps: DerivationStepForm[]): Array<Record<string, unknown>> {
  return steps.map((s, i): Record<string, unknown> => ({ ...derivationStepFromForm(s), base: i === 0 ? "s1_anchor" : `step:${i - 1}` }));
}

/** Client-side save pre-check (early message only; the server re-validates
 *  strictly — 400 with a reason, never a silent drop). Returns null when
 *  every row passes. */
export function derivationFormError(steps: DerivationStepForm[]): string | null {
  if (steps.length === 0) return "최소 1단계가 필요합니다 (지우려면 전체 지우기를 사용하세요).";
  const body = buildDerivationSavePayload(steps);
  for (let i = 0; i < body.length; i++) {
    const f = body[i].factor;
    if (typeof f !== "number" || !Number.isFinite(f) || f <= 0 || f > 1) return `steps[${i}].factor는 (0, 1] 배율이어야 합니다.`;
    if (typeof body[i].source !== "string" || (body[i].source as string).trim() === "") return `steps[${i}].source는 필수입니다.`;
    if (typeof body[i].as_of !== "string" || (body[i].as_of as string).trim() === "") return `steps[${i}].as_of는 필수입니다.`;
  }
  return null;
}
