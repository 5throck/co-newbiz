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
import { runActivityChain, type ActivitySpec, type EntityRef, type CallAgent } from "./agent-orchestrator.ts";
import { specAgentFor } from "./spec-activities.ts";

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

/** Horizon / discounting constants — deterministic defaults, documented in every persisted note. */
const HORIZON_YEARS = 5;
const WACC = 0.1;
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

/**
 * Seeded Monte Carlo over the value drivers, mirroring python/monte_carlo.py's
 * SimulationResult contract (scripts/co-newbiz/simulate.ts). The driver is
 * annual revenue growth ~ Normal(anchorGrowth*deltaGrowth, 0.02*deltaDisp);
 * each draw builds a full 5-year FCF path (revenue → EBITDA-less opex → capex)
 * and discounts at WACC. Pure function of (inputs, scenario): same seed in,
 * same percentiles out — any persisted figure is reproducible.
 */
export function runSeededSimulation(inputs: CaseInputs, scenario: Scenario): SimulationResult {
  const seed = scenarioSeed(inputs.projectId, scenario);
  const rng = mulberry32(seed);
  const delta = SCENARIO_DELTA[scenario];
  const anchorGrowth = inputs.anchorGrowth * delta.growth;
  const disp = 0.02 * delta.disp;
  const year1Revenue = inputs.marketSizeKrwM * CAPTURE_RATE * delta.growth;

  const npvs: number[] = [];
  const initialInvestment = year1Revenue * INITIAL_INVESTMENT_RATIO;
  for (let it = 0; it < MC_ITERATIONS; it++) {
    let revenue = year1Revenue;
    let npv = -initialInvestment; // year-0 설립 투자
    for (let year = 1; year <= HORIZON_YEARS; year++) {
      if (year > 1) {
        const [z1] = normalPair(rng);
        revenue *= 1 + anchorGrowth + disp * z1;
      }
      const fcf = revenue * (1 - OPEX_RATIO) - revenue * CAPEX_RATIO;
      npv += fcf / Math.pow(1 + WACC, year);
    }
    npvs.push(npv);
  }
  npvs.sort((a, b) => a - b);
  const mean = npvs.reduce((a, b) => a + b, 0) / npvs.length;
  const variance = npvs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / npvs.length;
  const q = (p: number) => npvs[Math.min(npvs.length - 1, Math.max(0, Math.floor(p * npvs.length)))];
  return { seed, iterations: MC_ITERATIONS, p05: q(0.05), p50: q(0.5), p95: q(0.95), mean, std: Math.sqrt(variance) };
}

// ── Case inputs (anchored to the promoting opportunity's market facts) ─────

export interface CaseInputs {
  projectId: string;
  marketSizeKrwM: number;
  anchorGrowth: number;
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
  };
}

function deterministicCashflows(inputs: CaseInputs, scenario: Scenario): number[] {
  const delta = SCENARIO_DELTA[scenario];
  let revenue = inputs.marketSizeKrwM * CAPTURE_RATE * delta.growth;
  const initialInvestment = revenue * INITIAL_INVESTMENT_RATIO;
  const flows: number[] = [-initialInvestment]; // year-0 설립 투자
  for (let year = 1; year <= HORIZON_YEARS; year++) {
    if (year > 1) revenue *= 1 + inputs.anchorGrowth * delta.growth;
    flows.push(revenue * (1 - OPEX_RATIO) - revenue * CAPEX_RATIO);
  }
  return flows;
}

// ── Executor seam (Phase 2 pattern, lib/committee-agents.ts) ────────────────

export interface StepContext {
  scenario: Scenario;
  inputs: CaseInputs;
  /** Set once the valuation_model step has persisted the model for this scenario. */
  modelId?: string;
}

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

/** Deterministic default — role-templated output, seeded computation, real rows. */
function defaultExecutor(): BusinessCaseStepExecutor {
  return async (step, ctx) => {
    const db = getDb();
    const delta = SCENARIO_DELTA[ctx.scenario];
    if (step === "growth_projection") {
      return [
        `### [재무 분석] financial-analyst — 성장 전망 (${SCENARIO_LABEL[ctx.scenario]})`,
        "",
        `앵커 시장규모 ${ctx.inputs.marketSizeKrwM} 억원(KRW m), 기준 성장률 ${(ctx.inputs.anchorGrowth * 100).toFixed(2)}%에`,
        `시나리오 계수 ×${delta.growth}를 적용한 성장 전망: ${(ctx.inputs.anchorGrowth * delta.growth * 100).toFixed(2)}%/년,`,
        `1차년도 매출은 시장 점유율 ${CAPTURE_RATE * 100}% 가정으로 ${(ctx.inputs.marketSizeKrwM * CAPTURE_RATE * delta.growth).toFixed(1)} 억원.`,
        `베이스레이트 점검: 산업 성장률 대비 ±20% 밴드 내 (greenfield-fs step 1).`,
      ].join("\n");
    }
    if (step === "valuation_model") {
      const modelId = ulid();
      const flows = deterministicCashflows(ctx.inputs, ctx.scenario);
      const npv = flows.reduce((acc, cf, i) => acc + cf / Math.pow(1 + WACC, i), 0); // flows[0]=year-0
      db.run(
        `INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,?,?,?,?,?)`,
        [modelId, ctx.inputs.projectId, "valuation", `S8 자동 생성 — ${ctx.scenario}`, HORIZON_YEARS, "business-case-generator", nowIso()],
      );
      const year1Revenue = ctx.inputs.marketSizeKrwM * CAPTURE_RATE * delta.growth;
      const lines: Array<[string, "revenue" | "opex" | "capex", string, number]> = [
        ["revenue", "revenue", "시나리오 매출 (year-1 앵커)", year1Revenue],
        ["opex", "opex", "운영비 (매출의 60%)", year1Revenue * OPEX_RATIO],
        ["capex", "capex", "설비 투자 (year-1, 매출의 10%)", year1Revenue * CAPEX_RATIO],
      ];
      for (const [category, _kind, name, amount] of lines) {
        db.run(
          `INSERT INTO business_case_line (id, model_id, category, name, annual_amount_krw_m, start_year, growth_rate, note, created_by, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [ulid(), modelId, category, name, amount, 1, ctx.inputs.anchorGrowth * delta.growth,
            `scenario=${ctx.scenario}; delta=${delta.growth}`, "business-case-generator", nowIso()],
        );
      }
      ctx.modelId = modelId;
      return [
        `### [밸류에이션] valuation-agent — 밸류에이션 모델 (${SCENARIO_LABEL[ctx.scenario]})`,
        "",
        `확정 WACC ${(WACC * 100).toFixed(1)}%·회수기간 ${HORIZON_YEARS}년 기준 NPV ${npv.toFixed(1)} 억원,`,
        `IRR ${((irr(flows) ?? 0) * 100).toFixed(1)}% (greenfield-fs step 3). 모델/라인 3건 영속화 (model ${modelId}).`,
      ].join("\n");
    }
    if (step === "distributional_valuation") {
      const modelId = ctx.modelId;
      if (!modelId) throw new Error("distributional_valuation requires valuation_model to have persisted the model");
      const sim = runSeededSimulation(ctx.inputs, ctx.scenario);
      const flows = deterministicCashflows(ctx.inputs, ctx.scenario);
      const note = `seed=${sim.seed}; iterations=${sim.iterations}; scenario=${ctx.scenario}; growth=${(ctx.inputs.anchorGrowth * delta.growth).toFixed(4)}; wacc=${WACC}`;
      for (const pct of ["p05", "p50", "p95"] as const) {
        db.run(
          `INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, note, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [ulid(), ctx.inputs.projectId, modelId, ctx.scenario, pct, sim[pct], pct === "p50" ? irr(flows) : null, note, nowIso()],
        );
      }
      return [
        `### [정량 방법론] quant-methodologist — 분포 밸류에이션 (${SCENARIO_LABEL[ctx.scenario]})`,
        "",
        `시드 ${sim.seed}·${sim.iterations}회 몬테카를로 (ADR-0052 §D.4, 결정론적 재현 가능):`,
        `NPV p05 ${sim.p05.toFixed(1)} / p50 ${sim.p50.toFixed(1)} / p95 ${sim.p95.toFixed(1)} 억원,`,
        `분산(표준편차) ${sim.std.toFixed(1)} — 지점 추정+서술 각주 금지, 분위수 영속화 완료 (valuation_simulation 3행).`,
      ].join("\n");
    }
    // scenario_risk_assessment (step 5) — covenant-style downside review for
    // this scenario. The CROSS-scenario comparison + RECOMMENDED flag is
    // recorded once after the chain (see generateBusinessCases).
    return [
      `### [정량 방법론] quant-methodologist — 시나리오 리스크 평가 (${SCENARIO_LABEL[ctx.scenario]})`,
      "",
      `하락 스트레스: p05 NPV ${runSeededSimulation(ctx.inputs, ctx.scenario).p05.toFixed(1)} 억원 기준,`,
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

  const activities: ActivitySpec[] = [];
  for (const scenario of SCENARIOS) {
    const ctx: StepContext = { scenario, inputs };
    for (const step of ["growth_projection", "valuation_model", "distributional_valuation", "scenario_risk_assessment"] as BusinessCaseStep[]) {
      const agentKey = businessCaseAgentFor(step);
      activities.push({
        activityId: `${scenario}:${step}`,
        agentKey,
        prompt: `${step} — ${scenario} scenario for project ${projectId}`,
        execute: async () => executor(step, ctx),
      });
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
  const rows = getDb()
    .query(
      `SELECT scenario, npv_krw_m FROM valuation_simulation WHERE project_id = ? AND percentile = 'p05'`,
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
