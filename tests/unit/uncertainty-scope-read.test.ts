import { describe, expect, test } from "bun:test";
import { uncertaintyScopeForCase } from "../../app/web-next/lib/uncertainty-scope.ts";

const legacy = JSON.stringify({
  job_id: "s8:p:base:market_forward",
  cases: [{ case_id: "base:market_forward", drivers: {
    revenue_y1: { dist: "constant", value: 1 },
    revenue_growth: { dist: "normal", mean: 0.03, sigma: 0.02 },
    opex_ratio: { dist: "constant", value: 0.6 },
  } }],
});

describe("uncertaintyScopeForCase (read-time derivation)", () => {
  test("legacy snapshot without uncertainty_scope derives from drivers when a band exists", () => {
    const s = uncertaintyScopeForCase(legacy, 3);
    expect(s?.varied).toEqual(["revenue_growth"]);
    expect(s?.held_constant).toContain("discount_rate");
  });
  test("case without any simulation stays null", () => {
    expect(uncertaintyScopeForCase(legacy, 0)).toBeNull();
    expect(uncertaintyScopeForCase(null, 0)).toBeNull();
  });
  test("simulated case with no stored drivers is null", () => {
    expect(uncertaintyScopeForCase(null, 3)).toBeNull();
  });
});
