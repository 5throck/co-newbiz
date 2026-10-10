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

import { resolveEffectiveCagr } from "./market-calibration.ts";
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { resolveProjectWacc, resolveProjectWaccSubject, type WaccResolution, type WaccSubjectResolution } from "../../../db/lib/wacc.ts";
import { getCompanyFinancialFacts, factRowsToDartItems } from "./dart-financial-facts.ts";
import { deriveFinancialAnalysis } from "./company-financials.ts";
import { historicalGrowthStats } from "./financial-commentary.ts";
import { runActivityChain, type ActivitySpec, type CallAgent } from "./agent-orchestrator.ts";
import { specAgentFor } from "./spec-activities.ts";
import { runSimJob } from "./sim-engine.ts";
import { resolveDownsideOpexUplift } from "./target-costing.ts";

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
export function resolveGrowthModel(db: ReturnType<typeof getDb>, projectId: string, opts?: { companyId?: string | null }): GrowthModel {
  const opp = db
    .query(
      "SELECT o.growth_rate, o.market_scope FROM md_project p LEFT JOIN opportunity o ON o.id = p.source_opportunity_id WHERE p.id = ?",
    )
    .get(projectId) as { growth_rate: number | null; market_scope: string | null } | undefined;
  let marketGrowth = opp?.growth_rate ?? 0.05;
  let marketGrowthSource = opp?.growth_rate != null ? "시장 성장률 (opportunity)" : "기본값 5% (기회 미입력)";
  // 에스컬레이션 조정 CAGR — 사람이 기록한 결정이 기회 성장률보다 우선한다
  // (design 2026-09-20-escalation-downstream §3.2-1). 출처는 note 스탬프로 남긴다.
  const industryRow = opp?.market_scope
    ? (db.query("SELECT id FROM md_industry WHERE name_ko = ?").get(opp.market_scope) as { id: string } | undefined)
    : undefined;
  const effCagr = industryRow ? resolveEffectiveCagr(db, industryRow.id) : null;
  if (effCagr?.source === "escalated") {
    marketGrowth = effCagr.cagrPct / 100;
    marketGrowthSource = `에스컬레이션 조정 CAGR ${effCagr.cagrPct.toFixed(1)}% (외부 참조 × 0.85 — 바텀업 ${effCagr.baseCagrPct?.toFixed(1)}% 대체)`;
  }

  let histCagr: number | null = null;
  let histVol: number | null = null;
  let histYears = 0;
  // ADR-0143: opts.companyId가 주어지면(대상별 분석) 그 회사의 series로,
  // null이면 historical를 만들지 않는다. 미지정이면 기존대로
  // md_project.company_id (greenfield/project-level 호환).
  const p = opts
    ? opts.companyId
      ? { company_id: opts.companyId }
      : undefined
    : (db.query("SELECT company_id FROM md_project WHERE id = ?").get(projectId) as { company_id: string | null } | undefined);
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

/** FNV-1a — the seed is a pure function of (projectId, scenario) for
 *  project-level cases and (projectId, targetId, scenario) for brownfield
 *  per-target cases (ADR-0143): reproducible per ADR-0052 §D.4. */
export function scenarioSeed(projectId: string, scenario: string, targetId?: string | null): number {
  const key = targetId ? `${projectId}:${targetId}:${scenario}` : `${projectId}:${scenario}`;
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
  const seed = scenarioSeed(inputs.projectId, scenario, inputs.targetId);
  const rng = mulberry32(seed);
  const delta = SCENARIO_DELTA[scenario];
  const eff = effGrowthDisp(inputs, scenario, variant);
  const anchorGrowth = eff.growth;
  const disp = eff.disp;
  const year1Revenue = inputs.marketSizeKrwM * captureRateOf(inputs) * delta.growth;
  const horizon = horizonOf(inputs);
  const opexRatio = opexRatioOf(inputs, scenario);
  const capexRatio = capexRatioOf(inputs);

  const npvs: number[] = [];
  const initialInvestment = year1Revenue * initialInvestmentRatioOf(inputs);
  const ramp = rampUpOf(inputs);
  for (let it = 0; it < iterationsOf(inputs); it++) {
    let revenue = year1Revenue;
    let npv = -initialInvestment; // year-0 설립 투자
    for (let year = 1; year <= horizon; year++) {
      if (year > 1) {
        const [z1] = normalPair(rng);
        revenue *= 1 + anchorGrowth + disp * z1;
      }
      const fcf = revenue * (1 - opexRatio) - revenue * capexRatio;
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
  const initialInvestmentRatio = initialInvestmentRatioOf(inputs);
  const detFlows: number[] = [-year1Revenue * initialInvestmentRatio];
  let detRevenue = year1Revenue;
  for (let year = 1; year <= horizon; year++) {
    if (year > 1) detRevenue *= 1 + anchorGrowth;
    const utilization = ramp[year - 1] ?? ramp[ramp.length - 1] ?? 1;
    detFlows.push(detRevenue * (1 - opexRatio - capexRatio) * utilization);
  }
  return { seed, iterations: iterationsOf(inputs), p05: q(0.05), p50: q(0.5), p95: q(0.95), mean, std: Math.sqrt(variance), bepYear: discountedPaybackYear(year1Revenue * initialInvestmentRatio, detFlows.slice(1), inputs.wacc.value), bepVolume: null };
}

// ── Case inputs (anchored to the promoting opportunity's market facts) ─────

/** ADR-0156 소비 스코프 — 'project'(게이트 기준 수치) 또는 'target'(그 대상
 *  회사의 자체 WACC 세션; companyId는 job-spec 스냅샷 식별용). */
export type CaseWaccScope = { scope: "project" } | { scope: "target"; companyId: string };

export interface CaseInputs {
  projectId: string;
  /** ADR-0143 target axis — set for brownfield per-target cases (the shortlist
   *  subject this instance analyzes). Greenfield/project-level cases stay
   *  NULL, which also keeps legacy seeds byte-identical. */
  targetId?: string | null;
  marketSizeKrwM: number;
  anchorGrowth: number;
  wacc: WaccResolution;
  /** ADR-0156 소비 스코프 — 'project'(게이트 기준) 또는 'target'(그 대상
   *  회사의 자체 WACC 세션). 없으면 프로젝트로 해석한다(수제 컨텍스트
   *  하위호환). note·job-spec 근거 라벨의 원천. */
  waccScope?: CaseWaccScope;
  /** Dual-perspective parameters (ADR-0117). Optional so legacy callers
   *  constructing CaseInputs by hand keep working — without it both variants
   *  fall back to the legacy anchor + 2% dispersion. */
  growthModel?: GrowthModel;
  /** Sales-plan parameters (design REQ-W1-2/3): capture rate and the
   *  utilization ramp-up curve, resolvable as bc.* user assumptions with
   *  provenance labels. Optional so hand-built contexts fall back to the
   *  deterministic defaults. */
  bcParams?: BusinessCaseParams;
  /** WACC application subject (REQ-W4-1/2) — whose cost of capital discounts
   *  the cash flows. Optional for hand-built contexts: defaults to promoter. */
  waccSubject?: WaccSubjectResolution;
  /** Target-costing downside wiring (REQ-W2-3) — present only when the
   *  latest target_costing_analysis breaches the +10% gap threshold. */
  targetCostWiring?: { uplift: number; gapRatio: number };
}

/** Default sales-plan curve (design REQ-W1-2) — utilization by year. */
export const DEFAULT_RAMP_UP = [0.4, 0.7, 0.9, 1.0, 1.0];

export interface BusinessCaseParams {
  captureRate: number;
  captureSource: string;
  rampUp: number[];
  rampSource: string;
  opexRatio: number;
  opexSource: string;
  capexRatio: number;
  capexSource: string;
  initialInvestmentRatio: number;
  initialInvestmentSource: string;
  growthOverride: number | null;
  growthOverrideSource: string;
  sigmaOverride: number | null;
  sigmaOverrideSource: string;
  horizonYears: number;
  horizonSource: string;
  iterations: number;
  iterationsSource: string;
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
  const scalar = (key: string): number | null => {
    const row = db.query(
      `SELECT a.value FROM assumption a JOIN run r ON r.id = a.run_id
       WHERE r.project_id = ? AND a.assumption_key = ? AND a.kind = 'user'
       ORDER BY a.as_of DESC, r.created_at DESC, a.id DESC LIMIT 1`,
    ).get(projectId, key) as { value: number } | undefined;
    return row && Number.isFinite(row.value) ? row.value : null;
  };
  const ratio = (key: string, fallback: number): { value: number; source: string } => {
    const v = scalar(key);
    return v !== null && v >= 0 ? { value: v, source: `사용자 확정 (${key})` } : { value: fallback, source: "기본값" };
  };
  const opex = ratio("bc.opex_ratio", OPEX_RATIO);
  const capex = ratio("bc.capex_ratio", CAPEX_RATIO);
  const initInv = ratio("bc.initial_investment_ratio", INITIAL_INVESTMENT_RATIO);
  const growthOv = scalar("bc.growth_override");
  const sigmaOv = scalar("bc.sigma_override");
  const horizon = ratio("bc.horizon_years", HORIZON_YEARS);
  const iterations = ratio("bc.iterations", MC_ITERATIONS);
  return {
    captureRate: capture && Number.isFinite(capture.value) && capture.value > 0 ? capture.value : CAPTURE_RATE,
    captureSource: capture && Number.isFinite(capture.value) && capture.value > 0 ? "사용자 확정 (bc.capture_rate)" : "기본값",
    rampUp,
    rampSource: rampByYear.size > 0 ? "사용자 확정 (bc.ramp_up.y*)" : "기본값",
    opexRatio: opex.value,
    opexSource: opex.source,
    capexRatio: capex.value,
    capexSource: capex.source,
    initialInvestmentRatio: initInv.value,
    initialInvestmentSource: initInv.source,
    growthOverride: growthOv,
    growthOverrideSource: growthOv !== null ? "사용자 오버라이드 (bc.growth_override)" : "기본값",
    // a stored negative is discarded (falls back to the derived model) —
    // a negative sigma would mirror the noise distribution.
    sigmaOverride: sigmaOv !== null && sigmaOv >= 0 ? sigmaOv : null,
    sigmaOverrideSource: sigmaOv !== null ? "사용자 오버라이드 (bc.sigma_override)" : "기본값",
    horizonYears: Math.min(Math.max(Math.round(horizon.value), 1), 50),
    horizonSource: horizon.source,
    iterations: Math.min(Math.max(Math.round(iterations.value), 1), 10_000_000),
    iterationsSource: iterations.source,
  };
}

/** Persist a batch of bc.* user assumptions on a fresh run (REQ-W6-3) — the
 *  write side of the resolution chain. Only provided keys are written; every
 *  write carries the session rationale so the assumption CHECK holds. */
export async function recordBusinessCaseParams(
  db: { run: (sql: string, ...args: unknown[]) => void },
  opts: {
    projectId: string;
    params: {
      capture_rate?: number;
      ramp_up?: number[];
      opex_ratio?: number;
      capex_ratio?: number;
      initial_investment_ratio?: number;
      growth_override?: number;
      sigma_override?: number;
      horizon_years?: number;
      iterations?: number;
    };
    rationale: string;
    actor: string;
    now?: string;
  },
): Promise<{ written: string[]; run_id: string }> {
  const { createRun } = await import("../../../db/lib/versioning.ts");
  const { recordAssumption } = await import("../../../db/lib/assumption.ts");
  const now = opts.now ?? new Date().toISOString();
  const run = createRun(db as never, { projectId: opts.projectId, label: "Business case parameter session", createdBy: opts.actor, overrides: {}, now });
  const written: string[] = [];
  const put = (key: string, value: number) => {
    recordAssumption(db as never, { runId: run.run_id, assumptionKey: key, kind: "user", value, asOf: now.slice(0, 10), rationale: opts.rationale, actor: opts.actor, now });
    written.push(key);
  };
  const p = opts.params;
  if (p.capture_rate !== undefined) put("bc.capture_rate", p.capture_rate);
  if (p.ramp_up !== undefined) {
    if (!Array.isArray(p.ramp_up) || p.ramp_up.length === 0 || !p.ramp_up.every((v) => Number.isFinite(v) && v >= 0)) {
      throw new Error("ramp_up must be a non-empty array of non-negative numbers");
    }
    p.ramp_up.forEach((v, i) => put(`bc.ramp_up.y${i + 1}`, v));
  }
  for (const [key, value] of [
    ["bc.opex_ratio", p.opex_ratio],
    ["bc.capex_ratio", p.capex_ratio],
    ["bc.initial_investment_ratio", p.initial_investment_ratio],
    ["bc.growth_override", p.growth_override],
    ["bc.sigma_override", p.sigma_override],
    ["bc.horizon_years", p.horizon_years],
    ["bc.iterations", p.iterations],
  ] as const) {
    if (value !== undefined) {
      if (!Number.isFinite(value) || value < 0) throw new Error(`${key} must be a non-negative finite number`);
      put(key, value);
    }
  }
  if (written.length === 0) throw new Error("no parameters provided");
  return { written, run_id: run.run_id };
}

/** Deterministic defaults for hand-built contexts without bcParams. */
function resolveBusinessCaseParamsDefaults(): BusinessCaseParams {
  return {
    captureRate: CAPTURE_RATE,
    captureSource: "기본값",
    rampUp: DEFAULT_RAMP_UP,
    rampSource: "기본값",
    opexRatio: OPEX_RATIO,
    opexSource: "기본값",
    capexRatio: CAPEX_RATIO,
    capexSource: "기본값",
    initialInvestmentRatio: INITIAL_INVESTMENT_RATIO,
    initialInvestmentSource: "기본값",
    growthOverride: null,
    growthOverrideSource: "기본값",
    sigmaOverride: null,
    sigmaOverrideSource: "기본값",
    horizonYears: HORIZON_YEARS,
    horizonSource: "기본값",
    iterations: MC_ITERATIONS,
    iterationsSource: "기본값",
  };
}

/** Effective accessors — hand-built contexts without bcParams keep the
 *  legacy constants (REQ-W6-1's resolution tail: default). */
function captureRateOf(inputs: CaseInputs): number {
  return inputs.bcParams?.captureRate ?? CAPTURE_RATE;
}

function rampUpOf(inputs: CaseInputs): number[] {
  return inputs.bcParams?.rampUp ?? DEFAULT_RAMP_UP;
}

function opexRatioOf(inputs: CaseInputs, scenario?: Scenario): number {
  const base = inputs.bcParams?.opexRatio ?? OPEX_RATIO;
  // REQ-W2-3: a beyond-threshold target-cost gap feeds the downside opex driver.
  if (scenario === "downside" && inputs.targetCostWiring) return base * inputs.targetCostWiring.uplift;
  return base;
}

function capexRatioOf(inputs: CaseInputs): number {
  return inputs.bcParams?.capexRatio ?? CAPEX_RATIO;
}

function initialInvestmentRatioOf(inputs: CaseInputs): number {
  return inputs.bcParams?.initialInvestmentRatio ?? INITIAL_INVESTMENT_RATIO;
}

function horizonOf(inputs: CaseInputs): number {
  return inputs.bcParams?.horizonYears ?? HORIZON_YEARS;
}

function iterationsOf(inputs: CaseInputs): number {
  // The inline fallback runs on the Next.js event loop — clamp harder than
  // the engine-spec ceiling (out-of-process Python can afford 10M; the
  // request thread cannot). The persisted job-spec keeps the spec value.
  const fallbackClamp = 200_000;
  return Math.min(inputs.bcParams?.iterations ?? MC_ITERATIONS, fallbackClamp);
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
  const base = gm
    ? (variant === "historical" ? (gm.historical ?? gm.market) : gm.market)
    : { growth: inputs.anchorGrowth, disp: 0.02, growthSource: "기본값", dispSource: "고정 2%" };
  // REQ-W6-2 resolution tail: a user override (bc.growth_override /
  // bc.sigma_override) beats the derived model; the scenario delta still
  // applies on top so scenario semantics survive an override.
  const growthOv = inputs.bcParams?.growthOverride ?? null;
  const sigmaOv = inputs.bcParams?.sigmaOverride ?? null;
  return {
    growth: (growthOv ?? base.growth) * delta.growth,
    disp: (sigmaOv ?? base.disp) * delta.disp,
    growthSource: growthOv !== null ? inputs.bcParams?.growthOverrideSource ?? "사용자 오버라이드" : base.growthSource,
    dispSource: sigmaOv !== null ? inputs.bcParams?.sigmaOverrideSource ?? "사용자 오버라이드" : base.dispSource,
  };
}

/** Project-level input base shared by caseInputsForProject and
 *  caseInputsForTarget — everything EXCEPT growthModel, so a brownfield
 *  multi-target run (D3) resolves the project base once per project run
 *  instead of once per subject. */
export function caseInputsBaseForProject(projectId: string): Omit<CaseInputs, "growthModel" | "targetId"> {
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
    waccScope: { scope: "project" },
    bcParams: resolveBusinessCaseParams(getDb(), projectId),
    waccSubject: resolveProjectWaccSubject(getDb(), projectId),
    targetCostWiring: resolveDownsideOpexUplift(getDb(), projectId) ?? undefined,
  };
}

export function caseInputsForProject(projectId: string): CaseInputs {
  return {
    ...caseInputsBaseForProject(projectId),
    growthModel: resolveGrowthModel(getDb(), projectId),
  };
}

/** Brownfield per-target inputs (ADR-0143): the market anchor stays the
 *  promoting opportunity's facts; the historical variant resolves from the
 *  TARGET's company series, not md_project.company_id. Missing company facts
 *  degrade to historical N/A per target — never fabricated. Pass a
 *  pre-resolved project base to avoid re-running the project-level queries
 *  for every subject in a multi-target run (D3). */
/** ADR-0156 소비 규칙: 바운드 대상(md_project.company_id)은 게이트 기준인
 *  프로젝트 스코프를 그대로 쓴다(WACC 페이지의 '게이트 기준' 칩과 동일
 *  규칙). 그 외 대상은 자기 회사 스코프의 세션이 있을 때만 그 세션으로
 *  바꾼다 — 세션이 없거나(source 'default') 회사를 특정할 수 없는 대상은
 *  프로젝트 스코프로 폴백한다. 자동 생성이 수동 WACC 확정 여부에 블록되지
 *  않게 하기 위함이고, 어떤 스코프를 썼는지는 wacc_scope 라벨로 남는다. */
function resolveTargetCaseWacc(
  projectId: string,
  target: { companyId: string | null },
  projectWacc: WaccResolution,
): { wacc: WaccResolution; waccScope: CaseWaccScope } {
  if (!target.companyId) return { wacc: projectWacc, waccScope: { scope: "project" } };
  const bound = getDb()
    .query("SELECT company_id FROM md_project WHERE id = ?")
    .get(projectId) as { company_id: string | null } | undefined;
  if (!bound || bound.company_id === target.companyId) return { wacc: projectWacc, waccScope: { scope: "project" } };
  const scoped = resolveProjectWacc(getDb(), projectId, { subjectCompanyId: target.companyId });
  if (scoped.source === "default") return { wacc: projectWacc, waccScope: { scope: "project" } };
  return { wacc: scoped, waccScope: { scope: "target", companyId: target.companyId } };
}

export function caseInputsForTarget(
  projectId: string,
  target: { id: string; companyId: string | null },
  base: Omit<CaseInputs, "growthModel" | "targetId"> = caseInputsBaseForProject(projectId),
): CaseInputs {
  const { wacc, waccScope } = resolveTargetCaseWacc(projectId, target, base.wacc);
  return {
    ...base,
    wacc,
    waccScope,
    targetId: target.id,
    growthModel: resolveGrowthModel(getDb(), projectId, { companyId: target.companyId }),
  };
}

/** Shortlist subjects of a brownfield project's source opportunity — one
 *  analysis instance each (flow.spec S8 subjectScope: shortlist). Company
 *  resolution mirrors listTargets (dart_corp_code first, name_ko fallback). */
export function listShortlistSubjects(db: ReturnType<typeof getDb>, opportunityId: string): Array<{ id: string; name: string; companyId: string | null }> {
  const rows = db
    .query(
      `SELECT bt.id, bt.company_name, bt.dart_corp_code,
         (SELECT mc.id FROM md_company mc WHERE bt.dart_corp_code IS NOT NULL AND mc.dart_corp_code = bt.dart_corp_code LIMIT 1) AS company_id
       FROM brownfield_target bt
       WHERE bt.opportunity_id = ? AND bt.status = 'shortlisted'
       ORDER BY bt.rank IS NULL, bt.rank, bt.created_at`,
    )
    .all(opportunityId) as Array<{ id: string; company_name: string; dart_corp_code: string | null; company_id: string | null }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.company_name,
    companyId: row.company_id
      ?? (row.company_name
        ? ((db.query("SELECT id FROM md_company WHERE name_ko = ?").get(row.company_name) as { id: string } | undefined)?.id ?? null)
        : null),
  }));
}

function deterministicCashflows(inputs: CaseInputs, scenario: Scenario, variant: CaseVariant = "market_forward"): number[] {
  const delta = SCENARIO_DELTA[scenario];
  const eff = effGrowthDisp(inputs, scenario, variant);
  let revenue = inputs.marketSizeKrwM * captureRateOf(inputs) * delta.growth;
  const initialInvestment = revenue * initialInvestmentRatioOf(inputs);
  const ramp = rampUpOf(inputs);
  const flows: number[] = [-initialInvestment]; // year-0 설립 투자
  for (let year = 1; year <= horizonOf(inputs); year++) {
    if (year > 1) revenue *= 1 + eff.growth;
    const utilization = ramp[year - 1] ?? ramp[ramp.length - 1] ?? 1;
    flows.push(revenue * (1 - opexRatioOf(inputs, scenario) - capexRatioOf(inputs)) * utilization);
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
  const opexRatio = opexRatioOf(inputs, scenario);
  const year1Revenue = inputs.marketSizeKrwM * bc.captureRate * delta.growth;
  // ADR-0143: brownfield per-target cases carry the target in the subject
  // key (job_id + seed_policy base, the persisted snapshot contract) AND in
  // the engine case_id — the engine derives its seed from case_id + drivers,
  // so without the subject in the case_id two targets with identical market
  // drivers would draw the IDENTICAL sample stream.
  const subjectKey = inputs.targetId ? `${inputs.projectId}:${inputs.targetId}` : inputs.projectId;
  // ADR-0156 소비 스코프를 스냅샷에 싣는다 — target이면 어떤 회사의 세션으로
  // 할인했는지 subject_company_id까지 식별 가능(REQ-W5-1 재현 계약).
  const waccScope = inputs.waccScope ?? { scope: "project" as const };
  return {
    job_id: `s8:${subjectKey}:${scenario}:${variant}`,
    seed_policy: { base: subjectKey, hash: "fnv1a" },
    device: "auto",
    iterations: bc.iterations,
    horizon_years: bc.horizonYears,
    discount_rate: {
      value: inputs.wacc.value,
      subject: inputs.waccSubject?.subject ?? "promoter",
      source: inputs.wacc.source,
      scope: waccScope.scope,
      ...("companyId" in waccScope ? { subject_company_id: waccScope.companyId } : {}),
    },
    cases: [
      {
        case_id: `${inputs.targetId ? `${inputs.targetId}:` : ""}${scenario}:${variant}`,
        drivers: {
          revenue_y1: { dist: "constant", value: year1Revenue, unit: "KRW_M", source: `시장규모 × 포획률 ${(bc.captureRate * 100).toFixed(1)}% (${bc.captureSource})` },
          ramp_up: { dist: "constant", value: bc.rampUp, source: bc.rampSource },
          revenue_growth: { dist: "normal", mean: eff.growth, sigma: eff.disp, unit: "ratio", source: eff.growthSource },
          opex_ratio: {
            dist: "constant",
            value: opexRatio,
            unit: "ratio",
            source: inputs.targetCostWiring && scenario === "downside"
              ? `${bc.opexSource} × 타겟코스팅 격차 반영 (+${Math.round((inputs.targetCostWiring.uplift - 1) * 100)}%, REQ-W2-3)`
              : bc.opexSource,
          },
          capex_ratio: { dist: "constant", value: bc.capexRatio, unit: "ratio", source: bc.capexSource },
          initial_investment: { dist: "constant", value: year1Revenue * bc.initialInvestmentRatio, unit: "KRW_M", source: `ADR-0106 (${bc.initialInvestmentSource})` },
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
  /** ADR-0143 — the brownfield analysis subject (shortlist target) this
   *  instance belongs to. Absent for greenfield/project-level cases. */
  target?: { id: string; name: string };
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
      const subjectLabel = ctx.target ? `${ctx.target.name} — ` : "";
      db.run(
        `INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, variant, target_id) VALUES (?,?,?,?,?,?,?,?,?)`,
        [modelId, ctx.inputs.projectId, "valuation", `S8 자동 생성 — ${subjectLabel}${ctx.scenario} — ${VARIANT_LABEL[variant]}`, horizonOf(ctx.inputs), "business-case-generator", nowIso(), variant, ctx.target?.id ?? null],
      );
      const year1Revenue = ctx.inputs.marketSizeKrwM * captureRateOf(ctx.inputs) * delta.growth;
      const lines: Array<[string, "revenue" | "opex" | "capex", string, number]> = [
        ["revenue", "revenue", "시나리오 매출 (year-1 앵커)", year1Revenue],
        ["opex", "opex", `운영비 (매출의 ${Math.round(opexRatioOf(ctx.inputs) * 100)}%)`, year1Revenue * opexRatioOf(ctx.inputs)],
        ["capex", "capex", `설비 투자 (year-1, 매출의 ${Math.round(capexRatioOf(ctx.inputs) * 100)}%)`, year1Revenue * capexRatioOf(ctx.inputs)],
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
        `확정 WACC ${(ctx.inputs.wacc.value * 100).toFixed(1)}%·회수기간 ${horizonOf(ctx.inputs)}년 기준 NPV ${npv.toFixed(1)} 억원,`,
        `성장 ${(eff.growth * 100).toFixed(2)}% (${eff.growthSource}) · sigma ${pct1(eff.disp)} (${eff.dispSource}).`,
        `WACC 출처: ${ctx.inputs.wacc.source}${ctx.inputs.waccScope?.scope === "target" ? " · 대상별 세션" : ""}${ctx.inputs.wacc.run_id ? ` (run ${ctx.inputs.wacc.run_id})` : ""}.`,
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
      const waccSubject = ctx.inputs.waccSubject?.subject ?? "promoter";
      const tcFragment = ctx.inputs.targetCostWiring
        ? `; tc_gap_ratio=${ctx.inputs.targetCostWiring.gapRatio.toFixed(4)}; tc_downside_opex_uplift=${(ctx.scenario === "downside" ? ctx.inputs.targetCostWiring.uplift : 1).toFixed(4)}`
        : "";
      const note = `seed=${sim.seed}; iterations=${sim.iterations}; scenario=${ctx.scenario}; growth=${eff.growth.toFixed(4)}; wacc=${ctx.inputs.wacc.value}; wacc_source=${ctx.inputs.wacc.source}; wacc_scope=${ctx.inputs.waccScope?.scope ?? "project"}${ctx.inputs.wacc.run_id ? `; wacc_run=${ctx.inputs.wacc.run_id}` : ""}; wacc_subject=${waccSubject}; capture_rate=${bc.captureRate}; capture_source=${bc.captureSource}; ramp_source=${bc.rampSource}; ${provenance}${tcFragment}; engine=${engineMeta.engine}; device=${engineMeta.device}; precision=${engineMeta.precision}${bepFragment}`;
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
 * Generate the scenario business cases under ONE process_run (entity =
 * project, ADR-0096). Activities run sequentially so the GET status route can
 * show per-activity progress. Synchronous by design (bun's sync SQLite
 * layer); the { runId } response contract is unchanged.
 *
 * ADR-0143 subjects: greenfield generates the project-level set (one pass,
 * target_id NULL — legacy shape and seeds untouched); brownfield generates
 * one set per SHORTLISTED target of the source opportunity (3 scenarios ×
 * market_forward, plus the historical variant when that target's company
 * facts support it), each model row carrying target_id.
 *
 * Writes NO adoption marker and NO gate_decision — boundary #2.
 */
export async function generateBusinessCases(
  projectId: string,
  opts: { actor: string; source?: string; callAgent?: CallAgent },
): Promise<GenerationResult> {
  const db = getDb();
  const project = db
    .query("SELECT id, track, source_opportunity_id FROM md_project WHERE id = ?")
    .get(projectId) as { id: string; track: "greenfield" | "brownfield" | null; source_opportunity_id: string | null } | undefined;
  if (!project) throw new Error(`project '${projectId}' not found`);

  const subjects = project.track === "brownfield" ? listShortlistSubjects(db, project.source_opportunity_id ?? "") : [];
  // Promotion requires ≥1 shortlisted target (ADR-0095 precondition), so an
  // empty brownfield shortlist here is a data-integrity event, not an empty run.
  if (project.track === "brownfield" && subjects.length === 0) {
    throw new Error(`brownfield project '${projectId}' has no shortlisted target — S7 Short List required before S8 generation`);
  }

  const executor = getBusinessCaseExecutor();
  const activities: ActivitySpec[] = [];
  const buildForSubject = (inputs: CaseInputs, target?: { id: string; name: string }) => {
    // ADR-0117: each scenario runs in TWO variants — market_forward (gate
    // primary) and, when the subject company's DART series supports it,
    // historical (comparison evidence). Missing historical data is not an
    // error: the variant is skipped and the page shows N/A instead.
    const variants: CaseVariant[] = inputs.growthModel?.historical ? ["market_forward", "historical"] : ["market_forward"];
    for (const scenario of SCENARIOS) {
      for (const variant of variants) {
        const ctx: StepContext = { scenario, variant, inputs, ...(target ? { target } : {}) };
        for (const step of ["growth_projection", "valuation_model", "distributional_valuation", "scenario_risk_assessment"] as BusinessCaseStep[]) {
          const agentKey = businessCaseAgentFor(step);
          const subjectPrefix = target ? `${target.id}/` : "";
          activities.push({
            activityId: `${subjectPrefix}${scenario}:${variant}:${step}`,
            agentKey,
            prompt: `${step} — ${scenario} scenario (${variant}) for project ${projectId}${target ? ` target ${target.id} (${target.name})` : ""}`,
            execute: async () => executor(step, ctx),
          });
        }
      }
    }
  };
  if (subjects.length === 0) {
    buildForSubject(caseInputsForProject(projectId));
  } else {
    // D3: resolve the project-level base once per run — caseInputsForTarget
    // re-uses it instead of re-running WACC/bcParams/waccSubject/targetCost
    // queries for every subject.
    const base = caseInputsBaseForProject(projectId);
    for (const subject of subjects) {
      buildForSubject(caseInputsForTarget(projectId, subject, base), { id: subject.id, name: subject.name });
    }
  }

  const result = await runActivityChain({ entityType: "project", entityId: projectId }, activities, {
    actor: opts.actor,
    source: opts.source ?? "web",
    stage: "s8_business_case_generation",
  });

  // quant-methodologist's cross-case comparison: flag the RECOMMENDED case —
  // the scenario that best survives the risk tests (highest p05 NPV that is
  // positive; among negatives, the least-negative p05). Recorded on the run's
  // meta_json ONLY — never as an adoption marker, never as a gate decision.
  // Brownfield runs leave this null: the cross-TARGET recommendation is a
  // read-model rule (recommendTargetsFromDb), computed on demand.
  let recommendedScenario: Scenario | null = null;
  if (result.status === "done" && subjects.length === 0) {
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

/** The recommendation rule, pure over persisted rows — the page and the engine share it.
 *  Project-level subjects only (target_id IS NULL); brownfield per-target
 *  recommendation lives in recommendTargetsFromDb (ADR-0143). */
export function recommendedFromDb(projectId: string): Scenario | null {
  // ADR-0117: the RECOMMENDED flag judges the market_forward variant only —
  // the historical variant is comparison evidence, never a gate candidate.
  const rows = getDb()
    .query(
      `SELECT v.scenario, v.npv_krw_m FROM valuation_simulation v
       JOIN business_case_model m ON m.id = v.model_id
       WHERE v.project_id = ? AND v.percentile = 'p05' AND m.target_id IS NULL AND m.archived_at IS NULL
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

export type TargetEngine = "python-sim-engine" | "ts-fallback" | "mixed" | null;

/** Classify one simulation note's `engine=` fragment (written at generation). */
function engineOfNote(note: string | null): "python-sim-engine" | "ts-fallback" | null {
  const m = /(?:^|;\s*)engine=([^;]+)/.exec(note ?? "");
  if (!m) return null;
  return m[1].trim().startsWith("python-sim-engine") ? "python-sim-engine" : "ts-fallback";
}

function mergeEngines(kinds: Array<"python-sim-engine" | "ts-fallback" | null>): TargetEngine {
  const set = new Set(kinds.filter((k): k is "python-sim-engine" | "ts-fallback" => k !== null));
  if (set.size === 0) return null;
  return set.size > 1 ? "mixed" : [...set][0];
}

/** True when the compared targets' cases come from different engines (one footnote). */
export function enginesMixedAcrossTargets(rows: TargetComparisonRow[]): boolean {
  const seen = new Set(rows.map((r) => r.engine).filter((e) => e !== null));
  return seen.has("mixed") || seen.size > 1;
}

export interface TargetComparisonRow {
  targetId: string;
  companyName: string;
  rank: number | null;
  /** Latest market_forward base-scenario percentiles of this target's cases. */
  baseP05: number | null;
  baseP50: number | null;
  irr: number | null;
  caseCount: number;
  /** Engine provenance of the cases behind baseP05/p50 (D2), parsed from the
   *  `engine=` fragment each simulation note records. null = unrecorded. Rank
   *  and RECOMMENDED are NOT adjusted by it — a human judges. */
  engine: TargetEngine;
  /** RECOMMENDED flag — the same p05-survival rule as the scenario
   *  recommendation, applied across targets. A PROPOSAL only (boundary #2). */
  recommended: boolean;
}

/**
 * Cross-target comparison (ADR-0143): one row per shortlisted target, judged
 * on its LATEST gate-primary (market_forward) base-scenario model. The
 * historical variant never enters the ranking. Empty for greenfield.
 */
export function recommendTargetsFromDb(projectId: string): TargetComparisonRow[] {
  const db = getDb();
  const project = db
    .query("SELECT track, source_opportunity_id FROM md_project WHERE id = ?")
    .get(projectId) as { track: "greenfield" | "brownfield" | null; source_opportunity_id: string | null } | undefined;
  if (!project || project.track !== "brownfield" || !project.source_opportunity_id) return [];
  const targets = listShortlistSubjects(db, project.source_opportunity_id);
  if (targets.length === 0) return [];
  const ranks = new Map(
    (db
      .query("SELECT id, rank FROM brownfield_target WHERE opportunity_id = ? AND status = 'shortlisted'")
      .all(project.source_opportunity_id) as Array<{ id: string; rank: number | null }>).map((r) => [r.id, r.rank]),
  );
  const counts = new Map(
    (db
      .query("SELECT target_id, COUNT(*) AS n FROM business_case_model WHERE project_id = ? AND target_id IS NOT NULL AND archived_at IS NULL GROUP BY target_id")
      .all(projectId) as Array<{ target_id: string; n: number }>).map((r) => [r.target_id, r.n]),
  );
  // Latest gate-primary model per target that carries a BASE-scenario
  // simulation — the comparison judges base (created_at DESC — first wins).
  // Scenario is a property of the model's simulations (ADR-0098), not a
  // column, so "the base model" is expressed as an EXISTS probe.
  const latest = new Map<string, string>();
  for (const m of db
    .query(
      `SELECT m.id, m.target_id FROM business_case_model m
       WHERE m.project_id = ? AND m.archived_at IS NULL AND m.target_id IS NOT NULL AND COALESCE(m.variant, 'market_forward') = 'market_forward'
         AND EXISTS (SELECT 1 FROM valuation_simulation v WHERE v.model_id = m.id AND v.scenario = 'base')
       ORDER BY m.created_at DESC, m.id DESC`,
    )
    .all(projectId) as Array<{ id: string; target_id: string }>) {
    if (!latest.has(m.target_id)) latest.set(m.target_id, m.id);
  }
  const simRows = db
    .query("SELECT model_id, percentile, npv_krw_m, irr, note FROM valuation_simulation WHERE project_id = ? AND scenario = 'base'")
    .all(projectId) as Array<{ model_id: string; percentile: string; npv_krw_m: number; irr: number | null; note: string | null }>;
  const engineByModel = new Map<string, Array<"python-sim-engine" | "ts-fallback" | null>>();
  for (const r of simRows) {
    const list = engineByModel.get(r.model_id) ?? [];
    list.push(engineOfNote(r.note));
    engineByModel.set(r.model_id, list);
  }
  const baseByModel = new Map<string, { p05: number | null; p50: number | null; irr: number | null }>();
  for (const r of simRows) {
    const entry = baseByModel.get(r.model_id) ?? { p05: null, p50: null, irr: null };
    if (r.percentile === "p05") entry.p05 = r.npv_krw_m;
    if (r.percentile === "p50") {
      entry.p50 = r.npv_krw_m;
      entry.irr = r.irr;
    }
    baseByModel.set(r.model_id, entry);
  }

  return flagRecommendedTarget(
    targets.map((t) => {
      const modelId = latest.get(t.id);
      const sim = modelId ? baseByModel.get(modelId) : undefined;
      return {
        targetId: t.id,
        companyName: t.name,
        rank: ranks.get(t.id) ?? null,
        baseP05: sim?.p05 ?? null,
        baseP50: sim?.p50 ?? null,
        irr: sim?.irr ?? null,
        caseCount: counts.get(t.id) ?? 0,
        engine: modelId ? mergeEngines(engineByModel.get(modelId) ?? []) : null,
        recommended: false,
      };
    }),
  );
}

/** Rank + flag helper shared by the comparison read model — the p05-survival
 *  rule (positive pool first, then max p05), applied across targets. */
export function flagRecommendedTarget(rows: TargetComparisonRow[]): TargetComparisonRow[] {
  const analyzed = rows.filter((r) => r.baseP05 !== null);
  const positive = analyzed.filter((r) => (r.baseP05 ?? 0) > 0);
  const pool = positive.length > 0 ? positive : analyzed;
  const best = pool.reduce<TargetComparisonRow | null>((acc, r) => (!acc || (r.baseP05 ?? 0) > (acc.baseP05 ?? 0) ? r : acc), null);
  return [...rows]
    .map((r) => (r === best ? { ...r, recommended: true } : r))
    .sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    const p05 = (b.baseP05 ?? -Infinity) - (a.baseP05 ?? -Infinity);
    if (p05 !== 0) return p05;
    return (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER);
  });
}
