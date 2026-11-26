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
  crosscheckUnreliable,
  crosscheckView,
  dartFilingUrl,
  disclosedCreditView,
  financialResyncNeeded,
  formatCreditAnchorPct,
  issuanceEvidenceRows,
  kdKeWarning,
  missingReferenceItems,
  reasonByCode,
  syntheticCreditView,
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

// ---------------------------------------------------------------------------------------------------------------
// Slice 3: synthetic rung, cost-of-debt cross-check, issuance evidence, financial re-sync hint.
// ---------------------------------------------------------------------------------------------------------------
const synAvailable = {
  available: true as const,
  used: true,
  rating: "A",
  coverage_x: 4.5,
  interest_source: "finance_costs" as const,
  interest_is_proxy: true,
  fiscal_year: 2025,
  table_id: "damodaran-large-non-financial-2026-01",
  table_as_of: "2026-01-01",
  published_label: "A2/A",
  band_lower_x: 4.25,
  band_upper_x: 5.5,
  operating_income_krw_million: 450000,
  interest_expense_krw_million: 100000,
  loss_making: false,
  note: "n",
};
const syntheticCredit: ReferenceSuggestion = {
  ...credit,
  rating: "A",
  rating_source: "synthetic",
  value: 1.454,
  synthetic: synAvailable,
  rating_superseded: { basis: "disclosed", rating: "AA-", rated_on: "2024-05-01", source_rcept_no: "20250310000001" },
};
const xcheck = {
  status: "warn" as const,
  reason_code: null,
  reason: null,
  implied_cost_pct: 10,
  market_kd_pct: 5.315,
  gap_pp: -4.685,
  direction: "market_below_actual" as const,
  interest_source: "interest_expense" as const,
  fiscal_year: 2025,
  interest_expense_krw_million: 100000,
  avg_debt_krw_million: 1000000,
  debt_basis: "two_year_average" as const,
  warn_gap_pp: 2,
};

describe("slice 3: synthetic credit view and apply", () => {
  test("syntheticCreditView only for a synthetic rating in use, with the superseded rating", () => {
    expect(syntheticCreditView(syntheticCredit)).toMatchObject({
      rating: "A",
      coverageX: 4.5,
      interestSource: "finance_costs",
      interestIsProxy: true,
      fiscalYear: 2025,
      lossMaking: false,
      publishedLabel: "A2/A",
      operatingIncomeKrwMillion: 450000,
      interestExpenseKrwMillion: 100000,
      superseded: { basis: "disclosed", rating: "AA-" },
    });
    expect(syntheticCreditView({ ...syntheticCredit, rating_source: "disclosed" })).toBeNull();
    expect(syntheticCreditView({ ...syntheticCredit, synthetic: null })).toBeNull();
    expect(
      syntheticCreditView({
        ...syntheticCredit,
        synthetic: { available: false, used: false, reason_code: "x", reason: "y", resync_hint: false },
      }),
    ).toBeNull();
    expect(syntheticCreditView({ ...syntheticCredit, key: "risk_free" })).toBeNull();
  });

  test("applying a synthetic rating records basis synthetic with the ECOS month and NO snapshot id", () => {
    const ratio = suggestionToInputValue("credit_spread", syntheticCredit.value);
    expect(appliedCreditRefFrom(syntheticCredit, ratio)).toEqual({
      basis: "synthetic",
      referenceAsOf: "2026-10",
      appliedValue: 0.01454,
      snapshotId: null,
    });
    const ref = appliedCreditRefFrom(syntheticCredit, ratio);
    expect(creditReferenceFields(ref, 0.01454)).toEqual({
      creditRatingBasis: "synthetic",
      referenceAsOf: "2026-10",
      editedFromReference: false,
    });
    expect(creditReferenceFields(ref, 0.02)).toMatchObject({
      creditRatingBasis: "synthetic",
      editedFromReference: true,
    });
    expect(creditSourceLabel(syntheticCredit)).toContain("A (synthetic, ecos_interpolated)");
  });

  test("a synthetic suggestion is skipped by apply-all when the server lists it (credit_rating_synthetic_basis) and is reported as missing", () => {
    const excluded = [{ key: "credit_spread", reason_code: "credit_rating_synthetic_basis", reason: "x" }];
    expect(applicableSuggestions([syntheticCredit], excluded)).toHaveLength(0);
    expect(missingReferenceItems([syntheticCredit], excluded)[0]?.reason_code).toBe("credit_rating_synthetic_basis");
    // individually applicable: the apply path still records the synthetic basis
    expect(appliedCreditRefFrom(syntheticCredit, 0.01454)?.basis).toBe("synthetic");
  });
});

describe("slice 3: cross-check view, issuance rows and the re-sync hint", () => {
  test("crosscheckView carries the far-below reason code of a warning", () => {
    const far = {
      ...xcheck,
      direction: "market_above_actual" as const,
      gap_pp: 6.7,
      reason_code: "crosscheck_implied_far_below_market",
    };
    expect(crosscheckView({ ...syntheticCredit, crosscheck: far })).toMatchObject({
      status: "warn",
      reasonCode: "crosscheck_implied_far_below_market",
    });
    expect(crosscheckView({ ...syntheticCredit, crosscheck: xcheck })?.reasonCode).toBeNull();
  });

  test("crosscheckView: ok and warn are shown; unreliable and unavailable are not a gap line", () => {
    expect(crosscheckView({ ...syntheticCredit, crosscheck: xcheck })).toMatchObject({
      status: "warn",
      impliedPct: 10,
      marketKdPct: 5.315,
      gapPp: -4.685,
      direction: "market_below_actual",
      warnGapPp: 2,
      debtBasis: "two_year_average",
    });
    expect(crosscheckView({ ...syntheticCredit, crosscheck: { ...xcheck, status: "ok", gap_pp: 0.5 } })?.status).toBe(
      "ok",
    );
    const unreliable = {
      ...xcheck,
      status: "unreliable" as const,
      gap_pp: null,
      direction: null,
      reason_code: "crosscheck_unreliable_non_positive_debt",
    };
    expect(crosscheckView({ ...syntheticCredit, crosscheck: unreliable })).toBeNull();
    expect(crosscheckUnreliable({ ...syntheticCredit, crosscheck: unreliable })).toMatchObject({
      status: "unreliable",
    });
    const unavailable = {
      ...xcheck,
      status: "unavailable" as const,
      implied_cost_pct: null,
      gap_pp: null,
      direction: null,
    };
    expect(crosscheckView({ ...syntheticCredit, crosscheck: unavailable })).toBeNull();
    expect(crosscheckUnreliable({ ...syntheticCredit, crosscheck: unavailable })).toBeNull();
    expect(crosscheckView({ ...syntheticCredit, crosscheck: null })).toBeNull();
    expect(crosscheckView({ ...syntheticCredit, key: "risk_free", crosscheck: xcheck })).toBeNull();
  });

  test("issuanceEvidenceRows: only when the table was read and has recent issues", () => {
    const row = {
      issued_on: "2026-03-10",
      amount_krw_million: 200000,
      coupon_pct: 4.35,
      rating_raw: "A+",
      maturity_on: "2029-03-10",
      outstanding: true,
      source_rcept_no: "20260310000001",
    };
    expect(
      issuanceEvidenceRows({ ...syntheticCredit, issuance_status: "available", issuance_evidence: [row] }),
    ).toEqual([row]);
    expect(
      issuanceEvidenceRows({ ...syntheticCredit, issuance_status: "issues_unavailable", issuance_evidence: [row] }),
    ).toEqual([]);
    expect(
      issuanceEvidenceRows({ ...syntheticCredit, issuance_status: "none_in_window", issuance_evidence: [] }),
    ).toEqual([]);
    expect(issuanceEvidenceRows({ ...syntheticCredit })).toEqual([]);
  });

  test("financialResyncNeeded follows the backend's resync_hint, nothing else", () => {
    const hint = {
      available: false as const,
      used: false as const,
      reason_code: "synthetic_interest_not_collected",
      reason: "r",
      resync_hint: true,
    };
    expect(financialResyncNeeded({ ...credit, synthetic: hint })).toBe(true);
    expect(financialResyncNeeded({ ...credit, synthetic: { ...hint, resync_hint: false } })).toBe(false);
    expect(financialResyncNeeded({ ...credit, synthetic: synAvailable })).toBe(false);
    expect(financialResyncNeeded({ ...credit, synthetic: null })).toBe(false);
    expect(financialResyncNeeded(undefined)).toBe(false);
  });
});

describe("slice 3: locale wiring (static)", () => {
  const keys = [
    "creditSourceSynthetic",
    "creditSyntheticLossChip",
    "creditCrosscheckWarnChip",
    "creditReasonSyntheticRating",
    "creditReasonSyntheticFinancial",
    "creditReasonSyntheticNoFinancials",
    "creditReasonSyntheticNotCollected",
    "creditReasonSyntheticNoInterest",
    "creditReasonSyntheticNoTable",
    "creditSyntheticTitle",
    "creditSyntheticCoverageLine",
    "creditSyntheticTableLine",
    "creditSyntheticProxyNote",
    "creditSyntheticLossLine",
    "creditSyntheticEstimateNote",
    "creditSupersededLine",
    "creditSupersededBasisDisclosed",
    "creditSupersededBasisBureau",
    "creditCrosscheckFarBelow",
    "creditCrosscheckFarBelowReason",
    "creditReasonSyntheticBasis",
    "creditInterestSourceExpense",
    "creditInterestSourcePaid",
    "creditInterestSourceFinanceCosts",
    "creditCrosscheckTitle",
    "creditCrosscheckLine",
    "creditDebtBasisAverage",
    "creditDebtBasisYearEnd",
    "creditCrosscheckMarketAbove",
    "creditCrosscheckMarketBelow",
    "creditCrosscheckWarnLine",
    "creditCrosscheckOkLine",
    "creditCrosscheckProxyNote",
    "creditCrosscheckNote",
    "creditCrosscheckUnreliable",
    "creditCrosscheckUnavailableFinancial",
    "creditCrosscheckUnavailableNoInterest",
    "creditCrosscheckUnavailableNoDebt",
    "creditCrosscheckUnavailableNoKd",
    "creditIssuanceTitle",
    "creditIssuanceRow",
    "creditIssuanceNote",
  ];
  for (const l of ["en", "ko"]) {
    test(`${l}: every slice-3 key exists and the source chip names the interest-coverage estimate`, () => {
      const m = JSON.parse(readFileSync(`app/web-next/locales/${l}.json`, "utf8"));
      const p = m.stages.s8.wacc.waccPanel;
      for (const k of keys) expect(typeof p[k]).toBe("string");
      expect(p.creditSourceSynthetic).toBe(l === "ko" ? "이자보상배율 추정" : "Interest-coverage estimate");
    });
  }
  test("every backend reason code the panel maps has a localized label (no raw code reaches the user)", () => {
    const panel = readFileSync("app/web-next/components/wacc/WaccPanel.tsx", "utf8");
    for (const code of [
      "synthetic_rating",
      "synthetic_not_applicable_financial",
      "synthetic_no_financials",
      "synthetic_interest_not_collected",
      "synthetic_no_interest_expense",
      "crosscheck_unavailable_no_debt_rows",
      "crosscheck_unreliable_non_positive_debt",
      "crosscheck_implied_far_below_market",
      "credit_rating_synthetic_basis",
    ]) {
      expect(panel).toContain(`${code}:`);
    }
  });
});
