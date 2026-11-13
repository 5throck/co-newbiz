/**
 * Unit tests for the calibration sweep math (design
 * 2026-09-19-sim-engine-runtime-separation §2·§4; goal-line unification design
 * 2026-11-13-calibration-loop-convergence §3.1): seeded determinism, quantile
 * sanity, the plausibility filter (v1 correlation approximation), the band
 * Monte Carlo percentiles, and the unified convergence goal-line constant.
 */

import { test, expect, describe } from "bun:test";

const { mulberry32, triangularSample, sweepCombinations, bandMonteCarlo, rankExclusionCandidates } = await import(
  "../../app/web-next/lib/calibration-sweep.ts"
);
const { CONVERGENCE_GOAL_PCT } = await import("../../app/web-next/lib/market-reference-staleness.ts");

describe("seeded RNG + triangular sampling", () => {
  test("mulberry32 is deterministic per seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(43)()).not.toBe(mulberry32(42)());
  });

  test("triangularSample stays within [max(0, mode-spread), mode+spread]", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 2000; i++) {
      const v = triangularSample(rng, 8, 4); // [4, 12]
      expect(v).toBeGreaterThanOrEqual(4 - 1e-9);
      expect(v).toBeLessThanOrEqual(12 + 1e-9);
    }
  });
});

describe("sweepCombinations (reverse-feasibility view)", () => {
  test("seeded runs are deterministic", () => {
    const input = {
      ourCagrPct: 17.5,
      externalCagrPct: 26.3,
      drivers: [{ driver: "d1", direction: "upside" as const, impact_pct: 6 }],
      sampleCount: 2000,
      seed: 11,
    };
    const r1 = sweepCombinations(input);
    const r2 = sweepCombinations(input);
    expect([r1.p10_gap_pct, r1.p50_gap_pct, r1.p90_gap_pct]).toEqual([r2.p10_gap_pct, r2.p50_gap_pct, r2.p90_gap_pct]);
    expect(r1.seed).toBe(11);
  });

  test("plausibility filter drops combos whose summed impact exceeds 2x the needed uplift", () => {
    // 필요 상향 = |15 − 20| = 5%p → 개연성 상한 10%p. 드라이버 점 합 14%p
    // (±50% 삼각 표집 범위 7~21%p)라면 상당수 조합이 10%p를 초과 → 제외율 > 0.
    const r = sweepCombinations({
      ourCagrPct: 15,
      externalCagrPct: 20,
      drivers: [
        { driver: "d1", direction: "upside", impact_pct: 8 },
        { driver: "d2", direction: "upside", impact_pct: 6 },
      ],
      sampleCount: 5000,
      seed: 3,
    });
    expect(r.plausible_ratio).toBeLessThan(1);
    expect(r.plausible_ratio).toBeGreaterThan(0);
    expect(r.needed_uplift_pct).toBe(5);
  });

  test("more drivers pushing toward the reference lower the median gap", () => {
    const weak = sweepCombinations({
      ourCagrPct: 10,
      externalCagrPct: 20,
      drivers: [{ driver: "a", direction: "upside", impact_pct: 2 }],
      sampleCount: 3000,
      seed: 5,
    });
    const strong = sweepCombinations({
      ourCagrPct: 10,
      externalCagrPct: 20,
      drivers: [
        { driver: "a", direction: "upside", impact_pct: 2 },
        { driver: "b", direction: "upside", impact_pct: 4 },
      ],
      sampleCount: 3000,
      seed: 5,
    });
    expect(strong.p50_gap_pct).toBeLessThan(weak.p50_gap_pct);
  });
});

describe("band Monte Carlo (P10/P50/P90)", () => {
  test("percentiles respect the down/up band ordering", () => {
    const r = bandMonteCarlo({
      cells: [
        { base2026: 5, downCagr: 0.03, baseCagr: 0.1, upCagr: 0.2 },
        { base2026: 3, downCagr: 0.02, baseCagr: 0.08, upCagr: 0.18 },
      ],
      targetYear: 2030,
      samples: 5000,
      seed: 9,
    });
    expect(r.p10_size_b).toBeLessThan(r.p50_size_b);
    expect(r.p50_size_b).toBeLessThan(r.p90_size_b);
    expect(r.samples).toBe(5000);
  });
});

describe("convergence goal-line constant", () => {
  test("목표선은 15%다 — 스윕·트리거·CTA 게이트가 한 줄을 공유한다 (사용자 결정 2026-11-13)", () => {
    expect(CONVERGENCE_GOAL_PCT).toBe(15);
  });
});

// Amendment 2026-11-13b — leave-one-out exclusion ranking: a pure function (no
// db writes, no LLM calls) that re-runs the seeded sweep once per driver.
describe("rankExclusionCandidates — leave-one-out 제외 후보 순위 (amendment 2026-11-13b)", () => {
  // 우리 5% vs 참조 10% → 필요 상향 45%p. 과대 드라이버(45%p ±50%)가 들어 있으면
  // 조합 합이 필요치 부근을 크게 넘어 목표선(15%) 도달이 불가능하고, 소폭
  // 드라이버(5%p)만 남으면 일부 조합이 도달한다 — 개선 원인은 과대 드라이버다.
  const drivers = [
    { driver: "과대 상승 가정", direction: "upside" as const, impact_pct: 45 },
    { driver: "소폭 수요 상승", direction: "upside" as const, impact_pct: 5 },
  ];

  test("동일 입력 → 동일 순위·수치(결정론 — AC 13의 스윕 확장)", () => {
    const a = rankExclusionCandidates({ ourCagrPct: 5, externalCagrPct: 10, drivers, sampleCount: 5000, seed: 21 });
    const b = rankExclusionCandidates({ ourCagrPct: 5, externalCagrPct: 10, drivers, sampleCount: 5000, seed: 21 });
    expect(a.ranked).toEqual(b.ranked);
    expect(a.baselineFeasibleRatio).toBe(b.baselineFeasibleRatio);
    expect(a.sampleCount).toBe(b.sampleCount);
  });

  test("제외로 feasible_ratio가 개선되는 드라이버가 1위다 — 전체 기준비율과 개선폭이 함께 나온다", () => {
    const { baselineFeasibleRatio, ranked } = rankExclusionCandidates({
      ourCagrPct: 5,
      externalCagrPct: 10,
      drivers,
      sampleCount: 5000,
      seed: 21,
    });
    expect(baselineFeasibleRatio).toBe(0);
    expect(ranked[0].driver).toBe("과대 상승 가정");
    expect(ranked[0].improvementPct).toBeGreaterThan(0);
    expect(ranked[0].feasibleRatioWithout).toBeGreaterThan(0);
    // 소폭 드라이버를 빼도(과대만 남음) 수렴 가능 조합은 그대로 0 — 개선 없음.
    expect(ranked[1].driver).toBe("소폭 수요 상승");
    expect(ranked[1].improvementPct).toBeLessThanOrEqual(0);
    expect(ranked[1].feasibleRatioWithout).toBe(0);
  });

  test("드라이버가 하나뿐이면 제외 실행은 드라이버 없는 스윕이 되고 개선은 0 이하다", () => {
    const { ranked } = rankExclusionCandidates({
      ourCagrPct: 5,
      externalCagrPct: 10,
      drivers: [drivers[0]],
      sampleCount: 2000,
      seed: 21,
    });
    expect(ranked.length).toBe(1);
    expect(ranked[0].improvementPct).toBeLessThanOrEqual(0);
  });
});
