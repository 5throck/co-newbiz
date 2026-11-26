// @version 1.0.0
/**
 * ADR-0208 slice 3 - the DART collector extension and its storage.
 *
 * Covers: the pure account classifier (id-keyed rows incl. the duplicate-name interest-paid rows, pre-tax income,
 * name-pattern borrowing classes, contra and flow rows excluded, same-name different-amount rows summed, repeated
 * identical rows not double counted); fetchFinancials returning `extraItems` while the eight original accounts stay
 * byte for byte (and a year without extras carries no `extraItems` key); migration 0201 (header markers, the seed equals
 * the code list, additive, rollback rehearsal, freshness reset); the fact_financial writer (ifrs_code resolution,
 * idempotent revisions, loud failure on a missing account row).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BORROWING_CLASS_CODES,
  CREDIT_ID_KEYED_CODES,
  CREDIT_INPUT_CODES,
  classifyBorrowingName,
  extractCreditInputItems,
  type DartAccountListRow,
} from "../../db/lib/dart-financial-accounts.ts";
import { splitSqlStatements } from "../../db/migrate.ts";

const row = (sj_div: string, account_id: string, account_nm: string, thstrm_amount: string): DartAccountListRow => ({
  sj_div,
  account_id,
  account_nm,
  thstrm_amount,
});

const byCode = (items: ReturnType<typeof extractCreditInputItems>) =>
  Object.fromEntries(items.map((i) => [i.ifrsCode, i.value]));

describe("classifyBorrowingName", () => {
  test("the five classes, with their filer variants", () => {
    const c = BORROWING_CLASS_CODES;
    expect(classifyBorrowingName("단기차입금")).toBe(c.shortTerm);
    expect(classifyBorrowingName("장기차입금")).toBe(c.longTerm);
    expect(classifyBorrowingName("유동성장기차입금")).toBe(c.longTerm);
    expect(classifyBorrowingName("차입금")).toBe(c.longTerm);
    expect(classifyBorrowingName("자산유동화차입금")).toBe(c.longTerm);
    expect(classifyBorrowingName("유동성장기부채")).toBe(c.currentPortionLtd);
    expect(classifyBorrowingName("사채")).toBe(c.bonds);
    expect(classifyBorrowingName("유동성사채")).toBe(c.bonds);
    expect(classifyBorrowingName("전환사채")).toBe(c.bonds);
    expect(classifyBorrowingName("리스부채")).toBe(c.leases);
    expect(classifyBorrowingName("유동성리스부채")).toBe(c.leases);
    expect(classifyBorrowingName("비유동리스부채")).toBe(c.leases);
    expect(classifyBorrowingName("단기 차입금")).toBe(c.shortTerm); // spaces are ignored
  });

  test("contra, accrued and flow rows are never debt balances", () => {
    expect(classifyBorrowingName("사채할인발행차금")).toBeNull();
    expect(classifyBorrowingName("사채상환할증금")).toBeNull();
    expect(classifyBorrowingName("미지급이자")).toBeNull();
    expect(classifyBorrowingName("차입금의 상환")).toBeNull();
    expect(classifyBorrowingName("사채의 발행")).toBeNull();
    expect(classifyBorrowingName("매입채무")).toBeNull();
    expect(classifyBorrowingName("")).toBeNull();
  });
});

describe("extractCreditInputItems", () => {
  test("id-keyed rows: pre-tax, interest expense, finance costs and BOTH interest-paid rows (same name, different ids) are kept", () => {
    const items = extractCreditInputItems([
      row("CIS", "dart_OperatingIncomeLoss", "영업이익", "100"),
      row("CIS", "ifrs-full_FinanceCosts", "금융비용", "972"),
      row("CIS", "ifrs-full_ProfitLossBeforeTax", "법인세비용차감전순이익", "823"),
      row("CF", "ifrs-full_InterestPaidClassifiedAsOperatingActivities", "이자지급", "20"),
      row("CF", "ifrs-full_InterestPaidClassifiedAsFinancingActivities", "이자지급", "508"),
      row("CF", "dart_AdjustmentsForInterestExpenses", "이자비용", "806"),
    ]);
    expect(byCode(items)).toEqual({
      "ifrs-full_ProfitLossBeforeTax": 823,
      dart_AdjustmentsForInterestExpenses: 806,
      "ifrs-full_FinanceCosts": 972,
      "ifrs-full_InterestPaidClassifiedAsOperatingActivities": 20,
      "ifrs-full_InterestPaidClassifiedAsFinancingActivities": 508,
    });
    // a name-keyed first-wins collector would have kept one of the two 이자지급 rows
    expect(items.filter((i) => i.name === "이자지급")).toHaveLength(2);
    expect(items.every((i) => (CREDIT_INPUT_CODES as readonly string[]).includes(i.ifrsCode))).toBe(true);
  });

  test("first row per account id wins; a row from the wrong statement section is ignored", () => {
    const items = extractCreditInputItems([
      row("CF", "ifrs-full_ProfitLossBeforeTax", "법인세비용차감전순이익", "1"), // cash-flow start line: not the income statement
      row("IS", "ifrs-full_ProfitLossBeforeTax", "법인세비용차감전순이익", "49"),
      row("IS", "ifrs-full_ProfitLossBeforeTax", "법인세비용차감전순이익", "50"),
      row("IS", "ifrs-full_FinanceCosts", "금융비용", "-"), // unreadable amount: skipped, a later row may still count
      row("CIS", "ifrs-full_FinanceCosts", "금융비용", "7"),
      row("BS", "ifrs-full_InterestPaidClassifiedAsOperatingActivities", "이자지급", "9"), // wrong section
    ]);
    expect(byCode(items)).toEqual({ "ifrs-full_ProfitLossBeforeTax": 49, "ifrs-full_FinanceCosts": 7 });
  });

  test("amounts with thousands separators parse; the sign is kept as filed", () => {
    const items = extractCreditInputItems([
      row("CF", "ifrs-full_InterestPaidClassifiedAsFinancingActivities", "이자지급", "-1,234,000"),
    ]);
    expect(byCode(items)).toEqual({ "ifrs-full_InterestPaidClassifiedAsFinancingActivities": -1234000 });
  });

  test("borrowings: balance-sheet rows only, summed per class; flows in the cash-flow statement are not debt", () => {
    const items = extractCreditInputItems([
      row("BS", "-표준계정코드 미사용-", "단기차입금", "2027"),
      row("BS", "ifrs-full_CurrentPortionOfLongtermBorrowings", "유동성장기부채", "1437"),
      row("BS", "-표준계정코드 미사용-", "자산유동화차입금", "85"),
      row("BS", "ifrs-full_NoncurrentPortionOfOtherNoncurrentBorrowings", "장기차입금", "3277"),
      row("BS", "ifrs-full_NoncurrentPortionOfNoncurrentBondsIssued", "사채", "2623"),
      row("BS", "-표준계정코드 미사용-", "사채할인발행차금", "-5"), // contra
      row("CF", "dart_ProceedsFromBonds", "사채의 발행", "1968"), // flow
      row("CF", "-표준계정코드 미사용-", "단기차입금의 순증감", "-488"), // flow
    ]);
    expect(byCode(items)).toEqual({
      [BORROWING_CLASS_CODES.shortTerm]: 2027,
      [BORROWING_CLASS_CODES.longTerm]: 3277 + 85,
      [BORROWING_CLASS_CODES.currentPortionLtd]: 1437,
      [BORROWING_CLASS_CODES.bonds]: 2623,
    });
  });

  test("same name with different amounts (current and non-current) are both counted; an identical repeated row is not", () => {
    const items = extractCreditInputItems([
      row("BS", "-표준계정코드 미사용-", "리스부채", "100"),
      row("BS", "-표준계정코드 미사용-", "리스부채", "400"),
      row("BS", "-표준계정코드 미사용-", "리스부채", "400"), // repeated identical row
      row("BS", "ifrs-full_CurrentLeaseLiabilities", "유동성리스부채", "50"),
    ]);
    expect(byCode(items)).toEqual({ [BORROWING_CLASS_CODES.leases]: 550 });
  });

  test("a filing with none of the accounts yields nothing (no zero rows are invented)", () => {
    expect(extractCreditInputItems([row("BS", "ifrs-full_Assets", "자산총계", "1000")])).toEqual([]);
    expect(extractCreditInputItems([])).toEqual([]);
  });

  test("shape against a live filing (한화솔루션 2025 CFS excerpt, amounts in KRW as filed)", () => {
    const items = extractCreditInputItems([
      row("BS", "ifrs-full_CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings", "차입금", "7125323000000"),
      row("BS", "ifrs-full_LongtermBorrowings", "장기차입금", "7852018000000"),
      row("CIS", "ifrs-full_FinanceCosts", "금융비용", "539445000000"),
      row("CIS", "dart_OperatingIncomeLoss", "영업이익(손실)", "-364759000000"),
      row("CF", "ifrs-full_InterestPaidClassifiedAsFinancingActivities", "이자지급", "508931000000"),
      row("CF", "ifrs-full_InterestPaidClassifiedAsOperatingActivities", "이자지급", "20765000000"),
    ]);
    expect(byCode(items)).toEqual({
      "ifrs-full_FinanceCosts": 539445000000,
      "ifrs-full_InterestPaidClassifiedAsFinancingActivities": 508931000000,
      "ifrs-full_InterestPaidClassifiedAsOperatingActivities": 20765000000,
      [BORROWING_CLASS_CODES.longTerm]: 7125323000000 + 7852018000000,
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// fetchFinancials: the eight original accounts are untouched; extras ride in `extraItems`.
// ---------------------------------------------------------------------------------------------------------------
describe("fetchFinancials with the credit-input extension", () => {
  const savedKey = process.env.DART_API_KEY;
  const savedFetch = globalThis.fetch;
  const latest = new Date().getFullYear() - 1;
  type Spec = { status: string; list?: DartAccountListRow[] };

  const base = (): DartAccountListRow[] => [
    { account_nm: "매출액", thstrm_amount: "100000" },
    { account_nm: "매출원가", thstrm_amount: "60000" },
    { account_nm: "영업이익", thstrm_amount: "30000" },
    { account_nm: "당기순이익", thstrm_amount: "20000" },
    { account_nm: "자산총계", thstrm_amount: "100000" },
    { account_nm: "부채총계", thstrm_amount: "60000" },
    { account_nm: "자본총계", thstrm_amount: "40000" },
  ];
  const stub = (table: Record<string, Spec>) => {
    globalThis.fetch = Object.assign(
      (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const p = new URL(url).searchParams;
        const spec = table[`${p.get("bsns_year")}:${p.get("fs_div")}`] ?? { status: "013" };
        return Promise.resolve(
          new Response(JSON.stringify(spec.list ? { status: spec.status, list: spec.list } : { status: spec.status }), {
            headers: { "content-type": "application/json" },
          }),
        );
      },
      { preconnect: (_url: string | URL) => {} },
    ) as typeof fetch;
  };
  beforeAll(() => {
    process.env.DART_API_KEY = ["dart", "test", "key"].join("-");
  });
  afterAll(() => {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.DART_API_KEY;
    else process.env.DART_API_KEY = savedKey;
  });

  test("the original items are byte-identical with and without the extra rows; only the year block gains extraItems", async () => {
    const { fetchFinancials } = await import("../../app/web-next/lib/dart-client.ts");
    stub({ [`${latest}:CFS`]: { status: "000", list: base() } });
    const plain = await fetchFinancials("00000001", { fiscalYears: [latest] });
    const extras: DartAccountListRow[] = [
      { sj_div: "BS", account_id: "-표준계정코드 미사용-", account_nm: "단기차입금", thstrm_amount: "500" },
      { sj_div: "CF", account_id: "dart_AdjustmentsForInterestExpenses", account_nm: "이자비용", thstrm_amount: "40" },
      {
        sj_div: "CIS",
        account_id: "ifrs-full_ProfitLossBeforeTax",
        account_nm: "법인세비용차감전순이익",
        thstrm_amount: "25000",
      },
    ];
    stub({ [`${latest}:CFS`]: { status: "000", list: [...base(), ...extras] } });
    const rich = await fetchFinancials("00000001", { fiscalYears: [latest] });
    expect(JSON.stringify(rich.items)).toBe(JSON.stringify(plain.items));
    expect(rich.yearly?.[0]?.items).toEqual(plain.yearly?.[0]?.items);
    expect(plain.yearly?.[0] && "extraItems" in plain.yearly[0]).toBe(false);
    expect(rich.yearly?.[0]?.extraItems?.map((i) => i.ifrsCode).sort()).toEqual([
      BORROWING_CLASS_CODES.shortTerm,
      "dart_AdjustmentsForInterestExpenses",
      "ifrs-full_ProfitLossBeforeTax",
    ]);
    expect(rich.found).toBe(true);
    expect(rich.fsDiv).toBe("CFS");
  });

  test("extras never decide 'found': a block with only extra rows (no original account) is still a miss", async () => {
    const { fetchFinancials } = await import("../../app/web-next/lib/dart-client.ts");
    stub({
      [`${latest}:CFS`]: {
        status: "000",
        list: [{ sj_div: "CIS", account_id: "ifrs-full_FinanceCosts", account_nm: "금융비용", thstrm_amount: "9" }],
      },
    });
    const out = await fetchFinancials("00000001", { fiscalYears: [latest] });
    expect(out.found).toBe(false);
    expect(out.yearly).toEqual([]);
  });

  test("the extras follow the chosen statement basis (CFS miss, BFS year)", async () => {
    const { fetchFinancials } = await import("../../app/web-next/lib/dart-client.ts");
    stub({
      [`${latest}:CFS`]: { status: "013" },
      [`${latest}:BFS`]: {
        status: "000",
        list: [
          ...base(),
          { sj_div: "CIS", account_id: "ifrs-full_FinanceCosts", account_nm: "금융비용", thstrm_amount: "77" },
        ],
      },
    });
    const out = await fetchFinancials("00000001", { fiscalYears: [latest] });
    expect(out.yearly?.[0]?.fsDiv).toBe("BFS");
    expect(out.yearly?.[0]?.extraItems).toEqual([
      { name: "금융비용", ifrsCode: "ifrs-full_FinanceCosts", value: 77, unit: "KRW" },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Migration 0201 and the writer.
// ---------------------------------------------------------------------------------------------------------------
const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const F201 = files.find((f) => f.startsWith("0201_")) ?? "";
const SQL201 = readFileSync(join(DIR, F201), "utf-8");

const TMP = mkdtempSync(join(tmpdir(), "dart-financial-accounts-"));
const DB_BEFORE = process.env.CO_NEWBIZ_DB_PATH;
process.env.CO_NEWBIZ_DB_PATH = join(TMP, "boot.sqlite");
const { runMigrations } = await import("../../db/migrate.ts");
const { getDb, resetDb } = await import("../../db/client.ts");
resetDb();
const DB_PATH = join(TMP, "store.sqlite");
runMigrations(DB_PATH);
const db = getDb(DB_PATH);
const { ulid } = await import("../../db/lib/ulid.ts");
const { syncCompanyFinancialFacts } = await import("../../app/web-next/lib/dart-financial-facts.ts");
const NOW = "2026-11-26T00:00:00.000Z";
const KEY_BEFORE = process.env.DART_API_KEY;
afterAll(() => {
  resetDb();
  if (KEY_BEFORE === undefined) delete process.env.DART_API_KEY;
  else process.env.DART_API_KEY = KEY_BEFORE;
  if (DB_BEFORE === undefined) delete process.env.CO_NEWBIZ_DB_PATH;
  else process.env.CO_NEWBIZ_DB_PATH = DB_BEFORE;
});

describe("migration 0201", () => {
  test("filename follows 0200 and the header carries @reversible + ROLLBACK-SQL markers (ADR-0014)", () => {
    expect(F201).toBe("0201_md_account_interest_debt.sql");
    expect(files[files.indexOf(F201) - 1]?.startsWith("0200_")).toBe(true);
    expect(SQL201).toMatch(/^-- @reversible: true/);
    expect(SQL201).toContain("ROLLBACK-SQL-BEGIN");
    expect(SQL201).toContain("ROLLBACK-SQL-END");
  });

  test("seeds exactly the code list, additively: the eight original accounts are untouched", () => {
    const seeded = (
      db
        .query(
          "SELECT ifrs_code FROM md_account WHERE ifrs_code IN (" + CREDIT_INPUT_CODES.map(() => "?").join(",") + ")",
        )
        .all(...CREDIT_INPUT_CODES) as Array<{ ifrs_code: string }>
    )
      .map((r) => r.ifrs_code)
      .sort();
    expect(seeded).toEqual([...CREDIT_INPUT_CODES].sort());
    expect(CREDIT_ID_KEYED_CODES).toContain("ifrs-full_ProfitLossBeforeTax");
    expect((db.query("SELECT COUNT(*) AS n FROM md_account").get() as { n: number }).n).toBe(
      8 + CREDIT_INPUT_CODES.length,
    );
    for (const code of CREDIT_INPUT_CODES) expect(SQL201).toContain(`'${code}'`);
    // the writer maps the original eight by name_ko: a new row must not steal one of those names
    for (const name of [
      "매출액",
      "매출원가",
      "판매비와관리비",
      "영업이익",
      "당기순이익",
      "자산총계",
      "부채총계",
      "자본총계",
    ]) {
      expect((db.query("SELECT COUNT(*) AS n FROM md_account WHERE name_ko = ?").get(name) as { n: number }).n).toBe(1);
    }
  });

  test("applying it twice is safe (INSERT OR IGNORE on the unique ifrs_code)", () => {
    const scratch = new Database(":memory:");
    scratch.run(
      "CREATE TABLE md_account (id TEXT PRIMARY KEY, ifrs_code TEXT NOT NULL UNIQUE, name_ko TEXT NOT NULL, name_en TEXT NOT NULL, created_at TEXT NOT NULL)",
    );
    scratch.run(
      "CREATE TABLE dart_corp_sync_state (corp_code TEXT PRIMARY KEY, financial_checked_at TEXT, updated_at TEXT NOT NULL)",
    );
    for (const st of splitSqlStatements(SQL201)) scratch.run(st);
    for (const st of splitSqlStatements(SQL201)) scratch.run(st);
    expect((scratch.query("SELECT COUNT(*) AS n FROM md_account").get() as { n: number }).n).toBe(
      CREDIT_INPUT_CODES.length,
    );
    scratch.close();
  });

  test("data step: clears financial_checked_at (only where set) so the next incremental sync re-checks the latest year", () => {
    const scratch = new Database(":memory:");
    scratch.run(
      "CREATE TABLE md_account (id TEXT PRIMARY KEY, ifrs_code TEXT NOT NULL UNIQUE, name_ko TEXT NOT NULL, name_en TEXT NOT NULL, created_at TEXT NOT NULL)",
    );
    scratch.run(
      "CREATE TABLE dart_corp_sync_state (corp_code TEXT PRIMARY KEY, financial_checked_at TEXT, updated_at TEXT NOT NULL)",
    );
    scratch.run("INSERT INTO dart_corp_sync_state VALUES ('00000001', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')");
    scratch.run("INSERT INTO dart_corp_sync_state VALUES ('00000002', NULL, '2026-10-01T00:00:00Z')");
    for (const st of splitSqlStatements(SQL201)) scratch.run(st);
    const rows = scratch
      .query("SELECT corp_code, financial_checked_at, updated_at FROM dart_corp_sync_state ORDER BY corp_code")
      .all() as Array<{
      corp_code: string;
      financial_checked_at: string | null;
      updated_at: string;
    }>;
    expect(rows[0]?.financial_checked_at).toBeNull();
    expect(rows[0]?.updated_at).not.toBe("2026-11-01T00:00:00Z");
    expect(rows[1]).toEqual({ corp_code: "00000002", financial_checked_at: null, updated_at: "2026-10-01T00:00:00Z" });
    scratch.close();
  });

  test("rollback rehearsal: the ROLLBACK-SQL block removes the new accounts and their facts, keeps the original eight", () => {
    const block = SQL201.split("ROLLBACK-SQL-BEGIN")[1]?.split("ROLLBACK-SQL-END")[0] ?? "";
    const stmts = splitSqlStatements(block.replace(/^--\s?/gm, ""));
    expect(stmts.length).toBe(2);
    const scratch = new Database(":memory:");
    scratch.run(
      "CREATE TABLE md_account (id TEXT PRIMARY KEY, ifrs_code TEXT NOT NULL UNIQUE, name_ko TEXT NOT NULL, name_en TEXT NOT NULL, created_at TEXT NOT NULL)",
    );
    scratch.run("CREATE TABLE fact_financial (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, value REAL NOT NULL)");
    scratch.run(
      "CREATE TABLE dart_corp_sync_state (corp_code TEXT PRIMARY KEY, financial_checked_at TEXT, updated_at TEXT NOT NULL)",
    );
    scratch.run("INSERT INTO md_account VALUES ('orig', 'ifrs-full_Revenue', '매출액', 'Revenue', 'x')");
    for (const st of splitSqlStatements(SQL201)) scratch.run(st);
    const added = scratch.query("SELECT id FROM md_account WHERE ifrs_code = 'ifrs-full_FinanceCosts'").get() as {
      id: string;
    };
    scratch.run("INSERT INTO fact_financial VALUES ('f1', ?, 1)", [added.id]);
    scratch.run("INSERT INTO fact_financial VALUES ('f2', 'orig', 2)");
    for (const st of stmts) scratch.run(st);
    expect(scratch.query("SELECT id FROM md_account").all()).toEqual([{ id: "orig" }]);
    expect(scratch.query("SELECT id FROM fact_financial").all()).toEqual([{ id: "f2" }]);
    scratch.close();
  });
});

describe("fact_financial writer for the extra accounts", () => {
  let companyId = "";
  beforeAll(() => {
    companyId = ulid();
    db.run("INSERT INTO md_company (id, name_ko, dart_corp_code, created_at) VALUES (?,?,?,?)", [
      companyId,
      "writer-co",
      "00777001",
      NOW,
    ]);
  });
  afterEach(() => {
    db.run("DELETE FROM fact_financial WHERE company_id = ?", [companyId]);
  });

  const fetcher = (extra: Array<{ name: string; ifrsCode: string; value: number }>, interest = 100) =>
    (async (corpCode: string) => ({
      corpCode,
      found: true,
      items: [{ name: "영업이익", value: 300, unit: "KRW", year: "2025" }],
      yearly: [
        {
          year: "2025",
          items: [{ name: "영업이익", value: 300, unit: "KRW" }],
          extraItems: [
            {
              name: "이자비용",
              ifrsCode: "dart_AdjustmentsForInterestExpenses",
              value: interest,
              unit: "KRW" as const,
            },
            ...extra.map((e) => ({ ...e, unit: "KRW" as const })),
          ],
        },
      ],
      integrity: "ok" as const,
    })) as never;

  const stored = () =>
    db
      .query(
        `SELECT a.ifrs_code AS code, f.value, f.revision_no FROM fact_financial f JOIN md_account a ON a.id = f.account_id
         WHERE f.company_id = ? ORDER BY a.ifrs_code, f.revision_no`,
      )
      .all(companyId) as Array<{ code: string; value: number; revision_no: number }>;

  test("extras are stored by ifrs_code next to the original account; a re-sync is idempotent and a change appends a revision", async () => {
    process.env.DART_API_KEY ||= ["dart", "test", "key"].join("-");
    const extra = [
      { name: "이자지급", ifrsCode: "ifrs-full_InterestPaidClassifiedAsOperatingActivities", value: 20 },
      { name: "이자지급", ifrsCode: "ifrs-full_InterestPaidClassifiedAsFinancingActivities", value: 80 },
    ];
    const first = await syncCompanyFinancialFacts(db, companyId, { fetcher: fetcher(extra), corpCode: "00777001" });
    expect(first.inserted).toBe(4);
    expect(stored().map((r) => r.code)).toEqual([
      "dart_AdjustmentsForInterestExpenses",
      "ifrs-full_InterestPaidClassifiedAsFinancingActivities",
      "ifrs-full_InterestPaidClassifiedAsOperatingActivities",
      "ifrs-full_ProfitLossFromOperatingActivities",
    ]);
    const second = await syncCompanyFinancialFacts(db, companyId, { fetcher: fetcher(extra), corpCode: "00777001" });
    expect(second).toMatchObject({ inserted: 0, unchanged: 4 });
    const third = await syncCompanyFinancialFacts(db, companyId, {
      fetcher: fetcher(extra, 120),
      corpCode: "00777001",
    });
    expect(third).toMatchObject({ inserted: 1, unchanged: 3 });
    const interest = stored().filter((r) => r.code === "dart_AdjustmentsForInterestExpenses");
    expect(interest.map((r) => [r.revision_no, r.value])).toEqual([
      [1, 100],
      [2, 120],
    ]);
  });

  test("an extra account without an md_account row fails loudly (the writer never invents an account)", async () => {
    process.env.DART_API_KEY ||= ["dart", "test", "key"].join("-");
    await expect(
      syncCompanyFinancialFacts(db, companyId, {
        fetcher: fetcher([{ name: "x", ifrsCode: "ifrs-full_NotSeeded", value: 1 }]),
        corpCode: "00777001",
      }),
    ).rejects.toThrow(/migration 0201/);
  });

  test("a year without extraItems writes exactly what it did before the extension", async () => {
    process.env.DART_API_KEY ||= ["dart", "test", "key"].join("-");
    const plain = (async (corpCode: string) => ({
      corpCode,
      found: true,
      items: [{ name: "영업이익", value: 300, unit: "KRW", year: "2025" }],
      yearly: [{ year: "2025", items: [{ name: "영업이익", value: 300, unit: "KRW" }] }],
      integrity: "ok" as const,
    })) as never;
    const r = await syncCompanyFinancialFacts(db, companyId, { fetcher: plain, corpCode: "00777001" });
    expect(r).toMatchObject({ inserted: 1, unchanged: 0 });
    expect(stored()).toHaveLength(1);
  });
});
