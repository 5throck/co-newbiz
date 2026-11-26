// @version 1.0.0
/**
 * ADR-0208 slice 2 - the disclosed-rating parser and selector (db/lib/credit-rating-disclosure.ts) over SYNTHETIC
 * filing text built from the three documented real shapes (narrative + table, table-only history, "nothing applies"),
 * the issuance-table rating cell forms and the bdRs `cdrt_int` forms. No live DART call; the text is tag-stripped
 * and single-line exactly as fetchDisclosureText returns it.
 */
import { describe, expect, test } from "bun:test";
import {
  addMonthsIso,
  isRatingStale,
  parseBusinessReportCreditRating,
  parseDebtSecuritiesRating,
  parseRatingCells,
  selectRating,
  type CreditRatingRow,
} from "../../db/lib/credit-rating-disclosure.ts";
import { loadKrCreditRatingRegistry } from "../../db/lib/credit-spread-map.ts";

const loaded = loadKrCreditRatingRegistry();
if (!loaded.ok) throw new Error("KR registry must load for these tests");
const REG = loaded.registry;

const PRE = "Ⅰ. 회사의 개요 1. 회사의 개요 가. 회사의 법적ㆍ상업적 명칭 가나다산업 나. 설립일자 1990년 1월 1일";
const POST = "아. 종업원 현황 당사의 종업원 수는 다음과 같습니다.";

/** Shape A: narrative sentence + table (the 한화솔루션 form). */
const SHAPE_A = `${PRE} 사. 신용평가에 관한 사항 당사는 2025년 5월 한국기업평가, 한국신용평가, NICE신용평가로부터 각각 회사채등급 AA-를 받았습니다. 평가일 평가대상 유가증권 신용등급 평가회사 (신용등급범위) 평가구분 2025.05.13 회사채 AA- NICE신용평가(주) (AAA~D) 정기평정 2025.05.12 회사채 AA- 한국신용평가(주) (AAA~D) 정기평정 2025.05.12 회사채 AA- 한국기업평가(주) (AAA~D) 정기평정 ${POST}`;

/** Shape B: table only, multi-year history with a downgrade trail (the 대한항공 form). */
const SHAPE_B = `${PRE} 자. 신용평가에 관한 사항 평가일 평가대상 유가증권 신용등급 평가회사 평가구분 2025-09-17 회사채 A 나이스신용평가 본평정 2025-09-17 회사채 A 한국기업평가 본평정 2024-06-20 회사채 A- 나이스신용평가 정기평정 2023-06-22 회사채 BBB+ 나이스신용평가 정기평정 ${POST}`;

/** Shape C: nothing applies (the 동국제강 form). */
const SHAPE_C = `${PRE} 사. 신용평가에 관한 사항 해당사항이 없어 기재를 생략합니다. ${POST}`;

const ratingsOf = (text: string) => parseBusinessReportCreditRating(text, REG);
const selectable = (rows: CreditRatingRow[]) => rows.filter((r) => r.excluded_reason === null);

describe("registry agencies", () => {
  test("the KR registry carries the three domestic bond agencies with aliases and home pages", () => {
    const bond = REG.agencies.filter((a) => a.kind === "bond");
    expect(bond.map((a) => a.id)).toEqual(["korea-ratings", "kis", "nice"]);
    expect(bond.every((a) => a.aliases.length > 0 && a.homeUrl?.startsWith("https://"))).toBe(true);
  });

  test("the credit-information bureaus are registered as kind bureau and flagged as not yet attested", () => {
    const bureau = REG.agencies.filter((a) => a.kind === "bureau");
    expect(bureau.map((a) => a.id)).toEqual(["nice-dnb", "ecredible", "ked", "nice-info", "sci"]);
    expect(bureau.every((a) => a.attested === false && a.homeUrl === null)).toBe(true);
  });
});

describe("section parse - the three real shapes", () => {
  test("narrative sentence + table: every table row is read, the (AAA~D) scale range is never a grade", () => {
    const p = ratingsOf(SHAPE_A);
    expect(p.status).toBe("parsed");
    expect(p.section_found).toBe(true);
    const rows = selectable(p.ratings);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => [r.agency, r.grade, r.rated_on, r.instrument])).toEqual([
      ["nice", "AA-", "2025-05-13", "corporate_bond"],
      ["kis", "AA-", "2025-05-12", "corporate_bond"],
      ["korea-ratings", "AA-", "2025-05-12", "corporate_bond"],
    ]);
    // the range token never produced a D / AAA row
    expect(p.ratings.some((r) => r.grade === "D" || r.grade_raw === "D")).toBe(false);
  });

  test("table only with a multi-year history: all rows are kept, the latest per agency is selected", () => {
    const p = ratingsOf(SHAPE_B);
    expect(p.status).toBe("parsed");
    expect(p.ratings).toHaveLength(4);
    const sel = selectRating(p.ratings, REG, new Date("2026-01-15T00:00:00Z"));
    expect(sel?.rating).toBe("A");
    expect(sel?.agencies.map((a) => [a.agency, a.grade, a.rated_on])).toEqual([
      ["korea-ratings", "A", "2025-09-17"],
      ["nice", "A", "2025-09-17"],
    ]);
  });

  test("nothing applies: a recorded not_disclosed status, no rows", () => {
    const p = ratingsOf(SHAPE_C);
    expect(p.status).toBe("not_disclosed");
    expect(p.section_found).toBe(true);
    expect(p.ratings).toEqual([]);
    expect(p.issues).toBeNull();
  });

  test("heading absent: section_absent, not 'unrated'", () => {
    const p = ratingsOf(`${PRE} ${POST}`);
    expect(p.status).toBe("section_absent");
    expect(p.section_found).toBe(false);
  });

  test("heading present with content that cannot be read: parse_failed, never 'unrated'", () => {
    const p = ratingsOf(
      `${PRE} 사. 신용평가에 관한 사항 당사는 외부 평가기관의 신용평가를 정기적으로 받고 있으며 세부 내용은 별도 첨부를 참고하시기 바랍니다. ${POST}`,
    );
    expect(p.status).toBe("parse_failed");
    expect(p.ratings).toEqual([]);
  });

  test("heading letter variants and numbering: the heading TEXT is matched, not the letter", () => {
    for (const lead of ["사.", "자.", "3.", "(3)", "Ⅲ.", ""]) {
      const text = `${PRE} ${lead} 신용평가에 관한 사항 2025.05.13 회사채 A+ 한국신용평가 정기평정 ${POST}`;
      const p = ratingsOf(text);
      expect(p.status).toBe("parsed");
      expect(selectable(p.ratings)[0]).toMatchObject({ agency: "kis", grade: "A+" });
    }
  });

  test("a table-of-contents heading line is skipped in favour of the real section", () => {
    const toc = "목 차 Ⅰ. 회사의 개요 1. 회사의 개요 사. 신용평가에 관한 사항 아. 종업원 현황 Ⅱ. 사업의 내용";
    const p = ratingsOf(`${toc} ${SHAPE_A}`);
    expect(p.status).toBe("parsed");
    expect(selectable(p.ratings)).toHaveLength(3);
  });

  test("the sentence form is the fallback when no table row parses; one grade is shared by 'each' agency", () => {
    const text = `${PRE} 사. 신용평가에 관한 사항 당사는 2025년 5월 한국기업평가, 한국신용평가, NICE신용평가로부터 각각 회사채등급 AA-(안정적)를 받았습니다. ${POST}`;
    const p = ratingsOf(text);
    expect(p.status).toBe("parsed");
    const rows = selectable(p.ratings);
    expect(rows.map((r) => r.agency).sort()).toEqual(["kis", "korea-ratings", "nice"]);
    expect(
      rows.every((r) => r.grade === "AA-" && r.rated_on === "2025-05-01" && r.rated_on_precision === "month"),
    ).toBe(true);
    expect(rows.every((r) => r.outlook === "stable")).toBe(true);
  });

  test("outlook suffix after the grade in a table row is read and never changes the grade", () => {
    const text = `${PRE} 사. 신용평가에 관한 사항 2025.05.13 회사채 A+(긍정적) 한국신용평가 (AAA~D) 정기평정 ${POST}`;
    const r = selectable(ratingsOf(text).ratings)[0];
    expect(r).toMatchObject({ agency: "kis", grade: "A+", outlook: "positive" });
  });

  test("commercial paper only: the A1 grade is never read as A; status section_present_no_bond_rating", () => {
    const text = `${PRE} 사. 신용평가에 관한 사항 2025.06.10 기업어음 A1 한국기업평가 (A1~D) 정기평정 2025.06.10 기업어음 A1 NICE신용평가 (A1~D) 정기평정 ${POST}`;
    const p = ratingsOf(text);
    expect(p.status).toBe("section_present_no_bond_rating");
    expect(p.ratings).toHaveLength(2);
    expect(
      p.ratings.every((r) => r.instrument === "commercial_paper" && r.grade === null && r.grade_raw === "A1"),
    ).toBe(true);
    expect(p.ratings.every((r) => r.excluded_reason === "short_term")).toBe(true);
    expect(selectRating(p.ratings, REG, new Date("2025-07-01T00:00:00Z"))).toBeNull();
  });

  test("corporate bond and CP in one table: only the bond row is selectable", () => {
    const text = `${PRE} 사. 신용평가에 관한 사항 2025.06.10 회사채 BBB+ 한국기업평가 정기평정 2025.06.10 기업어음 A2- 한국기업평가 정기평정 ${POST}`;
    const p = ratingsOf(text);
    expect(p.status).toBe("parsed");
    expect(selectable(p.ratings)).toHaveLength(1);
    expect(selectable(p.ratings)[0]?.grade).toBe("BBB+");
  });

  test("a foreign agency row is kept but is not an issuer rating of the domestic set", () => {
    const text = `${PRE} 사. 신용평가에 관한 사항 2025.06.10 회사채 BBB Moody's 정기평정 ${POST}`;
    const p = ratingsOf(text);
    expect(p.ratings[0]?.excluded_reason).toBe("agency_not_domestic");
    expect(p.status).toBe("section_present_no_bond_rating");
  });

  test("guaranteed, secured, structured and subordinated issues are skipped; unguaranteed (무보증) is the normal bond", () => {
    const rowsFor = (kind: string) =>
      ratingsOf(`${PRE} 사. 신용평가에 관한 사항 2025.06.10 ${kind} AA 한국기업평가 정기평정 ${POST}`).ratings[0];
    expect(rowsFor("회사채(보증사채)")?.excluded_reason).toBe("guaranteed");
    expect(rowsFor("회사채(담보부사채)")?.excluded_reason).toBe("secured");
    expect(rowsFor("회사채(유동화증권)")?.excluded_reason).toBe("structured");
    expect(rowsFor("회사채(후순위)")?.excluded_reason).toBe("subordinated");
    expect(rowsFor("회사채(무보증)")?.excluded_reason).toBeNull();
    expect(rowsFor("회사채(무담보)")?.excluded_reason).toBeNull();
  });

  test("a preliminary rating is not an issuer rating", () => {
    const text = `${PRE} 사. 신용평가에 관한 사항 2025.06.10 회사채 A 한국기업평가 예비평정 ${POST}`;
    expect(ratingsOf(text).ratings[0]?.excluded_reason).toBe("preliminary");
  });

  test("full-width characters and the company-form glyph are normalised (NFKC)", () => {
    // Built from escapes: the repo's homoglyph audit forbids literal full-width characters in source files.
    const fw = (t: string) => t.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
    const text = `${PRE} 사${fw(".")} 신용평가에 관한 사항 ${fw("2025.05.13")} 회사채 ${fw("AA-")} NICE신용평가\u3231 정기평정 ${POST}`;
    const r = selectable(ratingsOf(text).ratings)[0];
    expect(r).toMatchObject({ agency: "nice", grade: "AA-", rated_on: "2025-05-13" });
  });

  test("a row with an invalid calendar date is excluded as rated_on_unknown (parse_failed overall)", () => {
    const text = `${PRE} 사. 신용평가에 관한 사항 2025.13.45 회사채 A 한국기업평가 정기평정 ${POST}`;
    const p = ratingsOf(text);
    expect(p.ratings[0]?.excluded_reason).toBe("rated_on_unknown");
    expect(p.status).toBe("parse_failed");
  });
});

describe("issuance table (채무증권 발행실적)", () => {
  const table = (rows: string, unit = "(단위 : 백만원, %)") =>
    `${PRE} 사. 신용평가에 관한 사항 해당사항이 없어 기재를 생략합니다. 다. 채무증권 발행실적 ${unit} 발행회사 증권종류 발행방법 발행일자 권면(전자등록)총액 이자율 평가등급(평가기관) 만기일 상환여부 주관회사 ${rows} 라. 기업어음증권 미상환 잔액 해당사항 없음`;

  test("coupon, amount (KRW millions), maturity, outstanding flag and the rating cell with two agencies", () => {
    const p = ratingsOf(
      table(
        "가나다산업 회사채 공모 2023.06.12 100,000 4.452 BBB+, BBB+(NICE신용평가, 한국기업평가) 2026.06.12 미상환 한국투자증권 가나다산업 회사채 공모 2021.03.02 50,000 2.100 A(한국기업평가) 2024.03.02 상환 NH투자증권",
      ),
    );
    expect(p.issues).toHaveLength(2);
    expect(p.issues?.[0]).toMatchObject({
      issued_on: "2023-06-12",
      amount_krw_mn: 100000,
      coupon_pct: 4.452,
      maturity_on: "2026-06-12",
      outstanding: true,
      instrument: "corporate_bond",
      excluded_reason: null,
    });
    expect(p.issues?.[1]).toMatchObject({
      issued_on: "2021-03-02",
      amount_krw_mn: 50000,
      coupon_pct: 2.1,
      maturity_on: "2024-03-02",
      outstanding: false,
    });
    const issuance = p.ratings.filter((r) => r.source === "issuance");
    expect(issuance.map((r) => [r.agency, r.grade, r.rated_on])).toEqual([
      ["nice", "BBB+", "2023-06-12"],
      ["korea-ratings", "BBB+", "2023-06-12"],
      ["korea-ratings", "A", "2021-03-02"],
    ]);
    // the section said nothing applies, the issuance table still yields a usable rating
    expect(p.status).toBe("parsed");
  });

  test("the table unit scales the amount to INTEGER KRW millions (ADR-0061)", () => {
    const row =
      "가나다산업 회사채 공모 2023.06.12 100,000,000,000 4.1 AA-(한국기업평가) 2026.06.12 미상환 한국투자증권";
    expect(ratingsOf(table(row, "(단위 : 원, %)")).issues?.[0]?.amount_krw_mn).toBe(100000);
    const eok = "가나다산업 회사채 공모 2023.06.12 1,000 4.1 AA-(한국기업평가) 2026.06.12 미상환 한국투자증권";
    expect(ratingsOf(table(eok, "(단위 : 억원, %)")).issues?.[0]?.amount_krw_mn).toBe(100000);
    // no unit stated: the amount is unknown, not guessed
    expect(ratingsOf(table(row, "")).issues?.[0]?.amount_krw_mn).toBeNull();
  });

  test("a short-term grade (A1) and a foreign pair (AA-, Aa2) never become long-term domestic ratings", () => {
    const p = ratingsOf(
      table(
        "가나다산업 회사채 공모 2023.06.12 100,000 4.4 A1(한국기업평가/NICE신용평가) 2024.06.12 상환 한국투자증권 가나다산업 회사채 사모 2022.01.10 30,000 3.9 AA-, Aa2(R&I, Moody's) 2025.01.10 미상환 KB증권",
      ),
    );
    const issuance = p.ratings.filter((r) => r.source === "issuance");
    expect(issuance).toHaveLength(4);
    expect(issuance.filter((r) => r.excluded_reason === null)).toHaveLength(0);
    expect(
      issuance.filter((r) => r.grade_raw === "A1").every((r) => r.excluded_reason === "short_term" && r.grade === null),
    ).toBe(true);
    expect(issuance.filter((r) => r.agency === null).every((r) => r.excluded_reason === "agency_not_domestic")).toBe(
      true,
    );
    // the issue rows are still kept as evidence
    expect(p.issues).toHaveLength(2);
  });

  test("a guaranteed issue and a convertible bond carry another party's rating: skipped; 무보증사채 is not", () => {
    const p = ratingsOf(
      table(
        "가나다산업 보증사채 공모 2023.06.12 100,000 4.4 AAA(한국기업평가) 2026.06.12 미상환 한국투자증권 가나다산업 전환사채 사모 2022.01.10 30,000 1.0 BBB(NICE신용평가) 2025.01.10 미상환 KB증권 가나다산업 무보증 회사채 공모 2024.02.02 70,000 3.7 A+(한국신용평가) 2027.02.02 미상환 KB증권",
      ),
    );
    const issuance = p.ratings.filter((r) => r.source === "issuance");
    expect(issuance.map((r) => [r.grade_raw, r.excluded_reason])).toEqual([
      ["AAA", "not_corporate_bond"],
      ["BBB", "not_corporate_bond"],
      ["A+", null],
    ]);
  });

  test("a report with no issuance table has issues=null (unknown), not an empty list", () => {
    expect(ratingsOf(SHAPE_A).issues).toBeNull();
  });
});

describe("rating cells and bdRs cdrt_int", () => {
  test("cell forms: shared grade, zipped list, short-term, foreign", () => {
    expect(parseRatingCells("A1(한국기업평가/NICE신용평가)", REG).map((c) => [c.grade_raw, c.agency])).toEqual([
      ["A1", "korea-ratings"],
      ["A1", "nice"],
    ]);
    expect(parseRatingCells("BBB+, BBB+(NICE신용평가, 한국기업평가)", REG).map((c) => [c.grade_raw, c.agency])).toEqual(
      [
        ["BBB+", "nice"],
        ["BBB+", "korea-ratings"],
      ],
    );
    expect(parseRatingCells("AA-, Aa2(R&I, Moody's)", REG).map((c) => [c.grade_raw, c.agency])).toEqual([
      ["AA-", null],
      ["Aa2", null],
    ]);
  });

  test("ambiguous grade/agency counts yield entries without a grade (never selectable)", () => {
    const cells = parseRatingCells("A, BBB(한국기업평가/NICE신용평가/한국신용평가)", REG);
    expect(cells).toHaveLength(3);
    expect(cells.every((c) => c.grade_raw === "")).toBe(true);
  });

  test("bdRs cdrt_int: outlook stripped, two agencies, rating date = payment date", () => {
    const rows = parseDebtSecuritiesRating(
      {
        cdrt_int: "AA-(안정적)\n(한국기업평가(주) / NICE신용평가(주))",
        pymd: "2026-03-18",
        rcept_no: "20260310000123",
        grt_amt: "-",
      },
      REG,
    );
    expect(rows.map((r) => [r.agency, r.grade, r.outlook, r.rated_on, r.source, r.excluded_reason])).toEqual([
      ["korea-ratings", "AA-", "stable", "2026-03-18", "bdrs", null],
      ["nice", "AA-", "stable", "2026-03-18", "bdrs", null],
    ]);
  });

  test("bdRs: without a payment date the filing receipt date is used; foreign form is excluded; '-' gives no rows", () => {
    const noDate = parseDebtSecuritiesRating(
      { cdrt_int: "A+(NICE신용평가)", pymd: null, rcept_no: "20260310000123" },
      REG,
    );
    expect(noDate[0]).toMatchObject({ grade: "A+", rated_on: "2026-03-10" });
    const foreign = parseDebtSecuritiesRating({ cdrt_int: "Aa2(Moody's)", rcept_no: "20260310000123" }, REG);
    expect(foreign[0]?.excluded_reason).toBe("agency_not_domestic");
    expect(parseDebtSecuritiesRating({ cdrt_int: "-", rcept_no: "20260310000123" }, REG)).toEqual([]);
    expect(parseDebtSecuritiesRating({ cdrt_int: null, rcept_no: "20260310000123" }, REG)).toEqual([]);
  });

  test("bdRs: a real guaranteed amount marks the issue guaranteed (not an issuer rating)", () => {
    const rows = parseDebtSecuritiesRating(
      { cdrt_int: "AAA(한국기업평가)", pymd: "2026-03-18", rcept_no: "20260310000123", grt_amt: "50,000,000,000" },
      REG,
    );
    expect(rows[0]?.excluded_reason).toBe("guaranteed");
  });
});

describe("selection (D2): latest per agency, lowest across agencies, stale boundary", () => {
  const row = (agency: string, grade: string, rated_on: string): CreditRatingRow => ({
    source: "section",
    agency,
    agency_raw: agency,
    instrument: "corporate_bond",
    grade,
    grade_raw: grade,
    outlook: null,
    rated_on,
    rated_on_precision: "day",
    excluded_reason: null,
    raw: "",
  });
  const NOW = new Date("2026-11-26T03:00:00Z"); // 2026-11-26 in Seoul

  test("latest per agency: an older, better rating of the same agency never wins", () => {
    const sel = selectRating([row("kis", "AA-", "2024-05-01"), row("kis", "A", "2025-05-01")], REG, NOW);
    expect(sel?.rating).toBe("A");
    expect(sel?.agencies).toHaveLength(1);
  });

  test("lowest across agencies; a tie on the grade takes the newest date", () => {
    const sel = selectRating(
      [row("kis", "A+", "2026-02-01"), row("nice", "A", "2026-01-01"), row("korea-ratings", "A", "2026-03-01")],
      REG,
      NOW,
    );
    expect(sel?.rating).toBe("A");
    expect(sel?.rated_on).toBe("2026-03-01");
    expect(sel?.agencies.map((a) => a.agency)).toEqual(["korea-ratings", "nice", "kis"]);
  });

  test("the same agency on the same date with two grades keeps the lower (conservative)", () => {
    const sel = selectRating([row("kis", "A", "2026-02-01"), row("kis", "A-", "2026-02-01")], REG, NOW);
    expect(sel?.rating).toBe("A-");
  });

  test("excluded rows never take part", () => {
    const bad: CreditRatingRow = { ...row("kis", "BB", "2026-06-01"), excluded_reason: "guaranteed" };
    expect(selectRating([bad], REG, NOW)).toBeNull();
    expect(selectRating([bad, row("nice", "A", "2026-01-01")], REG, NOW)?.rating).toBe("A");
  });

  test("stale boundary: 17 and 18 months are fresh, 19 months is stale (stale_months = 18)", () => {
    expect(REG.disclosed.staleMonths).toBe(18);
    const at = (ratedOn: string) => selectRating([row("kis", "A", ratedOn)], REG, NOW)?.stale;
    expect(at("2025-06-26")).toBe(false); // 17 months
    expect(at("2025-05-26")).toBe(false); // exactly 18 months: not older than 18
    expect(at("2025-05-25")).toBe(true); // 18 months + 1 day
    expect(at("2025-04-26")).toBe(true); // 19 months
  });

  test("month arithmetic clamps the day (Aug 31 + 18 months)", () => {
    expect(addMonthsIso("2025-08-31", 6)).toBe("2026-02-28");
    expect(isRatingStale("2025-05-26", "2026-11-26T00:00:00Z", 18)).toBe(false);
    expect(isRatingStale("2025-05-25", "2026-11-26T00:00:00Z", 18)).toBe(true);
  });
});
