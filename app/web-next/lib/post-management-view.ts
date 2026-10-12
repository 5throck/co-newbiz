// post-management-view — pure view helpers for the S12 post-management panel, the PMI page
// guard and the policy-migration panel (ADR-0161 Row 3). Client-safe: no server or db
// imports. The server stays the authority; these shapes mirror GET /post-management and
// GET /policy-migration.
import {
  ADR0161_ERROR_LABEL,
  GOAL_JUDGEMENT_LABEL,
  POST_MANAGEMENT_ITEM_LABEL,
  VENTURE_CLASS_LABEL,
} from "./labels.ts";

export interface PostManagementApplicability {
  route: { track: string | null; sub_track: string | null; origin: string | null; case_type: string | null; basis: string };
  portfolio_venture_monitoring: boolean;
  integration_monitoring: boolean;
  partnership_monitoring: boolean;
  pmi_applies: boolean;
  blocking: false;
}

export interface RampUpMeasure {
  section: string; measure_key: string; venture_class: string; target_value: string | null; actual_value: string | null; status: string;
}
export interface RampUpGoal {
  goal_id: string; metric_key: string; label: string | null; direction: string; target_value: number; judgement: string; reference_only: true;
}
export interface VentureClassOverrideEntry { review_cycle: string; before: string; after: string; note: string | null; by: string; at: string }
export interface EffectiveVentureClassView {
  default: string | null;
  effective: string | null;
  overridden: boolean;
  override: VentureClassOverrideEntry | null;
}
export interface GreenfieldRampUp {
  review_cycle: string | null;
  default_venture_class: string | null;
  venture_class?: EffectiveVentureClassView;
  measure_keys?: { financial: readonly string[]; strategic: readonly string[] };
  measures: RampUpMeasure[];
  goals: RampUpGoal[];
  gate_blocking: false;
}
export interface IntegrationMonitoring {
  synergy: { certifications: number; latest: { id: string; run_rate_bp: number; sustained_quarters: number; signed_at: string } | null };
  key_talent: { total: number; active: number; departed_regretted: number; departed_planned: number; retention_pct: number | null };
  recommended: true;
}
export interface PartnershipMonitoring {
  jv_terms: number;
  review_cycle: string | null;
  measures: Array<{ section: string; measure_key: string; status: string }>;
  recommended: true;
}
export interface PostManagementView {
  applicability: PostManagementApplicability;
  greenfield_ramp_up: GreenfieldRampUp | null;
  integration_monitoring: IntegrationMonitoring | null;
  partnership_monitoring: PartnershipMonitoring | null;
}

export interface ApplicableItem {
  key: "portfolio_venture_monitoring" | "integration_monitoring" | "partnership_monitoring";
  label: string;
  applies: boolean;
  /** Text that carries the meaning next to the chip (never colour only). */
  chip: string;
  cls: "status-amber" | "status-not-started";
}

/** The three ADR-0161 S12 items. Every applicable one is "recommended"; S12 has no gate, so none blocks. */
export function applicableItems(a: PostManagementApplicability): ApplicableItem[] {
  const keys = ["portfolio_venture_monitoring", "integration_monitoring", "partnership_monitoring"] as const;
  return keys.map((key) => ({
    key,
    label: POST_MANAGEMENT_ITEM_LABEL[key],
    applies: a[key],
    chip: a[key] ? "○ 권장 (차단하지 않음)" : "— 적용 대상 아님", // INTERIM-WORDING
    cls: a[key] ? "status-amber" : "status-not-started",
  }));
}

export const isGreenfieldRampUp = (v: PostManagementView | null): v is PostManagementView & { greenfield_ramp_up: GreenfieldRampUp } =>
  !!v && v.greenfield_ramp_up !== null;

export const ventureClassText = (cls: string | null) => (cls ? VENTURE_CLASS_LABEL[cls] ?? cls : "—");

/** An unjudged S8 goal reads "판정 안 됨"; it never reads as met. */
export const goalJudgementText = (judgement: string) => GOAL_JUDGEMENT_LABEL[judgement] ?? GOAL_JUDGEMENT_LABEL.not_judged;

export const goalJudgementMeta = (judgement: string): { icon: string; cls: string } => {
  if (judgement === "on_target") return { icon: "●", cls: "status-green" };
  if (judgement === "deviation") return { icon: "◐", cls: "status-amber" };
  return { icon: "○", cls: "status-not-started" };
};

export const GOAL_DIRECTION_LABEL: Record<string, string> = { gte: "이상", lte: "이하" }; // INTERIM-WORDING

export const goalDirectionText = (d: string) => GOAL_DIRECTION_LABEL[d] ?? d;

/** run_rate_bp (basis points) as a percentage string. */
export const bpToPercent = (bp: number) => `${(bp / 100).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;

export const retentionText = (pct: number | null) => (pct === null ? "—" : `${pct.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`);

/** Message for a PMI write that the server refused as not applicable to this track. */
export function pmiErrorText(code: string | undefined, message: string | undefined, fallback: string): string {
  if (code === "not_applicable_track") return ADR0161_ERROR_LABEL.not_applicable_track;
  return message || fallback;
}

export const PMI_HIDDEN_NOTE =
  "이 프로젝트는 신규 사업(greenfield) 또는 PMI 비대상 세부 트랙이므로 PMI 화면은 조회만 가능하고 기록할 수 없습니다. 신규 사업의 사후 관리는 S12 포트폴리오 화면에서 확인합니다."; // INTERIM-WORDING

// ── Policy migration (ADR-0161 retroactive application) ──────────────────

export interface PolicyMigrationApplies {
  track: string | null;
  sub_track: string | null;
  greenfield_execution_baseline: "applies" | "not_applicable" | "needs_classification";
  portfolio_venture_monitoring: boolean;
  integration_monitoring: boolean;
  partnership_monitoring: boolean;
  pmi_tab: boolean;
}
/** migration_note is a <=120 char summary; the full text lives in the append-only record, identified by migration_note_hash. */
export interface PolicyMigrationEntry { actor: string; at: string; completed_stages: string[]; migration_note: string; migration_note_hash?: string | null }
export interface PolicyMigrationView {
  applies: PolicyMigrationApplies;
  completed_stages: string[];
  entry: PolicyMigrationEntry | null;
}

export interface MigrationPreviewRow { label: string; applies: boolean; text: string }

/** What ADR-0161 applies to this project, in plain Korean. */
export function migrationPreview(a: PolicyMigrationApplies, completedStages: string[]): MigrationPreviewRow[] {
  const done = (s: string) => completedStages.includes(s);
  const baselineApplies = a.greenfield_execution_baseline === "applies";
  const baselineText = baselineApplies
    ? done("S11") ? "S11을 이미 마쳤으므로 권장 사항입니다 (차단·재개방 없음)." : "S11 완료 전이면 사람이 확인할 때까지 차단합니다."
    : a.greenfield_execution_baseline === "needs_classification" ? "트랙 분류 후에 판단합니다." : "신규 사업이 아니어서 적용되지 않습니다.";
  return [
    { label: "신규 사업 실행 기준선 (S11)", applies: baselineApplies, text: baselineText },
    { label: POST_MANAGEMENT_ITEM_LABEL.portfolio_venture_monitoring, applies: a.portfolio_venture_monitoring, text: a.portfolio_venture_monitoring ? "S12는 게이트가 없어 권장 사항입니다." : "적용되지 않습니다." },
    { label: POST_MANAGEMENT_ITEM_LABEL.integration_monitoring, applies: a.integration_monitoring, text: a.integration_monitoring ? "S12 권장 사항입니다." : "적용되지 않습니다." },
    { label: POST_MANAGEMENT_ITEM_LABEL.partnership_monitoring, applies: a.partnership_monitoring, text: a.partnership_monitoring ? "S12 권장 사항입니다." : "적용되지 않습니다." },
    { label: "PMI 화면", applies: a.pmi_tab, text: a.pmi_tab ? "그대로 유지됩니다." : "숨겨지고 새 기록이 막힙니다 (기존 기록은 삭제되지 않음)." },
  ];
}

export function validateMigrationNote(raw: string, max = 2000): string | null {
  const t = raw.trim();
  if (!t) return "이행 메모(migration_note)를 입력하세요.";
  if (t.length > max) return `이행 메모는 ${max}자 이하여야 합니다.`;
  return null;
}

/** Whether to offer the migration form: lead, no earlier entry. */
export function migrationFormState(isLead: boolean, entry: PolicyMigrationEntry | null): "hidden" | "recorded" | "form" {
  if (!isLead) return "hidden";
  return entry ? "recorded" : "form";
}

// ── S12 greenfield scorecard cycle form (human-only POST post-management/scorecard) ──
// Client-side mirror of recordGreenfieldScorecardFromRequest; the server stays the authority.

export const SCORECARD_FORM_LIMITS = { measures: 20, note: 2000, evidence_ref: 500, measure_key: 120 } as const;
export const VENTURE_CLASS_VALUES = ["driving", "enabling", "emergent"] as const;
export const MEASURE_STATUS_VALUES = ["on_target", "deviation", "insufficient_evidence"] as const;
export const CUSTOM_GOAL_OPTION = "__custom_goal__";
export const EVIDENCE_REF_HINT = "doc:<id> · src:<code> · https://… 형식 (공백 불가)"; // INTERIM-WORDING

const CYCLE_RE = /^\d{4}-Q[1-4]$/;
const GOAL_KEY_RE = /^goal:[a-z0-9_]{1,100}$/;

export interface MeasureDraft {
  /** Stable React key; never sent. */
  uid: string;
  /** A documented key, or CUSTOM_GOAL_OPTION to use `custom_goal`. */
  measure_key: string;
  /** Metric part of a custom goal:<metric_key> (without the prefix). */
  custom_goal: string;
  value: string;
  target_value: string;
  status: string;
  evidence_ref: string;
  observed_at: string;
}

export interface ScorecardFormState {
  review_cycle: string;
  venture_class: string;
  note: string;
  measures: MeasureDraft[];
}

export const emptyMeasureDraft = (uid: string): MeasureDraft => ({
  uid, measure_key: "", custom_goal: "", value: "", target_value: "", status: "on_target", evidence_ref: "", observed_at: "",
});

/** Whether the chosen class differs from the sub-track default (then a note is required and the override is audited). */
export const isVentureOverride = (selected: string, def: string | null) => !!def && !!selected && selected !== def;

export const resolvedMeasureKey = (m: MeasureDraft) => (m.measure_key === CUSTOM_GOAL_OPTION ? `goal:${m.custom_goal.trim()}` : m.measure_key);

/** "" -> null; otherwise a finite number or NaN (invalid). */
function parseNum(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

export interface ScorecardPayload {
  review_cycle: string;
  venture_class?: string;
  note?: string;
  measures: Array<{ measure_key: string; value: number | null; target_value: number | null; status: string; evidence_ref: string; observed_at?: string }>;
}

/** Validate the form (mirrors server rules) and build the request body. Errors are Korean strings. */
export function buildScorecardPayload(
  f: ScorecardFormState,
  def: string | null,
): { ok: true; payload: ScorecardPayload } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const cycle = f.review_cycle.trim();
  if (!CYCLE_RE.test(cycle)) errors.push("리뷰 주기는 YYYY-Q1~Q4 형식이어야 합니다 (예: 2026-Q4)."); // INTERIM-WORDING
  const override = isVentureOverride(f.venture_class, def);
  const note = f.note.trim();
  if (override && !note) errors.push("벤처 클래스를 기본값과 다르게 기록하려면 사유(note)가 필요합니다."); // INTERIM-WORDING
  if (note.length > SCORECARD_FORM_LIMITS.note) errors.push(`사유는 ${SCORECARD_FORM_LIMITS.note}자 이하여야 합니다.`);
  if (f.measures.length === 0) errors.push("측정 지표를 한 개 이상 추가하세요.");
  if (f.measures.length > SCORECARD_FORM_LIMITS.measures * 2) errors.push(`측정 지표는 최대 ${SCORECARD_FORM_LIMITS.measures * 2}개입니다.`);
  const seen = new Set<string>();
  const measures: ScorecardPayload["measures"] = [];
  f.measures.forEach((m, i) => {
    const at = `${i + 1}번째 지표`;
    const key = resolvedMeasureKey(m);
    if (!m.measure_key) errors.push(`${at}: 지표 키를 선택하세요.`);
    else if (m.measure_key === CUSTOM_GOAL_OPTION && !GOAL_KEY_RE.test(key)) errors.push(`${at}: 사업 목표 키는 goal:소문자_숫자_밑줄 형식이어야 합니다.`);
    else if (seen.has(key)) errors.push(`${at}: 지표 키 '${key}'가 중복되었습니다.`);
    if (key) seen.add(key);
    const value = parseNum(m.value);
    const target = parseNum(m.target_value);
    if (Number.isNaN(value)) errors.push(`${at}: 실적은 숫자여야 합니다.`);
    if (Number.isNaN(target)) errors.push(`${at}: 목표는 숫자여야 합니다.`);
    if (!(MEASURE_STATUS_VALUES as readonly string[]).includes(m.status)) errors.push(`${at}: 상태를 선택하세요.`);
    else if (m.status !== "insufficient_evidence" && (value === null || target === null)) errors.push(`${at}: 실적·목표가 없으면 상태는 '근거 부족'이어야 합니다.`);
    const ev = m.evidence_ref.trim();
    if (!ev || ev.length > SCORECARD_FORM_LIMITS.evidence_ref || !isValidEvidenceRefText(ev)) errors.push(`${at}: 증적 참조는 ${EVIDENCE_REF_HINT}이어야 합니다.`);
    const obs = m.observed_at.trim();
    if (obs && !/^\d{4}-\d{2}-\d{2}$/.test(obs)) errors.push(`${at}: 관측일은 YYYY-MM-DD 형식이어야 합니다.`);
    measures.push({
      measure_key: key, value: Number.isNaN(value) ? null : value, target_value: Number.isNaN(target) ? null : target,
      status: m.status, evidence_ref: ev, ...(obs ? { observed_at: obs } : {}),
    });
  });
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    payload: { review_cycle: cycle, ...(f.venture_class ? { venture_class: f.venture_class } : {}), ...(note ? { note } : {}), measures },
  };
}

/** Mirror of db/lib/evidence-ref.ts isValidEvidenceRef (client-safe copy). */
export function isValidEvidenceRefText(ref: string): boolean {
  const t = ref.trim();
  if (t.length === 0 || /\s/.test(t)) return false;
  if (t.startsWith("doc:")) return t.length > 4;
  if (t.startsWith("src:")) return t.length > 4;
  if (t.startsWith("https://")) return t.length > 8;
  return false;
}

export const SCORECARD_ERROR_LABEL: Record<string, string> = {
  invalid_request: "입력값이 올바르지 않습니다 — 아래 안내를 확인하세요.",
  human_only: "스코어카드 기록은 사람만 할 수 있습니다 (에이전트 불가).",
  role_required: "분석가(analyst) 역할 이상만 기록할 수 있습니다.",
  insider_required: "비공개 정보(MNPI) 접근 권한이 있는 사람만 기록할 수 있습니다.",
  not_found: "프로젝트를 찾을 수 없거나 볼 수 있는 권한이 없습니다.",
  not_applicable_track: "스코어카드 주기 기록은 신규 사업(greenfield)에만 적용됩니다.",
  needs_classification: "트랙 분류가 확정되지 않아 기록할 수 없습니다 — 먼저 사람이 트랙(case_type)을 분류해야 합니다.",
  cycle_exists: "이 리뷰 주기는 이미 기록되었습니다 — 한 번 기록한 주기는 바꿀 수 없으니 다음 주기를 입력하세요.",
  run_required: "이 프로젝트에 분석 실행(run)이 없습니다 — 스코어카드 행은 run 단위로 저장됩니다.",
}; // INTERIM-WORDING

/** Korean message for a scorecard POST failure. The server detail is appended for invalid_request only (it names the offending field). */
export function scorecardErrorText(code: string | undefined, status: number | undefined, message: string | undefined): string {
  const key = code ?? (status === 404 ? "not_found" : undefined);
  const base = key ? SCORECARD_ERROR_LABEL[key] : undefined;
  if (key === "invalid_request" && message) return `${base} (${message})`;
  return base ?? message ?? "스코어카드를 기록하지 못했습니다.";
}

/** Plain-Korean line for the effective venture class: "기본값" or "변경됨 (who, when, note)". */
export function effectiveClassText(v: EffectiveVentureClassView | undefined, fallbackDefault: string | null): string {
  if (!v) return `${ventureClassText(fallbackDefault)} — 기본값`;
  if (!v.overridden) return `${ventureClassText(v.effective)} — 기본값`;
  const o = v.override;
  if (!o) return `${ventureClassText(v.effective)} — 변경됨 (기본값 ${ventureClassText(v.default)})`;
  const when = o.at ? o.at.slice(0, 10) : "—";
  return `${ventureClassText(v.effective)} — 변경됨 (${o.by}, ${when}${o.note ? `, 사유: ${o.note}` : ""})`;
}
