// establishment-mode-view — pure view helpers for the Green Field establishment mode
// (ADR-0167): the S10 choice panel and the S11 mode-aware table. Client-safe: no server
// or db imports. The server is the authority for every rule; these helpers only let the
// form refuse early and map server error codes to plain Korean.

export type EstablishmentModeValue = "new_entity" | "business_unit";
export const ESTABLISHMENT_MODE_VALUES: readonly EstablishmentModeValue[] = ["new_entity", "business_unit"];

export const MODE_REASON_MIN = 10;
export const MODE_REASON_MAX = 2000;

export const MODE_LABEL: Record<EstablishmentModeValue, string> = {
  new_entity: "신규 법인 설립",
  business_unit: "신규 사업부 추진",
};

export const MODE_DESCRIPTION: Record<EstablishmentModeValue, string> = {
  new_entity: "새 법인을 세워 추진합니다. 설립 법인 형태를 선택합니다.",
  business_unit: "기존 법인 안에서 사업부로 추진합니다. 법인 설립은 없습니다.",
};

export const MODE_TITLE_S11: Record<EstablishmentModeValue, string> = {
  new_entity: "설립 실행 — 5단계 (신규 법인 설립)",
  business_unit: "사업부 신설 실행 — 5단계 (신규 사업부 추진)",
};

/** Shown on S11 while a Green Field project has not chosen a mode yet. */
export const MODE_NOT_CHOSEN_NOTICE =
  "설립 방식이 아직 정해지지 않았습니다 — S10에서 설립 방식을 확정해야 설립 실행 단계를 기록할 수 있습니다";

export const BUSINESS_UNIT_NO_ISOLATION_NOTE =
  "신규 사업부 추진은 기존 법인 안에서 진행하므로 책임 격리가 되지 않습니다. 사업부에서 생기는 부채와 책임은 모두 기존 법인이 집니다. 투자심의위원회도 이 점을 확인합니다.";

/** A standing risk line the IC package always shows for a mode (ADR-0167, D8). Informational — never gates. */
export interface IcStandingRisk {
  key: string;
  text: string;
}

/**
 * Standing risks the IC package carries for the project's establishment mode. business_unit
 * adds "no liability isolation" (D8); the RAG input is NOT lowered by it. new_entity, an
 * unchosen mode and any other value add nothing, so existing packages are unchanged.
 */
export function icStandingRisks(mode: string | null | undefined): IcStandingRisk[] {
  if (mode === "business_unit") return [{ key: "no_liability_isolation", text: BUSINESS_UNIT_NO_ISOLATION_NOTE }];
  return [];
}

export const MODE_CHANGE_WARNING =
  "설립 방식을 바꿔도 기존 방식으로 기록한 단계는 지워지지 않고 읽기 전용 이력으로 남습니다. 새 방식의 5단계는 대기 상태에서 다시 시작합니다.";

export function isModeValue(v: unknown): v is EstablishmentModeValue {
  return v === "new_entity" || v === "business_unit";
}

export function modeLabel(mode: string | null | undefined): string {
  return isModeValue(mode) ? MODE_LABEL[mode] : "미정";
}

export function s11Title(mode: string | null | undefined): string {
  return isModeValue(mode) ? MODE_TITLE_S11[mode] : "설립 실행 — 5단계";
}

/** Short badge text for the IC materials chip. */
export function modeBadgeText(mode: string | null | undefined): string {
  return isModeValue(mode) ? `설립 방식: ${MODE_LABEL[mode]}` : "설립 방식 미정";
}

// ── State from GET /api/projects/:id/establishment-mode ─────────────────────

export interface ModeHistoryEvent {
  id: string;
  kind: "set" | "change";
  from_mode: EstablishmentModeValue | null;
  to_mode: EstablishmentModeValue;
  reason: string | null;
  actor_user_id: string;
  actor_name: string | null;
  via?: string;
  created_at: string;
}

export interface ModeState {
  mode: EstablishmentModeValue | null;
  active_mode: EstablishmentModeValue | null;
  mode_label: string | null;
  suggested: EstablishmentModeValue | null;
  allowed_modes: EstablishmentModeValue[];
  applicable: boolean;
  steps_started: boolean;
  changed_after_gate: boolean;
  history: ModeHistoryEvent[];
}

export interface ModeOptionView {
  value: EstablishmentModeValue;
  label: string;
  description: string;
  disabled: boolean;
  /** Plain-text reason why the option cannot be chosen (null when selectable). */
  disabledReason: string | null;
}

/** Radio cards. business_unit is disabled with a reason unless the server lists it as allowed (origin internal). */
export function modeOptions(state: Pick<ModeState, "allowed_modes"> | null, origin: string | null | undefined): ModeOptionView[] {
  const allowed = state?.allowed_modes ?? [];
  return ESTABLISHMENT_MODE_VALUES.map((value) => {
    const ok = allowed.includes(value);
    let disabledReason: string | null = null;
    if (!ok) {
      disabledReason = value === "business_unit"
        ? (origin && origin !== "internal"
          ? "신규 사업부 추진은 내부 추진 프로젝트에서만 선택할 수 있습니다. 합작 프로젝트는 신규 법인 설립으로 진행합니다."
          : "이 프로젝트에서는 신규 사업부 추진을 선택할 수 없습니다. 내부 추진 그린필드 프로젝트에서만 선택할 수 있습니다.")
        : "이 프로젝트에서는 설립 방식을 선택할 수 없습니다.";
    }
    return { value, label: MODE_LABEL[value], description: MODE_DESCRIPTION[value], disabled: !ok, disabledReason };
  });
}

export function suggestionText(suggested: EstablishmentModeValue | null | undefined): string | null {
  return suggested ? `승격 단계에서 제안된 방식: ${MODE_LABEL[suggested]} (참고용이며 확정된 값이 아닙니다)` : null;
}

/** Early client check for a change; the first choice needs no reason. */
export function validateModeChange(current: EstablishmentModeValue | null, next: EstablishmentModeValue | null, reason: string): string | null {
  if (!next) return "설립 방식을 선택하세요.";
  if (current === next) return "현재 설립 방식과 같습니다. 다른 방식을 선택하세요.";
  if (current) {
    const n = reason.trim().length;
    if (n < MODE_REASON_MIN) return `설립 방식을 바꾸는 사유는 ${MODE_REASON_MIN}자 이상 입력하세요.`;
    if (n > MODE_REASON_MAX) return `설립 방식을 바꾸는 사유는 ${MODE_REASON_MAX}자 이하여야 합니다.`;
  }
  return null;
}

/** PUT body: reason is sent only when changing a stored mode. */
export function buildModeBody(current: EstablishmentModeValue | null, next: EstablishmentModeValue, reason: string): { mode: EstablishmentModeValue; reason?: string } {
  return current ? { mode: next, reason: reason.trim() } : { mode: next };
}

// ── Error text ──────────────────────────────────────────────────────────────

const ERROR_TEXT: Record<string, string> = {
  not_applicable: "이 프로젝트의 추진 방식에는 설립 방식 선택이 적용되지 않습니다. 설립 방식은 내부 추진·합작 프로젝트에만 있습니다.",
  mode_not_allowed: "신규 사업부 추진은 내부 추진 그린필드 프로젝트에서만 선택할 수 있습니다. 합작 프로젝트는 신규 법인 설립으로 진행합니다.",
  reason_required: "이미 정해진 설립 방식을 바꾸려면 사유(10자 이상)가 필요합니다. 기존 방식의 단계 기록은 이력으로 남습니다.",
  human_only: "설립 방식은 사람이 직접 확정해야 합니다. 에이전트는 제안만 할 수 있습니다.",
  role_required: "설립 방식을 확정하려면 분석가 이상의 역할이 필요합니다.",
  invalid_request: "요청 내용을 확인하세요. 설립 방식은 '신규 법인 설립' 또는 '신규 사업부 추진' 중 하나이며, 바꾸는 사유는 10자 이상 2000자 이하입니다.",
  mode_not_chosen: MODE_NOT_CHOSEN_NOTICE,
  mode_mismatch: "요청한 설립 방식이 이 프로젝트의 현재 설립 방식과 다릅니다. 설립 방식은 S10 화면에서만 바꿀 수 있습니다.",
};

/** Map a server error code to plain Korean; unknown codes keep the (already localized) server message. */
export function modeErrorText(code: string | undefined, fallback: string): string {
  return (code && ERROR_TEXT[code]) || fallback;
}

// ── History ─────────────────────────────────────────────────────────────────

export function modeEventSummary(e: Pick<ModeHistoryEvent, "kind" | "from_mode" | "to_mode">): string {
  return e.kind === "set" || !e.from_mode
    ? `설립 방식 확정 → ${MODE_LABEL[e.to_mode]}`
    : `설립 방식 변경 ${MODE_LABEL[e.from_mode]} → ${MODE_LABEL[e.to_mode]}`;
}

export const MODE_CHANGED_AFTER_GATE_TEXT =
  "투자심의위원회 승인 이후 설립 방식이 바뀌었습니다. 승인 기록은 자동으로 바뀌지 않으므로, 변경이 승인 전제에 영향을 주는지 확인하고 필요하면 새 결정을 기록하세요.";

// ── Business-unit structure form (S10) ─────────────────────────────────────
// No DB field exists for 사업부 신설 형태; the choice is recorded as a labelled prefix in the
// existing free-text "책임 격리" note of the structure hypothesis (generic text field).

export const BUSINESS_UNIT_FORMS = ["independent_unit", "team_in_unit", "cic"] as const;
export type BusinessUnitForm = (typeof BUSINESS_UNIT_FORMS)[number];

export const BUSINESS_UNIT_FORM_LABEL: Record<BusinessUnitForm, string> = {
  independent_unit: "독립 사업부",
  team_in_unit: "기존 사업부 내 팀",
  cic: "사내 독립 기업(CIC)",
};

export const BUSINESS_UNIT_FORM_PREFIX = "사업부 신설 형태: ";

/** Prepend (or replace) the form label at the start of the note. Empty form leaves the note unchanged. */
export function withBusinessUnitForm(note: string, form: BusinessUnitForm | ""): string {
  const stripped = stripBusinessUnitForm(note);
  if (!form) return stripped;
  const label = BUSINESS_UNIT_FORM_LABEL[form];
  return stripped ? `${BUSINESS_UNIT_FORM_PREFIX}${label} / ${stripped}` : `${BUSINESS_UNIT_FORM_PREFIX}${label}`;
}

export function stripBusinessUnitForm(note: string): string {
  const labels = Object.values(BUSINESS_UNIT_FORM_LABEL).map((l) => l.replace(/[()]/g, "\\$&")).join("|");
  return note.replace(new RegExp(`^${BUSINESS_UNIT_FORM_PREFIX}(?:${labels})(?: / )?`), "");
}

// ── S11 table (mode-aware) ──────────────────────────────────────────────────

export const S11_INTRO: Record<EstablishmentModeValue, string> = {
  new_entity:
    "신규 법인 설립으로 확정된 프로젝트의 5단계 설립 절차입니다. 인수·지분 투자 프로젝트는 대신 PMI 킥오프에서 통합 계획을 기록합니다.",
  business_unit:
    "신규 사업부 추진으로 확정된 프로젝트의 5단계 사업부 신설 절차입니다. 기존 법인 안에서 진행하므로 법인 설립 단계는 없습니다. 인수·지분 투자 프로젝트는 대신 PMI 킥오프에서 통합 계획을 기록합니다.",
};

export interface HistoryStepView {
  id: string;
  mode: EstablishmentModeValue;
  step_no: number;
  status: string;
  evidence_url: string | null;
  note: string | null;
  last_recorded_by?: string;
  updated_at: string;
}

/** Previous-mode rows worth showing: pending rows carry no history. Ordered by mode, then step. */
export function visibleHistorySteps<T extends { mode: string; step_no: number; status: string }>(rows: readonly T[] | null | undefined): T[] {
  return (rows ?? []).filter((r) => r.status !== "pending").slice().sort((a, b) => a.mode.localeCompare(b.mode) || a.step_no - b.step_no);
}

/** Step title for a mode, from the API's all_step_titles with a safe fallback. */
export function titleFor(titles: Record<string, Record<string, string>> | null | undefined, mode: string, stepNo: number): string {
  return titles?.[mode]?.[String(stepNo)] ?? `${stepNo}단계`;
}
