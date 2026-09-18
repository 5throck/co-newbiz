// business-case-generator — S8 automatic multi-business-case generation
// (ADR-0098 §2). For each FS scenario (base / upside / downside) a sequential
// generation chain — NOT a debate — reuses the ADR-0096 engine
// (runActivityChain) to instantiate the procedure contract of
// procedures/_shared/greenfield-fs/schema.yaml steps 1/3/4/5 (and the same
// step-5 contract in brownfield-fs):
//
//   1. financial-analyst   growth_projection        (step 1 — anchored growth)
//   2. valuation-agent     valuation_model          (step 3 — NPV/IRR model)
//   3. quant-methodologist distributional_valuation (step 4 — seeded MC percentiles)
//                          scenario_risk_assessment (step 5 — downside/base/upside)
//
// Execution follows the Phase 2 pluggability pattern (lib/committee-agents.ts):
// the default executor is DETERMINISTIC — a seeded, dependency-free
// re-implementation of scripts/co-newbiz/simulate.ts's SimulationResult
// contract (p05/p50/p95/mean/std) so the three persisted cases carry genuinely
// different numbers per scenario (base ±20% growth/dispersion deltas), not
// copies. The CO_NEWBIZ_BUSINESS_CASE_AGENTS=llm seam (setExecutorFactory)
// is the insertion point for a future LLM-backed implementation; nothing else
// here changes.
//
// Boundary #2 (design, non-negotiable): this engine writes PROPOSALS only.
// It flags a RECOMMENDED case (which scenario best survives the risk tests)
// but NEVER writes an adoption marker or a gate_decision — the adopt endpoint
// (human click) and the fs gate record are the only confirmations, and
// tests/unit/business-case.test.ts proves generation alone produces neither.

import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { resolveProjectWacc, type WaccResolution } from "../../../db/lib/wacc.ts";
import { getCompanyFinancialFacts, factRowsToDartItems } from "./dart-financial-facts.ts";
import { deriveFinancialAnalysis } from "./company-financials.ts";
import { historicalGrowthStats } from "./financial-commentary.ts";
import { runActivityChain, type ActivitySpec, type EntityRef, type CallAgent } from "./agent-orchestrator.ts";
import { specAgentFor } from "./spec-activities.ts";
import { runSimJob } from "./sim-engine.ts";

// Per-step S8 agent assignment reads from process/flow.spec.yaml (SSOT,
// ADR-0074) — each execution step maps to the spec activity that owns its
// procedure contract; the agent comes from the spec, so a spec reassignment
// flows through without code change.
export const STEP_TO_SPEC_ACTIVITY: Record<BusinessCaseStep, string> = {
  growth_projection: "business-case-modeling",
  valuation_model: "valuation",
  distributional_valuation: "quant-methods",
  scenario_risk_assessment: "quant-methods",
};

export function businessCaseAgentFor(step: BusinessCaseStep): string {
  return specAgentFor("S8", STEP_TO_SPEC_ACTIVITY[step]);
}

export const SCENARIOS = ["base", "upside", "downside"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const SCENARIO_LABEL: Record<Scenario, string> = {
  base: "기본(Base)",
  upside: "상승(Upside)",
  downside: "하락(Downside)",
};

// ── Dual-perspective growth model (ADR-0117) ────────────────────────────────
// Every scenario case is computed in TWO variants from the same seeded engine:
//   market_forward (1차) — 시장 성장률 + 미래 변동성 프로파일. Gate, kill
//     criteria, and the RECOMMENDED flag judge THIS variant only.
//   historical (비교) — 대상 회사 과거 CAGR + 과거 매출 변동성 ("과거가
//     지속된다면" evidence). Generated only when company facts exist; the
//     page shows N/A otherwise — missing data is never fabricated.

export type CaseVariant = "market_forward" | "historical";

export interface GrowthModelVariant {
  /** Annual growth rate (ratio) — the simulation anchor. */
  growth: number;
  /** Annual growth dispersion (ratio) — replaces the legacy hardcoded 2%. */
  disp: number;
  growthSource: string;
  dispSource: string;
}

export interface GrowthModel {
  market: GrowthModelVariant;
  /** null = 대상 회사 데이터 부족 — historical 변형은 생성하지 않는다 (N/A). */
  historical: GrowthModelVariant | null;
}

/** Dispersion guardrails — the legacy hardcoded sigma was 2%; extreme input
 *  volatility must not blow the distribution up, so everything clamps. */
export const DISP_FLOOR = 0.02;
export const DISP_CAP = 0.25;

const clampDisp = (v: number | null): number | null =>
  v === null || !Number.isFinite(v) ? null : Math.min(DISP_CAP, Math.max(DISP_FLOOR, v));
const pct1 = (v: number): string => `${(v * 100).toFixed(1)}%`;

/** Resolve both variants' growth/dispersion parameters for a project.
 *  market.growth: S2 opportunity fact (fallback 5% — pre-Phase-2 behavior
 *  preserved as the last resort, explicitly labeled). market.disp: blend of
 *  historical revenue volatility and the WACC session's wacc.beta_vol_asset
 *  when both exist, else whichever exists, else the 2% floor. historical.*:
 *  DART revenue CAGR + YoY stdev; null when the series is too short. */
export function resolveGrowthModel(db: ReturnType<typeof getDb>, projectId: string): GrowthModel {
  const opp = db
    .query(
      "SELECT o.growth_rate FROM md_project p LEFT JOIN opportunity o ON o.id = p.source_opportunity_id WHERE p.id = ?",
    )
    .get(projectId) as { growth_rate: number | null } | undefined;
  const marketGrowth = opp?.growth_rate ?? 0.05;
  const marketGrowthSource = opp?.growth_rate != null ? "시장 성장률 (opportunity)" : "기본값 5% (기회 미입력)";

  let histCagr: number | null = null;
  let histVol: number | null = null;
  let histYears = 0;
  const p = db.query("SELECT company_id FROM md_project WHERE id = ?").get(projectId) as { company_id: string | null } | undefined;
  if (p?.company_id) {
    try {
      const facts = getCompanyFinancialFacts(db, p.company_id);
      const analysis = deriveFinancialAnalysis({
        corpCode: facts.company.dart_corp_code ?? "",
        found: facts.rows.length > 0,
        items: factRowsToDartItems(facts.rows),
        yearly: [],
      } as Parameters<typeof deriveFinancialAnalysis>[0]);
      const stats = historicalGrowthStats(analysis);
      histCagr = stats.cagr;
      histVol = stats.revenueVol;
      histYears = analysis.years.length;
    } catch {
      // 회사 미연결 또는 fact 부재 — historical는 N/A (임의치 대체 금지).
    }
  }

  const betaVolRow = db
    .query("SELECT value FROM assumption WHERE assumption_key = 'wacc.beta_vol_asset' ORDER BY as_of DESC LIMIT 1")
    .get() as { value: number } | undefined;
  const betaVol = betaVolRow && Number.isFinite(betaVolRow.value) && betaVolRow.value > 0 ? betaVolRow.value : null;
  const clampedHist = clampDisp(histVol);

  let marketDisp: number;
  let marketDispSource: string;
  if (clampedHist !== null && betaVol !== null) {
    marketDisp = clampDisp((clampedHist + betaVol) / 2)!;
    marketDispSource = `블렌딩 (과거 ${pct1(clampedHist)} + 자산변동성 ${pct1(betaVol)})`;
  } else if (clampedHist !== null) {
    marketDisp = clampedHist;
    marketDispSource = "과거 매출 변동성 (DART)";
  } else if (betaVol !== null) {
    marketDisp = clampDisp(betaVol)!;
    marketDispSource = "WACC 자산 변동성";
  } else {
    marketDisp = DISP_FLOOR;
    marketDispSource = "기본 2% (변동성 원천 없음)";
  }

  return {
    market: { growth: marketGrowth, disp: marketDisp, growthSource: marketGrowthSource, dispSource: marketDispSource },
    historical:
      histCagr === null
        ? null
        : {
            growth: histCagr,
            disp: clampedHist ?? DISP_FLOOR,
            growthSource: `과거 ${histYears}년 매출 CAGR (DART)`,
            dispSource: histVol !== null ? "과거 매출 증감률 표준편차 (DART)" : "과거 변동성 부족 — 하한 적용",
          },
  };
}

/** Horizon / discounting constants — deterministic defaults, documented in every persisted note. */
const HORIZON_YEARS = 5;
const MC_ITERATIONS = 2000;
/** Capture rate of the anchored market size, year-1 revenue (deterministic default assumption). */
const CAPTURE_RATE = 0.005;
/** Cost structure: variable opex ratio and year-1 capex as a share of year-1 revenue. */
const OPEX_RATIO = 0.6;
const CAPEX_RATIO = 0.1;
/** ADR-0106 — year-0 초기투자(시설·설립 셋업)를 year-1 매출 대비 비율로 모델링.
 *  초기투자가 없으면 모든 플로우가 양수라 IRR이 정의되지 않는다(null/0%). */
const INITIAL_INVESTMENT_RATIO = 0.5;
/** Scenario deltas — upside/downside are base ±20% on growth AND dispersion (ADR-0098). */
const SCENARIO_DELTA: Record<Scenario, { growth: number; disp: number }> = {
  base: { growth: 1.0, disp: 1.0 },
  upside: { growth: 1.2, disp: 1.2 },
  downside: { growth: 0.8, disp: 0.8 },
};

function nowIso(): string {
  return new Date().toISOString();
}

// ── Seeded deterministic simulation (simulate.ts equivalent, no subprocess) ─

/** FNV-1a — the seed is a pure function of (projectId, scenario): reproducible per ADR-0052 §D.4. */
export function scenarioSeed(projectId: string, scenario: string): number {
  const key = `${projectId}:${scenario}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, deterministic PRNG (no dependency, no Date/random). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalPair(rng: () => number): [number, number] {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const r = Math.sqrt(-2 * Math.log(u1));
  return [r * Math.cos(2 * Math.PI * u2), r * Math.sin(2 * Math.PI * u2)];
}

export interface SimulationResult {
  seed: number;
  iterations: number;
  p05: number;
  p50: number;
  p95: number;
  mean: number;
  std: number;
  /** Deterministic-path discounted payback = BEP year (design REQ-W3-1); null when the horizon ends first. */
  bepYear: number | null;
  /** Unit-economics break-even volume; null when the case has no price/volume split. */
  bepVolume: number | null;
}

/** IRR of a cashflow vector by bisection on NPV(rate); null when no sign change. */
export function irr(cashflows: number[]): number | null {
  // flows[0]은 year-0(현재 시점) — 미할인, 이후 연도만 할인한다.
  const npv = (rate: number) => cashflows.reduce((acc, cf, i) => acc + cf / Math.pow(1 + rate, i), 0);
  let lo = -0.9;
  let hi = 10;
  let fLo = npv(lo);
  let fHi = npv(hi);
  if (fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-9) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

/** Fractional year when cumulative discounted FCF first reaches zero — the
 *  TS port of sim_engine.metrics.discounted_payback_year (identical math so
 *  the fallback path and the engine agree). */
export function discountedPaybackYear(initialInvestment: number, flows: number[], rate: number): number | null {
  let cumulative = -initialInvestment;
  if (cumulative >= 0) return 0;
  let previous = cumulative;
  for (let year = 1; year <= flows.length; year++) {
    cumulative += flows[year - 1] / Math.pow(1 + rate, year);
    if (cumulative >= 0) {
      const span = cumulative - previous;
      const fraction = span > 0 ? -previous / span : 0;
      return year - 1 + Math.min(Math.max(fraction, 0), 1);
    }
    previous = cumulative;
  }
  return null;
}

/**
 * Seeded Monte Carlo over the value drivers, mirroring python/monte_carlo.py's
 * SimulationResult contract (scripts/co-newbiz/simulate.ts). The driver is
 * annual revenue growth ~ Normal(anchorGrowth*deltaGrowth, 0.02*deltaDisp);
 * each draw builds a full 5-year FCF path (revenue → EBITDA-less opex → capex)
 * and discounts at the project WACC resolved from the user assumption session
 * (falling back to 10% only with explicit default provenance). Pure function
 * of (inputs, scenario): same seed in, same percentiles out — any persisted
 * figure is reproducible.
 */
export function runSeededSimulation(inputs: CaseInputs, scenario: Scenario, variant: CaseVariant = "market_forward"): SimulationResult {
  const seed = scenarioSeed(inputs.projectId, scenario);
  const rng = mulberry32(seed);
  const delta = SCENARIO_DELTA[scenario];
  const eff = effGrowthDisp(inputs, scenario, variant);
  const anchorGrowth = eff.growth;
  const disp = eff.disp;
  const year1Revenue = inputs.marketSizeKrwM * captureRateOf(inputs) * delta.growth;

  const npvs: number[] = [];
  const initialInvestment = year1Revenue * INITIAL_INVESTMENT_RATIO;
  const ramp = rampUpOf(inputs);
  for (let it = 0; it < MC_ITERATIONS; it++) {
    let revenue = year1Revenue;
    let npv = -initialInvestment; // year-0 설립 투자
    for (let year = 1; year <= HORIZON_YEARS; year++) {
      if (year > 1) {
        const [z1] = normalPair(rng);
        revenue *= 1 + anchorGrowth + disp * z1;
      }
      const fcf = revenue * (1 - OPEX_RATIO) - revenue * CAPEX_RATIO;
      const utilization = ramp[year - 1] ?? ramp[ramp.length - 1] ?? 1;
      npv += (fcf * utilization) / Math.pow(1 + inputs.wacc.value, year);
    }
    npvs.push(npv);
  }
  npvs.sort((a, b) => a - b);
  const mean = npvs.reduce((a, b) => a + b, 0) / npvs.length;
  const variance = npvs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / npvs.length;
  const q = (p: number) => npvs[Math.min(npvs.length - 1, Math.max(0, Math.floor(p * npvs.length)))];
  // Deterministic path — same BEP/payback definition as the engine.
  const detFlows: number[] = [-year1Revenue * INITIAL_INVESTMENT_RATIO];
  let detRevenue = year1Revenue;
  for (let year = 1; year <= HORIZON_YEARS; year++) {
    if (year > 1) detRevenue *= 1 + anchorGrowth;
    const utilization = ramp[year - 1] ?? ramp[ramp.length - 1] ?? 1;
    detFlows.push(detRevenue * (1 - OPEX_RATIO - CAPEX_RATIO) * utilization);
  }
  return { seed, iterations: MC_ITERATIONS, p05: q(0.05), p50: q(0.5), p95: q(0.95), mean, std: Math.sqrt(variance), bepYear: discountedPaybackYear(year1Revenue * INITIAL_INVESTMENT_RATIO, detFlows.slice(1), inputs.wacc.value), bepVolume: null };
}

// ── Case inputs (anchored to the promoting opportunity's market facts) ─────

export interface CaseInputs {
  projectId: string;
  marketSizeKrwM: number;
  anchorGrowth: number;
  wacc: WaccResolution;
  /** Dual-perspective parameters (ADR-0117). Optional so legacy callers
   *  constructing CaseInputs by hand keep working — without it both variants
   *  fall back to the legacy anchor + 2% dispersion. */
  growthModel?: GrowthModel;
  /** Sales-plan parameters (design REQ-W1-2/3): capture rate and the
   *  utilization ramp-up curve, resolvable as bc.* user assumptions with
   *  provenance labels. Optional so hand-built contexts fall back to the
   *  deterministic defaults. */
  bcParams?: BusinessCaseParams;
}

/** Default sales-plan curve (design REQ-W1-2) — utilization by year. */
export const DEFAULT_RAMP_UP = [0.4, 0.7, 0.9, 1.0, 1.0];

export interface BusinessCaseParams {
  captureRate: number;
  captureSource: string;
  rampUp: number[];
  rampSource: string;
}

/** Resolve bc.* user assumptions (design REQ-W6-1 vocabulary) — capture rate
 *  and the ramp-up curve, each with a provenance label. Defaults are the
 *  documented deterministic values; user rows win by recency. Ramp-up years
 *  live under `bc.ramp_up.y1..yN` (the assumption table stores scalars, so
 *  the curve is one key per year). */
export function resolveBusinessCaseParams(db: { query: (sql: string) => { get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[] } }, projectId: string): BusinessCaseParams {
  const capture = db.query(
    `SELECT a.value FROM assumption a JOIN run r ON r.id = a.run_id
     WHERE r.project_id = ? AND a.assumption_key = 'bc.capture_rate' AND a.kind = 'user'
     ORDER BY a.as_of DESC, r.created_at DESC, a.id DESC LIMIT 1`,
  ).get(projectId) as { value: number } | undefined;
  const rampRows = db.query(
    `SELECT a.assumption_key, a.value FROM assumption a JOIN run r ON r.id = a.run_id
     WHERE r.project_id = ? AND a.assumption_key LIKE 'bc.ramp_up.y%' AND a.kind = 'user'
     ORDER BY a.as_of DESC, r.created_at DESC, a.id DESC`,
  ).all(projectId) as Array<{ assumption_key: string; value: number }>;
  const rampByYear = new Map<number, number>();
  for (const row of rampRows) {
    const year = Number.parseInt(row.assumption_key.slice("bc.ramp_up.y".length), 10);
    if (Number.isFinite(year) && year >= 1 && !rampByYear.has(year) && Number.isFinite(row.value) && row.value >= 0) {
      rampByYear.set(year, row.value); // first hit per year = most recent
    }
  }
  const rampUp = DEFAULT_RAMP_UP.map((fallback, i) => rampByYear.get(i + 1) ?? fallback);
  return {
    captureRate: capture && Number.isFinite(capture.value) && capture.value > 0 ? capture.value : CAPTURE_RATE,
    captureSource: capture && Number.isFinite(capture.value) && capture.value > 0 ? "사용자 확정 (bc.capture_rate)" : "기본값",
    rampUp,
    rampSource: rampByYear.size > 0 ? "사용자 확정 (bc.ramp_up.y*)" : "기본값",
  };
}

/** Deterministic defaults for hand-built contexts without bcParams. */
function resolveBusinessCaseParamsDefaults(): BusinessCaseParams {
  return { captureRate: CAPTURE_RATE, captureSource: "기본값", rampUp: DEFAULT_RAMP_UP, rampSource: "기본값" };
}

/** Effective capture rate — hand-built contexts without bcParams keep the
 *  legacy constant (REQ-W1-3's default). */
function captureRateOf(inputs: CaseInputs): number {
  return inputs.bcParams?.captureRate ?? CAPTURE_RATE;
}

function rampUpOf(inputs: CaseInputs): number[] {
  return inputs.bcParams?.rampUp ?? DEFAULT_RAMP_UP;
}

/** Effective per-(scenario, variant) growth/dispersion. Legacy inputs (no
 *  growthModel) reproduce the pre-ADR-0117 numbers exactly. */
export function effGrowthDisp(
  inputs: CaseInputs,
  scenario: Scenario,
  variant: CaseVariant = "market_forward",
): { growth: number; disp: number; growthSource: string; dispSource: string } {
  const delta = SCENARIO_DELTA[scenario];
  const gm = inputs.growthModel;
  if (gm) {
    const v = variant === "historical" ? (gm.historical ?? gm.market) : gm.market;
    return { growth: v.growth * delta.growth, disp: v.disp * delta.disp, growthSource: v.growthSource, dispSource: v.dispSource };
  }
  return { growth: inputs.anchorGrowth * delta.growth, disp: 0.02 * delta.disp, growthSource: "기본값", dispSource: "고정 2%" };
}

export function caseInputsForProject(projectId: string): CaseInputs {
  const row = getDb()
    .query(
      `SELECT o.market_size_krw_m, o.growth_rate
       FROM md_project p LEFT JOIN opportunity o ON o.id = p.source_opportunity_id
       WHERE p.id = ?`,
    )
    .get(projectId) as { market_size_krw_m: number | null; growth_rate: number | null } | undefined;
  // Deterministic fallbacks when the promoting opportunity carries no market
  // facts (brownfield promotion path): documented, never random. growth_rate
  // is stored as a RATIO (evidence_var unit 'ratio', migration 0017; seeds
  // store 0.06) and is used as-is — no percent conversion.
  return {
    projectId,
    marketSizeKrwM: row?.market_size_krw_m ?? 50000,
    anchorGrowth: row?.growth_rate ?? 0.05,
    wacc: resolveProjectWacc(getDb(), projectId),
    growthModel: resolveGrowthModel(getDb(), projectId),
    bcParams: resolveBusinessCaseParams(getDb(), projectId),
  };
}

function deterministicCashflows(inputs: CaseInputs, scenario: Scenario, variant: CaseVariant = "market_forward"): number[] {
  const delta = SCENARIO_DELTA[scenario];
  const eff = effGrowthDisp(inputs, scenario, variant);
  let revenue = inputs.marketSizeKrwM * captureRateOf(inputs) * delta.growth;
  const initialInvestment = revenue * INITIAL_INVESTMENT_RATIO;
  const ramp = rampUpOf(inputs);
  const flows: number[] = [-initialInvestment]; // year-0 설립 투자
  for (let year = 1; year <= HORIZON_YEARS; year++) {
    if (year > 1) revenue *= 1 + eff.growth;
    const utilization = ramp[year - 1] ?? ramp[ramp.length - 1] ?? 1;
    flows.push(revenue * (1 - OPEX_RATIO - CAPEX_RATIO) * utilization);
  }
  return flows;
}

// ── Standalone engine bridge (spec 2026-09-18-s8-business-case-evaluation §1) ─

export interface SimEngineMeta {
  engine: string;
  device: string;
  precision: string;
}

export interface EngineRunResult {
  result: SimulationResult;
  meta: SimEngineMeta;
  bepYear: number | null;
  bepVolume: number | null;
  paybackYears: number | null;
}

/**
 * Translate the S8 legacy model into a generic engine job-spec (design §1.4:
 * the generator is demoted to a job-spec builder). Same constants, same
 * semantics — year-1 anchor, growth noise on years 2..H, FCF = revenue ×
 * (1 − opex − capex), year-0 initial investment (ADR-0106).
 */
export function buildS8JobSpec(inputs: CaseInputs, scenario: Scenario, variant: CaseVariant = "market_forward"): Record<string, unknown> {
  const delta = SCENARIO_DELTA[scenario];
  const eff = effGrowthDisp(inputs, scenario, variant);
  const bc = inputs.bcParams ?? resolveBusinessCaseParamsDefaults();
  const year1Revenue = inputs.marketSizeKrwM * bc.captureRate * delta.growth;
  return {
    job_id: `s8:${inputs.projectId}:${scenario}:${variant}`,
    seed_policy: { base: inputs.projectId, hash: "fnv1a" },
    device: "auto",
    iterations: MC_ITERATIONS,
    horizon_years: HORIZON_YEARS,
    discount_rate: { value: inputs.wacc.value, subject: "promoter", source: inputs.wacc.source },
    cases: [
      {
        case_id: `${scenario}:${variant}`,
        drivers: {
          revenue_y1: { dist: "constant", value: year1Revenue, unit: "KRW_M", source: `시장규모 × 포획률 ${(bc.captureRate * 100).toFixed(1)}% (${bc.captureSource})` },
          ramp_up: { dist: "constant", value: bc.rampUp, source: bc.rampSource },
          revenue_growth: { dist: "normal", mean: eff.growth, sigma: eff.disp, unit: "ratio", source: eff.growthSource },
          opex_ratio: { dist: "constant", value: OPEX_RATIO, unit: "ratio", source: "기본값" },
          capex_ratio: { dist: "constant", value: CAPEX_RATIO, unit: "ratio", source: "기본값" },
          initial_investment: { dist: "constant", value: year1Revenue * INITIAL_INVESTMENT_RATIO, unit: "KRW_M", source: "ADR-0106" },
        },
      },
    ],
  };
}

/** One engine attempt for an S8 case; null on any failure — the caller falls
 *  back to the legacy in-process simulator and the fallback is stamped in the
 *  note so every persisted figure names its origin (REQ-W5-1 transition). */
async function runEngineSimulation(jobSpec: Record<string, unknown>, inputs: CaseInputs, scenario: Scenario, variant: CaseVariant): Promise<EngineRunResult | null> {
  const job = await runSimJob(jobSpec);
  const first = job?.cases[0];
  if (!job || !first || !Number.isFinite(first.npv?.p50)) return null;
  return {
    result: {
      seed: first.seed,
      iterations: first.iterations,
      p05: first.npv.p05,
      p50: first.npv.p50,
      p95: first.npv.p95,
      mean: first.npv.mean,
      std: first.npv.std,
      bepYear: first.bep_year,
      bepVolume: first.bep_volume,
    },
    meta: { engine: `python-sim-engine@${job.version}`, device: `${first.device.device}/${first.device.backend}`, precision: first.device.precision },
    bepYear: first.bep_year,
    bepVolume: first.bep_volume,
    paybackYears: first.payback_discounted_years,
  };
}

// ── Executor seam (Phase 2 pattern, lib/committee-agents.ts) ────────────────

export interface StepContext {
  scenario: Scenario;
  /** Which valuation perspective this chain runs (ADR-0117) — default keeps
   *  hand-built contexts on the gate-primary variant. */
  variant?: CaseVariant;
  inputs: CaseInputs;
  /** Set once the valuation_model step has persisted the model for this scenario. */
  modelId?: string;
  /** Set by distributional_valuation; scenario_risk_assessment reuses it so
   *  the engine (or fallback) simulates once per (scenario, variant), not
   *  twice. */
  sim?: { result: SimulationResult; engine: SimEngineMeta; bepYear: number | null };
}

const VARIANT_LABEL: Record<CaseVariant, string> = { market_forward: "시장 기반", historical: "과거 기반" };

/**
 * A step executor produces the activity artifact. The default (deterministic)
 * implementation persists business_case_model / business_case_line /
 * valuation_simulation rows and returns a role-templated markdown summary;
 * an LLM-backed factory would call its model and return richer prose — the
 * persistence contract stays here in the chain activities.
 */
export type BusinessCaseStep = "growth_projection" | "valuation_model" | "distributional_valuation" | "scenario_risk_assessment";
export type BusinessCaseStepExecutor = (step: BusinessCaseStep, ctx: StepContext) => Promise<string>;

type ExecutorFactory = () => BusinessCaseStepExecutor;

let executorFactory: ExecutorFactory | null = null;

/**
 * The seam: a future LLM-backed implementation registers a factory here at
 * server bootstrap. Active only when CO_NEWBIZ_BUSINESS_CASE_AGENTS=llm —
 * the default and any fallback is the local deterministic executor.
 */
export function setBusinessCaseExecutorFactory(next: ExecutorFactory | null): void {
  executorFactory = next;
}

/** Deterministic default — role-templated output, seeded computation, real rows.
 *  Exported for the LLM executor, which delegates persistence here and enriches
 *  only the returned prose. */
export function defaultExecutor(): BusinessCaseStepExecutor {
  return async (step, ctx) => {
    const db = getDb();
    const delta = SCENARIO_DELTA[ctx.scenario];
    const variant: CaseVariant = ctx.variant ?? "market_forward";
    const eff = effGrowthDisp(ctx.inputs, ctx.scenario, variant);
    const provenance = `variant=${variant}; growth_source=${eff.growthSource}; sigma=${eff.disp.toFixed(4)}; sigma_source=${eff.dispSource}`;
    if (step === "growth_projection") {
      return [
        `### [재무 분석] financial-analyst — 성장 전망 (${SCENARIO_LABEL[ctx.scenario]} · ${VARIANT_LABEL[variant]})`,
        "",
        `성장 근거: ${eff.growthSource} ${(eff.growth * 100).toFixed(2)}%/년 (시나리오 계수 ×${delta.growth}),`,
        `변동성 근거: ${eff.dispSource} (sigma ${pct1(eff.disp)} ×${delta.disp}).`,
        `1차년도 매출은 시장 점유율 ${captureRateOf(ctx.inputs) * 100}% 가정으로 ${(ctx.inputs.marketSizeKrwM * captureRateOf(ctx.inputs) * delta.growth).toFixed(1)} 억원 (가동률 ${rampUpOf(ctx.inputs).map((v) => v.toFixed(1)).join(" → ")}).`,
        `베이스레이트 점검: 산업 성장률 대비 ±20% 밴드 내 (greenfield-fs step 1).`,
      ].join("\n");
    }
    if (step === "valuation_model") {
      const modelId = ulid();
      const flows = deterministicCashflows(ctx.inputs, ctx.scenario, variant);
      const npv = flows.reduce((acc, cf, i) => acc + cf / Math.pow(1 + ctx.inputs.wacc.value, i), 0); // flows[0]=year-0
      db.run(
        `INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, variant) VALUES (?,?,?,?,?,?,?,?)`,
        [modelId, ctx.inputs.projectId, "valuation", `S8 자동 생성 — ${ctx.scenario} — ${VARIANT_LABEL[variant]}`, HORIZON_YEARS, "business-case-generator", nowIso(), variant],
      );
      const year1Revenue = ctx.inputs.marketSizeKrwM * captureRateOf(ctx.inputs) * delta.growth;
      const lines: Array<[string, "revenue" | "opex" | "capex", string, number]> = [
        ["revenue", "revenue", "시나리오 매출 (year-1 앵커)", year1Revenue],
        ["opex", "opex", "운영비 (매출의 60%)", year1Revenue * OPEX_RATIO],
        ["capex", "capex", "설비 투자 (year-1, 매출의 10%)", year1Revenue * CAPEX_RATIO],
      ];
      for (const [category, _kind, name, amount] of lines) {
        db.run(
          `INSERT INTO business_case_line (id, model_id, category, name, annual_amount_krw_m, start_year, growth_rate, note, created_by, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [ulid(), modelId, category, name, amount, 1, eff.growth,
            `scenario=${ctx.scenario}; delta=${delta.growth}; ${provenance}`, "business-case-generator", nowIso()],
        );
      }
      ctx.modelId = modelId;
      return [
        `### [밸류에이션] valuation-agent — 밸류에이션 모델 (${SCENARIO_LABEL[ctx.scenario]} · ${VARIANT_LABEL[variant]})`,
        "",
        `확정 WACC ${(ctx.inputs.wacc.value * 100).toFixed(1)}%·회수기간 ${HORIZON_YEARS}년 기준 NPV ${npv.toFixed(1)} 억원,`,
        `성장 ${(eff.growth * 100).toFixed(2)}% (${eff.growthSource}) · sigma ${pct1(eff.disp)} (${eff.dispSource}).`,
        `WACC 출처: ${ctx.inputs.wacc.source}${ctx.inputs.wacc.run_id ? ` (run ${ctx.inputs.wacc.run_id})` : ""}.`,
        `IRR ${((irr(flows) ?? 0) * 100).toFixed(1)}% (greenfield-fs step 3). 모델/라인 3건 영속화 (model ${modelId}).`,
      ].join("\n");
    }
    if (step === "distributional_valuation") {
      const modelId = ctx.modelId;
      if (!modelId) throw new Error("distributional_valuation requires valuation_model to have persisted the model");
      // Standalone engine first (design §1); the legacy in-process simulator
      // remains the fallback and the note names which engine produced the
      // distribution, on which device (REQ-W5-1 transition contract). The
      // job-spec is built once and stored on the model — the snapshot IS the
      // execution contract (REQ-W5-1).
      const jobSpec = buildS8JobSpec(ctx.inputs, ctx.scenario, variant);
      const engineRun = await runEngineSimulation(jobSpec, ctx.inputs, ctx.scenario, variant);
      const sim: SimulationResult = engineRun?.result ?? runSeededSimulation(ctx.inputs, ctx.scenario, variant);
      const engineMeta: SimEngineMeta = engineRun?.meta ?? { engine: "inline-ts", device: "cpu", precision: "float64" };
      ctx.sim = { result: sim, engine: engineMeta, bepYear: sim.bepYear };
      const flows = deterministicCashflows(ctx.inputs, ctx.scenario, variant);
      const bc = ctx.inputs.bcParams ?? resolveBusinessCaseParamsDefaults();
      const bepFragment = sim.bepYear != null ? `; bep_year=${sim.bepYear.toFixed(2)}` : "";
      const note = `seed=${sim.seed}; iterations=${sim.iterations}; scenario=${ctx.scenario}; growth=${eff.growth.toFixed(4)}; wacc=${ctx.inputs.wacc.value}; wacc_source=${ctx.inputs.wacc.source}${ctx.inputs.wacc.run_id ? `; wacc_run=${ctx.inputs.wacc.run_id}` : ""}; capture_rate=${bc.captureRate}; capture_source=${bc.captureSource}; ramp_source=${bc.rampSource}; ${provenance}; engine=${engineMeta.engine}; device=${engineMeta.device}; precision=${engineMeta.precision}${bepFragment}`;
      db.run(`UPDATE business_case_model SET inputs_json = ? WHERE id = ?`, [JSON.stringify(jobSpec), modelId]);
      for (const pct of ["p05", "p50", "p95"] as const) {
        const isP50 = pct === "p50";
        db.run(
          `INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, note, created_at, bep_year, bep_volume, payback_discounted_years)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [ulid(), ctx.inputs.projectId, modelId, ctx.scenario, pct, sim[pct], isP50 ? irr(flows) : null, note, nowIso(), isP50 ? sim.bepYear : null, isP50 ? sim.bepVolume : null, isP50 ? sim.bepYear : null],
        );
      }
      return [
        `### [정량 방법론] quant-methodologist — 분포 밸류에이션 (${SCENARIO_LABEL[ctx.scenario]} · ${VARIANT_LABEL[variant]})`,
        "",
        `시드 ${sim.seed}·${sim.iterations}회 몬테카를로 (ADR-0052 §D.4, 결정론적 재현 가능; 엔진 ${engineMeta.engine} · ${engineMeta.device}):`,
        `성장 ${(eff.growth * 100).toFixed(2)}% (${eff.growthSource}) · sigma ${pct1(eff.disp)} (${eff.dispSource}).`,
        `NPV p05 ${sim.p05.toFixed(1)} / p50 ${sim.p50.toFixed(1)} / p95 ${sim.p95.toFixed(1)} 억원,`,
        `분산(표준편차) ${sim.std.toFixed(1)} — 지점 추정+서술 각주 금지, 분위수 영속화 완료 (valuation_simulation 3행).`,
      ].join("\n");
    }
    // scenario_risk_assessment (step 5) — covenant-style downside review for
    // this scenario. The CROSS-scenario comparison + RECOMMENDED flag is
    // recorded once after the chain (see generateBusinessCases). Reuses the
    // distributional_valuation result — the simulation runs once per case.
    return [
      `### [정량 방법론] quant-methodologist — 시나리오 리스크 평가 (${SCENARIO_LABEL[ctx.scenario]} · ${VARIANT_LABEL[variant]})`,
      "",
      `하락 스트레스: p05 NPV ${(ctx.sim?.result ?? runSeededSimulation(ctx.inputs, ctx.scenario, variant)).p05.toFixed(1)} 억원 기준,`,
      ctx.scenario === "downside"
        ? "금리 충격 시 계약(커버넌트) 테스트 관점에서 p05가 0 이하로 내려가는 구간에 대한 완충 확인 필요."
        : "금리 충격 시 계약(커버넌트) 테스트 통과 여향 — 하락 시나리오의 p05 대비 완충 명시 권장.",
    ].join("\n");
  };
}

/** Active executor per the env seam; deterministic unless explicitly LLM-backed. */
export function getBusinessCaseExecutor(): BusinessCaseStepExecutor {
  const mode = process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS ?? "deterministic";
  if (mode === "llm" && executorFactory !== null) return executorFactory();
  return defaultExecutor();
}

// ── The chain (one process_run, 9 activities — 3 scenarios × 4 steps) ───────

export interface GenerationResult {
  processRunId: string;
  status: "running" | "done" | "failed";
  /** The quant-methodologist's RECOMMENDED scenario, when all 3 cases completed. */
  recommendedScenario: Scenario | null;
}

/**
 * Generate the three scenario business cases under ONE process_run
 * (entity = project, ADR-0096). Activities run sequentially — base, upside,
 * downside — each writing its activity_run/agent_run rows as it completes so
 * the GET status route can show per-activity progress. Synchronous by design
 * (bun's sync SQLite layer); the { runId } response contract is unchanged.
 *
 * Writes NO adoption marker and NO gate_decision — boundary #2.
 */
export async function generateBusinessCases(
  projectId: string,
  opts: { actor: string; source?: string; callAgent?: CallAgent },
): Promise<GenerationResult> {
  const inputs = caseInputsForProject(projectId);
  const entity: EntityRef = { entityType: "project", entityId: projectId };
  const executor = getBusinessCaseExecutor();

  // ADR-0117: each scenario runs in TWO variants — market_forward (gate
  // primary) and, when the bound company's DART series supports it,
  // historical (comparison evidence). Missing historical data is not an
  // error: the variant is skipped and the page shows N/A instead.
  const variants: CaseVariant[] = inputs.growthModel?.historical ? ["market_forward", "historical"] : ["market_forward"];
  const activities: ActivitySpec[] = [];
  for (const scenario of SCENARIOS) {
    for (const variant of variants) {
      const ctx: StepContext = { scenario, variant, inputs };
      for (const step of ["growth_projection", "valuation_model", "distributional_valuation", "scenario_risk_assessment"] as BusinessCaseStep[]) {
        const agentKey = businessCaseAgentFor(step);
        activities.push({
          activityId: `${scenario}:${variant}:${step}`,
          agentKey,
          prompt: `${step} — ${scenario} scenario (${variant}) for project ${projectId}`,
          execute: async () => executor(step, ctx),
        });
      }
    }
  }

  const result = await runActivityChain(entity, activities, {
    actor: opts.actor,
    source: opts.source ?? "web",
    stage: "s8_business_case_generation",
  });

  // quant-methodologist's cross-case comparison: flag the RECOMMENDED case —
  // the scenario that best survives the risk tests (highest p05 NPV that is
  // positive; among negatives, the least-negative p05). Recorded on the run's
  // meta_json ONLY — never as an adoption marker, never as a gate decision.
  let recommendedScenario: Scenario | null = null;
  if (result.status === "done") {
    recommendedScenario = recommendedFromDb(projectId);
    if (recommendedScenario) {
      getDb().run("UPDATE process_run SET meta_json = ? WHERE id = ?", [
        JSON.stringify({ recommended_scenario: recommendedScenario }),
        result.processRunId,
      ]);
    }
  }
  return { processRunId: result.processRunId, status: result.status, recommendedScenario };
}

/** The recommendation rule, pure over persisted rows — the page and the engine share it. */
export function recommendedFromDb(projectId: string): Scenario | null {
  // ADR-0117: the RECOMMENDED flag judges the market_forward variant only —
  // the historical variant is comparison evidence, never a gate candidate.
  const rows = getDb()
    .query(
      `SELECT v.scenario, v.npv_krw_m FROM valuation_simulation v
       JOIN business_case_model m ON m.id = v.model_id
       WHERE v.project_id = ? AND v.percentile = 'p05'
         AND COALESCE(m.variant, 'market_forward') = 'market_forward'`,
    )
    .all(projectId) as Array<{ scenario: string; npv_krw_m: number }>;
  if (rows.length === 0) return null;
  const byScenario = new Map(rows.map((r) => [r.scenario, r.npv_krw_m]));
  const candidates = SCENARIOS.filter((s) => byScenario.has(s));
  if (candidates.length === 0) return null;
  const positive = candidates.filter((s) => (byScenario.get(s) ?? 0) > 0);
  const pool = positive.length > 0 ? positive : candidates;
  return pool.reduce((best, s) => ((byScenario.get(s) ?? 0) > (byScenario.get(best) ?? 0) ? s : best), pool[0]);
}
