// brownfield-dd-view — pure view helpers for the brownfield S9 scope summary and tabs (ADR-0162, design
// 2026-10-12-brownfield-dd-workspace-scope-by-subtrack, task row 4). Client-safe: no server or db imports.
// The server owns the selection (`brownfield_scope` of GET /api/projects/:id/dd); this module only turns that
// JSON into display rows. m_and_a, a null sub-track and grandfathered projects carry no `brownfield_scope`
// key, so every helper here returns null / false for them and the stage renders exactly as before.
// Generic greenfield helpers (splitItems, tabCounts, statusText, pointerText, ...) are reused, not copied.
import { BF_SUB } from "./labels.ts";
import { countReplaced, isJudgedStatus, splitItems, statusText, type OptInPreviewLike, type WsCode, type WsDomainLike, type WsItemScope, type WsPrevious } from "./greenfield-dd-view.ts";

/** Sub-tracks that get the scoped view (m_and_a is the byte-identical baseline). */
export const BF_SCOPED_SUB_TRACKS = ["jv", "strategic_investment", "minority_investment", "partnership", "rbd", "corporate_venture"] as const;

export interface BfWorkspaceView {
  active: true;
  overlay_doc_id?: string;
  overlay_version: string;
  scope_key: string;
  opted_in: boolean;
  /** Attached extra checklists; their excluded sections carry code N. */
  extra_checklists: string[];
  items: Record<string, WsItemScope>;
  previous_scope: WsPrevious[];
  counts: { judged: number; judgeable: number; workspace_judgeable: number; excluded: number; extras_excluded: number; mandatory_unmet: number };
}

export interface BfScopeBlock { sub_track: string; workspace_scope: BfWorkspaceView }

/** The block only when the scoped view is active for a non-baseline sub-track; null otherwise (m_and_a, null, grandfathered, greenfield). */
export function bfScopeBlock(block: BfScopeBlock | null | undefined): BfScopeBlock | null {
  if (!block || !block.workspace_scope?.active) return null;
  if (!(BF_SCOPED_SUB_TRACKS as readonly string[]).includes(block.sub_track)) return null;
  return block;
}

export function bfSubTrackName(subTrack: string): string {
  return BF_SUB[subTrack] ?? subTrack;
}

/** True when the checklist belongs to this scoped project (a workspace domain or an attached extra checklist). */
function inScopeChecklist(block: BfScopeBlock, checklistId: string): boolean {
  const prefix = `${checklistId}:`;
  return Object.keys(block.workspace_scope.items).some((k) => k.startsWith(prefix));
}

/** Server rejects `na` without a note on in-scope checklists (design section 10). */
export function bfNeedsNaReason(block: BfScopeBlock | null | undefined, checklistId: string): boolean {
  const b = bfScopeBlock(block);
  return !!b && inScopeChecklist(b, checklistId);
}

export function isBfExtraTab(block: BfScopeBlock | null | undefined, checklistId: string): boolean {
  return !!bfScopeBlock(block)?.workspace_scope.extra_checklists.includes(checklistId);
}

// ── Code badges (text + icon, never colour only) ────────────────────────────────────────────────────

export interface BfCodeMeta { code: WsCode; icon: string; label: string; hint: string }

const BF_CODE_META: Record<WsCode, Omit<BfCodeMeta, "code">> = {
  A: { icon: "●", label: "A 그대로 적용", hint: "원문 그대로 판정합니다." }, // INTERIM-WORDING
  R: { icon: "◐", label: "R 이 거래 유형에 맞게 읽기", hint: "거래 유형에 맞게 다시 읽어 판정합니다." }, // INTERIM-WORDING
  X: { icon: "⇄", label: "X 대체됨", hint: "다른 항목이 대신 판정합니다." }, // INTERIM-WORDING
  N: { icon: "⊘", label: "N 해당 없음(트랙 규칙)", hint: "이 거래 유형에서는 판정하지 않습니다." }, // INTERIM-WORDING
};

export function bfCodeMeta(sc: WsItemScope): BfCodeMeta & { ruleText: string | null } {
  const ruleText = sc.rule === "fail_closed" ? "승인된 범위 행이 없어 그대로 판정합니다" : null; // INTERIM-WORDING
  return { code: sc.code, ...BF_CODE_META[sc.code], ruleText };
}

// ── Single judged line (shown once, in the panel) ───────────────────────────────────────────────────

export interface BfJudgedLine {
  judged: number;
  judgeable: number;
  /** Workspace items excluded by the track rule. */
  excluded: number;
  /** Extra-checklist items excluded by the track rule, counted separately from `excluded`. */
  extrasExcluded: number;
  mandatoryUnmet: number;
  /** Judged / judgeable in the attached extra checklists, never mixed into the main line. */
  extra: { judged: number; judgeable: number } | null;
  /** Number of X (replaced) rows in the counted tabs; the helper sentence shows only when > 0. */
  replacedCount: number;
  text: string;
}

/** Y = workspace_judgeable; X is counted from the counted workspace tabs so numerator and denominator cover the same items. */
export function bfJudgedLine(block: BfScopeBlock | null | undefined, domains: WsDomainLike[]): BfJudgedLine | null {
  const b = bfScopeBlock(block);
  if (!b) return null;
  const c = b.workspace_scope.counts;
  const extras = new Set(b.workspace_scope.extra_checklists);
  const judged = domains
    .filter((d) => !extras.has(d.checklistId) && d.counted !== false)
    .reduce((n, d) => n + splitItems(d.items).judgeable.filter(isJudgedStatus).length, 0);
  const extraJudgeable = c.judgeable - c.workspace_judgeable;
  const extra = extraJudgeable > 0 ? { judged: Math.max(0, c.judged - judged), judgeable: extraJudgeable } : null;
  return {
    judged, judgeable: c.workspace_judgeable, excluded: c.excluded, extrasExcluded: c.extras_excluded, mandatoryUnmet: c.mandatory_unmet, extra,
    replacedCount: countReplaced(domains.filter((d) => !extras.has(d.checklistId) && d.counted !== false)),
    text: `판정 ${judged} / ${c.workspace_judgeable}`, // INTERIM-WORDING
  };
}

export function bfCountAnnouncement(line: BfJudgedLine | null): string {
  if (!line) return "";
  const extras = line.extra ? `, 추가 체크리스트 ${line.extra.judged} / ${line.extra.judgeable}` : "";
  return `${line.text}, 필수 미충족 ${line.mandatoryUnmet}건, 트랙 규칙 제외 ${line.excluded}건${extras}`; // INTERIM-WORDING
}

// ── Excluded lists ──────────────────────────────────────────────────────────────────────────────────

export interface BfExcludedGroup<T> { key: string; label: string | null; items: T[] }

/** Excluded rows of one tab. Extra checklists group by the item-id prefix (the deal-shape section), the workspace tabs form one group. */
export function bfExcludedGroups<T extends { id: string }>(excluded: T[], isExtra: boolean): BfExcludedGroup<T>[] {
  if (!isExtra) return excluded.length ? [{ key: "all", label: null, items: excluded }] : [];
  const by = new Map<string, T[]>();
  for (const i of excluded) {
    const key = i.id.split("-")[0] ?? i.id;
    by.set(key, [...(by.get(key) ?? []), i]);
  }
  return [...by.entries()].map(([key, items]) => ({ key, label: `${key} 섹션 (${items.length}건)`, items })); // INTERIM-WORDING
}

/** Judgements recorded before the scope took effect that now sit on N / X items, for one checklist. */
export function bfPreviousForTab(block: BfScopeBlock | null | undefined, checklistId: string): WsPrevious[] {
  return (bfScopeBlock(block)?.workspace_scope.previous_scope ?? []).filter((p) => p.checklist_id === checklistId);
}

export function bfPreviousLine(p: WsPrevious): string {
  const who = p.assessed_by ? ` (${p.assessed_by}${p.assessed_at ? ` · ${p.assessed_at.slice(0, 10)}` : ""})` : "";
  return `${p.code === "X" ? "X 대체됨" : "N 해당 없음"} · 기록된 판정: ${statusText(p.status)}${who}`; // INTERIM-WORDING
}

// ── Opt-in ──────────────────────────────────────────────────────────────────────────────────────────

/** The opt-in is a secondary action: offered only when the server preview says eligible, and never when the scope is already active. */
export function bfCanOfferOptIn(block: BfScopeBlock | null | undefined, preview: Pick<OptInPreviewLike, "eligible"> | null | undefined): boolean {
  return !bfScopeBlock(block) && !!preview && preview.eligible;
}

/** Brownfield preview: the greenfield preview plus the extra checklists the opt-in attaches (absent / empty when already attached). */
export type BfOptInPreview = OptInPreviewLike & {
  extras_attached_by_opt_in?: Array<{ checklist_id: string; judgeable: number; excluded: number }>;
};

const BF_EXTRA_LABEL: Record<string, string> = {
  "chk-partnership-checklist": "전략 제휴 체크리스트", // glossary Partnership.ko
  "chk-deal-shape-presigning-checklist": "딜 형태 사전 점검", // INTERIM-WORDING
  "chk-rbd-technology-checklist": "R&BD 기술 체크리스트", // INTERIM-WORDING
  "chk-entity-formation-checklist": "법인 설립 준비 체크리스트", // INTERIM-WORDING
  "chk-ma-special-topics-checklist": "M&A 특수 주제 체크리스트", // INTERIM-WORDING
  "chk-brownfield-feasibility-checklist": "M&A 6대 검증 체크리스트", // INTERIM-WORDING
};

/** Human label for a checklist id; falls back to the raw id so nothing is hidden. */
export function bfExtraChecklistLabel(checklistId: string): string {
  return BF_EXTRA_LABEL[checklistId] ?? checklistId;
}

/** Dialog lines for the extras the opt-in attaches; empty when the field is absent or empty. */
export function bfOptInExtrasLines(p: BfOptInPreview): string[] {
  const extras = p.extras_attached_by_opt_in ?? [];
  if (extras.length === 0) return [];
  const list = extras.map((e) => `${bfExtraChecklistLabel(e.checklist_id)}(판정 대상 ${e.judgeable}건, 제외 ${e.excluded}건)`).join(", ");
  return [
    `전환하면 추가로 붙는 체크리스트: ${list}`, // INTERIM-WORDING
    "추가 체크리스트의 판정 대상 항목도 화면의 '판정 X / Y'에 함께 셉니다.", // INTERIM-WORDING
  ];
}

export function bfScopeErrorText(code: string | undefined, status: number | undefined, message: string): string {
  switch (code) {
    case "human_only": return "작업 범위 전환은 사람 계정으로 로그인한 경우에만 할 수 있습니다."; // INTERIM-WORDING
    case "role_required": return "이 작업은 analyst 역할 이상이 필요합니다."; // INTERIM-WORDING
    case "not_brownfield": return "브라운필드 경로 프로젝트에서만 전환할 수 있습니다."; // INTERIM-WORDING
    case "no_scope_change": return "이 세부 유형은 작업 범위가 바뀌지 않아 전환할 항목이 없습니다."; // INTERIM-WORDING
    case "already_opted_in": return "이미 새 작업 범위로 전환된 프로젝트입니다. 화면을 새로고침하세요."; // INTERIM-WORDING
    case "overlay_unavailable": return "작업 범위 정의를 읽을 수 없어 전환할 수 없습니다. 관리자에게 알리세요."; // INTERIM-WORDING
    case "invalid_request": return `입력을 확인하세요 — ${message}`; // INTERIM-WORDING
    default: return status === 401 || status === 403 ? "권한이 없거나 로그인이 만료되었습니다." : message || "기록하지 못했습니다."; // INTERIM-WORDING
  }
}
