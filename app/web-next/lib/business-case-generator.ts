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

import { noteNumber, parseSimNote } from "./sim-note.ts";
import { irrGuardBand, IRR_CAUTION_THRESHOLD_DEFAULT, IRR_FLAG_THRESHOLD_DEFAULT } from "./irr-guard.ts";
import { parseTargetScopeJson, type TargetScope } from "./target-scope.ts";
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
import { fmtNpvInteger } from "./npv-format.ts";
import { resolveDownsideOpexUplift } from "./target-costing.ts";
import { archiveSupersededRound } from "./business-case-cleanup.ts";
import { resolveS5SimConsumption, type S5SimConsumption } from "./investment-simulation-s8.ts";
import { aggregatePlanLines, pinPlanLinesOf } from "./s5-plan-pin.ts";
import { getCurrentS5PlanPin, resolveActivePin, resolvePinnedS5SimConsumption, s5SourceOptedIn } from "./s5-plan-pin-s8.ts";

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
  /** The subject company's latest annual revenue (DART, KRW millions) — the
   *  revenue-level anchor for brownfield per-target cases. null when the
   *  company is unbound or has no revenue series (≥1 year suffices; the
   *  historical VARIANT needs ≥2 years for a CAGR, the LEVEL needs one). */
  companyRevenue: { krwM: number; year: string } | null;
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
  let companyRevenue: { krwM: number; year: string } | null = null;
  // ADR-0143: opts.companyId가 주어지면(대상별 분석) 그 회사의 series로,
  // null이면 historical를 만들지 않는다. 미지정이면 기존대로
  // md_project.company_id (greenfield/project-level 호환).
  // Greenfield: the historical variant is Brown Field comparison evidence only,
  // so a linked company (financial-analysis tab / WACC subject) is not used here.
  const proj = opts
    ? undefined
    : (db.query("SELECT company_id, track FROM md_project WHERE id = ?").get(projectId) as { company_id: string | null; track: string | null } | undefined);
  const p = opts
    ? opts.companyId
      ? { company_id: opts.companyId }
      : undefined
    : proj?.track === "greenfield"
      ? undefined
      : proj;
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
      // Latest actual revenue — one positive data point is enough to anchor
      // the level; growth still needs the CAGR series above. NOTE:
      // deriveFinancialAnalysis normalizes DART 원 to 억원 (unit "KRW" → /1e8),
      // so the series point is 억원 — ×100 back to KRW millions.
      const revPoints = (analysis.series.find((s) => s.key === "revenue")?.points ?? [])
        .filter((pt): pt is { year: string; value: number } => pt.value !== null && pt.value > 0);
      if (revPoints.length > 0) {
        const latest = revPoints.reduce((a, b) => (a.year > b.year ? a : b));
        companyRevenue = { krwM: latest.value * 100, year: latest.year };
      }
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
    companyRevenue,
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
 *  초기투자가 없으면 모든 플로우가 양수라 IRR이 정의되지 않는다(null/0%).
 *  그린필드/프로젝트 레벨 케이스의 기본 경로다. */
const INITIAL_INVESTMENT_RATIO = 0.5;
/** 브라운필드 인수 가격 — 진입 EV/Revenue 배수 기본값. 외부 사례 (design
 *  2026-10-10-s8-acquisition-price-benchmark): 글로벌 로보틱스/자동화 M&A
 *  컴프는 2~6× 매출 배수 밴드(하드웨어 중심 저마진 1~3×, SW 결합형 5~10×),
 *  한국 전략적 휴머노이드 프리미엄은 훨씬 높다(삼성전자–레인보우로보틱스
 *  2023.12: 지분+유상증자 약 2,674억 — 당기 매출 152억; 2026년 기업가치
 *  약 2조 / 매출 341억 ≈ 59×). 3.0×는 보수적 스크리닝 기준값이며,
 *  딜 특성 프리미엄은 bc.acquisition_ev_revenue(kind=user, 근거 필수)로
 *  분석가가 확정한다. */
export const ACQUISITION_EV_REVENUE_DEFAULT = 3.0;
/** 이중 구조 교차검증(페이드 DCF)의 명시적 창구 기본 연수 — 표준 기업가치
 *  DCF의 명시적 전망 창구(10년) 관행을 따른다 (사용자 bc.fade_horizon_years
 *  로 조정). 이 창구 안에서 케이스 성장률이 말기 성장률(기본 3%)로 선형
 *  수렴한다 — 고성장(예: 40%)이 10년간 무수렴 지속되면 NPV가 5배로
 *  폭증하는 인공물(기간 민감도 분석, design 2026-10-10)을 막는 조건이다. */
export const FADE_HORIZON_YEARS = 10;
/** 페이드 DCF 말기 성장률 기본값 — 인플레이션±실질성장 수준의 영구 성장률. */
export const GROWTH_TERMINAL_DEFAULT = 0.03;
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
  if (fLo * fHi > 0) {
    // 표준 구간에서 부호 변화가 없으면 실제 IRR이 상한을 넘는 경우다 (예: S5
    // 연동으로 year-0 유출이 작고 이후 플로우가 큰 케이스). 상한을 ×10씩
    // 확장해 첫 부호 변화 지점을 찾고, 1e6(=100,000,000%)까지 닿지 않으면
    // 실제 근이 없다는 뜻이므로 null을 돌려준다 — 값을 만들어내지 않는다.
    while (fHi > 0 && hi < 1e6) {
      hi *= 10;
      fHi = npv(hi);
    }
    if (fLo * fHi > 0) return null;
  }
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
  const year1Revenue = year1RevenueOf(inputs, delta.growth).value;
  const horizon = horizonOf(inputs);
  const opexRatio = opexRatioOf(inputs, scenario);
  const capexRatio = capexRatioOf(inputs);

  const npvs: number[] = [];
  // ADR-0174 — under an s5_plan basis the explicit plan replaces BOTH the
  // year-0 ratio investment and the per-year capex_ratio outflow (design §6.2:
  // using both would double count). The ratio path below stays bit-identical.
  const s5 = s5PlanOf(inputs);
  const initialInvestment = initialInvestmentOf(inputs, year1Revenue).value;
  const exitMult = exitEvRevenueOf(inputs);
  const discount = (v: number, year: number) => v / Math.pow(1 + inputs.wacc.value, year);
  const ramp = rampUpOf(inputs);
  // ADR-0176 slice 3: per-draw pairing with the confirmed S5 run - iteration `it` uses S5 draw
  // `it % drawCount`. The factors are precomputed, so the revenue rng stream is untouched.
  const sim5 = s5 && !s5.pnl ? inputs.s5Sim ?? null : null;
  for (let it = 0; it < iterationsOf(inputs); it++) {
    let revenue = year1Revenue;
    const capF = sim5 ? sim5.capFactors[it % sim5.drawCount] : 1;
    const manF = sim5 ? sim5.manFactors[it % sim5.drawCount] : 1;
    let npv = s5?.pnl
      ? -(s5.plan.preLaunchKrwM ?? 0)
      : s5
        ? -(sim5 ? drawnCapex(s5.plan, 0, capF, manF) : s5.plan.capexByYear[0])
        : -initialInvestment; // year-0 (s5_pnl: 출시 전 투자, OD-3)
    for (let year = 1; year <= horizon; year++) {
      if (year > 1) {
        const [z1] = normalPair(rng);
        revenue *= 1 + anchorGrowth + disp * z1;
      }
      const utilization = ramp[year - 1] ?? ramp[ramp.length - 1] ?? 1;
      let flow: number;
      if (s5?.pnl) {
        // ADR-0178 slice 2 - 가동률은 매출에만 (OD-7): flow = rev*util - plan opex - plan capex.
        // 계획 미포함 연도는 가동률 반영 매출 x opexRatio로 대체 (labelled in note), capex는
        // 계획 기간 외 가동률 반영 매출 x capexRatio. s5Sim pairing은 slice 3까지 없음.
        const revUtil = revenue * utilization;
        const i = year - 1;
        const covered = (i < s5.plan.opexCovered.length && s5.plan.opexCovered[i]) || (i < s5.plan.govRndByYear.length && s5.plan.govRndByYear[i] > 0);
        const opex = covered
          ? s5.plan.laborOpexByYear[i] + s5.plan.govRndByYear[i]
          : revUtil * opexRatio;
        const capex = i < s5.plan.capexByYear.length ? s5.plan.capexByYear[i] : revUtil * capexRatio;
        flow = revUtil - opex - capex;
      } else if (s5) {
        let opex = opexOfYear(inputs, s5, year, revenue);
        if (sim5 && s5.full && year - 1 < s5.plan.opexCovered.length && s5.plan.opexCovered[year - 1]) opex = drawnLaborOpex(s5.plan, year - 1, capF, manF);
        const capex = sim5 ? drawnCapex(s5.plan, year, capF, manF) : capexOfYear(inputs, s5, year, revenue);
        flow = (revenue - opex) * utilization - capex;
      } else {
        const fcf = revenue * (1 - opexRatio) - revenue * capexRatio;
        flow = fcf * utilization;
      }
      npv += discount(flow, year);
    }
    // Exit value — the business is sold at the entry multiple on the final
    // year's drawn revenue (matches the engine: raw revenue, no ramp).
    if (exitMult > 0) npv += discount(revenue * exitMult, horizon);
    npvs.push(npv);
  }
  npvs.sort((a, b) => a - b);
  const mean = npvs.reduce((a, b) => a + b, 0) / npvs.length;
  const variance = npvs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / npvs.length;
  const q = (p: number) => npvs[Math.min(npvs.length - 1, Math.max(0, Math.floor(p * npvs.length)))];
  // Deterministic path - same BEP/payback definition as the engine. Under
  // s5_pnl the year-0 outflow is the plan's pre-launch amount (OD-3) and the
  // plan's per-year opex/capex ride inside the flows (utilization on revenue only).
  const detInitial = s5?.pnl ? (s5.plan.preLaunchKrwM ?? 0) : s5 ? s5.plan.capexByYear[0] : initialInvestmentOf(inputs, year1Revenue).value;
  const detFlows: number[] = [-detInitial];
  let detRevenue = year1Revenue;
  for (let year = 1; year <= horizon; year++) {
    if (year > 1) detRevenue *= 1 + anchorGrowth;
    const utilization = ramp[year - 1] ?? ramp[ramp.length - 1] ?? 1;
    if (s5?.pnl) {
      const i = year - 1;
      const revUtil = detRevenue * utilization;
      const covered = (i < s5.plan.opexCovered.length && s5.plan.opexCovered[i]) || (i < s5.plan.govRndByYear.length && s5.plan.govRndByYear[i] > 0);
      const opex = covered ? s5.plan.laborOpexByYear[i] + s5.plan.govRndByYear[i] : revUtil * opexRatio;
      const capex = i < s5.plan.capexByYear.length ? s5.plan.capexByYear[i] : revUtil * capexRatio;
      detFlows.push(revUtil - opex - capex);
    } else if (s5) {
      const opex = opexOfYear(inputs, s5, year, detRevenue);
      detFlows.push((detRevenue - opex) * utilization - capexOfYear(inputs, s5, year, detRevenue));
    } else {
      detFlows.push(detRevenue * (1 - opexRatio - capexRatio) * utilization);
    }
  }
  if (exitMult > 0) detFlows[detFlows.length - 1] += detRevenue * exitMult;
  const bepYear = s5?.pnl && detInitial === 0 ? null : discountedPaybackYear(detInitial, detFlows.slice(1), inputs.wacc.value);
  return { seed, iterations: iterationsOf(inputs), p05: q(0.05), p50: q(0.5), p95: q(0.95), mean, std: Math.sqrt(variance), bepYear, bepVolume: null };
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
  /** Brownfield per-target revenue anchor (ADR-0143 subjects): year-1 revenue
   *  is the TARGET company's latest annual revenue (DART), not
   *  market-size × capture-rate — an M&A case discounts the acquired revenue
   *  base, not a from-scratch market entry. Absent (greenfield/project-level,
   *  or a target without company facts) → the market-capture model applies. */
  revenueAnchor?: { krwM: number; source: string };
  /** Brownfield acquisition pricing (benchmark design 2026-10-10): the year-0
   *  outflow is the ACQUISITION enterprise value — anchor revenue ×
   *  EV/Revenue multiple — instead of a greenfield setup ratio. Exit at the
   *  horizon reuses the same multiple (no expansion assumed). Set only
   *  alongside revenueAnchor; an explicit user bc.initial_investment_ratio
   *  still wins (the direct investment-size knob). */
  acquisition?: { evRevenue: number; source: string };
  /** Sales-plan parameters (design REQ-W1-2/3): capture rate and the
   *  utilization ramp-up curve, resolvable as bc.* user assumptions with
   *  provenance labels. Optional so hand-built contexts fall back to the
   *  deterministic defaults. */
  bcParams?: BusinessCaseParams;
  /** WACC application subject (REQ-W4-1/2) — whose cost of capital discounts
   *  the cash flows. Optional for hand-built contexts: defaults to promoter. */
  waccSubject?: WaccSubjectResolution;
  /** Target-costing downside wiring (REQ-W2-3) — present only when the
   *  latest target_costing_analysis breaches the +10% gap_threshold. */
  targetCostWiring?: { uplift: number; gapRatio: number };
  /** ADR-0174 — the project's explicit S5 investment plan (latest
   *  `greenfield_cost` model). Consulted only when a human set an
   *  `s5_plan` basis; the ratio path never reads it. */
  s5Plan?: S5InvestmentPlan | null;
  /** ADR-0176 slice 3 - the latest CONFIRMED S5 investment simulation run's per-draw group
   *  factors. Consulted only under an s5_plan basis with a plan; absent = today's single-point
   *  plan (bit-identical), recorded as `s5_sim=none`. */
  s5Sim?: S5SimConsumption | null;
  /** ADR-0179 slice 1 — the promoting opportunity's person-set structured
   *  target scope, passed through for provenance/display (slice 2 consumes
   *  it against the market anchor). NULL/absent = legacy behavior. */
  targetScope?: TargetScope | null;
}

/** Default sales-plan curve (design REQ-W1-2) — utilization by year. */
export const DEFAULT_RAMP_UP = [0.4, 0.7, 0.9, 1.0, 1.0];

/** Optimism-bias flag: confirmed band max above factor x the global reference max. */
export const EV_BAND_OPTIMISM_FLAG_FACTOR = 1.5;
/** An EV/Revenue above this is treated as an input error, not a band. */
export const EV_BAND_MAX_SANE = 50;
/** Spread flag: confirmed max/min above 1.5x the global band's max/min ratio (3) = 4.5. Warning only. */
export const EV_BAND_SPREAD_FLAG_RATIO = 4.5;
/** A confirmed band older than this many days is flagged stale. Warning only. */
export const EV_BAND_STALE_DAYS = 90;
export const EV_BAND_RATIONALE_MAX = 2000;
export const EV_BAND_SOURCE_MAX = 500;
export class EvBandValidationError extends Error {}
export const EV_BAND_MIN_KEY = "bc.acquisition_ev_revenue_band.min";
export const EV_BAND_MAX_KEY = "bc.acquisition_ev_revenue_band.max";

export interface ConfirmedEvBand {
  min: number;
  max: number;
  rationale: string;
  source: string;
  /** run.created_by / run.created_at of the confirming run. */
  confirmedBy: string;
  confirmedAt: string;
  runId: string;
}

type EvBandDb = { query: (sql: string) => { get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[] } };

/** Latest run that carries BOTH band keys (kind='user'); a half-written run is
 *  ignored so a new min is never paired with an old max. */
export function resolveConfirmedEvBand(db: EvBandDb, projectId: string): ConfirmedEvBand | null {
  const rows = db
    .query(
      `SELECT a.run_id, a.assumption_key, a.value, a.rationale, a.anchor_ref, r.created_by, r.created_at
       FROM assumption a JOIN run r ON r.id = a.run_id
       WHERE r.project_id = ? AND a.kind = 'user' AND a.assumption_key IN (?, ?)
       ORDER BY r.created_at DESC, r.id DESC, a.id DESC`,
    )
    .all(projectId, EV_BAND_MIN_KEY, EV_BAND_MAX_KEY) as Array<{
    run_id: string; assumption_key: string; value: number; rationale: string | null; anchor_ref: string | null; created_by: string; created_at: string;
  }>;
  const byRun = new Map<string, { min?: (typeof rows)[number]; max?: (typeof rows)[number] }>();
  for (const r of rows) {
    const e = byRun.get(r.run_id) ?? {};
    if (r.assumption_key === EV_BAND_MIN_KEY && !e.min) e.min = r;
    if (r.assumption_key === EV_BAND_MAX_KEY && !e.max) e.max = r;
    byRun.set(r.run_id, e); // Map preserves insertion order = newest run first
  }
  for (const [runId, e] of byRun) {
    if (!e.min || !e.max) continue;
    if (!Number.isFinite(e.min.value) || !Number.isFinite(e.max.value) || !(e.min.value > 0) || !(e.min.value < e.max.value)) continue;
    return {
      min: e.min.value,
      max: e.max.value,
      rationale: e.min.rationale ?? "",
      source: e.min.anchor_ref ?? "",
      confirmedBy: e.min.created_by,
      confirmedAt: e.min.created_at,
      runId,
    };
  }
  return null;
}

/** Validate a band confirmation (server-authoritative). Throws Error with a field-specific message. */
export function validateEvBandInput(input: { min: unknown; max: unknown; rationale: unknown; source: unknown }): { min: number; max: number; rationale: string; source: string } {
  const { min, max } = input;
  const bad = (m: string) => new EvBandValidationError(m);
  if (typeof min !== "number" || !Number.isFinite(min) || min <= 0) throw bad("min은 0보다 큰 유한한 숫자여야 합니다.");
  if (typeof max !== "number" || !Number.isFinite(max)) throw bad("max는 유한한 숫자여야 합니다.");
  if (min >= max) throw bad("min은 max보다 작아야 합니다.");
  if (max > EV_BAND_MAX_SANE) throw bad(`max는 ${EV_BAND_MAX_SANE}x 이하여야 합니다 (입력 오류로 간주).`);
  const rationale = typeof input.rationale === "string" ? input.rationale.trim() : "";
  if (rationale.length < 10) throw bad("rationale은 10자 이상이어야 합니다.");
  if (rationale.length > EV_BAND_RATIONALE_MAX) throw bad(`rationale은 ${EV_BAND_RATIONALE_MAX}자 이하여야 합니다.`);
  const source = typeof input.source === "string" ? input.source.trim() : "";
  if (source.length < 3) throw bad("source는 3자 이상이어야 합니다.");
  if (source.length > EV_BAND_SOURCE_MAX) throw bad(`source는 ${EV_BAND_SOURCE_MAX}자 이하여야 합니다.`);
  return { min, max, rationale, source };
}

/** Human-only write: two kind='user' rows in ONE fresh run; overwrite-only. */
export async function recordEvRevenueBand(
  db: { run: (sql: string, ...args: unknown[]) => void },
  opts: { projectId: string; min: number; max: number; rationale: string; source: string; actor: string; now?: string },
): Promise<{ run_id: string; written: string[] }> {
  const v = validateEvBandInput(opts);
  const { createRun } = await import("../../../db/lib/versioning.ts");
  const { recordAssumption } = await import("../../../db/lib/assumption.ts");
  const now = opts.now ?? new Date().toISOString();
  const run = createRun(db as never, { projectId: opts.projectId, label: "EV/Revenue band confirmation", createdBy: opts.actor, overrides: {}, now });
  for (const [key, value] of [[EV_BAND_MIN_KEY, v.min], [EV_BAND_MAX_KEY, v.max]] as const) {
    recordAssumption(db as never, { runId: run.run_id, assumptionKey: key, kind: "user", value, asOf: now.slice(0, 10), rationale: v.rationale, anchorRef: v.source, actor: opts.actor, now });
  }
  return { run_id: run.run_id, written: [EV_BAND_MIN_KEY, EV_BAND_MAX_KEY] };
}

export interface EvRevenueBandPayload {
  confirmed: ConfirmedEvBand | null;
  reference: { min: number; max: number; label: string; sourced: false };
  optimismFlag: boolean;
  /** confirmed.max/confirmed.min > EV_BAND_SPREAD_FLAG_RATIO. Warning only. */
  spreadFlag: boolean;
  /** confirmedAt older than EV_BAND_STALE_DAYS (false when not confirmed). Warning only. */
  stale: boolean;
  /** Whole days since confirmedAt; null when not confirmed. */
  ageDays: number | null;
}

export function evRevenueBandPayload(confirmed: ConfirmedEvBand | null, now: Date = new Date()): EvRevenueBandPayload {
  const t = confirmed ? Date.parse(confirmed.confirmedAt) : NaN;
  const ageDays = Number.isFinite(t) ? Math.floor((now.getTime() - t) / 86_400_000) : null;
  return {
    spreadFlag: confirmed !== null && confirmed.max / confirmed.min > EV_BAND_SPREAD_FLAG_RATIO,
    stale: ageDays !== null && ageDays >= EV_BAND_STALE_DAYS,
    ageDays,
    confirmed,
    reference: { min: ACQUISITION_EV_REVENUE_BAND.min, max: ACQUISITION_EV_REVENUE_BAND.max, label: "global robotics/automation M&A screening band", sourced: false },
    optimismFlag: confirmed !== null && confirmed.max > EV_BAND_OPTIMISM_FLAG_FACTOR * ACQUISITION_EV_REVENUE_BAND.max,
  };
}

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
  /** ADR-0174 — human-chosen 투자비 기준 (OD-4: default `ratio` keeps every
   *  existing case's results unchanged). */
  investmentBasis: InvestmentBasis;
  investmentBasisSource: string;
  /** ADR-0178 slice 0 - where the S5 plan comes from: the promotion copy (default) or the
   *  project's pinned S5 reference. `pinned` only when a person set `bc.s5_source = 1`. Resolution
   *  output; the plan itself is resolved by resolveS5InvestmentPlan. */
  s5Source?: "copy" | "pinned";
  s5SourceSource?: string;
  /** ADR-0178 slice 0 - the pin id in force on the pinned path (null on the copy path). */
  s5PinId?: string | null;
  /** ADR-0174 OD-2 — the latest `greenfield_cost` model's horizon (null when
   *  the project has none). Resolution output only: the S8 UI shows it beside
   *  bc.horizon_years and warns on mismatch, never auto-reconciles. */
  s5PlanHorizonYears: number | null;
  /** 인수 EV/Revenue 배수 (user 확정 없으면 null → 컴프 기본값). */
  acquisitionEvRevenue: number | null;
  acquisitionEvRevenueSource: string;
  /** Human-confirmed project EV/Revenue band (read-only here; written only via
   *  the human-only ev-band route). null = not confirmed. */
  acquisitionEvRevenueBand: ConfirmedEvBand | null;
  /** 이중 구조 교차검증(페이드 DCF) — 명시적 창구 연수 (기본 10년). */
  fadeHorizonYears: number;
  fadeHorizonSource: string;
  /** 페이드 DCF의 말기 성장률 (기본 3% — 고성장이 영구히 지속되지 않는다). */
  growthTerminal: number | null;
  growthTerminalSource: string;
  growthOverride: number | null;
  growthOverrideSource: string;
  sigmaOverride: number | null;
  sigmaOverrideSource: string;
  horizonYears: number;
  horizonSource: string;
  iterations: number;
  iterationsSource: string;
  /** ADR-0179 slice 1 — IRR ceiling review guard thresholds (ratios). Person-settable
   *  project assumptions (bc.irr_flag_threshold / bc.irr_caution_threshold); the guard is
   *  display metadata only — it never recomputes or blocks anything. */
  irrFlagThreshold: number;
  irrFlagThresholdSource: string;
  irrCautionThreshold: number;
  irrCautionThresholdSource: string;
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
  const basisCode = scalar("bc.investment_basis");
  const acqEv = scalar("bc.acquisition_ev_revenue");
  const fadeH = ratio("bc.fade_horizon_years", FADE_HORIZON_YEARS);
  const gTerminal = scalar("bc.growth_terminal");
  const growthOv = scalar("bc.growth_override");
  const sigmaOv = scalar("bc.sigma_override");
  const horizon = ratio("bc.horizon_years", HORIZON_YEARS);
  const iterations = ratio("bc.iterations", MC_ITERATIONS);
  const irrFlagT = ratio("bc.irr_flag_threshold", IRR_FLAG_THRESHOLD_DEFAULT);
  const irrCautionT = ratio("bc.irr_caution_threshold", IRR_CAUTION_THRESHOLD_DEFAULT);
  const s5Model = db.query(
    `SELECT horizon_years FROM business_case_model
     WHERE project_id = ? AND kind = 'greenfield_cost' AND target_id IS NULL AND archived_at IS NULL
     ORDER BY created_at DESC, id DESC LIMIT 1`,
  ).get(projectId) as { horizon_years: number } | undefined;
  // ADR-0178 amendment: under the amended default, a current pin (unless a person reverted) is the
  // plan — its presence counts as plan presence and its horizon replaces the copy's.
  const activePin = resolveActivePin(db, projectId);
  const pinnedHorizon = activePin ? activePin.input.horizon : null;
  // ADR-0178 amendment: under the default, "pinned" is no longer proof of a person's explicit
  // opt-in — distinguish the provenance label so the parameter table doesn't claim a user edit
  // that never happened.
  const s5OptedIn = s5SourceOptedIn(db, projectId);
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
    investmentBasis: investmentBasisOfCode(basisCode),
    investmentBasisSource: basisCode != null ? "사용자 확정 (bc.investment_basis)" : "기본값 (비율 추정, ADR-0174 OD-4)",
    acquisitionEvRevenue: acqEv !== null && acqEv >= 0 ? acqEv : null,
    acquisitionEvRevenueSource: acqEv !== null && acqEv >= 0 ? "사용자 확정 (bc.acquisition_ev_revenue)" : "기본값",
    acquisitionEvRevenueBand: resolveConfirmedEvBand(db, projectId),
    fadeHorizonYears: Math.min(Math.max(Math.round(fadeH.value), 1), 50),
    fadeHorizonSource: fadeH.source,
    growthTerminal: gTerminal !== null && gTerminal >= 0 ? gTerminal : null,
    growthTerminalSource: gTerminal !== null && gTerminal >= 0 ? "사용자 확정 (bc.growth_terminal)" : "기본값",
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
    irrFlagThreshold: irrFlagT.value,
    irrFlagThresholdSource: irrFlagT.source,
    irrCautionThreshold: irrCautionT.value,
    irrCautionThresholdSource: irrCautionT.source,
    s5PlanHorizonYears: pinnedHorizon !== null ? Math.min(Math.max(Math.round(pinnedHorizon), 1), 50) : s5Model ? Math.min(Math.max(Math.round(s5Model.horizon_years), 1), 50) : null,
    s5Source: activePin ? "pinned" : "copy",
    s5SourceSource: activePin
      ? s5OptedIn ? "사용자 확정 (bc.s5_source)" : "기본 (S5와 연결됨, ADR-0178 개정)"
      : "기본값 (복사본, ADR-0178)",
    s5PinId: activePin ? activePin.pin.id : null,
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
      acquisition_ev_revenue?: number;
      fade_horizon_years?: number;
      growth_terminal?: number;
      growth_override?: number;
      sigma_override?: number;
      horizon_years?: number;
      iterations?: number;
      /** ADR-0179 slice 1 — IRR guard thresholds (ratios). flag > caution validated. */
      irr_flag_threshold?: number;
      irr_caution_threshold?: number;
      /** ADR-0174 — 투자비 기준. Stored as the numeric basis code. */
      investment_basis?: InvestmentBasis;
      /** ADR-0178 slice 0 - 0 = promotion copy (default), 1 = pinned S5 reference. A person's opt-in only. */
      s5_source?: 0 | 1;
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
  if (Object.keys(p as Record<string, unknown>).some((k) => k.startsWith("acquisition_ev_revenue_band"))) {
    throw new Error("use the human-only ev-band route");
  }
  if (p.capture_rate !== undefined) put("bc.capture_rate", p.capture_rate);
  if (p.ramp_up !== undefined) {
    if (!Array.isArray(p.ramp_up) || p.ramp_up.length === 0 || !p.ramp_up.every((v) => Number.isFinite(v) && v >= 0)) {
      throw new Error("ramp_up must be a non-empty array of non-negative numbers");
    }
    p.ramp_up.forEach((v, i) => put(`bc.ramp_up.y${i + 1}`, v));
  }
  if (p.investment_basis !== undefined) {
    put("bc.investment_basis", INVESTMENT_BASIS_CODES[p.investment_basis]);
  }
  if (p.s5_source !== undefined) {
    if (p.s5_source !== 0 && p.s5_source !== 1) throw new Error("s5_source must be 0 (copy) or 1 (pinned)");
    put("bc.s5_source", p.s5_source);
  }
  for (const [key, value] of [
    ["bc.opex_ratio", p.opex_ratio],
    ["bc.capex_ratio", p.capex_ratio],
    ["bc.initial_investment_ratio", p.initial_investment_ratio],
    ["bc.acquisition_ev_revenue", p.acquisition_ev_revenue],
    ["bc.fade_horizon_years", p.fade_horizon_years],
    ["bc.growth_terminal", p.growth_terminal],
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
  // ADR-0179 slice 1 — IRR guard thresholds. The flag threshold must stay
  // strictly above the caution threshold (same ratio convention).
  // Validate BOTH thresholds before writing either — a rejected request must
  // not leave a half-updated pair behind (flag above caution, atomically).
  if (p.irr_flag_threshold !== undefined && (!Number.isFinite(p.irr_flag_threshold) || p.irr_flag_threshold <= 0)) {
    throw new Error("bc.irr_flag_threshold must be a positive number (ratio)");
  }
  if (p.irr_caution_threshold !== undefined && (!Number.isFinite(p.irr_caution_threshold) || p.irr_caution_threshold < 0)) {
    throw new Error("bc.irr_caution_threshold must be a non-negative number (ratio)");
  }
  if (p.irr_flag_threshold !== undefined && p.irr_caution_threshold !== undefined && p.irr_flag_threshold <= p.irr_caution_threshold) {
    throw new Error("bc.irr_flag_threshold must be greater than bc.irr_caution_threshold");
  }
  if (p.irr_flag_threshold !== undefined) put("bc.irr_flag_threshold", p.irr_flag_threshold);
  if (p.irr_caution_threshold !== undefined) put("bc.irr_caution_threshold", p.irr_caution_threshold);
  if (written.length === 0) throw new Error("no parameters provided");
  return { written, run_id: run.run_id };
}

/** Deterministic defaults for hand-built contexts without bcParams. */
/** Default parameter set — exported for the ADR-0174 s5_plan tests. */
export function resolveBusinessCaseParamsDefaults(): BusinessCaseParams {
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
    investmentBasis: "ratio",
    investmentBasisSource: "기본값 (비율 추정, ADR-0174 OD-4)",
    s5PlanHorizonYears: null,
    s5Source: "copy",
    s5SourceSource: "기본값 (복사본, ADR-0178)",
    s5PinId: null,
    acquisitionEvRevenue: null,
    acquisitionEvRevenueSource: "기본값",
    acquisitionEvRevenueBand: null,
    fadeHorizonYears: FADE_HORIZON_YEARS,
    fadeHorizonSource: "기본값",
    growthTerminal: null,
    growthTerminalSource: "기본값",
    growthOverride: null,
    growthOverrideSource: "기본값",
    sigmaOverride: null,
    sigmaOverrideSource: "기본값",
    horizonYears: HORIZON_YEARS,
    horizonSource: "기본값",
    iterations: MC_ITERATIONS,
    iterationsSource: "기본값",
    irrFlagThreshold: IRR_FLAG_THRESHOLD_DEFAULT,
    irrFlagThresholdSource: "기본값",
    irrCautionThreshold: IRR_CAUTION_THRESHOLD_DEFAULT,
    irrCautionThresholdSource: "기본값",
  };
}

/** Effective accessors — hand-built contexts without bcParams keep the
 *  legacy constants (REQ-W6-1's resolution tail: default). */
function captureRateOf(inputs: CaseInputs): number {
  return inputs.bcParams?.captureRate ?? CAPTURE_RATE;
}

/** Year-1 revenue and its provenance label. Brownfield per-target cases with
 *  a company revenue anchor discount the acquired revenue base (scenario
 *  delta applies on top, preserving scenario semantics); everything else
 *  keeps the market-size × capture-rate model unchanged. */
function year1RevenueOf(inputs: CaseInputs, deltaGrowth: number): { value: number; source: string } {
  if (inputs.revenueAnchor) {
    return { value: inputs.revenueAnchor.krwM * deltaGrowth, source: inputs.revenueAnchor.source };
  }
  const bc = inputs.bcParams ?? resolveBusinessCaseParamsDefaults();
  return {
    value: inputs.marketSizeKrwM * bc.captureRate * deltaGrowth,
    source: `시장규모 × 시장점유율 ${(bc.captureRate * 100).toFixed(1)}% (${bc.captureSource})`,
  };
}

/** Year-0 outflow and its provenance. An acquisition-priced case pays the
 *  enterprise value — anchor revenue × EV/Revenue multiple, scenario-
 *  INDEPENDENT (the price is negotiated once; scenarios vary post-deal
 *  performance) — unless the user pinned the direct ratio knob
 *  (bc.initial_investment_ratio kind=user), which wins. Everything else
 *  keeps ADR-0106's year-1-revenue ratio. */
function initialInvestmentOf(inputs: CaseInputs, year1Revenue: number): { value: number; source: string } {
  const ratioUserPinned = inputs.bcParams?.initialInvestmentSource.startsWith("사용자") ?? false;
  if (inputs.acquisition && inputs.revenueAnchor && !ratioUserPinned) {
    return {
      value: inputs.revenueAnchor.krwM * inputs.acquisition.evRevenue,
      source: `인수 기업가치 — 대상 매출 × ${inputs.acquisition.evRevenue.toFixed(2)}배 (${inputs.acquisition.source})`,
    };
  }
  const bc = inputs.bcParams ?? resolveBusinessCaseParamsDefaults();
  return { value: year1Revenue * bc.initialInvestmentRatio, source: `ADR-0106 (${bc.initialInvestmentSource})` };
}

/** Exit (terminal) value multiple at the horizon — the entry multiple reused
 *  (no multiple expansion assumed). 0 = no exit value (legacy contract). */
function exitEvRevenueOf(inputs: CaseInputs): number {
  const ratioUserPinned = inputs.bcParams?.initialInvestmentSource.startsWith("사용자") ?? false;
  if (inputs.acquisition && inputs.revenueAnchor && !ratioUserPinned) return inputs.acquisition.evRevenue;
  return 0;
}

/** 이중 구조 교차검증(design 2026-10-10-s8-acquisition-price-benchmark 기간
 *  민감도 절): 같은 케이스를 고전 장기창구 DCF 구조로 재평가한다 —
 *  bc.fade_horizon_years(기본 10년) 창구 안에서 케이스 성장률이
 *  bc.growth_terminal(기본 3%)까지 **선형 수렴**하고, 마지막 해에 동일
 *  배수로 처분한다. 배수가 공정하면 두 구조의 값은 일치해야 한다(exit
 *  가격이 창구 이후 연도를 이미 자본화) — 큰 괴리는 성장 가정과 배수
 *  가정의 불일치 신호다. 결정론적 경로만 계산한다(구조를 검증하는 것이지
 *  분포를 재도출하는 게 아니다). 인수 가격 케이스가 아니면 null. */
export function fadedExitDcf(
  inputs: CaseInputs,
  scenario: Scenario,
  variant: CaseVariant = "market_forward",
): { horizon: number; terminalGrowth: number; npv: number; irr: number | null } | null {
  const exitMult = exitEvRevenueOf(inputs);
  if (exitMult <= 0) return null;
  const bc = inputs.bcParams ?? resolveBusinessCaseParamsDefaults();
  const horizon = bc.fadeHorizonYears;
  const terminalGrowth = bc.growthTerminal ?? GROWTH_TERMINAL_DEFAULT;
  const eff = effGrowthDisp(inputs, scenario, variant);
  const year1 = year1RevenueOf(inputs, SCENARIO_DELTA[scenario].growth).value;
  const entry = initialInvestmentOf(inputs, year1).value;
  const ramp = rampUpOf(inputs);
  const flows: number[] = [-entry];
  let revenue = year1;
  for (let t = 1; t <= horizon; t++) {
    if (t > 1) {
      // 선형 수렴: 2년차 성장률 = 케이스 성장률(무페이드), H년차 = 말기 성장률.
      const f = horizon > 2 ? (t - 2) / (horizon - 2) : 0;
      revenue *= 1 + eff.growth + (terminalGrowth - eff.growth) * f;
    }
    const utilization = ramp[t - 1] ?? ramp[ramp.length - 1] ?? 1;
    flows.push(revenue * (1 - opexRatioOf(inputs, scenario) - capexRatioOf(inputs)) * utilization);
  }
  flows[flows.length - 1] += revenue * exitMult; // 처분가치는 마지막 연도 플로우와 함께 실현
  const npv = flows.reduce((acc, cf, i) => acc + cf / Math.pow(1 + inputs.wacc.value, i), 0);
  return { horizon, terminalGrowth, npv, irr: irr(flows) };
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

// ── ADR-0174 slice 2 — S5 investment-plan basis (투자비 기준) ────────────────
// A human-chosen basis per project: `ratio` (today's behaviour, the default —
// results stay stable, OD-4) or `s5_plan`, where an explicit capex schedule
// built from the latest `greenfield_cost` model REPLACES both the year-0
// ratio investment and `capex_ratio × revenue` (using both would double
// count). `s5_plan_full` additionally replaces the opex ratio where the plan
// has labor/opex lines and books `gov_rnd` as an inflow in its year.

export type InvestmentBasis = "ratio" | "s5_plan" | "s5_plan_full" | "s5_pnl";

/** assumption.value is REAL NOT NULL, so the basis rides as a numeric code:
 *  0 = 비율 추정 (default), 1 = S5 투자 계획, 2 = S5 투자 계획 (opex 포함),
 *  3 = S5 계획 손익 (ADR-0178 slice 2 — Green Field + pinned path only, settable by a person only). */
export const INVESTMENT_BASIS_CODES: Record<InvestmentBasis, number> = { ratio: 0, s5_plan: 1, s5_plan_full: 2, s5_pnl: 3 };

export function investmentBasisOfCode(value: number | null | undefined): InvestmentBasis {
  if (value === INVESTMENT_BASIS_CODES.s5_plan) return "s5_plan";
  if (value === INVESTMENT_BASIS_CODES.s5_plan_full) return "s5_plan_full";
  if (value === INVESTMENT_BASIS_CODES.s5_pnl) return "s5_pnl";
  return "ratio";
}

export interface S5InvestmentPlan {
  /** The latest non-archived `greenfield_cost` model the vectors come from. */
  modelId: string;
  /** The model's own horizon (OD-2: after promotion S8's bc.horizon_years
   *  governs — years beyond the plan horizon fall back to the ratio path). */
  horizonYears: number;
  /** Index 0 = plan year 1 … H-1 = plan year H, KRW_M, growth-compounded
   *  (the copy and the pin snapshot both carry the S5 line's own growth rate now —
   *  promotion/re-import used to write 0, so the compounding was a no-op there). */
  capexByYear: number[];
  laborOpexByYear: number[];
  govRndByYear: number[];
  /** True where any labor/opex line covers the plan year — only such years
   *  switch the opex term under `s5_plan_full` (design §6.2). */
  opexCovered: boolean[];
  /** Lines excluded from the vectors: non-KRW_M unit (no FX in S8 either) or
   *  start beyond the model horizon. Surfaced in the run provenance. */
  skippedLines: number;
  /** ADR-0176 slice 3 - the part of `capexByYear` / `laborOpexByYear` that comes from S5 capability
   *  lines (promotion note `역량 해소 비용`); the remainder is manual lines. Lets a paired S5 draw
   *  scale each group by its own factor. Not part of `lineHash`. Absent in hand-built fixtures. */
  capexCapabilityByYear?: number[];
  laborOpexCapabilityByYear?: number[];
  /** ADR-0178 slice 1 - 시작 전 (start_year 0) lines of the plan: EXCLUDED from the per-year vectors above
   *  (not in year 1, not dropped silently), counted here and flagged in the run note until the s5_pnl
   *  basis (slice 2) consumes them as year 0. Present only when such a line exists. */
  preLaunchKrwM?: number;
  preLaunchLines?: number;
  /** FNV-1a over the serialized vectors — run provenance (design §6.2) so a
   *  later plan edit is detectable against a recorded run. */
  lineHash: string;
  /** ADR-0178 slice 0 - set only when the plan was computed from a pinned S5 snapshot. */
  pinId?: string;
  planHash?: string;
}

/** The explicit investment plan of a project, read from the latest
 *  `greenfield_cost` model (written at S5 promotion, ADR-0174 §6.1). Null
 *  when the project has none — every consumer then falls back to the ratio
 *  path, never to zero. */
export function resolveS5InvestmentPlan(db: { query: (sql: string) => { get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[] } }, projectId: string): S5InvestmentPlan | null {
  // ADR-0178 amendment: the pinned path (a current pin unless a person reverted) computes from the
  // pinned snapshot through the same aggregation; without it the copy path below is unchanged.
  const active = resolveActivePin(db, projectId);
  if (active) {
    const { horizon: pinHorizon, lines: pinLines } = pinPlanLinesOf(active.input);
    if (pinLines.length === 0) return null; // nothing importable in the pinned version: ratio path, like the copy
    const agg = aggregatePlanLines(pinHorizon, pinLines);
    const modelId = `pin:${active.pin.id}`;
    const lineHash = scenarioSeed(modelId, JSON.stringify({ c: agg.capexByYear, o: agg.laborOpexByYear, g: agg.govRndByYear, ...(agg.preLaunchLines ? { p: agg.preLaunchKrwM } : {}) })).toString(16);
    return { modelId, horizonYears: agg.horizonYears, capexByYear: agg.capexByYear, laborOpexByYear: agg.laborOpexByYear, govRndByYear: agg.govRndByYear, opexCovered: agg.opexCovered, skippedLines: agg.skippedLines, lineHash, capexCapabilityByYear: agg.capexCapabilityByYear, laborOpexCapabilityByYear: agg.laborOpexCapabilityByYear, ...(agg.preLaunchLines ? { preLaunchKrwM: agg.preLaunchKrwM, preLaunchLines: agg.preLaunchLines } : {}), pinId: active.pin.id, planHash: active.pin.plan_hash };
  }
  const model = db
    .query(
      `SELECT id, horizon_years FROM business_case_model
       WHERE project_id = ? AND kind = 'greenfield_cost' AND target_id IS NULL AND archived_at IS NULL
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(projectId) as { id: string; horizon_years: number } | undefined;
  if (!model) return null;
  const lines = db
    .query("SELECT category, annual_amount_krw_m, start_year, end_year, growth_rate, unit, note FROM business_case_line WHERE model_id = ?")
    .all(model.id) as Array<{ category: string; annual_amount_krw_m: number; start_year: number; end_year: number | null; growth_rate: number; unit: string | null; note?: string | null }>;
  const agg = aggregatePlanLines(model.horizon_years, lines);
  const lineHash = scenarioSeed(model.id, JSON.stringify({ c: agg.capexByYear, o: agg.laborOpexByYear, g: agg.govRndByYear, ...(agg.preLaunchLines ? { p: agg.preLaunchKrwM } : {}) })).toString(16);
  return { modelId: model.id, horizonYears: agg.horizonYears, capexByYear: agg.capexByYear, laborOpexByYear: agg.laborOpexByYear, govRndByYear: agg.govRndByYear, opexCovered: agg.opexCovered, skippedLines: agg.skippedLines, lineHash, capexCapabilityByYear: agg.capexCapabilityByYear, laborOpexCapabilityByYear: agg.laborOpexCapabilityByYear, ...(agg.preLaunchLines ? { preLaunchKrwM: agg.preLaunchKrwM, preLaunchLines: agg.preLaunchLines } : {}) };
}

/** The plan in force for a case — only when a human chose an s5_plan basis
 *  AND a plan exists; otherwise null (the ratio path runs unchanged). */
function s5PlanOf(inputs: CaseInputs): { plan: S5InvestmentPlan; full: boolean; pnl: boolean } | null {
  const basis = inputs.bcParams?.investmentBasis ?? "ratio";
  if (basis === "ratio") return null;
  const plan = inputs.s5Plan ?? null;
  if (!plan) return null;
  return { plan, full: basis === "s5_plan_full", pnl: basis === "s5_pnl" };
}

/** ADR-0176 slice 3 - capex / opex of the s5 plan under one paired S5 draw: capability-sourced lines
 *  scale by the draw's capability factor, manual lines by its manual-line factor. Factors of 1 give
 *  the single-point plan exactly. */
function drawnCapex(plan: S5InvestmentPlan, index: number, capF: number, manF: number): number {
  if (index >= plan.capexByYear.length) return 0;
  const cap = plan.capexCapabilityByYear?.[index] ?? 0;
  return cap * capF + (plan.capexByYear[index] - cap) * manF;
}
function drawnLaborOpex(plan: S5InvestmentPlan, index: number, capF: number, manF: number): number {
  const cap = plan.laborOpexCapabilityByYear?.[index] ?? 0;
  return cap * capF + (plan.laborOpexByYear[index] - cap) * manF;
}

/** Plan capex landing at cashflow index `year` (index 0 = the year-0 outflow
 *  per OD-3: plan year 1 spend is treated as year 0, matching today's year-0
 *  convention — so in-loop index `year` carries plan year `year + 1`). Years
 *  beyond the plan horizon fall back to the ratio path (labelled in the
 *  provenance), never to silent zero. */
function capexOfYear(inputs: CaseInputs, s5: { plan: S5InvestmentPlan } | null, year: number, revenue: number): number {
  if (!s5) return revenue * capexRatioOf(inputs);
  // The plan REPLACES the ratio (team-lead slice-2 spec): a year without a
  // plan entry has capex 0 — the schedule substitutes, never supplements.
  return year < s5.plan.capexByYear.length ? s5.plan.capexByYear[year] : 0;
}

/** Opex for cashflow year `year` (1-based). Under `s5_plan_full` the explicit
 *  labor/opex lines replace the ratio only in years a line covers. */
function opexOfYear(inputs: CaseInputs, s5: { plan: S5InvestmentPlan; full: boolean } | null, year: number, revenue: number): number {
  if (!s5) return revenue * opexRatioOf(inputs);
  if (!s5.full) return revenue * opexRatioOf(inputs);
  const i = year - 1;
  return i < s5.plan.opexCovered.length && s5.plan.opexCovered[i] ? s5.plan.laborOpexByYear[i] : revenue * opexRatioOf(inputs);
}

/** ADR-0178 slice 2 (s5_pnl) - per-year P&L terms of the plan (design §5).
 * Covered year: a labor/opex OR gov_rnd line lands in it - opex is the plan
 * laborOpex + govRnd, NOT scaled by utilization (OD-7). Uncovered year:
 * opex falls back to ramped revenue x opexRatio (labelled). Capex beyond the
 * plan horizon falls back to ramped revenue x capexRatio (labelled). Pure. */
export interface S5PnlYear {
  year: number;
  opexKrwM: number;
  capexKrwM: number;
  opexFallback: boolean;
  capexFallback: boolean;
  opexFallbackLabel: string;
  capexFallbackLabel: string;
}

export function s5PnlYearPlan(
  plan: S5InvestmentPlan,
  horizon: number,
  revenueByYear: number[],
  utilizationByYear: number[],
  opexRatio: number,
  capexRatio: number,
): { years: S5PnlYear[]; fallbackYears: number; preLaunchKrwM: number } {
  const preLaunchKrwM = plan.preLaunchKrwM ?? 0;
  const years: S5PnlYear[] = [];
  for (let year = 1; year <= horizon; year++) {
    const i = year - 1;
    const revUtil = (revenueByYear[i] ?? 0) * (utilizationByYear[i] ?? 1);
    const covered = (i < plan.opexCovered.length && plan.opexCovered[i]) || (i < plan.govRndByYear.length && plan.govRndByYear[i] > 0);
    const opexFallback = !covered;
    const opexKrwM = opexFallback ? revUtil * opexRatio : plan.laborOpexByYear[i] + (i < plan.govRndByYear.length ? plan.govRndByYear[i] : 0);
    const withinPlan = i < plan.capexByYear.length;
    const capexKrwM = withinPlan ? plan.capexByYear[i] : revUtil * capexRatio;
    const capexFallback = !withinPlan;
    const opexFallbackLabel = opexFallback ? "비율 대체 (계획 미포함 연도)" : "S5 계획";
    const capexFallbackLabel = capexFallback ? "비율 대체 (계획 기간 외)" : "S5 계획";
    years.push({ year, opexKrwM, capexKrwM, opexFallback, capexFallback, opexFallbackLabel, capexFallbackLabel });
  }
  return { years, fallbackYears: years.filter((y) => y.opexFallback || y.capexFallback).length, preLaunchKrwM };
}

/** Note-provenance helper for the s5_pnl basis: fallback-year share over the
 *  bc horizon and the pre-launch amount (always recorded, warned when 0). */
export function s5PnlNoteInfo(inputs: CaseInputs, plan: S5InvestmentPlan): { fallbackYears: number; horizon: number; preLaunchKrwM: number } {
  const bc = inputs.bcParams ?? resolveBusinessCaseParamsDefaults();
  const horizon = bc.horizonYears;
  let fallbackYears = 0;
  for (let i = 0; i < horizon; i++) {
    const opexCovered = (i < plan.opexCovered.length && plan.opexCovered[i]) || (i < plan.govRndByYear.length && plan.govRndByYear[i] > 0);
    if (!opexCovered || i >= plan.capexByYear.length) fallbackYears += 1;
  }
  return { fallbackYears, horizon, preLaunchKrwM: plan.preLaunchKrwM ?? 0 };
}

function initialInvestmentRatioOf(inputs: CaseInputs): number {
  return inputs.bcParams?.initialInvestmentRatio ?? INITIAL_INVESTMENT_RATIO;
}

/** Opex cross-check under a non-full s5 basis (team-lead spec): the plan's
 *  explicit labor/opex run-rate vs the ratio opex on the year-1 revenue, summed
 *  in absolute KRW_M across plan-covered years. Provenance/display only — it
 *  never enters the cash flows. */
function s5OpexCrossCheckVariance(inputs: CaseInputs): number | null {
  const s5 = s5PlanOf(inputs);
  if (!s5) return null;
  const y1 = year1RevenueOf(inputs, SCENARIO_DELTA.base.growth).value;
  const ratioOpex = y1 * opexRatioOf(inputs);
  let variance = 0;
  for (let i = 0; i < s5.plan.laborOpexByYear.length; i++) {
    variance += Math.abs(s5.plan.laborOpexByYear[i] - ratioOpex);
  }
  return variance;
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
      `SELECT o.market_size_krw_m, o.growth_rate, o.target_scope_json, p.source_opportunity_id
       FROM md_project p LEFT JOIN opportunity o ON o.id = p.source_opportunity_id
       WHERE p.id = ?`,
    )
    .get(projectId) as { market_size_krw_m: number | null; growth_rate: number | null; target_scope_json: string | null; source_opportunity_id: string | null } | undefined;
  // Deterministic fallbacks when the promoting opportunity carries no market
  // facts (brownfield promotion path): documented, never random. growth_rate
  // is stored as a RATIO (evidence_var unit 'ratio', migration 0017; seeds
  // store 0.06) and is used as-is — no percent conversion.
  const bcParams = resolveBusinessCaseParams(getDb(), projectId);
  const s5Plan = resolveS5InvestmentPlan(getDb(), projectId);
  return {
    projectId,
    marketSizeKrwM: row?.market_size_krw_m ?? 50000,
    anchorGrowth: row?.growth_rate ?? 0.05,
    wacc: resolveProjectWacc(getDb(), projectId),
    waccScope: { scope: "project" },
    bcParams,
    waccSubject: resolveProjectWaccSubject(getDb(), projectId),
    targetCostWiring: resolveDownsideOpexUplift(getDb(), projectId) ?? undefined,
    // ADR-0174: resolve once per project run — a null plan (no greenfield_cost
    // model yet) keeps every consumer on the ratio path via s5PlanOf().
    s5Plan,
    // ADR-0176 slice 3: the latest CONFIRMED S5 simulation run, only under an s5_plan basis with a
    // plan. None -> today's single-point plan (note `s5_sim=none`); never blocking.
    // ADR-0178 slice 0: on the pinned path the run is the one the pin names, not "the latest confirmed".
    s5Sim: bcParams.investmentBasis !== "ratio" && bcParams.investmentBasis !== "s5_pnl" && s5Plan
      ? s5Plan.pinId ? resolvePinnedS5SimConsumption(getDb(), getCurrentS5PlanPin(getDb(), projectId)!) : resolveS5SimConsumption(getDb(), row?.source_opportunity_id)
      : null,
    // ADR-0179 slice 1 — the person-set target scope passes through for later
    // consumption; a NULL or unparsable column never blocks generation (parse
    // failures degrade to null, the caller sees legacy behavior). The CHECK
    // constraint should keep invalid JSON out, but generation must be robust
    // to hand-written rows anyway — hence the defensive try/catch.
    targetScope: (() => {
      try {
        return parseTargetScopeJson(row?.target_scope_json ?? null) ?? null;
      } catch {
        return null;
      }
    })(),
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
  const growthModel = resolveGrowthModel(getDb(), projectId, { companyId: target.companyId });
  // Brownfield revenue anchor: an M&A case discounts the TARGET's acquired
  // revenue base — market-size × capture-rate models a from-scratch entry and
  // ignores the target's scale entirely (a 몇백억-revenue target valued at
  // 몇억). Falls back to the market-capture model when the company has no
  // revenue series; the fallback's provenance stays labeled.
  const revenueAnchor = growthModel.companyRevenue
    ? { krwM: growthModel.companyRevenue.krwM, source: `대상 회사 최신 연매출 ${growthModel.companyRevenue.year} (DART)` }
    : undefined;
  // Acquisition pricing (benchmark design 2026-10-10): with a revenue anchor
  // the year-0 outflow becomes the acquisition EV — revenue × EV/Revenue
  // multiple. Default 3.0× is the conservative global robotics-M&A screening
  // band midpoint; deal-specific premiums are a user bc.acquisition_ev_revenue
  // assumption with mandatory rationale.
  const acquisition =
    revenueAnchor && base.bcParams
      ? {
          evRevenue: base.bcParams.acquisitionEvRevenue ?? ACQUISITION_EV_REVENUE_DEFAULT,
          source:
            base.bcParams.acquisitionEvRevenue !== null
              ? "사용자 확정 (bc.acquisition_ev_revenue)"
              : `컴프 기본값 ${ACQUISITION_EV_REVENUE_DEFAULT.toFixed(1)}× — 글로벌 로보틱스/자동화 M&A 밴드 2–6× (이 도메인에 대한 출처 없음, 참고용)`,
        }
      : undefined;
  return {
    ...base,
    wacc,
    waccScope,
    targetId: target.id,
    growthModel,
    ...(revenueAnchor ? { revenueAnchor } : {}),
    ...(acquisition ? { acquisition } : {}),
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

/** Deterministic (mid-point) cash-flow vector — exported for the ADR-0174
 *  golden/no-double-count tests (tests/unit/business-case-s5-plan.test.ts). */
export function deterministicCashflows(inputs: CaseInputs, scenario: Scenario, variant: CaseVariant = "market_forward"): number[] {
  const delta = SCENARIO_DELTA[scenario];
  const eff = effGrowthDisp(inputs, scenario, variant);
  const year1Revenue = year1RevenueOf(inputs, delta.growth).value;
  const exitMult = exitEvRevenueOf(inputs);
  const s5 = s5PlanOf(inputs);
  const opexRatioD = opexRatioOf(inputs, scenario);
  const capexRatioD = capexRatioOf(inputs);
  const initialInvestment = s5?.pnl ? (s5.plan.preLaunchKrwM ?? 0) : s5 ? s5.plan.capexByYear[0] : initialInvestmentOf(inputs, year1Revenue).value;
  let revenue = year1Revenue;
  const ramp = rampUpOf(inputs);
  const flows: number[] = [-initialInvestment]; // year-0 투자 (s5_plan: 계획 Y1 집행액, OD-3)
  for (let year = 1; year <= horizonOf(inputs); year++) {
    if (year > 1) revenue *= 1 + eff.growth;
    const utilization = ramp[year - 1] ?? ramp[ramp.length - 1] ?? 1;
    if (s5?.pnl) {
      const i = year - 1;
      const revUtil = revenue * utilization;
      const covered = (i < s5.plan.opexCovered.length && s5.plan.opexCovered[i]) || (i < s5.plan.govRndByYear.length && s5.plan.govRndByYear[i] > 0);
      const opex = covered ? s5.plan.laborOpexByYear[i] + s5.plan.govRndByYear[i] : revUtil * opexRatioD;
      const capex = i < s5.plan.capexByYear.length ? s5.plan.capexByYear[i] : revUtil * capexRatioD;
      flows.push(revUtil - opex - capex);
    } else if (s5) {
      const opex = opexOfYear(inputs, s5, year, revenue);
      flows.push((revenue - opex) * utilization - capexOfYear(inputs, s5, year, revenue));
    } else {
      flows.push(revenue * (1 - opexRatioOf(inputs, scenario) - capexRatioOf(inputs)) * utilization);
    }
  }
  if (exitMult > 0) flows[flows.length - 1] += revenue * exitMult; // 처분가치는 마지막 연도 플로우와 함께 실현
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
  const y1 = year1RevenueOf(inputs, delta.growth);
  const s5 = s5PlanOf(inputs);
  const initInv = s5?.pnl
    ? { value: s5.plan.preLaunchKrwM ?? 0, source: `S5 계획 출시 전 투자 합계 — ${s5.plan.pinId ? `S5 고정 참조 ${s5.plan.pinId}` : `greenfield_cost model ${s5.plan.modelId}`} (year-0 무할인, OD-3)${(s5.plan.preLaunchKrwM ?? 0) === 0 ? " (출시 전 투자 미지정)" : ""}` }
    : s5
      ? { value: s5.plan.capexByYear[0], source: `S5 투자 계획 Y1 집행액 — ${s5.plan.pinId ? `S5 고정 참조 ${s5.plan.pinId}` : `greenfield_cost model ${s5.plan.modelId}`} (OD-3: 계획 1년차 지출을 year-0으로 반영)` }
      : initialInvestmentOf(inputs, y1.value);
  const exitMult = exitEvRevenueOf(inputs);
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
          revenue_y1: { dist: "constant", value: y1.value, unit: "KRW_M", source: y1.source },
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
          capex_ratio: {
            dist: "constant",
            value: s5 ? 0 : bc.capexRatio, // s5: 스케줄이 대체 — 비율과 스케줄의 이중 계상은 이중계산 (design §6.2)
            unit: "ratio",
            source: s5?.pnl
              ? `계획 기간은 S5 스케줄, 계획 기간 외에는 가동률 반영 매출 x capex 비율로 대체 (${s5.plan.pinId ? `S5 고정 참조 ${s5.plan.pinId}` : `model ${s5.plan.modelId}`})`
              : s5
                ? `S5 투자 계획 스케줄로 대체 (${s5.plan.pinId ? `S5 고정 참조 ${s5.plan.pinId}` : `model ${s5.plan.modelId}`})`
                : bc.capexSource,
          },
          initial_investment: { dist: "constant", value: initInv.value, unit: "KRW_M", source: initInv.source },
          ...(exitMult > 0
            ? { exit_ev_revenue: { dist: "constant", value: exitMult, unit: "multiple", source: `회수 시점 처분 — 진입 배수와 동일 ${exitMult.toFixed(2)}× (멀티플 확대 없음)` } }
            : {}),
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
      const y1 = year1RevenueOf(ctx.inputs, delta.growth);
      return [
        `### [재무 분석] financial-analyst — 성장 전망 (${SCENARIO_LABEL[ctx.scenario]} · ${VARIANT_LABEL[variant]})`,
        "",
        `성장 근거: ${eff.growthSource} ${(eff.growth * 100).toFixed(2)}%/년 (시나리오 계수 ×${delta.growth}),`,
        `변동성 근거: ${eff.dispSource} (sigma ${pct1(eff.disp)} ×${delta.disp}).`,
        ctx.inputs.revenueAnchor
          ? `1차년도 매출은 ${(y1.value / 100).toFixed(1)} 억원 — ${y1.source} 기준, 인수 대상의 기존 매출 규모를 반영한다 (가동률 ${rampUpOf(ctx.inputs).map((v) => v.toFixed(1)).join(" → ")}).`
          : `1차년도 매출은 시장 점유율 ${captureRateOf(ctx.inputs) * 100}% 가정으로 ${(y1.value / 100).toFixed(1)} 억원 (가동률 ${rampUpOf(ctx.inputs).map((v) => v.toFixed(1)).join(" → ")}).`,
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
      const y1 = year1RevenueOf(ctx.inputs, delta.growth);
      const s5 = s5PlanOf(ctx.inputs);
      const initInv = s5?.pnl
        ? { value: s5.plan.preLaunchKrwM ?? 0, source: `S5 계획 출시 전 투자 합계 — model ${s5.plan.modelId} (year-0 무할인, OD-3)${(s5.plan.preLaunchKrwM ?? 0) === 0 ? " (출시 전 투자 미지정)" : ""}` }
        : s5
          ? { value: s5.plan.capexByYear[0], source: `S5 투자 계획 Y1 집행액 — model ${s5.plan.modelId} (OD-3: 계획 1년차 지출을 year-0으로 반영)` }
          : initialInvestmentOf(ctx.inputs, y1.value);
      const lines: Array<[string, "revenue" | "opex" | "capex", string, number]> = [
        ["revenue", "revenue", ctx.inputs.revenueAnchor ? `시나리오 매출 (대상 회사 연매출 앵커 — ${ctx.inputs.revenueAnchor.source})` : "시나리오 매출 (year-1 앵커)", y1.value],
        ["opex", "opex", `운영비 (매출의 ${Math.round(opexRatioOf(ctx.inputs) * 100)}%)`, y1.value * opexRatioOf(ctx.inputs)],
        s5?.pnl
          ? ["capex", "capex", `설비 투자 (S5 계획 손익 — model ${s5.plan.modelId}; 계획 미포함 연도는 가동률 반영 매출 x 비율 대체)`, (s5.plan.capexByYear[0] ?? 0)]
          : s5
            ? ["capex", "capex", `설비 투자 (S5 투자 계획 Y1 집행액 — model ${s5.plan.modelId})`, s5.plan.capexByYear[0]]
          : ["capex", "capex", `설비 투자 (year-1, 매출의 ${Math.round(capexRatioOf(ctx.inputs) * 100)}%)`, y1.value * capexRatioOf(ctx.inputs)],
      ];
      for (const [category, _kind, name, amount] of lines) {
        db.run(
          `INSERT INTO business_case_line (id, model_id, category, name, annual_amount_krw_m, unit, start_year, growth_rate, note, created_by, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [ulid(), modelId, category, name, amount, "KRW_M", 1, eff.growth,
            `scenario=${ctx.scenario}; delta=${delta.growth}; ${provenance}`, "business-case-generator", nowIso()],
        );
      }
      ctx.modelId = modelId;
      return [
        `### [밸류에이션] valuation-agent — 밸류에이션 모델 (${SCENARIO_LABEL[ctx.scenario]} · ${VARIANT_LABEL[variant]})`,
        "",
        `확정 WACC ${(ctx.inputs.wacc.value * 100).toFixed(1)}%·회수기간 ${horizonOf(ctx.inputs)}년 기준 NPV ${fmtNpvInteger(npv / 100)} 억원,`,
        `성장 ${(eff.growth * 100).toFixed(2)}% (${eff.growthSource}) · sigma ${pct1(eff.disp)} (${eff.dispSource}).`,
        `WACC 출처: ${ctx.inputs.wacc.source}${ctx.inputs.waccScope?.scope === "target" ? " · 대상별 세션" : ""}${ctx.inputs.wacc.run_id ? ` (run ${ctx.inputs.wacc.run_id})` : ""}.`,
        ...(exitEvRevenueOf(ctx.inputs) > 0 && ctx.inputs.revenueAnchor
          ? [`인수 가격: 대상 매출 ${initInv.source.includes("사용자") ? "× 사용자 확정 배수" : "× 컴프 기본 배수"} = ${fmtNpvInteger(initInv.value / 100)} 억원 (${initInv.source}) — 회수 시점 동일 배수로 처분 가정.`]
          : []),
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
      const s5Provenance = s5PlanOf(ctx.inputs);
      // ADR-0174 — the Python engine cannot express a per-year capex schedule
      // (design §12 lists engine support as unverified/out of slice 2), so an
      // s5_plan case runs on the seeded TS fallback; the note stamps both the
      // basis and WHY the engine was bypassed.
      const engineRun = s5Provenance ? null : await runEngineSimulation(jobSpec, ctx.inputs, ctx.scenario, variant);
      const sim: SimulationResult = engineRun?.result ?? runSeededSimulation(ctx.inputs, ctx.scenario, variant);
      const engineMeta: SimEngineMeta = engineRun?.meta ?? { engine: "inline-ts", device: "cpu", precision: "float64" };
      ctx.sim = { result: sim, engine: engineMeta, bepYear: sim.bepYear };
      const flows = deterministicCashflows(ctx.inputs, ctx.scenario, variant);
      const bc = ctx.inputs.bcParams ?? resolveBusinessCaseParamsDefaults();
      const bepFragment = sim.bepYear != null ? `; bep_year=${sim.bepYear.toFixed(2)}` : "";
      // ADR-0179 slice 1 — IRR ceiling review guard. Display metadata only:
      // the fragment is appended ONLY when the guard trips (band non-null) so
      // legacy notes stay byte-identical, and it never blocks generation, a
      // gate or a grade.
      const irrValue = irr(flows);
      const guardBand = irrGuardBand(irrValue, bc.irrFlagThreshold, bc.irrCautionThreshold);
      const irrGuardFragment = guardBand ? `; irr_guard=${guardBand}` : "";
      const waccSubject = ctx.inputs.waccSubject?.subject ?? "promoter";
      const tcFragment = ctx.inputs.targetCostWiring
        ? `; tc_gap_ratio=${ctx.inputs.targetCostWiring.gapRatio.toFixed(4)}; tc_downside_opex_uplift=${(ctx.scenario === "downside" ? ctx.inputs.targetCostWiring.uplift : 1).toFixed(4)}`
        : "";
      // Revenue-anchor provenance: a company-anchored case has no capture
      // rate to stamp — record WHICH revenue anchors it instead (REQ-W5-1
      // reproducibility contract keeps the same note format otherwise).
      // Acquisition-priced cases stamp the entry/exit multiples and the
      // fade-DCF cross-check fragments (machine-readable, UI-parseable).
      const exitMult = exitEvRevenueOf(ctx.inputs);
      const acqFragment = exitMult > 0 ? `; acq_ev=${exitMult.toFixed(2)}x; exit_ev=${exitMult.toFixed(2)}x` : "";
      const xcheck = fadedExitDcf(ctx.inputs, ctx.scenario, variant);
      const xcheckFragment = xcheck
        ? `; xcheck=fade-dcf; xcheck_horizon=${xcheck.horizon}; xcheck_terminal_growth=${xcheck.terminalGrowth.toFixed(4)}; xcheck_fade_npv=${xcheck.npv.toFixed(2)}; xcheck_fade_irr=${xcheck.irr != null ? xcheck.irr.toFixed(4) : "null"}`
        : "";
      // Team-lead slice-2 spec fragment names: basis / s5_model / s5_line_hash /
      // s5_opex_variance (appended only under an s5 basis — ratio notes stay
      // byte-identical).
      const s5OpexVariance = s5Provenance && !s5Provenance.full && !s5Provenance.pnl ? s5OpexCrossCheckVariance(ctx.inputs) : null;
      const basis = ctx.inputs.bcParams?.investmentBasis ?? "ratio";
      const pnlInfo = s5Provenance?.pnl ? s5PnlNoteInfo(ctx.inputs, s5Provenance.plan) : null;
      const basisFragment = s5Provenance
        ? `; basis=${basis}; s5_model=${s5Provenance.plan.modelId}; s5_line_hash=${s5Provenance.plan.lineHash}; s5_skipped=${s5Provenance.plan.skippedLines}${s5Provenance.plan.preLaunchLines ? `; prelaunch_krw_m=${(s5Provenance.plan.preLaunchKrwM ?? 0).toFixed(2)}; prelaunch_lines=${s5Provenance.plan.preLaunchLines}; prelaunch_flag=year-0 은 s5_pnl 기준에서만 반영됨 (현재 기준에서는 연도별 투자에 넣지 않음)` : ""}${s5Provenance.pnl ? `; prelaunch_krw_m=${(s5Provenance.plan.preLaunchKrwM ?? 0).toFixed(2)}${(s5Provenance.plan.preLaunchKrwM ?? 0) === 0 ? "; warning=출시 전 투자 미지정" : ""}; pnl_fallback=${pnlInfo?.fallbackYears ?? 0}/${pnlInfo?.horizon ?? 0}` : ""}${s5Provenance.full ? "; s5_full=1" : ""}; s5_sim=${ctx.inputs.s5Sim?.inputHash ?? "none"}${s5OpexVariance != null ? `; s5_opex_variance=${s5OpexVariance.toFixed(2)}` : ""}${s5Provenance.plan.pinId ? `; s5_pin=${s5Provenance.plan.pinId}; plan_hash=${s5Provenance.plan.planHash}` : ""}`
        : basis === "ratio"
          ? "; basis=ratio"
          : "; basis=ratio; s5_plan_fallback=1 (greenfield_cost 모델 없음 — 비율 경로로 대체)";
      const anchorFragment = ctx.inputs.revenueAnchor
        ? `revenue_anchor=${ctx.inputs.revenueAnchor.source}${acqFragment}${xcheckFragment}`
        : `capture_rate=${bc.captureRate}; capture_source=${bc.captureSource}`;
      const note = `seed=${sim.seed}; iterations=${sim.iterations}; scenario=${ctx.scenario}; growth=${eff.growth.toFixed(4)}; wacc=${ctx.inputs.wacc.value}; wacc_source=${ctx.inputs.wacc.source}; wacc_scope=${ctx.inputs.waccScope?.scope ?? "project"}${ctx.inputs.wacc.run_id ? `; wacc_run=${ctx.inputs.wacc.run_id}` : ""}; wacc_subject=${waccSubject}; ${anchorFragment}; ramp_source=${bc.rampSource}; ${provenance}${tcFragment}${basisFragment}; engine=${engineMeta.engine}${s5Provenance ? " (S8 엔진 우회 — 연도별 capex 스케줄 미지원, ADR-0174)" : ""}; device=${engineMeta.device}; precision=${engineMeta.precision}${bepFragment}${irrGuardFragment}`;
      db.run(`UPDATE business_case_model SET inputs_json = ? WHERE id = ?`, [JSON.stringify(jobSpec), modelId]);
      for (const pct of ["p05", "p50", "p95"] as const) {
        const isP50 = pct === "p50";
        db.run(
          `INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, unit, irr, note, created_at, bep_year, bep_volume, payback_discounted_years)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [ulid(), ctx.inputs.projectId, modelId, ctx.scenario, pct, sim[pct], "KRW_M", isP50 ? irrValue : null, note, nowIso(), isP50 ? sim.bepYear : null, isP50 ? sim.bepVolume : null, isP50 ? sim.bepYear : null],
        );
      }
      return [
        `### [정량 방법론] quant-methodologist — 분포 밸류에이션 (${SCENARIO_LABEL[ctx.scenario]} · ${VARIANT_LABEL[variant]})`,
        "",
        `시드 ${sim.seed}·${sim.iterations}회 몬테카를로 (ADR-0052 §D.4, 결정론적 재현 가능; 엔진 ${engineMeta.engine} · ${engineMeta.device}):`,
        `성장 ${(eff.growth * 100).toFixed(2)}% (${eff.growthSource}) · sigma ${pct1(eff.disp)} (${eff.dispSource}).`,
        `NPV p05 ${fmtNpvInteger(sim.p05 / 100)} / p50 ${fmtNpvInteger(sim.p50 / 100)} / p95 ${fmtNpvInteger(sim.p95 / 100)} 억원,`,
        `분산(표준편차) ${fmtNpvInteger(sim.std)} 백만원 — 지점 추정+서술 각주 금지, 분위수 영속화 완료 (valuation_simulation 3행).`,
        ...(xcheck
          ? [
              `구조 교차검증 (페이드 DCF ${xcheck.horizon}년 — 성장 ${pct1(eff.growth)} → ${pct1(xcheck.terminalGrowth)} 선형 수렴, 동일 배수 처분): NPV ${(xcheck.npv / 100).toFixed(1)} 억원 · IRR ${xcheck.irr != null ? (xcheck.irr * 100).toFixed(1) : "—"}% — 기본 구조 p50 대비 ${xcheck.npv >= sim.p50 ? "+" : ""}${(((xcheck.npv - sim.p50) / Math.abs(sim.p50)) * 100).toFixed(1)}% (두 표준 구조의 일치/괴리가 성장-배수 가정의 일관성 신호).`,
            ]
          : []),
      ].join("\n");
    }
    // scenario_risk_assessment (step 5) — covenant-style downside review for
    // this scenario. The CROSS-scenario comparison + RECOMMENDED flag is
    // recorded once after the chain (see generateBusinessCases). Reuses the
    // distributional_valuation result — the simulation runs once per case.
    return [
      `### [정량 방법론] quant-methodologist — 시나리오 리스크 평가 (${SCENARIO_LABEL[ctx.scenario]} · ${VARIANT_LABEL[variant]})`,
      "",
      `하락 스트레스: p05 NPV ${fmtNpvInteger(((ctx.sim?.result ?? runSeededSimulation(ctx.inputs, ctx.scenario, variant)).p05) / 100)} 억원 기준,`,
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

  // ADR-0178 Amendment 2026-10-16: the pinned reference + unified S5 basis are the DEFAULT for a
  // Green Field project with an importable S5 plan, applied lazily at generation — the initial pin
  // is created when none exists, the stored basis moves to `s5_plan_full` when it is not yet 2,
  // both audited. A person's revert (`bc.s5_source = 0`) is never re-linked; existing cases are
  // never recalculated (only regeneration reflects the new basis); Brown Field is untouched.
  if (project.track === "greenfield" && project.source_opportunity_id) {
    const { ensureDefaultS5Link } = await import("../../../db/repositories/s5-connect.ts");
    ensureDefaultS5Link(db, projectId, opts.actor, new Date().toISOString());
  }

  const subjects = project.track === "brownfield" ? listShortlistSubjects(db, project.source_opportunity_id ?? "") : [];
  // Promotion requires ≥1 shortlisted target (ADR-0095 precondition), so an
  // empty brownfield shortlist here is a data-integrity event, not an empty run.
  if (project.track === "brownfield" && subjects.length === 0) {
    throw new Error(`brownfield project '${projectId}' has no shortlisted target — S7 Short List required before S8 generation`);
  }

  const executor = getBusinessCaseExecutor();
  // 이전 생성 회차 아카이브: 이번 실행이 다시 만들 subject 범위(그린필드는
  // target_id NULL, 브라운필드는 같은 대상)의 미채택·미참조 모델을 실행 시작
  // 시점에 아카이브한다 — 채택/게이트 기록이 가리키는 모델은 그대로 남겨
  // 이력 조회가 계속 풀리도록 한다 (business-case-cleanup 참조 보호 재사용).
  archiveSupersededRound(projectId, opts.actor, {
    targetIds: subjects.length === 0 ? [null] : subjects.map((s) => s.id),
  }, db);
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

/** Classify one simulation note's revenue-anchor provenance — WHICH valuation
 *  basis produced the case. Mixed bases inside ONE comparison table make the
 *  p05 ranking apples-to-oranges (a 몇백억 company-revenue anchor next to a
 *  market-capture fallback), so the read model surfaces the basis per target. */
export function anchorMethodOfNote(note: string | null): "company_revenue" | "market_capture" | null {
  if (!note) return null;
  return /(?:^|;\s*)revenue_anchor=/.test(note) ? "company_revenue" : /(?:^|;\s*)capture_rate=/.test(note) ? "market_capture" : null;
}

/** True when the compared targets' cases come from DIFFERENT valuation bases
 *  (one anchored on company revenue, another on the market-capture fallback). */
export function methodsMixedAcrossTargets(rows: TargetComparisonRow[]): boolean {
  const seen = new Set(rows.map((r) => r.anchorMethod).filter((m): m is "company_revenue" | "market_capture" => m !== null));
  return seen.size > 1;
}

/** |fade-DCF NPV − base p50| / |base p50| above which the RECOMMENDED target
 *  carries a "structure mismatch" warning. Display-only; never re-ranks. */
export const XCHECK_DIVERGENCE_WARN_RATIO = 0.5;
/** Global robotics M&A EV/Revenue screening band (inclusive), same source as
 *  ACQUISITION_EV_REVENUE_DEFAULT. */
export const ACQUISITION_EV_REVENUE_BAND = { min: 2, max: 6 } as const;

export interface CrossCheckOfNote {
  fadeNpv: number | null;
  fadeIrr: number | null;
  acqEvRevenue: number | null;
}

/** Single typed reader of the `xcheck_fade_npv` / `xcheck_fade_irr` / `acq_ev`
 *  note fragments written at generation. Missing, "null" or non-finite values
 *  yield null (never 0). */
export function crossCheckOfNote(note: string | null): CrossCheckOfNote {
  const n = parseSimNote(note);
  return {
    fadeNpv: noteNumber(n.xcheck_fade_npv),
    fadeIrr: noteNumber(n.xcheck_fade_irr),
    acqEvRevenue: noteNumber(n.acq_ev),
  };
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
  /** Valuation basis of those cases (company-revenue anchor vs market-capture
   *  fallback), from the note's anchor provenance. null = no cases. A MIXED
   *  basis across targets invalidates the p05 ranking comparison. */
  anchorMethod: "company_revenue" | "market_capture" | null;
  /** RECOMMENDED flag — the same p05-survival rule as the scenario
   *  recommendation, applied across targets. A PROPOSAL only (boundary #2). */
  recommended: boolean;
  /** Fade-DCF cross-check of the latest base model's p50 note (KRW_M). null = not recorded. */
  xcheckFadeNpv: number | null;
  xcheckFadeIrr: number | null;
  /** (xcheckFadeNpv - baseP50) / |baseP50|, signed. null if either input is null or baseP50 === 0. */
  xcheckDivergence: number | null;
  /** True only on the RECOMMENDED row when |xcheckDivergence| > XCHECK_DIVERGENCE_WARN_RATIO.
   *  Display-only; set after the star is chosen. */
  structureMismatch: boolean;
  /** Assumed entry EV/Revenue multiple (acq_ev). null = not acquisition-priced. */
  acqEvRevenue: number | null;
  /** Computed ONLY against a human-confirmed band; null when none (never the global band). */
  acqEvRevenueInBand: boolean | null;
  acqEvBandSource: "confirmed" | "none";
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
  // Valuation-basis provenance of each latest model (p50 note's anchor
  // fragment) — surfaced per target so a mixed-basis comparison is visible.
  const anchorByModel = new Map<string, "company_revenue" | "market_capture" | null>();
  for (const r of simRows) {
    if (r.percentile === "p50" && !anchorByModel.has(r.model_id)) anchorByModel.set(r.model_id, anchorMethodOfNote(r.note));
  }
  const xcheckByModel = new Map<string, CrossCheckOfNote>();
  for (const r of simRows) {
    if (r.percentile === "p50" && !xcheckByModel.has(r.model_id)) xcheckByModel.set(r.model_id, crossCheckOfNote(r.note));
  }

  const confirmedBand = resolveConfirmedEvBand(db, projectId);
  return flagRecommendedTarget(
    targets.map((t) => {
      const modelId = latest.get(t.id);
      const sim = modelId ? baseByModel.get(modelId) : undefined;
      const xc = modelId ? xcheckByModel.get(modelId) : undefined;
      const p50 = sim?.p50 ?? null;
      const fadeNpv = xc?.fadeNpv ?? null;
      const acq = xc?.acqEvRevenue ?? null;
      return {
        targetId: t.id,
        companyName: t.name,
        rank: ranks.get(t.id) ?? null,
        baseP05: sim?.p05 ?? null,
        baseP50: sim?.p50 ?? null,
        irr: sim?.irr ?? null,
        caseCount: counts.get(t.id) ?? 0,
        engine: modelId ? mergeEngines(engineByModel.get(modelId) ?? []) : null,
        anchorMethod: modelId ? anchorByModel.get(modelId) ?? null : null,
        recommended: false,
        xcheckFadeNpv: fadeNpv,
        xcheckFadeIrr: xc?.fadeIrr ?? null,
        xcheckDivergence: fadeNpv !== null && p50 !== null && p50 !== 0 ? (fadeNpv - p50) / Math.abs(p50) : null,
        structureMismatch: false,
        acqEvRevenue: acq,
        acqEvRevenueInBand: acq === null || !confirmedBand ? null : acq >= confirmedBand.min && acq <= confirmedBand.max,
        acqEvBandSource: confirmedBand ? "confirmed" : "none",
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
    .map((r) =>
      r === best
        ? {
            ...r,
            recommended: true,
            structureMismatch: r.xcheckDivergence != null && Math.abs(r.xcheckDivergence) > XCHECK_DIVERGENCE_WARN_RATIO,
          }
        : { ...r, structureMismatch: false },
    )
    .sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    const p05 = (b.baseP05 ?? -Infinity) - (a.baseP05 ?? -Infinity);
    if (p05 !== 0) return p05;
    return (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER);
  });
}
