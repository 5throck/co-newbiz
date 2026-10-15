// ADR-0173 slice 1 (Proposed; decider approved Option A): S5 capability closing cost lines and
// milestone candidates. Pure and client-safe (no db, no node:crypto) so the S5 screen and the
// route share one derivation. Decision support only: reflection is a per-line human choice, the
// server recomputes every capability amount from the live judgement, nothing is a gate or a cap.
import { JUDGEMENT_CATEGORIES, RESOLUTION_LABEL, type CapabilityGapRow, type GapResolution, type JudgementCategory, type MilestoneCandidate } from "./capability-gap.ts";
import { isStale, sha256Hex } from "./capability-linkage.ts";
import { findStaffingDuplicateWarnings, isStaffingPlanEntry, normalizeStaffingPlanEntry, staffingPlanAuditHash, staffingPlanChanged, staffingPlanOf, staffingPlanView, staffingSummaryVector, type StaffingPlanEntry, type StaffingDuplicateWarning, type StaffingPlanView } from "./staffing-plan.ts";
export { findStaffingDuplicateWarnings, isStaffingPlanEntry, staffingPlanOf, type StaffingDuplicateWarning, type StaffingPlanEntry, type StaffingPlanView };

export type CostCategory = JudgementCategory;
/** Categories a capability line may carry (cost side of the S8 vocabulary). */
export const CAPABILITY_COST_CATEGORIES: readonly CostCategory[] = JUDGEMENT_CATEGORIES;
/** UI label of a 분류 (labor/opex/capex). */
export const CATEGORY_LABEL: Record<CostCategory, string> = { labor: "인건비", opex: "운영비", capex: "설비투자" };
export const CAPABILITY_BLOCK_TITLE = "역량 해소 비용 (S5 판정에서 연동)";
export const MILESTONE_BLOCK_TITLE = "마일스톤 후보 (사후관리 연동 예정)";
export const MILESTONE_START_NOTE = "착수일은 S11 기준선을 확정할 때 정해집니다.";

/** The judgement fields this feature reads (a subset of AttainabilityRowView, so server and client share it). */
export interface CostSourceRow {
  id: string;
  capability: string;
  resolution: GapResolution | null;
  /** 분류 (ADR-0173 amendment 2026-10-15): the judgement's own category; null = 미입력. */
  category: JudgementCategory | null;
  closing_cost_krw_m: number | null;
  months_to_attain: number | null;
  grade: string | null;
  /** Null when unconfirmed or stale (rowView clears it for stale rows). */
  confirmed_at: string | null;
  stale: boolean;
}

export const sourceRowOf = (r: CapabilityGapRow): CostSourceRow => {
  const a = r.attainability;
  const stale = isStale(r);
  return {
    id: r.id,
    capability: r.capability,
    resolution: r.resolution,
    category: a?.category ?? null,
    closing_cost_krw_m: a?.closingCostKrwM ?? null,
    months_to_attain: a?.monthsToAttain ?? null,
    grade: a?.grade ?? null,
    confirmed_at: stale ? null : a?.confirmedAt ?? null,
    stale,
  };
};

// ── Horizon meta (ADR-0174 slice 1) ─────────────────────────────────────────

/** 검토 기간 default — the S8 bc.horizon_years default (design 2/OD-2). */
export const DEFAULT_HORIZON_YEARS = 5;
/** 검토 기간 bounds; outside is a save-time 400 (design 5). */
export const MIN_HORIZON_YEARS = 1;
export const MAX_HORIZON_YEAR_LIMIT = 15;
export const PLAN_META_SOURCE = "plan_meta" as const;
/** The one meta entry in business_case_lines_json carrying the S5 검토 기간. */
export interface PlanMetaEntry { source: typeof PLAN_META_SOURCE; horizonYears: number }
export const isPlanMetaEntry = (x: unknown): x is PlanMetaEntry =>
  !!x && typeof x === "object" && (x as { source?: unknown }).source === PLAN_META_SOURCE;
/** Valid meta entry: integer horizon within bounds. Malformed entries are ignored by readers. */
export const planMetaEntryIsValid = (e: PlanMetaEntry): boolean =>
  Number.isInteger(e.horizonYears) && e.horizonYears >= MIN_HORIZON_YEARS && e.horizonYears <= MAX_HORIZON_YEAR_LIMIT;
/** First valid meta entry in a stored lines array; null when absent/invalid (readers default to 5). */
export function planMetaOf(lines: unknown): PlanMetaEntry | null {
  if (!Array.isArray(lines)) return null;
  for (const l of lines) if (isPlanMetaEntry(l) && planMetaEntryIsValid(l)) return l;
  return null;
}

/**
 * Per-line spending window (ADR-0174 slice 1). startYear defaults to 1;
 * endYear on a recurring line defaults to the horizon (unset = run through).
 * A lump sum spends in startYear only (endYear is meaningless for it).
 */
export const isValidYearValue = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1;
/** 1 <= startYear <= endYear <= horizon (message names the rule for the 400). */
export function validateLineYears(l: { startYear?: unknown; endYear?: unknown }, horizon: number): string | null {
  if (l.startYear === undefined && l.endYear === undefined) return null;
  if (l.startYear !== undefined && !isValidYearValue(l.startYear)) return "시작 연차는 1 이상의 정수여야 합니다.";
  if (l.endYear !== undefined && !isValidYearValue(l.endYear)) return "종료 연차는 1 이상의 정수여야 합니다.";
  const s = (l.startYear as number | undefined) ?? 1;
  const e = (l.endYear as number | undefined) ?? s;
  if (e < s) return "종료 연차는 시작 연차보다 작을 수 없습니다.";
  if (s > horizon) return `시작 연차는 검토 기간(${horizon}년) 안이어야 합니다.`;
  if (e > horizon) return `종료 연차는 검토 기간(${horizon}년) 안이어야 합니다.`;
  return null;
}
/** Number of years a recurring line is active inside the horizon (design 3: max(0, min(end,N) − start + 1)). */
export const activeYearsOf = (startYear: number | undefined, endYear: number | null, horizon: number): number =>
  Math.max(0, Math.min(endYear ?? horizon, horizon) - Math.max(1, startYear ?? 1) + 1);

/** Capability default spend year from the judgement months (OD-6): ceil(months/12), minimum 1; Y1 when months unknown. */
export const capabilityDefaultStartYear = (monthsToAttain: number | null): number =>
  monthsToAttain !== null && monthsToAttain > 0 ? Math.max(1, Math.ceil(monthsToAttain / 12)) : 1;

/** Read-only end-year display (ADR-0173 amendment 2026-10-15): start + ceil(months/12) − 1; a 12-month spend starting Y1 ends Y1. */
export const capabilityEndYearOf = (startYear: number, monthsToAttain: number | null): number =>
  monthsToAttain !== null && monthsToAttain > 0 ? startYear + Math.ceil(monthsToAttain / 12) - 1 : startYear;

// ── Units ───────────────────────────────────────────────────────────────────

/** 백만원 to 억 for display: 2 decimals. The exact 백만원 value is always kept alongside. */
export const eokOf = (krwM: number): number => Math.round((krwM / 100) * 100) / 100;
/** Stored line amount (억, exact): 1 억 = 100 백만원. */
export const exactEokOf = (krwM: number): number => krwM / 100;
export const formatEok = (krwM: number): string => `${eokOf(krwM).toFixed(2)}억`;

// ADR-0173 amendment 2026-10-15 (decider): the S5 investment section shows and stores 백만원 (KRW million) everywhere.
/** Every line written from now on carries this marker; a line without it is legacy (amount in 억). */
export const AMOUNT_UNIT_KRW_M = "krw_m" as const;
/** 억 to 백만원, value-preserving: integer-safe rounding to 0.01 백만원 (0.35억 -> 35, no float drift). */
export const eokToKrwM = (eok: number): number => (Number.isFinite(eok) ? Math.round(eok * 10000) / 100 : 0);
/** A stored/posted line amount in 백만원: krw_m lines as is, legacy lines (no marker) converted from 억. */
export const lineAmountKrwM = (l: { amount?: unknown; amountUnit?: unknown }): number => {
  const n = typeof l.amount === "number" && Number.isFinite(l.amount) ? l.amount : Number(l.amount) || 0;
  return l.amountUnit === AMOUNT_UNIT_KRW_M ? Math.round(n * 100) / 100 : eokToKrwM(n);
};
/** "1,250백만원" (up to 2 decimals, thousands separators). */
export const formatKrwM = (krwM: number): string => `${(Math.round(krwM * 100) / 100).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}백만원`;

// ── Manual line units (amountUnitConfirmed model, decider 2026-10-15) ────────
// A stored/posted manual line is CONFIRMED only when a human explicitly picked its unit in the UI
// (`amountUnitConfirmed: true`). Legacy lines (missing category/period/currency or carrying the
// old `kind`/`growth_rate` shape) are NEVER auto-converted: their original amount unit is unknown,
// so the earlier silent 억→백만원 stamp cannot be trusted. Unconfirmed lines are excluded from the
// totals and from the promotion copy until a person picks a unit and saves.

export type KrwAmountUnit = "krw" | "krw_k" | "krw_m" | "krw_eok";
export type FxAmountUnit = "fx_m" | "fx_eok";
export type AmountUnit = KrwAmountUnit | FxAmountUnit;
/** Full unit vocabulary the route accepts; anything else is rejected (no silent fallback). */
export const AMOUNT_UNITS: readonly AmountUnit[] = ["krw", "krw_k", "krw_m", "krw_eok", "fx_m", "fx_eok"];
const KRW_UNIT_TO_KRW_M: Record<KrwAmountUnit, number> = { krw: 1e-6, krw_k: 1e-3, krw_m: 1, krw_eok: 100 };
const isKrwUnit = (u: unknown): u is KrwAmountUnit => typeof u === "string" && u in KRW_UNIT_TO_KRW_M;
export const isFxUnit = (u: unknown): u is FxAmountUnit => u === "fx_m" || u === "fx_eok";
export const isKnownAmountUnit = (u: unknown): u is AmountUnit => isKrwUnit(u) || isFxUnit(u);
/** UI label of a unit; the fx labels need the line currency (e.g. "백만 USD"). */
export const amountUnitLabel = (u: AmountUnit, currency = "USD"): string => {
  if (isKrwUnit(u)) return ({ krw: "원", krw_k: "천원", krw_m: "백만원", krw_eok: "억원" })[u];
  return u === "fx_m" ? `백만 ${currency}` : `억 ${currency}`;
};

/** Manual line shape as the UI holds it and the route stores it. Optional = unset, shown as "선택". */
export interface ManualCostLine {
  line: string;
  category?: "labor" | "opex" | "capex" | "revenue" | "gov_rnd";
  amount: number;
  amountUnit?: AmountUnit;
  /** True only after a human picked the unit in the UI and saved; never inferred. */
  amountUnitConfirmed?: boolean;
  /** Server-computed canonical 백만원 (0.01 rounding); null while unconfirmed or non-KRW. */
  amountKrwM?: number | null;
  currency?: "KRW" | "USD" | "EUR" | "JPY" | "CNY";
  period?: "monthly" | "quarterly" | "yearly" | "lumpsum";
  /** ADR-0174 slice 1: spending window in years (Y1..N). Unset = defaults. */
  startYear?: number;
  endYear?: number;
  note?: string;
  dupDismissed?: string[];
  /** Legacy info only (old shape): annual growth rate, kept read-only, never applied. */
  growthRate?: number;
}

const MANUAL_CATEGORIES: readonly string[] = ["labor", "opex", "capex", "revenue", "gov_rnd"];
const MANUAL_CURRENCIES: readonly string[] = ["KRW", "USD", "EUR", "JPY", "CNY"];
const MANUAL_PERIODS: readonly string[] = ["monthly", "quarterly", "yearly", "lumpsum"];

/** Old demo/LLM shape that predates categories: `kind` (revenue/cost) and `growth_rate`. */
export const manualLineIsOldShape = (l: Record<string, unknown>): boolean => "kind" in l || "growth_rate" in l;
/** A line is legacy when it lacks category/period/currency or carries the old shape. */
export const manualLineIsLegacy = (l: Record<string, unknown>): boolean =>
  manualLineIsOldShape(l) || l.category === undefined || l.period === undefined || l.currency === undefined;

/**
 * Map a stored manual line to the current shape mapping ONLY what is certain. The amount is never
 * converted: a legacy amount's unit is unknown, so `amountUnit` is left unset for old-shape lines
 * (their earlier `krw_m` stamp came from the previous silent conversion and is dropped) and the
 * line stays unconfirmed until a human picks a unit. `kind:"revenue"` maps to category revenue;
 * `kind:"cost"` maps to nothing (category is a human choice, never defaulted to labor).
 * Missing currency is KRW; a missing period stays unset (yearly is only suggested in the UI when
 * `growth_rate` is present); `growth_rate` is kept as read-only info.
 */
export function normalizeLegacyLine(raw: Record<string, unknown>): ManualCostLine {
  const old = manualLineIsOldShape(raw);
  const kind = typeof raw.kind === "string" ? raw.kind : undefined;
  const category = typeof raw.category === "string" && MANUAL_CATEGORIES.includes(raw.category) ? (raw.category as ManualCostLine["category"]) : kind === "revenue" ? ("revenue" as const) : undefined;
  const currency = typeof raw.currency === "string" && MANUAL_CURRENCIES.includes(raw.currency) ? (raw.currency as ManualCostLine["currency"]) : ("KRW" as const);
  const period = typeof raw.period === "string" && MANUAL_PERIODS.includes(raw.period) ? (raw.period as ManualCostLine["period"]) : undefined;
  const unit = raw.amountUnit;
  const amountUnit = !old && isKnownAmountUnit(unit) ? unit : undefined;
  return {
    line: String(raw.line ?? ""),
    category,
    amount: typeof raw.amount === "number" && Number.isFinite(raw.amount) ? raw.amount : Number(raw.amount) || 0,
    amountUnit,
    amountUnitConfirmed: !old && amountUnit !== undefined && raw.amountUnitConfirmed === true,
    amountKrwM: typeof raw.amountKrwM === "number" && Number.isFinite(raw.amountKrwM) ? raw.amountKrwM : null,
    currency,
    period,
    startYear: isValidYearValue(raw.startYear) ? raw.startYear : undefined,
    endYear: isValidYearValue(raw.endYear) ? raw.endYear : undefined,
    note: typeof raw.note === "string" ? raw.note : undefined,
    dupDismissed: Array.isArray(raw.dupDismissed) ? (raw.dupDismissed as string[]) : undefined,
    growthRate: typeof raw.growth_rate === "number" ? raw.growth_rate : typeof raw.growthRate === "number" ? raw.growthRate : undefined,
  };
}

export type ManualLineIssue = "category" | "period" | "currency" | "unit";
/** What a row is missing before it may enter the totals: unset fields or an unconfirmed unit. */
export function manualLineIssues(l: ManualCostLine): ManualLineIssue[] {
  const out: ManualLineIssue[] = [];
  if (!l.category) out.push("category");
  if (!l.period) out.push("period");
  if (!l.currency) out.push("currency");
  if (!l.amountUnitConfirmed || !isKnownAmountUnit(l.amountUnit)) out.push("unit");
  return out;
}
export const manualLineNeedsConfirm = (l: ManualCostLine): boolean => manualLineIssues(l).length > 0;

/**
 * Canonical 백만원 for a manual line; null when the unit is unknown/unconfirmed or the currency is
 * not KRW (no FX in this feature). The server-stored `amountKrwM` wins when present.
 */
export function manualLineKrwM(l: { amount?: unknown; amountUnit?: unknown; amountKrwM?: unknown; currency?: unknown }): number | null {
  if (typeof l.amountKrwM === "number" && Number.isFinite(l.amountKrwM)) return Math.round(l.amountKrwM * 100) / 100;
  if (l.currency !== undefined && l.currency !== "KRW") return null;
  if (!isKrwUnit(l.amountUnit)) return null;
  const n = typeof l.amount === "number" && Number.isFinite(l.amount) ? l.amount : Number(l.amount) || 0;
  return Math.round(n * KRW_UNIT_TO_KRW_M[l.amountUnit] * 100) / 100;
}

// ── Sanity guard (decision support only, never a cap) ────────────────────────
/** A single line over this many 백만원 (1,000억) gets a "금액이 매우 큽니다" chip. */
export const SANITY_LINE_KRW_M = 100_000;
/** A grand total over this many 백만원 (1조) gets the same dismissible chip. */
export const SANITY_TOTAL_KRW_M = 1_000_000;
export const sanityLineOversize = (krwM: number | null): boolean => krwM !== null && krwM > SANITY_LINE_KRW_M;
export const sanityTotalOversize = (krwM: number): boolean => krwM > SANITY_TOTAL_KRW_M;

// ── Category mapping (design 4.3, OD-2) ─────────────────────────────────────

export function suggestCategory(resolution: GapResolution | null): { category: CostCategory; alternative: CostCategory | null; hint: string | null } {
  switch (resolution) {
    case "build": return { category: "capex", alternative: "labor", hint: null };
    case "hire": return { category: "labor", alternative: null, hint: null };
    case "partner": return { category: "opex", alternative: null, hint: null };
    case "invest": return { category: "capex", alternative: null, hint: null };
    default: return { category: "capex", alternative: null, hint: "확인 필요: 해소 방식이 정해지지 않아 설비투자로 제안했습니다." };
  }
}

// ── Basis hash (staleness of a reflected amount) ────────────────────────────

/** Legacy hash (pre-ADR-0173 amendment 2026-10-15): cost, months, resolution, grade, effective confirmation — no category. */
function costBasisHashC1(r: CostSourceRow): string {
  return `c1:${sha256Hex(JSON.stringify({ cost: r.closing_cost_krw_m, months: r.months_to_attain, resolution: r.resolution, grade: r.grade, confirmed: r.confirmed_at !== null })).slice(0, 16)}`;
}

/** Current hash (c2): adds the judgement-owned category to the c1 inputs. */
export function costBasisHash(r: CostSourceRow): string {
  return `c2:${sha256Hex(JSON.stringify({ cost: r.closing_cost_krw_m, months: r.months_to_attain, resolution: r.resolution, grade: r.grade, confirmed: r.confirmed_at !== null, category: r.category ?? null })).slice(0, 16)}`;
}

/**
 * Does a stored basis stamp still describe this row? c2 stamps compare against the c2 hash;
 * c1 stamps compare against the legacy no-category recomputation, so existing reflected rows
 * do not flip to 재판정 필요 just because the category field was introduced.
 */
export function basisHashMatches(stored: string, r: CostSourceRow): boolean {
  if (stored.startsWith("c1:")) return stored === costBasisHashC1(r);
  return stored === costBasisHash(r);
}

// ── Stored entries ──────────────────────────────────────────────────────────

export interface StoredCapabilityEntry {
  line: string;
  category: CostCategory;
  /** 백만원 (amountUnit "krw_m"); legacy entries without the marker hold 억. */
  amount: number;
  amountUnit?: typeof AMOUNT_UNIT_KRW_M;
  /** Capability amounts follow the judgement, so they are always confirmed. */
  amountUnitConfirmed?: true;
  currency: "KRW";
  period: "lumpsum";
  /** Human spend-year override (ADR-0174 slice 1); unset = derived from the judgement months (OD-6). */
  startYear?: number;
  note: string;
  source: "capability";
  capabilityKey: string;
  reflected: boolean;
  basisHash: string;
  /** Last-seen exact 백만원 (informational; the live judgement is authoritative). */
  costKrwM: number;
  reflectedBy?: string;
  reflectedAt?: string;
}

export const isCapabilityEntry = (x: unknown): x is Partial<StoredCapabilityEntry> & { capabilityKey: string } =>
  !!x && typeof x === "object" && (x as { source?: unknown }).source === "capability" && typeof (x as { capabilityKey?: unknown }).capabilityKey === "string";

// ── Derived lines ───────────────────────────────────────────────────────────

export interface CapabilityCostLine {
  capabilityKey: string;
  name: string;
  line: string;
  resolution: GapResolution | null;
  resolutionLabel: string;
  costKrwM: number;
  amountEok: number;
  suggestedCategory: CostCategory;
  alternativeCategory: CostCategory | null;
  categoryHint: string | null;
  /** The category in effect: the stored one when present, else the suggestion. */
  category: CostCategory;
  monthsToAttain: number | null;
  /** Spend-year default from the judgement months (OD-6, ADR-0174 slice 1). */
  defaultStartYear: number;
  /** Effective spend year: a stored/selected human override, else the default. */
  startYear: number;
  /** Read-only end-year display: start + ceil(months/12) − 1 (ADR-0173 amendment 2026-10-15). */
  endYear: number;
  /** 반영 가능 = confirmed and not stale; 참고(미반영) otherwise. */
  state: "reflectable" | "reference";
  stateLabel: string;
  /** Why the checkbox is disabled (only when it is not reflected yet). */
  disabledReason: string | null;
  /** Effective checkbox state: stored value, else the default rule (OD-1). */
  reflected: boolean;
  /** True when an entry for this capability is already stored. */
  persisted: boolean;
  stale: boolean;
  /** Reflected but the judgement is stale or changed since reflect time (OD-7): stays reflected, flagged. */
  needsRejudge: boolean;
  /** The category the S5 judgement carries, or null when unset (then `category` falls back to stored/suggested). */
  judgementCategory: JudgementCategory | null;
  /** Reflected amount differs from the live one (the amount follows the judgement). */
  amountChanged: boolean;
  previousAmountEok: number | null;
  previousAmountKrwM: number | null;
  basisHash: string;
}

export interface OrphanCapabilityEntry { capabilityKey: string; line: string; reflected: boolean; reason: "deleted" | "no_cost" }

export interface CapabilityCostView {
  lines: CapabilityCostLine[];
  orphans: OrphanCapabilityEntry[];
  totals: {
    capabilityKrwM: number;
    reflectedKrwM: number;
    reflectedCount: number;
    needsRejudgeCount: number;
  };
}

export function deriveCapabilityCostLines(rows: CostSourceRow[], stored: unknown): CapabilityCostView {
  const entries = Array.isArray(stored) ? stored.filter(isCapabilityEntry) : [];
  const byKey = new Map(entries.map((e) => [e.capabilityKey, e]));
  const lines: CapabilityCostLine[] = [];
  for (const r of rows) {
    const cost = r.closing_cost_krw_m;
    if (cost === null || !(cost > 0)) continue;
    const e = byKey.get(r.id);
    const reflectable = r.confirmed_at !== null && !r.stale;
    const sug = suggestCategory(r.resolution);
    const reflected = e ? e.reflected === true : reflectable;
    const hash = costBasisHash(r);
    const storedAmount = typeof e?.amount === "number" ? lineAmountKrwM(e) : null;
    const judgementCategory = r.category ?? null;
    const category = judgementCategory ?? (e && CAPABILITY_COST_CATEGORIES.includes(e.category as CostCategory) ? (e.category as CostCategory) : sug.category);
    const defaultStartYear = capabilityDefaultStartYear(r.months_to_attain);
    const startYear = isValidYearValue(e?.startYear) ? e.startYear : defaultStartYear;
    lines.push({
      capabilityKey: r.id,
      name: r.capability,
      line: `${r.capability} 역량 해소`,
      resolution: r.resolution,
      resolutionLabel: r.resolution ? RESOLUTION_LABEL[r.resolution] : "미정",
      costKrwM: cost,
      amountEok: eokOf(cost),
      suggestedCategory: sug.category,
      alternativeCategory: sug.alternative,
      /** Judgement owns the category now; the suggestion's hint only applies while it is unset. */
      categoryHint: judgementCategory ? null : r.resolution ? "분류 미입력 — 해소 방식 추정" : sug.hint,
      category,
      /** The category the S5 judgement itself carries (ADR-0173 amendment 2026-10-15). */
      judgementCategory,
      monthsToAttain: r.months_to_attain,
      defaultStartYear,
      startYear,
      /** End year display: start + ceil(months / 12) − 1 (a 12-month spend starting Y1 ends Y1). */
      endYear: capabilityEndYearOf(startYear, r.months_to_attain),
      state: reflectable ? "reflectable" : "reference",
      stateLabel: reflectable ? "반영 가능" : "참고(미반영)",
      disabledReason: reflectable || (e?.reflected === true) ? null : r.stale ? "S3 내용이 바뀌어 재판정이 필요합니다 — 재판정·확정 후 반영할 수 있습니다." : "사람이 확정한 판정만 반영할 수 있습니다 — 판정을 확정하세요.",
      reflected,
      persisted: !!e,
      stale: r.stale,
      needsRejudge: reflected && (r.stale || (!!e && e.reflected === true && !!e.basisHash && !basisHashMatches(e.basisHash, r))),
      amountChanged: !!e && e.reflected === true && storedAmount !== null && Math.abs(storedAmount - cost) > 1e-6,
      previousAmountEok: storedAmount !== null ? eokOf(storedAmount) : null,
      previousAmountKrwM: storedAmount,
      basisHash: hash,
    });
  }
  const live = new Set(lines.map((l) => l.capabilityKey));
  const known = new Set(rows.map((r) => r.id));
  const orphans: OrphanCapabilityEntry[] = entries
    .filter((e) => !live.has(e.capabilityKey))
    .map((e) => ({ capabilityKey: e.capabilityKey, line: String(e.line ?? ""), reflected: e.reflected === true, reason: known.has(e.capabilityKey) ? ("no_cost" as const) : ("deleted" as const) }));
  const reflected = lines.filter((l) => l.reflected);
  return {
    lines,
    orphans,
    totals: {
      capabilityKrwM: lines.reduce((s, l) => s + l.costKrwM, 0),
      reflectedKrwM: reflected.reduce((s, l) => s + l.costKrwM, 0),
      reflectedCount: reflected.length,
      needsRejudgeCount: reflected.filter((l) => l.needsRejudge).length,
    },
  };
}

// ── Double-count guard (design 4.6, OD-6) ───────────────────────────────────

export const normalizeName = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const tokensOf = (s: string): Set<string> => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0));

/** Does the manual line look like the same item as the capability? Containment, >= 60% token overlap, or note mention. */
export function isLikelyDuplicate(capabilityName: string, manual: { line?: string; note?: string }): boolean {
  const cap = normalizeName(capabilityName);
  const man = normalizeName(manual.line ?? "");
  if (cap.length >= 2 && man.length >= 2 && (man.includes(cap) || cap.includes(man))) return true;
  const a = tokensOf(capabilityName);
  const b = tokensOf(manual.line ?? "");
  if (a.size > 0 && b.size > 0) {
    let common = 0;
    for (const t of a) if (b.has(t)) common += 1;
    if (common / Math.min(a.size, b.size) >= 0.6) return true;
  }
  const note = normalizeName(manual.note ?? "");
  return cap.length >= 2 && note.includes(cap);
}

export interface ManualLineLike { line: string; note?: string; dupDismissed?: string[]; source?: unknown }
export interface DuplicateWarning { capabilityKey: string; capabilityName: string; manualIndex: number; manualLine: string }

/** Warning only, never a block. A manual line can dismiss it per capability (`dupDismissed`). */
export function findDuplicateWarnings(reflectedLines: Array<Pick<CapabilityCostLine, "capabilityKey" | "name">>, manual: ManualLineLike[]): DuplicateWarning[] {
  const out: DuplicateWarning[] = [];
  manual.forEach((m, i) => {
    if (m?.source === "capability" || !m?.line?.trim()) return;
    for (const c of reflectedLines) {
      if (m.dupDismissed?.includes(c.capabilityKey)) continue;
      if (isLikelyDuplicate(c.name, m)) out.push({ capabilityKey: c.capabilityKey, capabilityName: c.name, manualIndex: i, manualLine: m.line.trim() });
    }
  });
  return out;
}

// ── Totals over all investment lines ────────────────────────────────────────

const ANNUAL: Record<string, number> = { monthly: 12, quarterly: 4, yearly: 1, lumpsum: 1 };

export interface InvestmentTotals {
  /** 백만원 (the displayed unit). */
  capabilityKrwM: number;
  reflectedKrwM: number;
  manualKrwM: number;
  grandKrwM: number;
  /** 억 equivalents (2 decimals), kept for older callers. */
  capabilityEok: number;
  reflectedEok: number;
  manualEok: number;
  /** 일시불 합계와 연간(반복 환산) 합계 — manualKrwM = lumpsum + recurring. */
  manualLumpsumKrwM: number;
  manualRecurringKrwM: number;
  /** Non-KRW manual lines are left out of the totals (no FX in this feature). */
  manualExcludedNonKrw: number;
  /** Manual lines missing category/period/currency/unit are left out until a person confirms them. */
  manualExcludedNeedsConfirm: number;
  grandEok: number;
  reflectedCount: number;
  needsRejudgeCount: number;
  /** ADR-0175: 인력 운영 계획 인건비 합계 (검토 기간 총액 + 채용 일회비, 백만원) — already inside grandKrwM, never also a manual line. */
  staffingKrwM: number;
  /** 인력 운영 계획 행 중 급여/가산율 미입력으로 인건비에서 제외된 행 수. */
  staffingNeedConfirmCount: number;
}

/** Manual cost lines count lump sums as entered and recurring lines annualised; revenue and 정부 R&D are not 투자비. */
export function investmentTotals(view: CapabilityCostView, reflectedKeys: ReadonlySet<string>, manual: Array<{ category?: string; amount?: number; amountUnit?: string; amountUnitConfirmed?: boolean; amountKrwM?: number | null; currency?: string; period?: string }>, staffing: StaffingPlanEntry | null = null, horizon: number = DEFAULT_HORIZON_YEARS): InvestmentTotals {
  const staffView = staffing ? staffingPlanView(staffing, horizon) : null;
  const staffingKrwM = staffView ? staffView.totalKrwM + staffView.recruitingTotalKrwM : 0;
  const reflected = view.lines.filter((l) => reflectedKeys.has(l.capabilityKey));
  const reflectedKrwM = reflected.reduce((s, l) => s + l.costKrwM, 0);
  let manualKrwM = 0;
  let lumpsumKrwM = 0;
  let recurringKrwM = 0;
  let excluded = 0;
  let excludedNeedsConfirm = 0;
  for (const m of manual) {
    if (m.category === "revenue" || m.category === "gov_rnd") continue;
    if (manualLineNeedsConfirm(m as ManualCostLine)) { excludedNeedsConfirm += 1; continue; }
    if (m.currency && m.currency !== "KRW") { excluded += 1; continue; }
    const krwM = manualLineKrwM(m);
    if (krwM === null) { excludedNeedsConfirm += 1; continue; }
    const annual = krwM * (ANNUAL[m.period ?? "yearly"] ?? 1);
    manualKrwM += annual;
    if (m.period === "lumpsum") lumpsumKrwM += annual; else recurringKrwM += annual;
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    capabilityKrwM: round2(view.totals.capabilityKrwM),
    reflectedKrwM: round2(reflectedKrwM),
    manualKrwM: round2(manualKrwM),
    grandKrwM: round2(reflectedKrwM + manualKrwM + staffingKrwM),
    capabilityEok: eokOf(view.totals.capabilityKrwM),
    reflectedEok: eokOf(reflectedKrwM),
    manualEok: round2(manualKrwM / 100),
    manualLumpsumKrwM: round2(lumpsumKrwM),
    manualRecurringKrwM: round2(recurringKrwM),
    manualExcludedNonKrw: excluded,
    manualExcludedNeedsConfirm: excludedNeedsConfirm,
    grandEok: round2((reflectedKrwM + manualKrwM + staffingKrwM) / 100),
    reflectedCount: reflected.length,
    needsRejudgeCount: reflected.filter((l) => l.needsRejudge).length,
    staffingKrwM: round2(staffingKrwM),
    staffingNeedConfirmCount: staffView ? staffView.needConfirmCount : 0,
  };
}

// ── Investment summary (ADR-0174 slice 1) ───────────────────────────────────

/** Loose manual-line shape for the summary (subset of ManualCostLine plus optional timing). */
export interface SummaryLine {
  category?: string;
  amount?: number;
  amountUnit?: string;
  amountUnitConfirmed?: boolean;
  amountKrwM?: number | null;
  currency?: string;
  period?: string;
  startYear?: number;
  endYear?: number;
}

export interface InvestmentSummaryCategoryRow { category: "labor" | "opex" | "capex"; annualKrwM: number; lumpsumKrwM: number; totalKrwM: number }

export interface InvestmentSummary {
  horizon: number;
  /** 연간(반복) 투자비 — run-rate of recurring cost lines, 백만원/년. */
  annualRecurringKrwM: number;
  /** 일시 투자비 — KRW lump sums, 백만원. */
  lumpsumKrwM: number;
  /** 총 투자비 over the horizon, 백만원 (includes labor/opex; capex subtotal separate). */
  totalKrwM: number;
  capexSubtotalKrwM: number;
  byCategory: InvestmentSummaryCategoryRow[];
  /** Y1..Y{horizon} per category, the investment total, and inflow rows (never inside 투자비). */
  schedule: Array<{ year: number; labor: number; opex: number; capex: number; investmentTotal: number; revenue: number; govRnd: number }>;
  excludedNonKrw: number;
  excludedNeedsConfirm: number;
  /** Recurring lines whose endYear exceeds the horizon (flagged, clamped to the horizon). */
  endYearExceedsHorizon: number;
  /** Capability lines whose spend year came from the milestone months (판정 기간에서 산정). */
  capabilitySpendFromMilestone: number;
  /** ADR-0175: 인건비 category's 인력 운영 계획 연동분 (총액 + 채용 일회비, 백만원); 0 without a plan. */
  staffingLaborKrwM: number;
  staffingNeedConfirmCount: number;
}

/**
 * 투자비 요약 builder (ADR-0174 slice 1, design §3/§4). KRW-only; revenue and 정부 R&D are
 * shown in the schedule but never inside 투자비; non-KRW and unconfirmed-unit lines are
 * excluded and counted. Legacy defaults: no startYear = Y1, recurring without endYear runs
 * through the horizon, missing plan_meta = 5 years.
 */
export function buildInvestmentSummary(manual: SummaryLine[], capLines: CapabilityCostLine[], horizon: number, reflectedKeys: ReadonlySet<string>, staffing: StaffingPlanEntry | null = null): InvestmentSummary {
  const H = Math.max(1, Math.floor(horizon));
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const cats: Array<"labor" | "opex" | "capex"> = ["labor", "opex", "capex"];
  const annualByCat: Record<"labor" | "opex" | "capex", number> = { labor: 0, opex: 0, capex: 0 };
  const lumpByCat: Record<"labor" | "opex" | "capex", number> = { labor: 0, opex: 0, capex: 0 };
  const yearCat: Record<"labor" | "opex" | "capex", number[]> = { labor: Array(H).fill(0), opex: Array(H).fill(0), capex: Array(H).fill(0) };
  const inflow: Record<"revenue" | "gov_rnd", number[]> = { revenue: Array(H).fill(0), gov_rnd: Array(H).fill(0) };
  let excludedNonKrw = 0;
  let excludedNeedsConfirm = 0;
  let endYearExceedsHorizon = 0;
  for (const m of manual) {
    const v = manualLineKrwM(m as ManualCostLine);
    if (m.category === "revenue" || m.category === "gov_rnd") {
      if (v === null) continue;
      const annual = v * (ANNUAL[m.period ?? "yearly"] ?? 1);
      const start = Math.max(1, m.startYear ?? 1);
      const end = m.period === "lumpsum" ? start : Math.min(m.endYear ?? H, H);
      for (let y = start; y <= Math.min(end, H); y++) inflow[m.category === "revenue" ? "revenue" : "gov_rnd"][y - 1] += annual;
      continue;
    }
    if (manualLineNeedsConfirm(m as ManualCostLine)) { excludedNeedsConfirm += 1; continue; }
    if (m.currency && m.currency !== "KRW") { excludedNonKrw += 1; continue; }
    if (v === null) { excludedNeedsConfirm += 1; continue; }
    if (m.endYear !== undefined && m.endYear > H) endYearExceedsHorizon += 1;
    if (m.category !== "labor" && m.category !== "opex" && m.category !== "capex") continue;
    const cat = m.category as "labor" | "opex" | "capex";
    if (m.period === "lumpsum") {
      lumpByCat[cat] += v;
      const y = Math.max(1, m.startYear ?? 1);
      if (y <= H) yearCat[cat][y - 1] += v;
    } else {
      const annual = v * (ANNUAL[m.period ?? "yearly"] ?? 1);
      annualByCat[cat] += annual;
      const start = Math.max(1, m.startYear ?? 1);
      const end = Math.min(m.endYear ?? H, H);
      for (let y = start; y <= end; y++) yearCat[cat][y - 1] += annual;
    }
  }
  let capabilitySpendFromMilestone = 0;
  for (const c of capLines) {
    if (!reflectedKeys.has(c.capabilityKey)) continue;
    const y = Math.max(1, Math.min(c.startYear, H));
    yearCat[c.category][y - 1] += c.costKrwM;
    lumpByCat[c.category] += c.costKrwM;
    if (c.startYear === c.defaultStartYear && c.monthsToAttain !== null && c.monthsToAttain > 0) capabilitySpendFromMilestone += 1;
  }
  // ADR-0175: the 인력 운영 계획 vector feeds the 인건비 category per year (derived, read-only,
  // never a manual line). Recurring run-rate = the last in-window year's cost; recruiting one-offs are lump sums.
  let staffingLaborKrwM = 0;
  let staffingNeedConfirmCount = 0;
  if (staffing) {
    const view = staffingPlanView(staffing, H);
    const vec = staffingSummaryVector(staffing, H);
    for (let i = 0; i < H; i++) yearCat.labor[i] += vec.annualByYear[i] + vec.recruitingByYear[i];
    const recruiting = vec.recruitingByYear.reduce((a, n) => a + n, 0);
    lumpByCat.labor += recruiting;
    annualByCat.labor += vec.annualByYear[Math.min(staffing.endYear, H) - 1] ?? 0;
    staffingLaborKrwM = view.totalKrwM + recruiting;
    staffingNeedConfirmCount = view.needConfirmCount;
  }
  const totalByCat: Record<"labor" | "opex" | "capex", number> = { labor: yearCat.labor.reduce((s, n) => s + n, 0), opex: yearCat.opex.reduce((s, n) => s + n, 0), capex: yearCat.capex.reduce((s, n) => s + n, 0) };
  const byCategory = cats.map((c) => ({ category: c, annualKrwM: round2(annualByCat[c]), lumpsumKrwM: round2(lumpByCat[c]), totalKrwM: round2(totalByCat[c]) }));
  const schedule = Array.from({ length: H }, (_, i) => {
    const catSum = cats.reduce((s, c) => s + yearCat[c][i], 0);
    return { year: i + 1, labor: round2(yearCat.labor[i]), opex: round2(yearCat.opex[i]), capex: round2(yearCat.capex[i]), investmentTotal: round2(catSum), revenue: round2(inflow.revenue[i]), govRnd: round2(inflow.gov_rnd[i]) };
  });
  return {
    horizon: H,
    annualRecurringKrwM: round2(cats.reduce((s, c) => s + annualByCat[c], 0)),
    lumpsumKrwM: round2(cats.reduce((s, c) => s + lumpByCat[c], 0)),
    totalKrwM: round2(cats.reduce((s, c) => s + totalByCat[c], 0)),
    capexSubtotalKrwM: round2(totalByCat.capex),
    byCategory,
    schedule,
    excludedNonKrw,
    excludedNeedsConfirm,
    endYearExceedsHorizon,
    capabilitySpendFromMilestone,
    staffingLaborKrwM: round2(staffingLaborKrwM),
    staffingNeedConfirmCount,
  };
}


export interface InvestmentChartData {
  /** Axis labels "Y1".."YN". */
  years: string[];
  /** Per-year stacks (백만원); labor already includes the staffing-derived labour. */
  stacks: { labor: number[]; opex: number[]; capex: number[] };
  /** Inflow series, never stacked into 투자비 (백만원). */
  revenue: number[];
  govRnd: number[];
  /** Running total of the per-year 투자비 (백만원). */
  cumulative: number[];
  composition: Array<{ category: "labor" | "opex" | "capex"; label: string; totalKrwM: number; percent: number }>;
  totalKrwM: number;
  staffingLaborKrwM: number;
  excludedNeedsConfirm: number;
  /** False when there is nothing to plot (no investment and no inflow). */
  hasData: boolean;
}

/** Pure chart-data builder over the 투자비 요약 (same numbers as the tables; no new derivation). */
export function buildInvestmentChartData(summary: InvestmentSummary): InvestmentChartData {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const sched = summary.schedule;
  let run = 0;
  const cumulative = sched.map((s) => { run += s.investmentTotal; return round2(run); });
  const total = summary.byCategory.reduce((a, r) => a + r.totalKrwM, 0);
  const composition = summary.byCategory.map((r) => ({
    category: r.category,
    label: CATEGORY_LABEL[r.category],
    totalKrwM: r.totalKrwM,
    percent: total > 0 ? Math.round((r.totalKrwM / total) * 1000) / 10 : 0,
  }));
  const inflow = sched.some((s) => s.revenue !== 0 || s.govRnd !== 0);
  return {
    years: sched.map((s) => `Y${s.year}`),
    stacks: { labor: sched.map((s) => s.labor), opex: sched.map((s) => s.opex), capex: sched.map((s) => s.capex) },
    revenue: sched.map((s) => s.revenue),
    govRnd: sched.map((s) => s.govRnd),
    cumulative,
    composition,
    totalKrwM: summary.totalKrwM,
    staffingLaborKrwM: summary.staffingLaborKrwM,
    excludedNeedsConfirm: summary.excludedNeedsConfirm,
    hasData: total > 0 || inflow,
  };
}


export type CostLineError = { code: "invalid_request" | "unknown_capability" | "invalid_category" | "amount_mismatch" | "not_reflectable" | "no_cost" | "invalid_amount_unit"; message: string };

const AMOUNT_EPS = 1e-6;

/**
 * Validate and normalise the posted `business_case_lines`. Manual lines pass through untouched.
 * Capability entries are rebuilt from the live judgement: the client amount is never trusted (a
 * different number is rejected), the basis hash is server-computed, and reflecting a judgement
 * that is not confirmed/non-stale is only allowed when it was already reflected (OD-7).
 */
export function normalizeBusinessCaseLines(
  incoming: unknown,
  rows: CostSourceRow[],
  previous: unknown,
  actor: { userId: string; at: string },
): { ok: true; lines: unknown[]; events: Array<{ action: string; target: string }> } | { ok: false; error: CostLineError } {
  if (!Array.isArray(incoming)) return { ok: false, error: { code: "invalid_request", message: "business_case_lines는 배열이어야 합니다." } };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const prev = new Map((Array.isArray(previous) ? previous.filter(isCapabilityEntry) : []).map((e) => [e.capabilityKey, e]));
  const out: unknown[] = [];
  const events: Array<{ action: string; target: string }> = [];
  const seen = new Set<string>();
  const horizonRaw = planMetaOf(incoming);
  const horizon = horizonRaw ? horizonRaw.horizonYears : DEFAULT_HORIZON_YEARS;
  for (const raw of incoming) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: { code: "invalid_request", message: "business_case_lines의 각 항목은 객체여야 합니다." } };
    if (isPlanMetaEntry(raw)) {
      // Exactly one valid meta entry is kept; additional/invalid ones are dropped silently (the
      // client writes the horizon, so an invalid one arriving here means a stale tab raced a save).
      if (planMetaEntryIsValid(raw) && !out.some(isPlanMetaEntry)) out.push(raw);
      continue;
    }
    if (isStaffingPlanEntry(raw)) {
      // ADR-0175 slice 1: exactly one validated staffing_plan entry is kept. An invalid entry is a
      // hard 400 — a person typed these rows, so silent drops would hide their input. The stamp
      // (updatedAt/updatedBy) is always refreshed to the calling actor; the audit event fires only
      // when the plan body actually changed (hash without salary values).
      const v = normalizeStaffingPlanEntry(raw, horizon);
      if (!v.ok) return { ok: false, error: { code: "invalid_request", message: v.message } };
      const prevPlan = staffingPlanOf(previous);
      if (!out.some(isStaffingPlanEntry)) {
        out.push({ ...v.entry, updatedAt: actor.at, updatedBy: actor.userId });
        if (staffingPlanChanged(prevPlan, v.entry)) events.push({ action: "staffing_plan.updated", target: staffingPlanAuditHash(v.entry) });
      }
      continue;
    }
    if (!isCapabilityEntry(raw)) {
      // A manual line must not smuggle the capability markers.
      const { source: _s, capabilityKey: _k, reflected: _r, basisHash: _b, reflectedBy: _rb, reflectedAt: _ra, ...rest } = raw as Record<string, unknown>;
      if (!("amount" in rest) && rest.amountUnit === undefined && !("amountKrwM" in rest)) { out.push(rest); continue; }
      // Unknown units are rejected outright; there is no silent fallback unit.
      if (typeof rest.amountUnit === "string" && !AMOUNT_UNITS.includes(rest.amountUnit as AmountUnit)) {
        return { ok: false, error: { code: "invalid_amount_unit", message: `알 수 없는 금액 단위입니다: ${rest.amountUnit}` } };
      }
      // No silent unit migration: the line keeps the amount and unit the person chose; the server
      // computes the canonical 백만원 only when the line is complete and its unit is confirmed.
      const m = normalizeLegacyLine(rest);
      const yearErr = validateLineYears(m, horizon);
      if (yearErr) return { ok: false, error: { code: "invalid_request", message: yearErr } };
      const confirmed = !manualLineNeedsConfirm(m);
      out.push({ ...m, amountUnitConfirmed: confirmed, amountKrwM: confirmed ? manualLineKrwM(m) : null });
      continue;
    }
    const key = raw.capabilityKey;
    const row = byId.get(key);
    if (!row || seen.has(key)) return { ok: false, error: { code: "unknown_capability", message: `레지스터에 없는 역량 항목입니다: ${key}` } };
    seen.add(key);
    const cost = row.closing_cost_krw_m;
    if (cost === null || !(cost > 0)) return { ok: false, error: { code: "no_cost", message: `${row.capability}: 해소 비용이 0보다 커야 투자비에 담을 수 있습니다.` } };
    const category = raw.category ?? row.category ?? suggestCategory(row.resolution).category;
    if (!CAPABILITY_COST_CATEGORIES.includes(category as CostCategory)) return { ok: false, error: { code: "invalid_category", message: `${row.capability}: 분류는 인건비·운영비·설비투자 중 하나여야 합니다.` } };
    // The amount is stored and compared in 백만원; a client without the unit marker (legacy) sent 억.
    const live = cost;
    const rawAmount = raw.amount as unknown;
    const rawKrwM = typeof rawAmount === "number" && Number.isFinite(rawAmount) ? ((raw as { amountUnit?: unknown }).amountUnit === AMOUNT_UNIT_KRW_M ? rawAmount : rawAmount * 100) : null;
    if (rawAmount !== undefined && (rawKrwM === null || Math.abs(rawKrwM - live) > AMOUNT_EPS * 100)) {
      return { ok: false, error: { code: "amount_mismatch", message: `${row.capability}: 금액은 판정에서 정해집니다(${formatKrwM(live)}) — 금액을 바꾸려면 판정을 바꾸세요. 화면을 새로 고쳐 최신 판정을 확인하세요.` } };
    }
    const reflected = raw.reflected === true;
    const before = prev.get(key);
    const wasReflected = before?.reflected === true;
    if (reflected && !wasReflected && (row.confirmed_at === null || row.stale)) {
      return { ok: false, error: { code: "not_reflectable", message: `${row.capability}: 확정되지 않았거나 재판정이 필요한 판정은 투자비에 반영할 수 없습니다.` } };
    }
    const startYear = isValidYearValue((raw as { startYear?: unknown }).startYear) ? (raw as { startYear: number }).startYear : undefined;
    if (startYear !== undefined && (startYear < 1 || startYear > horizon)) {
      return { ok: false, error: { code: "invalid_request", message: `${row.capability}: 집행 연차는 1..${horizon}년이어야 합니다.` } };
    }
    out.push({
      line: `${row.capability} 역량 해소`,
      category,
      amount: live,
      amountUnit: AMOUNT_UNIT_KRW_M,
      amountUnitConfirmed: true,
      currency: "KRW",
      period: "lumpsum",
      note: `S5 역량 해소 비용 연동 (${row.resolution ? RESOLUTION_LABEL[row.resolution] : "해소 방식 미정"})`,
      ...(startYear !== undefined ? { startYear } : {}),
      source: "capability",
      capabilityKey: key,
      reflected,
      basisHash: costBasisHash(row),
      costKrwM: cost,
      ...(reflected ? (wasReflected && before?.reflectedBy ? { reflectedBy: before.reflectedBy, reflectedAt: before.reflectedAt } : { reflectedBy: actor.userId, reflectedAt: actor.at }) : {}),
    } satisfies Omit<StoredCapabilityEntry, "reflectedBy" | "reflectedAt"> & { reflectedBy?: string; reflectedAt?: string });
    const target = `${key}:${cost}:${category}:${costBasisHash(row)}`;
    if (reflected && !wasReflected) events.push({ action: "capability_cost.reflect", target });
    else if (!reflected && wasReflected) events.push({ action: "capability_cost.unreflect", target });
    else if (reflected && wasReflected && typeof before?.amount === "number" && Math.abs(lineAmountKrwM(before) - live) > 1e-6) events.push({ action: "capability_cost.amount_followed", target: `${key}:${lineAmountKrwM(before)}->${live}` });
  }
  // ADR-0175 slice 1: a lines-only POST that does not carry the staffing plan (e.g. the reflection
  // save) keeps the stored plan — delete is an explicit empty-rows save, never an omission.
  if (!out.some(isStaffingPlanEntry)) {
    const prev = staffingPlanOf(previous);
    if (prev) out.push(prev);
  }
  // Newly dismissed duplicate warnings.
  const dismissed = (xs: unknown) => new Set((Array.isArray(xs) ? xs : []).flatMap((x) => (x && typeof x === "object" && Array.isArray((x as { dupDismissed?: unknown }).dupDismissed) ? ((x as { dupDismissed: string[] }).dupDismissed.map((k) => `${(x as { line?: string }).line ?? ""}|${k}`)) : [])));
  const before = dismissed(previous);
  for (const d of dismissed(out)) if (!before.has(d)) events.push({ action: "capability_cost.dup_dismissed", target: d });
  return { ok: true, lines: out, events };
}

// ── Promotion (server) ──────────────────────────────────────────────────────

export interface PromotionCapabilityLine { category: CostCategory; name: string; krwM: number; note: string; /** Spend year: stored override, else the milestone months (OD-6), else 1. */ startYear: number }

/**
 * Split stored lines for the greenfield promotion copy (ADR-0137/0138, ADR-0174 slice 2): `reflected:false`
 * entries and the `plan_meta` entry are excluded; reflected capability entries come back as exact 백만원 lump
 * sums recomputed from the live judgement (a deleted/zero-cost capability is skipped and listed); the plan
 * horizon from `plan_meta` (default 5) is returned for the copied model.
 */
export function splitForPromotion(lines: unknown[], rows: CostSourceRow[]): { manual: unknown[]; capability: PromotionCapabilityLine[]; skipped: string[]; skippedManual: Array<{ line: string; reason: "unit_unconfirmed" | "currency_non_krw" }>; horizon: number } {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const manual: unknown[] = [];
  const capability: PromotionCapabilityLine[] = [];
  const skipped: string[] = [];
  const skippedManual: Array<{ line: string; reason: "unit_unconfirmed" | "currency_non_krw" }> = [];
  const horizon = planMetaOf(lines)?.horizonYears ?? DEFAULT_HORIZON_YEARS;
  for (const l of lines) {
    if (isPlanMetaEntry(l) || isStaffingPlanEntry(l)) continue; // staffing hand-off to S8 is ADR-0175 slice 2
    if (!isCapabilityEntry(l)) {
      const m = l as ManualCostLine;
      if (manualLineNeedsConfirm(m)) { skippedManual.push({ line: String(m.line ?? ""), reason: "unit_unconfirmed" }); continue; }
      if (m.currency && m.currency !== "KRW") { skippedManual.push({ line: String(m.line ?? ""), reason: "currency_non_krw" }); continue; }
      manual.push(l);
      continue;
    }
    if (l.reflected !== true) continue;
    const row = byId.get(l.capabilityKey);
    const cost = row?.closing_cost_krw_m ?? null;
    if (!row || cost === null || !(cost > 0)) { skipped.push(l.capabilityKey); continue; }
    const category = row.category ?? (CAPABILITY_COST_CATEGORIES.includes(l.category as CostCategory) ? (l.category as CostCategory) : suggestCategory(row.resolution).category);
    const flags = ["역량 해소 비용", `S5 연동 (판정 ${row.id})`, "일시불 총액"];
    if (row.stale || (!!l.basisHash && !basisHashMatches(l.basisHash, row))) flags.push("역량 판정 재판정 필요 — 금액 검증 필요");
    capability.push({ category, name: `${row.capability} 역량 해소`, krwM: cost, note: flags.join(". "), startYear: isValidYearValue(l.startYear) ? l.startYear : capabilityDefaultStartYear(row.months_to_attain) });
  }
  return { manual, capability, skipped, skippedManual, horizon };
}

// ── Milestone candidate ─────────────────────────────────────────────────────

export function milestoneDerivedHash(row: Pick<CapabilityGapRow, "id" | "capability" | "resolution">, months: number): string {
  return sha256Hex(JSON.stringify([row.id, row.capability.trim(), row.resolution ?? null, months])).slice(0, 16);
}

/** Candidate for a row, derived from the judgement; undefined when there is no period. Never client-supplied. */
export function milestoneCandidateOf(row: CapabilityGapRow): MilestoneCandidate | undefined {
  const months = row.attainability?.monthsToAttain ?? null;
  if (months === null || !(months > 0)) return undefined;
  return { name: `${row.capability.trim()} 해소`, months, resolution: row.resolution ?? null, rowId: row.id, derivedFromHash: milestoneDerivedHash(row, months) };
}

export interface MilestoneCandidateView extends MilestoneCandidate {
  /** Stale judgement: the candidate is shown with its prior months and flagged. */
  stale: boolean;
  /** The stored candidate no longer matches the judgement it was derived from. */
  outdated: boolean;
  /** False when derived on the fly because none was stored yet (legacy row). */
  stored: boolean;
}

export function milestoneCandidateView(row: CapabilityGapRow): MilestoneCandidateView | null {
  const stored = row.attainability?.milestoneCandidate;
  const live = milestoneCandidateOf(row);
  if (!stored && !live) return null;
  const base = stored ?? live!;
  return { ...base, stale: isStale(row), outdated: !!stored && (!live || stored.derivedFromHash !== live.derivedFromHash), stored: !!stored };
}

// ── Client selection overlay ────────────────────────────────────────────────

export interface CostSelection { reflected?: boolean; category?: CostCategory }

/** Overlay the person's unsaved checkbox/category choices on the derived lines. */
export function applySelection(view: CapabilityCostView, sel: Readonly<Record<string, CostSelection>>): CapabilityCostLine[] {
  return view.lines.map((l) => {
    const s = sel[l.capabilityKey];
    if (!s) return l;
    const reflected = s.reflected ?? l.reflected;
    return { ...l, reflected, category: s.category ?? l.category, needsRejudge: reflected && (l.stale || l.needsRejudge) };
  });
}

/** Payload entries for the saved capability lines: reflected ones, plus explicit un-checks of default/previously stored rows. */
export function selectionPayload(lines: CapabilityCostLine[], sel: Readonly<Record<string, CostSelection>>): Array<{ source: "capability"; capabilityKey: string; reflected: boolean; category: CostCategory; amount: number; amountUnit: typeof AMOUNT_UNIT_KRW_M; amountUnitConfirmed: true }> {
  return lines
    .filter((l) => l.reflected || l.persisted || sel[l.capabilityKey]?.reflected === false)
    .map((l) => ({ source: "capability" as const, capabilityKey: l.capabilityKey, reflected: l.reflected, category: l.category, amount: l.costKrwM, amountUnit: AMOUNT_UNIT_KRW_M, amountUnitConfirmed: true as const }));
}

// ── S5 reflection action (explicit save of the capability selections) ────────

export type LineSaveState = "saved" | "unsaved" | null;

/** Per capability line: reflected AND stored the same way = saved; any difference between the page and the stored entry = unsaved. */
export function lineSaveStates(lines: CapabilityCostLine[], stored: unknown, sel: Readonly<Record<string, CostSelection>>): Record<string, LineSaveState> {
  const entries = new Map((Array.isArray(stored) ? stored.filter(isCapabilityEntry) : []).map((e) => [e.capabilityKey, e]));
  const out: Record<string, LineSaveState> = {};
  for (const l of lines) {
    const e = entries.get(l.capabilityKey);
    const savedReflected = e?.reflected === true;
    const savedCategory = e && CAPABILITY_COST_CATEGORIES.includes(e.category as CostCategory) ? (e.category as CostCategory) : l.suggestedCategory;
    const touched = !!sel[l.capabilityKey];
    if (l.reflected && savedReflected && l.category === savedCategory) out[l.capabilityKey] = "saved";
    else if (l.reflected !== savedReflected || (l.reflected && l.category !== savedCategory) || (touched && !e && l.reflected)) out[l.capabilityKey] = "unsaved";
    else out[l.capabilityKey] = null;
  }
  return out;
}
export const hasUnsavedReflection = (states: Record<string, LineSaveState>): boolean => Object.values(states).some((s) => s === "unsaved");

/** The partial-save body: ONLY business_case_lines (manual lines as held + capability selections). */
export function reflectionBody(manual: Array<{ line: string }>, capLines: CapabilityCostLine[], sel: Readonly<Record<string, CostSelection>>): { business_case_lines: unknown[] } {
  return { business_case_lines: [...manual.filter((l) => l.line.trim()), ...selectionPayload(capLines, sel)] };
}

/** "N건 반영, 반영 합계 X백만원 — 투자비 전체 합계 Y백만원" */
export function reflectionSummary(totals: Pick<InvestmentTotals, "reflectedCount" | "reflectedKrwM" | "grandKrwM">): string {
  return `${totals.reflectedCount}건 반영, 반영 합계 ${formatKrwM(totals.reflectedKrwM)} — 투자비 전체 합계 ${formatKrwM(totals.grandKrwM)}`;
}

// ── Unified investment item list (one list: manual lines, then reflected capability lines) ──

export type UnifiedRow =
  | { kind: "manual"; manualIndex: number }
  | {
      kind: "capability";
      capabilityKey: string;
      name: string;
      category: CostCategory;
      krwM: number;
      note: string;
      saveState: LineSaveState;
      /** Saved-reflected but unchecked on the page: shown until the reflect button saves the removal. */
      pendingRemoval: boolean;
      needsRejudge: boolean;
    };

/**
 * Rows of the single investment item list: manual lines in held order (index kept for editing), then every
 * reflected capability line (page state) plus saved-reflected lines the person just unchecked. Unreflected
 * lines stay in the read-only block only. Pure; the save payload is built elsewhere and is unchanged.
 */
export function unifiedInvestmentRows(
  manualLines: ReadonlyArray<unknown>,
  capLines: CapabilityCostLine[],
  capSel: Readonly<Record<string, CostSelection>>,
  states: Readonly<Record<string, LineSaveState>> = {},
): UnifiedRow[] {
  const rows: UnifiedRow[] = manualLines.map((_, i) => ({ kind: "manual" as const, manualIndex: i }));
  for (const l of capLines) {
    const pendingRemoval = !l.reflected && l.persisted && capSel[l.capabilityKey]?.reflected === false;
    if (!l.reflected && !pendingRemoval) continue;
    rows.push({
      kind: "capability",
      capabilityKey: l.capabilityKey,
      name: `${l.name} (역량 해소)`,
      category: l.category,
      krwM: l.costKrwM,
      note: `S5 판정에서 연동 · 해소 방식 ${l.resolutionLabel} · 기간 ${l.monthsToAttain !== null ? `${l.monthsToAttain}개월` : "미입력"}`,
      saveState: states[l.capabilityKey] ?? null,
      pendingRemoval,
      needsRejudge: l.needsRejudge,
    });
  }
  return rows;
}

/** Footer of the unified list: the count of listed items (pending removals excluded) and the sum, which is investmentTotals.grandKrwM. */
export function unifiedFooter(rows: UnifiedRow[], totals: Pick<InvestmentTotals, "grandKrwM">): { count: number; text: string } {
  const count = rows.filter((r) => r.kind === "manual" || !r.pendingRemoval).length;
  return { count, text: `항목 ${count}건 · 합계 ${formatKrwM(totals.grandKrwM)}` };
}
