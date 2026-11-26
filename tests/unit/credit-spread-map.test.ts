// @version 1.0.0
/**
 * ADR-0208 slice 1 - credit-rating registry reader and the rating-to-spread map (pure, no DB).
 * The registry is the shipped region-profiles/KR.yaml; the anchors are the design's illustration
 * (ECOS 2026-10: KTB 3y 3.861%, AA- 4.549%, BBB- 10.358%).
 */
import { describe, expect, test } from "bun:test";
import {
  loadKrCreditRatingRegistry,
  mapRatingToSpread,
  notchOf,
  parseCreditRatingRegistry,
  SPREAD_EDIT_TOLERANCE_PP,
  spreadEditedFromReference,
  type CreditRatingRegistry,
  type MappedSpread,
} from "../../db/lib/credit-spread-map.ts";

const loaded = loadKrCreditRatingRegistry();
if (!loaded.ok) throw new Error(`KR registry must load: ${loaded.reason}`);
const REG: CreditRatingRegistry = loaded.registry;

const FULL = { asOf: "2026-10", ktbPct: 3.861, aaMinusPct: 4.549, bbbMinusPct: 10.358 };
const ok = (rating: string, inputs = FULL): MappedSpread => {
  const r = mapRatingToSpread(REG, rating, inputs);
  if (!r.ok) throw new Error(`${rating}: ${r.reason_code} ${r.reason}`);
  return r;
};

describe("credit_rating_references registry reader", () => {
  test("shipped KR registry carries the design's registry values", () => {
    expect(REG.scale).toHaveLength(20);
    expect(REG.scale.slice(0, 4)).toEqual(["AAA", "AA+", "AA", "AA-"]);
    expect(REG.defaultRating).toBe("BBB-");
    expect(REG.defaultReason.length).toBeGreaterThan(10);
    expect(REG.disclosed).toEqual({ instrument: "corporate_bond", staleMonths: 18, aggregate: "lowest" });
    expect(REG.spreadMap).toEqual({ upperAnchor: "AA-", lowerAnchor: "BBB-" });
    expect(REG.warnGapPp).toBe(2.0);
  });

  test("notch = index + 1; unknown rating is null", () => {
    expect(notchOf(REG, "AAA")).toBe(1);
    expect(notchOf(REG, "AA-")).toBe(4);
    expect(notchOf(REG, "BBB-")).toBe(10);
    expect(notchOf(REG, "D")).toBe(20);
    expect(notchOf(REG, "AA0")).toBeNull();
  });

  const section = (over: Record<string, unknown> = {}) => ({
    credit_rating_references: {
      data: {
        rating_scale: ["AAA", "AA", "A", "BBB", "BB"],
        default: { rating: "BBB", reason: "placeholder" },
        disclosed: { instrument: "corporate_bond", stale_months: 18, aggregate: "lowest" },
        spread_map: {
          upper_anchor: "AA",
          lower_anchor: "BBB",
          between: "geometric",
          above_upper: "clamp",
          below_lower: "clamp_flagged",
        },
        kd_crosscheck: { warn_gap_pp: 2 },
        ...over,
      },
    },
  });

  test("a well-formed section parses; absent section is credit_rating_no_registry", () => {
    expect(parseCreditRatingRegistry(section()).ok).toBe(true);
    const none = parseCreditRatingRegistry({});
    expect(none).toMatchObject({ ok: false, reason_code: "credit_rating_no_registry" });
  });

  test.each([
    ["scale missing", { rating_scale: undefined }],
    ["scale duplicates", { rating_scale: ["AAA", "AAA"] }],
    ["default not on scale", { default: { rating: "ZZZ", reason: "x" } }],
    ["default reason empty", { default: { rating: "BBB", reason: " " } }],
    [
      "stale_months not positive",
      { disclosed: { instrument: "corporate_bond", stale_months: 0, aggregate: "lowest" } },
    ],
    [
      "anchor unresolved",
      {
        spread_map: {
          upper_anchor: "AA",
          lower_anchor: "ZZZ",
          between: "geometric",
          above_upper: "clamp",
          below_lower: "clamp_flagged",
        },
      },
    ],
    [
      "anchors out of order",
      {
        spread_map: {
          upper_anchor: "BBB",
          lower_anchor: "AA",
          between: "geometric",
          above_upper: "clamp",
          below_lower: "clamp_flagged",
        },
      },
    ],
    [
      "unsupported method",
      {
        spread_map: {
          upper_anchor: "AA",
          lower_anchor: "BBB",
          between: "linear",
          above_upper: "clamp",
          below_lower: "clamp_flagged",
        },
      },
    ],
    ["warn_gap_pp not positive", { kd_crosscheck: { warn_gap_pp: -1 } }],
  ])("malformed registry fails soft (%s)", (_name, over) => {
    const r = parseCreditRatingRegistry(section(over));
    expect(r).toMatchObject({ ok: false, reason_code: "credit_rating_registry_error" });
  });

  test("a missing file fails soft without throwing", () => {
    expect(loadKrCreditRatingRegistry("/nonexistent/KR.yaml")).toMatchObject({
      ok: false,
      reason_code: "credit_rating_no_registry",
    });
  });
});

describe("mapRatingToSpread - ecos_interpolated basis", () => {
  test("anchors are the published differences, not derived", () => {
    const aa = ok("AA-");
    expect(aa.spreadPct).toBeCloseTo(0.688, 6);
    expect(aa).toMatchObject({ basis: "ecos_interpolated", derived: false, flags: [] });
    const bbb = ok("BBB-");
    expect(bbb.spreadPct).toBeCloseTo(6.497, 6);
    expect(bbb).toMatchObject({ basis: "ecos_interpolated", derived: false, flags: [] });
    expect(bbb.anchors).toMatchObject({ as_of: "2026-10", ktb_pct: 3.861, aa_minus_pct: 4.549, bbb_minus_pct: 10.358 });
  });

  test("the design's illustration table (A+ .. BBB) to 3 decimals, labelled derived", () => {
    const expected: Array<[string, number]> = [
      ["A+", 1.0],
      ["A", 1.454],
      ["A-", 2.114],
      ["BBB+", 3.073],
      ["BBB", 4.468],
    ];
    for (const [rating, pp] of expected) {
      const r = ok(rating);
      expect(r.spreadPct).toBeCloseTo(pp, 2);
      expect(r.derived).toBe(true);
      expect(r.flags).toEqual(["interpolated"]);
      expect(r.note).toContain("derived value, not a published figure");
    }
    const r = ok("A");
    expect(r.anchors.ratio_per_notch).toBeCloseTo(1.454, 3);
    // Kd = Rf + spread is monotone and below the BBB- anchor yield
    expect(3.861 + r.spreadPct).toBeCloseTo(5.315, 2);
  });

  test("geometric: constant ratio between adjacent notches inside the anchors", () => {
    const s = (r: string) => ok(r).spreadPct;
    const ratio = s("A+") / s("AA-");
    for (const [hi, lo] of [
      ["A", "A+"],
      ["A-", "A"],
      ["BBB+", "A-"],
      ["BBB", "BBB+"],
      ["BBB-", "BBB"],
    ]) {
      expect(s(hi) / s(lo)).toBeCloseTo(ratio, 4);
    }
  });

  test("AAA, AA+, AA clamp to the AA- spread with a flag", () => {
    for (const rating of ["AAA", "AA+", "AA"]) {
      const r = ok(rating);
      expect(r.spreadPct).toBeCloseTo(0.688, 6);
      expect(r.flags).toEqual(["above_upper_anchor_clamped"]);
      expect(r.derived).toBe(false);
      expect(r.note).toContain("clamped");
    }
  });

  test("BB+ and below clamp to the BBB- spread with the understatement flag", () => {
    for (const rating of ["BB+", "B", "CCC", "D"]) {
      const r = ok(rating);
      expect(r.spreadPct).toBeCloseTo(6.497, 6);
      expect(r.flags).toEqual(["below_investment_grade_series_understates"]);
      expect(r.derived).toBe(false);
    }
  });

  test("the spread never decreases as the rating worsens", () => {
    let prev = -1;
    for (const rating of REG.scale) {
      const v = ok(rating).spreadPct;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  test("equal anchors (ratio 1) give the same spread everywhere", () => {
    const flat = { asOf: "2026-10", ktbPct: 3.1, aaMinusPct: 4.2, bbbMinusPct: 4.2 };
    for (const rating of ["AAA", "A", "BBB", "BBB-", "CC"]) expect(ok(rating, flat).spreadPct).toBeCloseTo(1.1, 6);
  });

  test("the as-of month and KTB come from the inputs (one source, one month)", () => {
    const r = ok("BBB", { asOf: "2026-07", ktbPct: 3.0, aaMinusPct: 3.9, bbbMinusPct: 8.4 });
    expect(r.anchors.as_of).toBe("2026-07");
    expect(r.anchors.ktb_pct).toBe(3.0);
    expect(r.anchors.aa_minus_spread_pp).toBeCloseTo(0.9, 6);
    expect(r.anchors.bbb_minus_spread_pp).toBeCloseTo(5.4, 6);
    expect(r.note).toContain("ECOS 2026-07");
  });

  test("deterministic: identical inputs give identical output", () => {
    expect(mapRatingToSpread(REG, "A-", FULL)).toEqual(mapRatingToSpread(REG, "A-", FULL));
  });
});

describe("mapRatingToSpread - ecos_clamped fallback and guards", () => {
  const noBbb = { asOf: "2026-10", ktbPct: 3.861, aaMinusPct: 4.549, bbbMinusPct: null };
  const noAa = { asOf: "2026-10", ktbPct: 3.861, aaMinusPct: null, bbbMinusPct: 10.358 };

  test("BBB- anchor missing: A-range and above use AA-, flagged as a fallback", () => {
    for (const rating of ["AAA", "AA-", "A+", "A", "A-"]) {
      const r = ok(rating, noBbb);
      expect(r).toMatchObject({ basis: "ecos_clamped", derived: false });
      expect(r.spreadPct).toBeCloseTo(0.688, 6);
      expect(r.flags).toContain("clamped_fallback");
    }
  });

  test("BBB- anchor missing: BBB+ and below cannot be mapped (no placeholder)", () => {
    for (const rating of ["BBB+", "BBB", "BBB-", "BB", "D"]) {
      expect(mapRatingToSpread(REG, rating, noBbb)).toMatchObject({ ok: false, reason_code: "anchor_missing" });
    }
  });

  test("AA- anchor missing: BBB+ and below use BBB-; A-range and above cannot be mapped", () => {
    const r = ok("BBB-", noAa);
    expect(r).toMatchObject({ basis: "ecos_clamped" });
    expect(r.spreadPct).toBeCloseTo(6.497, 6);
    expect(ok("BB", noAa).flags).toEqual(["clamped_fallback", "below_investment_grade_series_understates"]);
    expect(mapRatingToSpread(REG, "A-", noAa)).toMatchObject({ ok: false, reason_code: "anchor_missing" });
  });

  test("non-positive or inverted anchor spreads are refused, never mapped", () => {
    expect(mapRatingToSpread(REG, "A", { ...FULL, aaMinusPct: 3.861 })).toMatchObject({
      ok: false,
      reason_code: "spread_not_positive",
    });
    expect(mapRatingToSpread(REG, "A", { ...FULL, bbbMinusPct: 3.5 })).toMatchObject({
      ok: false,
      reason_code: "spread_not_positive",
    });
    expect(mapRatingToSpread(REG, "A", { ...FULL, bbbMinusPct: 4.0 })).toMatchObject({
      ok: false,
      reason_code: "anchors_inverted",
    });
    expect(mapRatingToSpread(REG, "A-", { ...noBbb, aaMinusPct: 3.0 })).toMatchObject({
      ok: false,
      reason_code: "spread_not_positive",
    });
  });

  test("a rating outside the scale is refused", () => {
    expect(mapRatingToSpread(REG, "AA0", FULL)).toMatchObject({ ok: false, reason_code: "rating_not_in_scale" });
  });
});

describe("spreadEditedFromReference", () => {
  test("derives 'edited' from the confirmed ratio against the derived percent points", () => {
    expect(spreadEditedFromReference(0.06497, 6.497)).toBe(false);
    expect(spreadEditedFromReference(0.06497, 6.4971)).toBe(false); // 0.0001 pp, inside the tolerance
    expect(spreadEditedFromReference(0.06497 + (SPREAD_EDIT_TOLERANCE_PP * 2) / 100, 6.497)).toBe(true);
    expect(spreadEditedFromReference(0.05, 6.497)).toBe(true);
  });
});
