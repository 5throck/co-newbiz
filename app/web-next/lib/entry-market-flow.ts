// ADR-0179 presentational consolidation — the pure gating/status logic for
// the consolidated 진입시장 산정 (EntryMarketFlow) card. NO API or behavior
// change: this only derives the 3-step status rail chips, the disable state
// of steps 2-3 and the step-3 scope warning from data the two existing GET
// endpoints already return. Korean strings via \u escapes are NOT needed
// here in source (components render them), but tests over this module are
// ASCII-only per repo rule — the strings are exported so tests compare the
// exported constants.
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

// --- Tab model (2026-10-17 decider feedback) ---------------------------------
// The 3-step status rail becomes a TAB control (TabNav, page-local state —
// not a route change): each tab carries its own status chip and, on tab 1,
// the newer-version hint. Locked tabs stay VISIBLE with their chips so a
// person can see why steps 2-3 are gated; their bodies render the disable
// reason (both step panels already do — deriveEntryTabs only marks them).

export const TAB1_LABEL = "1. S1 링크";
export const TAB2_LABEL = "2. 대상 범위";
export const TAB3_LABEL = "3. 진입시장 유도";
/** Shown in tab 1's body when the industry has no completed S1 version to pick. */
export const NO_COMPLETED_VERSIONS =
  "연결 가능한 완료된 S1 시장규모 버전이 없습니다 — 먼저 S1 시장규모 분석을 완료하세요.";
/** Select placeholder — the default selection is the auto-linked (latest
 *  completed) version; empty value = no pick yet. */
export const VERSION_PLACEHOLDER = "연결할 S1 시장규모 버전 선택";

export type EntryTabKey = "link" | "scope" | "derivation";

export interface EntryTab {
  key: EntryTabKey;
  label: string;
  /** The tab's own status chip (자동/수동/없음 · 설정/미설정 · 유도 있음/없음). */
  chip: RailChip;
  /** Locked tabs stay visible; their bodies render the disable reason. */
  locked: boolean;
  /** Newer-version hint — tab 1 only, only while a (manual) link is kept. */
  newerHint: string | null;
}

/** Derive the tab control from the flow status. Pure. */
export function deriveEntryTabs(flow: EntryFlowStatus): EntryTab[] {
  const locked = !flow.steps23Enabled;
  return [
    { key: "link", label: TAB1_LABEL, chip: flow.step1, locked: false, newerHint: flow.newerHint },
    { key: "scope", label: TAB2_LABEL, chip: flow.step2, locked, newerHint: null },
    { key: "derivation", label: TAB3_LABEL, chip: flow.step3, locked, newerHint: null },
  ];
}
