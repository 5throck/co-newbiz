// execution-baseline-view — pure view helpers for the S11 greenfield execution baseline
// panel (ADR-0161 Row 3). Client-safe: no server or db imports. Mirrors the checkable
// shapes and limits of lib/greenfield-execution.ts so a form can refuse early; the
// server stays the authority and its messages are shown as returned.
// i18n (design 2026-10-23-i18n-ui-adoption): every render string is emitted as a catalog
// key + params (I18nText); consumers resolve with the ROOT translator, `m.key ? tr(m.key, m.params) : m.text`.
// Raw `text` is reserved for server-message passthrough (data, design §4) — the lib itself carries no Korean.
import { formatNumber, type Locale } from "./format.ts";

/** A render string reference: catalog `key` + `params`, or raw server `text` passthrough. */
export interface I18nText { key: string | null; params: Record<string, string>; text: string | null }
/** Catalog-key message (resolved through `tr(key, params)` at render). */
export const kt = (key: string, params: Record<string, string> = {}): I18nText => ({ key, params, text: null });
/** Raw passthrough text (server message / unknown data key) — rendered verbatim. */
export const rt = (text: string): I18nText => ({ key: null, params: {}, text });
/** Resolve an I18nText with the ROOT translator (key+params) or pass raw text through. */
export const resolveI18n = (m: I18nText, tr: (key: string, params?: Record<string, string>) => string): string =>
  m.key ? tr(m.key, m.params) : m.text ?? "";

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
  chip: I18nText;
  text: I18nText;
}

/**
 * Retroactive-rule wording (ADR-0161 decision 8). `blocks` is the server's flag (GET `blocks`):
 * it only matters for reconfirm_required, which blocks S11 while S11 is not complete and is a
 * non-blocking warning once S11 is already complete.
 */
export function requirementView(requirement: BaselineRequirement, blocks = true): RequirementView {
  switch (requirement) {
    case "satisfied":
      return { cls: "status-green", chip: kt("stages.s11.executionBaseline.reqSatisfiedChip"), text: kt("stages.s11.executionBaseline.reqSatisfiedText") };
    case "recommended":
      return {
        cls: "status-amber",
        chip: kt("stages.s11.executionBaseline.reqRecommendedChip"),
        text: kt("stages.s11.executionBaseline.reqRecommendedText"),
      };
    case "blocking":
      return {
        cls: "status-amber",
        chip: kt("stages.s11.executionBaseline.reqBlockingChip"),
        text: kt("stages.s11.executionBaseline.reqBlockingText"),
      };
    case "reconfirm_required":
      return blocks
        ? {
            cls: "status-amber",
            chip: kt("stages.s11.executionBaseline.reqReconfirmChip"),
            text: kt("stages.s11.executionBaseline.reqReconfirmText"),
          }
        : {
            cls: "status-amber",
            chip: kt("stages.s11.executionBaseline.reqReconfirmSoftChip"),
            text: kt("stages.s11.executionBaseline.reqReconfirmSoftText"),
          };
    case "classification_conflict":
      return { cls: "status-amber", chip: kt("stages.s11.executionBaseline.reqConflictChip"), text: kt("stages.s11.executionBaseline.reqConflictText") };
    case "needs_classification":
      return { cls: "status-not-started", chip: kt("stages.s11.executionBaseline.reqNeedsClassChip"), text: kt("stages.s11.executionBaseline.reqNeedsClassText") };
    default:
      return { cls: "status-not-started", chip: kt("stages.s11.executionBaseline.reqNotApplicableChip"), text: kt("stages.s11.executionBaseline.reqNotApplicableText") };
  }
}

export interface ConfirmationView {
  cls: "status-green" | "status-amber";
  chip: I18nText;
  /** Extra line shown below the chip (who / when / rationale) — data, not a catalog string. */
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
  if (!c) return { cls: "status-amber", chip: kt("stages.s11.executionBaseline.confUnconfirmed"), detail: null, recordedBy: null, tranchesChanged: false, entriesNewer: false };
  const entriesNewer = !!record && !!source && record.id !== source.id;
  const stale = tranchesChanged || entriesNewer;
  return {
    cls: stale ? "status-amber" : "status-green",
    chip: tranchesChanged ? kt("stages.s11.executionBaseline.confTranchesChanged") : entriesNewer ? kt("stages.s11.executionBaseline.confEntriesChanged") : kt("stages.s11.executionBaseline.confConfirmed"),
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
  chip: I18nText;
  text: I18nText;
}

/** Exact match only: a difference is a finding for a human, never a pass. */
export function reconciliationVerdict(rec: TrancheReconciliationView): ReconciliationVerdict {
  if (rec.difference === null) {
    return { cls: "status-not-started", chip: kt("stages.s11.executionBaseline.verdictIncomparableChip"), text: kt("stages.s11.executionBaseline.verdictIncomparableText") };
  }
  if (rec.matches) {
    return { cls: "status-green", chip: kt("stages.s11.executionBaseline.verdictMatchChip"), text: kt("stages.s11.executionBaseline.verdictMatchText") };
  }
  return {
    cls: "status-amber",
    chip: kt("stages.s11.executionBaseline.verdictDiffChip", { p1: fmtMoney(rec.difference) }),
    text: kt("stages.s11.executionBaseline.verdictDiffText"),
  };
}

export const fmtNumber = (n: number, locale: Locale | string = "ko") => formatNumber(n, locale, { maximumFractionDigits: 6 });

/**
 * Display-only money format: thousand separators, at most 1 decimal for KRW (백만 KRW) and at
 * most 2 for other currencies. A nonzero value that would round to 0 keeps full precision so a
 * real difference is never shown as "0". Never used for exact-match comparison.
 */
export function fmtMoney(n: number, currency: string | null = "KRW", locale: Locale | string = "ko"): string {
  const max = !currency || currency === "KRW" ? 1 : 2;
  const out = formatNumber(n, locale, { maximumFractionDigits: max });
  return n !== 0 && Number(out.replace(/,/g, "")) === 0 ? fmtNumber(n, locale) : out;
}

/** Withheld tranches are listed but excluded from the total (server rule R5). */
export const isExcludedTranche = (t: { status: string }) => t.status === "withheld";
export const EXCLUDED_TRANCHE_KEY = "stages.s11.executionBaseline.excludedTranche";

// ── Findings (catalog keys per code) ─────────────────────────────────────

/** Catalog key for every reconciliation finding code; the server message is the fallback for unknown codes. */
export const FINDING_LABEL_KEY: Record<string, string> = {
  s10_structure_missing: "stages.s11.executionBaseline.findingS10StructureMissing",
  no_tranches: "stages.s11.executionBaseline.findingNoTranches",
  tranche_condition_missing: "stages.s11.executionBaseline.findingTrancheConditionMissing",
  tranche_not_from_s10: "stages.s11.executionBaseline.findingTrancheNotFromS10",
  no_adopted_case: "stages.s11.executionBaseline.findingNoAdoptedCase",
  case_capex_missing: "stages.s11.executionBaseline.findingCaseCapexMissing",
  case_unit_not_comparable: "stages.s11.executionBaseline.findingCaseUnitNotComparable",
  tranche_currency_not_comparable: "stages.s11.executionBaseline.findingTrancheCurrencyNotComparable",
  tranche_total_differs: "stages.s11.executionBaseline.findingTrancheTotalDiffers",
  tranches_changed_since_confirmation: "stages.s11.executionBaseline.findingTranchesChanged",
  permit_step_not_applicable: "stages.s11.executionBaseline.findingPermitStepNotApplicable",
};

/** Finding text as a render reference; the raw server message is shown ONLY for unknown codes (data passthrough). */
export function findingText(f: Finding): I18nText {
  const key = FINDING_LABEL_KEY[f.code];
  return key ? kt(key) : rt(f.message);
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

export interface MissingSectionView { key: string; label: I18nText; anchor: string }
const MISSING_SECTION: Record<string, MissingSectionView> = {
  kpi_targets: { key: "kpi_targets", label: kt("stages.s11.executionBaseline.sectionKpiTargets"), anchor: "gx-kpi_targets" },
  hiring_plan: { key: "hiring_plan", label: kt("stages.s11.executionBaseline.sectionHiringPlan"), anchor: "gx-hiring_plan" },
  permit_or_certification_milestones: { key: "permit_or_certification_milestones", label: kt("stages.s11.executionBaseline.sectionPermitOrCert"), anchor: "gx-permit_milestones" },
};

export function missingSectionViews(keys: string[] | undefined): MissingSectionView[] {
  return (keys ?? []).map((k) => MISSING_SECTION[k] ?? { key: k, label: rt(k), anchor: "gx-baseline" });
}

// ── Entry forms ──────────────────────────────────────────────────────────

export type EntryKind = keyof BaselineEntries;

export interface EntryField {
  key: string;
  label: I18nText;
  kind: "text" | "date" | "number" | "select";
  required: boolean;
  max?: number;
  placeholder?: I18nText;
}

export interface EntryKindSpec {
  kind: EntryKind;
  title: I18nText;
  description: I18nText;
  fields: EntryField[];
  /** Four display column headers (the fifth, 관리, is added by the table). */
  headers: [I18nText, I18nText, I18nText, I18nText];
  addLabel: I18nText;
}

const EK = "stages.s11.executionBaseline";

const MILESTONE_FIELDS = (kind: "permit" | "certification"): EntryField[] => [
  { key: "name", label: kt(`${EK}.fld${kind === "permit" ? "Permit" : "Cert"}Name`), kind: "text", required: true, max: ENTRY_LIMITS.short },
  { key: "issuer", label: kt(`${EK}.fldIssuer`), kind: "text", required: true, max: ENTRY_LIMITS.short },
  { key: "target_date", label: kt(`${EK}.fldTargetDate`), kind: "date", required: true },
  { key: "gates_ref", label: kt(`${EK}.fldGatesRef`), kind: "text", required: false, max: ENTRY_LIMITS.short, placeholder: kt(`${EK}.fldGatesRefPlaceholder`) },
  { key: "source_id", label: kt(`${EK}.fldSourceId`), kind: "select", required: false },
];

export const ENTRY_SPECS: Record<EntryKind, EntryKindSpec> = {
  permit_milestones: {
    kind: "permit_milestones",
    title: kt(`${EK}.specPermitTitle`),
    description: kt(`${EK}.specPermitDesc`),
    fields: MILESTONE_FIELDS("permit"),
    headers: [kt(`${EK}.hdrPermit1`), kt(`${EK}.hdrPermit2`), kt(`${EK}.hdrPermit3`), kt(`${EK}.hdrPermit4`)],
    addLabel: kt(`${EK}.specPermitAdd`),
  },
  certification_milestones: {
    kind: "certification_milestones",
    title: kt(`${EK}.specCertTitle`),
    description: kt(`${EK}.specCertDesc`),
    fields: MILESTONE_FIELDS("certification"),
    headers: [kt(`${EK}.hdrCert1`), kt(`${EK}.hdrCert2`), kt(`${EK}.hdrCert3`), kt(`${EK}.hdrCert4`)],
    addLabel: kt(`${EK}.specCertAdd`),
  },
  hiring_plan: {
    kind: "hiring_plan",
    title: kt(`${EK}.specHiringTitle`),
    description: kt(`${EK}.specHiringDesc`),
    fields: [
      { key: "role_family", label: kt(`${EK}.fldRoleFamily`), kind: "text", required: true, max: 100 },
      { key: "quarter", label: kt(`${EK}.fldQuarter`), kind: "text", required: true, placeholder: kt(`${EK}.fldQuarterPlaceholder`) },
      { key: "headcount", label: kt(`${EK}.fldHeadcount`), kind: "number", required: true },
    ],
    headers: [kt(`${EK}.hdrHiring1`), kt(`${EK}.hdrHiring2`), kt(`${EK}.hdrHiring3`), kt(`${EK}.hdrHiring4`)],
    addLabel: kt(`${EK}.specHiringAdd`),
  },
  kpi_targets: {
    kind: "kpi_targets",
    title: kt(`${EK}.specKpiTitle`),
    description: kt(`${EK}.specKpiDesc`),
    fields: [
      { key: "metric_key", label: kt(`${EK}.fldMetricKey`), kind: "text", required: true, max: 80, placeholder: kt(`${EK}.fldMetricKeyPlaceholder`) },
      { key: "target_value", label: kt(`${EK}.fldTargetValue`), kind: "number", required: true },
      { key: "unit", label: kt(`${EK}.fldUnit`), kind: "text", required: false, max: 20 },
      { key: "due", label: kt(`${EK}.fldDue`), kind: "text", required: true },
    ],
    headers: [kt(`${EK}.hdrKpi1`), kt(`${EK}.hdrKpi2`), kt(`${EK}.hdrKpi3`), kt(`${EK}.hdrKpi4`)],
    addLabel: kt(`${EK}.specKpiAdd`),
  },
  incentive_obligations: {
    kind: "incentive_obligations",
    title: kt(`${EK}.specIncentiveTitle`),
    description: kt(`${EK}.specIncentiveDesc`),
    fields: [
      { key: "obligation", label: kt(`${EK}.fldObligation`), kind: "text", required: true, max: ENTRY_LIMITS.text },
      { key: "deadline", label: kt(`${EK}.fldDeadline`), kind: "date", required: false },
      { key: "depends_on", label: kt(`${EK}.fldDependsOn`), kind: "text", required: false, max: ENTRY_LIMITS.short },
      { key: "incentive_id", label: kt(`${EK}.fldIncentiveId`), kind: "select", required: false },
    ],
    headers: [kt(`${EK}.hdrIncentive1`), kt(`${EK}.hdrIncentive2`), kt(`${EK}.hdrIncentive3`), kt(`${EK}.hdrIncentive4`)],
    addLabel: kt(`${EK}.specIncentiveAdd`),
  },
};

export const ENTRY_KINDS: EntryKind[] = ["permit_milestones", "certification_milestones", "hiring_plan", "kpi_targets", "incentive_obligations"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const QUARTER_RE = /^\d{4}-Q[1-4]$/;
const METRIC_RE = /^(goal:)?[a-z0-9_.-]{1,80}$/;
const isDate = (v: string) => DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

export type EntryBuild<T> = { ok: true; value: T } | { ok: false; error: EntryError };
export type EntryValues = Record<string, string>;

/** Structured form-validation failure — the consumer composes the localized message
 * (required/maxLength carry the field's catalog label; format codes map to fixed keys). */
export type EntryError =
  | { kind: "required"; field: string }
  | { kind: "maxLength"; field: string; max: number }
  | { kind: "format"; code: "target_date" | "quarter" | "headcount" | "metric_key" | "target_value" | "due" | "deadline" };

function text(values: EntryValues, key: string): string {
  return (values[key] ?? "").trim();
}

function checkLengths(kind: EntryKind, values: EntryValues): EntryError | null {
  for (const f of ENTRY_SPECS[kind].fields) {
    const v = text(values, f.key);
    if (f.required && !v) return { kind: "required", field: f.key };
    if (f.max && v.length > f.max) return { kind: "maxLength", field: f.key, max: f.max };
  }
  return null;
}

/** Validate and normalise one form into the entry shape the API stores. Same rules as the server parser. */
export function buildEntry(kind: EntryKind, values: EntryValues): EntryBuild<Milestone | HiringRow | KpiTarget | IncentiveObligation> {
  const lengthProblem = checkLengths(kind, values);
  if (lengthProblem) return { ok: false, error: lengthProblem };
  if (kind === "permit_milestones" || kind === "certification_milestones") {
    const date = text(values, "target_date");
    if (!isDate(date)) return { ok: false, error: { kind: "format", code: "target_date" } };
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
    if (!QUARTER_RE.test(q)) return { ok: false, error: { kind: "format", code: "quarter" } };
    const n = Number(text(values, "headcount"));
    if (!Number.isInteger(n) || n < 0 || n > 100000) return { ok: false, error: { kind: "format", code: "headcount" } };
    return { ok: true, value: { role_family: text(values, "role_family"), quarter: q, headcount: n } };
  }
  if (kind === "kpi_targets") {
    const key = text(values, "metric_key");
    if (!METRIC_RE.test(key)) return { ok: false, error: { kind: "format", code: "metric_key" } };
    const raw = text(values, "target_value");
    const target = Number(raw);
    if (raw === "" || !Number.isFinite(target)) return { ok: false, error: { kind: "format", code: "target_value" } };
    const due = text(values, "due");
    if (!QUARTER_RE.test(due) && !isDate(due)) return { ok: false, error: { kind: "format", code: "due" } };
    return { ok: true, value: { metric_key: key, target_value: target, unit: text(values, "unit") || null, due } };
  }
  const dl = text(values, "deadline");
  if (dl && !isDate(dl)) return { ok: false, error: { kind: "format", code: "deadline" } };
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

/** One display cell: plain text/data, or a catalog reference ({@link I18nText}) resolved at render. */
export type EntryCell = string | I18nText;

/** Four display cells for one row, in the order of ENTRY_SPECS[kind].headers. */
export function rowCells(
  kind: EntryKind,
  row: object,
  ctx: { cumulativeHeadcount?: number; sourceLabel?: (id: string | null) => string | null } = {},
): [EntryCell, EntryCell, EntryCell, EntryCell] {
  const r = row as Record<string, unknown>;
  const dash = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
  if (kind === "permit_milestones" || kind === "certification_milestones") {
    const src = ctx.sourceLabel?.((r.source_id as string | null) ?? null);
    const gatesRef = r.gates_ref ? String(r.gates_ref) : null;
    // The "출처:" prefix is UI wording — composed catalog keys with the data as params.
    const link: EntryCell = gatesRef && src
      ? kt("stages.s11.executionBaseline.rowLink", { p1: gatesRef, p2: src })
      : gatesRef
        ? gatesRef
        : src
          ? kt("stages.s11.executionBaseline.rowSourceRef", { p1: src })
          : "—";
    return [dash(r.name), dash(r.issuer), dash(r.target_date), link];
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

export function validateRationale(rawInput: string): I18nText | null {
  const t = rawInput.trim();
  if (!t) return kt("stages.s11.executionBaseline.errRationaleRequired");
  if (t.length > MAX_RATIONALE_LEN) return kt("stages.s11.executionBaseline.errRationaleMaxLength", { p1: String(MAX_RATIONALE_LEN) });
  return null;
}

/** Shown instead of the confirm form for anyone but the project lead. */
export const LEAD_ONLY_KEY = "stages.s11.executionBaseline.leadOnly";
/** Shown when a GET returns insider_required (MNPI project). */
export const INSIDER_REQUIRED_KEY = "stages.s11.executionBaseline.insiderRequired";

/** ADR-0161 API error codes → catalog keys (ko master wording mirrors labels.ts ADR0161_ERROR_LABEL). */
const ERROR_CODE_KEY: Record<string, string> = {
  not_applicable_track: "stages.s11.executionBaseline.errNotApplicableTrack",
  needs_classification: "stages.s11.executionBaseline.errNeedsClassificationRecord",
  human_only: "stages.s11.executionBaseline.errHumanOnly",
  lead_required: "stages.s11.executionBaseline.errLeadRequired",
  already_migrated: "stages.s11.executionBaseline.errAlreadyMigrated",
  insider_required: INSIDER_REQUIRED_KEY,
};

/** Render reference for an API failure; server messages pass through raw (data, design §4), codes fill the gaps. */
export function baselineErrorText(code: string | undefined, message: string | undefined): I18nText {
  if (code === "insider_required") return kt(INSIDER_REQUIRED_KEY);
  if (code === "invalid_request" && message) return rt(message);
  if (code && ERROR_CODE_KEY[code] && !message) return kt(ERROR_CODE_KEY[code]);
  if (message) return rt(message);
  return kt(code && ERROR_CODE_KEY[code] ? ERROR_CODE_KEY[code] : "stages.s11.executionBaseline.errRecordFailed");
}

/** Failure text for the confirm action: lead_required has fixed wording; findings_open/baseline_empty are listed separately. */
export function confirmErrorText(code: string | undefined, message: string | undefined): I18nText {
  if (code === "lead_required") return kt("stages.s11.executionBaseline.errLeadOnlyConfirm");
  if (code === "baseline_empty") return kt("stages.s11.executionBaseline.errBaselineEmpty");
  if (code === "findings_open") return kt("stages.s11.executionBaseline.errFindingsOpen");
  if (code === "needs_classification") return kt("stages.s11.executionBaseline.errNeedsClassificationConfirm");
  return baselineErrorText(code, message);
}

/** Short note shown when the track is not classified (no form is offered). */
export const NEEDS_CLASSIFICATION_KEY = "stages.s11.executionBaseline.needsClassificationNote";

export function permitStepNote(permitStepApplies: boolean): I18nText | null {
  return permitStepApplies ? null : kt("stages.s11.executionBaseline.permitStepNote");
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
export function canConfirm(canAct: boolean, rationale: string, isLead = true): { allowed: boolean; reason: I18nText | null } {
  if (!canAct) return { allowed: false, reason: kt("stages.s11.executionBaseline.errAnalystRequired") };
  if (!isLead) return { allowed: false, reason: kt("stages.s11.executionBaseline.errLeadOnlyConfirm") };
  const problem = validateRationale(rationale);
  return problem ? { allowed: false, reason: problem } : { allowed: true, reason: null };
}
