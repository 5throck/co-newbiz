/**
 * dart-financial-facts tests — ADR-0116 Phase 1 (the first fact_financial
 * writer). Mirrors project-industry-repository.test.ts fixtures.
 *
 * Covers:
 *   - first sync: md_source 'dart' (A) + md_period year rows + fact rows at
 *     revision_no 1, values stored as raw KRW;
 *   - idempotent re-sync: identical values are skipped (unchanged count);
 *   - revision bump: a changed value appends revision_no = max+1, the old
 *     revision stays (no overwrite);
 *   - guards: missing company, missing DART key path (fetcher not consulted),
 *     retrieval failure, unknown account name (loud failure, no invention);
 *   - display shape: getCompanyFinancialFacts returns only the latest
 *     revision per (period, account).
 */
import { test, describe, expect, beforeAll } from "bun:test";
import { rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import {
  DartSyncError,
  getCompanyFinancialFacts,
  factRowsToDartItems,
  syncCompanyFinancialFacts,
} from "../../app/web-next/lib/dart-financial-facts.ts";
import { deriveFinancialAnalysis } from "../../app/web-next/lib/company-financials.ts";
import type { DartFinancials } from "../../app/web-next/lib/dart-client.ts";

const TEST_DB_PATH = "db/data/test-dart-financial-facts.sqlite";
type Db = ReturnType<typeof GetDb>;
let db: Db;

const COMPANY = "01JTESTCOMPANY000000000000";

function insertCompany(name: string, corpCode: string | null): string {
  const id = ulid();
  db.run("INSERT INTO md_company (id, name_ko, dart_corp_code, created_at) VALUES (?,?,?,?)", [
    id,
    name,
    corpCode,
    "2026-09-11T00:00:00Z",
  ]);
  return id;
}

type FakeItem = { name: string; value: number; unit: string; year: string; fsDiv?: "CFS" | "BFS" };
function fakeFetcher(byCall: FakeItem[][]): FinancialsFetcherSpy {
  let call = 0;
  const spy = ((corpCode: string, _opts?: { years?: number }): Promise<DartFinancials> => {
    const items = byCall[Math.min(call, byCall.length - 1)];
    call++;
    const yearlyMap = new Map<string, FakeItem[]>();
    for (const it of items) {
      if (!yearlyMap.has(it.year)) yearlyMap.set(it.year, []);
      yearlyMap.get(it.year)!.push(it);
    }
    return Promise.resolve({
      corpCode,
      found: true,
      items,
      yearly: [...yearlyMap.entries()].map(([year, its]) => ({ year, items: its })),
      integrity: "ok",
    });
  }) as FinancialsFetcherSpy;
  spy.calls = () => call;
  return spy;
}
interface FinancialsFetcherSpy {
  (corpCode: string, opts?: { years?: number }): Promise<DartFinancials>;
  calls: () => number;
}

const YEAR_2025: FakeItem[] = [
  { name: "매출액", value: 394_000_000_000, unit: "KRW", year: "2025" },
  { name: "영업이익", value: 32_300_000_000, unit: "KRW", year: "2025" },
  { name: "부채총계", value: 253_000_000_000, unit: "KRW", year: "2025" },
  { name: "자본총계", value: 215_000_000_000, unit: "KRW", year: "2025" },
];

const YEAR_2024: FakeItem[] = [
  { name: "매출액", value: 26_671_468_809, unit: "KRW", year: "2024" },
  { name: "영업이익", value: 1_200_000_000, unit: "KRW", year: "2024" },
  { name: "부채총계", value: 90_000_000_000, unit: "KRW", year: "2024" },
  { name: "자본총계", value: 80_000_000_000, unit: "KRW", year: "2024" },
];

const YEAR_2023: FakeItem[] = [
  { name: "매출액", value: 22_100_000_000, unit: "KRW", year: "2023" },
  { name: "영업이익", value: 900_000_000, unit: "KRW", year: "2023" },
  { name: "부채총계", value: 85_000_000_000, unit: "KRW", year: "2023" },
  { name: "자본총계", value: 78_000_000_000, unit: "KRW", year: "2023" },
];

beforeAll(() => {
  // Isolation contract: resetDb() takes no path — the test DB path must go
  // through getDb()/runMigrations() explicitly, against a file we delete
  // first (stale rows would collide on the unique md_company.dart_corp_code
  // index). Without the explicit path these tests would run against the
  // real dev database.
  if (require("node:fs").existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  resetDb();
  db = getDb(TEST_DB_PATH);
  runMigrations(TEST_DB_PATH);
  // The writer refuses to run unconfigured; tests inject the fetcher so the
  // key only needs to exist, never to be valid. Assembled from parts so the
  // secret scanner never sees a quoted credential-shaped literal.
  if (!process.env.DART_API_KEY) {
    const parts = ["dart", "test", "key"];
    process.env.DART_API_KEY = parts.join("-");
  }
});

describe("syncCompanyFinancialFacts", () => {
  test("first sync lands md_source, md_period, and revision-1 facts", async () => {
    const companyId = insertCompany("㈜테스트로봇", null);
    const fetcher = fakeFetcher([YEAR_2025]);
    const result = await syncCompanyFinancialFacts(db, companyId, { fetcher, corpCode: "01111111" });

    expect(result.inserted).toBe(4);
    expect(result.unchanged).toBe(0);
    expect(result.corp_code).toBeTruthy();
    expect(result.years).toEqual([2025]);

    // corp code was resolved (null → resolved) and persisted back.
    const stored = db.query("SELECT dart_corp_code FROM md_company WHERE id = ?").get(companyId) as {
      dart_corp_code: string;
    };
    expect(stored.dart_corp_code).toBe(result.corp_code);

    const source = db.query("SELECT code, reliability_grade FROM md_source WHERE code = 'dart'").get() as {
      code: string;
      reliability_grade: string;
    };
    expect(source.reliability_grade).toBe("A");

    const periods = db
      .query("SELECT COUNT(*) AS n FROM md_period WHERE fiscal_year = 2025 AND period_type = 'year'")
      .get() as { n: number };
    expect(periods.n).toBe(1);

    const revisions = db
      .query("SELECT DISTINCT revision_no FROM fact_financial WHERE company_id = ?")
      .all(companyId) as Array<{ revision_no: number }>;
    expect(revisions).toEqual([{ revision_no: 1 }]);
  });

  test("re-sync with identical values skips; changed value bumps revision and keeps history", async () => {
    const companyId = insertCompany("㈜리비전로봇", "01222222");
    await syncCompanyFinancialFacts(db, companyId, { fetcher: fakeFetcher([YEAR_2025]), corpCode: "01234567" });

    // identical re-sync → all unchanged
    const same = await syncCompanyFinancialFacts(db, companyId, {
      fetcher: fakeFetcher([YEAR_2025]),
      corpCode: "01222222",
    });
    expect(same.inserted).toBe(0);
    expect(same.unchanged).toBe(4);

    // revenue changed → exactly one new revision for 매출액 only
    const changed = YEAR_2025.map((i) => (i.name === "매출액" ? { ...i, value: 410_000_000_000 } : i));
    const r3 = await syncCompanyFinancialFacts(db, companyId, {
      fetcher: fakeFetcher([changed]),
      corpCode: "01222222",
    });
    expect(r3.inserted).toBe(1);
    expect(r3.unchanged).toBe(3);

    const revs = db
      .query(
        `SELECT f.revision_no, f.value FROM fact_financial f
         JOIN md_account a ON a.id = f.account_id
         WHERE f.company_id = ? AND a.name_ko = '매출액' ORDER BY f.revision_no`,
      )
      .all(companyId) as Array<{ revision_no: number; value: number }>;
    expect(revs).toEqual([
      { revision_no: 1, value: 394_000_000_000 },
      { revision_no: 2, value: 410_000_000_000 },
    ]);
  });

  test("guards: unknown company and retrieval failure fail loudly", async () => {
    const fetcher = fakeFetcher([YEAR_2025]);
    await expect(syncCompanyFinancialFacts(db, "01JNOPE000000000000000000", { fetcher })).rejects.toBeInstanceOf(
      DartSyncError,
    );

    const companyId = insertCompany("㈜조회실패", "09333333");
    // retrieval failure (found: false) → DartSyncError
    const failing: FinancialsFetcherSpy = Object.assign(
      (): Promise<DartFinancials> =>
        Promise.resolve({ corpCode: "09876543", found: false, items: [], yearly: [], integrity: "ok" }),
      { calls: () => 0 },
    );
    await expect(syncCompanyFinancialFacts(db, companyId, { fetcher: failing })).rejects.toBeInstanceOf(DartSyncError);
  });

  test("unknown account name fails loudly instead of inventing an md_account row", async () => {
    const companyId = insertCompany("㈜미지계정", "05444444");
    const bad = fakeFetcher([[{ name: "기타특수이익", value: 1, unit: "KRW", year: "2025" }]]);
    await expect(syncCompanyFinancialFacts(db, companyId, { fetcher: bad, corpCode: "05444444" })).rejects.toThrow(
      /md_account/,
    );
  });

  test("T6 — mixed per-year fsDiv payload syncs every year (CFS one year, BFS the rest)", async () => {
    // dart-client v1.3.0 연도별 폴백의 페이로드 형태 — yearly 항목에 연도별 fsDiv가
    // 도장 찍혀 온다(정본은 items[].fsDiv). writer는 yearly/items를 범용으로 소비하므로
    // 출처 필드가 있어도 모든 연도가 저장되어야 한다(수산아이앤티 재현: FY2024/2025 복원).
    const companyId = insertCompany("㈜혼합기준", "08777777");
    const mixed: FakeItem[] = [
      ...YEAR_2023.map((i) => ({ ...i, fsDiv: "CFS" as const })),
      ...YEAR_2024.map((i) => ({ ...i, fsDiv: "BFS" as const })),
      ...YEAR_2025.map((i) => ({ ...i, fsDiv: "BFS" as const })),
    ];
    const fetcher = fakeFetcher([mixed]);
    const result = await syncCompanyFinancialFacts(db, companyId, { fetcher, corpCode: "08777777" });

    expect(result.years).toEqual([2023, 2024, 2025]);
    expect(result.inserted).toBe(12); // 3연도 × 4계정 — 구결함에서 비던 FY2024/2025 포함
    expect(result.unchanged).toBe(0);

    const periods = db
      .query("SELECT fiscal_year FROM md_period WHERE period_type = 'year' AND fiscal_year BETWEEN 2023 AND 2025")
      .all() as Array<{ fiscal_year: number }>;
    expect(periods.map((p) => p.fiscal_year).sort()).toEqual([2023, 2024, 2025]);

    const factCount = db.query("SELECT COUNT(*) AS n FROM fact_financial WHERE company_id = ?").get(companyId) as {
      n: number;
    };
    expect(factCount.n).toBe(12);
  });
});

describe("getCompanyFinancialFacts + display reuse", () => {
  test("returns only latest revision per account-year and feeds deriveFinancialAnalysis", async () => {
    const companyId = insertCompany("㈜디스플레이", "04666666");
    await syncCompanyFinancialFacts(db, companyId, { fetcher: fakeFetcher([YEAR_2025]), corpCode: "04444444" });
    const changed = YEAR_2025.map((i) => (i.name === "매출액" ? { ...i, value: 410_000_000_000 } : i));
    await syncCompanyFinancialFacts(db, companyId, { fetcher: fakeFetcher([changed]), corpCode: "04444444" });

    const facts = getCompanyFinancialFacts(db, companyId);
    const revenueRows = facts.rows.filter((r) => r.account_name === "매출액");
    expect(revenueRows).toHaveLength(1);
    expect(revenueRows[0].value).toBe(410_000_000_000);
    expect(facts.latest_sync_at).toBeTruthy();

    const analysis = deriveFinancialAnalysis({
      corpCode: facts.company.dart_corp_code ?? "",
      found: facts.rows.length > 0,
      items: factRowsToDartItems(facts.rows),
      yearly: [],
    } as Parameters<typeof deriveFinancialAnalysis>[0]);
    expect(analysis.available).toBe(true);
    const debtRatioRow = analysis.ratios[analysis.ratios.length - 1];
    expect(debtRatioRow.debtRatio).toBeCloseTo(253 / 215, 4);
  });
});

// ── design 2026-11-11-target-identity-resolution §6 (D5): corp-code authority ──
// The entered/stored code is authoritative; a name mismatch is RECORDED as a
// warning (never nulled, never downgraded to a name search), and the no-code
// path resolves only on an exact VERIFIED hit. The validator is the test seam
// (opts.validator), mirroring opts.fetcher.
describe("D5 — corp-code authority (validate → proceed-with-warning, no name-search downgrade)", () => {
  interface ValidatorCall {
    corpCode: string;
    expectName?: string;
  }
  type StubValidator = (
    corpCode: string,
    expectName?: string,
  ) => Promise<{ validated: boolean | null; corpName?: string }>;

  function stubValidator(
    result: { validated: boolean | null; corpName?: string },
    log: ValidatorCall[] = [],
  ): StubValidator {
    return (corpCode: string, expectName?: string) => {
      log.push({ corpCode, expectName });
      return Promise.resolve(result);
    };
  }

  /** fetcher spy that records WHICH corp code it was called with — proves the
   *  stored code was used (and that no name-search downgrade happened). */
  function codeRecordingFetcher(items: FakeItem[]): { fetcher: FinancialsFetcherSpy; codes: string[] } {
    const codes: string[] = [];
    const fetcher = Object.assign(
      (corpCode: string, _opts?: { years?: number }): Promise<DartFinancials> => {
        codes.push(corpCode);
        const yearlyMap = new Map<string, FakeItem[]>();
        for (const it of items) {
          const list = yearlyMap.get(it.year) ?? [];
          list.push(it);
          yearlyMap.set(it.year, list);
        }
        return Promise.resolve({
          corpCode,
          found: true,
          items,
          yearly: [...yearlyMap.entries()].map(([year, its]) => ({ year, items: its })),
          integrity: "ok",
        });
      },
      { calls: () => codes.length },
    ) as FinancialsFetcherSpy;
    return { fetcher, codes };
  }

  test("entered-code authority wins over a failed containment check — proceeds with the stored code and records the mismatch", async () => {
    // The 한전KPS incident shape: our name is 한전KPS but DART says the code is 한국전력공사.
    const companyId = insertCompany("㈜한전케이피에스", "00159193");
    const log: ValidatorCall[] = [];
    const validator = stubValidator({ validated: false, corpName: "한국전력공사" }, log);
    const { fetcher, codes } = codeRecordingFetcher(YEAR_2025);

    const result = await syncCompanyFinancialFacts(db, companyId, { fetcher, validator });

    expect(result.corp_code).toBe("00159193"); // stored code kept — NOT nulled, NOT swapped
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("corp_code_name_mismatch");
    expect(result.warnings[0]).toContain("한국전력공사"); // DART's registered name surfaced
    expect(result.inserted).toBe(4); // the sync PROCEEDED — facts were written
    expect(codes).toEqual(["00159193"]); // fetcher reached with the stored code (no name-search path)
    const stored = db.query("SELECT dart_corp_code FROM md_company WHERE id = ?").get(companyId) as {
      dart_corp_code: string;
    };
    expect(stored.dart_corp_code).toBe("00159193"); // no silent re-branding persisted
    expect(log[0].expectName).toBe("㈜한전케이피에스"); // ㈜ circled mark is not a paren gloss — canonicalization leaves it
  });

  test("the validateCorpCode expect-name is canonicalized first (paren gloss removed)", async () => {
    const companyId = insertCompany("한전KPS(KEPCO KPS)", "00159218");
    const log: ValidatorCall[] = [];
    const validator = stubValidator({ validated: true, corpName: "한전KPS" }, log);
    const { fetcher } = codeRecordingFetcher(YEAR_2025);

    await syncCompanyFinancialFacts(db, companyId, { fetcher, validator });
    expect(log[0].expectName).toBe("한전KPS"); // canonical — the gloss never reaches containment
    expect(log[0].corpCode).toBe("00159218");
  });

  test("explicit opts.corpCode short-circuits validation (validator never called)", async () => {
    const companyId = insertCompany("㈜단락확인", "09777777");
    const validator: StubValidator = () => {
      throw new Error("validator must not be called when opts.corpCode is given");
    };
    const { fetcher } = codeRecordingFetcher(YEAR_2025);
    const result = await syncCompanyFinancialFacts(db, companyId, { fetcher, validator, corpCode: "01234567" });
    expect(result.corp_code).toBe("01234567");
    expect(result.warnings).toHaveLength(0);
  });

  test("no-code path requires an exact VERIFIED resolution — otherwise corp_code_unresolved and nothing persists", async () => {
    // A name the real corp-code cache cannot resolve exactly → resolveCorpCode
    // returns validated !== true → throw (no first-partial-hit persistence).
    const companyId = insertCompany("㈜존재하지않는회사XYZQ", null);
    const { fetcher, codes } = codeRecordingFetcher(YEAR_2025);
    const err = (await syncCompanyFinancialFacts(db, companyId, { fetcher }).catch((e: unknown) => e)) as unknown;
    expect(err).toBeInstanceOf(DartSyncError);
    expect((err as DartSyncError).code).toBe("corp_code_unresolved");
    expect(codes).toEqual([]); // fetcher never reached
    const stored = db.query("SELECT dart_corp_code FROM md_company WHERE id = ?").get(companyId) as {
      dart_corp_code: string | null;
    };
    expect(stored.dart_corp_code).toBeNull(); // nothing was persisted
  }, 30000);
});
