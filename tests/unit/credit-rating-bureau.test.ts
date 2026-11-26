// @version 1.0.0
/**
 * ADR-0208 amendment (2026-11-26) - credit-bureau ISSUER ratings ("기업신용평가" table) as a lower-confidence rung.
 * The fixture reproduces the rows of the real dev run (corp 00186799, business report 20260318001708): a yearly table
 * `date grade cash-flow-grade agency`, grades such as "BBB0", the agency stated only in some rows, and a last row
 * that used to bleed into the next numbered heading ("차. 「상법」 ...").
 */
import { describe, expect, test } from "bun:test";
import {
  CREDIT_RATING_PARSER_VERSION,
  isSelectableBureauRating,
  isSelectableRating,
  parseBusinessReportCreditRating,
  selectBureauRating,
  selectRating,
  type CreditRatingRow,
} from "../../db/lib/credit-rating-disclosure.ts";
import { loadKrCreditRatingRegistry } from "../../db/lib/credit-spread-map.ts";

const loaded = loadKrCreditRatingRegistry();
if (!loaded.ok) throw new Error("KR registry must load for these tests");
const REG = loaded.registry;

const PRE = "Ⅱ. 사업의 내용 1. 사업의 개요 가. 업계의 현황 가나다산업은 다음과 같습니다. 카. 연구개발활동 해당 없음";
const BUREAU_TABLE =
  "평가일 신용등급 현금흐름등급 평가기관 " +
  "2015.12.31 A- CR-3 - 2016.12.31 A- CR-3 - 2017.12.31 A- CR-5 - 2018.12.31 BBB+ CR-6 - 2019.12.31 BBB+ CR-6 - " +
  "2020.12.31 BBB CR-4 - 2021.12.31 BBB+ CR-3 - NICE디앤비 2022.12.31 BBB- C+ - 2023.12.31 BBB0 C+ - " +
  "2024.12.31 BB+ B - 이크레더블 2024.12.31 BBB0 C+ -";
/** The real section: the heading is followed by the bureau table and then by the next lettered heading. */
const REAL = `${PRE} 자. 신용평가에 관한 사항 기업신용평가 등급 ${BUREAU_TABLE} 차. 「상법」 제290조에 따른 변태설립사항 해당사항 없음 카. 기타 참고사항 BBB 2030.01.01`;

const parse = (t: string) => parseBusinessReportCreditRating(t, REG);
const bureauRows = (rows: CreditRatingRow[]) => rows.filter((r) => r.instrument === "issuer_bureau");

describe("parser version", () => {
  test("is bumped to cr-2 so existing filings are re-parsed once", () => {
    expect(CREDIT_RATING_PARSER_VERSION).toBe("cr-2");
  });
});

describe("bureau issuer table (the real rows)", () => {
  const p = parse(REAL);
  const rows = bureauRows(p.ratings);

  test("every dated row is read as an issuer_bureau row, none as a corporate-bond rating", () => {
    expect(p.status).toBe("parsed");
    expect(rows).toHaveLength(11);
    expect(p.ratings.some(isSelectableRating)).toBe(false);
    expect(rows.every(isSelectableBureauRating)).toBe(true);
  });

  test("grades are normalised (BBB0 -> BBB) and the raw token is kept", () => {
    const r2023 = rows.find((r) => r.rated_on === "2023-12-31");
    expect(r2023?.grade).toBe("BBB");
    expect(r2023?.grade_raw).toBe("BBB0");
    expect(rows.find((r) => r.rated_on === "2022-12-31")?.grade).toBe("BBB-");
  });

  test("cash-flow grades (CR-3, C+, B) go to their own field and are never read as the rating", () => {
    expect(rows.map((r) => r.cashflow_grade_raw)).toEqual([
      "CR-3",
      "CR-3",
      "CR-5",
      "CR-6",
      "CR-6",
      "CR-4",
      "CR-3",
      "C+",
      "C+",
      "B",
      "C+",
    ]);
    expect(rows.some((r) => r.grade_raw === "C+" || r.grade === "C+")).toBe(false);
  });

  test("the section stops at the next numbered heading: nothing of the following text bleeds into a row", () => {
    const last = rows[rows.length - 1] as CreditRatingRow;
    expect(last.raw).not.toContain("상법");
    expect(last.raw).not.toContain("변태설립");
    expect(rows.some((r) => r.rated_on === "2030-01-01")).toBe(false);
    expect(rows.every((r) => r.raw.length < 40)).toBe(true);
  });

  test("agency: stated agencies are read; a later unnamed row inherits it; a conflicting row stays unnamed", () => {
    const by = (d: string) => rows.filter((r) => r.rated_on === d);
    expect(by("2015-12-31")[0]?.agency).toBeNull(); // before the first stated agency
    expect(by("2020-12-31")[0]?.agency).toBeNull();
    expect(by("2021-12-31")[0]).toMatchObject({ agency: "nice-dnb", agency_carried: false });
    expect(by("2022-12-31")[0]).toMatchObject({ agency: "nice-dnb", agency_carried: true });
    expect(by("2023-12-31")[0]).toMatchObject({ agency: "nice-dnb", agency_carried: true });
    const d2024 = by("2024-12-31");
    expect(d2024[0]).toMatchObject({ agency: "ecredible", grade: "BB+", agency_carried: false });
    // carrying 이크레더블 would give one bureau two different grades on one date: ambiguous -> null
    expect(d2024[1]).toMatchObject({ agency: null, grade: "BBB", agency_carried: false });
  });

  test("selection: the latest date wins and, on that date, the LOWEST grade (BB+ over BBB)", () => {
    const sel = selectBureauRating(p.ratings, REG, new Date("2026-11-26T00:00:00Z"));
    expect(sel).toMatchObject({ rating: "BB+", rated_on: "2024-12-31", agency: "ecredible", cashflow_grade_raw: "B" });
    expect(sel?.stale).toBe(true); // 2024-12-31 + 18 months = 2026-06-30, so it is stale on 2026-11-26
  });
});

describe("selectBureauRating", () => {
  const row = (
    agency: string | null,
    grade: string,
    ratedOn: string,
    over: Partial<CreditRatingRow> = {},
  ): CreditRatingRow => ({
    source: "section",
    agency,
    agency_raw: agency,
    instrument: "issuer_bureau",
    grade,
    grade_raw: grade,
    outlook: null,
    rated_on: ratedOn,
    rated_on_precision: "day",
    excluded_reason: null,
    raw: "x",
    cashflow_grade_raw: "C+",
    ...over,
  });
  const NOW = new Date("2026-01-15T00:00:00Z");

  test("null when there is no bureau row; corporate-bond rows are never bureau evidence", () => {
    expect(selectBureauRating([], REG, NOW)).toBeNull();
    expect(selectBureauRating([row("kis", "A", "2025-05-01", { instrument: "corporate_bond" })], REG, NOW)).toBeNull();
  });

  test("an older, better row never beats the newest date; same-date ties go to the lowest grade", () => {
    const sel = selectBureauRating(
      [row("ked", "A", "2023-12-31"), row("ecredible", "BBB", "2025-06-30"), row("nice-dnb", "BBB-", "2025-06-30")],
      REG,
      NOW,
    );
    expect(sel).toMatchObject({ rating: "BBB-", agency: "nice-dnb", rated_on: "2025-06-30" });
    expect(sel?.latest).toHaveLength(2);
  });

  test("an excluded or unmapped row is skipped", () => {
    const bad = row("ked", "AAA", "2026-01-01", { excluded_reason: "grade_unmapped" });
    expect(selectBureauRating([bad, row("ked", "BB", "2025-01-01")], REG, NOW)?.rating).toBe("BB");
  });

  test("the stale rule is the registry window (18 months) on the rating date", () => {
    const at = (d: string) => selectBureauRating([row("ked", "A", d)], REG, NOW)?.stale;
    expect(at("2024-07-15")).toBe(false);
    expect(at("2024-07-14")).toBe(true);
  });
});

describe("the bond path is unchanged", () => {
  test("a bureau agency named next to a bond row never makes that row a bond rating", () => {
    const text = `${PRE} 자. 신용평가에 관한 사항 평가일 평가대상 유가증권 신용등급 평가회사 2025.05.13 회사채 AA- NICE디앤비`;
    const p = parse(text);
    expect(p.ratings.some(isSelectableRating)).toBe(false);
    expect(p.ratings.some(isSelectableBureauRating)).toBe(false);
  });

  test("a section with only bond rows is not read as a bureau table", () => {
    const p = parse(`${PRE} 자. 신용평가에 관한 사항 2025.05.13 회사채 AA- NICE신용평가(주) (AAA~D) 정기평정`);
    expect(bureauRows(p.ratings)).toHaveLength(0);
    expect(selectRating(p.ratings, REG, new Date("2025-06-01T00:00:00Z"))?.rating).toBe("AA-");
  });

  test("a bureau table plus a corporate-bond table: both are read, the bond rows stay selectable as bonds", () => {
    const text = `${PRE} 자. 신용평가에 관한 사항 2025.05.13 회사채 AA- NICE신용평가(주) (AAA~D) 정기평정 기업신용평가 2024.12.31 BB+ B - 이크레더블`;
    const p = parse(text);
    expect(p.ratings.filter(isSelectableRating).map((r) => r.grade)).toEqual(["AA-"]);
    expect(bureauRows(p.ratings).map((r) => r.grade)).toEqual(["BB+"]);
  });
});
