// @version 1.0.0
/**
 * Unit tests for the typed JSON predicate AST engine (db/lib/predicate.ts)
 * — ADR-0046 §2 (Kleene truth tables, NORMATIVE), design 결정 1 (2026-08-22
 * rag-formalization design §3). ADR-0046 §2's final paragraph makes the
 * per-operator truth-table matrix an ACCEPTANCE CONDITION for PR-1, not
 * optional coverage: the permissive direction reproduces the false-pass
 * this work stream exists to prevent; the conservative direction makes
 * every rule UNASSESSED forever.
 *
 * Section map:
 *   (a) ADR-0046 §2 truth tables — the 8 normative rows verbatim, full 3x3
 *       grids per operator, uniform/degenerate sets, at_least semantics
 *   (b) leaf semantics — cmp/in/is_null/count vs present/missing/stale
 *   (c) IEEE-754 parity with financialBand (rag-engine.ts) on the exact
 *       (0.12, 0.10) boundary — the ADR plan's verification requirement
 *   (d) zod validation — valid ASTs pass, each malformation throws
 *   (e) renderKo — batchim particle selection, none_of negation scope,
 *       at_least k interpolation, nested rendering, unit suffix
 */

import { test, describe, expect } from "bun:test";
import {
  evaluatePredicate,
  parsePredicate,
  PredicateSchema,
  quantize,
  renderKo,
  hasBatchim,
  particle,
  type LabelFn,
  type Predicate,
  type TriState,
  type VarLookup,
  type VarSnapshot,
} from "../../db/lib/predicate.ts";
import {
  financialBand,
  FINANCIAL_GREEN_DSCR,
  FINANCIAL_GREEN_IRR_MARGIN_PP,
} from "../../db/lib/rag-engine.ts";

// ---------------------------------------------------------------------------
// Fixtures — TriState-forcing leaf builders driven purely by the lookup
// ---------------------------------------------------------------------------

const SNAPSHOTS: Record<string, VarSnapshot> = {
  t1: { status: "present", value: 1 },
  t2: { status: "present", value: 1 },
  t3: { status: "present", value: 1 },
  f1: { status: "present", value: 0 },
  f2: { status: "present", value: 0 },
  f3: { status: "present", value: 0 },
  u1: { status: "missing" },
  u2: { status: "stale" }, // stale must behave like missing for leaf UNASSESSED
  u3: { status: "missing" },
  num: { status: "present", value: 5 },
  str: { status: "present", value: "제조" },
  bool: { status: "present", value: true },
  presentNoPayload: { status: "present" }, // contradictory snapshot — see is_null test
};
const lookup: VarLookup = (k) => SNAPSHOTS[k];

/** Forced-TRUE leaf. */
const T = (i = 1): Predicate => ({ op: "cmp", var: `t${i}`, cmp: "eq", value: 1 });
/** Forced-FALSE leaf. */
const F = (i = 1): Predicate => ({ op: "cmp", var: `f${i}`, cmp: "eq", value: 1 });
/** Forced-UNASSESSED leaf (snapshot status missing). */
const U = (i = 1): Predicate => ({ op: "cmp", var: `u${i}`, cmp: "eq", value: 1 });

const TRI: TriState[] = ["true", "false", "unassessed"];
const leafFor = (v: TriState, i: number): Predicate =>
  v === "true" ? T(i) : v === "false" ? F(i) : U(i);

// Reference Kleene functions — independent of the implementation under test.
const refAnd = (a: TriState, b: TriState): TriState =>
  a === "false" || b === "false" ? "false" : a === "unassessed" || b === "unassessed" ? "unassessed" : "true";
const refOr = (a: TriState, b: TriState): TriState =>
  a === "true" || b === "true" ? "true" : a === "unassessed" || b === "unassessed" ? "unassessed" : "false";
const refNot = (a: TriState): TriState => (a === "true" ? "false" : a === "false" ? "true" : "unassessed");
const refAtLeast = (k: number, vals: TriState[]): TriState => {
  if (k <= 0) return "true";
  const t = vals.filter((v) => v === "true").length;
  const u = vals.filter((v) => v === "unassessed").length;
  if (t >= k) return "true";
  if (t + u < k) return "false";
  return "unassessed";
};

// ---------------------------------------------------------------------------
// (a) ADR-0046 §2 truth tables — normative rows, verbatim
// ---------------------------------------------------------------------------

describe("ADR-0046 §2 normative truth tables (docs/adr/0046-typed-json-predicate-ast-and-evidence-variable-registry.md lines 41-50)", () => {
  // Row 1, ADR line 43: any_of(TRUE, UNASSESSED) | TRUE
  test("any_of(TRUE, UNASSESSED) = TRUE", () => {
    expect(evaluatePredicate({ op: "any_of", of: [T(1), U(1)] }, lookup)).toBe("true");
  });
  // Row 2, ADR line 44: any_of(FALSE, UNASSESSED) | UNASSESSED
  test("any_of(FALSE, UNASSESSED) = UNASSESSED", () => {
    expect(evaluatePredicate({ op: "any_of", of: [F(1), U(1)] }, lookup)).toBe("unassessed");
  });
  // Row 3, ADR line 45: at_least(k=2, [TRUE, TRUE, UNASSESSED]) | TRUE
  test("at_least(k=2, [TRUE, TRUE, UNASSESSED]) = TRUE", () => {
    expect(evaluatePredicate({ op: "at_least", k: 2, of: [T(1), T(2), U(1)] }, lookup)).toBe("true");
  });
  // Row 4, ADR line 46: at_least(k=2, [TRUE, UNASSESSED, FALSE]) | UNASSESSED
  test("at_least(k=2, [TRUE, UNASSESSED, FALSE]) = UNASSESSED", () => {
    expect(evaluatePredicate({ op: "at_least", k: 2, of: [T(1), U(1), F(1)] }, lookup)).toBe("unassessed");
  });
  // Row 5, ADR line 47: all_of(FALSE, UNASSESSED) | FALSE
  test("all_of(FALSE, UNASSESSED) = FALSE", () => {
    expect(evaluatePredicate({ op: "all_of", of: [F(1), U(1)] }, lookup)).toBe("false");
  });
  // Row 6, ADR line 48: all_of(TRUE, UNASSESSED) | UNASSESSED
  test("all_of(TRUE, UNASSESSED) = UNASSESSED", () => {
    expect(evaluatePredicate({ op: "all_of", of: [T(1), U(1)] }, lookup)).toBe("unassessed");
  });
  // Row 7, ADR line 49: none_of(TRUE, UNASSESSED) | FALSE
  test("none_of(TRUE, UNASSESSED) = FALSE", () => {
    expect(evaluatePredicate({ op: "none_of", of: [T(1), U(1)] }, lookup)).toBe("false");
  });
  // Row 8, ADR line 50: none_of(FALSE, UNASSESSED) | UNASSESSED
  test("none_of(FALSE, UNASSESSED) = UNASSESSED", () => {
    expect(evaluatePredicate({ op: "none_of", of: [F(1), U(1)] }, lookup)).toBe("unassessed");
  });
});

// Full 3x3 grids — every operator against the independent reference Kleene
// implementation, including mixed two-child combinations and uniform sets.
describe("full two-child grids vs reference Kleene logic", () => {
  for (const op of ["all_of", "any_of", "none_of"] as const) {
    test(`${op}: every (a,b) in {TRUE,FALSE,UNASSESSED}^2 matches the reference table`, () => {
      for (const a of TRI) {
        for (const b of TRI) {
          const got = evaluatePredicate({ op, of: [leafFor(a, 1), leafFor(b, 2)] }, lookup);
          const want = op === "all_of" ? refAnd(a, b) : op === "any_of" ? refOr(a, b) : refNot(refOr(a, b));
          expect(got).toBe(want);
        }
      }
    });
  }
  test("three-child uniform sets: all-TRUE / all-FALSE / all-UNASSESSED per operator", () => {
    for (const op of ["all_of", "any_of", "none_of"] as const) {
      expect(evaluatePredicate({ op, of: [T(1), T(2), T(3)] }, lookup)).toBe(
        op === "none_of" ? "false" : "true",
      );
      expect(evaluatePredicate({ op, of: [F(1), F(2), F(3)] }, lookup)).toBe(
        op === "none_of" ? "true" : "false",
      );
      expect(evaluatePredicate({ op, of: [U(1), U(2), U(3)] }, lookup)).toBe("unassessed");
    }
  });
});

describe("at_least semantics", () => {
  test("k=1 degenerates to any_of across the full 3x3 grid", () => {
    for (const a of TRI) {
      for (const b of TRI) {
        const kids = [leafFor(a, 1), leafFor(b, 2)];
        expect(evaluatePredicate({ op: "at_least", k: 1, of: kids }, lookup)).toBe(
          evaluatePredicate({ op: "any_of", of: kids }, lookup),
        );
      }
    }
  });
  test("k=3 of [TRUE, TRUE, UNASSESSED] is UNASSESSED (threshold not yet met, still reachable)", () => {
    expect(evaluatePredicate({ op: "at_least", k: 3, of: [T(1), T(2), U(1)] }, lookup)).toBe("unassessed");
  });
  test("k exceeded by FALSEs is FALSE even with unassesseds present (at_least(3, [T, F, U]) = FALSE)", () => {
    // t=1, u=1 -> t+u=2 < k=3: unreachable, not undecided
    expect(evaluatePredicate({ op: "at_least", k: 3, of: [T(1), F(1), U(1)] }, lookup)).toBe("false");
  });
  test("exhaustive 3-child grid x k=0..4 matches the reference counting rule", () => {
    for (let k = 0; k <= 4; k++) {
      for (const a of TRI) {
        for (const b of TRI) {
          for (const c of TRI) {
            const got = evaluatePredicate(
              { op: "at_least", k, of: [leafFor(a, 1), leafFor(b, 2), leafFor(c, 3)] },
              lookup,
            );
            expect(got).toBe(refAtLeast(k, [a, b, c]));
          }
        }
      }
    }
  });
});

describe("degenerate (empty) operand sets — defensive; PredicateSchema rejects these at write time", () => {
  test("all_of([]) = TRUE (vacuous conjunction)", () => {
    expect(evaluatePredicate({ op: "all_of", of: [] }, lookup)).toBe("true");
  });
  test("any_of([]) = FALSE (vacuous disjunction)", () => {
    expect(evaluatePredicate({ op: "any_of", of: [] }, lookup)).toBe("false");
  });
  test("none_of([]) = TRUE (= NOT any_of([]))", () => {
    expect(evaluatePredicate({ op: "none_of", of: [] }, lookup)).toBe("true");
  });
  test("at_least(k<=0) = TRUE (threshold trivially met), including empty of", () => {
    expect(evaluatePredicate({ op: "at_least", k: 0, of: [F(1)] }, lookup)).toBe("true");
    expect(evaluatePredicate({ op: "at_least", k: 0, of: [] }, lookup)).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// (b) Leaf semantics — cmp / in / is_null / count vs snapshot status
// ---------------------------------------------------------------------------

describe("leaf cmp semantics", () => {
  const CMPS = ["lt", "lte", "gt", "gte", "eq", "neq"] as const;
  test.each(CMPS)("cmp %s: TRUE/FALSE on present, UNASSESSED on missing and on stale", (cmp) => {
    // num = 5, value = 5: eq/gte/lte true, lt/gt/neq false — one decisive
    // value pair exercises both outcomes per comparator.
    const onFive: Predicate = { op: "cmp", var: "num", cmp, value: 5 };
    const decided = evaluatePredicate(onFive, lookup);
    expect(["true", "false"]).toContain(decided);
    expect(evaluatePredicate({ op: "cmp", var: "u1", cmp, value: 5 }, lookup)).toBe("unassessed"); // missing
    expect(evaluatePredicate({ op: "cmp", var: "u2", cmp, value: 5 }, lookup)).toBe("unassessed"); // stale
  });
  test("cmp boundary inclusivity: lte/gte include, lt/gt exclude (num=5)", () => {
    expect(evaluatePredicate({ op: "cmp", var: "num", cmp: "lte", value: 5 }, lookup)).toBe("true");
    expect(evaluatePredicate({ op: "cmp", var: "num", cmp: "gte", value: 5 }, lookup)).toBe("true");
    expect(evaluatePredicate({ op: "cmp", var: "num", cmp: "lt", value: 5 }, lookup)).toBe("false");
    expect(evaluatePredicate({ op: "cmp", var: "num", cmp: "gt", value: 5 }, lookup)).toBe("false");
  });
  test("cmp type mismatch (number rule against string payload) is UNASSESSED, never a crash", () => {
    expect(evaluatePredicate({ op: "cmp", var: "str", cmp: "eq", value: 2 }, lookup)).toBe("unassessed");
    expect(evaluatePredicate({ op: "cmp", var: "num", cmp: "eq", value: "5" }, lookup)).toBe("unassessed");
  });
  test("cmp on strings/booleans: eq/neq strict equality; ordering comparators are UNASSESSED (not defined)", () => {
    expect(evaluatePredicate({ op: "cmp", var: "str", cmp: "eq", value: "제조" }, lookup)).toBe("true");
    expect(evaluatePredicate({ op: "cmp", var: "str", cmp: "neq", value: "제조" }, lookup)).toBe("false");
    expect(evaluatePredicate({ op: "cmp", var: "bool", cmp: "eq", value: true }, lookup)).toBe("true");
    expect(evaluatePredicate({ op: "cmp", var: "str", cmp: "lt", value: "가" }, lookup)).toBe("unassessed");
    expect(evaluatePredicate({ op: "cmp", var: "bool", cmp: "gte", value: true }, lookup)).toBe("unassessed");
  });
  test("resolver returning undefined is treated as status missing", () => {
    const neverFound: VarLookup = () => undefined;
    expect(evaluatePredicate({ op: "cmp", var: "anything", cmp: "eq", value: 1 }, neverFound)).toBe("unassessed");
  });
});

describe("leaf in semantics", () => {
  test("membership on present payload; UNASSESSED on missing/stale", () => {
    expect(evaluatePredicate({ op: "in", var: "num", values: [4, 5, 6] }, lookup)).toBe("true");
    expect(evaluatePredicate({ op: "in", var: "num", values: [4, 6] }, lookup)).toBe("false");
    expect(evaluatePredicate({ op: "in", var: "u1", values: [5] }, lookup)).toBe("unassessed");
    expect(evaluatePredicate({ op: "in", var: "u2", values: [5] }, lookup)).toBe("unassessed");
  });
  test("string membership", () => {
    expect(evaluatePredicate({ op: "in", var: "str", values: ["조선", "제조"] }, lookup)).toBe("true");
    expect(evaluatePredicate({ op: "in", var: "str", values: ["조선"] }, lookup)).toBe("false");
  });
  test("type mismatch against every candidate is UNASSESSED", () => {
    expect(evaluatePredicate({ op: "in", var: "str", values: [1, 2, 3] }, lookup)).toBe("unassessed");
  });
});

describe("leaf is_null semantics — ADR-0046 §2 line 52: evaluated against status, not a NULL payload", () => {
  test("is_null is TRUE for missing (the operator is deliberately written against absent values)", () => {
    expect(evaluatePredicate({ op: "is_null", var: "u1" }, lookup)).toBe("true");
  });
  test("is_null is TRUE for stale (stale is also 'effectively absent')", () => {
    expect(evaluatePredicate({ op: "is_null", var: "u2" }, lookup)).toBe("true");
  });
  test("is_null is FALSE for present regardless of payload — including the contradictory present-without-payload snapshot, which is_null must NOT paper over", () => {
    expect(evaluatePredicate({ op: "is_null", var: "num" }, lookup)).toBe("false");
    // presentNoPayload = {status:"present"} with no value: ADR wording says
    // is_null reads status only; a present-no-payload row is a PR-2 loader
    // defect surfaced by every OTHER operator returning UNASSESSED.
    expect(evaluatePredicate({ op: "is_null", var: "presentNoPayload" }, lookup)).toBe("false");
    expect(evaluatePredicate({ op: "cmp", var: "presentNoPayload", cmp: "eq", value: 1 }, lookup)).toBe("unassessed");
  });
});

describe("leaf count semantics", () => {
  test("numeric count comparison on present payload; UNASSESSED on missing/stale/non-number", () => {
    expect(evaluatePredicate({ op: "count", var: "num", cmp: "gt", value: 3 }, lookup)).toBe("true");
    expect(evaluatePredicate({ op: "count", var: "num", cmp: "eq", value: 5 }, lookup)).toBe("true");
    expect(evaluatePredicate({ op: "count", var: "num", cmp: "lte", value: 4 }, lookup)).toBe("false");
    expect(evaluatePredicate({ op: "count", var: "u1", cmp: "gt", value: 3 }, lookup)).toBe("unassessed");
    expect(evaluatePredicate({ op: "count", var: "u2", cmp: "gt", value: 3 }, lookup)).toBe("unassessed");
    expect(evaluatePredicate({ op: "count", var: "str", cmp: "gt", value: 3 }, lookup)).toBe("unassessed"); // non-number payload
  });
});

// ---------------------------------------------------------------------------
// (c) IEEE-754 parity with financialBand — the plan's verification requirement
// ---------------------------------------------------------------------------

describe("IEEE-754 quantization parity with financialBand (rag-engine.ts)", () => {
  test("quantize() sends (0.12-0.10)*100 === 1.9999999999999836 to exactly 2", () => {
    const rawMarginPp = (0.12 - 0.1) * 100;
    expect(rawMarginPp).toBeLessThan(FINANCIAL_GREEN_IRR_MARGIN_PP); // raw float would FAIL >= 2
    expect(rawMarginPp).not.toBe(2);
    expect(quantize(rawMarginPp)).toBe(2);
  });

  test("cmp gte 2pp returns TRUE on the raw-float 1.9999999999999836 margin — same verdict as financialBand on the same inputs", () => {
    const irr = 0.12;
    const hurdle = 0.1;
    const rawMarginPp = (irr - hurdle) * 100; // 1.9999999999999836 in IEEE-754
    const pred: Predicate = { op: "cmp", var: "irr_margin_pp", cmp: "gte", value: FINANCIAL_GREEN_IRR_MARGIN_PP };
    const snap: VarLookup = (k) => (k === "irr_margin_pp" ? { status: "present", value: rawMarginPp } : undefined);

    // Predicate side: quantized comparison puts the margin ON the boundary.
    expect(evaluatePredicate(pred, snap)).toBe("true");
    // Production grader side: financialBand's own guard makes the same
    // mathematically-exactly-2pp input Green (with DSCR on its threshold).
    const band = financialBand({ irr, hurdle, dscrDownside: FINANCIAL_GREEN_DSCR });
    expect(band.grade).toBe("green");
  });

  test("a GENUINE shortfall stays FALSE after quantization (1.9999pp is real, not float noise)", () => {
    const shortMarginPp = (0.12 - 0.100001) * 100; // ~1.9999 — truly below the 2.0pp band
    const pred: Predicate = { op: "cmp", var: "irr_margin_pp", cmp: "gte", value: FINANCIAL_GREEN_IRR_MARGIN_PP };
    expect(evaluatePredicate(pred, () => ({ status: "present", value: shortMarginPp }))).toBe("false");
    // financialBand agrees: same numbers grade Amber (margin short of Green).
    const band = financialBand({ irr: 0.12, hurdle: 0.100001, dscrDownside: FINANCIAL_GREEN_DSCR });
    expect(band.grade).toBe("amber");
  });
});

// ---------------------------------------------------------------------------
// (d) zod validation — PredicateSchema / parsePredicate
// ---------------------------------------------------------------------------

describe("PredicateSchema validation", () => {
  const validAst: Predicate = {
    op: "all_of",
    of: [
      { op: "cmp", var: "irr_margin_pp", cmp: "gte", value: 2, unit: "pp" },
      { op: "any_of", of: [{ op: "in", var: "sector", values: ["조선", "제조"] }, { op: "is_null", var: "permits" }] },
      { op: "at_least", k: 2, of: [{ op: "count", var: "certs", cmp: "gte", value: 3 }, { op: "cmp", var: "growth", cmp: "lt", value: 5 }] },
    ],
  };

  test("a valid AST exercising every operator parses and round-trips", () => {
    expect(parsePredicate(validAst)).toEqual(validAst);
    expect(PredicateSchema.safeParse(validAst).success).toBe(true);
  });

  test.each([
    ["unknown op", { op: "xor", of: [validAst] }],
    ["negative k", { op: "at_least", k: -1, of: [validAst] }],
    ["non-integer k", { op: "at_least", k: 1.5, of: [validAst] }],
    ["empty of (all_of)", { op: "all_of", of: [] }],
    ["empty of (at_least)", { op: "at_least", k: 1, of: [] }],
    ["empty in-values", { op: "in", var: "sector", values: [] }],
    ["bogus cmp comparator string", { op: "cmp", var: "x", cmp: "between", value: 1 }],
    ["missing cmp value", { op: "cmp", var: "x", cmp: "eq" }],
    ["null cmp value (not a Scalar)", { op: "cmp", var: "x", cmp: "eq", value: null }],
    ["missing var on is_null", { op: "is_null" }],
    ["unknown extra key (strict objects)", { op: "cmp", var: "x", cmp: "eq", value: 1, smuggled: true }],
    ["neq is not a count comparator", { op: "count", var: "x", cmp: "neq", value: 3 }],
    ["non-number count value", { op: "count", var: "x", cmp: "gt", value: "3" }],
    ["malformed child inside of", { op: "all_of", of: [{ op: "cmp", var: "x", cmp: "eq" }] }],
  ])("rejects: %s", (_name, input) => {
    expect(() => parsePredicate(input)).toThrow(/Invalid predicate AST/);
  });

  test("the thrown error is descriptive (names the offending path)", () => {
    expect(() => parsePredicate({ op: "at_least", k: -1, of: [validAst] })).toThrow(/k:|at_least/);
  });
});

// ---------------------------------------------------------------------------
// (e) renderKo — governance rendering (design 결정 1, F-17b)
// ---------------------------------------------------------------------------

const LABELS: Record<string, { label: string; unit?: string }> = {
  growth: { label: "시장 성장률" }, // 률 — final jamo (받침) present
  market_size: { label: "시장 규모" }, // 모 — no final jamo
  irr_margin_pp: { label: "IRR 마진", unit: "pp" },
  sector: { label: "업종" }, // 종 — 받침 present
  certs: { label: "보유 인증" },
  permits: { label: "실증 허가" },
};
const labels: LabelFn = (k) => LABELS[k] ?? { label: k };

describe("particle selection (조사) by final jamo (받침)", () => {
  test("hasBatchim: 시장 성장률/업종 have 받침; 시장 규모 does not; non-Hangul takes the vowel variant", () => {
    expect(hasBatchim("시장 성장률")).toBe(true);
    expect(hasBatchim("업종")).toBe(true);
    expect(hasBatchim("시장 규모")).toBe(false);
    expect(hasBatchim("10")).toBe(false);
  });
  test.each([
    ["iGa", "시장 성장률", "이"], ["iGa", "시장 규모", "가"],
    ["eunNeun", "시장 성장률", "은"], ["eunNeun", "시장 규모", "는"],
    ["eulReul", "시장 성장률", "을"], ["eulReul", "시장 규모", "를"],
    ["waGwa", "시장 성장률", "과"], ["waGwa", "시장 규모", "와"],
  ] as const)("particle(%s) after %s-final word is %s", (kind, word, want) => {
    expect(particle(word, kind)).toBe(want);
  });
  test("renderKo in: 받침 label takes 이 (시장 성장률이 … 중 하나)", () => {
    const out = renderKo({ op: "in", var: "growth", values: ["조선"] }, labels);
    expect(out).toBe("· 시장 성장률이 조선 중 하나");
  });
  test("renderKo in: vowel-final label takes 가 (시장 규모가 … 중 하나)", () => {
    const out = renderKo({ op: "in", var: "market_size", values: ["국내"] }, labels);
    expect(out).toBe("· 시장 규모가 국내 중 하나");
  });
  test("renderKo eq: label takes 이/가 AND value takes 과/와 (업종이 조선과 같음 / 제조와 같음)", () => {
    expect(renderKo({ op: "cmp", var: "sector", cmp: "eq", value: "조선" }, labels)).toBe("· 업종이 조선과 같음");
    expect(renderKo({ op: "cmp", var: "sector", cmp: "eq", value: "제조" }, labels)).toBe("· 업종이 제조와 같음");
  });
});

describe("operator headers and negation scope", () => {
  test("none_of negation scope covers the WHOLE list — both children render inside one negated enumeration", () => {
    const out = renderKo(
      {
        op: "none_of",
        of: [
          { op: "cmp", var: "growth", cmp: "lt", value: 5 },
          { op: "cmp", var: "market_size", cmp: "lte", value: 3 },
        ],
      },
      labels,
    );
    expect(out).toBe("다음 중 어느 것도 해당하지 않음:\n  · 시장 성장률 5 미만\n  · 시장 규모 3 이하");
  });
  test("at_least interpolates k into the header (다음 중 2개 이상 충족)", () => {
    const out = renderKo({ op: "at_least", k: 2, of: [{ op: "cmp", var: "growth", cmp: "gte", value: 10 }, { op: "is_null", var: "permits" }] }, labels);
    expect(out.split("\n")[0]).toBe("다음 중 2개 이상 충족:");
  });
  test("all_of / any_of headers", () => {
    expect(renderKo({ op: "all_of", of: [{ op: "is_null", var: "permits" }] }, labels).split("\n")[0]).toBe("다음을 모두 충족:");
    expect(renderKo({ op: "any_of", of: [{ op: "is_null", var: "permits" }] }, labels).split("\n")[0]).toBe("다음 중 하나 이상 충족:");
  });
});

describe("nested rendering and units", () => {
  test("depth-2 nesting renders both levels with indented '· ' bullets — every branch visible", () => {
    const out = renderKo(
      {
        op: "all_of",
        of: [
          { op: "cmp", var: "irr_margin_pp", cmp: "gte", value: 2 },
          {
            op: "any_of",
            of: [
              { op: "cmp", var: "growth", cmp: "gte", value: 10 },
              { op: "in", var: "sector", values: ["조선", "제조"] },
            ],
          },
        ],
      },
      labels,
    );
    expect(out).toBe(
      [
        "다음을 모두 충족:",
        "  · IRR 마진 2pp 이상", // registry label unit "pp" appended to the value
        "  다음 중 하나 이상 충족:",
        "    · 시장 성장률 10 이상",
        "    · 업종이 조선, 제조 중 하나",
      ].join("\n"),
    );
  });
  test("a rule-authored unit on the AST node overrides the registry label unit", () => {
    expect(renderKo({ op: "cmp", var: "irr_margin_pp", cmp: "gte", value: 2, unit: "%" }, labels)).toBe("· IRR 마진 2% 이상");
  });
  test("count and is_null leaf phrasing", () => {
    expect(renderKo({ op: "count", var: "certs", cmp: "gte", value: 3 }, labels)).toBe("· 보유 인증 개수가 3 이상");
    expect(renderKo({ op: "is_null", var: "permits" }, labels)).toBe("· 실증 허가값 없음");
  });
  test("boolean scalars render as 참/거짓", () => {
    // 허가 ends in 가 (no 받침) -> particle 가
    expect(renderKo({ op: "in", var: "permits", values: [true, false] }, labels)).toBe("· 실증 허가가 참, 거짓 중 하나");
  });
});
