import { describe, expect, test } from "bun:test";
import { fmtNpvKrwM } from "../../app/web-next/lib/npv-format.ts";

describe("fmtNpvKrwM", () => {
  test("rounds to whole numbers with thousand separators", () => {
    expect(fmtNpvKrwM(1234567.891)).toBe("1,234,568");
    expect(fmtNpvKrwM(-9876.5)).toBe("-9,876");
    expect(fmtNpvKrwM(12)).toBe("12");
  });
  test("normalizes negative zero and handles missing values", () => {
    expect(fmtNpvKrwM(-0.2)).toBe("0");
    expect(fmtNpvKrwM(null)).toBe("-");
    expect(fmtNpvKrwM(Number.NaN)).toBe("-");
  });
});

import { fmtNpvEok, fmtNpvInteger } from "../../app/web-next/lib/npv-format.ts";
describe("fmtNpvEok / fmtNpvInteger", () => {
  test("shows whole 억원", () => {
    expect(fmtNpvEok(239412)).toBe("2,394억원");
    expect(fmtNpvEok(null)).toBe("-");
  });
  test("integer alias", () => {
    expect(fmtNpvInteger(12.6)).toBe("13");
  });
});

import { formatTargetValue } from "../../app/web-next/lib/business-targets-format.ts";
describe("NPV whole-number display in shared formatters", () => {
  test("goal/target krw_m values are whole 억원", () => {
    expect(formatTargetValue(123456.7, "krw_m")).toBe("1,235억원");
    expect(formatTargetValue(50000, "krw_m")).toBe("500억원");
  });
});
