// greenfield-dd-view — pure view helpers for the greenfield S9 sub-track panel (ADR-0160).
// Client-safe: no server or db imports. The server-side selection lives in
// greenfield-subtrack.ts; this module only turns its JSON (the `greenfield_scope`
// object of GET /api/projects/:id/dd and /greenfield-scope) into display rows.
import { DD_DOMAIN_LABEL, GF_DD_STEP_LABEL, GF_S9_STAGE_LABEL, GF_SUB_TRACK_CLASS_LABEL } from "./labels.ts";

export interface GfScope {
  sub_track: string | null;
  sub_track_class: "none" | "existing_business_rbd" | "intra_venture" | "unknown";
  selection_active: boolean;
  opted_in: boolean;
  extra_checklists: string[];
  site: {
    site_required: boolean | null;
    basis: "confirmed" | "default" | "unconfirmed";
    site_steps_apply: boolean;
    /** Legacy two-person field: absent/null now (the confirmation is effective immediately); tolerated and ignored if present. */
    pending_assertion?: { id: string; value: boolean; asserted_by: string; rationale: string; evidence_ref?: string } | null;
    /** Who/when of the effective confirmation, when the server provides them (field names tolerated in either form). */
    confirmed_by?: string | null;
    confirmed_at?: string | null;
    asserted_by?: string | null;
    asserted_at?: string | null;
  };
  na_reason_checklists: string[];
  excluded_steps: number[];
  warnings: string[];
  /** ADR-0160 addendum (b): present only when the workspace scope is active (brownfield and grandfathered payloads omit it). */
  workspace_scope?: WsView;
}

/** The panel is shown for named sub-tracks and for unknown values (warning only); the null sub-track renders nothing new. */
export function showSubTrackPanel(scope: GfScope | null | undefined): boolean {
  return !!scope && scope.sub_track_class !== "none";
}

/** Whether to show the step list (an unknown value falls back to the default step set, so only a warning is shown). */
export function showStepList(scope: GfScope | null | undefined): boolean {
  return !!scope && (scope.sub_track_class === "existing_business_rbd" || scope.sub_track_class === "intra_venture") && scope.selection_active;
}

export function subTrackName(scope: GfScope): string {
  return GF_SUB_TRACK_CLASS_LABEL[scope.sub_track_class] ?? scope.sub_track_class;
}

/** S9 heading: only the named sub-tracks use the plan-verification wording; null and unknown keep the legacy heading. */
export function s9Heading(scope: GfScope | null | undefined): string {
  return showStepList(scope) ? `S9 ${GF_S9_STAGE_LABEL} — 체크리스트 판정` : "S9 실사·검증 — DD 체크리스트 판정";
}

export type SiteControlKind = "unconfirmed" | "confirmed" | "default";

export interface SiteControlState {
  kind: SiteControlKind;
  /** Short status text (never colour-only). */
  text: string;
  /** Whether site steps currently apply. */
  siteStepsApply: boolean;
  /** Text-bearing status icon: neutral info while unconfirmed (an open question, not a failure), check once confirmed. */
  icon: string;
}

/** Procedure steps that only apply when a site is needed (visit and community acceptance). */
export const GF_SITE_STEPS: readonly number[] = [1, 3];

export function siteControlState(scope: GfScope, _meUserId?: string | null): SiteControlState {
  const site = scope.site;
  // A legacy pending_assertion, if a payload still carries one, is ignored: only the effective basis counts.
  if (site.basis === "confirmed") {
    const who = site.confirmed_by ?? site.asserted_by ?? null;
    const when = site.confirmed_at ?? site.asserted_at ?? null;
    const by = who || when ? ` (${[who, when].filter(Boolean).join(", ")})` : "";
    return { kind: "confirmed", text: `확인됨 — 부지 ${site.site_required ? "필요" : "불필요"}${by}`, siteStepsApply: site.site_steps_apply, icon: "✓" }; // INTERIM-WORDING
  }
  if (site.basis === "default") {
    return { kind: "default", text: `세부 트랙 기본값 — 부지 ${site.site_required ? "필요" : "불필요"} (사람 확인 없음)`, siteStepsApply: site.site_steps_apply, icon: "ⓘ" };
  }
  // Neutral wording: an unanswered question, not an error. Steps 1 and 3 are included until a person decides.
  return { kind: "unconfirmed", text: `부지: 아직 확인하지 않았습니다 — 확인 전에는 부지 관련 단계(${GF_SITE_STEPS.join(", ")})가 포함됩니다`, siteStepsApply: true, icon: "ⓘ" }; // INTERIM-WORDING
}

/** Label of the site disclosure: asking while unconfirmed, re-confirming afterwards. */
export function siteDisclosureLabel(kind: SiteControlKind): string {
  return kind === "confirmed" ? "다시 확인하기" : "부지 필요 여부 정하기"; // INTERIM-WORDING
}

/** The server's "no site default" warning is an open question, not a fault: shown as an info note instead of a warning. */
export function isSiteDefaultNote(w: string): boolean {
  return w.includes("부지 필요 여부의 기본값이 없습니다");
}

export function splitScopeWarnings(warnings: string[]): { notes: string[]; warnings: string[] } {
  return { notes: warnings.filter(isSiteDefaultNote), warnings: warnings.filter((w) => !isSiteDefaultNote(w)) };
}

/** Site-related items inside a site checklist (mirrors the server's GF_SITE_ITEM_SCOPE); other items stay reason-free. */
const GF_SITE_ITEM_SCOPE: Record<string, readonly string[]> = {
  "chk-technical-dd-checklist": ["tdd-01", "tdd-02"],
};

/**
 * True when an `na` on this item needs a written reason (server rejects `na` without a note).
 * Item-level: a site checklist requires it only on its site items (tdd-01, tdd-02); sub-track
 * extra checklists keep whole-checklist scope. Without an item id the checklist-level answer is returned.
 */
export function needsNaReason(scope: GfScope | null | undefined, checklistId: string, itemId?: string): boolean {
  if (!scope || !scope.na_reason_checklists.includes(checklistId)) return false;
  const siteItems = GF_SITE_ITEM_SCOPE[checklistId];
  if (siteItems && !scope.extra_checklists.includes(checklistId)) return itemId === undefined || siteItems.includes(itemId);
  return true;
}

export function validateNaReason(note: string): string | null {
  return note.trim() ? null : "해당 없음 사유를 입력하세요.";
}

export interface SiteFormInput { value: boolean | null; rationale: string }

export function validateSiteForm(f: SiteFormInput): string | null {
  if (f.value === null) return "부지 필요 여부를 선택하세요.";
  if (!f.rationale.trim()) return "확인 근거(rationale)를 입력하세요.";
  return null;
}

export function validateOptIn(note: string): string | null {
  return note.trim() ? null : "전환 사유(migration_note)를 입력하세요.";
}

/** What the site-confirmation form still lacks, in field order (empty when submittable). */
export function siteFormMissing(f: SiteFormInput): string[] {
  const missing: string[] = [];
  if (f.value === null) missing.push("부지 필요 여부 선택"); // INTERIM-WORDING
  if (!f.rationale.trim()) missing.push("확인 근거");
  return missing;
}

/** Readable Korean text for any non-2xx greenfield-scope POST outcome. */
export function scopeErrorText(code: string | undefined, status: number | undefined, message: string): string {
  switch (code) {
    case "no_run": return "이 프로젝트에는 분석 실행(run) 기록이 없어 부지 필요 여부를 기록할 수 없습니다. 먼저 분석을 실행하세요."; // INTERIM-WORDING
    case "human_only": return "부지 필요 여부 확인은 사람 계정으로 로그인한 경우에만 할 수 있습니다."; // INTERIM-WORDING
    case "role_required": return "이 작업은 analyst 역할 이상이 필요합니다."; // INTERIM-WORDING
    case "not_greenfield": return "그린필드 경로 프로젝트에서만 기록할 수 있습니다."; // INTERIM-WORDING
    case "already_opted_in": return "이미 세부 트랙 규칙으로 전환된 프로젝트입니다."; // INTERIM-WORDING
    case "not_found": return "현재 유효한 부지 필요 여부 확인이 없습니다 — 화면을 새로고침한 뒤 다시 시도하세요."; // INTERIM-WORDING
    case "write_rejected": return `기록이 거부되었습니다 — 확인한 사람과 다른 사람이 검토해야 하는 등 규칙을 확인하세요. (${message})`; // INTERIM-WORDING
    case "invalid_request": return `입력을 확인하세요 — ${message}`; // INTERIM-WORDING
    default: return status === 401 || status === 403 ? "권한이 없거나 로그인이 만료되었습니다." : message || "기록하지 못했습니다."; // INTERIM-WORDING
  }
}

// ── Workspace scope (ADR-0160 addendum b; design 2026-10-12 sections 6A / 6B) ──────────────────────
// Types mirror the server payload (`greenfield_scope.workspace_scope` and `domains[].items[].scope`).

export type WsCode = "A" | "R" | "X" | "N";

export interface WsPointer {
  checklist_id: string;
  item_id: string;
  stage: string;
  in_s9: boolean;
  status: string | null;
  judged: boolean;
  assessed_by: string | null;
  assessed_at: string | null;
}

export interface WsItemScope {
  checklist_id: string;
  item_id: string;
  overlay_code: WsCode | "C" | null;
  /** Effective code after the site rule (C) and the replacement fallback. */
  code: WsCode;
  judgeable: boolean;
  reading: string | null;
  reason: string | null;
  note: string | null;
  replaced_by: WsPointer[];
  fallback: "missing_from_overlay" | "unapproved" | "replacement_not_judged" | null;
  rule: "overlay" | "site_rule" | "fail_closed";
  steps: number[];
}

export interface WsStepTag {
  step: number;
  purpose: string;
  in_scope: boolean;
  reason: string | null;
  pointers: Array<{ checklist_id: string; item_id: string; stage: string; status: string | null; judged: boolean }>;
}

export interface WsPlanRow {
  step: number;
  purpose: string;
  in_scope: boolean;
  reason: string | null;
  artefact: string | null;
  status: "recorded" | "not_recorded" | "not_tracked";
  detail: string | null;
}

export interface WsPrevious {
  checklist_id: string;
  item_id: string;
  code: "X" | "N";
  status: string;
  assessed_by: string | null;
  assessed_at: string | null;
  stays_unmet: boolean;
}

export interface WsView {
  active: true;
  overlay_version: string;
  scope_key: string;
  tab_labels: Record<string, { en: string; ko: string }>;
  step_tabs: Record<string, WsStepTag[]>;
  plan_readiness: WsPlanRow[];
  previous_scope: WsPrevious[];
  counts: { judged: number; judgeable: number; workspace_judgeable: number; excluded: number; mandatory_unmet: number };
}

/** Minimal shape of a domain tab as the S9 view consumes it. */
export interface WsDomainLike {
  domain: string;
  checklistId: string;
  title: string;
  counted?: boolean;
  counted_reason?: string;
  items: Array<{ id: string; state: { status: string } | null; scope?: WsItemScope }>;
}

/** Key of the virtual last tab (steps 4/5/6 status rows). */
export const PLAN_READINESS_KEY = "plan_readiness";

const EXTRA_TAB_KEY: Record<string, string> = {
  "chk-rbd-technology-checklist": "rbd_technology",
  "chk-entity-formation-checklist": "entity_formation",
};

export function workspaceView(scope: GfScope | null | undefined): WsView | null {
  return scope?.workspace_scope?.active ? scope.workspace_scope : null;
}

/** Overlay tab key of a domain tab: the seven domains use their own key, sub-track extras map by checklist id. */
export function tabKeyOf(domain: Pick<WsDomainLike, "domain" | "checklistId">): string {
  return EXTRA_TAB_KEY[domain.checklistId] ?? domain.domain;
}

/** Tab title: the overlay's interim greenfield label while the workspace scope is active, otherwise the shared Korean label. */
export function tabLabel(scope: GfScope | null | undefined, d: Pick<WsDomainLike, "domain" | "checklistId" | "title">): string {
  const ws = workspaceView(scope);
  const fromOverlay = ws?.tab_labels[tabKeyOf(d)]?.ko;
  return fromOverlay || DD_DOMAIN_LABEL[d.domain] || d.title;
}

export function planReadinessLabel(scope: GfScope | null | undefined): string {
  return workspaceView(scope)?.tab_labels[PLAN_READINESS_KEY]?.ko || "계획 준비 상태"; // INTERIM-WORDING
}

export interface StepTagView {
  step: number;
  label: string;
  inScope: boolean;
  /** Text label for the scope state (never colour only). */
  stateText: string;
  icon: string;
  reason: string | null;
}

/** Procedure steps a tab serves, each with its in-scope / out-of-scope text. Empty when the tab serves no step. */
export function tabStepTags(scope: GfScope | null | undefined, d: Pick<WsDomainLike, "domain" | "checklistId">): StepTagView[] {
  const ws = workspaceView(scope);
  const tags = ws?.step_tabs[tabKeyOf(d)] ?? [];
  return tags.map((t) => ({
    step: t.step,
    label: GF_DD_STEP_LABEL[t.step] ?? t.purpose,
    inScope: t.in_scope,
    stateText: t.in_scope ? "범위 안" : "범위 밖", // INTERIM-WORDING
    icon: t.in_scope ? "✓" : "—",
    reason: t.in_scope ? null : t.reason,
  }));
}

export interface CodeMeta { code: WsCode; icon: string; label: string; hint: string }

const CODE_META: Record<WsCode, Omit<CodeMeta, "code">> = {
  A: { icon: "●", label: "A 그대로 적용", hint: "원문 그대로 판정합니다." }, // INTERIM-WORDING
  R: { icon: "◐", label: "R 그린필드 해석", hint: "그린필드 계획에 맞게 다시 읽어 판정합니다." }, // INTERIM-WORDING
  X: { icon: "⇄", label: "X 대체됨", hint: "다른 항목이 대신 판정합니다." }, // INTERIM-WORDING
  N: { icon: "⊘", label: "N 해당 없음(트랙 규칙)", hint: "이 트랙에서는 판정하지 않습니다." }, // INTERIM-WORDING
};

/** Code badge of an item. A `C` cell (site rule) shows the resolved code plus the rule that decided it. */
export function codeMeta(sc: WsItemScope): CodeMeta & { ruleText: string | null } {
  const base = CODE_META[sc.code];
  const ruleText = sc.rule === "site_rule"
    ? "부지 필요 여부에 따라 정해집니다(C)" // INTERIM-WORDING
    : sc.rule === "fail_closed"
      ? "오버레이에 승인된 행이 없어 그대로 판정합니다" // INTERIM-WORDING
      : null;
  return { code: sc.code, ...base, ruleText };
}

export interface ItemSplit<T> { judgeable: T[]; excluded: T[] }

/** Judgeable rows go to the judgement table; N / X rows that are not judgeable go to the collapsed "excluded by track rule" list. */
export function splitItems<T extends { scope?: WsItemScope }>(items: T[]): ItemSplit<T> {
  const out: ItemSplit<T> = { judgeable: [], excluded: [] };
  for (const i of items) (i.scope && !i.scope.judgeable ? out.excluded : out.judgeable).push(i);
  return out;
}

export function isJudgedStatus(item: { state: { status: string } | null }): boolean {
  return !!item.state && item.state.status !== "pending";
}

/** "x of y in this tab" — judged / judgeable inside one tab; the grand total is NOT restated here. */
export function tabCounts(d: WsDomainLike): { judged: number; judgeable: number; excluded: number } {
  const { judgeable, excluded } = splitItems(d.items);
  return { judged: judgeable.filter(isJudgedStatus).length, judgeable: judgeable.length, excluded: excluded.length };
}

/** Non-blocking notice for a tab that is judgeable but outside the completion count (projects created before 2026-10-01). */
export function notCountedNotice(d: Pick<WsDomainLike, "counted" | "counted_reason">): { text: string } | null {
  // The backend counted_reason is English; the Korean sentence is derived from counted:false and the raw string is never rendered.
  if (d.counted !== false) return null;
  return { text: "참고용 탭입니다. 이 프로젝트는 2026-10-01 이전에 만들어져 이 탭의 판정은 S9 완료 건수와 게이트 판정에 반영되지 않으며, 판정 자체는 그대로 기록됩니다." }; // INTERIM-WORDING
}

/** Where the single "Judged X / Y" line lives: the scope panel for RBD / IV with an active workspace scope, otherwise the stage header. */
export function countLocation(scope: GfScope | null | undefined): "panel" | "header" {
  const named = scope?.sub_track_class === "existing_business_rbd" || scope?.sub_track_class === "intra_venture";
  return named && !!workspaceView(scope) ? "panel" : "header";
}

export interface JudgedLine {
  judged: number;
  /** Y per design section 5: the seven-domain judgeable set. */
  judgeable: number;
  excluded: number;
  mandatoryUnmet: number;
  /** Judged / judgeable in the sub-track extra checklists, shown beside the line (not mixed into X / Y). */
  extra: { judged: number; judgeable: number } | null;
  /** Number of X (replaced by another checklist item) rows in the counted tabs; the helper sentence shows only when > 0. */
  replacedCount: number;
  text: string;
}

export const REPLACED_JUDGED_HELP = "대체 항목이 판정되면 원 항목은 판정 대상에서 빠집니다 — 그때까지는 이 숫자에 포함됩니다."; // INTERIM-WORDING
export const REPLACED_PENDING_NOTE = "N 원 항목은 대체 항목이 판정(통과·미충족)되면 빠집니다"; // INTERIM-WORDING

/** X rows across the given tabs. */
export function countReplaced(domains: WsDomainLike[]): number {
  return domains.reduce((n, d) => n + d.items.filter((i) => i.scope?.code === "X").length, 0);
}

/** True when no replacement pointer is decisive (pass/fail) yet, so the original item is still judgeable. */
export function replacementUndecided(sc: WsItemScope): boolean {
  return sc.code === "X" && !sc.replaced_by.some((p) => p.status === "pass" || p.status === "fail");
}

/**
 * The single completion line. Y = `workspace_judgeable` (design section 5); X is counted from the
 * counted workspace tabs so numerator and denominator cover the same items. Sub-track extra
 * checklists are reported beside it, never silently mixed in.
 */
export function judgedLine(scope: GfScope | null | undefined, domains: WsDomainLike[]): JudgedLine | null {
  const ws = workspaceView(scope);
  if (!ws) return null;
  const workspaceTabs = domains.filter((d) => !EXTRA_TAB_KEY[d.checklistId] && d.counted !== false);
  const judged = workspaceTabs.reduce((n, d) => n + splitItems(d.items).judgeable.filter(isJudgedStatus).length, 0);
  const judgeable = ws.counts.workspace_judgeable;
  const extraJudgeable = ws.counts.judgeable - ws.counts.workspace_judgeable;
  const extraJudged = Math.max(0, ws.counts.judged - judged);
  const extra = extraJudgeable > 0 ? { judged: extraJudged, judgeable: extraJudgeable } : null;
  const text = `판정 ${judged} / ${judgeable}`; // INTERIM-WORDING
  return { judged, judgeable, excluded: ws.counts.excluded, mandatoryUnmet: ws.counts.mandatory_unmet, extra, replacedCount: countReplaced(workspaceTabs), text };
}

const STATUS_TEXT: Record<string, string> = { pending: "판정 대기", pass: "충족", fail: "미충족", na: "해당 없음", waived: "면제(waived)" };
export function statusText(status: string | null | undefined): string {
  return STATUS_TEXT[status ?? "pending"] ?? String(status);
}

/** Read-only line for a "Replaced by" pointer: where it is judged and what is recorded there. */
export function pointerText(p: WsPointer): string {
  const where = p.in_s9 ? "S9 안" : p.stage;
  const state = p.judged ? `판정: ${statusText(p.status)}${p.assessed_by ? ` (${p.assessed_by}${p.assessed_at ? ` · ${p.assessed_at.slice(0, 10)}` : ""})` : ""}` : "아직 판정되지 않음";
  return `${p.checklist_id.replace(/^chk-/, "").replace(/-checklist$/, "")} ${p.item_id} — ${where} — ${state}`; // INTERIM-WORDING
}

export const PLAN_STATUS_TEXT: Record<WsPlanRow["status"], { icon: string; text: string }> = {
  recorded: { icon: "✓", text: "기록됨" }, // INTERIM-WORDING
  not_recorded: { icon: "○", text: "기록 없음" }, // INTERIM-WORDING
  not_tracked: { icon: "—", text: "시스템에서 추적하지 않음" }, // INTERIM-WORDING
};

/** In-page link of a plan-readiness artefact (steps 4 and 5 have one; step 6 is not tracked in the system). */
export function planArtefactHref(step: number): string | null {
  if (step === 4) return "#dd-findings";
  if (step === 5) return "#gate-decision-dd";
  return null;
}

export interface OptInPreviewLike {
  eligible: boolean;
  reason: string | null;
  before: { judged: number; judgeable: number };
  after: { judged: number; judgeable: number; workspace_judgeable: number; excluded: number };
  moves_to_previous_scope: WsPrevious[];
  fails_stay_unmet: WsPrevious[];
}

/** Before / after numbers for the opt-in dialog (all derived from the server preview; nothing is computed client-side). */
export function optInPreviewLines(p: OptInPreviewLike): string[] {
  return [
    `전환 전: 판정 ${p.before.judged} / ${p.before.judgeable}`, // INTERIM-WORDING
    `전환 후: 판정 ${p.after.judged} / ${p.after.judgeable} (제외 ${p.after.excluded}건)`, // INTERIM-WORDING
    `'이전 범위에서 판정됨'으로 옮겨지는 판정: ${p.moves_to_previous_scope.length}건 — 삭제되지 않습니다`, // INTERIM-WORDING
    `미충족으로 남는 판정(fail): ${p.fails_stay_unmet.length}건 — 사람이 다시 판정하기 전까지 미충족입니다`, // INTERIM-WORDING
  ];
}

/** The opt-in is only offered when the server says it is eligible; an empty note blocks the dialog submit. */
export function canOfferWorkspaceOptIn(p: Pick<OptInPreviewLike, "eligible"> | null | undefined): boolean {
  return !!p && p.eligible;
}

export function validateMigrationNote(note: string): string | null {
  return note.trim() ? null : "전환 사유(migration_note)를 입력하세요."; // INTERIM-WORDING
}

/** aria-live text announcing a changed count; empty when nothing changed. */
export function countAnnouncement(line: JudgedLine | null): string {
  return line ? `${line.text}, 필수 미충족 ${line.mandatoryUnmet}건, 트랙 규칙 제외 ${line.excluded}건` : ""; // INTERIM-WORDING
}

/** Out-of-scope procedure steps for the panel's one-line summary (step number, label, reason when the overlay gave one). */
export function outOfScopeSteps(scope: GfScope): Array<{ step: number; label: string; reason: string | null }> {
  const reasons = new Map<number, string | null>();
  const ws = workspaceView(scope);
  if (ws) {
    for (const tags of Object.values(ws.step_tabs)) for (const t of tags) if (!t.in_scope) reasons.set(t.step, t.reason);
    for (const r of ws.plan_readiness) if (!r.in_scope) reasons.set(r.step, r.reason);
  }
  return [...scope.excluded_steps].sort((a, b) => a - b).map((step) => ({ step, label: GF_DD_STEP_LABEL[step] ?? `단계 ${step}`, reason: reasons.get(step) ?? null }));
}

// ── People/organization plan readiness (what the greenfield panel leads with) ─────────────────────────

export interface PeopleStepView {
  step: number;
  label: string;
  /** Text status, never colour only. */
  text: string;
  icon: string;
  detail: string | null;
}

export interface PeoplePlanView {
  heading: string;
  /** Index of the hr domain tab in `domains` (the link target); null when the payload has no hr tab. */
  tabIndex: number | null;
  tabLabel: string;
  /** Judged x / y of the hr tab's own items, shown even when the tab is outside the completion count. */
  judged: number;
  judgeable: number;
  /** True when the tab is not part of the completion count (pre-cutoff project): the x / y is a reference value. */
  reference: boolean;
  steps: PeopleStepView[];
}

/** Step 2 (talent pipeline) and step 6 (core-team readiness) status; step 6 keeps the 'not tracked in system' wording. */
export function peoplePlanView(scope: GfScope | null | undefined, domains: WsDomainLike[]): PeoplePlanView | null {
  if (!scope || !showSubTrackPanel(scope)) return null;
  const idx = domains.findIndex((d) => d.domain === "hr");
  const hr = idx >= 0 ? domains[idx]! : null;
  const ws = workspaceView(scope);
  const c = hr ? tabCounts(hr) : { judged: 0, judgeable: 0 };
  const steps: PeopleStepView[] = [];
  if (ws) {
    const tagged = new Map<number, WsStepTag>();
    for (const tags of Object.values(ws.step_tabs)) for (const t of tags) tagged.set(t.step, t);
    const t2 = tagged.get(2);
    if (t2) {
      const pts = t2.pointers;
      const judged = pts.filter((p) => p.judged).length;
      steps.push({
        step: 2, label: GF_DD_STEP_LABEL[2] ?? t2.purpose,
        text: t2.in_scope ? (pts.length ? `범위 안 — 판정 ${judged} / ${pts.length}` : "범위 안") : "범위 밖", // INTERIM-WORDING
        icon: t2.in_scope ? "✓" : "—", detail: t2.in_scope ? null : t2.reason,
      });
    }
    const row6 = ws.plan_readiness.find((r) => r.step === 6);
    if (row6) {
      const st = PLAN_STATUS_TEXT[row6.status];
      steps.push({ step: 6, label: GF_DD_STEP_LABEL[6] ?? row6.purpose, text: row6.in_scope ? st.text : "범위 밖", icon: row6.in_scope ? st.icon : "—", detail: row6.in_scope ? row6.detail : row6.reason });
    }
  }
  return {
    heading: "계획 준비 상태 — 인력/조직", // INTERIM-WORDING
    tabIndex: hr ? idx : null,
    tabLabel: hr ? tabLabel(scope, hr) : "인력/조직 계획", // INTERIM-WORDING
    judged: c.judged, judgeable: c.judgeable,
    reference: !!hr && notCountedNotice(hr) !== null,
    steps,
  };
}
