// @version 1.0.0
/**
 * dart-evidence-cache.repository — freshness rules and cache write discipline of ADR-0199 decision 8 / spec
 * 2026-11-16-s6-bulk-ai-eval-versioning §6.2/§7 (test plan T18/T19/T20/T22/T24/T25 data parts). Pure functions are
 * exercised directly; the store runs on a scratch SQLite. No DART network call is made.
 */
import { test, expect, describe } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "dart-cache-repo-"));
const DB_PATH = join(TMP, "cache.sqlite");
process.env.CO_NEWBIZ_DB_PATH = DB_PATH;

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(DB_PATH);
const db = getDb(DB_PATH);

const c = await import("../../db/repositories/dart-evidence-cache.repository.ts");

/** An instant at 10:00 KST on the given calendar date. */
const kst = (date: string) => `${date}T01:00:00.000Z`;
const daysBefore = (date: string, days: number) => new Date(Date.parse(kst(date)) - days * 86_400_000).toISOString();

const row = (rcept: string, report = "분기보고서 (2025.09)", dt = rcept.slice(0, 8), corp = "00123456") => ({
  rcept_no: rcept,
  corp_code: corp,
  corp_name: "회사",
  report_nm: report,
  rcept_dt: dt,
});

describe("freshness window (T22)", () => {
  test("constants match the resolved Q8 decision", () => {
    expect(c.DART_FRESHNESS_DAYS).toBe(30);
    expect(c.DART_FRESHNESS_DAYS_FILING_SEASON).toBe(7);
  });

  test("outside the season: 29 days fresh, 30 and 31 stale", () => {
    const now = kst("2026-10-15");
    expect(c.isCheckFresh(daysBefore("2026-10-15", 29), now, false)).toBe(true);
    expect(c.isCheckFresh(daysBefore("2026-10-15", 30), now, false)).toBe(false);
    expect(c.isCheckFresh(daysBefore("2026-10-15", 31), now, false)).toBe(false);
  });

  test("in season: 6 days fresh, 7 and 8 stale", () => {
    const now = kst("2026-04-15");
    expect(c.isCheckFresh(daysBefore("2026-04-15", 6), now, false)).toBe(true);
    expect(c.isCheckFresh(daysBefore("2026-04-15", 7), now, false)).toBe(false);
    expect(c.isCheckFresh(daysBefore("2026-04-15", 8), now, false)).toBe(false);
  });

  test("season edges are chosen by the KST evaluation date", () => {
    // Checked Feb 25, evaluated Mar 4 → the 7-day rule applies → stale.
    expect(c.isCheckFresh(kst("2026-02-25"), kst("2026-03-04"), false)).toBe(false);
    // The same check evaluated Feb 28 (30-day rule) is fresh.
    expect(c.isCheckFresh(kst("2026-02-25"), kst("2026-02-28"), false)).toBe(true);
    // May 31 is still in season; Jun 1 is not.
    expect(c.freshnessWindowDays(kst("2026-05-31"))).toBe(7);
    expect(c.freshnessWindowDays(kst("2026-06-01"))).toBe(30);
    expect(c.isCheckFresh(kst("2026-05-20"), kst("2026-05-31"), false)).toBe(false);
    expect(c.isCheckFresh(kst("2026-05-20"), kst("2026-06-01"), false)).toBe(true);
    // KST, not UTC: 2026-02-28T16:00Z is already Mar 1 in Seoul.
    expect(c.isFilingSeason("2026-02-28T16:00:00.000Z")).toBe(true);
    expect(c.isFilingSeason("2026-02-28T14:00:00.000Z")).toBe(false);
  });

  test("force_refresh and a missing check always fetch; each kind is planned independently", () => {
    const now = kst("2026-10-15");
    expect(c.isCheckFresh(daysBefore("2026-10-15", 1), now, true)).toBe(false);
    expect(c.isCheckFresh(null, now, false)).toBe(false);
    const plan = c.planDartFetch(
      {
        corp_code: "00123456",
        corp_code_checked_at: daysBefore("2026-10-15", 2),
        financial_checked_at: daysBefore("2026-10-15", 40),
        disclosures_checked_at: null,
        disclosures_complete_through: null,
        updated_at: now,
      },
      now,
      false,
    );
    expect(plan).toEqual({ corp_code: false, financial: true, disclosures: true });
    expect(c.planDartFetch(null, now, true)).toEqual({ corp_code: true, financial: true, disclosures: true });
  });
});

describe("disclosure list (T18/T19)", () => {
  test("query window: first fetch 36 months back (KST), later fetches cursor − 1 day", () => {
    expect(c.disclosureQueryStart(null, kst("2026-11-16"))).toBe("20231116");
    expect(c.disclosureQueryStart(null, kst("2028-02-29"))).toBe("20250228"); // clamps to month end
    expect(c.disclosureQueryEnd("2026-11-16T15:30:00.000Z")).toBe("20261117"); // already the 17th in Seoul
    const state = {
      corp_code: "00123456",
      corp_code_checked_at: null,
      financial_checked_at: null,
      disclosures_checked_at: kst("2026-03-01"),
      disclosures_complete_through: "20260301",
      updated_at: "",
    };
    expect(c.disclosureQueryStart(state, kst("2026-11-16"))).toBe("20260228");
  });

  test("insert ignores an existing rcept_no (overlap / re-list), never updates it, and still enforces CHECKs", () => {
    const now = kst("2026-11-16");
    expect(c.insertDisclosures(db, [row("20250314000001", "사업보고서 (2024.12)"), row("20251114000002")], now)).toBe(
      2,
    );
    expect(
      c.insertDisclosures(
        db,
        [{ ...row("20251114000002"), report_nm: "다른 이름" }, row("20251115000003")],
        kst("2026-11-17"),
      ),
    ).toBe(1);
    const cached = c.listCachedDisclosures(db, "00123456", "20231116");
    expect(cached.map((r) => r.rcept_no)).toEqual(["20251115000003", "20251114000002", "20250314000001"]);
    expect(cached[1].report_nm).toBe("분기보고서 (2025.09)");
    expect(cached[1].fetched_at).toBe(now);
    expect(() => c.insertDisclosures(db, [row("123")], now)).toThrow();
    expect(() => db.run("UPDATE dart_disclosure SET report_nm = 'x' WHERE rcept_no = '20250314000001'")).toThrow(
      /immutable/,
    );
  });

  test("a failure on page 2 keeps page-1 rows and does not advance the cursor (T18 / T24)", () => {
    const corp = "00222222";
    const t0 = kst("2026-11-16");
    // Page 1 succeeded, page 2 threw: the caller inserted page 1 and never called markDisclosuresComplete.
    c.insertDisclosures(db, [row("20251001000010", "분기보고서 (2025.06)", "20251001", corp)], t0);
    expect(c.getCorpSyncState(db, corp)).toBeNull();
    expect(c.disclosureQueryStart(c.getCorpSyncState(db, corp), t0)).toBe("20231116"); // retry from the old cursor
    expect(c.listCachedDisclosures(db, corp, "20231116")).toHaveLength(1);
    // The retry finishes all pages → cursor and checked_at advance together.
    c.markDisclosuresComplete(db, corp, c.disclosureQueryEnd(t0), t0);
    expect(c.getCorpSyncState(db, corp)).toMatchObject({
      disclosures_checked_at: t0,
      disclosures_complete_through: "20261116",
    });
    expect(() => c.markDisclosuresComplete(db, corp, "2026-11-16", t0)).toThrow(/YYYYMMDD/);
  });

  test("T20 data part: corrected business reports seen after the financial check form the closed-year set", () => {
    const corp = "00333333";
    c.insertDisclosures(db, [row("20240320000020", "사업보고서 (2023.12)", "20240320", corp)], kst("2026-01-10"));
    c.insertDisclosures(
      db,
      [row("20250601000021", "[기재정정]사업보고서 (2023.12)", "20250601", corp)],
      kst("2026-01-10"),
    );
    c.insertDisclosures(
      db,
      [row("20260105000022", "[기재정정]사업보고서 (2024.12)", "20260105", corp)],
      kst("2026-02-10"),
    );
    c.insertDisclosures(
      db,
      [row("20260106000023", "[기재정정]분기보고서 (2025.09)", "20260106", corp)],
      kst("2026-02-10"),
    );
    expect(c.correctedBusinessReportYears(db, corp, null)).toEqual([2023, 2024]);
    expect(c.correctedBusinessReportYears(db, corp, kst("2026-02-01"))).toEqual([2024]);
    expect(c.businessReportFiscalYear("사업보고서 (2024.12)")).toBe(2024);
    expect(c.businessReportFiscalYear("반기보고서 (2024.06)")).toBeNull();
  });
});

describe("sync state never advances on failure (T24)", () => {
  test("corp code: null (DART unreachable) keeps the old timestamp; true/false advance it", () => {
    const corp = "00444444";
    expect(c.markCorpCodeChecked(db, corp, null, kst("2026-11-01"))).toBe(false);
    expect(c.getCorpSyncState(db, corp)).toBeNull();
    expect(c.markCorpCodeChecked(db, corp, false, kst("2026-11-02"))).toBe(true);
    expect(c.markCorpCodeChecked(db, corp, null, kst("2026-11-03"))).toBe(false);
    expect(c.getCorpSyncState(db, corp)?.corp_code_checked_at).toBe(kst("2026-11-02"));
  });

  test("financial: one error year keeps financial_checked_at; found/not_filed advance it; other kinds untouched", () => {
    const corp = "00555555";
    c.markCorpCodeChecked(db, corp, true, kst("2026-11-01"));
    expect(
      c.markFinancialChecked(
        db,
        corp,
        [
          { year: 2025, outcome: "found" },
          { year: 2024, outcome: "error" },
        ],
        kst("2026-11-02"),
      ),
    ).toBe(false);
    expect(c.getCorpSyncState(db, corp)?.financial_checked_at).toBeNull();
    expect(c.markFinancialChecked(db, corp, [], kst("2026-11-02"))).toBe(false);
    expect(
      c.markFinancialChecked(
        db,
        corp,
        [
          { year: 2025, outcome: "not_filed" },
          { year: 2024, outcome: "found" },
        ],
        kst("2026-11-03"),
      ),
    ).toBe(true);
    expect(c.getCorpSyncState(db, corp)).toMatchObject({
      corp_code_checked_at: kst("2026-11-01"),
      financial_checked_at: kst("2026-11-03"),
    });
  });
});

describe("business-report extracts (T19/T24)", () => {
  const rcept = "20250314000001"; // cached above as 사업보고서 (2024.12)
  const section = (text: string) => ({ heading_raw: "연구개발활동", text, chars: text.length, truncated: false });

  test("an existing extract means no fetch, regardless of force_refresh; an extractor bump needs exactly one", () => {
    expect(c.needsBusinessReportFetch(db, rcept, "x1")).toBe(true);
    const r = c.insertBusinessReportExtract(db, {
      rceptNo: rcept,
      extractorVersion: "x1",
      status: "extracted",
      sections: { rnd: section("연구개발비 120억") },
      sourceChars: 50_000,
      now: kst("2026-11-16"),
    });
    expect(r.status).toBe("extracted");
    expect(r.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(c.needsBusinessReportFetch(db, rcept, "x1")).toBe(false);
    expect(c.needsBusinessReportFetch(db, rcept, "x2")).toBe(true);
    // Idempotent: a second insert for the same key keeps the first row.
    const again = c.insertBusinessReportExtract(db, {
      rceptNo: rcept,
      extractorVersion: "x1",
      status: "no_sections",
      sourceChars: 1,
      now: kst("2026-11-17"),
    });
    expect(again.status).toBe("extracted");
  });

  test("deterministic negatives are cached; transient failures and oversize sections have no write path", () => {
    c.insertDisclosures(db, [row("20250315000009", "사업보고서 (2024.12)", "20250315", "00666666")], kst("2026-11-16"));
    const neg = c.insertBusinessReportExtract(db, {
      rceptNo: "20250315000009",
      extractorVersion: "x1",
      status: "not_zip",
      sourceChars: 0,
      now: kst("2026-11-16"),
    });
    expect(neg).toMatchObject({ status: "not_zip", sections_json: null, content_hash: null });
    expect(c.needsBusinessReportFetch(db, "20250315000009", "x1")).toBe(false);
    expect(() =>
      c.insertBusinessReportExtract(db, {
        rceptNo: "20250315000009",
        extractorVersion: "x9",
        status: "http_error" as never,
        sourceChars: 0,
        now: kst("2026-11-16"),
      }),
    ).toThrow(/never cached/);
    expect(() =>
      c.insertBusinessReportExtract(db, {
        rceptNo: "20250315000009",
        extractorVersion: "x9",
        status: "extracted",
        sections: { rnd: section("가".repeat(c.BUSINESS_REPORT_SECTION_MAX_CHARS + 1)) },
        sourceChars: 1,
        now: kst("2026-11-16"),
      }),
    ).toThrow(/exceeds/);
    expect(() =>
      c.insertBusinessReportExtract(db, {
        rceptNo: "20250315000009",
        extractorVersion: "x9",
        status: "extracted",
        sections: {},
        sourceChars: 1,
        now: kst("2026-11-16"),
      }),
    ).toThrow(/no_sections/);
    expect(c.getBusinessReportExtract(db, "20250315000009", "x9")).toBeNull();
  });
});

describe("cache isolation (T25 data part)", () => {
  test("deleting a candidate leaves cache rows intact", () => {
    const now = kst("2026-11-16");
    db.run(
      "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES ('oppC', 'o', 's', 'identified', 'u', ?)",
      [now],
    );
    db.run(
      "INSERT INTO brownfield_target (id, opportunity_id, company_name, dart_corp_code, created_at, updated_at) VALUES ('tC', 'oppC', '회사', '00123456', ?, ?)",
      [now, now],
    );
    const before = (
      db.query("SELECT COUNT(*) AS n FROM dart_disclosure WHERE corp_code = '00123456'").get() as { n: number }
    ).n;
    db.run("DELETE FROM brownfield_target WHERE id = 'tC'");
    expect(
      (db.query("SELECT COUNT(*) AS n FROM dart_disclosure WHERE corp_code = '00123456'").get() as { n: number }).n,
    ).toBe(before);
  });
});

process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));
