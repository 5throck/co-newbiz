// execution-baseline-view — pure view helpers for the S11 greenfield execution baseline
// panel (ADR-0161 Row 3). Client-safe: no server or db imports. Mirrors the checkable
// shapes and limits of lib/greenfield-execution.ts so a form can refuse early; the
// server stays the authority and its messages are shown as returned.
import { ADR0161_ERROR_LABEL } from "./labels.ts";

// ── Types of GET /api/projects/:id/execution-baseline ────────────────────

export type BaselineApplicability = "applies" | "not_applicable" | "needs_classification";
export type BaselineRequirement =
  | "satisfied" | "blocking" | "recommended" | "reconfirm_required"
  | "not_applicable" | "needs_classification" | "classification_conflict";

export interface Finding { code: string; message: string }
export interface Milestone { name: string; issuer: string; target_date: string; gates_ref: string | null; source_id: string | null }
export interface HiringRow { role_family: string; quarter: string; headcount: number }
export interface KpiTarget { metric_key: string; target_value: number; unit: string | null; due: string }
export interface IncentiveObligation { obligation: string; deadline: string | null; depends_on: string | null; incentive_id: string | null }
export interface BaselineEntries {
  permit_milestones: Milestone[];
  certification_milestones: Milestone[];
  hiring_plan: HiringRow[];
  kpi_targets: KpiTarget[];
  incentive_obligations: IncentiveObligation[];
}
export interface AcknowledgedFinding { code: string; rationale: string }
export interface BaselineConfirmation {
  confirmed_by: string; confirmed_at: string; rationale: string;
  /** Who recorded the confirmed entries (may differ from the confirmer). */
  entries_recorded_by?: string | null;
  tranche_ids: string[]; tranche_hash: string; open_findings: string[];
  acknowledged_findings?: AcknowledgedFinding[];
}
export interface BaselineRecord { id: string; recorded_by: string; recorded_at: string; entries: BaselineEntries; confirmation: BaselineConfirmation | null }
export interface TrancheRow {
  id: string; tranche_no: number; amount: number; currency: string; release_condition: string; status: string; source_stage: string; pending_release: boolean;
}
export interface TrancheReconciliationView {
  tranches: TrancheRow[];
  tranche_total: number;
  tranche_currencies: string[];
  case: { model_id: string | null; capex_total_krw_m: number | null; capex_lines: number; unit_issue: boolean };
  s10_structure_recorded: boolean;
  difference: number | null;
  matches: boolean;
  findings: Finding[];
}
export interface SourceRef { id: string; name: string; agency: string | null; status: string | null }
export interface SourceIncentive { id: string; type: string; program_name: string | null; direction: string | null; status: string | null; application_deadline: string | null; construction_deadline: string | null }
export interface SourceGoal { id: string; metric_key: string; label: string | null; direction: string; target_value: number }
export interface ExecutionBaselineStatus {
  applicability: { state: BaselineApplicability; permit_step_applies: boolean; reason: string };
  requirement: BaselineRequirement;
  requirement_label?: string | null;
  /** True when the S11 predicate blocks on the baseline right now. */
  blocks?: boolean;
  /** Non-blocking warning (needs_classification, reconfirm after S11 complete, recommended). */
  warning?: string | null;
  reconciliation: TrancheReconciliationView | null;
  sources: { permits: SourceRef[]; certifications: SourceRef[]; incentives: SourceIncentive[]; goals_reference_only: SourceGoal[] } | null;
  record: BaselineRecord | null;
  /** Latest CONFIRMED record; may be older than `record`. */
  confirmed_record?: BaselineRecord | null;
  findings: Finding[];
  missing_sections?: string[];
}

export const EMPTY_ENTRIES: BaselineEntries = { permit_milestones: [], certification_milestones: [], hiring_plan: [], kpi_targets: [], incentive_obligations: [] };

// ── Limits (mirror ENTRY_LIMITS in lib/greenfield-execution.ts) ──────────

export const ENTRY_LIMITS = { list: 100, short: 200, text: 1000 } as const;
export const MAX_RATIONALE_LEN = 2000;
export const MAX_MIGRATION_NOTE_LEN = 2000;
export const MAX_ACK_RATIONALE_LEN = 500;
export const MAX_ACKNOWLEDGED_FINDINGS = 50;
export const TRANCHES_CHANGED_CODE = "tranches_changed_since_confirmation";

// ── Requirement / confirmation state ─────────────────────────────────────

export interface RequirementView {
  /** Chip class; the text always carries the meaning (never colour only). */
  cls: "status-green" | "status-amber" | "status-not-started";
  chip: string;
  text: string;
}

/**
 * Retroactive-rule wording (ADR-0161 decision 8). `blocks` is the server's flag (GET `blocks`):
 * it only matters for reconfirm_required, which blocks S11 while S11 is not complete and is a
 * non-blocking warning once S11 is already complete.
 */
export function requirementView(requirement: BaselineRequirement, blocks = true): RequirementView {
  switch (requirement) {
    case "satisfied":
      return { cls: "status-green", chip: "● 기준선 확인됨", text: "프로젝트 리드가 실행 기준선을 확인했습니다." }; // INTERIM-WORDING
    case "recommended":
      return {
        cls: "status-amber",
        chip: "○ 권장 — 차단하지 않음",
        text: "이 프로젝트는 ADR-0161 적용 이전에 S11을 마쳤으므로, 실행 기준선 확인은 권장 사항이며 S11을 다시 열거나 차단하지 않습니다.", // INTERIM-WORDING
      };
    case "blocking":
      return {
        cls: "status-amber",
        chip: "▲ 확인 전까지 S11 차단",
        text: "프로젝트 리드가 실행 기준선을 확인할 때까지 S11을 완료할 수 없습니다.", // INTERIM-WORDING
      };
    case "reconfirm_required":
      return blocks
        ? {
            cls: "status-amber",
            chip: "▲ 재확정 필요 — S11 차단",
            text: "확정 이후 기준선 항목 또는 capex 트랜치가 바뀌었습니다. 재확정할 때까지 S11을 완료할 수 없습니다.", // INTERIM-WORDING
          }
        : {
            cls: "status-amber",
            chip: "▲ 재확정 필요 — 차단하지 않는 경고",
            text: "확정 이후 기준선 항목 또는 capex 트랜치가 바뀌었습니다. S11이 이미 완료되어 차단하지는 않지만 재확정하는 것이 좋습니다.", // INTERIM-WORDING
          };
    case "classification_conflict":
      return { cls: "status-amber", chip: "▲ 트랙 분류 충돌", text: CLASSIFICATION_CONFLICT_TEXT };
    case "needs_classification":
      return { cls: "status-not-started", chip: "○ 트랙 분류 필요", text: "트랙 신호가 없어 적용 여부를 판단할 수 없습니다. 차단하지 않으며 참고 안내입니다." }; // INTERIM-WORDING
    default:
      return { cls: "status-not-started", chip: "○ 적용 대상 아님", text: "신규 사업(greenfield) 프로젝트에만 적용됩니다." }; // INTERIM-WORDING
  }
}

/** classification_conflict blocker wording (mirrors the server blocker prefix; case_type vs route track). */
export const CLASSIFICATION_CONFLICT_TEXT =
  "트랙 분류 충돌을 사람이 정리해야 합니다 — 프로젝트의 case_type과 경로(route) 트랙이 서로 달라 실행 기준선 적용 여부를 정할 수 없습니다. case_type과 route 트랙을 일치시킨 뒤 다시 확인하세요. 이 화면에서는 입력할 수 없습니다."; // INTERIM-WORDING

export interface ConfirmationView {
  cls: "status-green" | "status-amber";
  chip: string;
  /** Extra line shown below the chip (who / when / rationale). */
  detail: string | null;
  /** Who recorded the confirmed entries (differs from the confirmer when another person recorded them). */
  recordedBy: string | null;
  tranchesChanged: boolean;
  /** A newer entries record exists after the confirmed one. */
  entriesNewer: boolean;
}

/**
 * 미확정 / 확정됨 chip. The confirmation shown is the LATEST CONFIRMED record (`confirmed`, which
 * may be older than `record`); newer entries or a changed tranche set after it downgrade the chip.
 */
export function confirmationView(record: BaselineRecord | null, findings: Finding[], confirmed: BaselineRecord | null = null): ConfirmationView {
  const source = confirmed?.confirmation ? confirmed : record;
  const c = source?.confirmation ?? null;
  const tranchesChanged = findings.some((f) => f.code === TRANCHES_CHANGED_CODE);
  if (!c) return { cls: "status-amber", chip: "○ 미확정", detail: null, recordedBy: null, tranchesChanged: false, entriesNewer: false };
  const entriesNewer = !!record && !!source && record.id !== source.id;
  const stale = tranchesChanged || entriesNewer;
  return {
    cls: stale ? "status-amber" : "status-green",
    chip: tranchesChanged ? "▲ 확정됨 — 이후 트랜치 변경" : entriesNewer ? "▲ 확정됨 — 이후 항목 변경" : "● 확정됨",
    detail: `${c.confirmed_by} · ${c.confirmed_at.slice(0, 10)}`,
    recordedBy: c.entries_recorded_by ?? null,
    tranchesChanged,
    entriesNewer,
  };
}

/** True when recording new entries would clear an existing confirmation (the notice the panel must show). */
export function entriesClearConfirmation(record: BaselineRecord | null): boolean {
  return !!record?.confirmation;
}

export interface ReconciliationVerdict {
  cls: "status-green" | "status-amber" | "status-not-started";
  chip: string;
  text: string;
}

/** Exact match only: a difference is a finding for a human, never a pass. */
export function reconciliationVerdict(rec: TrancheReconciliationView): ReconciliationVerdict {
  if (rec.difference === null) {
    return { cls: "status-not-started", chip: "○ 대조 불가", text: "트랜치 합계와 S8 채택 케이스 capex를 대조할 수 없습니다 — 아래 확인 필요 항목을 보세요." }; // INTERIM-WORDING
  }
  if (rec.matches) {
    return { cls: "status-green", chip: "● 정확히 일치", text: "트랜치 합계가 S8 채택 케이스 capex와 정확히 일치합니다 (허용 오차 없음)." }; // INTERIM-WORDING
  }
  return {
    cls: "status-amber",
    chip: `▲ 불일치 — 차이 ${fmtMoney(rec.difference)} 백만 KRW`,
    text: "차이는 확인 필요 항목이며 자동으로 통과되지 않습니다 — 사람이 판단합니다.", // INTERIM-WORDING
  };
}

export const fmtNumber = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 6 });

/**
 * Display-only money format: thousand separators, at most 1 decimal for KRW (백만 KRW) and at
 * most 2 for other currencies. A nonzero value that would round to 0 keeps full precision so a
 * real difference is never shown as "0". Never used for exact-match comparison.
 */
export function fmtMoney(n: number, currency: string | null = "KRW"): string {
  const max = !currency || currency === "KRW" ? 1 : 2;
  const out = n.toLocaleString("ko-KR", { maximumFractionDigits: max });
  return n !== 0 && Number(out.replace(/,/g, "")) === 0 ? fmtNumber(n) : out;
}

/** Withheld tranches are listed but excluded from the total (server rule R5). */
export const isExcludedTranche = (t: { status: string }) => t.status === "withheld";
export const EXCLUDED_TRANCHE_TEXT = "합계 제외 (excluded)"; // INTERIM-WORDING

// ── Findings (Korean text per code) ──────────────────────────────────────

/** Korean wording for every reconciliation finding code; the server message is the fallback for unknown codes. */
export const FINDING_LABEL: Record<string, string> = {
  s10_structure_missing: "S10 투자구조 기록이 없어 트랜치 집행 조건의 근거를 확인할 수 없습니다.",
  no_tranches: "합계에 들어가는 capex 트랜치(집행 예정·집행 완료)가 없습니다.",
  tranche_condition_missing: "집행 조건이 비어 있는 트랜치가 있습니다.",
  tranche_not_from_s10: "S10이 아닌 다른 단계에서 기록된 트랜치가 있습니다.",
  no_adopted_case: "S8 채택 Business Case가 없어 capex를 대조할 수 없습니다.",
  case_capex_missing: "S8 채택 케이스에 capex 행이 없어 트랜치 합계와 대조할 수 없습니다.",
  case_unit_not_comparable: "S8 채택 케이스 capex 행의 단위가 KRW_M(백만 원)으로 명시되지 않아(미기재 포함) 단위를 추정하지 않고 대조하지 않았습니다.",
  tranche_currency_not_comparable: "트랜치 통화가 S8 케이스 통화(KRW)와 달라 환산하지 않고 대조하지 않았습니다.",
  tranche_total_differs: "트랜치 합계가 S8 채택 케이스 capex와 일치하지 않습니다 (허용 오차 없음, 사람이 판단).",
  tranches_changed_since_confirmation: "확정 이후 capex 트랜치가 바뀌었습니다 — 기준선 재확정이 필요합니다.",
  permit_step_not_applicable: "사내벤처에는 인허가·인증 단계가 기본 적용되지 않아 기록된 항목은 참고로만 표시합니다.",
}; // INTERIM-WORDING

/** Korean finding text per code; the raw server message is shown ONLY for unknown codes. */
export function findingText(f: Finding): string {
  return FINDING_LABEL[f.code] ?? f.message;
}

/** Finding codes the confirmer must acknowledge: the reconciliation findings (not the informational notes). */
export function acknowledgeableFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    if (f.code === TRANCHES_CHANGED_CODE || f.code === "permit_step_not_applicable") return false;
    if (seen.has(f.code)) return false;
    seen.add(f.code);
    return true;
  });
}

export interface AckBuild { ok: boolean; acknowledged: AcknowledgedFinding[]; missingCodes: string[]; tooLongCodes: string[] }

/** One required acknowledgement (1..500 chars) per open finding code; no duplicates, at most 50. */
export function buildAcknowledgements(openCodes: string[], texts: Record<string, string>): AckBuild {
  const codes = [...new Set(openCodes)];
  const acknowledged: AcknowledgedFinding[] = [];
  const missingCodes: string[] = [];
  const tooLongCodes: string[] = [];
  for (const code of codes) {
    const t = (texts[code] ?? "").trim();
    if (!t) missingCodes.push(code);
    else if (t.length > MAX_ACK_RATIONALE_LEN) tooLongCodes.push(code);
    else acknowledged.push({ code, rationale: t });
  }
  return { ok: missingCodes.length === 0 && tooLongCodes.length === 0 && codes.length <= MAX_ACKNOWLEDGED_FINDINGS, acknowledged, missingCodes, tooLongCodes };
}

// ── Missing required sections (409 baseline_empty / GET missing_sections) ──

export interface MissingSectionView { key: string; label: string; anchor: string }
const MISSING_SECTION: Record<string, MissingSectionView> = {
  kpi_targets: { key: "kpi_targets", label: "가동(ramp-up) KPI 목표", anchor: "gx-kpi_targets" },
  hiring_plan: { key: "hiring_plan", label: "채용 계획", anchor: "gx-hiring_plan" },
  permit_or_certification_milestones: { key: "permit_or_certification_milestones", label: "인허가 또는 인증 마일스톤 (둘 중 하나 이상)", anchor: "gx-permit_milestones" },
}; // INTERIM-WORDING

export function missingSectionViews(keys: string[] | undefined): MissingSectionView[] {
  return (keys ?? []).map((k) => MISSING_SECTION[k] ?? { key: k, label: k, anchor: "gx-baseline" });
}

// ── Entry forms ──────────────────────────────────────────────────────────

export type EntryKind = keyof BaselineEntries;

export interface EntryField {
  key: string;
  label: string;
  kind: "text" | "date" | "number" | "select";
  required: boolean;
  max?: number;
  placeholder?: string;
}

export interface EntryKindSpec {
  kind: EntryKind;
  title: string;
  description: string;
  fields: EntryField[];
  /** Four display column headers (the fifth, 관리, is added by the table). */
  headers: [string, string, string, string];
  addLabel: string;
}

const MILESTONE_FIELDS = (nameLabel: string): EntryField[] => [
  { key: "name", label: `${nameLabel} 이름`, kind: "text", required: true, max: ENTRY_LIMITS.short },
  { key: "issuer", label: "발급 기관", kind: "text", required: true, max: ENTRY_LIMITS.short },
  { key: "target_date", label: "목표일", kind: "date", required: true },
  { key: "gates_ref", label: "연결 단계 (선택)", kind: "text", required: false, max: ENTRY_LIMITS.short, placeholder: "예: S11 집행 조건" },
  { key: "source_id", label: "출처 기록 (선택)", kind: "select", required: false },
];

export const ENTRY_SPECS: Record<EntryKind, EntryKindSpec> = {
  permit_milestones: {
    kind: "permit_milestones",
    title: "인허가 마일스톤",
    description: "인허가는 운영할 수 있게 해 주는 것입니다. 인증과는 발급 기관·절차·일정이 달라 별도 목록으로 기록합니다.", // INTERIM-WORDING
    fields: MILESTONE_FIELDS("인허가"),
    headers: ["인허가 이름", "발급 기관", "목표일", "연결 단계 · 출처"],
    addLabel: "인허가 마일스톤 추가",
  },
  certification_milestones: {
    kind: "certification_milestones",
    title: "인증 마일스톤",
    description: "인증은 판매할 수 있게 해 주는 것입니다. 인허가와 분리해 기록합니다.", // INTERIM-WORDING
    fields: MILESTONE_FIELDS("인증"),
    headers: ["인증 이름", "발급 기관", "목표일", "연결 단계 · 출처"],
    addLabel: "인증 마일스톤 추가",
  },
  hiring_plan: {
    kind: "hiring_plan",
    title: "인력/조직 계획 — 채용 계획",
    description: "직군별·분기별 인원 합계만 기록합니다. 개인 단위 정보는 입력하지 않습니다.", // INTERIM-WORDING
    fields: [
      { key: "role_family", label: "직군", kind: "text", required: true, max: 100 },
      { key: "quarter", label: "분기 (YYYY-Qn)", kind: "text", required: true, placeholder: "2027-Q1" },
      { key: "headcount", label: "인원 (명)", kind: "number", required: true },
    ],
    headers: ["직군", "분기", "인원", "누적 인원 (표시 순서 기준)"],
    addLabel: "채용 계획 추가",
  },
  kpi_targets: {
    kind: "kpi_targets",
    title: "가동(ramp-up) KPI 목표",
    description: "S12 스코어카드가 대조할 목표값입니다. 'goal:' 접두 지표는 S8 사업 목표를 참고 증적으로만 가리키며 합격·불합격 판정이 아닙니다.", // INTERIM-WORDING
    fields: [
      { key: "metric_key", label: "지표 키", kind: "text", required: true, max: 80, placeholder: "예: utilisation_pct 또는 goal:revenue" },
      { key: "target_value", label: "목표값", kind: "number", required: true },
      { key: "unit", label: "단위 (선택)", kind: "text", required: false, max: 20 },
      { key: "due", label: "기한 (YYYY-Qn 또는 YYYY-MM-DD)", kind: "text", required: true },
    ],
    headers: ["지표 키", "목표값", "단위", "기한"],
    addLabel: "KPI 목표 추가",
  },
  incentive_obligations: {
    kind: "incentive_obligations",
    title: "인센티브 의무 등록부",
    description: "보조금·세제 혜택에 딸린 의무(고용 유지, 투자 이행 등)와 기한입니다. 이행하지 못하면 환수될 수 있습니다.", // INTERIM-WORDING
    fields: [
      { key: "obligation", label: "의무 내용", kind: "text", required: true, max: ENTRY_LIMITS.text },
      { key: "deadline", label: "기한 (선택)", kind: "date", required: false },
      { key: "depends_on", label: "선행 조건 (선택)", kind: "text", required: false, max: ENTRY_LIMITS.short },
      { key: "incentive_id", label: "출처 인센티브 (선택)", kind: "select", required: false },
    ],
    headers: ["의무", "기한", "선행 조건", "출처 인센티브"],
    addLabel: "인센티브 의무 추가",
  },
};

export const ENTRY_KINDS: EntryKind[] = ["permit_milestones", "certification_milestones", "hiring_plan", "kpi_targets", "incentive_obligations"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const QUARTER_RE = /^\d{4}-Q[1-4]$/;
const METRIC_RE = /^(goal:)?[a-z0-9_.-]{1,80}$/;
const isDate = (v: string) => DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

export type EntryBuild<T> = { ok: true; value: T } | { ok: false; message: string };
export type EntryValues = Record<string, string>;

function text(values: EntryValues, key: string): string {
  return (values[key] ?? "").trim();
}

function checkLengths(kind: EntryKind, values: EntryValues): string | null {
  for (const f of ENTRY_SPECS[kind].fields) {
    const v = text(values, f.key);
    if (f.required && !v) return `${f.label}을(를) 입력하세요.`;
    if (f.max && v.length > f.max) return `${f.label}은(는) ${f.max}자 이하여야 합니다.`;
  }
  return null;
}

/** Validate and normalise one form into the entry shape the API stores. Same rules as the server parser. */
export function buildEntry(kind: EntryKind, values: EntryValues): EntryBuild<Milestone | HiringRow | KpiTarget | IncentiveObligation> {
  const lengthProblem = checkLengths(kind, values);
  if (lengthProblem) return { ok: false, message: lengthProblem };
  if (kind === "permit_milestones" || kind === "certification_milestones") {
    const date = text(values, "target_date");
    if (!isDate(date)) return { ok: false, message: "목표일은 YYYY-MM-DD 날짜여야 합니다." };
    return {
      ok: true,
      value: {
        name: text(values, "name"), issuer: text(values, "issuer"), target_date: date,
        gates_ref: text(values, "gates_ref") || null, source_id: text(values, "source_id") || null,
      },
    };
  }
  if (kind === "hiring_plan") {
    const q = text(values, "quarter");
    if (!QUARTER_RE.test(q)) return { ok: false, message: "분기는 YYYY-Qn 형식이어야 합니다 (예: 2027-Q1)." };
    const n = Number(text(values, "headcount"));
    if (!Number.isInteger(n) || n < 0 || n > 100000) return { ok: false, message: "인원은 0~100000 사이의 정수여야 합니다." };
    return { ok: true, value: { role_family: text(values, "role_family"), quarter: q, headcount: n } };
  }
  if (kind === "kpi_targets") {
    const key = text(values, "metric_key");
    if (!METRIC_RE.test(key)) return { ok: false, message: "지표 키는 소문자·숫자·_ . - (선택 접두 goal:) 1~80자여야 합니다." };
    const raw = text(values, "target_value");
    const target = Number(raw);
    if (raw === "" || !Number.isFinite(target)) return { ok: false, message: "목표값은 유한한 숫자여야 합니다." };
    const due = text(values, "due");
    if (!QUARTER_RE.test(due) && !isDate(due)) return { ok: false, message: "기한은 YYYY-Qn 또는 YYYY-MM-DD 형식이어야 합니다." };
    return { ok: true, value: { metric_key: key, target_value: target, unit: text(values, "unit") || null, due } };
  }
  const dl = text(values, "deadline");
  if (dl && !isDate(dl)) return { ok: false, message: "기한은 YYYY-MM-DD 날짜여야 합니다." };
  return {
    ok: true,
    value: { obligation: text(values, "obligation"), deadline: dl || null, depends_on: text(values, "depends_on") || null, incentive_id: text(values, "incentive_id") || null },
  };
}

/** Form values for editing an existing row. */
export function valuesOf(kind: EntryKind, row: object): EntryValues {
  const out: EntryValues = {};
  for (const f of ENTRY_SPECS[kind].fields) {
    const v = (row as Record<string, unknown>)[f.key];
    out[f.key] = v === null || v === undefined ? "" : String(v);
  }
  return out;
}

export function emptyValues(kind: EntryKind): EntryValues {
  return Object.fromEntries(ENTRY_SPECS[kind].fields.map((f) => [f.key, ""]));
}

/** New entries object with one list changed: add (index null), replace (index) or remove (value null). The server replaces the whole set. */
export function withEntry(entries: BaselineEntries, kind: EntryKind, index: number | null, value: object | null): BaselineEntries {
  const list = [...(entries[kind] as object[])];
  if (value === null) {
    if (index !== null) list.splice(index, 1);
  } else if (index === null) {
    list.push(value);
  } else {
    list[index] = value;
  }
  return { ...entries, [kind]: list } as BaselineEntries;
}

/** Whether another row may still be added (server cap). */
export function canAddEntry(entries: BaselineEntries, kind: EntryKind): boolean {
  return entries[kind].length < ENTRY_LIMITS.list;
}

/** Four display cells (strings) for one row, in the order of ENTRY_SPECS[kind].headers. */
export function rowCells(
  kind: EntryKind,
  row: object,
  ctx: { cumulativeHeadcount?: number; sourceLabel?: (id: string | null) => string | null } = {},
): [string, string, string, string] {
  const r = row as Record<string, unknown>;
  const dash = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
  if (kind === "permit_milestones" || kind === "certification_milestones") {
    const src = ctx.sourceLabel?.((r.source_id as string | null) ?? null);
    const link = [r.gates_ref ? String(r.gates_ref) : null, src ? `출처: ${src}` : null].filter(Boolean).join(" · ");
    return [dash(r.name), dash(r.issuer), dash(r.target_date), link || "—"];
  }
  if (kind === "hiring_plan") return [dash(r.role_family), dash(r.quarter), dash(r.headcount), dash(ctx.cumulativeHeadcount)];
  if (kind === "kpi_targets") return [dash(r.metric_key), dash(r.target_value), dash(r.unit), dash(r.due)];
  const src = ctx.sourceLabel?.((r.incentive_id as string | null) ?? null);
  return [dash(r.obligation), dash(r.deadline), dash(r.depends_on), src ?? dash(r.incentive_id)];
}

/** Running headcount total over the rows in their current order (aggregate only). */
export function cumulativeHeadcounts(rows: HiringRow[]): number[] {
  let sum = 0;
  return rows.map((r) => (sum += r.headcount));
}

// ── Confirmation form ────────────────────────────────────────────────────

export function validateRationale(raw: string): string | null {
  const t = raw.trim();
  if (!t) return "확인 근거(rationale)를 입력하세요.";
  if (t.length > MAX_RATIONALE_LEN) return `확인 근거는 ${MAX_RATIONALE_LEN}자 이하여야 합니다.`;
  return null;
}

/** Shown instead of the confirm form for anyone but the project lead. */
export const LEAD_ONLY_TEXT = "확정은 프로젝트 리드만 할 수 있습니다"; // INTERIM-WORDING
/** Shown when a GET returns insider_required (MNPI project). */
export const INSIDER_REQUIRED_TEXT = "이 프로젝트의 조회 권한(내부자)이 필요합니다"; // INTERIM-WORDING

/** Korean text for an API failure; server messages are already Korean and win, codes fill the gaps. */
export function baselineErrorText(code: string | undefined, message: string | undefined): string {
  if (code === "insider_required") return INSIDER_REQUIRED_TEXT;
  if (code === "invalid_request" && message) return message;
  if (code && ADR0161_ERROR_LABEL[code] && !message) return ADR0161_ERROR_LABEL[code];
  if (message) return message;
  return (code && ADR0161_ERROR_LABEL[code]) || "기록하지 못했습니다.";
}

/** Failure text for the confirm action: lead_required has fixed wording; findings_open/baseline_empty are listed separately. */
export function confirmErrorText(code: string | undefined, message: string | undefined): string {
  if (code === "lead_required") return `${LEAD_ONLY_TEXT}.`;
  if (code === "baseline_empty") return "필수 기준선 항목이 비어 있어 확정할 수 없습니다 — 아래 항목을 먼저 기록하세요.";
  if (code === "findings_open") return "열린 확인 필요 항목이 있습니다 — 각 항목에 확인 근거를 적어야 확정할 수 있습니다.";
  if (code === "needs_classification") return "트랙 분류가 확정되지 않아 확정할 수 없습니다 — 먼저 사람이 트랙을 정리해야 합니다.";
  return baselineErrorText(code, message);
}

/** Short note shown when the track is not classified (no form is offered). */
export const NEEDS_CLASSIFICATION_NOTE =
  "이 프로젝트의 트랙(신규 사업/인수합병)이 아직 분류되지 않아 실행 기준선 적용 여부를 판단할 수 없습니다. 어느 트랙으로도 기본 적용하지 않으며, 사람이 트랙을 분류한 뒤 이 화면에서 입력할 수 있습니다."; // INTERIM-WORDING

export function permitStepNote(permitStepApplies: boolean): string | null {
  return permitStepApplies ? null : "사내벤처(intra_venture)에는 인허가·인증 단계가 기본 적용되지 않습니다. 기록해 둔 항목은 참고로만 표시됩니다."; // INTERIM-WORDING
}

/** Label for a permit / certification / incentive source row in a select. */
export function sourceOptionLabel(s: { name?: string | null; program_name?: string | null; type?: string; agency?: string | null; status?: string | null }): string {
  const name = s.name ?? s.program_name ?? s.type ?? "";
  return [name, s.agency, s.status].filter(Boolean).join(" · ");
}

/**
 * Whether the confirm control may run now: the project lead (analyst+ writer) with a valid
 * rationale. Per-finding acknowledgements are checked separately (buildAcknowledgements).
 */
export function canConfirm(canAct: boolean, rationale: string, isLead = true): { allowed: boolean; reason: string | null } {
  if (!canAct) return { allowed: false, reason: "analyst 이상 권한이 필요합니다." };
  if (!isLead) return { allowed: false, reason: `${LEAD_ONLY_TEXT}.` };
  const problem = validateRationale(rationale);
  return problem ? { allowed: false, reason: problem } : { allowed: true, reason: null };
}
