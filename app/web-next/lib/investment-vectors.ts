// ADR-0176 slice 1: shared investment vectors module + deterministic S5 bands (option B').
// Single source of the per-year investment vectors for S5 (and, in later slices, S8). The mode
// band is a behaviour-preserving refactor of the S5 summary math (capability-cost-lines.ts
// helpers are reused; nothing is recomputed differently), so mode === the stored totals.
// Bands are DETERMINISTIC extremes of human-confirmed assumption ranges — no sampling, no
// draws, no probabilities (those are slice 2). Decision support only; never a gate or a cap.
import { manualLineKrwM, manualLineNeedsConfirm, manualLineYearVector, preLaunchAmountOf, type CapabilityCostLine, type SimOverrides, capabilityYearVector } from "./capability-cost-lines.ts";
import { rowAnnualCostKrwM, staffingSummaryVector, type StaffingPlanEntry, type StaffingRow } from "./staffing-plan.ts";

/** Loose manual-line shape (same subset the S5 summary accepts). */
export interface VectorManualLine {
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

// ── Assumption ranges (ADR-0176, human-confirmed 2026-10-15) ─────────────────

/** Salary base +-10% (a range shift on an analyst-entered base; never fabricated). */
export const SALARY_RANGE = 0.10;
/** Salary increase rate +-2pp; applied only where a rate exists (entered, non-zero). */
export const SALARY_INCREASE_RANGE_PP = 2;
/** On-cost rate +-2pp; applied only after a person entered a rate — never fabricated. */
export const ON_COST_RANGE_PP = 2;
/** Headcount ramp: a half-year shift (delayed for low, advanced for high, triangular weights). */
export const RAMP_SHIFT_HALF_YEARS = 0.5;
/** Capability closing costs +-30%. */
export const CAPABILITY_RANGE = 0.30;
/** Manual cost lines +-20%. */
export const MANUAL_LINE_RANGE = 0.20;
/** FX +-10% — defined but INACTIVE in slice 1: non-KRW lines are excluded from KRW totals. */
export const FX_RANGE = 0.10;

export interface InvestmentAssumptions {
  salary: { range: number; appliesTo: "analyst-entered base only" };
  salaryIncrease: { rangePp: number; appliesTo: "rows with an entered non-zero rate" };
  onCost: { rangePp: number; appliesTo: "rows with an entered rate only" };
  ramp: { shiftHalfYears: number; shape: "triangular discrete shift" };
  capability: { range: number };
  manualLines: { range: number };
  fx: { range: number; active: false };
}

export const INVESTMENT_ASSUMPTIONS: InvestmentAssumptions = {
  salary: { range: SALARY_RANGE, appliesTo: "analyst-entered base only" },
  salaryIncrease: { rangePp: SALARY_INCREASE_RANGE_PP, appliesTo: "rows with an entered non-zero rate" },
  onCost: { rangePp: ON_COST_RANGE_PP, appliesTo: "rows with an entered rate only" },
  ramp: { shiftHalfYears: RAMP_SHIFT_HALF_YEARS, shape: "triangular discrete shift" },
  capability: { range: CAPABILITY_RANGE },
  manualLines: { range: MANUAL_LINE_RANGE },
  fx: { range: FX_RANGE, active: false },
};

// ── Output shapes ────────────────────────────────────────────────────────────

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** One deterministic band over the review horizon, all amounts in 백만원. */
export interface InvestmentBandVector {
  /** Y1..Y{horizon} total investment per year (capability + manual + staffing). */
  totalByYear: number[];
  /** Horizon total of totalByYear. */
  grandKrwM: number;
  /** Reflected capability-line spend per year and its horizon total. */
  capabilityByYear: number[];
  capabilityKrwM: number;
  /** Confirmed KRW manual-line spend per year (cadence-annualised) and its horizon total. */
  manualByYear: number[];
  manualKrwM: number;
  /** Staffing-derived labor (annual + recruiting one-offs) per year and its horizon total. */
  staffingByYear: number[];
  staffingKrwM: number;
  /**
   * ADR-0178 slice 1: 시작 전 (year-0) investment, 백만원. Present ONLY when a person marked a capex
   * lump sum `startYear: 0`. It is NOT in totalByYear (Y1..H) but IS in manualKrwM and grandKrwM, so
   * grandKrwM = sum(totalByYear) + preLaunchKrwM. Absent for every legacy plan (bit-identical).
   */
  preLaunchKrwM?: number;
}

export interface InvestmentVectorsResult {
  horizon: number;
  low: InvestmentBandVector;
  mode: InvestmentBandVector;
  high: InvestmentBandVector;
  assumptions: InvestmentAssumptions;
}

export interface InvestmentVectorsInput {
  manual: ReadonlyArray<VectorManualLine>;
  capLines: ReadonlyArray<CapabilityCostLine>;
  horizon: number;
  reflectedKeys: ReadonlySet<string>;
  staffing: StaffingPlanEntry | null;
  /** ADR-0176: decider-entered assumption-range overrides; undefined keys fall back to the constants. */
  overrides?: SimOverrides | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const sum = (v: number[]): number => round2(v.reduce((a, n) => a + n, 0));

/** Band vector from its three per-year source vectors (each already rounded per year). */
function bandOf(capability: number[], manual: number[], staffing: number[], pre = 0): InvestmentBandVector {
  const H = capability.length;
  const totalByYear = Array.from({ length: H }, (_, i) => round2(capability[i] + manual[i] + staffing[i]));
  return {
    totalByYear,
    grandKrwM: pre > 0 ? round2(sum(totalByYear) + pre) : sum(totalByYear),
    capabilityByYear: capability,
    capabilityKrwM: sum(capability),
    manualByYear: manual,
    manualKrwM: pre > 0 ? round2(sum(manual) + pre) : sum(manual),
    staffingByYear: staffing,
    staffingKrwM: sum(staffing),
    ...(pre > 0 ? { preLaunchKrwM: round2(pre) } : {}),
  };
}

/** Triangular DELAY shift (low band): weight w of each year's cost moves to the next year. */
export function shiftDelayHalf(v: number[], w = RAMP_SHIFT_HALF_YEARS): number[] {
  return v.map((n, i) => round2((1 - w) * n + (i > 0 ? w * v[i - 1] : 0)));
}

/** Triangular ADVANCE shift (high band): weight w of the next year's cost is pulled into this year. */
export function shiftAdvanceHalf(v: number[], w = RAMP_SHIFT_HALF_YEARS): number[] {
  return v.map((n, i) => round2((1 - w) * n + w * (v[i + 1] ?? 0)));
}

/** Scale a vector by a factor, rounded per year. */
const scaled = (v: number[], f: number): number[] => v.map((n) => round2(n * f));

/** Does this staffing row carry a salary-increase rate at all (an entered, non-zero rate)? */
const hasIncreaseRate = (r: StaffingRow): boolean => r.salaryIncreaseRatePct > 0;

/** Effective assumption values for the UI (override when valid, else the ADR constant). */
export function effectiveAssumptions(overrides?: SimOverrides | null): { salaryRange: number; salaryIncreaseRangePp: number; onCostRangePp: number; rampShiftHalfYears: number; capabilityRange: number; manualLineRange: number } {
  const ov = overrides ?? {};
  const eff = (v: number | undefined, d: number): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
  return {
    salaryRange: eff(ov.salaryRange, SALARY_RANGE),
    salaryIncreaseRangePp: eff(ov.salaryIncreaseRangePp, SALARY_INCREASE_RANGE_PP),
    onCostRangePp: eff(ov.onCostRangePp, ON_COST_RANGE_PP),
    rampShiftHalfYears: eff(ov.rampShiftHalfYears, RAMP_SHIFT_HALF_YEARS),
    capabilityRange: eff(ov.capabilityRange, CAPABILITY_RANGE),
    manualLineRange: eff(ov.manualLineRange, MANUAL_LINE_RANGE),
  };
}

// ── Mode (behaviour-preserving) ──────────────────────────────────────────────

/** Mode manual vector: exactly the lines the S5 summary counts, through manualLineYearVector. */
function modeManualVector(manual: ReadonlyArray<VectorManualLine>, H: number): number[] {
  const out = Array<number>(H).fill(0);
  for (const m of manual) {
    if (m.category === "revenue" || m.category === "gov_rnd") continue;
    if (manualLineNeedsConfirm(m as never)) continue;
    if (m.currency && m.currency !== "KRW") continue;
    if (manualLineKrwM(m as never) === null) continue;
    if (m.category !== "labor" && m.category !== "opex" && m.category !== "capex") continue;
    const vec = manualLineYearVector(m as never, H);
    for (let i = 0; i < H; i++) out[i] += vec[i];
  }
  return out.map(round2);
}

/** Mode capability vector: reflected lines land costKrwM on their (clamped) start year. */
function modeCapabilityVector(capLines: ReadonlyArray<CapabilityCostLine>, H: number, reflectedKeys: ReadonlySet<string>): number[] {
  const out = Array<number>(H).fill(0);
  for (const c of capLines) {
    if (!reflectedKeys.has(c.capabilityKey)) continue;
    const vec = capabilityYearVector(c, H);
    for (let i = 0; i < H; i++) out[i] += vec[i] ?? 0;
  }
  return out.map(round2);
}

/** Mode staffing vector: the same annual + recruiting vectors the summary reads. */
function modeStaffingVector(staffing: StaffingPlanEntry, H: number): number[] {
  const vec = staffingSummaryVector(staffing, H);
  return Array.from({ length: H }, (_, i) => round2(vec.annualByYear[i] + vec.recruitingByYear[i]));
}

// ── Bands ────────────────────────────────────────────────────────────────────

/** Capability band: ± the effective capability range on the mode vector (same years, same lines). */
const capabilityBand = (mode: number[], range: number): { low: number[]; high: number[] } => ({ low: scaled(mode, 1 - range), high: scaled(mode, 1 + range) });

/** Manual band: ± the effective manual-line range on the mode vector. */
const manualBand = (mode: number[], range: number): { low: number[]; high: number[] } => ({ low: scaled(mode, 1 - range), high: scaled(mode, 1 + range) });

/** Staffing annual vector under drawn factors — the SAME annual-cost formula (rowAnnualCostKrwM)
 *  the mode uses; a row without a salary or on-cost rate stays uncosted (nothing is fabricated),
 *  and the increase/on-cost pp shifts apply only where a rate exists. No ramp shift, no recruiting. */
export function staffingAnnualVectorWithFactors(staffing: StaffingPlanEntry, H: number, salaryFactor: number, dIncreasePp: number, dOnCostPp: number): number[] {
  const vec = Array<number>(H).fill(0);
  for (const r of staffing.rows) {
    const perturbed: StaffingRow = {
      ...r,
      avgAnnualBaseSalaryKrwM: r.avgAnnualBaseSalaryKrwM === null ? null : r.avgAnnualBaseSalaryKrwM * salaryFactor,
      salaryIncreaseRatePct: hasIncreaseRate(r) ? Math.max(0, r.salaryIncreaseRatePct + dIncreasePp) : r.salaryIncreaseRatePct,
      onCostRatePct: r.onCostRatePct === null ? null : Math.max(0, r.onCostRatePct + dOnCostPp),
    };
    for (let y = 1; y <= H; y++) {
      const c = rowAnnualCostKrwM(perturbed, staffing, H, y);
      if (c !== null) vec[y - 1] += c;
    }
  }
  return vec.map(round2);
}

/**
 * Staffing band. Salary/increase/on-cost move together (all rows, all years) through
 * staffingAnnualVectorWithFactors; the ramp moves as a triangular half-year shift: delayed for low,
 * advanced for high. Recruiting one-offs are person-entered lumps with no defined range — unperturbed.
 */
function staffingBand(staffing: StaffingPlanEntry, H: number, salaryRange: number, increasePp: number, onCostPp: number, w: number): { low: number[]; high: number[] } {
  const recruiting = staffingSummaryVector(staffing, H).recruitingByYear;
  const low = shiftDelayHalf(staffingAnnualVectorWithFactors(staffing, H, 1 - salaryRange, -increasePp, -onCostPp), w).map((v, i) => round2(v + recruiting[i]));
  const high = shiftAdvanceHalf(staffingAnnualVectorWithFactors(staffing, H, 1 + salaryRange, increasePp, onCostPp), w).map((v, i) => round2(v + recruiting[i]));
  return { low, high };
}

/**
 * Shared deterministic investment vectors (ADR-0176 slice 1, option B'). The `mode` band is the
 * current stored computation (golden-tested against the S5 summary totals); `low`/`high` are the
 * most/least conservative combinations of the human-confirmed assumption ranges. No randomness.
 */
export function buildInvestmentVectors(input: InvestmentVectorsInput): InvestmentVectorsResult {
  const H = Math.max(1, Math.floor(input.horizon));
  const modeCapability = modeCapabilityVector(input.capLines, H, input.reflectedKeys);
  const modeManual = modeManualVector(input.manual, H);
  const modeStaffing = input.staffing ? modeStaffingVector(input.staffing, H) : Array<number>(H).fill(0);
  const ov = input.overrides ?? {};
  const eff = (v: number | undefined, d: number): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
  const capB = capabilityBand(modeCapability, eff(ov.capabilityRange, CAPABILITY_RANGE));
  const manB = manualBand(modeManual, eff(ov.manualLineRange, MANUAL_LINE_RANGE));
  const staffB = input.staffing
    ? staffingBand(input.staffing, H, eff(ov.salaryRange, SALARY_RANGE), eff(ov.salaryIncreaseRangePp, SALARY_INCREASE_RANGE_PP), eff(ov.onCostRangePp, ON_COST_RANGE_PP), eff(ov.rampShiftHalfYears, RAMP_SHIFT_HALF_YEARS))
    : { low: modeStaffing, high: modeStaffing };
  // ADR-0178 slice 1: pre-launch capex lump sums carry the manual-line range like any manual line.
  const pre = round2(preLaunchAmountOf(input.manual));
  const manR = eff(ov.manualLineRange, MANUAL_LINE_RANGE);
  return {
    horizon: H,
    low: bandOf(capB.low, manB.low, staffB.low, round2(pre * (1 - manR))),
    mode: bandOf(modeCapability, modeManual, modeStaffing, pre),
    high: bandOf(capB.high, manB.high, staffB.high, round2(pre * (1 + manR))),
    assumptions: INVESTMENT_ASSUMPTIONS,
  };
}
