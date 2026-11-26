import { describe, expect, test } from "bun:test";
import {
  appliedErpRefFrom,
  appliedTaxRefFrom,
  applicableSuggestions,
  erpReferenceFields,
  missingReferenceItems,
  observedDeAsTarget,
  observedDeSourceDetail,
  safeHttpsUrl,
  taxReferenceFields,
  toWaccComponentPayload,
  type ReferenceSuggestion,
} from "../../app/web-next/lib/wacc-reference-items.ts";
import { suggestionToInputValue } from "../../app/web-next/lib/wacc-suggestion-convert.ts";

const rf: ReferenceSuggestion = { key: "risk_free", value: 3.5, as_of: "2026-11-01" };
const cs: ReferenceSuggestion = { key: "credit_spread", value: null, reason: "no series" };
const erp: ReferenceSuggestion = { key: "erp", value: 5.5, id: "damodaran-2026-01", is_default: true, stale: false };
const staleExcluded = [{ key: "erp", reason_code: "erp_reference_stale", reason: "stale" }];

describe("applicableSuggestions", () => {
  test("fresh default ERP is applicable alongside other valued items", () => {
    expect(applicableSuggestions([rf, cs, erp]).map((x) => x.key)).toEqual(["risk_free", "erp"]);
  });
  test("stale default excluded by apply_all_excluded; count treats it as not applicable", () => {
    const list = [rf, cs, { ...erp, stale: true }];
    expect(applicableSuggestions(list, staleExcluded).map((x) => x.key)).toEqual(["risk_free"]);
    expect(applicableSuggestions(list, staleExcluded).length).toBe(1);
    expect(list.length).toBe(3);
  });
  test("null ERP (non-KR) is never applicable", () => {
    const nullErp: ReferenceSuggestion = { key: "erp", value: null, reason_code: "erp_market_not_kr" };
    expect(applicableSuggestions([rf, nullErp]).map((x) => x.key)).toEqual(["risk_free"]);
  });
});

describe("missingReferenceItems", () => {
  test("lists null-valued entries and excluded valued entries once each, with reason codes", () => {
    const items = missingReferenceItems([rf, cs, { ...erp, stale: true }], staleExcluded);
    expect(items.map((x) => x.key)).toEqual(["credit_spread", "erp"]);
    expect(items[1]).toEqual({ key: "erp", reason_code: "erp_reference_stale", reason: "stale" });
  });
  test("null ERP keeps its reason_code and is not duplicated by an exclusion", () => {
    const nullErp: ReferenceSuggestion = { key: "erp", value: null, reason: "r", reason_code: "erp_market_not_kr" };
    const items = missingReferenceItems([nullErp], staleExcluded);
    expect(items).toEqual([{ key: "erp", reason_code: "erp_market_not_kr", reason: "r" }]);
  });
  test("nothing missing when all valued and no exclusions", () => {
    expect(missingReferenceItems([rf, erp])).toEqual([]);
  });
});

describe("ERP reference fields", () => {
  const ref = appliedErpRefFrom(erp, suggestionToInputValue("erp", 5.5));
  test("applied reference converts percent points to a ratio and keeps the id", () => {
    expect(ref).toEqual({ id: "damodaran-2026-01", appliedValue: 0.055 });
  });
  test("manual entry (no applied reference) carries no id", () => {
    expect(erpReferenceFields(null, 0.06)).toEqual({});
  });
  test("unedited applied value is flagged not edited", () => {
    expect(erpReferenceFields(ref, 0.055)).toEqual({ erpReferenceId: "damodaran-2026-01", editedFromReference: false });
  });
  test("changing the number after applying flags edited_from_reference", () => {
    expect(erpReferenceFields(ref, 0.06)).toEqual({ erpReferenceId: "damodaran-2026-01", editedFromReference: true });
  });
  test("falls back to source_id and refuses a reference without an id or value", () => {
    expect(appliedErpRefFrom({ key: "erp", value: 5, source_id: "kicpa" }, 0.05)?.id).toBe("kicpa");
    expect(appliedErpRefFrom({ key: "erp", value: 5 }, 0.05)).toBeNull();
    expect(appliedErpRefFrom(erp, null)).toBeNull();
  });
});

describe("toWaccComponentPayload", () => {
  test("maps to the snake_case route contract incl. ERP reference fields", () => {
    expect(
      toWaccComponentPayload({
        key: "wacc.erp",
        value: 0.055,
        kind: "user",
        sourceLabel: "Damodaran",
        anchorRef: "https://pages.stern.nyu.edu/",
        asOf: "2026-01-01",
        erpReferenceId: "damodaran-2026-01",
        editedFromReference: true,
      }),
    ).toEqual({
      key: "wacc.erp",
      value: 0.055,
      kind: "user",
      source_label: "Damodaran",
      anchor_ref: "https://pages.stern.nyu.edu/",
      as_of: "2026-01-01",
      erp_reference_id: "damodaran-2026-01",
      edited_from_reference: true,
    });
  });
  test("manual ERP sends neither id nor edited flag; empty anchor is omitted", () => {
    const p = toWaccComponentPayload({ key: "wacc.erp", value: 0.06, kind: "user", anchorRef: null });
    expect(p).toEqual({ key: "wacc.erp", value: 0.06, kind: "user" });
    expect("erp_reference_id" in p).toBe(false);
    expect("edited_from_reference" in p).toBe(false);
  });
});

describe("safeHttpsUrl / ERP conversion", () => {
  test("only https links render as anchors", () => {
    expect(safeHttpsUrl("https://example.org/x")).toBe("https://example.org/x");
    expect(safeHttpsUrl("http://example.org")).toBeNull();
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl(undefined)).toBeNull();
  });
  test("erp percent points become a clean ratio", () => {
    expect(suggestionToInputValue("erp", 5.5)).toBe(0.055);
    expect(suggestionToInputValue("erp", 7.1)).toBe(0.071);
    expect(suggestionToInputValue("erp", null)).toBeNull();
  });
});

const tax: ReferenceSuggestion = {
  key: "tax_rate",
  value: 20.9,
  basis: "bracket_estimate",
  bracket_id: "kr-corp-2025.200000000",
  income_account: "operating_income",
};

describe("tax_rate reference (ADR-0207 addendum)", () => {
  test("percent points become a clean ratio and apply-all takes a valued tax_rate", () => {
    expect(suggestionToInputValue("tax_rate", 20.9)).toBe(0.209);
    expect(suggestionToInputValue("tax_rate", 26.4)).toBe(0.264);
    expect(applicableSuggestions([rf, tax]).map((x) => x.key)).toEqual(["risk_free", "tax_rate"]);
  });
  test("null tax_rate lands in the missing list with its reason_code and is never applicable", () => {
    const nullTax: ReferenceSuggestion = {
      key: "tax_rate",
      value: null,
      reason: "r",
      reason_code: "tax_rate_market_not_kr",
    };
    expect(applicableSuggestions([rf, nullTax]).map((x) => x.key)).toEqual(["risk_free"]);
    expect(missingReferenceItems([rf, nullTax])).toEqual([
      { key: "tax_rate", reason_code: "tax_rate_market_not_kr", reason: "r" },
    ]);
  });
  test("applied reference keeps bracket id and basis; refuses unknown basis, missing id or value", () => {
    expect(appliedTaxRefFrom(tax, 0.209)).toEqual({
      bracketId: "kr-corp-2025.200000000",
      basis: "bracket_estimate",
      appliedValue: 0.209,
    });
    expect(appliedTaxRefFrom({ ...tax, basis: "top_bracket_fallback" }, 0.264)?.basis).toBe("top_bracket_fallback");
    expect(appliedTaxRefFrom({ ...tax, basis: "other" }, 0.209)).toBeNull();
    expect(appliedTaxRefFrom({ ...tax, bracket_id: undefined }, 0.209)).toBeNull();
    expect(appliedTaxRefFrom(tax, null)).toBeNull();
  });
  test("taxReferenceFields: manual entry carries nothing; edit flips edited_from_reference", () => {
    const ref = appliedTaxRefFrom(tax, 0.209);
    expect(taxReferenceFields(null, 0.22)).toEqual({});
    expect(taxReferenceFields(ref, 0.209)).toEqual({
      taxReferenceBracketId: "kr-corp-2025.200000000",
      taxReferenceBasis: "bracket_estimate",
      editedFromReference: false,
    });
    expect(taxReferenceFields(ref, 0.22).editedFromReference).toBe(true);
  });
  test("payload carries tax_reference_* and edited_from_reference on wacc.tax_rate; manual entry sends none", () => {
    const ref = appliedTaxRefFrom(tax, 0.209);
    expect(
      toWaccComponentPayload({ key: "wacc.tax_rate", value: 0.22, kind: "user", ...taxReferenceFields(ref, 0.22) }),
    ).toEqual({
      key: "wacc.tax_rate",
      value: 0.22,
      kind: "user",
      edited_from_reference: true,
      tax_reference_bracket_id: "kr-corp-2025.200000000",
      tax_reference_basis: "bracket_estimate",
    });
    const manual = toWaccComponentPayload({
      key: "wacc.tax_rate",
      value: 0.22,
      kind: "user",
      ...taxReferenceFields(null, 0.22),
    });
    expect(manual).toEqual({ key: "wacc.tax_rate", value: 0.22, kind: "user" });
  });
});

describe("observedDeAsTarget", () => {
  test("form value wins; empty or non-numeric form with no suggestion disables the button (null)", () => {
    expect(observedDeAsTarget({ value: "0.85", source: " DART ", asOf: "2025-12-31" })).toEqual({
      value: 0.85,
      source: "DART",
      asOf: "2025-12-31",
    });
    expect(observedDeAsTarget({ value: "", source: "", asOf: "" })).toBeNull();
    expect(observedDeAsTarget({ value: "abc", source: "", asOf: "" })).toBeNull();
    expect(observedDeAsTarget({ value: "0", source: "", asOf: "" })?.value).toBe(0);
  });
  test("falls back to the observed_de reference suggestion", () => {
    const obs: ReferenceSuggestion = { key: "observed_de", value: 1.2, source_label: "DART", as_of: "2025-12-31" };
    expect(observedDeAsTarget({ value: "", source: "", asOf: "" }, obs)).toEqual({
      value: 1.2,
      source: "DART",
      asOf: "2025-12-31",
    });
    expect(observedDeAsTarget({ value: "", source: "", asOf: "" }, { key: "observed_de", value: null })).toBeNull();
  });
  test("source detail joins non-empty parts with a middle dot", () => {
    expect(observedDeSourceDetail({ source: "DART", asOf: "2025-12-31" })).toBe("DART · 2025-12-31");
    expect(observedDeSourceDetail({ source: "", asOf: "2025-12-31" })).toBe("2025-12-31");
    expect(observedDeSourceDetail({ source: "", asOf: "" })).toBe("");
  });
});
