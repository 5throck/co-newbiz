// establishment-view — pure view helpers for the S11 "설립 실행 — 5단계" table (ADR-0165).
// Client-safe: no server or db imports. The server stays the authority for every rule;
// these helpers only let the form refuse early and map server error codes to Korean text.

export type StepStatus = "pending" | "in_progress" | "done" | "halted" | "escalated";
export const CHANGEABLE_STATUSES = ["in_progress", "done", "halted", "escalated"] as const;
export type ChangeableStatus = (typeof CHANGEABLE_STATUSES)[number];

export const REOPEN_REASON_MIN = 10;
export const REOPEN_REASON_MAX = 2000;

export interface StepRowView {
  step_no: number;
  status: string;
  evidence_url: string | null;
  note: string | null;
  last_recorded_by?: string;
  owner?: string;
  assignee_user_id?: string | null;
  assignee_name?: string | null;
  assignee_active?: boolean;
  reopen_count?: number;
  updated_at: string;
}

export interface MemberView { user_id: string; name: string; project_role: string }

export interface EventView {
  id: string;
  step_no: number;
  kind: "status_change" | "assign" | "reopen";
  from_status: string | null;
  to_status: string | null;
  from_assignee: string | null;
  to_assignee: string | null;
  reason: string | null;
  evidence_url: string | null;
  actor_name: string | null;
  actor_user_id: string;
  /** How the mutation arrived (ADR-0165 addendum); absent on older payloads. */
  via?: "ui" | "api" | "mcp" | "unknown";
  created_at: string;
}

export const STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  in_progress: "진행 중",
  done: "완료",
  halted: "중단",
  escalated: "에스컬레이션",
};

/** Origins to which the 5-step ledger applies (ADR-0047). */
export function establishmentApplies(origin: string | null | undefined): boolean {
  return origin === "internal" || origin === "joint";
}

const ORIGIN_LABEL: Record<string, string> = {
  internal: "내부 추진", joint: "합작", acquisition: "인수", equity_investment: "지분 투자",
};

export function originLabel(origin: string | null | undefined): string {
  return (origin && ORIGIN_LABEL[origin]) || origin || "미분류";
}

/** Info note replacing the empty table for brownfield / unclassified projects. */
export function notApplicableNote(origin: string | null | undefined): string {
  return `이 프로젝트의 추진 방식(${originLabel(origin)})에는 설립 실행 5단계가 적용되지 않습니다 (ADR-0047). 인수·지분 투자 프로젝트는 PMI 킥오프에서 통합 계획을 기록합니다.`;
}

export const ESTABLISHMENT_CAPTION =
  "담당자는 지정된 책임자이며, 최근 기록은 마지막으로 상태를 기록한 사람입니다. 완료와 재개, 담당자 지정은 사람만 기록할 수 있고 에이전트는 진행 중·중단·에스컬레이션만 기록할 수 있습니다.";

/** Status select default: the current status, or 진행 중 when pending / unknown. */
export function defaultFormStatus(current: string | undefined): ChangeableStatus {
  return (CHANGEABLE_STATUSES as readonly string[]).includes(current ?? "") ? (current as ChangeableStatus) : "in_progress";
}

export function evidenceRequired(status: string): boolean {
  return status === "done";
}

/** Early client check; the server re-validates. Returns a Korean message or null. */
export function validateStatusForm(f: { status: string; evidence_url: string; note: string }): string | null {
  if (!(CHANGEABLE_STATUSES as readonly string[]).includes(f.status)) return "상태를 선택하세요.";
  if (evidenceRequired(f.status) && !f.evidence_url.trim() && !f.note.trim()) {
    return "완료 처리에는 증적 URL 또는 비고가 필요합니다.";
  }
  return null;
}

/** Request body of PUT /establishment (origin is the project's, never a free choice). */
export function buildStatusBody(stepNo: number, f: { status: string; evidence_url: string; note: string }, origin: string) {
  return {
    step_no: stepNo,
    status: f.status,
    origin,
    evidence_url: f.evidence_url.trim() || undefined,
    note: f.note.trim() || undefined,
  };
}

export function validateReopenReason(reason: string): string | null {
  const n = reason.trim().length;
  if (n < REOPEN_REASON_MIN) return `재개 사유는 ${REOPEN_REASON_MIN}자 이상 입력하세요.`;
  if (n > REOPEN_REASON_MAX) return `재개 사유는 ${REOPEN_REASON_MAX}자 이하여야 합니다.`;
  return null;
}

const ERROR_TEXT: Record<string, string> = {
  evidence_required: "완료 처리에는 증적 URL 또는 비고가 필요합니다.",
  reopen_required: "완료된 단계는 먼저 재개해야 변경할 수 있습니다.",
  assignee_not_member: "담당자는 이 프로젝트 구성원이어야 합니다.",
  not_applicable: "이 프로젝트의 추진 방식에는 설립 실행 5단계가 적용되지 않습니다.",
};

/** Map a server error code to Korean text; unknown codes keep the (already localized) server message. */
export function establishmentErrorText(code: string | undefined, fallback: string): string {
  return (code && ERROR_TEXT[code]) || fallback;
}

export const CASCADE_CONFIRM_TITLE = "완료확인(5단계)도 함께 재개됩니다. 계속할까요?";

/** The assignee cell: name, or 미지정; a revoked member keeps the name with a text marker. */
export function assigneeView(row: Pick<StepRowView, "assignee_user_id" | "assignee_name" | "assignee_active"> | undefined): { name: string; inactive: boolean } {
  if (!row?.assignee_user_id) return { name: "미지정", inactive: false };
  return { name: row.assignee_name?.trim() || row.assignee_user_id, inactive: row.assignee_active === false };
}

/** Evidence link only for http(s); anything else renders as plain text. */
export function safeEvidenceHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Timestamps arrive as ISO ("...T...Z") or SQLite ("YYYY-MM-DD HH:MM:SS", UTC). */
export function toMs(ts: string): number {
  const t = ts.includes("T") ? ts : ts.replace(" ", "T");
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(t) ? t : `${t}Z`);
}

export const VIA_LABEL: Record<string, string> = { ui: "화면", api: "API", mcp: "MCP" };

/** Call-path suffix for the history row; empty for old rows (unknown) so no noise is added. */
export function viaSuffix(via: string | undefined): string {
  return via && VIA_LABEL[via] ? ` · ${VIA_LABEL[via]}` : "";
}

export function eventSummary(e: EventView): string {
  const base = e.kind === "reopen" ? "완료 취소(재개)"
    : e.kind === "assign" ? "담당자 지정"
    : `상태 변경${e.to_status ? ` → ${STATUS_LABEL[e.to_status] ?? e.to_status}` : ""}`;
  return `${base}${viaSuffix(e.via)}`;
}

export interface ReopenWarning { steps: number[]; count: number; since: string }

/** Server-derived post-approval reopen flag (ADR-0165 addendum): GET /establishment and the IC package carry it. */
export interface ReopenedAfterGateSrc {
  reopened_after_gate?: boolean;
  reopened_after_gate_detail?: { steps: number[]; count: number; since: string } | null;
}

/** The warning is computed on the server (lib/establishment.ts reopenedAfterGate); the UI only renders it. */
export function reopenWarning(src: ReopenedAfterGateSrc | null | undefined): ReopenWarning | null {
  if (!src?.reopened_after_gate) return null;
  const d = src.reopened_after_gate_detail;
  return { steps: d?.steps ?? [], count: d?.count ?? 0, since: d?.since ?? "" };
}

export function reopenWarningText(w: ReopenWarning): string {
  return `투자심의위원회 승인 이후 설립 실행 ${w.steps.join("·")}단계가 재개되었습니다 (${w.count}건). 승인 기록은 자동으로 바뀌지 않으므로, 재개 내용이 승인 전제에 영향을 주는지 확인하고 필요하면 새 결정을 기록하세요.`;
}
