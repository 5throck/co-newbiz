// @version 1.0.0
/**
 * ADR-0199 / spec 2026-11-16-s6-bulk-ai-eval-versioning Rows 2a + 2b — incremental DART collection seams and the
 * business-report evidence helpers. Scratch SQLite; DART, LLM and web are never called (fetch stub / injected fakes).
 *
 * Covers T17 (closed-year skip, byte-identical default seam, revision rule), T18 (incremental disclosure list), T19
 * (rcept_no immutability / extractor_version), T20 (corrected filing), T22 (freshness window incl. KST boundaries),
 * T24 (no cache poisoning), T12 (section extraction + citation validation).
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "dart-incr-"));
const DB_PATH = join(TMP, "t.sqlite");
process.env.CO_NEWBIZ_DB_PATH = DB_PATH;
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
const savedKey = process.env.DART_API_KEY;
process.env.DART_API_KEY = ["dart", "incr", "key"].join("-");

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(DB_PATH);
const db = getDb(DB_PATH);

const { ulid } = await import("../../db/lib/ulid.ts");
const { syncCompanyFinancialFacts, getCompanyFinancialFacts } = await import(
  "../../app/web-next/lib/dart-financial-facts.ts"
);
const dc = await import("../../app/web-next/lib/dart-client.ts");
const cache = await import("../../db/repositories/dart-evidence-cache.repository.ts");
const br = await import("../../app/web-next/lib/brownfield-business-report.ts");

afterAll(() => {
  resetDb();
  rmSync(TMP, { recursive: true, force: true });
  if (savedKey === undefined) delete process.env.DART_API_KEY;
  else process.env.DART_API_KEY = savedKey;
});

const CORP = "00123456";
let companyId = "";

function company(name: string, corp: string): string {
  const id = ulid();
  db.run("INSERT INTO md_company (id, name_ko, dart_corp_code, created_at) VALUES (?,?,?,?)", [
    id,
    name,
    corp,
    "2026-01-01T00:00:00Z",
  ]);
  return id;
}

type Spy = ((corp: string, opts?: { years?: number; fiscalYears?: number[] }) => Promise<any>) & {
  calls: Array<{ years?: number; fiscalYears?: number[] }>;
  latestValue: number;
  outcomeOverride: Record<number, "found" | "not_filed" | "error">;
};

/** Fake fetchFinancials: returns the requested years (fiscalYears, else the 5-year default window of `now`'s year). */
function fakeFetcher(nowYear: number): Spy {
  const spy = (async (_corp: string, opts: { years?: number; fiscalYears?: number[] } = {}) => {
    spy.calls.push({ years: opts.years, fiscalYears: opts.fiscalYears });
    const years = opts.fiscalYears ?? Array.from({ length: opts.years ?? 1 }, (_, i) => nowYear - 1 - i);
    const outcomes = years.map((y) => ({
      year: y,
      outcome: spy.outcomeOverride[y] ?? ("found" as const),
      detail: spy.outcomeOverride[y] === "error" ? "CFS ERR/BFS ERR" : undefined,
    }));
    const yearly = outcomes
      .filter((o) => o.outcome === "found")
      .map((o) => ({
        year: String(o.year),
        items: [
          {
            name: "매출액",
            value: (o.year === nowYear - 1 ? spy.latestValue : 1_000_000 * (o.year - 2000)) * 1,
            unit: "KRW",
          },
          { name: "영업이익", value: 100_000 * (o.year - 2000), unit: "KRW" },
        ],
      }));
    return { corpCode: _corp, found: yearly.length > 0, items: [], yearly, yearOutcomes: outcomes, integrity: "ok" };
  }) as Spy;
  spy.calls = [];
  spy.latestValue = 50_000_000;
  spy.outcomeOverride = {};
  return spy;
}

const okValidator = Object.assign(async () => ({ validated: true as boolean | null, corpName: "삼성" }), { n: 0 });
let validatorCalls = 0;
const validator = async (..._a: unknown[]) => {
  validatorCalls++;
  return { validated: true as boolean | null, corpName: "삼성" };
};

const state = () => cache.getCorpSyncState(db, CORP);
const setFinancialChecked = (iso: string | null) => {
  db.run("UPDATE dart_corp_sync_state SET financial_checked_at = ? WHERE corp_code = ?", [iso, CORP]);
};
const setCorpChecked = (iso: string | null) => {
  db.run("UPDATE dart_corp_sync_state SET corp_code_checked_at = ? WHERE corp_code = ?", [iso, CORP]);
};

const T0 = "2026-10-15T03:00:00.000Z"; // outside the filing season; latest business year = 2025
const daysAfter = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86_400_000).toISOString();

beforeAll(() => {
  companyId = company("삼성", CORP);
});

describe("T17 — closed-year skip, default seam unchanged, revision rule", () => {
  test("first incremental sync fetches the full 5-year target window", async () => {
    const f = fakeFetcher(2026);
    const r = await syncCompanyFinancialFacts(db, companyId, {
      incremental: true,
      now: T0,
      fetcher: f as any,
      validator: validator as any,
    });
    expect(f.calls).toEqual([{ years: undefined, fiscalYears: [2021, 2022, 2023, 2024, 2025] }]);
    expect(r.years).toEqual([2021, 2022, 2023, 2024, 2025]);
    expect(r.fetched_years).toEqual([2021, 2022, 2023, 2024, 2025]);
    expect(state()?.financial_checked_at).toBe(T0);
  });

  test("window expired: only the latest year is fetched; equal value skipped, changed value is revision_no + 1", async () => {
    const f = fakeFetcher(2026);
    const r = await syncCompanyFinancialFacts(db, companyId, {
      incremental: true,
      now: daysAfter(T0, 31),
      fetcher: f as any,
      validator: validator as any,
    });
    expect(f.calls).toEqual([{ years: undefined, fiscalYears: [2025] }]);
    expect(r.inserted).toBe(0); // same values
    f.latestValue = 77_000_000;
    setFinancialChecked(T0);
    const r2 = await syncCompanyFinancialFacts(db, companyId, {
      incremental: true,
      now: daysAfter(T0, 31),
      fetcher: f as any,
      validator: validator as any,
    });
    expect(r2.inserted).toBe(1);
    const rev = db
      .query(
        "SELECT MAX(revision_no) m FROM fact_financial f JOIN md_period p ON p.id=f.period_id JOIN md_account a ON a.id=f.account_id WHERE f.company_id=? AND p.fiscal_year=2025 AND a.name_ko='매출액'",
      )
      .get(companyId) as { m: number };
    expect(rev.m).toBe(2);
    // closed years are untouched (still revision 1)
    const closed = db
      .query(
        "SELECT MAX(revision_no) m FROM fact_financial f JOIN md_period p ON p.id=f.period_id WHERE f.company_id=? AND p.fiscal_year=2022",
      )
      .get(companyId) as { m: number };
    expect(closed.m).toBe(1);
  });

  test("a missing closed year is added to the fetch set", async () => {
    db.run(
      "DELETE FROM fact_financial WHERE company_id = ? AND period_id IN (SELECT id FROM md_period WHERE fiscal_year = 2022)",
      [companyId],
    );
    setFinancialChecked(T0);
    const f = fakeFetcher(2026);
    await syncCompanyFinancialFacts(db, companyId, {
      incremental: true,
      now: daysAfter(T0, 31),
      fetcher: f as any,
      validator: validator as any,
    });
    expect(f.calls[0]?.fiscalYears).toEqual([2022, 2025]);
  });

  test("existing callers (no incremental) still request the 5-year window — byte-identical seam", async () => {
    const f = fakeFetcher(2026);
    await syncCompanyFinancialFacts(db, companyId, { fetcher: f as any, validator: validator as any });
    expect(f.calls).toEqual([{ years: 5, fiscalYears: undefined }]);
  });
});

describe("T22 — freshness window (KST evaluation date)", () => {
  async function callsAt(checkedAt: string, now: string, force = false): Promise<number> {
    setFinancialChecked(checkedAt);
    const f = fakeFetcher(2026);
    await syncCompanyFinancialFacts(db, companyId, {
      incremental: true,
      forceRefresh: force,
      now,
      fetcher: f as any,
      validator: validator as any,
    });
    return f.calls.length;
  }
  test("outside the season: 29 days fresh, 31 days stale", async () => {
    const now = "2026-10-20T03:00:00.000Z";
    expect(await callsAt(daysAfter(now, -29), now)).toBe(0);
    expect(await callsAt(daysAfter(now, -31), now)).toBe(1);
  });
  test("in season (April): 6 days fresh, 8 days stale", async () => {
    const now = "2026-04-20T03:00:00.000Z";
    expect(await callsAt(daysAfter(now, -6), now)).toBe(0);
    expect(await callsAt(daysAfter(now, -8), now)).toBe(1);
  });
  test("boundaries: Feb 25 check is stale on Mar 4 (KST); May 31 uses 7 days; Jun 1 uses 30 days", async () => {
    expect(await callsAt("2026-02-25T03:00:00.000Z", "2026-03-04T03:00:00.000Z")).toBe(1);
    expect(await callsAt("2026-05-25T03:00:00.000Z", "2026-05-31T03:00:00.000Z")).toBe(0); // 6 days, season window 7
    expect(await callsAt("2026-05-23T03:00:00.000Z", "2026-05-31T03:00:00.000Z")).toBe(1); // 8 days
    expect(await callsAt("2026-05-25T03:00:00.000Z", "2026-06-01T03:00:00.000Z")).toBe(0); // 7 days, normal window 30
  });
  test("each kind is evaluated independently; the corp-code check is reused inside the window", async () => {
    const now = "2026-10-20T03:00:00.000Z";
    setCorpChecked(daysAfter(now, -3));
    setFinancialChecked(daysAfter(now, -40));
    validatorCalls = 0;
    const f = fakeFetcher(2026);
    await syncCompanyFinancialFacts(db, companyId, {
      incremental: true,
      now,
      fetcher: f as any,
      validator: validator as any,
    });
    expect(validatorCalls).toBe(0); // corp-code check fresh
    expect(f.calls.length).toBe(1); // financial stale
    setCorpChecked(daysAfter(now, -40));
    await syncCompanyFinancialFacts(db, companyId, {
      incremental: true,
      now,
      fetcher: f as any,
      validator: validator as any,
    });
    expect(validatorCalls).toBe(1);
  });
  test("force_refresh validates the corp code and fetches all 5 years", async () => {
    const now = "2026-10-20T03:00:00.000Z";
    setCorpChecked(daysAfter(now, -1));
    setFinancialChecked(daysAfter(now, -1));
    validatorCalls = 0;
    const f = fakeFetcher(2026);
    await syncCompanyFinancialFacts(db, companyId, {
      incremental: true,
      forceRefresh: true,
      now,
      fetcher: f as any,
      validator: validator as any,
    });
    expect(validatorCalls).toBe(1);
    expect(f.calls[0]?.fiscalYears).toEqual([2021, 2022, 2023, 2024, 2025]);
  });
});

describe("T24 — a failed fetch never poisons the cache", () => {
  test("an `error` year keeps financial_checked_at; rows for found years still land", async () => {
    const now = "2026-10-25T03:00:00.000Z";
    setFinancialChecked("2026-01-01T00:00:00.000Z");
    const f = fakeFetcher(2026);
    f.outcomeOverride[2025] = "error";
    const r = await syncCompanyFinancialFacts(db, companyId, {
      incremental: true,
      now,
      fetcher: f as any,
      validator: validator as any,
    });
    expect(state()?.financial_checked_at).toBe("2026-01-01T00:00:00.000Z");
    expect(r.fetch_errors?.[0]).toContain("2025");
    expect(r.warnings.some((w) => w.startsWith("year_error"))).toBe(true);
  });
  test("a not_filed latest year is a normal outcome (warning) and advances freshness", async () => {
    const now = "2026-10-26T03:00:00.000Z";
    setFinancialChecked("2026-01-01T00:00:00.000Z");
    const f = fakeFetcher(2026);
    f.outcomeOverride[2025] = "not_filed";
    const r = await syncCompanyFinancialFacts(db, companyId, {
      incremental: true,
      now,
      fetcher: f as any,
      validator: validator as any,
    });
    expect(r.warnings).toContain("year_not_filed: 2025");
    expect(state()?.financial_checked_at).toBe(now);
  });
  test("validated: null (DART unreachable) keeps corp_code_checked_at", async () => {
    const now = "2026-10-27T03:00:00.000Z";
    setCorpChecked("2026-01-01T00:00:00.000Z");
    setFinancialChecked("2026-10-27T00:00:00.000Z");
    const f = fakeFetcher(2026);
    await syncCompanyFinancialFacts(db, companyId, {
      incremental: true,
      now,
      fetcher: f as any,
      validator: (async () => ({ validated: null })) as any,
    });
    expect(state()?.corp_code_checked_at).toBe("2026-01-01T00:00:00.000Z");
  });
  test("transient fetchDisclosureText error writes no extract; not_zip is cached and not re-fetched", async () => {
    const rcept = "20260301000111";
    cache.insertDisclosures(
      db,
      [
        {
          rcept_no: rcept,
          corp_code: CORP,
          corp_name: "삼성",
          report_nm: "사업보고서 (2025.12)",
          rcept_dt: "20260301",
        },
      ],
      T0,
    );
    let n = 0;
    const transient = async (r: string) => {
      n++;
      return { available: false, rcept_no: r, error: "DART HTTP 503" };
    };
    const a = await br.ensureBusinessReportExtract(db, rcept, transient as any, T0);
    expect(a.status).toBe("transient");
    expect(cache.getBusinessReportExtract(db, rcept, br.BUSINESS_REPORT_EXTRACTOR_VERSION)).toBeNull();
    const hwp = async (r: string) => {
      n++;
      return { available: false, rcept_no: r, error: "원문이 ZIP이 아닙니다(HWP 바이너리 등) — OCR 후속 경로 필요" };
    };
    const b = await br.ensureBusinessReportExtract(db, rcept, hwp as any, T0);
    expect(b.extract?.status).toBe("not_zip");
    const before = n;
    await br.ensureBusinessReportExtract(db, rcept, hwp as any, T0);
    expect(n).toBe(before); // cached negative: zero fetches
  });
});

describe("T20 — corrected filing", () => {
  test("selectEvidenceBusinessReport picks the correction; selectBusinessReport is unchanged", () => {
    const rows = [
      {
        rcept_no: "20240315000001",
        report_nm: "사업보고서 (2023.12)",
        rcept_dt: "20240315",
        corp_name: "삼성",
        preset: "business" as const,
      },
      {
        rcept_no: "20240420000002",
        report_nm: "[기재정정]사업보고서 (2023.12)",
        rcept_dt: "20240420",
        corp_name: "삼성",
        preset: "business" as const,
      },
    ];
    expect(dc.selectEvidenceBusinessReport(rows)?.rcept_no).toBe("20240420000002");
    expect(dc.selectBusinessReport(rows)?.rcept_no).toBe("20240315000001");
  });
  test("a correction first seen after the last financial check adds the closed year to the fetch set", async () => {
    const now = "2026-11-20T03:00:00.000Z";
    setFinancialChecked("2026-10-01T00:00:00.000Z");
    cache.insertDisclosures(
      db,
      [
        {
          rcept_no: "20261105000999",
          corp_code: CORP,
          corp_name: "삼성",
          report_nm: "[기재정정]사업보고서 (2023.12)",
          rcept_dt: "20261105",
        },
      ],
      "2026-11-06T00:00:00.000Z",
    );
    const f = fakeFetcher(2026);
    await syncCompanyFinancialFacts(db, companyId, {
      incremental: true,
      now,
      fetcher: f as any,
      validator: validator as any,
    });
    expect(f.calls[0]?.fiscalYears).toEqual([2023, 2025]);
    // the original filing's extract is untouched and the correction is a distinct rcept_no (T19 immutability)
    expect(() => db.run("UPDATE dart_disclosure SET report_nm = 'x' WHERE rcept_no = ?", ["20261105000999"])).toThrow();
  });
});

describe("T18 — incremental disclosure list", () => {
  const savedFetch = globalThis.fetch;
  const requested: string[] = [];
  function row(n: number, dt: string) {
    return {
      rcept_no: `2026${String(n).padStart(10, "0")}`,
      corp_code: CORP,
      corp_name: "삼성",
      report_nm: `공시 ${n}`,
      rcept_dt: dt,
      flr_nm: "삼성",
      rm: "",
    };
  }
  function stub(pages: Record<number, { status: string; list?: unknown[]; total_page?: number }>) {
    globalThis.fetch = Object.assign(
      (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        requested.push(url);
        const p = Number(new URL(url).searchParams.get("page_no"));
        return Promise.resolve(
          new Response(JSON.stringify(pages[p] ?? { status: "013" }), {
            headers: { "content-type": "application/json" },
          }),
        );
      },
      { preconnect: (_u: string | URL) => {} },
    ) as typeof fetch;
  }
  afterAll(() => {
    globalThis.fetch = savedFetch;
  });

  test("first fetch covers all pages from today minus 36 months; the cursor advances only after the last page", async () => {
    const CORP2 = "00999999";
    const now = "2026-11-16T03:00:00.000Z";
    stub({
      1: { status: "000", total_page: 2, list: [row(1, "20261101"), row(2, "20261001")] },
      2: { status: "010" }, // page 2 fails
    });
    const start = cache.disclosureQueryStart(null, now);
    expect(start).toBe("20231116");
    const end = cache.disclosureQueryEnd(now);
    const failed = await dc.listDisclosuresSince(CORP2, start, end);
    expect(failed.complete).toBe(false);
    expect(failed.rows).toHaveLength(2);
    cache.insertDisclosures(
      db,
      failed.rows.map((r) => ({ ...r, corp_code: CORP2 })),
      now,
    ); // page-1 rows are true facts
    expect(cache.getCorpSyncState(db, CORP2)?.disclosures_complete_through ?? null).toBeNull(); // cursor not advanced
    expect(cache.disclosureQueryStart(cache.getCorpSyncState(db, CORP2), now)).toBe(start); // retry restarts from the old cursor

    stub({
      1: { status: "000", total_page: 2, list: [row(1, "20261101"), row(2, "20261001")] },
      2: { status: "000", total_page: 2, list: [row(3, "20250101")] },
    });
    const ok = await dc.listDisclosuresSince(CORP2, start, end);
    expect(ok.complete).toBe(true);
    expect(ok.rows).toHaveLength(3);
    const inserted = cache.insertDisclosures(
      db,
      ok.rows.map((r) => ({ ...r, corp_code: CORP2 })),
      now,
    );
    expect(inserted).toBe(1); // overlap rows are ignored, not duplicated
    cache.markDisclosuresComplete(db, CORP2, end, now);

    const next = cache.disclosureQueryStart(cache.getCorpSyncState(db, CORP2), "2026-11-20T03:00:00.000Z");
    expect(next).toBe("20261115"); // complete_through (20261116) minus one day
  });

  test("status 013 is a complete, empty answer; requests carry no type filter and 100 rows per page", async () => {
    requested.length = 0;
    stub({});
    const r = await dc.listDisclosuresSince(CORP, "20260101", "20260131");
    expect(r).toEqual({ complete: true, rows: [] });
    expect(requested[0]).toContain("page_count=100");
    expect(requested[0]).not.toContain("pblntf_ty");
  });
});

describe("T19 — rcept_no immutability and extractor_version", () => {
  test("an existing extract causes zero fetches even for the same call; a version bump causes exactly one", async () => {
    const rcept = "20260401000222";
    cache.insertDisclosures(
      db,
      [
        {
          rcept_no: rcept,
          corp_code: CORP,
          corp_name: "삼성",
          report_nm: "사업보고서 (2025.12)",
          rcept_dt: "20260401",
        },
      ],
      T0,
    );
    let n = 0;
    const text = `II. 사업의 내용 1. 사업의 개요 회사 개요 설명 문단입니다. 2. 주요 제품 및 서비스 가. 주요 제품 현황 정밀 가공 부품과 모듈을 생산합니다. 3. 원재료 및 생산설비 원재료 설명. ${"x ".repeat(100)}`;
    const fetcher = async (r: string) => {
      n++;
      return { available: true, rcept_no: r, text };
    };
    await br.ensureBusinessReportExtract(db, rcept, fetcher as any, T0);
    expect(n).toBe(1);
    await br.ensureBusinessReportExtract(db, rcept, fetcher as any, T0);
    expect(n).toBe(1);
    await br.ensureBusinessReportExtract(db, rcept, fetcher as any, T0, "br-2");
    expect(n).toBe(2);
    expect(cache.getBusinessReportExtract(db, rcept, "br-1")).not.toBeNull(); // the old version row stays
  });
});

describe("T12 — section extraction and citation validation", () => {
  const BODY = [
    "목 차 II. 사업의 내용 1. 사업의 개요 2. 주요 제품 및 서비스 3. 원재료 4. 생산설비 5. 연구개발활동 6. 지적재산권 III. 재무",
    "II. 사업의 내용",
    "1. 사업의 개요 당사는 정밀 부품 제조사입니다.",
    "2. 주요 제품 및 서비스 가. 주요 제품 현황 당사의 주요 제품은 선박용 크랭크샤프트와 터보차저 부품입니다. 매출의 70%를 차지합니다.",
    "3. 생산설비 가. 생산능력 연간 12,000톤 규모의 단조 설비와 정밀 가공 라인을 보유합니다.",
    "4. 연구개발활동 가. 연구개발 담당조직 기술연구소 40명. 나. 연구개발 비용 당기 연구개발비용은 매출액 대비 3.2%인 45억원입니다.",
    "5. 지적재산권 당사는 국내 특허 42건과 해외 특허 7건을 보유하고 있습니다.",
    "III. 재무에 관한 사항 요약 재무정보 표시",
  ].join(" ");

  test("the four sections are found on fixture text; the TOC line is not mistaken for a heading", () => {
    const s = br.extractBusinessReportSections(BODY);
    expect(Object.keys(s).sort()).toEqual(["facilities", "ip", "main_products", "rnd"]);
    expect(s.rnd?.text).toContain("45억원");
    expect(s.main_products?.text).toContain("크랭크샤프트");
    expect(s.ip?.text).toContain("특허 42건");
    expect(s.facilities?.text).toContain("12,000톤");
  });

  test("sections are capped at 8,000 characters with a truncated flag", () => {
    const long = `II. 사업 2. 주요 제품 및 서비스 ${"제품설명 ".repeat(3000)} 3. 생산설비 설비`;
    const s = br.extractBusinessReportSections(long);
    expect(s.main_products?.text.length).toBe(8000);
    expect(s.main_products?.truncated).toBe(true);
  });

  test("a body without recognisable sections is a cached `no_sections` negative", async () => {
    const rcept = "20260501000333";
    cache.insertDisclosures(
      db,
      [
        {
          rcept_no: rcept,
          corp_code: CORP,
          corp_name: "삼성",
          report_nm: "사업보고서 (2025.12)",
          rcept_dt: "20260501",
        },
      ],
      T0,
    );
    const r = await br.ensureBusinessReportExtract(
      db,
      rcept,
      (async (x: string) => ({ available: true, rcept_no: x, text: "아무 내용 없음" })) as any,
      T0,
    );
    expect(r.extract?.status).toBe("no_sections");
  });

  const ctx = () => ({
    rceptNo: "20260301000111",
    sections: br.extractBusinessReportSections(BODY),
    disclosures: [{ rcept_no: "20260301000111", report_nm: "사업보고서 (2025.12)" }],
    profileText: "강점: 정밀 가공 역량",
  });

  test("only quotes found verbatim in held evidence survive; web citations from the model are ignored", () => {
    const c = br.validateCitations(
      [
        { kind: "business_report", ref: "20260301000111:rnd", quote: "연구개발비용은 매출액 대비 3.2%인 45억원" },
        { kind: "business_report", ref: "20260301000111:rnd", quote: "존재하지 않는 구절을 만들어냅니다" },
        { kind: "business_report", ref: "20260301000111:ip", quote: "연구개발비용은 매출액 대비 3.2%" }, // wrong section
        { kind: "business_report", ref: "20260301000111:ip", quote: "국내 특허 42건과 해외 특허 7건" },
        { kind: "web", ref: "https://x.example", quote: "web text from the model" },
        { kind: "disclosure", ref: "20260301000111", quote: "사업보고서" }, // bare report name: too short to count
        { kind: "disclosure", ref: "20260301000111", quote: "사업보고서 (2025.12)" },
        { kind: "profile", ref: "profile", quote: "정밀 가공 역량" },
      ],
      ctx(),
    );
    expect(c.map((x) => `${x.kind}:${x.ref}`)).toEqual([
      "business_report:20260301000111:rnd",
      "business_report:20260301000111:ip",
      "disclosure:20260301000111",
    ]); // capped at 3
    const profileOnly = br.validateCitations([{ kind: "profile", ref: "profile", quote: "정밀 가공 역량" }], ctx());
    expect(profileOnly).toEqual([{ kind: "profile", ref: "profile", quote: "" }]); // profile text is never copied out
  });

  test("a citation of a missing section or another filing is dropped", () => {
    const none = br.validateCitations(
      [
        { kind: "business_report", ref: "20260301000111:facilities_x", quote: "아무 구절이나 길게 적습니다" },
        { kind: "business_report", ref: "99999999999999:rnd", quote: "연구개발비용은 매출액 대비" },
      ],
      ctx(),
    );
    expect(none).toEqual([]);
  });
});

describe("selectors stay consistent with the cache repository", () => {
  test("getCompanyFinancialFacts still dedupes to the latest revision after incremental revisions", () => {
    const facts = getCompanyFinancialFacts(db, companyId);
    const rev = facts.rows.find((r) => r.fiscal_year === 2025 && r.account_name === "매출액");
    expect(rev?.revision_no).toBeGreaterThanOrEqual(2);
  });
});
