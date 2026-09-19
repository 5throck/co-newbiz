/**
 * Unit tests for the calibration sweep math (design
 * 2026-09-19-sim-engine-runtime-separation §2·§4): seeded determinism,
 * quantile sanity, the plausibility filter (v1 correlation approximation),
 * the band Monte Carlo percentiles, and the convergence target constant.
 */

import { test, expect, describe } from "bun:test";

const { mulberry32, triangularSample, sweepCombinations, bandMonteCarlo, CONVERGENCE_TARGET_PCT } =
  await import("../../app/web-next/lib/calibration-sweep.ts");

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
    const input = { ourCagrPct: 17.5, externalCagrPct: 26.3, drivers: [{ driver: 'd1', direction: 'upside' as const, impact_pct: 6 }], sampleCount: 2000, seed: 11 };
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
    const weak = sweepCombinations({ ourCagrPct: 10, externalCagrPct: 20, drivers: [{ driver: "a", direction: "upside", impact_pct: 2 }], sampleCount: 3000, seed: 5 });
    const strong = sweepCombinations({ ourCagrPct: 10, externalCagrPct: 20, drivers: [{ driver: "a", direction: "upside", impact_pct: 2 }, { driver: "b", direction: "upside", impact_pct: 4 }], sampleCount: 3000, seed: 5 });
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

describe("convergence target constant", () => {
  test("판정선은 15%다 (사용자 조정 2026-09-19)", () => {
    expect(CONVERGENCE_TARGET_PCT).toBe(15);
  });
});
