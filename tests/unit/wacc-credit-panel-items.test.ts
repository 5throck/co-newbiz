// @version 1.0.0
/**
 * ADR-0208 slice 2: pure helpers behind the WACC panel's credit-spread row - applied-reference capture,
 * the wacc.debt_spread payload fields, apply-all exclusion/missing-list handling, reason localization
 * fallback and the Kd >= Ke warning rule. The panel itself is verified through these mappings.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  appliedCreditRefFrom,
  applicableSuggestions,
  creditReferenceFields,
  creditSourceLabel,
  formatCreditAnchorPct,
  kdKeWarning,
  missingReferenceItems,
  reasonByCode,
  toWaccComponentPayload,
  type ReferenceSuggestion,
} from "../../app/web-next/lib/wacc-reference-items.ts";
import { suggestionToInputValue } from "../../app/web-next/lib/wacc-suggestion-convert.ts";

const anchors = {
  as_of: "2026-10",
  ktb_pct: 3.861,
  aa_minus_pct: 4.549,
  bbb_minus_pct: 10.358,
  aa_minus_spread_pp: 0.688,
  bbb_minus_spread_pp: 6.497,
  ratio_per_notch: 1.454,
};
const credit: ReferenceSuggestion = {
  key: "credit_spread",
  value: 3.073,
  as_of: "2026-10",
  source_label: "ECOS 721Y001",
  rating: "BBB+",
  rating_source: "default",
  spread_basis: "ecos_interpolated",
  derived: true,
  flags: ["interpolated"],
  anchors,
  kd_indicative_pct: 6.934,
};

describe("appliedCreditRefFrom", () => {
  test("records the rating basis and ECOS month of the applied suggestion", () => {
    const ratio = suggestionToInputValue("credit_spread", credit.value);
    expect(appliedCreditRefFrom(credit, ratio)).toEqual({
      basis: "default",
      referenceAsOf: "2026-10",
      appliedValue: 0.03073,
    });
  });
  test("each rating source maps through unchanged", () => {
    for (const rating_source of ["default", "disclosed", "synthetic"] as const) {
      expect(appliedCreditRefFrom({ ...credit, rating_source }, 0.03)?.basis).toBe(rating_source);
    }
  });
  test("legacy AA- fallback (no anchors, no rating source) records nothing", () => {
    const legacy: ReferenceSuggestion = {
      key: "credit_spread",
      value: 0.688,
      rating: null,
      rating_source: null,
      spread_basis: "aa_minus_legacy",
      anchors: null,
    };
    expect(appliedCreditRefFrom(legacy, 0.00688)).toBeNull();
  });
  test("a malformed month, an unknown source, a null value or another key records nothing", () => {
    expect(appliedCreditRefFrom({ ...credit, anchors: { ...anchors, as_of: "2026-13" } }, 0.03)).toBeNull();
    expect(appliedCreditRefFrom({ ...credit, anchors: { ...anchors, as_of: "2026-10-01" } }, 0.03)).toBeNull();
    expect(appliedCreditRefFrom({ ...credit, rating_source: "x" as never }, 0.03)).toBeNull();
    expect(appliedCreditRefFrom(credit, null)).toBeNull();
    expect(appliedCreditRefFrom({ ...credit, key: "risk_free" }, 0.03)).toBeNull();
  });
});

describe("creditReferenceFields and the wacc.debt_spread payload", () => {
  const ref = { basis: "disclosed" as const, referenceAsOf: "2026-10", appliedValue: 0.03073 };
  test("unedited applied value keeps edited_from_reference false", () => {
    expect(creditReferenceFields(ref, 0.03073)).toEqual({
      creditRatingBasis: "disclosed",
      referenceAsOf: "2026-10",
      editedFromReference: false,
    });
  });
  test("a change beyond the server tolerance flips the edited flag; a rounding-sized one does not", () => {
    expect(creditReferenceFields(ref, 0.04).editedFromReference).toBe(true);
    expect(creditReferenceFields(ref, 0.03073 + 0.0004).editedFromReference).toBe(false);
  });
  test("manual entry carries nothing", () => {
    expect(creditReferenceFields(null, 0.03)).toEqual({});
  });
  test("payload carries credit_rating_basis, reference_as_of and edited_from_reference together", () => {
    const p = toWaccComponentPayload({
      key: "wacc.debt_spread",
      value: 0.03073,
      kind: "live",
      sourceLabel: "ECOS 721Y001 · BBB+ (default, ecos_interpolated)",
      anchorRef: "src:ecos",
      asOf: "2026-10",
      ...creditReferenceFields(ref, 0.03073),
    });
    expect(p).toMatchObject({
      key: "wacc.debt_spread",
      credit_rating_basis: "disclosed",
      reference_as_of: "2026-10",
      edited_from_reference: false,
    });
  });
  test("manual debt_spread sends none of the three fields", () => {
    const p = toWaccComponentPayload({ key: "wacc.debt_spread", value: 0.02, kind: "user" });
    expect("credit_rating_basis" in p).toBe(false);
    expect("reference_as_of" in p).toBe(false);
    expect("edited_from_reference" in p).toBe(false);
  });
});

describe("creditSourceLabel", () => {
  test("names the rating, its source and the spread basis after the ECOS label", () => {
    expect(creditSourceLabel(credit)).toBe("ECOS 721Y001 · BBB+ (default, ecos_interpolated)");
  });
  test("without a rating it is the plain source label", () => {
    expect(creditSourceLabel({ ...credit, rating: null })).toBe("ECOS 721Y001");
    expect(creditSourceLabel({ key: "credit_spread", value: 1 })).toBe("");
  });
});

describe("apply-all handling of the credit_spread row", () => {
  const rf: ReferenceSuggestion = { key: "risk_free", value: 3.861, as_of: "2026-10" };
  const defaultExcluded = [
    { key: "credit_spread", reason_code: "credit_rating_default_basis", reason: "default placeholder" },
  ];
  const staleExcluded = [{ key: "credit_spread", reason_code: "credit_rating_stale", reason: "stale" }];
  test("a default-basis rating is excluded from apply-all and listed missing with its code", () => {
    expect(applicableSuggestions([rf, credit], defaultExcluded).map((x) => x.key)).toEqual(["risk_free"]);
    expect(missingReferenceItems([rf, credit], defaultExcluded)).toEqual([
      { key: "credit_spread", reason_code: "credit_rating_default_basis", reason: "default placeholder" },
    ]);
  });
  test("a stale disclosed rating is excluded the same way", () => {
    const stale = { ...credit, rating_source: "disclosed" as const, rating_stale: true };
    expect(applicableSuggestions([rf, stale], staleExcluded).map((x) => x.key)).toEqual(["risk_free"]);
    expect(missingReferenceItems([rf, stale], staleExcluded)[0]?.reason_code).toBe("credit_rating_stale");
  });
  test("a fresh disclosed or synthetic rating stays applicable and not missing", () => {
    for (const rating_source of ["disclosed", "synthetic"] as const) {
      const s = { ...credit, rating_source };
      expect(applicableSuggestions([rf, s]).map((x) => x.key)).toEqual(["risk_free", "credit_spread"]);
      expect(missingReferenceItems([rf, s])).toEqual([]);
    }
  });
});

describe("reasonByCode / formatCreditAnchorPct", () => {
  const labels = { credit_rating_stale: "stale-local" };
  test("known code is localized; unknown code falls back to the backend text, then to empty", () => {
    expect(reasonByCode(labels, "credit_rating_stale", "backend")).toBe("stale-local");
    expect(reasonByCode(labels, "future_code", "backend")).toBe("backend");
    expect(reasonByCode(labels, null, undefined)).toBe("");
  });
  test("anchor yields show two decimals and a dash when an anchor is missing", () => {
    expect(formatCreditAnchorPct(4.549)).toBe("4.55");
    expect(formatCreditAnchorPct(null)).toBe("—");
    expect(formatCreditAnchorPct(undefined)).toBe("—");
  });
});

describe("kdKeWarning", () => {
  test("derivation Kd at or above Ke warns; the boundary counts", () => {
    expect(kdKeWarning({ kd: 0.1036, ke: 0.1028 }, null)).toEqual({ kd: 0.1036, ke: 0.1028, indicative: false });
    expect(kdKeWarning({ kd: 0.1, ke: 0.1 }, null)?.indicative).toBe(false);
  });
  test("Kd below Ke is silent, and the derivation wins over the indicative figure", () => {
    expect(kdKeWarning({ kd: 0.06, ke: 0.1 }, 12)).toBeNull();
  });
  test("with no derived Kd the reference's indicative Kd (percent points) is compared with Ke", () => {
    expect(kdKeWarning({ kd: null, ke: 0.1028 }, 10.358)).toEqual({ kd: 0.10358, ke: 0.1028, indicative: true });
    expect(kdKeWarning({ kd: null, ke: 0.1028 }, 6.934)).toBeNull();
  });
  test("no Ke, or no Kd of either kind, is never a warning", () => {
    expect(kdKeWarning({ kd: 0.2, ke: null }, 20)).toBeNull();
    expect(kdKeWarning({ kd: null, ke: 0.1 }, null)).toBeNull();
    expect(kdKeWarning({ kd: null, ke: 0.1 }, undefined)).toBeNull();
  });
});

describe("locale catalog carries every credit-spread key in ko and en", () => {
  const load = (l: string) => JSON.parse(readFileSync(`app/web-next/locales/${l}.json`, "utf8"));
  const keys = [
    "creditRatingChip",
    "creditSourceDefault",
    "creditSourceDisclosed",
    "creditSourceSynthetic",
    "creditStaleChip",
    "creditBasisInterpolated",
    "creditBasisClamped",
    "creditBasisLegacy",
    "creditDerivedChip",
    "creditAnchorsLine",
    "creditFlagInterpolated",
    "creditFlagAboveUpperClamped",
    "creditFlagBelowInvestmentGrade",
    "creditFlagClampedFallback",
    "creditReasonNoRatingEvidence",
    "creditReasonDefaultBasis",
    "creditReasonStale",
    "creditReasonNoRegistry",
    "creditReasonRegistryError",
    "creditReasonNoEcos",
    "creditReasonNotInScale",
    "creditReasonAnchorMissing",
    "creditReasonSpreadNotPositive",
    "creditReasonAnchorsInverted",
    "creditApplyAria",
    "kdGeKeChip",
    "kdGeKeDetail",
    "kdGeKeDetailIndicative",
  ];
  for (const l of ["en", "ko"]) {
    test(`${l}: panel keys, kd_ge_ke status warning and company labels exist`, () => {
      const m = load(l);
      const panel = m.stages.s8.wacc.waccPanel;
      for (const k of keys) expect(typeof panel[k]).toBe("string");
      expect(typeof m.components.waccStatus.warning.kd_ge_ke).toBe("string");
      for (const k of ["risk_free", "credit_spread", "observed_de", "beta_levered"]) {
        expect(typeof m.pages.companyFinancials.waccLabel[k]).toBe("string");
      }
    });
  }
});
