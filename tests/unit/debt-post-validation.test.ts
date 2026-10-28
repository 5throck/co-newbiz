// @version 1.0.0
// POST /api/projects/:id/debt input contract (review MEDIUM-2/3): integer principal, rate in (0, 100],
// enum amortization (+ synonyms), validated maturity, length caps.
import { describe, expect, test } from "bun:test";
import { debtCreateSchema, DEBT_COVENANT_JSON_MAX } from "../../app/web-next/lib/debt-input.ts";

const ok = { principal: 450, rate: 5.1, rate_type: "fixed", maturity: "5년", amortization: "원리금균등", covenant_json: "DSCR >= 1.3" };
const bad = (patch: Record<string, unknown>) => debtCreateSchema.safeParse({ ...ok, ...patch }).success;

describe("debtCreateSchema", () => {
  test("accepts a complete instrument and the Korean synonyms", () => {
    expect(debtCreateSchema.safeParse(ok).success).toBe(true);
    for (const a of ["annuity", "equal_principal", "bullet", "원금균등", "만기일시"]) expect(bad({ amortization: a })).toBe(true);
    expect(bad({ maturity: "2031-06" })).toBe(true);
    expect(bad({ maturity: undefined, amortization: undefined })).toBe(true);
  });
  test("principal must be a positive integer", () => {
    expect(bad({ principal: 0 })).toBe(false);
    expect(bad({ principal: -5 })).toBe(false);
    expect(bad({ principal: 10.5 })).toBe(false);
    expect(bad({ principal: "100" })).toBe(false);
  });
  test("rate is a percent in (0, 100]", () => {
    expect(bad({ rate: 0 })).toBe(false);
    expect(bad({ rate: -1 })).toBe(false);
    expect(bad({ rate: 100.5 })).toBe(false);
    expect(bad({ rate: 100 })).toBe(true);
    expect(bad({ rate: undefined })).toBe(false);
  });
  test("amortization / maturity / sizes", () => {
    expect(bad({ amortization: "whatever" })).toBe(false);
    expect(bad({ maturity: "someday" })).toBe(false);
    expect(bad({ lender: "x".repeat(201) })).toBe(false);
    expect(bad({ covenant_json: "x".repeat(DEBT_COVENANT_JSON_MAX + 1) })).toBe(false);
  });
});
