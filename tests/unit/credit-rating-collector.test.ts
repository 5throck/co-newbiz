// @version 1.0.0
/**
 * ADR-0208 slice 2 - the credit-rating collector (app/web-next/lib/credit-rating-collector.ts): report location
 * (cached disclosure list, typed A001 fallback, correction preferred), one fetch per rcept_no and parser version,
 * cache discipline (a transient failure writes nothing; a non-ZIP document is a cached negative), and the OpenDART
 * debt-securities supplement. DART is injected - no live call.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-credit-rating-collector.sqlite";
const ENV_ORIGINALS: Record<string, string | undefined> = { CO_NEWBIZ_DB_PATH: process.env.CO_NEWBIZ_DB_PATH };
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { collectCreditRating } = await import("../../app/web-next/lib/credit-rating-collector.ts");
import type { CreditRatingCollectorDeps } from "../../app/web-next/lib/credit-rating-collector.ts";
const { insertDisclosures } = await import("../../db/repositories/dart-evidence-cache.repository.ts");
const repo = await import("../../db/repositories/dart-credit-rating.repository.ts");
const { CREDIT_RATING_PARSER_VERSION: V } = await import("../../db/lib/credit-rating-disclosure.ts");

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  for (const [k, v] of Object.entries(ENV_ORIGINALS)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const NOW = new Date("2026-11-26T03:00:00Z");
const REPORT_TEXT = `Ⅰ. 회사의 개요 사. 신용평가에 관한 사항 2026.05.13 회사채 AA- NICE신용평가(주) (AAA~D) 정기평정 2026.05.12 회사채 A+ 한국신용평가(주) (AAA~D) 정기평정 아. 종업원 현황 다수`;

type Calls = { text: string[]; list: number; bdrs: number };
function deps(opts: {
  texts?: Record<string, { available: boolean; text?: string; error?: string; truncated?: boolean }>;
  list?: { ok: boolean; rows: Array<Record<string, unknown>>; error?: string };
  bdrs?: { ok: boolean; filings: Array<Record<string, unknown>>; error?: string };
}): { d: CreditRatingCollectorDeps; calls: Calls } {
  const calls: Calls = { text: [], list: 0, bdrs: 0 };
  const d = {
    fetchDisclosureText: async (rcept: string) => {
      calls.text.push(rcept);
      const t = opts.texts?.[rcept] ?? { available: false, error: "DART HTTP 500" };
      return { rcept_no: rcept, ...t };
    },
    listBusinessReports: async () => {
      calls.list++;
      return (opts.list ?? { ok: true, rows: [] }) as never;
    },
    fetchDebtSecuritiesFilings: async () => {
      calls.bdrs++;
      return (opts.bdrs ?? { ok: true, filings: [] }) as never;
    },
  } as CreditRatingCollectorDeps;
  return { d, calls };
}
const listRow = (corp: string, rcept: string, name: string, dt: string) => ({
  rcept_no: rcept,
  corp_code: corp,
  corp_name: "Test Co",
  report_nm: name,
  rcept_dt: dt,
  flr_nm: null,
  rm: null,
});
const snaps = (corp: string) =>
  db.query("SELECT * FROM dart_credit_rating_snapshot WHERE corp_code = ? ORDER BY source_rcept_no").all(corp) as Array<
    Record<string, any>
  >;

describe("report location", () => {
  test("cached list with a recent report: no typed list call; one fetch; the snapshot holds the rows", async () => {
    const corp = "00100001";
    insertDisclosures(db, [listRow(corp, "20260310000001", "사업보고서 (2025.12)", "20260310")], NOW.toISOString());
    const { d, calls } = deps({ texts: { "20260310000001": { available: true, text: REPORT_TEXT } } });
    const r = await collectCreditRating(db, corp, NOW, d);
    expect(calls.list).toBe(0);
    expect(calls.text).toEqual(["20260310000001"]);
    expect(calls.bdrs).toBe(1);
    expect(r).toMatchObject({ report_rcept_no: "20260310000001", report_status: "parsed", report_fetched: true });
    const [s] = snaps(corp);
    expect(s).toMatchObject({ source_kind: "business_report", status: "parsed", parser_version: V, truncated: 0 });
    expect((JSON.parse(s?.ratings_json) as unknown[]).length).toBe(2);
  });

  test("the correction filing (newest rcept_dt) is preferred over the original", async () => {
    const corp = "00100002";
    insertDisclosures(
      db,
      [
        listRow(corp, "20260310000002", "사업보고서 (2025.12)", "20260310"),
        listRow(corp, "20260420000002", "[기재정정]사업보고서 (2025.12)", "20260420"),
      ],
      NOW.toISOString(),
    );
    const { d, calls } = deps({ texts: { "20260420000002": { available: true, text: REPORT_TEXT } } });
    const r = await collectCreditRating(db, corp, NOW, d);
    expect(r.report_rcept_no).toBe("20260420000002");
    expect(calls.text).toEqual(["20260420000002"]);
  });

  test("an empty cache falls back to the typed A001 list, and caches the list rows", async () => {
    const corp = "00100003";
    const { d, calls } = deps({
      list: { ok: true, rows: [listRow(corp, "20260315000003", "사업보고서 (2025.12)", "20260315")] },
      texts: { "20260315000003": { available: true, text: REPORT_TEXT } },
    });
    const r = await collectCreditRating(db, corp, NOW, d);
    expect(calls.list).toBe(1);
    expect(r.report_rcept_no).toBe("20260315000003");
    expect(db.query("SELECT COUNT(*) AS n FROM dart_disclosure WHERE corp_code = ?").get(corp)).toEqual({ n: 1 });
  });

  test("a cached report older than ~13 months triggers the typed list, which may find a newer one", async () => {
    const corp = "00100004";
    insertDisclosures(db, [listRow(corp, "20250310000004", "사업보고서 (2024.12)", "20250310")], NOW.toISOString());
    const { d, calls } = deps({
      list: { ok: true, rows: [listRow(corp, "20260316000004", "사업보고서 (2025.12)", "20260316")] },
      texts: { "20260316000004": { available: true, text: REPORT_TEXT } },
    });
    const r = await collectCreditRating(db, corp, NOW, d);
    expect(calls.list).toBe(1);
    expect(r.report_rcept_no).toBe("20260316000004");
  });

  test("no business report at all is 'not_found' (not an error, nothing written for the report)", async () => {
    const corp = "00100005";
    const { d } = deps({});
    const r = await collectCreditRating(db, corp, NOW, d);
    expect(r).toMatchObject({ report_rcept_no: null, report_status: "not_found", report_fetched: false });
    expect(snaps(corp)).toEqual([]);
  });
});

describe("cache discipline", () => {
  test("a second collection reuses the snapshot: ZERO document fetches", async () => {
    const corp = "00100010";
    insertDisclosures(db, [listRow(corp, "20260310000010", "사업보고서 (2025.12)", "20260310")], NOW.toISOString());
    const first = deps({ texts: { "20260310000010": { available: true, text: REPORT_TEXT } } });
    await collectCreditRating(db, corp, NOW, first.d);
    const second = deps({});
    const r = await collectCreditRating(db, corp, NOW, second.d);
    expect(second.calls.text).toEqual([]);
    expect(r).toMatchObject({ report_status: "parsed", report_fetched: false });
    expect(snaps(corp)).toHaveLength(1);
  });

  test("a transient fetch failure writes NOTHING; with the bdRs lookup also failing the run fails", async () => {
    const corp = "00100011";
    insertDisclosures(db, [listRow(corp, "20260310000011", "사업보고서 (2025.12)", "20260310")], NOW.toISOString());
    const bad = deps({ bdrs: { ok: false, filings: [], error: "DART bdRs status 800" } });
    await expect(collectCreditRating(db, corp, NOW, bad.d)).rejects.toThrow(/DART could not be read/);
    expect(snaps(corp)).toEqual([]);
    // report failed but bdRs worked: a success with a warning, and still no report snapshot
    const partial = deps({});
    const r = await collectCreditRating(db, corp, NOW, partial.d);
    expect(r.report_status).toBe("transient_error");
    expect(r.warnings.some((w) => w.startsWith("business report text unavailable"))).toBe(true);
    expect(snaps(corp)).toEqual([]);
  });

  test("a document that is not a ZIP is a deterministic negative and is cached (no re-download)", async () => {
    const corp = "00100012";
    insertDisclosures(db, [listRow(corp, "20260310000012", "사업보고서 (2025.12)", "20260310")], NOW.toISOString());
    const { d } = deps({
      texts: { "20260310000012": { available: false, error: "원문이 ZIP이 아닙니다(HWP 바이너리 등)" } },
    });
    const r = await collectCreditRating(db, corp, NOW, d);
    expect(r.report_status).toBe("not_zip");
    expect(snaps(corp)[0]).toMatchObject({ status: "not_zip", ratings_json: "[]", issues_json: null });
    const again = deps({});
    await collectCreditRating(db, corp, NOW, again.d);
    expect(again.calls.text).toEqual([]);
  });

  test("a report without the section is a recorded section_absent, and a truncated text is flagged", async () => {
    const corp = "00100013";
    insertDisclosures(db, [listRow(corp, "20260310000013", "사업보고서 (2025.12)", "20260310")], NOW.toISOString());
    const { d } = deps({
      texts: { "20260310000013": { available: true, text: "Ⅰ. 회사의 개요 내용만 있음", truncated: true } },
    });
    const r = await collectCreditRating(db, corp, NOW, d);
    expect(r.report_status).toBe("section_absent");
    expect(snaps(corp)[0]).toMatchObject({ status: "section_absent", truncated: 1 });
  });
});

describe("OpenDART debt-securities supplement", () => {
  test("one snapshot per filing; rating text parsed; a repeat run writes nothing new", async () => {
    const corp = "00100020";
    const bdrs = {
      ok: true,
      filings: [
        {
          rcept_no: "20260601000020",
          cdrt_int: "AA-(안정적)\n(한국기업평가(주) / NICE신용평가(주))",
          pymd: "2026-06-12",
          grt_amt: null,
        },
        { rcept_no: "20260401000021", cdrt_int: null, pymd: null, grt_amt: null },
        { rcept_no: "20260301000022", cdrt_int: "Aa2(Moody's)", pymd: "2026-03-10", grt_amt: null },
        { rcept_no: "20260201000023", cdrt_int: "알 수 없는 형식", pymd: null, grt_amt: null },
      ],
    };
    const { d } = deps({ bdrs });
    const r = await collectCreditRating(db, corp, NOW, d);
    expect(r).toMatchObject({ report_status: "not_found", bdrs_filings: 4, bdrs_snapshots_written: 4 });
    const rows = snaps(corp);
    expect(rows.map((s) => [s.source_rcept_no, s.source_kind, s.status])).toEqual([
      ["20260201000023", "debt_securities_filing", "parse_failed"],
      ["20260301000022", "debt_securities_filing", "section_present_no_bond_rating"],
      ["20260401000021", "debt_securities_filing", "not_disclosed"],
      ["20260601000020", "debt_securities_filing", "parsed"],
    ]);
    expect(rows.every((s) => s.issues_json === null)).toBe(true);
    const again = await collectCreditRating(db, corp, NOW, deps({ bdrs }).d);
    expect(again.bdrs_snapshots_written).toBe(0);
    expect(snaps(corp)).toHaveLength(4);
  });

  test("the lookup window is the registry stale_months (18) back from today, YYYYMMDD", async () => {
    let seen = null as { bgn: string; end: string } | null;
    const { d } = deps({});
    d.fetchDebtSecuritiesFilings = (async (_c: string, bgn: string, end: string) => {
      seen = { bgn, end };
      return { ok: true, filings: [] };
    }) as never;
    await collectCreditRating(db, "00100021", NOW, d);
    expect(seen).toEqual({ bgn: "20250526", end: "20261126" });
  });

  test("a failed bdRs lookup is a warning when the report step worked", async () => {
    const corp = "00100022";
    insertDisclosures(db, [listRow(corp, "20260310000022", "사업보고서 (2025.12)", "20260310")], NOW.toISOString());
    const { d } = deps({
      texts: { "20260310000022": { available: true, text: REPORT_TEXT } },
      bdrs: { ok: false, filings: [], error: "DART bdRs status 800" },
    });
    const r = await collectCreditRating(db, corp, NOW, d);
    expect(r.report_status).toBe("parsed");
    expect(r.warnings.some((w) => w.startsWith("debt securities lookup failed"))).toBe(true);
  });
});
