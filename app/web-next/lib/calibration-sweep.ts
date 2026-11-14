// calibration-sweep.ts — 수용된 드라이버 impact 조합의 확률론적 탐색 (design
// 2026-09-19-sim-engine-runtime-separation §2·§4, v1 규칙). 목적은 역산
// feasibility 뷔다: "외부 참조에 도달하려면 어떤 조합이 필요한가, 그중 믿을
// 만한 조합이 존재하는가." 참조에 추정을 맞추는 것이 아니다 — 참조는 틀릴 수
// 있고 기관 간 분산 자체가 입력 불확실성이다.
//
// v1 규칙(design §2):
//  - 표집 분포: 점 추정의 ±50% 삼각분포(하한 0). spread_pct(선택)가 있으면
//    폭을 대체한다.
//  - 상관: v1은 개연성 필터로 근사 — 합산 impact가 필요 상향의 2배를 초과하는
//    조합은 개연성 밖으로 제외한다. 상관행렬은 후속 버전.
//  - 결정론: seed 고정 시 동일 입력 → 동일 분위수(테스트 요구).
import type { getDb } from "../../../db/client.ts";

type Db = ReturnType<typeof getDb>;
import { appendAudit } from "../../../db/lib/access-control.ts";
import { CONVERGENCE_GOAL_PCT } from "./market-reference-staleness.ts";

/** 스윕 판정선 — 수렴 목표선 한 줄로 통일되었다(design
 * 2026-11-13-calibration-loop-convergence §3.1·§3.2): 격차 < 목표선이면 수렴.
 * feasible_ratio는 "수용 드라이버 조합이 목표선 이내로 도달 가능한가"의
 * 확률이다 — 스윕은 루프의 계획 도구이지 산출치를 바꾸지 않는다. */

/** 개연성 상한 배수 — v1 상관 근사: 합산 impact가 필요 상향의 이 배수를 초과하는
 *  조합은 개연성 밖(sweepCombinations v1 규칙, design 2026-09-19-sim-engine-
 *  runtime-separation §2). 과잉 신호(buildOvershootSignal, design
 *  2026-11-14-driver-proposal-dedupe-overshoot D-C)가 같은 상수를 쓴다 — 두
 *  곳에서 2×가 갈라지면 신호가 스윕과 어긋난다. */
export const PLAUSIBILITY_CAP_MULTIPLE = 2;

/** mulberry32 — 작고 빠른 시드 기반 PRNG. 결정론 요구사항용(암호학적 아님). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 삼각분포 표본(CDF 역변환) — 모드=점 추정, 하한=max(0, 점±spread의 절반
 *  방향), 상한=점±spread. 기본 규칙: 점 추정의 ±50% 삼각분포(하한 0 보장). */
export function triangularSample(rng: () => number, modePct: number, spreadPct?: number): number {
  const spread = spreadPct ?? modePct * 0.5;
  const low = Math.max(0, modePct - spread);
  const high = modePct + spread;
  const u = rng();
  const fc = modePct > 0 ? (modePct - low) / (high - low || 1) : 0.5;
  if (u < fc) {
    return low + Math.sqrt(u * (high - low) * (modePct - low || (high - low) / 2));
  }
  const denom = high - low || 1;
  return high - Math.sqrt((1 - u) * denom * (high - modePct || denom / 2));
}

export interface SweepDriverInput {
  driver: string;
  /** 방향 — upside는 우리 CAGR을 끌어올리는 요인이다. */
  direction: "upside" | "downside";
  impact_pct: number;
  spread_pct?: number | null;
}

export interface SweepSummary {
  needed_uplift_pct: number;
  sample_count: number;
  plausible_ratio: number;
  p10_gap_pct: number;
  p50_gap_pct: number;
  p90_gap_pct: number;
  feasible_ratio: number;
  per_driver_quantiles: Array<{ driver: string; p10: number; p50: number; p90: number }>;
  device: "cpu";
  seed: number;
}

export interface SweepResultView extends SweepSummary {
  /** 역산 해석 — 참조 도달 조합이 존재하는가(비율), 그 조합은 무엇인가. */
  verdict: "feasible" | "infeasible";
  message: string;
}

function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const t = pos - lo;
  return Math.round(((sortedAsc[lo] ?? 0) * (1 - t) + (sortedAsc[hi] ?? 0) * t) * 100) / 10;
}

/** 역산 feasibility 스윕 — 순수 함수(seed 고정 시 결정론).
 *  - 각 표본: 드라이버별 삼각분포 표본을 방향부 합산 → 보정 후 우리 CAGR
 *  - 격차: |보정 후 CAGR − 외부 참조| / 외부 참조 × 100
 *  - 개연성 필터: 방향부 합산 impact가 필요 상향(외부와의 차이)의 2배 초과
 *    조합은 제외한다(제외율은 결과에 보존 — 관측 대상). */
export function sweepCombinations(input: {
  ourCagrPct: number;
  externalCagrPct: number;
  drivers: SweepDriverInput[];
  sampleCount?: number;
  seed?: number;
}): SweepSummary & { combos: Array<{ totalImpact: number; gapPct: number }> } {
  const sampleCount = Math.max(100, Math.min(input.sampleCount ?? 20000, 200000));
  const seed = input.seed ?? 20260919;
  const rng = mulberry32(seed);
  const ext = input.externalCagrPct;
  const dirSign = input.ourCagrPct <= ext ? 1 : -1; // 우리가 낮으면 드라이버는 상승 방향
  const needed = Math.abs(ext - input.ourCagrPct);
  const plausibilityCap = needed * PLAUSIBILITY_CAP_MULTIPLE;

  const gaps: number[] = [];
  const perDriverSamples = input.drivers.map(() => [] as number[]);
  let plausible = 0;

  for (let s = 0; s < sampleCount; s++) {
    let total = 0;
    let keep = true;
    for (let d = 0; d < input.drivers.length; d++) {
      const drv = input.drivers[d];
      const sample = triangularSample(rng, drv.impact_pct, drv.spread_pct ?? undefined);
      perDriverSamples[d].push(sample);
      total += sample;
      if (!Number.isFinite(sample)) keep = false;
    }
    if (keep && total > plausibilityCap) keep = false; // 개연성 필터(v1)
    if (!keep) continue;
    plausible += 1;
    const calibrated = input.ourCagrPct + dirSign * total;
    gaps.push(Math.round((Math.abs(calibrated - ext) / ext) * 1000) / 10);
  }

  const gapsAsc = [...gaps].sort((a, b) => a - b);
  const perDriverQuantiles = input.drivers.map((d, i) => {
    const asc = [...perDriverSamples[i]].sort((a, b) => a - b);
    return { driver: d.driver, p10: quantile(asc, 0.1), p50: quantile(asc, 0.5), p90: quantile(asc, 0.9) };
  });

  const p10 = quantile(gapsAsc, 0.1);
  const p50 = quantile(gapsAsc, 0.5);
  const p90 = quantile(gapsAsc, 0.9);
  const feasibleRatio = gapsAsc.length
    ? Math.round((gapsAsc.filter((g) => g <= CONVERGENCE_GOAL_PCT).length / gapsAsc.length) * 1000) / 1000
    : 0;

  return {
    needed_uplift_pct: Math.round(needed * 10) / 10,
    sample_count: gapsAsc.length,
    plausible_ratio: Math.round((plausible / sampleCount) * 1000) / 1000,
    p10_gap_pct: p10,
    p50_gap_pct: p50,
    p90_gap_pct: p90,
    feasible_ratio: feasibleRatio,
    per_driver_quantiles: perDriverQuantiles,
    device: "cpu",
    seed,
    combos: gapsAsc.map((g) => ({ totalImpact: 0, gapPct: g })),
  };
}

/** leave-one-out 제외 후보 순위 (amendment 2026-11-13b) — 수용 드라이버를 하나
 *  씩 빼고 sweepCombinations를 다시 돌려(순수 함수, LLM 호출 없음) feasible_
 *  ratio가 얼마나 개선되는지 재비교한다. 개선(%)이 큰 드라이버일수록 "격차
 *  악화의 원인"일 가능성이 높다. 동일 seed로 전체·제외 실행을 짝지어 비교하므
 *  로 같은 입력 → 같은 순위(결정론). 파이프라인은 최상위 후보만 제외 제안으로
 *  만들고, 실제 제외는 사람의 기각 확정으로 적용된다(경계 #2). */
export interface ExclusionCandidate {
  driver: string;
  direction: "upside" | "downside";
  impact_pct: number;
  /** 이 드라이버를 뺐을 때의 feasible_ratio (0..1). */
  feasibleRatioWithout: number;
  /** 개선폭(%p) = (제외 시 feasible_ratio − 전체 feasible_ratio) × 100. */
  improvementPct: number;
}

export function rankExclusionCandidates(input: {
  ourCagrPct: number;
  externalCagrPct: number;
  drivers: SweepDriverInput[];
  sampleCount?: number;
  seed?: number;
}): { baselineFeasibleRatio: number; sampleCount: number; ranked: ExclusionCandidate[] } {
  const base = sweepCombinations({
    ourCagrPct: input.ourCagrPct,
    externalCagrPct: input.externalCagrPct,
    drivers: input.drivers,
    sampleCount: input.sampleCount,
    seed: input.seed,
  });
  const ranked = input.drivers
    .map((d) => {
      const without = sweepCombinations({
        ourCagrPct: input.ourCagrPct,
        externalCagrPct: input.externalCagrPct,
        drivers: input.drivers.filter((x) => x !== d),
        sampleCount: input.sampleCount,
        seed: input.seed,
      });
      return {
        driver: d.driver,
        direction: d.direction,
        impact_pct: d.impact_pct,
        feasibleRatioWithout: without.feasible_ratio,
        improvementPct: Math.round((without.feasible_ratio - base.feasible_ratio) * 1000) / 10,
      };
    })
    .sort((a, b) => b.improvementPct - a.improvementPct);
  return { baselineFeasibleRatio: base.feasible_ratio, sampleCount: base.sample_count, ranked };
}

/** 정직한 과잉 신호 (design 2026-11-14-driver-proposal-dedupe-overshoot D-C) —
 *  수용 드라이버 impact 합이 앵커 필요 상향의 개연성 상한(PLAUSIBILITY_CAP_
 *  MULTIPLE 배)을 넘으면 스윕의 feasible_ratio가 0으로 붕괴해 루프가 답을 내지
 *  못한다. 신호는 매트릭스에만 실리고 제외 결정은 사람이 한다(경계 #2 — 자동
 *  제거 없음). CAGR 참조가 없으면 null — 규모 기준 격차에는 CAGR 과잉이 정의되지
 *  않는다. feasibleRatio는 실행 시작 스윕(runCalibrationSweep)의 값 — 스윕이 안
 *  돌았으면 null(날조하지 않는다). */
export interface OvershootSignal {
  acceptedImpactSumPct: number;
  neededUpliftPct: number;
  plausibleCapPct: number;
  feasibleRatio: number | null;
  overshoot: boolean;
}

export function buildOvershootSignal(input: {
  ourCagrPct: number;
  externalCagrPct: number;
  acceptedImpacts: number[];
  runStartFeasibleRatio?: number | null;
}): OvershootSignal | null {
  if (!(input.externalCagrPct > 0)) return null;
  const acceptedImpactSumPct = Math.round(input.acceptedImpacts.reduce((a, v) => a + v, 0) * 10) / 10;
  const neededUpliftPct = Math.round(Math.abs(input.externalCagrPct - input.ourCagrPct) * 10) / 10;
  const plausibleCapPct = Math.round(neededUpliftPct * PLAUSIBILITY_CAP_MULTIPLE * 10) / 10;
  return {
    acceptedImpactSumPct,
    neededUpliftPct,
    plausibleCapPct,
    feasibleRatio: input.runStartFeasibleRatio ?? null,
    overshoot: acceptedImpactSumPct > plausibleCapPct,
  };
}

/** 제외 트리거 분기 (design 2026-11-14-driver-proposal-dedupe-overshoot D-D) —
 *  두 팔: (1) 기존 악화 팔(amendment 2026-11-13b) — 격차가 소음 밴드를 초과해
 *  악화; (2) 신규 과잉 팔 — 수용 집합이 과잉(overshoot)이고 실행 시작 스윕의
 *  feasible_ratio가 0이며, 최상위 제거 후보가 유의미한 개선(> 0)을 보이는
 *  단일 원인 cases만 제안한다. 모든 제거 후에도 0이면(다중 원인) 제안 없음 —
 *  그 빈 구멍은 과잉 신호(matrix.calibration.overshoot)가 메운다. 악화 팔이
 *  우선한다(기존 동작 불변 — 개선 > 0 조건은 호출점이 그대로 유지한다). */
export type ExclusionArm = "worsening" | "overshoot";

export function selectExclusionArm(input: {
  worsening: boolean;
  overshoot: boolean;
  baselineFeasibleRatio: number;
  topImprovementPct: number | null;
}): ExclusionArm | null {
  if (!input.worsening && !input.overshoot) return null;
  if (input.worsening) return "worsening";
  return input.baselineFeasibleRatio === 0 && (input.topImprovementPct ?? 0) > 0 ? "overshoot" : null;
}

export interface BandMonteCarloResult {
  samples: number;
  p10_size_b: number;
  p50_size_b: number;
  p90_size_b: number;
}

/** CAGR 밴드 몬테카를로 — 각 셀의 밴드(down/base/up)를 균등 표집해 2030년
 *  규모 분포의 P10/P50/P90을 산출한다(확장 단계에서 device 런타임으로 이동
 *  가능 — v1은 CPU numpy 규모). 순수 함수, seed 고정 시 결정론. */
export function bandMonteCarlo(input: {
  cells: Array<{ base2026: number; downCagr: number; baseCagr: number; upCagr: number }>;
  targetYear?: number;
  samples?: number;
  seed?: number;
}): BandMonteCarloResult {
  const samples = Math.max(1000, Math.min(input.samples ?? 20000, 200000));
  const rng = mulberry32((input.seed ?? 20260919) >>> 0);
  const years = Math.max(1, (input.targetYear ?? 2030) - 2026);
  const totals: number[] = [];
  for (let s = 0; s < samples; s++) {
    let total = 0;
    for (const cell of input.cells) {
      const u = rng();
      const cagr =
        u < 0.5
          ? cell.downCagr + (cell.baseCagr - cell.downCagr) * (u * 2)
          : cell.baseCagr + (cell.upCagr - cell.baseCagr) * ((u - 0.5) * 2);
      total += cell.base2026 * (1 + cagr) ** years;
    }
    totals.push(total);
  }
  totals.sort((a, b) => a - b);
  const q = (p: number) => Math.round(totals[Math.floor(p * (totals.length - 1))] * 100) / 100;
  return { samples, p10_size_b: q(0.1), p50_size_b: q(0.5), p90_size_b: q(0.9) };
}

export interface CalibrationSweepView extends SweepSummary {
  verdict: SweepResultView["verdict"];
  message: string;
  our_cagr_pct: number;
  external_cagr_pct: number;
  external_source: string | null;
  convergence_target_pct: number;
}

/** 산업 1개의 스윕을 실행하고 요약을 저장한다(원시 표본 미저장 — §4 계약). */
export function runCalibrationSweep(
  db: Db,
  input: {
    industryId: string;
    ourCagrPct: number;
    externalCagrPct: number;
    externalSourceLabel: string | null;
    drivers: SweepDriverInput[];
    sampleCount?: number;
    seed?: number;
    createdBy: string;
  },
): CalibrationSweepView {
  const summary = sweepCombinations({
    ourCagrPct: input.ourCagrPct,
    externalCagrPct: input.externalCagrPct,
    drivers: input.drivers,
    sampleCount: input.sampleCount,
    seed: input.seed,
  });
  const versionNo =
    (
      db
        .query(
          "SELECT MAX(version_no) m FROM market_sizing_version v JOIN market_sizing_analysis a ON a.id = v.analysis_id WHERE a.industry_id = ?",
        )
        .get(input.industryId) as { m: number | null }
    )?.m ?? 0;
  const id = `csr-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO calibration_sweep_result (id, industry_id, version_no, needed_uplift_pct, sample_count, plausible_ratio, p10_gap_pct, p50_gap_pct, p90_gap_pct, feasible_ratio, per_driver_quantiles_json, device, seed, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      input.industryId,
      versionNo,
      summary.needed_uplift_pct,
      summary.sample_count,
      summary.plausible_ratio,
      summary.p10_gap_pct,
      summary.p50_gap_pct,
      summary.p90_gap_pct,
      summary.feasible_ratio,
      JSON.stringify(summary.per_driver_quantiles),
      summary.device,
      summary.seed,
      input.createdBy,
      now,
    ],
  );
  appendAudit(db, { actor: input.createdBy, action: "market_calibration.sweep", target: input.industryId, now });
  const verdict: "feasible" | "infeasible" = summary.feasible_ratio >= 0.05 ? "feasible" : "infeasible";
  return {
    ...summary,
    verdict,
    message:
      verdict === "feasible"
        ? `수용 드라이버 조합 중 ${Math.round(summary.feasible_ratio * 100)}%가 목표선(${CONVERGENCE_GOAL_PCT}%) 이내로 수렴 가능합니다 — 다음 재분석 제약으로 반영할 조합을 검토하세요.`
        : `수용 드라이버 조합만으로는 목표선 도달이 어렵습니다 — 제안 추가·참조 재검토를 검토하세요.`,
    our_cagr_pct: input.ourCagrPct,
    external_cagr_pct: input.externalCagrPct,
    external_source: input.externalSourceLabel,
    convergence_target_pct: CONVERGENCE_GOAL_PCT,
  };
}

export function latestSweep(db: Db, industryId: string): (SweepResultView & { id: string }) | null {
  return (
    (db
      .query("SELECT * FROM calibration_sweep_result WHERE industry_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(industryId) as (SweepResultView & { id: string }) | undefined) ?? null
  );
}
