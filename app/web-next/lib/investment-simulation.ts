// ADR-0176 slice 2: seeded deterministic Monte Carlo over the S5 investment plan.
// Ranges come from slice 1 (effectiveAssumptions: ADR constants or decider overrides); every
// bounded variable is a triangular draw (min, mode = the entered value, max). Salary variables only
// range-shift an analyst-entered base (staffingAnnualVectorWithFactors leaves a row with no salary
// or rate uncosted) - nothing is fabricated, no price or unit conversion is invented. FX is defined
// but inert while non-KRW lines are excluded from KRW totals. Decision support only: no gate, no grade.
// Per-draw vectors are never stored: the seed + inputs reproduce any draw index exactly.
import { createHash } from "node:crypto";
import { buildInvestmentVectors, effectiveAssumptions, shiftAdvanceHalf, shiftDelayHalf, staffingAnnualVectorWithFactors, FX_RANGE, type InvestmentVectorsInput } from "./investment-vectors.ts";
import { staffingSummaryVector } from "./staffing-plan.ts";
import { mulberry32 } from "./calibration-sweep.ts";

export const DEFAULT_DRAWS = 500;
export const MIN_DRAWS = 100;
export const MAX_DRAWS = 5000;
export const HISTOGRAM_BINS = 20;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Clamp a requested draw count to 100..5,000 (default 500 when absent or not a finite number). */
export function clampDraws(n?: number | null): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_DRAWS;
  return Math.min(MAX_DRAWS, Math.max(MIN_DRAWS, Math.round(n)));
}

/** Person-entered budget envelope (백만원): finite and > 0, or absent. Returns a Korean error or null. */
export function validateEnvelope(x: unknown): string | null {
  if (x === undefined || x === null) return null;
  if (typeof x !== "number" || !Number.isFinite(x) || x <= 0) return "예산 상한은 0보다 큰 숫자(백만원)여야 합니다.";
  return null;
}

/** Triangular inverse-CDF draw; always consumes exactly one rng value so the stream stays aligned. */
export function triangular(rng: () => number, min: number, mode: number, max: number): number {
  const u = rng();
  if (!(max > min)) return mode;
  const m = Math.min(Math.max(mode, min), max);
  const f = (m - min) / (max - min);
  return u < f ? min + Math.sqrt(u * (max - min) * (m - min)) : max - Math.sqrt((1 - u) * (max - min) * (max - m));
}

/** Linear-interpolated percentile (p in 0..1) of an ascending-sorted array. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const pos = Math.min(Math.max(p, 0), 1) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface SimBand { p05: number; p50: number; p95: number }

const bandOf = (values: number[]): SimBand => {
  const s = [...values].sort((a, b) => a - b);
  return { p05: round2(percentile(s, 0.05)), p50: round2(percentile(s, 0.5)), p95: round2(percentile(s, 0.95)) };
};

export type TornadoKey = "salary" | "salaryIncrease" | "onCost" | "ramp" | "capability" | "manualLines" | "fx";

export interface TornadoEntry {
  key: TornadoKey;
  /** Horizon-total at the variable's minimum / maximum with every other variable at its mode (백만원). */
  lowKrwM: number;
  highKrwM: number;
  swingKrwM: number;
  /** Share of the summed swings (0..1); 0 for an inert variable. */
  share: number;
  /** False when the variable cannot move the total (no analyst-entered base/rate, no lines, FX off). */
  active: boolean;
}

export interface SimulationAssumptions {
  salaryRange: number;
  salaryIncreaseRangePp: number;
  onCostRangePp: number;
  rampShiftHalfYears: number;
  capabilityRange: number;
  manualLineRange: number;
  fx: { range: number; active: false };
  distribution: "triangular";
  correlation: "common factor per group (all staffing rows, all capability lines, all manual lines)";
}

export interface SimulationResults {
  horizon: number;
  draws: number;
  seed: number;
  /** Deterministic mode (the stored S5 totals) for reference next to the bands. */
  mode: { grandKrwM: number; totalByYear: number[] };
  total: SimBand & { mean: number; min: number; max: number; histogram: { edges: number[]; counts: number[] } };
  totalByYear: SimBand[];
  byCategory: {
    capability: { total: SimBand; byYear: SimBand[] };
    manual: { total: SimBand; byYear: SimBand[] };
    staffing: { total: SimBand; byYear: SimBand[] };
  };
  tornado: TornadoEntry[];
  /** Present only when the person set an envelope; strictly-greater-than counts as exceeded. */
  exceed: { envelopeKrwM: number; probability: number; exceedCount: number } | null;
  assumptions: SimulationAssumptions;
}

export interface SimulationInput extends InvestmentVectorsInput {
  seed: number;
  draws?: number | null;
  /** Person-entered 예산 상한 (백만원); must pass validateEnvelope. */
  envelopeKrwM?: number | null;
}

export interface DrawFactors { salary: number; inc: number; onc: number; ramp: number; cap: number; man: number }
type Factors = DrawFactors;
const NEUTRAL: Factors = { salary: 1, inc: 0, onc: 0, ramp: 0, cap: 1, man: 1 };

const scaled = (v: number[], f: number): number[] => v.map((n) => round2(n * f));

/** Hash of everything that determines the draws (envelope excluded: it only reads the distribution). */
export function simulationInputHash(input: InvestmentVectorsInput, seed: number, draws: number): string {
  const v = buildInvestmentVectors(input);
  const eff = effectiveAssumptions(input.overrides);
  const payload = { h: v.horizon, c: v.mode.capabilityByYear, m: v.mode.manualByYear, s: input.staffing, eff, seed, draws };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * The per-draw factor stream (ADR-0176 slice 3): draw index d is the same at S5 and S8. Fixed draw
 * order, 7 rng values per draw (FX is drawn to keep the stream stable but never applied). The ranges
 * are the effective ones (a stored run carries them in its assumptions), so a draw is reproducible
 * from (seed, draws, ranges) alone - per-draw vectors are never stored.
 */
export function drawInvestmentFactors(seed: number, draws: number, eff: ReturnType<typeof effectiveAssumptions>): DrawFactors[] {
  const rng = mulberry32(seed);
  const w = Math.min(Math.max(eff.rampShiftHalfYears, 0), 1);
  const out: DrawFactors[] = [];
  for (let d = 0; d < draws; d++) {
    const f: DrawFactors = {
      salary: triangular(rng, 1 - eff.salaryRange, 1, 1 + eff.salaryRange),
      inc: triangular(rng, -eff.salaryIncreaseRangePp, 0, eff.salaryIncreaseRangePp),
      onc: triangular(rng, -eff.onCostRangePp, 0, eff.onCostRangePp),
      ramp: triangular(rng, -w, 0, w),
      cap: triangular(rng, 1 - eff.capabilityRange, 1, 1 + eff.capabilityRange),
      man: triangular(rng, 1 - eff.manualLineRange, 1, 1 + eff.manualLineRange),
    };
    triangular(rng, 1 - FX_RANGE, 1, 1 + FX_RANGE); // FX: drawn to keep the stream stable, never applied (inert)
    out.push(f);
  }
  return out;
}

export function simulateInvestment(input: SimulationInput): SimulationResults {
  const err = validateEnvelope(input.envelopeKrwM);
  if (err) throw new Error(err);
  const draws = clampDraws(input.draws);
  const base = buildInvestmentVectors(input);
  const H = base.horizon;
  const eff = effectiveAssumptions(input.overrides);
  const modeCap = base.mode.capabilityByYear;
  const modeMan = base.mode.manualByYear;
  const staffing = input.staffing;
  const recruiting = staffing ? staffingSummaryVector(staffing, H).recruitingByYear : Array<number>(H).fill(0);
  const w = Math.min(Math.max(eff.rampShiftHalfYears, 0), 1);

  const vectorsFor = (f: Factors): { cap: number[]; man: number[]; staff: number[]; total: number[] } => {
    const cap = scaled(modeCap, f.cap);
    const man = scaled(modeMan, f.man);
    let staff = Array<number>(H).fill(0);
    if (staffing) {
      let annual = staffingAnnualVectorWithFactors(staffing, H, f.salary, f.inc, f.onc);
      if (f.ramp > 0) annual = shiftDelayHalf(annual, f.ramp);
      else if (f.ramp < 0) annual = shiftAdvanceHalf(annual, -f.ramp);
      staff = annual.map((v, i) => round2(v + recruiting[i]));
    }
    const total = cap.map((c, i) => round2(c + man[i] + staff[i]));
    return { cap, man, staff, total };
  };
  const sumOf = (v: number[]): number => v.reduce((a, n) => a + n, 0);

  const factors = drawInvestmentFactors(input.seed, draws, eff);
  const totals: number[] = [];
  const years = (): number[][] => Array.from({ length: H }, () => []);
  const yTotal = years(), yCap = years(), yMan = years(), yStaff = years();
  const cTotal: number[] = [], cCap: number[] = [], cMan: number[] = [], cStaff: number[] = [];
  for (let d = 0; d < draws; d++) {
    const f = factors[d];
    const v = vectorsFor(f);
    for (let i = 0; i < H; i++) { yTotal[i].push(v.total[i]); yCap[i].push(v.cap[i]); yMan[i].push(v.man[i]); yStaff[i].push(v.staff[i]); }
    const t = sumOf(v.total);
    totals.push(t); cCap.push(sumOf(v.cap)); cMan.push(sumOf(v.man)); cStaff.push(sumOf(v.staff));
  }

  const sortedTotals = [...totals].sort((a, b) => a - b);
  const min = sortedTotals[0];
  const max = sortedTotals[sortedTotals.length - 1];
  const span = max - min;
  const counts = Array<number>(HISTOGRAM_BINS).fill(0);
  for (const t of totals) counts[span > 0 ? Math.min(HISTOGRAM_BINS - 1, Math.floor(((t - min) / span) * HISTOGRAM_BINS)) : 0] += 1;
  const edges = Array.from({ length: HISTOGRAM_BINS + 1 }, (_, i) => round2(min + (span * i) / HISTOGRAM_BINS));

  // Analytic tornado: each variable at its min/max, every other variable at its mode.
  const modeTotal = sumOf(vectorsFor(NEUTRAL).total);
  const tornadoDefs: Array<{ key: TornadoKey; lo: Partial<Factors>; hi: Partial<Factors>; applicable: boolean }> = [
    { key: "salary", lo: { salary: 1 - eff.salaryRange }, hi: { salary: 1 + eff.salaryRange }, applicable: true },
    { key: "salaryIncrease", lo: { inc: -eff.salaryIncreaseRangePp }, hi: { inc: eff.salaryIncreaseRangePp }, applicable: true },
    { key: "onCost", lo: { onc: -eff.onCostRangePp }, hi: { onc: eff.onCostRangePp }, applicable: true },
    { key: "ramp", lo: { ramp: -w }, hi: { ramp: w }, applicable: true },
    { key: "capability", lo: { cap: 1 - eff.capabilityRange }, hi: { cap: 1 + eff.capabilityRange }, applicable: true },
    { key: "manualLines", lo: { man: 1 - eff.manualLineRange }, hi: { man: 1 + eff.manualLineRange }, applicable: true },
    { key: "fx", lo: {}, hi: {}, applicable: false },
  ];
  const raw = tornadoDefs.map((t) => {
    const a = t.applicable ? sumOf(vectorsFor({ ...NEUTRAL, ...t.lo }).total) : modeTotal;
    const b = t.applicable ? sumOf(vectorsFor({ ...NEUTRAL, ...t.hi }).total) : modeTotal;
    return { key: t.key, lowKrwM: round2(Math.min(a, b)), highKrwM: round2(Math.max(a, b)), swingKrwM: round2(Math.abs(a - b)) };
  });
  const swingSum = raw.reduce((a, r) => a + r.swingKrwM, 0);
  const order = raw.map((r) => r.key);
  const tornado: TornadoEntry[] = raw
    .map((r) => ({ ...r, share: swingSum > 0 ? round2(r.swingKrwM / swingSum) : 0, active: r.key !== "fx" && r.swingKrwM > 0 }))
    .sort((a, b) => b.swingKrwM - a.swingKrwM || order.indexOf(a.key) - order.indexOf(b.key));

  const env = input.envelopeKrwM ?? null;
  const exceedCount = env === null ? 0 : totals.filter((t) => t > env).length;

  return {
    horizon: H,
    draws,
    seed: input.seed >>> 0,
    mode: { grandKrwM: base.mode.grandKrwM, totalByYear: base.mode.totalByYear },
    total: { ...bandOf(totals), mean: round2(totals.reduce((a, n) => a + n, 0) / totals.length), min: round2(min), max: round2(max), histogram: { edges, counts } },
    totalByYear: yTotal.map(bandOf),
    byCategory: {
      capability: { total: bandOf(cCap), byYear: yCap.map(bandOf) },
      manual: { total: bandOf(cMan), byYear: yMan.map(bandOf) },
      staffing: { total: bandOf(cStaff), byYear: yStaff.map(bandOf) },
    },
    tornado,
    exceed: env === null ? null : { envelopeKrwM: env, probability: round4(exceedCount / draws), exceedCount },
    assumptions: {
      ...eff,
      fx: { range: FX_RANGE, active: false },
      distribution: "triangular",
      correlation: "common factor per group (all staffing rows, all capability lines, all manual lines)",
    },
  };
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000;
