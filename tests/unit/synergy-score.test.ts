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
    expect(r.factors).toHaveLength(4);
    const wsum = r.factors.filter((f) => f.value !== null).reduce((s, f) => s + f.weight, 0);
    expect(wsum).toBeCloseTo(1, 5);
    // market 0.36 → capped 100; match 1/3→33.3; fin ≈ 69.7; scope 100
    // weighted ≈ 100*.35 + 33.3*.30 + 69.7*.20 + 100*.15 ≈ 78
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.score).toBeLessThanOrEqual(95);
    expect(r.missing).toHaveLength(0);
  });

  test("piecewise mature-market curve: 5.7% CAGR is NOT flattened to zero", () => {
    const r = computeSynergyScore(baseInputs({
      markets: [{ industry: "유압식 브레이커", cagr: 0.057, relatedIndustries: ["특수강 단조"] }],
    }));
    const mkt = r.factors.find((f) => f.key === "market_attractiveness")!;
    expect(mkt.value).toBeCloseTo((0.057 / 0.08) * 50, 1); // ≈ 35.6
    expect(mkt.value).toBeGreaterThan(30);
  });

  test("curve anchors: 0% → 0, 8% → 50, 35%+ → 100", () => {
    const mk = (cagr: number) => baseInputs({ markets: [{ industry: "X", cagr, relatedIndustries: [] }] });
    expect(computeSynergyScore(mk(0)).factors[0].value).toBe(0);
    expect(computeSynergyScore(mk(0.08)).factors[0].value).toBe(50);
    expect(computeSynergyScore(mk(0.4)).factors[0].value).toBe(100);
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
