// @version 1.0.0
/**
 * ADR-0208 slice 4 - the KOFIA grade-yield parser (db/lib/kofia-grade-yield.ts), pure, over fixtures that are
 * trimmed copies of real service answers read on 2026-11-27 (tests/fixtures/kofia/*.xml; the client IP of the response
 * header was removed). No network. Covers the request bodies, the latest-date answer, the column heads, the day parse
 * (KTB 3y of the same answer, the ten AAA..BBB- public-offering unsecured grades, AA0/A0/BBB0 spelling, decoy rows of
 * other bond types ignored), layout-drift failures (never a silent zero) and the collection switch value.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KOFIA_GRADES,
  KOFIA_KTB_SERIES_ID,
  KofiaParseError,
  buildKofiaRequest,
  kofiaCollectEnabledFrom,
  kofiaGradeSeriesId,
  normalizeKofiaGrade,
  parseKofiaDay,
  parseKofiaHeadList,
  parseKofiaMaxDate,
} from "../../db/lib/kofia-grade-yield.ts";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "..", "fixtures", "kofia", name), "utf8");
const MAX = fx("get-exist-max-date.xml");
const HEAD = fx("get-head-list.xml");
const DAY = fx("select-day-average.xml");

describe("requests", () => {
  test("getExistMaxDate: app, service and function of the page's own call, empty DTO", () => {
    const x = buildKofiaRequest("getExistMaxDate");
    expect(x).toContain("<pfmAppName>BIS-KOFIABOND</pfmAppName>");
    expect(x).toContain("<pfmSvcName>BISBndSrtPrcSrchSO</pfmSvcName>");
    expect(x).toContain("<pfmFnName>getExistMaxDate</pfmFnName>");
    expect(x).toContain("<BISComDspDatDTO></BISComDspDatDTO>");
  });
  test("selectDay: valuation-firm average (A20000) with all five firms and the date", () => {
    const x = buildKofiaRequest("selectDay", "20261126");
    expect(x).toContain("<standardDt>20261126</standardDt>");
    expect(x).toContain("<reportCompCd>A20000</reportCompCd>");
    expect(x).toContain("<applyGbCd>C00</applyGbCd>");
    for (const [i, c] of ["A10002", "A10003", "A10004", "A10005", "A10006"].entries()) {
      expect(x).toContain(`<val${i + 1}>${c}</val${i + 1}>`);
    }
  });
  test("getHeadList: date and applyGbCd only; a date with markup characters is escaped", () => {
    const x = buildKofiaRequest("getHeadList", "2026<&>");
    expect(x).toContain("<applyGbCd>C00</applyGbCd>");
    expect(x).toContain("2026&lt;&amp;&gt;");
    expect(x).not.toContain("<reportCompCd>");
  });
});

describe("responses", () => {
  test("getExistMaxDate -> the latest published date", () => {
    expect(parseKofiaMaxDate(MAX)).toBe("2026-11-26");
  });
  test("getHeadList -> 16 maturity columns, 3y has attrCd 0300 at position 8", () => {
    const head = parseKofiaHeadList(HEAD);
    expect(head).toHaveLength(16);
    expect(head[0]).toEqual({ attrCd: "0003", label: "3월" });
    expect(head.findIndex((c) => c.attrCd === "0300")).toBe(7);
  });
  test("selectDay -> KTB 3y and the ten grades at the 3y column, flat notches normalised", () => {
    const snap = parseKofiaDay(DAY, HEAD, "2026-11-26");
    expect(snap.date).toBe("2026-11-26");
    expect(snap.ktbPct).toBe(3.612);
    expect(snap.grades).toEqual({
      AAA: 4.088,
      "AA+": 4.184,
      AA: 4.223, // KOFIA writes AA0
      "AA-": 4.274,
      "A+": 4.66,
      A: 4.934, // A0
      "A-": 5.39,
      "BBB+": 7.658,
      BBB: 8.709, // BBB0
      "BBB-": 10.07,
    });
    expect(Object.keys(snap.grades).sort()).toEqual([...KOFIA_GRADES].sort());
    expect(snap.warnings).toEqual([]);
  });
  test("decoy rows (guaranteed corporate, private placement, financial bonds, special bonds) never leak into the grades", () => {
    const snap = parseKofiaDay(DAY, HEAD, "2026-11-26");
    // the fixture carries 6010122 (financial II AA0 = 4.195), 8010120 (private AA = 4.442), 3040121 (special AA+ = 4.064)
    expect(Object.values(snap.grades)).not.toContain(4.195);
    expect(Object.values(snap.grades)).not.toContain(4.442);
    expect(Object.values(snap.grades)).not.toContain(4.064);
    expect(Object.values(snap.grades)).not.toContain(3.983);
  });
  test("the column comes from the head list, not from a fixed position", () => {
    // a head list without the first column moves 3y to position 7: the parser then reads val7
    const shifted = HEAD.replace(/<BISBndSrtPrcDayDTO>\s*<attrCd>0003<\/attrCd>[\s\S]*?<\/BISBndSrtPrcDayDTO>/, "");
    expect(parseKofiaHeadList(shifted).findIndex((c) => c.attrCd === "0300")).toBe(6);
    const snap = parseKofiaDay(DAY, shifted, "2026-11-26");
    expect(snap.ktbPct).toBe(3.607); // val7 of the KTB row
  });
  test("normalizeKofiaGrade", () => {
    expect(["AA0", "A0", "BBB0", "AA-", "BBB+", "A+", "A"].map(normalizeKofiaGrade)).toEqual([
      "AA",
      "A",
      "BBB",
      "AA-",
      "BBB+",
      "A+",
      "A",
    ]);
  });
});

describe("layout drift fails loudly", () => {
  test("an HTML or error page is not a service response", () => {
    const html = "<html><body>error</body></html>";
    expect(() => parseKofiaMaxDate(html)).toThrow(KofiaParseError);
    expect(() => parseKofiaHeadList(html)).toThrow(KofiaParseError);
    expect(() => parseKofiaDay(html, HEAD, "2026-11-26")).toThrow(KofiaParseError);
  });
  test("no rows (a holiday) is no_data, not zero yields", () => {
    const empty = DAY.replace(/<BISBndSrtPrcDayDTO>[\s\S]*<\/BISBndSrtPrcDayDTO>/, "");
    try {
      parseKofiaDay(empty, HEAD, "2026-11-28");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(KofiaParseError);
      expect((e as KofiaParseError).code).toBe("no_data");
    }
  });
  test("a head list without a 3y column is no_tenor_column", () => {
    const noTenor = HEAD.replaceAll("<attrCd>0300</attrCd>", "<attrCd>0301</attrCd>");
    expect(() => parseKofiaDay(DAY, noTenor, "2026-11-26")).toThrow(/3-year column/);
  });
  test("a missing KTB row is no_ktb_row", () => {
    const noKtb = DAY.replaceAll("<sigaBrnCd>1010000</sigaBrnCd>", "<sigaBrnCd>1010009</sigaBrnCd>");
    try {
      parseKofiaDay(noKtb, HEAD, "2026-11-26");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as KofiaParseError).code).toBe("no_ktb_row");
    }
  });
  test("a row whose label contradicts its code is skipped with a warning (never trusted)", () => {
    const relabelled = DAY.replace(
      /(<creditRnkMrk>)AA-(<\/creditRnkMrk>[\s\S]*?<sigaBrnCd>7010123<\/sigaBrnCd>)/,
      "$1AA+$2",
    );
    const snap = parseKofiaDay(relabelled, HEAD, "2026-11-26");
    expect(snap.grades["AA-"]).toBeUndefined();
    expect(snap.warnings.join(" ")).toContain("7010123");
    expect(Object.keys(snap.grades)).toHaveLength(9);
  });
  test("a non-numeric or non-positive value is dropped with a warning", () => {
    const broken = DAY.replace(/(<sigaBrnCd>7010213<\/sigaBrnCd>[\s\S]*?<val8>)[^<]*(<\/val8>)/, "$1-1.0$2");
    const snap = parseKofiaDay(broken, HEAD, "2026-11-26");
    expect(snap.grades["BBB-"]).toBeUndefined();
    expect(snap.warnings.join(" ")).toContain("BBB- 3y");
  });
});

describe("series ids and the collection switch", () => {
  test("series ids", () => {
    expect(kofiaGradeSeriesId("AA-")).toBe("kofia:corp-public-unsecured:AA-:3y");
    expect(KOFIA_KTB_SERIES_ID).toBe("kofia:ktb:3y");
  });
  test("the switch is on only for exactly 'on' (case-insensitive, trimmed); everything else is off", () => {
    expect(kofiaCollectEnabledFrom("on")).toBe(true);
    expect(kofiaCollectEnabledFrom(" ON ")).toBe(true);
    for (const v of [undefined, null, "", "off", "1", "true", "yes", "onn"]) {
      expect(kofiaCollectEnabledFrom(v as string | undefined)).toBe(false);
    }
  });
});
