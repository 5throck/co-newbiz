import { describe, expect, test } from "bun:test";
import { suggestionToInputValue } from "../../app/web-next/lib/wacc-suggestion-convert.ts";

describe("suggestionToInputValue", () => {
  test("percent-point keys are divided by 100", () => {
    expect(suggestionToInputValue("risk_free", 3.788)).toBeCloseTo(0.03788, 10);
    expect(suggestionToInputValue("credit_spread", 0.6)).toBeCloseTo(0.006, 10);
  });
  test("observed_de passes through unchanged", () => {
    expect(suggestionToInputValue("observed_de", 0.85)).toBe(0.85);
  });
  test("null stays null for every key", () => {
    for (const k of ["risk_free", "credit_spread", "observed_de"]) expect(suggestionToInputValue(k, null)).toBeNull();
  });
});
