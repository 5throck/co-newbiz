// @version 1.0.0
/**
 * Reference-data collection block of the WACC panel: row status derivation, the button emphasis rule,
 * the credit-reason -> collect-row link rule, and the panel/locale wiring (static).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  collectEmphasis,
  collectRowId,
  creditCollectAvailable,
  creditCollectNeeded,
  creditReasonLinksToCollect,
  creditRowStatus,
  ecosCollectNeeded,
  ecosRowStatus,
  financialsCollectNeeded,
  financialsRowStatus,
  kofiaCollectNeeded,
  kofiaRowStatus,
  kofiaRowVisible,
} from "../../app/web-next/lib/wacc-collect-rows.ts";
import type { ReferenceSuggestion } from "../../app/web-next/lib/wacc-reference-items.ts";

const rf: ReferenceSuggestion = { key: "risk_free", value: 3.86, as_of: "2026-10" };
const credit = (over: Partial<ReferenceSuggestion> = {}): ReferenceSuggestion => ({
  key: "credit_spread",
  value: 0.69,
  as_of: "2026-10",
  ...over,
});

describe("collectEmphasis", () => {
  test("primary only when the data is needed", () => {
    expect(collectEmphasis(true)).toBe("primary");
    expect(collectEmphasis(false)).toBe("secondary");
  });
});

describe("ecosCollectNeeded / ecosRowStatus", () => {
  test("needed when the risk-free rate is missing", () => {
    expect(ecosCollectNeeded([{ key: "risk_free", value: null, reason_code: "x" }, credit()])).toBe(true);
    expect(ecosRowStatus([{ key: "risk_free", value: null }])).toEqual({ kind: "missing" });
  });
  test("needed when the credit spread has no ECOS series; other credit misses do not make it primary", () => {
    expect(ecosCollectNeeded([rf, credit({ value: null, reason_code: "no_ecos_observations" })])).toBe(true);
    expect(ecosCollectNeeded([rf, credit({ value: null, reason_code: "rating_not_collected" })])).toBe(false);
  });
  test("collected state carries the as-of month, falling back to the credit anchors", () => {
    expect(ecosCollectNeeded([rf, credit()])).toBe(false);
    expect(ecosRowStatus([rf, credit()])).toEqual({ kind: "collected", asOf: "2026-10" });
    const noDate: ReferenceSuggestion = { key: "risk_free", value: 3.8 };
    expect(ecosRowStatus([noDate])).toEqual({ kind: "collected", asOf: null });
  });
});

describe("creditRowStatus", () => {
  test("not collected / no DART code / no suggestion", () => {
    expect(creditRowStatus(credit({ disclosed_status: "rating_not_collected", collect_hint: true }))).toEqual({
      kind: "not_collected",
    });
    expect(creditRowStatus(credit({ disclosed_status: "no_dart_corp_code" }))).toEqual({ kind: "no_dart_code" });
    expect(creditRowStatus(undefined)).toEqual({ kind: "not_collected" });
  });
  test("disclosed rating with its date and staleness", () => {
    expect(
      creditRowStatus(
        credit({ rating: "AA-", rating_source: "disclosed", rating_rated_on: "2026-03-31", rating_stale: true }),
      ),
    ).toEqual({
      kind: "rated",
      source: "disclosed",
      rating: "AA-",
      ratedOn: "2026-03-31",
      stale: true,
      bondRatingMissing: false,
    });
  });
  test("bureau rating after a disclosure without bond rating says so", () => {
    expect(
      creditRowStatus(credit({ rating: "BBB", rating_source: "bureau", disclosed_status: "no_bond_rating" })),
    ).toMatchObject({ kind: "rated", source: "bureau", rating: "BBB", ratedOn: null, bondRatingMissing: true });
  });
  test("a collected disclosure without a rating and no fallback keeps the filing's reason", () => {
    expect(creditRowStatus(credit({ rating_source: "default", disclosed_status: "section_absent" }))).toEqual({
      kind: "no_rating",
      statusCode: "section_absent",
    });
    expect(creditRowStatus(credit({ rating_source: "default" }))).toEqual({ kind: "default_basis" });
  });
});

describe("credit collect emphasis, availability and reason link", () => {
  test("primary only when collect_hint; a stale rating from an already-read filing stays secondary", () => {
    expect(creditCollectNeeded(credit({ collect_hint: true }))).toBe(true);
    expect(creditCollectNeeded(credit({ rating_source: "disclosed", rating_stale: true }))).toBe(false);
    expect(creditCollectNeeded(credit({ rating_source: "bureau", rating_stale: true }))).toBe(false);
    expect(creditCollectNeeded(credit({ rating_source: "disclosed", rating_stale: false }))).toBe(false);
    expect(collectEmphasis(creditCollectNeeded(credit()))).toBe("secondary");
  });
  test("no action without a DART code", () => {
    expect(creditCollectAvailable(credit({ disclosed_status: "no_dart_corp_code" }))).toBe(false);
    expect(creditCollectAvailable(credit())).toBe(true);
    expect(creditCollectAvailable(undefined)).toBe(false);
  });
  test("reason text links to the collect row when collection could help, never without a DART code", () => {
    expect(creditReasonLinksToCollect(credit({ reason_code: "rating_not_collected" }))).toBe(true);
    expect(creditReasonLinksToCollect(credit({ reason_code: "credit_spread_legacy_basis", collect_hint: true }))).toBe(
      true,
    );
    expect(creditReasonLinksToCollect(credit({ reason_code: "disclosed_rating" }))).toBe(false);
    expect(
      creditReasonLinksToCollect(
        credit({ reason_code: "rating_not_collected", disclosed_status: "no_dart_corp_code" }),
      ),
    ).toBe(false);
    expect(creditReasonLinksToCollect(undefined)).toBe(false);
  });
});

describe("panel and locale wiring (static)", () => {
  const panel = readFileSync("app/web-next/components/wacc/WaccPanel.tsx", "utf8");
  test("row ids and testids are wired and the link targets the credit row", () => {
    expect(collectRowId("credit")).toBe("wacc-collect-row-credit");
    expect(panel).toContain("wacc-collect-row-$" + "{o.key}");
    expect(panel).toContain('data-testid="wacc-collect-block"');
    expect(panel).toContain('collectLink("credit")');
  });
  test("the old stacked primary buttons are gone", () => {
    expect(panel).not.toContain("missingEcos");
  });
  const keys = [
    "collectBlockTitle",
    "collectBlockHint",
    "collectFillsLabel",
    "collectSourceLabel",
    "collectStatusLabel",
    "collectEcosName",
    "collectEcosFills",
    "collectEcosSource",
    "collectCreditName",
    "collectCreditFills",
    "collectCreditSource",
    "collectRowRun",
    "collectRowRerun",
    "collectEcosRerun",
    "collectCreditRerun",
    "collectStatusEcosCollected",
    "collectStatusEcosCollectedNoDate",
    "collectStatusEcosMissing",
    "collectStatusCreditNotCollected",
    "collectStatusCreditNoDartCode",
    "collectStatusCreditDisclosed",
    "collectStatusCreditBureau",
    "collectStatusCreditBureauNoBond",
    "collectStatusRatedOn",
    "collectStatusStale",
    "collectStatusCreditDefault",
    "collectLastRun",
    "collectGoToArea",
    // slice 3: synthetic status and the financial re-sync row
    "collectStatusCreditSynthetic",
    "collectStatusCreditCoverage",
    "collectFinancialsName",
    "collectFinancialsFills",
    "collectFinancialsSource",
    "collectFinancialsRun",
    "collectFinancialsRerun",
    "collectFinancialsRunning",
    "collectFinancialsDone",
    "collectFinancialsFailed",
    "collectStatusFinancialsNeeded",
    "collectStatusFinancialsOk",
  ];
  for (const l of ["en", "ko"]) {
    test(`${l}: collect block keys exist`, () => {
      const m = JSON.parse(readFileSync(`app/web-next/locales/${l}.json`, "utf8"));
      const p = m.stages.s8.wacc.waccPanel;
      for (const k of keys) expect(typeof p[k]).toBe("string");
    });
  }
});

describe("slice 3: synthetic status and the financial re-sync row", () => {
  const syn = {
    available: true as const,
    used: true,
    rating: "A",
    coverage_x: 4.5,
    interest_source: "interest_expense" as const,
    interest_is_proxy: false,
    fiscal_year: 2025,
    table_id: "t",
    table_as_of: "2026-01-01",
    published_label: "A2/A",
    band_lower_x: 4.25,
    band_upper_x: 5.5,
    operating_income_krw_million: 450000,
    interest_expense_krw_million: 100000,
    loss_making: false,
    note: "",
  };
  const needHint = {
    available: false as const,
    used: false as const,
    reason_code: "synthetic_interest_not_collected",
    reason: "x",
    resync_hint: true,
  };

  test("creditRowStatus: a synthetic rating in use reports itself with coverage and year", () => {
    expect(creditRowStatus(credit({ rating: "A", rating_source: "synthetic", synthetic: syn }))).toEqual({
      kind: "synthetic",
      rating: "A",
      coverageX: 4.5,
      fiscalYear: 2025,
    });
    expect(creditRowStatus(credit({ rating: "A", rating_source: "synthetic", synthetic: null }))).toMatchObject({
      kind: "synthetic",
      coverageX: null,
    });
  });

  test("a disclosed rating still reports as rated, whatever the synthetic evaluation says", () => {
    expect(creditRowStatus(credit({ rating: "A+", rating_source: "disclosed", synthetic: syn }))).toMatchObject({
      kind: "rated",
    });
  });

  test("financials row: needed only when the backend asks for a re-sync", () => {
    expect(financialsCollectNeeded(credit({ rating_source: "default", synthetic: needHint }))).toBe(true);
    expect(financialsRowStatus(credit({ synthetic: needHint }))).toEqual({ kind: "resync_needed" });
    expect(financialsCollectNeeded(credit({ synthetic: { ...needHint, resync_hint: false } }))).toBe(false);
    expect(financialsCollectNeeded(credit({ synthetic: syn }))).toBe(false);
    expect(financialsCollectNeeded(credit())).toBe(false);
    expect(financialsCollectNeeded(undefined)).toBe(false);
    expect(financialsRowStatus(credit({ synthetic: syn }))).toEqual({ kind: "synced" });
    expect(financialsCollectNeeded({ ...credit({ synthetic: needHint }), key: "risk_free" })).toBe(false);
  });

  test("the row key has a stable DOM id and the panel wires the financial sync endpoint", () => {
    expect(collectRowId("financials")).toBe("wacc-collect-row-financials");
    const panel = readFileSync("app/web-next/components/wacc/WaccPanel.tsx", "utf8");
    expect(panel).toContain("/api/companies/${encodeURIComponent(finCompanyId)}/sync");
    expect(panel).toContain('key: "financials"');
  });
});

describe("slice 4: the KOFIA grade-yield row exists only when the switch is on", () => {
  test("hidden unless the server reports the collection enabled AND there is a credit suggestion", () => {
    expect(kofiaRowVisible(undefined, credit())).toBe(false); // payload from before the switch existed
    expect(kofiaRowVisible(false, credit())).toBe(false); // switch off (default)
    expect(kofiaRowVisible(true, undefined)).toBe(false);
    expect(kofiaRowVisible(true, { key: "risk_free", value: 3.8 })).toBe(false);
    expect(kofiaRowVisible(true, credit())).toBe(true);
  });
  test("primary emphasis until something was collected; status carries the date and whether it feeds the spread", () => {
    expect(kofiaCollectNeeded(credit())).toBe(true);
    expect(kofiaRowStatus(credit())).toEqual({ kind: "not_collected" });
    const used = credit({ kofia_latest_date: "2026-11-26", spread_basis: "kofia_grade" });
    expect(kofiaCollectNeeded(used)).toBe(false);
    expect(kofiaRowStatus(used)).toEqual({ kind: "collected", date: "2026-11-26", used: true });
    expect(kofiaRowStatus(credit({ kofia_latest_date: "2026-11-26", spread_basis: "ecos_interpolated" }))).toEqual({
      kind: "collected",
      date: "2026-11-26",
      used: false,
    });
    expect(collectRowId("kofia")).toBe("wacc-collect-row-kofia");
  });
  test("the panel renders the row only through kofiaRowVisible(sugg.kofia_collect?.enabled, ...)", () => {
    const panel = readFileSync("app/web-next/components/wacc/WaccPanel.tsx", "utf8");
    expect(panel).toContain("kofiaRowVisible(sugg.kofia_collect?.enabled, creditSugg)");
    expect(panel).toContain('key: "kofia"');
  });
  const keys = [
    "creditBasisKofia",
    "collectKofiaName",
    "collectKofiaFills",
    "collectKofiaSource",
    "collectKofiaRun",
    "collectKofiaRerun",
    "collectKofiaRunning",
    "collectKofiaDone",
    "collectKofiaFailed",
    "collectKofiaStartFailed",
    "collectStatusKofiaNotCollected",
    "collectStatusKofiaCollected",
    "collectStatusKofiaUsed",
    "collectStatusKofiaNotUsed",
  ];
  for (const l of ["en", "ko"]) {
    test(`${l}: KOFIA row keys exist`, () => {
      const m = JSON.parse(readFileSync(`app/web-next/locales/${l}.json`, "utf8"));
      for (const k of keys) expect(typeof m.stages.s8.wacc.waccPanel[k]).toBe("string");
    });
  }
  test("ko basis chip text is the agreed label", () => {
    const m = JSON.parse(readFileSync("app/web-next/locales/ko.json", "utf8"));
    expect(m.stages.s8.wacc.waccPanel.creditBasisKofia).toBe("등급별 수익률(금융투자협회)");
  });
});
