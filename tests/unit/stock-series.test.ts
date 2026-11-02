// @version 1.0.0
/**
 * stock_series (migration 0187, owner decision 2026-11-02 option 1): per-deal KRX stock closes become
 * first-class nightly-collection targets. Covers the migration (shape, unique index, CHECK, the
 * raw_payload-sourced backfill), the repository upsert semantics (one row per company, re-enable on
 * re-registration, disabled rows hidden), the adapter's merged resolution (seeds < stock_series table <
 * in-process registry), the end-to-end collect path (fetchSource collects a table-backed stock series and
 * skips a disabled row — the real krx adapter over a mocked KRX payload, no network), and the beta flow's
 * persistence write (beta-series.ts main() upserts stock_series, registered_by 'beta-series').
 *
 * Everything runs against a scratch SQLite under the OS temp dir (never the dev 7748 or prod 7749 DB).
 * KRX HTTP is a recorded mock — NO live network (same rule as collect-handlers.test.ts).
 */
import { test, expect, describe, afterAll, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "stock-series-"));
const TEST_DB_PATH = join(TMP, "stock-series.sqlite");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations, splitSqlStatements } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const {
  loadStockSeriesDescriptors,
  listKrxDailyRows,
  krxStockSeries,
  registerKrxSeries,
  resetKrxRunState,
  SOURCE_ADAPTERS,
} = await import("../../scripts/co-newbiz/source-adapters.ts");
const { upsertStockSeries, getStockSeries, listEnabledStockSeries } = await import(
  "../../db/repositories/stock-series.repository.ts"
);
const { fetchSource } = await import("../../scripts/co-newbiz/jobs/collect/fetch-source.ts");
const { betaSeriesMain } = await import("../../scripts/co-newbiz/beta-series.ts");

afterAll(() => {
  resetDb();
  rmSync(TMP, { recursive: true, force: true });
});

const MIGRATION_FILE = join(import.meta.dirname, "..", "..", "db", "migrations", "0187_stock_series.sql");

// ── KRX HTTP mock (recorded payloads — NO live network) ─────────────────────

const realFetch = globalThis.fetch;
const FAKE_KEY = ["fixture", "krx", "key"].join("-"); // dummy fixture, not a credential
// Oct 2026: 1 Thu, 2 Fri, 3 Sat, 4 Sun, 5 Mon … "today" pinned to 2026-10-06.
const TODAY = new Date(2026, 9, 6);

const indexRows = (basDd: string, family: "코스피" | "코스닥", close: string) => [
  { BAS_DD: basDd, IDX_NM: family, CLSPRC_IDX: close },
];
const stockRow = (basDd: string, code: string, close: string) => ({
  BAS_DD: basDd,
  ISU_CD: code,
  ISU_NM: "n",
  TDD_CLSPRC: close,
});

type Handler = (service: string, basDd: string) => unknown | Promise<unknown>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function mockKrxFetch(handler: Handler): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const service = url.pathname.replace("/svc/apis/", "").replace(".json", "");
    return json({ OutBlock_1: await handler(service, url.searchParams.get("basDd") ?? "") });
  }) as typeof fetch;
}

/** One master payload: KOSPI without 로보티즈 (forces the kosdaq fallback), KOSDAQ with it. */
const masterRows = (market: "kospi" | "kosdaq") =>
  market === "kospi"
    ? [
        {
          ISU_CD: "KR7000001001",
          ISU_SRT_CD: "000001",
          ISU_NM: "레인보우테크",
          ISU_ABBRV: "레인보우테크",
          MKT_TP_NM: "KOSPI",
        },
      ]
    : [
        {
          ISU_CD: "KR7108490004",
          ISU_SRT_CD: "108490",
          ISU_NM: "로보티즈",
          ISU_ABBRV: "로보티즈",
          MKT_TP_NM: "KOSDAQ",
        },
        {
          ISU_CD: "KR7277810008",
          ISU_SRT_CD: "277810",
          ISU_NM: "레인보우로보틱스",
          ISU_ABBRV: "레인보우로보틱스",
          MKT_TP_NM: "KOSDAQ",
        },
      ];

/** Daily payload: both fixed tickers of the fixtures, every service family. */
const dailyHandler: Handler = (service, basDd) => {
  if (service === "idx/kospi_dd_trd") return indexRows(basDd, "코스피", "6625.93");
  if (service === "idx/kosdaq_dd_trd") return indexRows(basDd, "코스닥", "892.27");
  if (service === "sto/stk_bydd_trd") return [stockRow(basDd, "999999", "1000")];
  return [stockRow(basDd, "108490", "297500"), stockRow(basDd, "277810", "429000")];
};

const setKey = (): void => {
  process.env.KRX_API_KEY = FAKE_KEY;
};
const unsetKey = (saved: string | undefined): void => {
  if (saved === undefined) delete process.env.KRX_API_KEY;
  else process.env.KRX_API_KEY = saved;
};

// ── migration 0187: header, shape, constraints ──────────────────────────────

describe("migration 0187: header and table shape", () => {
  test("carries the reversible metadata header (ADR-0014) and a DROP TABLE rollback block", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf-8");
    expect(sql).toContain("@reversible: true");
    expect(sql).toContain("ROLLBACK-SQL-BEGIN");
    expect(sql).toContain("DROP TABLE stock_series;");
    expect(sql).toContain("ROLLBACK-SQL-END");
  });

  test("stock_series has the owner-decision columns (company_id unique-by-index, market CHECK, soft disable)", () => {
    const cols = db.query("PRAGMA table_info(stock_series)").all() as Array<{
      name: string;
      notnull: number;
      pk: number;
    }>;
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
    for (const name of ["id", "company_id", "ticker", "market", "display_name", "registered_by", "registered_at"]) {
      expect(byName[name]).toBeTruthy();
      expect(byName[name].notnull).toBe(1);
    }
    expect(byName.id.pk).toBe(1);
    expect(byName.disabled_at.notnull).toBe(0); // the soft-disable lever is nullable
    const idx = db
      .query("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'stock_series'")
      .all() as Array<{ sql: string }>;
    expect(
      idx.some((i) => i.sql?.includes("CREATE UNIQUE INDEX idx_stock_series_company ON stock_series(company_id)")),
    ).toBe(true);
  });

  test("CHECK constrains market to kospi/kosdaq and the unique index blocks a second row per company", () => {
    const ins = (id: string, company: string, market: string) =>
      db.run(
        "INSERT INTO stock_series (id, company_id, ticker, market, display_name, registered_by, registered_at) VALUES (?,?,?,?,?,?,?)",
        [id, company, "123456", market, "n", "t", "2026-11-02T00:00:00.000Z"],
      );
    ins("chk-1", "chk-company", "kospi");
    ins("chk-2", "chk-company2", "kosdaq");
    expect(() => ins("chk-3", "chk-company3", "konex")).toThrow(); // KONEX is out of scope for beta
    expect(() => ins("chk-4", "chk-company", "kosdaq")).toThrow(); // one series per company
  });
});

// ── migration 0187: the backfill ────────────────────────────────────────────

describe("migration 0187: backfill from raw_payload stock-master for flowing series", () => {
  test("backfills companies with collected observations, skips master-only and KONEX rows", () => {
    // Pre-state mirroring the live DB (verified 2026-11-02): stock-master records exist in raw_payload,
    // and the backfill must key on fact_market_observation data actually flowing.
    const srcId = (db.query("SELECT id FROM md_source WHERE code = 'krx'").get() as { id: string }).id;
    db.run(
      "INSERT INTO md_unit (id, code, dimension, si_coefficient, created_at) VALUES ('sser-u','krw','currency',1,'2026-11-01')",
    );
    db.run(
      "INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES ('sser-p','date','2026-10-01','2026-10-01',2026,'2026-11-01')",
    );
    const company = (id: string, name: string) =>
      db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [id, name, "2026-10-01"]);
    const master = (id: string, ticker: string, market: string) =>
      db.run("INSERT INTO raw_payload (id, source_id, fetched_at, content_hash, payload) VALUES (?,?,?,?,?)", [
        `krx:stock-master:${id}`,
        srcId,
        "2026-10-12",
        "h",
        JSON.stringify({
          kind: "krx_stock_master",
          company_id: id,
          short_code: ticker,
          market,
          name_ko: "n",
          resolved_at: "2026-10-12",
        }),
      ]);
    const flowing = (companyId: string) =>
      db.run(
        "INSERT INTO fact_market_observation (series_id, period_id, revision_no, value, unit_id, source_id, content_hash, fetched_at) VALUES (?,?,?,?,?,?,?,?)",
        [`krx:stock:${companyId}:close`, "sser-p", 1, 1, "sser-u", srcId, "h", "2026-10-12"],
      );
    company("bf-kosdaq", "흐르는코스닥");
    company("bf-kospi", "흐르는코스피");
    company("bf-noflow", "마스터만있음");
    company("bf-konex", "흐르는코넥스");
    master("bf-kosdaq", "108490", "KOSDAQ");
    master("bf-kospi", "005930", "KOSPI");
    master("bf-noflow", "000001", "KOSDAQ");
    master("bf-konex", "999999", "KONEX");
    flowing("bf-kosdaq");
    flowing("bf-kospi");
    flowing("bf-konex");

    // Re-execute ONLY the migration's backfill INSERT against this pre-state
    // (the migration itself already ran on the empty scratch DB at setup).
    const statements = splitSqlStatements(readFileSync(MIGRATION_FILE, "utf-8"));
    const backfill = statements.filter((s) => s.includes("INSERT INTO stock_series"));
    expect(backfill).toHaveLength(1);
    db.run(backfill[0]);

    // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite row objects (same convention as the other migration tests)
    const rows = db.query("SELECT * FROM stock_series WHERE company_id LIKE 'bf-%' ORDER BY company_id").all() as any[];
    expect(rows).toHaveLength(2);
    const kosdaq = rows.find((r) => r.company_id === "bf-kosdaq");
    expect(kosdaq.ticker).toBe("108490");
    expect(kosdaq.market).toBe("kosdaq"); // lower-cased from the record's KOSDAQ
    expect(kosdaq.display_name).toBe("흐르는코스닥");
    expect(kosdaq.registered_by).toBe("migration-0187");
    expect(kosdaq.disabled_at).toBeNull();
    const kospi = rows.find((r) => r.company_id === "bf-kospi");
    expect(kospi.ticker).toBe("005930");
    expect(kospi.market).toBe("kospi");
    // stock-master record WITHOUT collected observations is not registered…
    expect(rows.find((r) => r.company_id === "bf-noflow")).toBeUndefined();
    // …and a flowing KONEX series would violate the CHECK — excluded by the WHERE.
    expect(rows.find((r) => r.company_id === "bf-konex")).toBeUndefined();
  });
});

// ── repository: upsert by company_id, soft disable, re-enable ───────────────

describe("stock_series repository", () => {
  afterEach(() => {
    db.run("DELETE FROM stock_series WHERE company_id LIKE 'repo-%'");
  });

  test("upsert is one-row-per-company: insert, identical no-op, update keeps the row id", () => {
    const input = {
      company_id: "repo-c1",
      ticker: "108490",
      market: "kosdaq" as const,
      display_name: "로보티즈",
      registered_by: "beta-series",
    };
    expect(upsertStockSeries(db, input)).toBe(true);
    const first = getStockSeries(db, "repo-c1");
    expect(first?.market).toBe("kosdaq");
    expect(upsertStockSeries(db, input)).toBe(false); // identical enabled row: no write
    expect(listEnabledStockSeries(db).filter((r) => r.company_id.startsWith("repo-"))).toHaveLength(1);
    expect(upsertStockSeries(db, { ...input, ticker: "999999", display_name: "로보티즈(개명)" })).toBe(true);
    const second = getStockSeries(db, "repo-c1");
    expect(second?.id).toBe(first?.id); // the row id is stable across updates
    expect(second?.ticker).toBe("999999");
    expect(db.query("SELECT COUNT(*) c FROM stock_series WHERE company_id = 'repo-c1'").get()).toMatchObject({ c: 1 });
  });

  test("a disabled row is skipped by collection but re-registration re-enables it", () => {
    const input = {
      company_id: "repo-c2",
      ticker: "277810",
      market: "kosdaq" as const,
      display_name: "레인보우로보틱스",
      registered_by: "beta-series",
    };
    upsertStockSeries(db, input);
    db.run("UPDATE stock_series SET disabled_at = '2026-11-02T00:00:00.000Z' WHERE company_id = 'repo-c2'");
    expect(getStockSeries(db, "repo-c2")?.disabled_at).toBe("2026-11-02T00:00:00.000Z"); // history kept, row kept
    expect(listEnabledStockSeries(db).find((r) => r.company_id === "repo-c2")).toBeUndefined(); // collection skips it
    expect(loadStockSeriesDescriptors(db).find((s) => s.seriesId === "krx:stock:repo-c2:close")).toBeUndefined();
    expect(upsertStockSeries(db, input)).toBe(true); // explicit re-registration is an affirmative act
    expect(getStockSeries(db, "repo-c2")?.disabled_at).toBeNull();
  });
});

// ── end-to-end: the nightly collect path sees table-backed series ───────────

describe("collect.krx end-to-end over stock_series (real krx adapter, mocked KRX HTTP)", () => {
  test("fetchSource collects an enabled stock_series row alongside the two index closes and skips a disabled row", async () => {
    db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES ('e2e-on','수집되는회사','2026-10-01')");
    db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES ('e2e-off','비활성회사','2026-10-01')");
    db.run(
      "INSERT INTO stock_series (id, company_id, ticker, market, display_name, registered_by, registered_at) VALUES ('e2e-on','e2e-on','108490','kosdaq','수집되는회사','beta-series','2026-11-02')",
    );
    // Disabled rows are skipped by collection but keep their registration row.
    db.run(
      "INSERT INTO stock_series (id, company_id, ticker, market, display_name, registered_by, registered_at, disabled_at) VALUES ('e2e-off','e2e-off','277810','kosdaq','비활성회사','beta-series','2026-11-02','2026-11-02')",
    );

    resetKrxRunState({ retryDelayMs: 1, minIntervalMs: 0 });
    mockKrxFetch(dailyHandler);
    const saved = process.env.KRX_API_KEY;
    setKey();
    try {
      const r = await fetchSource(db, "krx", { fromArg: "2026-10", toArg: "2026-10" });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.kind).toBe("observations");
      expect(r.rowsUpserted).toBeGreaterThan(0);
    } finally {
      unsetKey(saved);
      globalThis.fetch = realFetch;
    }

    const obsOf = (seriesId: string) =>
      (
        db
          .query(
            "SELECT COUNT(*) c FROM fact_market_observation o JOIN md_period p ON p.id = o.period_id WHERE o.series_id = ? AND p.start_date LIKE '2026-10-%'",
          )
          .get(seriesId) as { c: number }
      ).c;
    // The two static index closes still flow…
    expect(obsOf("krx:index:KOSPI:close")).toBeGreaterThan(0);
    expect(obsOf("krx:index:KOSDAQ:close")).toBeGreaterThan(0);
    // …the enabled table-backed stock series was collected WITHOUT any in-process registration…
    expect(obsOf("krx:stock:e2e-on:close")).toBeGreaterThan(0);
    // …and the disabled row was skipped (no observations written for it).
    expect(obsOf("krx:stock:e2e-off:close")).toBe(0);
  });
});

// ── adapter resolution: table + in-process merge ────────────────────────────

describe("krx series resolution merges stock_series table and the in-process registry", () => {
  test("registry wins over table; table resolves without the registry; unknown still fails closed", async () => {
    db.run(
      "INSERT INTO stock_series (id, company_id, ticker, market, display_name, registered_by, registered_at) VALUES ('res-a','res-a','108490','kosdaq','테이블등록','beta-series','2026-11-02')",
    );
    const saved = process.env.KRX_API_KEY;
    setKey();
    try {
      // Without a db handle (pre-0187 callers) a table-only series is unknown…
      await expect(listKrxDailyRows("krx:stock:res-a:close", "2026-10", TODAY)).rejects.toThrow(/unknown series/);
      // …and without the table it stays unknown (fail-closed honesty rules).
      await expect(listKrxDailyRows("krx:stock:never-registered:close", "2026-10", TODAY, db)).rejects.toThrow(
        /unknown series/,
      );

      // With the handle, the table row resolves and collects through the mocked payload.
      resetKrxRunState({ retryDelayMs: 1, minIntervalMs: 0 });
      const calls: string[] = [];
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = new URL(String(input));
        calls.push(url.pathname);
        return json({
          OutBlock_1: dailyHandler(
            url.pathname.replace("/svc/apis/", "").replace(".json", ""),
            url.searchParams.get("basDd") ?? "",
          ),
        });
      }) as typeof fetch;
      const rows = await listKrxDailyRows("krx:stock:res-a:close", "2026-10", TODAY, db);
      expect(rows.every((r) => r.value === 297500)).toBe(true); // ticker 108490 from the TABLE
      expect(calls.every((c) => c.includes("sto/ksq_bydd_trd"))).toBe(true); // market kosdaq from the TABLE

      // The in-process registry WINS on conflict: same seriesId, freshest descriptor (kospi / 999999).
      registerKrxSeries(krxStockSeries("res-a", "999999", "인프로세스등록", "kospi"));
      resetKrxRunState({ retryDelayMs: 1, minIntervalMs: 0 });
      calls.length = 0;
      const rows2 = await listKrxDailyRows("krx:stock:res-a:close", "2026-10", TODAY, db);
      expect(rows2.every((r) => r.value === 1000)).toBe(true); // ticker 999999 from the REGISTRY
      expect(calls.every((c) => c.includes("sto/stk_bydd_trd"))).toBe(true); // market kospi from the REGISTRY

      // listSeries enumerates seeds + table rows (+ registry), what the nightly job iterates.
      const listed = await SOURCE_ADAPTERS.krx.listSeries({ db });
      expect(listed.some((s) => s.seriesId === "krx:index:KOSPI:close")).toBe(true);
      expect(listed.some((s) => s.seriesId === "krx:stock:res-a:close")).toBe(true);
      expect(listed.find((s) => s.seriesId === "krx:stock:res-a:close")?.ticker).toBe("999999"); // registry wins
    } finally {
      unsetKey(saved);
      globalThis.fetch = realFetch;
    }
  });
});

// ── beta flow: registration persists to stock_series ────────────────────────

describe("beta-series flow persists its registration to stock_series", () => {
  test("a beta run upserts the company (registered_by 'beta-series') and the series collects", async () => {
    // The company first — md_project.company_id is a live FK.
    // Company id = the REAL cache key of 로보티즈 in the tracked
    // db/data/krx-stock-code-cache.json — the flow takes the cache-hit path,
    // so the test never resolves through the master NOR writes the shared
    // cache file (cacheDirty stays false). The mocked master handlers below
    // stay as a safety net should the cache fixture ever change shape.
    const companyId = "01M1MP84WFEHPHT3N57VCMCQFW";
    // The company first — md_project.company_id is a live FK.
    db.run(`INSERT INTO md_company (id, name_ko, created_at) VALUES ('${companyId}','로보티즈','2026-10-01')`);
    db.run(
      `INSERT INTO md_project (id, project_no, created_at, current_stage_gate, origin, track, status, company_id) VALUES ('bf-proj','BF-PROJ','2026-10-01','fs','internal','brownfield','open','${companyId}')`,
    );

    resetKrxRunState({ retryDelayMs: 1, minIntervalMs: 0 });
    // Master resolution: KOSPI master lacks 로보티즈 → falls through to the KOSDAQ master (108490).
    mockKrxFetch((service, basDd) => {
      if (service === "sto/stk_isu_base_info") return masterRows("kospi");
      if (service === "sto/ksq_isu_base_info") return masterRows("kosdaq");
      return dailyHandler(service, basDd);
    });
    const savedKey = process.env.KRX_API_KEY;
    setKey();
    try {
      // argv and pacing passed directly (main re-applies production pacing on
      // its internal resetKrxRunState, so the test seam is the parameter).
      await betaSeriesMain(["bun", "beta-series.ts", "--project", "bf-proj", "--from", "2026-10", "--to", "2026-10"], {
        minIntervalMs: 0,
        retryDelayMs: 1,
      });
    } finally {
      unsetKey(savedKey);
      globalThis.fetch = realFetch;
    }

    const row = getStockSeries(db, companyId);
    expect(row).toBeTruthy();
    expect(row?.ticker).toBe("108490"); // from the stock-code cache
    expect(row?.market).toBe("kosdaq");
    expect(row?.display_name).toBe("로보티즈");
    expect(row?.registered_by).toBe("beta-series");
    expect(row?.disabled_at).toBeNull();
    // And the run's own collection wrote the company's daily closes.
    const obs = db
      .query(`SELECT COUNT(*) c FROM fact_market_observation WHERE series_id = 'krx:stock:${companyId}:close'`)
      .get() as { c: number };
    expect(obs.c).toBeGreaterThan(0);
  });
});
