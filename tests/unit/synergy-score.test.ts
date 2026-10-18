// Unit tests for the deterministic synergy scoring engine (ADR-0102).
// Pure function — no DB. Covers: factor renormalization, the piecewise
// mature-market curve, fail-closed MIN_FACTORS, and missing-input notes.
import { test, expect, describe } from "bun:test";
import { computeSynergyScore, type ScoreInputs } from "../../app/web-next/lib/synergy-score.ts";

const baseInputs = (over: Partial<ScoreInputs> = {}): ScoreInputs => ({
  opportunity: { market_scope: "휴머노이드 로봇", value_chain_node: null, name: "op" },
  profile: {
    industryExposure: ["반도체", "건설기계"],
    strengths: ["관절 액추에이터"],
    ratios: [{ year: "2025", debtRatio: 0.3, roe: 0.1, operatingMargin: 0.08 }],
  },
  markets: [
    {
      industry: "휴머노이드 로봇",
      cagr: 0.36,
      relatedIndustries: ["정밀 감속기", "서보모터", "AI 반도체"],
    },
  ],
  ...over,
});

describe("computeSynergyScore", () => {
  test("all four factors present → score is the weighted average, factors renormalized", () => {
    const r = computeSynergyScore(baseInputs());
    expect(r.score).not.toBeNull();
    expect(r.method).toBe("rule-based");
    // ADR-0182: 5 factors — capability_coverage is null (absent register) in
    // this fixture, so it is excluded from the weighted sum but still listed.
    expect(r.factors).toHaveLength(5);
    expect(r.factors.find((f) => f.key === "capability_coverage")?.value).toBeNull();
    const wsum = r.factors.filter((f) => f.value !== null).reduce((s, f) => s + f.weight, 0);
    expect(wsum).toBeCloseTo(1, 5);
    // market 0.36 → capped 100; match 1/3→33.3; fin ≈ 69.7; scope 100
    // weighted ≈ 100*.35 + 33.3*.30 + 69.7*.20 + 100*.15 ≈ 78
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.score).toBeLessThanOrEqual(95);
    // capability_coverage absent from this fixture → listed as 미반영
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0]).toContain("필요 역량 레지스터");
  });

  test("piecewise mature-market curve: 5.7% CAGR is NOT flattened to zero", () => {
    const r = computeSynergyScore(baseInputs({
      markets: [{ industry: "유압식 브레이커", cagr: 0.057, relatedIndustries: ["특수강 단조"] }],
    }));
    const mkt = r.factors.find((f) => f.key === "market_attractiveness")!;
    expect(mkt.value).toBeCloseTo((0.057 / 0.08) * 50, 1); // ≈ 35.6
    expect(mkt.value).toBeGreaterThan(30);
  });

  test("capabilityCoverage 0-100 enters as the 5th factor (ADR-0182)", () => {
    const withCov = computeSynergyScore(baseInputs({ capabilityCoverage: 62, capabilityCoverageNote: "보유율 62%" }));
    const cov = withCov.factors.find((f) => f.key === "capability_coverage")!;
    expect(cov.value).toBe(62);
    expect(withCov.missing.join()).not.toContain("필요 역량 레지스터");
    // clamp: >100 degrades to 100
    const capped = computeSynergyScore(baseInputs({ capabilityCoverage: 250 }));
    expect(capped.factors.find((f) => f.key === "capability_coverage")!.value).toBe(100);
  });

  test("curve anchors: 0% → 0, 8% → 50, 35%+ → 100", () => {
    const mk = (cagr: number) => baseInputs({ markets: [{ industry: "X", cagr, relatedIndustries: [] }] });
    expect(computeSynergyScore(mk(0)).factors[0].value).toBe(0);
    expect(computeSynergyScore(mk(0.08)).factors[0].value).toBe(50);
    expect(computeSynergyScore(mk(0.4)).factors[0].value).toBe(100);
  });

  test("the total can never exceed 100 — even with scope_match saturating at 100 (2026-10-18 decider question)", () => {
    // Every usable factor at its ceiling: weights renormalize to sum 1, so the
    // score is a weighted AVERAGE bounded by the max factor value (100), and the
    // engine clamps regardless. With market/scope/capability all at 100 and the
    // other two factors excluded, the score must be exactly 100 — not more.
    const r = computeSynergyScore(baseInputs({
      capabilityCoverage: 100,
      profile: { industryExposure: [], strengths: [], ratios: [] }, // industry·재무 팩터 제외
      markets: [{ industry: "휴머노이드 로봇", cagr: 0.5, relatedIndustries: [] }], // scope 직접 일치 → 100
    }));
    expect(r.factors.filter((f) => f.value !== null).map((f) => f.key).sort()).toEqual(["capability_coverage", "market_attractiveness", "scope_match"]);
    expect(r.factors.filter((f) => f.value !== null).every((f) => f.value === 100)).toBe(true);
    expect(r.score).toBe(100);
    // The renormalized weights the panel displays always sum to exactly 1 —
    // so Σ(기여도) = Σ(점수×가중치) can never cross 100 on screen either.
    const wsum = r.factors.reduce((s, f) => s + f.weight, 0);
    expect(wsum).toBeCloseTo(1, 5);
    expect(Math.round(r.factors.reduce((s, f) => s + (f.value as number) * f.weight, 0))).toBe(r.score);
    // And a mixed case (only 일치도 at 100) stays far below the ceiling.
    const mixed = computeSynergyScore(baseInputs({ capabilityCoverage: 40 }));
    expect(mixed.score).toBeLessThan(100);
    expect(mixed.score).toBe(Math.round(mixed.factors.filter((f) => f.value !== null).reduce((s, f) => s + (f.value as number) * f.weight, 0)));
  });

  test("fail-closed: fewer than 2 usable factors → null score with missing list", () => {
    const r = computeSynergyScore(baseInputs({
      opportunity: { market_scope: null, value_chain_node: null, name: "op" },
      profile: null,
      markets: [],
    }));
    expect(r.score).toBeNull();
    expect(r.missing.length).toBeGreaterThan(0);
  });

  test("missing inputs drop the factor and renormalize weights over the rest", () => {
    const r = computeSynergyScore(baseInputs({ profile: null })); // drops industry match + financial
    expect(r.score).not.toBeNull();
    const usable = r.factors.filter((f) => f.value !== null);
    expect(usable.length).toBe(2);
    const wsum = usable.reduce((s, f) => s + f.weight, 0);
    expect(wsum).toBeCloseTo(1, 5);
    expect(r.missing.some((m) => m.includes("DART"))).toBe(true);
  });

  test("scope match: direct industry-name match scores 100, unrelated scores lower", () => {
    const direct = computeSynergyScore(baseInputs());
    const indirect = computeSynergyScore(baseInputs({
      opportunity: { market_scope: "해운물류", value_chain_node: null, name: "op" },
    }));
    const dScope = direct.factors.find((f) => f.key === "scope_match")!.value!;
    const iScope = indirect.factors.find((f) => f.key === "scope_match")!.value!;
    expect(dScope).toBe(100);
    expect(iScope).toBeLessThan(dScope);
  });

  test("high leverage penalizes financial capacity", () => {
    const strong = computeSynergyScore(baseInputs()).factors.find((f) => f.key === "financial_capacity")!.value!;
    const weak = computeSynergyScore(baseInputs({
      profile: {
        industryExposure: ["반도체"],
        ratios: [{ year: "2025", debtRatio: 1.2, roe: 0.01, operatingMargin: 0.01 }],
      },
    })).factors.find((f) => f.key === "financial_capacity")!.value!;
    expect(weak).toBeLessThan(strong);
  });
});
