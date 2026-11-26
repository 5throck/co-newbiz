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
  bureauCreditView,
  creditAgencyLinks,
  creditCollectUrl,
  creditCollectVisible,
  creditReferenceFields,
  creditSourceLabel,
  dartFilingUrl,
  disclosedCreditView,
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
const SNAPSHOT_ID = "01JABCDEFGHJKMNPQRSTVWXYZ0";
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
      snapshotId: null,
    });
  });
  test("each rating source maps through unchanged (a disclosed one with its snapshot id)", () => {
    for (const rating_source of ["default", "disclosed", "synthetic"] as const) {
      const e = { ...credit, rating_source, credit_rating_snapshot_id: SNAPSHOT_ID };
      expect(appliedCreditRefFrom(e, 0.03)?.basis).toBe(rating_source);
    }
  });
  test("a disclosed rating carries its evidence snapshot id; other sources never do", () => {
    const disclosed = { ...credit, rating_source: "disclosed" as const, credit_rating_snapshot_id: SNAPSHOT_ID };
    expect(appliedCreditRefFrom(disclosed, 0.03)?.snapshotId).toBe(SNAPSHOT_ID);
    expect(appliedCreditRefFrom({ ...disclosed, rating_source: "default" }, 0.03)?.snapshotId).toBeNull();
  });
  test("a disclosed suggestion without a snapshot id records no basis (the confirmation would be a 400)", () => {
    expect(appliedCreditRefFrom({ ...credit, rating_source: "disclosed" }, 0.03)).toBeNull();
    expect(
      appliedCreditRefFrom({ ...credit, rating_source: "disclosed", credit_rating_snapshot_id: null }, 0.03),
    ).toBeNull();
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
  const ref = { basis: "disclosed" as const, referenceAsOf: "2026-10", appliedValue: 0.03073, snapshotId: SNAPSHOT_ID };
  test("unedited applied value keeps edited_from_reference false", () => {
    expect(creditReferenceFields(ref, 0.03073)).toEqual({
      creditRatingBasis: "disclosed",
      creditRatingSnapshotId: SNAPSHOT_ID,
      referenceAsOf: "2026-10",
      editedFromReference: false,
    });
  });
  test("a default-basis reference sends no snapshot id", () => {
    expect(creditReferenceFields({ ...ref, basis: "default", snapshotId: null }, 0.03073)).toEqual({
      creditRatingBasis: "default",
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
  test("a disclosed rating's payload also carries credit_rating_snapshot_id (the server 400s without it)", () => {
    const applied = appliedCreditRefFrom(
      { ...credit, rating_source: "disclosed", credit_rating_snapshot_id: SNAPSHOT_ID },
      0.03073,
    );
    const p = toWaccComponentPayload({
      key: "wacc.debt_spread",
      value: 0.03073,
      kind: "live",
      ...creditReferenceFields(applied, 0.03073),
    });
    expect(p).toMatchObject({
      credit_rating_basis: "disclosed",
      credit_rating_snapshot_id: SNAPSHOT_ID,
      reference_as_of: "2026-10",
      edited_from_reference: false,
    });
  });
  test("a default-basis payload carries no credit_rating_snapshot_id", () => {
    const p = toWaccComponentPayload({
      key: "wacc.debt_spread",
      value: 0.03073,
      kind: "live",
      ...creditReferenceFields({ ...ref, basis: "default", snapshotId: null }, 0.03073),
    });
    expect(p.credit_rating_basis).toBe("default");
    expect("credit_rating_snapshot_id" in p).toBe(false);
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
  test("a disclosed rating whose spread fell back to the legacy AA- value is excluded with its code", () => {
    const legacyExcluded = [
      { key: "credit_spread", reason_code: "credit_spread_legacy_basis", reason: "legacy spread" },
    ];
    const legacy = {
      ...credit,
      rating_source: "disclosed" as const,
      spread_basis: "aa_minus_legacy" as const,
      anchors: null,
    };
    expect(applicableSuggestions([rf, legacy], legacyExcluded).map((x) => x.key)).toEqual(["risk_free"]);
    expect(missingReferenceItems([rf, legacy], legacyExcluded)).toEqual([
      { key: "credit_spread", reason_code: "credit_spread_legacy_basis", reason: "legacy spread" },
    ]);
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

describe("disclosed rating evidence helpers", () => {
  const disclosed: ReferenceSuggestion = {
    ...credit,
    rating: "AA-",
    rating_source: "disclosed",
    rating_stale: false,
    rating_agencies: [
      { agency: "kis", grade: "AA-", rated_on: "2026-03-20", outlook: "stable" },
      { agency: "nice", grade: "AA", rated_on: "2026-03-18", outlook: null },
    ],
    rating_instrument: "corporate_bond",
    rating_rated_on: "2026-03-20",
    source_rcept_no: "20260331001234",
    credit_rating_snapshot_id: SNAPSHOT_ID,
    rating_evidence_kind: "business_report",
    rating_alternative: {
      rating: "A+",
      rated_on: "2025-05-01",
      stale: true,
      source_rcept_no: "20250502000111",
      evidence_kind: "debt_securities_filing",
    },
    agency_links: [
      { agency: "kis", home_url: "https://www.kisrating.com" },
      { agency: "x", home_url: "javascript:alert(1)" },
      { agency: "y", home_url: "http://insecure.example" },
    ],
  };
  test("DART viewer link only for a 14-digit receipt number, https", () => {
    expect(dartFilingUrl("20260331001234")).toBe("https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260331001234");
    for (const bad of ["2026033100123", "2026033100123x", "20260331001234/../x", "", null, undefined]) {
      expect(dartFilingUrl(bad)).toBeNull();
    }
  });
  test("agency links keep https only", () => {
    expect(creditAgencyLinks(disclosed)).toEqual([{ agency: "kis", href: "https://www.kisrating.com" }]);
    expect(creditAgencyLinks(credit)).toEqual([]);
  });
  test("view of a disclosed rating: agencies, dates, filing links, stale flag, alternative", () => {
    const v = disclosedCreditView(disclosed);
    expect(v?.rating).toBe("AA-");
    expect(v?.agencies).toHaveLength(2);
    expect(v?.ratedOn).toBe("2026-03-20");
    expect(v?.filingUrl).toContain("rcpNo=20260331001234");
    expect(v?.stale).toBe(false);
    expect(v?.alternative).toMatchObject({ rating: "A+", stale: true });
    expect(v?.alternative?.filingUrl).toContain("rcpNo=20250502000111");
    expect(disclosedCreditView({ ...disclosed, rating_stale: true })?.stale).toBe(true);
  });
  test("no evidence view for a default or synthetic rating, or another key", () => {
    expect(disclosedCreditView({ ...disclosed, rating_source: "default" })).toBeNull();
    expect(disclosedCreditView({ ...disclosed, rating_source: "synthetic" })).toBeNull();
    expect(disclosedCreditView({ ...disclosed, key: "risk_free" })).toBeNull();
  });
  test("collect button: offered on collect_hint or a stale disclosed rating, never otherwise", () => {
    expect(creditCollectVisible({ ...credit, collect_hint: true })).toBe(true);
    expect(creditCollectVisible({ ...disclosed, rating_stale: true })).toBe(true);
    expect(creditCollectVisible(disclosed)).toBe(false);
    expect(creditCollectVisible({ ...credit, collect_hint: false })).toBe(false);
    expect(creditCollectVisible(undefined)).toBe(false);
    expect(creditCollectVisible({ ...credit, key: "risk_free", collect_hint: true })).toBe(false);
  });
  test("bureau basis: evidence view, snapshot id required and carried on apply, collect offered when stale", () => {
    const bureau: ReferenceSuggestion = {
      ...credit,
      rating: "BB+",
      rating_source: "bureau",
      rating_stale: false,
      rating_rated_on: "2024-12-31",
      source_rcept_no: "20260318001708",
      credit_rating_snapshot_id: SNAPSHOT_ID,
      rating_evidence_kind: "business_report",
      rating_bureau: {
        agency: "ecredible",
        agency_raw: "ecredible",
        agency_carried: false,
        cashflow_grade: "B",
        rows: [{ agency: "ecredible", agency_raw: "ecredible", grade: "BB+", cashflow_grade: "B" }],
      },
    };
    expect(bureauCreditView(bureau)).toMatchObject({ rating: "BB+", ratedOn: "2024-12-31", stale: false });
    expect(bureauCreditView(bureau)?.filingUrl).toContain("rcpNo=20260318001708");
    expect(bureauCreditView({ ...bureau, rating_source: "disclosed" })).toBeNull();
    expect(bureauCreditView({ ...bureau, rating_bureau: null })).toBeNull();
    expect(disclosedCreditView(bureau)).toBeNull();
    const ref = appliedCreditRefFrom(bureau, 0.05);
    expect(ref).toMatchObject({ basis: "bureau", snapshotId: SNAPSHOT_ID });
    expect(creditReferenceFields(ref, 0.05)).toMatchObject({
      creditRatingBasis: "bureau",
      creditRatingSnapshotId: SNAPSHOT_ID,
    });
    expect(appliedCreditRefFrom({ ...bureau, credit_rating_snapshot_id: null }, 0.05)).toBeNull();
    expect(creditCollectVisible({ ...bureau, rating_stale: true })).toBe(true);
    expect(creditCollectVisible(bureau)).toBe(false);
  });
  test("collect URL is scoped to the selected target like the suggestions GET", () => {
    expect(creditCollectUrl("p1")).toBe("/api/projects/p1/wacc/credit-rating/collect");
    expect(creditCollectUrl("p1", "t 1")).toBe("/api/projects/p1/wacc/credit-rating/collect?target_id=t%201");
    expect(creditCollectUrl("p1", null)).toBe("/api/projects/p1/wacc/credit-rating/collect");
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
    "collectCreditRun",
    "collectCreditRunning",
    "collectCreditDone",
    "collectCreditFailed",
    "collectCreditStartFailed",
    "collectCreditNoSubject",
    "creditReasonNotCollected",
    "creditReasonDisclosed",
    "creditReasonLegacyBasis",
    "creditDisclosedTitle",
    "creditDisclosedAgencies",
    "creditAgencyKoreaRatings",
    "creditAgencyKis",
    "creditAgencyNice",
    "creditAgencyRow",
    "creditOutlookLine",
    "creditOutlookStable",
    "creditOutlookPositive",
    "creditOutlookNegative",
    "creditOutlookDeveloping",
    "creditInstrumentLine",
    "creditInstrumentCorporateBond",
    "creditRatedOnLine",
    "creditEvidenceBusinessReport",
    "creditEvidenceDebtFiling",
    "creditEvidenceLine",
    "creditFilingLink",
    "creditAlternativeNote",
    "creditAlternativeStale",
    "creditAgencyLinksLabel",
    "creditStatusParsed",
    "creditStatusNotCollected",
    "creditStatusNotDisclosed",
    "creditStatusSectionPresentNoBondRating",
    "creditStatusSectionAbsent",
    "creditStatusParseFailed",
    "creditStatusNotZip",
    "creditStatusNoBondRating",
    "creditStatusNoDartCode",
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
      for (const c of ["dart_api_key_missing", "no_dart_corp_code", "no_subject_company", "already_running"]) {
        expect(typeof m.errors.codes[c]).toBe("string");
      }
      for (const k of ["risk_free", "credit_spread", "observed_de", "beta_levered"]) {
        expect(typeof m.pages.companyFinancials.waccLabel[k]).toBe("string");
      }
    });
  }
});

describe("WACC panel wiring of the disclosed credit rating (static)", () => {
  const panel = readFileSync("app/web-next/components/wacc/WaccPanel.tsx", "utf8");
  const evidence = readFileSync("app/web-next/components/wacc/CreditRatingEvidence.tsx", "utf8");
  test("collect button reuses useCollectRun on the credit-rating endpoint, reloads suggestions, sits in the analyst block", () => {
    expect(panel).toMatch(/useCollectRun\(creditCollectUrl\(projectId, selectedTarget\)[\s\S]{0,80}loadSugg\(\)/);
    expect(panel).toContain("creditCollectNeeded(creditSugg)");
    const gate = panel.indexOf("{canAct && (\n        <>");
    expect(panel.indexOf('actionTestId: "credit-collect"')).toBeGreaterThan(gate);
  });
  test("every backend reason code and disclosed_status value is localized in the panel", () => {
    for (const code of [
      "rating_not_collected",
      "credit_rating_stale",
      "credit_spread_legacy_basis",
      "credit_rating_default_basis",
      "disclosed_rating",
      "bureau_issuer_rating",
      "credit_rating_bureau_basis",
    ]) {
      expect(panel).toContain(`${code}: t(`);
    }
    for (const status of [
      "parsed",
      "not_disclosed",
      "section_present_no_bond_rating",
      "section_absent",
      "parse_failed",
      "not_zip",
    ]) {
      expect(panel).toContain(`${status}: t(`);
    }
    expect(panel).toContain("<CreditRatingEvidence");
  });
  test("evidence block opens external links in a new tab with an sr-only hint, via the https-only helpers", () => {
    expect(evidence).toContain('target="_blank"');
    expect(evidence).toContain('rel="noreferrer"');
    expect(evidence).toContain('className="sr-only"');
    expect(evidence).toContain("disclosedCreditView(");
    expect(evidence).toContain("creditAgencyLinks(");
  });
});
