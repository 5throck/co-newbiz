// ADR-0178 slice 0: pure side of the S5 plan pin (S5 single source, S8 pinned reference).
// A pin stores the S5 investment input exactly as loadInvestmentVectorsInput builds it (OPEN-1
// snapshot) plus a hash of it. S8 computes the Green Field investment plan from the SNAPSHOT, never
// from live S5; the live source is read only for the stale hash and for the next re-pin.
// The plan-line derivation below mirrors what promotion copies (writeS5CostModel: confirmed-unit
// KRW manual lines + reflected, priced capability lines) so a fresh pin and a fresh copy yield the
// same plan vectors - the parity test freezes that. Nothing here touches the database.
import { createHash } from "node:crypto";
import { manualLineInKrw, manualLineKrwM, manualLineNeedsConfirm, type CapabilityCostLine, type FxRates, type ManualCostLine } from "./capability-cost-lines.ts";
import { staffingSummaryVector, type StaffingPlanEntry } from "./staffing-plan.ts";
import { readFx } from "../../../db/repositories/entry-market.repository.ts";
import { investmentInputPayload } from "./investment-simulation.ts";
import type { InvestmentVectorsInput, VectorManualLine } from "./investment-vectors.ts";

/** Promotion stamps every capability-sourced line with this note flag (splitForPromotion). */
export const CAPABILITY_LINE_NOTE_MARK = "역량 해소 비용";

const VALID_CATEGORIES = new Set(["labor", "opex", "capex", "revenue", "gov_rnd"]);
const PERIOD_MULTIPLIER: Record<string, number> = { monthly: 12, quarterly: 4, yearly: 1, lumpsum: 1 };

/** One plan line in the shape of a copied business_case_line row (KRW_M, growth preserved from the S5 line). */
export interface PinPlanLine {
  category: string;
  annual_amount_krw_m: number;
  start_year: number;
  end_year: number | null;
  growth_rate: number;
  unit: "KRW_M";
  note: string | null;
}

export interface PinSnapshot {
  v: 1;
  manual: VectorManualLine[];
  capLines: CapabilityCostLine[];
  horizon: number;
  reflectedKeys: string[];
  staffing: StaffingPlanEntry | null;
  overrides: InvestmentVectorsInput["overrides"] | null;
}

/** The pinned input as JSON text (Set -> sorted array, so the text is deterministic). */
export function serializePinSnapshot(input: InvestmentVectorsInput): string {
  const snap: PinSnapshot = {
    v: 1,
    manual: [...input.manual],
    capLines: [...input.capLines],
    horizon: input.horizon,
    reflectedKeys: [...input.reflectedKeys].sort(),
    staffing: input.staffing,
    overrides: input.overrides ?? null,
  };
  return JSON.stringify(snap);
}

/** Inverse of serializePinSnapshot; null when the text is not a v1 snapshot. */
export function parsePinSnapshot(json: string | null | undefined): InvestmentVectorsInput | null {
  if (!json) return null;
  let s: Partial<PinSnapshot> | null = null;
  try { s = JSON.parse(json) as Partial<PinSnapshot>; } catch { return null; }
  if (!s || s.v !== 1 || !Array.isArray(s.manual) || !Array.isArray(s.capLines) || typeof s.horizon !== "number" || !Array.isArray(s.reflectedKeys)) return null;
  return {
    manual: s.manual,
    capLines: s.capLines,
    horizon: s.horizon,
    reflectedKeys: new Set(s.reflectedKeys),
    staffing: s.staffing ?? null,
    overrides: s.overrides ?? undefined,
  };
}

/**
 * Plan lines of a pinned input, in copy order (manual lines first, then capability lines) so the
 * per-year float sums add in the same order as the copied model's rows. The same filters as
 * planS5Import / splitForPromotion: manual lines need a confirmed unit, KRW currency, a name and a
 * known category; capability lines need a STORED reflected entry (persisted) with a positive cost.
 */
export function pinPlanLinesOf(input: InvestmentVectorsInput): { horizon: number; lines: PinPlanLine[] } {
  const lines: PinPlanLine[] = [];
  for (const raw of input.manual) {
    const m = raw as VectorManualLine & Partial<ManualCostLine>;
    if (manualLineNeedsConfirm(m as ManualCostLine)) continue;
    if (m.currency && m.currency !== "KRW") continue;
    if (!String(m.line ?? "").trim() || !VALID_CATEGORIES.has(String(m.category))) continue;
    const mult = PERIOD_MULTIPLIER[m.period ?? "yearly"] ?? 1;
    const annual = (manualLineKrwM(m) ?? 0) * mult;
    const start = m.startYear ?? 1;
    const end = m.period === "lumpsum" ? start : m.endYear ?? null;
    // Same validation as the copy path (writeS5CostModel.lineGrowthRate): the S5 line's own rate,
    // clamped to [0,1]; missing/invalid stays 0 so both paths stay in parity.
    const growth = typeof m.growthRate === "number" && Number.isFinite(m.growthRate) && m.growthRate > 0 ? Math.min(m.growthRate, 1) : 0;
    lines.push({ category: String(m.category), annual_amount_krw_m: annual, start_year: start, end_year: end, growth_rate: growth, unit: "KRW_M", note: null });
  }
  for (const c of input.capLines) {
    if (!(c.reflected && c.persisted) || !(c.costKrwM > 0)) continue;
    // 주기당 금액 semantics — parity with the copy path (splitForPromotion): a
    // recurring entry contributes 금액 × 주기계수 per WINDOW year. The old flat
    // write (cost at start year) under-read every 월간/연간-windowed pin.
    const recurring = c.period === "monthly" || c.period === "quarterly" || c.period === "yearly";
    const annual = recurring ? Math.round(c.costKrwM * (PERIOD_MULTIPLIER[c.period] ?? 1) * 100) / 100 : c.costKrwM;
    lines.push({ category: c.category, annual_amount_krw_m: annual, start_year: c.startYear, end_year: recurring ? c.endYear ?? c.startYear : c.startYear, growth_rate: 0, unit: "KRW_M", note: CAPABILITY_LINE_NOTE_MARK });
  }
  return { horizon: input.horizon, lines };
}

/** Row shape both paths aggregate: a copied business_case_line (copy path) or a derived pin line. */
export interface PlanLineRow {
  category: string;
  annual_amount_krw_m: number;
  start_year: number;
  end_year: number | null;
  growth_rate: number;
  unit: string | null;
  note?: string | null;
}

export interface AggregatedPlan {
  horizonYears: number;
  capexByYear: number[];
  /** Category split (2026-10-19 decider ask: `재무분석` 비용 = S5와 같은 구조) — labor and
   *  opex keep their own vectors; `laborOpexByYear` stays the merged one the sim/s5_pnl paths read. */
  laborByYear: number[];
  opexByYear: number[];
  laborOpexByYear: number[];
  govRndByYear: number[];
  opexCovered: boolean[];
  capexCapabilityByYear: number[];
  laborOpexCapabilityByYear: number[];
  /** Mode staffing labor (annual + recruiting) already inside `laborByYear`/`laborOpexByYear`.
   *  The S8 simulator replaces exactly this slice with its per-draw staffing recomputation,
   *  so the S5 salary/inc/on-cost/ramp draws apply to 인건비 (2026-10-19 decider direction). */
  staffingLaborByYear: number[];
  skippedLines: number;
  /**
   * ADR-0178 slice 1: 시작 전 (start_year 0) lines. They are EXCLUDED from the Y1..YN vectors above
   * (never moved into year 1, never dropped silently): their sum and count are reported here and
   * surfaced in the run note until the `s5_pnl` basis (slice 2) consumes them as year 0.
   * Present only when at least one such line exists.
   */
  preLaunchKrwM?: number;
  preLaunchLines?: number;
}

/**
 * Per-year capex / labor+opex / gov_rnd vectors from plan lines. THE single aggregation used by the
 * copy path (resolveS5InvestmentPlan, rows of the copied greenfield_cost model) and the pinned path
 * (rows derived from the snapshot), so the two cannot diverge. Moved verbatim from the generator:
 * the copy path stays bit-identical.
 */
export function aggregatePlanLines(horizonRaw: number, lines: ReadonlyArray<PlanLineRow>, fxRates?: FxRates): AggregatedPlan {
  const horizon = Math.min(Math.max(Math.round(horizonRaw), 1), 50);
  const capexByYear = new Array<number>(horizon).fill(0);
  const laborByYear = new Array<number>(horizon).fill(0);
  const opexByYear = new Array<number>(horizon).fill(0);
  const laborOpexByYear = new Array<number>(horizon).fill(0);
  const govRndByYear = new Array<number>(horizon).fill(0);
  const opexCovered = new Array<boolean>(horizon).fill(false);
  const capexCapabilityByYear = new Array<number>(horizon).fill(0);
  const laborOpexCapabilityByYear = new Array<number>(horizon).fill(0);
  const staffingLaborByYear = new Array<number>(horizon).fill(0);
  let skippedLines = 0;
  let preLaunchKrwM = 0;
  let preLaunchLines = 0;
  for (const rawLine of lines) {
    // ADR-0181 seam — foreign lines convert at the person-set rate; KRW lines pass through.
    const l = manualLineInKrw(rawLine as unknown as { amount?: unknown; amountUnit?: unknown; currency?: unknown }, fxRates) as unknown as PlanLineRow;
    if (l.unit === "KRW_M" && l.start_year === 0) {
      preLaunchKrwM += l.annual_amount_krw_m;
      preLaunchLines += 1;
      continue;
    }
    // R (section 5): a NULL/non-KRW_M unit is never assumed convertible - the line
    // is skipped and counted, matching S10's `case_unit_not_comparable` stance.
    if (l.unit !== "KRW_M" || l.start_year > horizon) {
      skippedLines += 1;
      continue;
    }
    const end = Math.min(l.end_year ?? horizon, horizon);
    const isCapex = l.category === "capex";
    const isGovRnd = l.category === "gov_rnd";
    const isLabor = l.category === "labor";
    const fromCapability = (l.note ?? "").includes(CAPABILITY_LINE_NOTE_MARK);
    const amounts = isCapex ? capexByYear : isGovRnd ? govRndByYear : laborOpexByYear;
    // Category split (2026-10-19 decider ask: `재무분석` 비용 = S5와 같은 구조) — labor and
    // opex keep their own vectors alongside the merged one the sim/s5_pnl paths read.
    const categoryAmounts = isLabor ? laborByYear : isGovRnd || isCapex ? null : opexByYear;
    for (let y = Math.max(1, l.start_year); y <= end; y++) {
      // 기준 금액 — the line's growth_rate does NOT compound here. The S5 투자비 탭 has no
      // growth input (the value rides in from legacy/AI lines invisible to the person), and
      // the decider set the consistency rule: S8 aggregation reads what the S5 table shows.
      // Escalation, if wanted, becomes a visible S5 field first (future slice).
      const amount = l.annual_amount_krw_m;
      amounts[y - 1] += amount;
      if (categoryAmounts) categoryAmounts[y - 1] += amount;
      if (fromCapability && isCapex) capexCapabilityByYear[y - 1] += amount;
      else if (fromCapability && !isGovRnd) laborOpexCapabilityByYear[y - 1] += amount;
      if (!isCapex && !isGovRnd) opexCovered[y - 1] = true;
    }
  }
  return { horizonYears: horizon, capexByYear, laborByYear, opexByYear, laborOpexByYear, govRndByYear, opexCovered, capexCapabilityByYear, laborOpexCapabilityByYear, staffingLaborByYear, skippedLines, ...(preLaunchLines > 0 ? { preLaunchKrwM, preLaunchLines } : {}) };
}

/**
 * 2026-10-19 decider report (`인건비와 설비투자가 제대로 반영되지 않고 있어`) — the staffing
 * plan's labor vector joins the s5 plan's opex side in BOTH read paths, so the S8 `s5_plan`
 * totals equal the S5 `투자비` summary (which has always counted labor). The staffing rows
 * cannot be plan lines (per-year headcount is not expressible as amount × growth), so this is
 * a vector append after aggregation. Years with any staffing cost count as opex-covered.
 * Mutates and returns `agg`. The plan_hash is unaffected: it hashes the snapshot input
 * (staffing included) directly, not the aggregated vectors.
 */
export function applyStaffingLaborToPlan(agg: AggregatedPlan, staffing: StaffingPlanEntry | null | undefined): AggregatedPlan {
  if (!staffing) return agg;
  const vec = staffingSummaryVector(staffing, agg.horizonYears);
  for (let i = 0; i < agg.horizonYears; i++) {
    const v = (vec.annualByYear[i] ?? 0) + (vec.recruitingByYear[i] ?? 0);
    if (v > 0) {
      agg.staffingLaborByYear[i] += v;
      agg.laborByYear[i] += v;
      agg.laborOpexByYear[i] += v;
      agg.opexCovered[i] = true;
    }
  }
  return agg;
}

/**
 * plan_hash (ADR-0178 section 4A.3): the shared S5 simulation input payload (horizon, mode
 * capability/manual vectors, staffing plan, effective ranges - exactly what simulationInputHash
 * hashes, minus seed/draws) PLUS the derived plan-line structure, so a category or timing change
 * that the summed vectors would hide (capex moved to opex) still changes the hash.
 */
export function s5PlanHashOf(input: InvestmentVectorsInput): string {
  const payload = { ...investmentInputPayload(input), l: pinPlanLinesOf(input).lines };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** `s5_pin=<id>` fragment of a valuation_simulation note, or null (copy-path / legacy notes). */
export function s5PinFragmentOfNote(note: string | null | undefined): string | null {
  const m = (note ?? "").match(/(?:^|;\s*)s5_pin=([^;\s]+)/);
  return m ? m[1] : null;
}
