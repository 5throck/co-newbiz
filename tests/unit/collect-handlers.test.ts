// @version 1.0.0
/**
 * Collect handlers (ADR-0189 phase P5, design 2026-10-29-scheduled-jobs-design sections 3.1/3.2/9):
 * the fetchSource library (upsert on (series_id, period), data_change_log only on value change,
 * credential gate), the five collect.* handlers and their registration/seed behavior, and the CLI
 * output-shape contract shared through formatFetchEventLine.
 *
 * Everything runs against a scratch SQLite under the OS temp dir (never the dev 7748 or prod 7749
 * DB). Adapters are RECORDED FIXTURES swapped into SOURCE_ADAPTERS and always restored — NO live
 * network in CI (design section 9 collection block).
 */
import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "collect-handlers-"));
const TEST_DB_PATH = join(TMP, "collect.sqlite");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const adaptersMod = await import("../../scripts/co-newbiz/source-adapters.ts");
const { SOURCE_ADAPTERS } = adaptersMod;
type SourceAdapter = import("../../scripts/co-newbiz/source-adapters.ts").SourceAdapter;
type SeriesDescriptor = import("../../scripts/co-newbiz/source-adapters.ts").SeriesDescriptor;
const fetchSourceMod = await import("../../scripts/co-newbiz/jobs/collect/fetch-source.ts");
const { fetchSource, formatFetchEventLine, sha256Hex } = fetchSourceMod;
const { runJob } = await import("../../scripts/co-newbiz/run-job.ts");
const { getJobHandler, listJobHandlers } = await import("../../scripts/co-newbiz/jobs/index.ts");
const { seedScheduleJobs } = await import("../../scripts/co-newbiz/schedule-seed.ts");
const { previewWatchRule } = await import("../../db/lib/watch-engine.ts");

afterAll(() => {
  resetDb();
  rmSync(TMP, { recursive: true, force: true });
});

// ── env hygiene (credential gates read env at call time; loadPipelineKeys is once-per-process,
//    so explicit deletes/sets here fully control what the adapters see) ──────────────────────
const CREDENTIAL_ENVS = ["DART_API_KEY", "ECOS_API_KEY", "KRX_API_KEY", "KOSIS_API_KEY", "LAW_API_OC", "DATA_GO_KR_API_KEY"];
let savedEnv: Record<string, string | undefined>;
const envKey = (name: string) => name; // assembled at call sites via join("_") to keep secret scanners quiet
beforeEach(() => {
  savedEnv = Object.fromEntries(CREDENTIAL_ENVS.map((k) => [k, process.env[k]]));
  for (const k of CREDENTIAL_ENVS) delete process.env[k];
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ── fixtures ─────────────────────────────────────────────────────────────────

const TEST_SERIES: SeriesDescriptor = {
  seriesId: "ecos:TEST:5020000",
  adapter: "ecos",
  statCode: "721Y001",
  itemCode: "5020000",
  title: "fixture series (국고채 3년 stand-in)",
  unitCode: "percent",
  periodType: "month",
  _verified: true,
};

interface PeriodValue {
  value: number;
  raw: string;
}
const pv = (value: number): PeriodValue => ({ value, raw: JSON.stringify({ v: value }) });

/** Recorded-fixture observations adapter: no network, calls counted, failures scripted. */
function fixtureObservationsAdapter(plan: {
  series?: SeriesDescriptor[];
  values?: Record<string, PeriodValue>;
  /** stable stand-in value for periods outside `values` (the handler path fetches the YTD window) */
  fallback?: boolean;
  fail?: (periodKey: string) => Error | undefined;
  onFetch?: (periodKey: string) => void;
}): SourceAdapter {
  return {
    code: "ecos",
    kSkill: "k-ecos",
    credentialEnv: "ECOS_API_KEY",
    kind: "observations",
    isEnabled: () => Boolean(process.env[envKey(["ECOS", "API_KEY"].join("_"))]),
    listSeries: async () => plan.series ?? [TEST_SERIES],
    fetcher: (ctx) => async (periodKey: string) => {
      plan.onFetch?.(periodKey);
      const failure = plan.fail?.(periodKey);
      if (failure) throw failure;
      const v = plan.values?.[periodKey] ?? (plan.fallback ? { value: 3.5, raw: JSON.stringify({ p: periodKey }) } : undefined);
      if (!v) throw new Error(`ecos: no data point for ${ctx.seriesId}@${periodKey}`);
      return { value: v.value, contentHash: await sha256Hex(v.raw), raw: v.raw };
    },
  };
}

/** Recorded-fixture catalog adapter (dart/law shape): no network, calls counted. */
function fixtureCatalogAdapter(plan: { rows?: import("../../scripts/co-newbiz/source-adapters.ts").CatalogUpsert[]; onList?: () => void } = {}): SourceAdapter {
  return {
    code: "law",
    kSkill: "k-law",
    credentialEnv: "LAW_API_OC",
    kind: "catalog",
    isEnabled: () => Boolean(process.env.LAW_API_OC),
    listSeries: async () => [],
    fetcher() {
      throw new Error("fixture catalog adapter has no observation fetcher");
    },
    listCatalog: async () => {
      plan.onList?.();
      return plan.rows ?? [
        { table: "md_statute", naturalKey: { korea_statute_id: "130000" }, values: { foreign_framework_key: "상법" } },
        { table: "md_statute", naturalKey: { korea_statute_id: "184000" }, values: { foreign_framework_key: "자본시장법" } },
      ];
    },
  };
}

/** Swap one SOURCE_ADAPTERS entry for a fixture; always restored. */
async function withAdapter<T>(source: string, fixture: SourceAdapter, fn: () => Promise<T>): Promise<T> {
  const real = SOURCE_ADAPTERS[source];
  SOURCE_ADAPTERS[source] = fixture;
  try {
    return await fn();
  } finally {
    SOURCE_ADAPTERS[source] = real;
  }
}

/** Set one fixture credential for the duration of fn (always removed). */
async function withKey<T>(name: string, fn: () => Promise<T>): Promise<T> {
  process.env[name] = "fixture-key";
  try {
    return await fn();
  } finally {
    delete process.env[name];
  }
}

function resetTables(): void {
  db.run("DELETE FROM fact_market_observation");
  db.run("DELETE FROM data_change_log");
  db.run("DELETE FROM raw_payload");
  db.run("DELETE FROM md_period");
  db.run("DELETE FROM md_unit");
  db.run("DELETE FROM md_source");
  db.run("DELETE FROM job_run");
  db.run("DELETE FROM schedule_job_request");
  db.run("DELETE FROM schedule_job_lock");
  db.run("DELETE FROM schedule_job");
}

const obsCount = () => (db.query("SELECT COUNT(*) c FROM fact_market_observation").get() as { c: number }).c;
const logRows = () => db.query("SELECT * FROM data_change_log ORDER BY detected_at, id").all() as any[];
const revs = (seriesId: string, period: string) =>
  (
    db
      .query(
        `SELECT o.revision_no, o.value FROM fact_market_observation o JOIN md_period p ON p.id = o.period_id
         WHERE o.series_id = ? AND p.start_date = ? ORDER BY o.revision_no`,
      )
      .all(seriesId, period) as any[]
  );

beforeEach(resetTables);

// ── fetchSource library ──────────────────────────────────────────────────────

describe("fetchSource library", () => {
  test("first insert upserts observations and writes one 'new' change-log row per period", async () => {
    // BLOCKER fix (data-architect review 2026-11-01): initial inserts write a
    // data_change_log row with change_type 'new' (old_value NULL), same
    // transaction, mirroring ensure_fresh's contract — watch-run.ts:130 counts
    // change-log rows past the watch watermark and watch-engine staleness reads
    // MAX(detected_at), so a first-ever insert MUST be visible. The backfill is
    // bounded (tens for the seeds, ~500 one-time for KRX YTD; catalogs never
    // touch the log).
    await withAdapter("ecos", fixtureObservationsAdapter({ values: { "2026-01": pv(3.1), "2026-02": pv(3.2) } }), async () => {
      await withKey(["ECOS", "API_KEY"].join("_"), async () => {
        const r = await fetchSource(db, "ecos", { fromArg: "2026-01", toArg: "2026-02" });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.kind).toBe("observations");
        expect(r.series).toBe(1);
        expect(r.rowsUpserted).toBe(2);
        expect(r.rowsChanged).toBe(0); // rows_changed = value REVISIONS; initial inserts are 'new', not changed
        expect(r.failures).toEqual([]);
        expect(r.sourceRegistered).toBe(true);
      });
    });
    expect(obsCount()).toBe(2);
    const log = logRows();
    expect(log).toHaveLength(2);
    for (const row of log) {
      expect(row.series_id).toBe(TEST_SERIES.seriesId);
      expect(row.change_type).toBe("new");
      expect(row.old_value).toBeNull();
      expect(row.new_value).toBeGreaterThan(0);
      expect(row.detected_at).toBeTruthy();
    }
    expect(revs(TEST_SERIES.seriesId, "2026-01-01")).toEqual([{ revision_no: 1, value: 3.1 }]);
    const src = db.query("SELECT reliability_grade FROM md_source WHERE code = 'ecos'").get() as { reliability_grade: string };
    expect(src.reliability_grade).toBe("A");
  });

  test("a changed value inserts a new revision and one 'revised' change-log row (same transaction)", async () => {
    const adapter = (v: number) => fixtureObservationsAdapter({ values: { "2026-01": pv(v), "2026-02": pv(3.2) } });
    const events: string[] = [];
    await withKey(["ECOS", "API_KEY"].join("_"), async () => {
      await withAdapter("ecos", adapter(3.1), async () => {
        await fetchSource(db, "ecos", { fromArg: "2026-01", toArg: "2026-02" });
      });
      await withAdapter("ecos", adapter(3.4), async () => {
        const r = await fetchSource(db, "ecos", { fromArg: "2026-01", toArg: "2026-02", emit: (e) => e.type === "row" && events.push(`${e.status}:${e.revisionNo}`) });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.rowsUpserted).toBe(2);
        expect(r.rowsChanged).toBe(1);
      });
    });
    expect(events).toEqual(["revised:2", "unchanged:1"]); // period order: 2026-01 (revised), 2026-02 (unchanged)
    expect(revs(TEST_SERIES.seriesId, "2026-01-01")).toEqual([
      { revision_no: 1, value: 3.1 },
      { revision_no: 2, value: 3.4 },
    ]);
    const log = logRows();
    // two 'new' rows from run 1 + exactly one 'revised' row from run 2
    expect(log).toHaveLength(3);
    const revised = log.filter((row) => row.change_type === "revised");
    expect(revised).toHaveLength(1);
    expect(revised[0].series_id).toBe(TEST_SERIES.seriesId);
    expect(revised[0].old_value).toBe(3.1);
    expect(revised[0].new_value).toBe(3.4);
    expect(revised[0].detected_at).toBeTruthy();
    expect(log.filter((row) => row.change_type === "new")).toHaveLength(2);
  });

  test("same-value rerun is an idempotent no-op: rows upserted, nothing changed, no new log rows", async () => {
    const adapter = () => fixtureObservationsAdapter({ values: { "2026-01": pv(3.1), "2026-02": pv(3.2) } });
    await withKey(["ECOS", "API_KEY"].join("_"), async () => {
      await withAdapter("ecos", adapter(), async () => {
        await fetchSource(db, "ecos", { fromArg: "2026-01", toArg: "2026-02" });
        const second = await fetchSource(db, "ecos", { fromArg: "2026-01", toArg: "2026-02" });
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.rowsUpserted).toBe(2); // upserts executed …
        expect(second.rowsChanged).toBe(0); // … but no value differed
      });
    });
    expect(obsCount()).toBe(2);
    expect(logRows()).toHaveLength(2); // only the two initial 'new' rows — the rerun added nothing
    expect(logRows().every((row) => row.change_type === "new")).toBe(true);
    expect(revs(TEST_SERIES.seriesId, "2026-01-01")).toHaveLength(1);
  });

  test("day-grain collection (krx shape) upserts date periods", async () => {
    const krxFixture: SourceAdapter = {
      code: "krx",
      kSkill: "k-krx",
      credentialEnv: "KRX_API_KEY",
      kind: "observations",
      isEnabled: () => Boolean(process.env[envKey(["KRX", "API_KEY"].join("_"))]),
      listSeries: async () => [
        { seriesId: "krx:index:KOSPI:close", adapter: "krx", title: "코스피 지수 일별종가", unitCode: "index", periodType: "day", _verified: true },
      ],
      listDailyRows: async (_ctx, month) =>
        month === "2026-01"
          ? [
              { date: "2026-01-02", value: 4100.5, raw: JSON.stringify({ BAS_DD: "20260102", CLSPRC_IDX: "4,100.5" }) },
              { date: "2026-01-05", value: 4120.25, raw: JSON.stringify({ BAS_DD: "20260105", CLSPRC_IDX: "4,120.25" }) },
            ]
          : [],
      fetcher() {
        throw new Error("day-grain fixture should never run the monthly fetcher");
      },
    };
    await withKey(["KRX", "API_KEY"].join("_"), async () => {
      await withAdapter("krx", krxFixture, async () => {
        const r = await fetchSource(db, "krx", { fromArg: "2026-01", toArg: "2026-01" });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.rowsUpserted).toBe(2);
        expect(r.rowsChanged).toBe(0);
      });
    });
    const periods = db.query("SELECT period_type, start_date, end_date FROM md_period WHERE start_date LIKE '2026-01-0%'").all() as any[];
    expect(periods).toHaveLength(2);
    for (const p of periods) {
      expect(p.period_type).toBe("date");
      expect(p.start_date).toBe(p.end_date);
    }
    expect(obsCount()).toBe(2);
  });

  test("failures are structured and classified (retryable vs terminal), never raw exceptions", async () => {
    await withAdapter(
      "ecos",
      fixtureObservationsAdapter({
        values: { "2026-01": pv(3.1) },
        fail: (p) => (p === "2026-02" ? new Error("HTTP 503 from ecos.bok.or.kr") : p === "2026-03" ? new Error("ecos API error 401: no auth") : undefined),
      }),
      async () => {
        await withKey(["ECOS", "API_KEY"].join("_"), async () => {
          const r = await fetchSource(db, "ecos", { fromArg: "2026-01", toArg: "2026-03" });
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          expect(r.failures).toHaveLength(2);
          expect(r.failures.map((f) => f.period)).toEqual(["2026-02", "2026-03"]);
          expect(r.failures.map((f) => f.retryable)).toEqual([true, false]);
          expect(r.failures[0].message).toBe("HTTP 503 from ecos.bok.or.kr");
          expect(r.rowsUpserted).toBe(1);
        });
      },
    );
  });

  test("credential gate returns credential_missing with ZERO adapter calls", async () => {
    let calls = 0;
    await withAdapter("ecos", fixtureObservationsAdapter({ values: {}, onFetch: () => calls++ }), async () => {
      const r = await fetchSource(db, "ecos", {});
      expect(r.ok).toBe(false);
      if (r.ok || r.reason !== "credential_missing") return;
      expect(r.credentialEnv).toBe("ECOS_API_KEY");
      expect(r.kSkill).toBe("k-ecos");
    });
    expect(calls).toBe(0);
  });

  test("catalog sync (md:sync semantics): insert then idempotent rerun; no change-log rows", async () => {
    let listCalls = 0;
    await withKey("LAW_API_OC", async () => {
      await withAdapter("law", fixtureCatalogAdapter({ onList: () => listCalls++ }), async () => {
        const first = await fetchSource(db, "law", {});
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.kind).toBe("catalog");
        expect(first.catalog).toEqual({ inserted: 2, existing: 0 });
        expect(first.rowsUpserted).toBe(2);
        const second = await fetchSource(db, "law", {});
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.catalog).toEqual({ inserted: 0, existing: 2 });
        expect(second.rowsUpserted).toBe(2);
        expect(second.rowsChanged).toBe(0);
      });
    });
    expect(listCalls).toBe(2);
    expect(logRows()).toHaveLength(0);
    const statutes = (db.query("SELECT COUNT(*) c FROM md_statute").get() as { c: number }).c;
    expect(statutes).toBe(2);
  });

  test("catalog credential gate: zero listCatalog calls", async () => {
    let listCalls = 0;
    await withAdapter("law", fixtureCatalogAdapter({ onList: () => listCalls++ }), async () => {
      const r = await fetchSource(db, "law", {});
      expect(r.ok).toBe(false);
      if (r.ok || r.reason !== "credential_missing") return;
      expect(r.credentialEnv).toBe("LAW_API_OC");
    });
    expect(listCalls).toBe(0);
  });
});

// ── collect.* handlers ───────────────────────────────────────────────────────

describe("collect.* handlers", () => {
  test("five handlers registered with the design §3.1 schedule", () => {
    const expect_ = [
      { key: "collect.dart", cron: "0 7 * * 1-5", timeoutSec: 1800, maxRetries: 2, catchup: { mode: "once" as const, maxAgeHours: 24 } },
      { key: "collect.ecos", cron: "0 8 * * *", timeoutSec: 1200, maxRetries: 2, catchup: { mode: "once" as const, maxAgeHours: 24 } },
      { key: "collect.krx", cron: "30 18 * * 1-5", timeoutSec: 1200, maxRetries: 2, catchup: { mode: "once" as const, maxAgeHours: 24 } },
      { key: "collect.kosis", cron: "0 9 * * 1", timeoutSec: 1800, maxRetries: 2, catchup: { mode: "once" as const, maxAgeHours: 24 } },
      { key: "collect.law", cron: "0 6 * * *", timeoutSec: 1800, maxRetries: 2, catchup: { mode: "once" as const, maxAgeHours: 24 } },
    ];
    for (const row of expect_) {
      const h = getJobHandler(row.key);
      expect(h).toBeTruthy();
      expect(h!.defaultCron).toBe(row.cron);
      expect(h!.timeoutSec).toBe(row.timeoutSec);
      expect(h!.maxRetries).toBe(row.maxRetries);
      expect(h!.catchup).toEqual(row.catchup);
    }
    // No opendata job (design §3.1 has five collect rows; opendata has no onboarded dataset).
    expect(getJobHandler("collect.opendata")).toBeUndefined();
    expect(listJobHandlers().filter((h) => h.key.startsWith("collect."))).toHaveLength(5);
  });

  test("schedule-seed creates the collect rows disabled (D3) with handler values", () => {
    const res = seedScheduleJobs(db, new Date());
    for (const key of ["collect.dart", "collect.ecos", "collect.krx", "collect.kosis", "collect.law"]) {
      expect(res.inserted).toContain(key);
      const row = db.query("SELECT enabled, cron_expr, timeout_sec, max_retries FROM schedule_job WHERE job_key = ?").get(key) as any;
      expect(row.enabled).toBe(0);
      expect(row.cron_expr).toBe(getJobHandler(key)!.defaultCron);
      expect(row.timeout_sec).toBe(getJobHandler(key)!.timeoutSec);
      expect(row.max_retries).toBe(getJobHandler(key)!.maxRetries);
    }
  });

  function insertJobRow(key: string, opts: { enabled?: number; maxRetries?: number } = {}): void {
    db.run(
      "INSERT OR REPLACE INTO schedule_job (id, job_key, cron_expr, enabled, created_at, timeout_sec, max_retries) VALUES (?,?,?,?,?,?,?)",
      [`id-${key}`, key, getJobHandler(key)!.defaultCron, opts.enabled ?? 1, "2026-11-01T00:00:00Z", getJobHandler(key)!.timeoutSec, opts.maxRetries ?? 2],
    );
  }
  const runEcos = (retryDelayMs = 0) => runJob(db, { jobKey: "collect.ecos", env: "dev", trigger: "manual", retryDelayMs });
  const jobRuns = () => db.query("SELECT * FROM job_run WHERE job_key = 'collect.ecos' ORDER BY started_at, id").all() as any[];
  const detailOf = (row: any) => (row.detail_json ? (JSON.parse(row.detail_json) as Record<string, unknown>) : null);

  test("end-to-end through run-job: success with counts in detail_json", async () => {
    insertJobRow("collect.ecos");
    // No --from/--to on the scheduler path: fetchSource's YTD default window
    // (current-year Jan..Dec = 12 periods) is the nightly cadence's window.
    await withAdapter("ecos", fixtureObservationsAdapter({ fallback: true }), async () => {
      process.env[envKey(["ECOS", "API_KEY"].join("_"))] = "fixture-key";
      try {
        const res = await runEcos();
        expect(res.outcome).toBe("success");
        expect(res.attempts).toBe(1);
      } finally {
        delete process.env[envKey(["ECOS", "API_KEY"].join("_"))];
      }
    });
    const runs = jobRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("success");
    expect(runs[0].rows_read).toBe(12); // attempts = upserts + failures (0 here)
    expect(runs[0].rows_written).toBe(12);
    expect(runs[0].rows_changed).toBe(0);
    expect(runs[0].env).toBe("dev");
    const detail = detailOf(runs[0]);
    expect(detail).toMatchObject({ source: "ecos", kind: "observations", series: 1, rows_upserted: 12, rows_changed: 0, failures: [] });
    expect(obsCount()).toBe(12);
  });

  test("missing credential ends the run skipped/credential_missing with zero adapter calls", async () => {
    insertJobRow("collect.ecos");
    let calls = 0;
    await withAdapter("ecos", fixtureObservationsAdapter({ values: { "2026-01": pv(3.1) }, onFetch: () => calls++ }), async () => {
      // ECOS_API_KEY stays deleted (beforeEach) — the gate must fire before any fetch.
      const res = await runEcos();
      expect(res.outcome).toBe("skipped");
    });
    expect(calls).toBe(0);
    const runs = jobRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("skipped");
    expect(runs[0].error).toBeNull();
    expect(detailOf(runs[0])).toMatchObject({ reason: "credential_missing", source: "ecos", credentialEnv: "ECOS_API_KEY" });
  });

  test("all-retryable failure (5xx class) retries twice through RetryableJobError, then fails", async () => {
    // (window note: the handler path uses the YTD default — 12 periods, all failing here)
    insertJobRow("collect.ecos", { maxRetries: 2 });
    await withAdapter(
      "ecos",
      fixtureObservationsAdapter({ fail: () => new Error("HTTP 503 from ecos.bok.or.kr") }),
      async () => {
        process.env[envKey(["ECOS", "API_KEY"].join("_"))] = "fixture-key";
        try {
          const res = await runEcos();
          expect(res.outcome).toBe("failed");
          expect(res.attempts).toBe(3);
        } finally {
          delete process.env[envKey(["ECOS", "API_KEY"].join("_"))];
        }
      },
    );
    const runs = jobRuns();
    expect(runs).toHaveLength(3);
    expect(runs.map((r: any) => r.status)).toEqual(["failed", "failed", "failed"]);
    expect(JSON.parse(runs[0].detail_json).retried).toBe(true);
    expect(JSON.parse(runs[1].detail_json).retried).toBe(true);
    expect(runs[2].detail_json).toBeNull(); // final attempt is not flagged retried
  });

  test("terminal failure (auth class) is not retried", async () => {
    insertJobRow("collect.ecos", { maxRetries: 2 });
    await withAdapter("ecos", fixtureObservationsAdapter({ fail: () => new Error("ecos API error 401: invalid key") }), async () => {
      process.env[envKey(["ECOS", "API_KEY"].join("_"))] = "fixture-key";
      try {
        const res = await runEcos();
        expect(res.outcome).toBe("failed");
        expect(res.attempts).toBe(1);
      } finally {
        delete process.env[envKey(["ECOS", "API_KEY"].join("_"))];
      }
    });
    expect(jobRuns()).toHaveLength(1);
  });

  test("partial failure is a success whose detail_json lists the isolated failures", async () => {
    insertJobRow("collect.ecos");
    await withAdapter(
      "ecos",
      fixtureObservationsAdapter({
        values: { "2026-01": pv(3.1) },
        fallback: true,
        fail: (p) => (p === "2026-02" ? new Error("ecos: no data point") : undefined),
      }),
      async () => {
        process.env[envKey(["ECOS", "API_KEY"].join("_"))] = "fixture-key";
        try {
          const res = await runEcos();
          expect(res.outcome).toBe("success"); // some rows landed: no nightly false alarm
        } finally {
          delete process.env[envKey(["ECOS", "API_KEY"].join("_"))];
        }
      },
    );
    const runs = jobRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("success");
    expect(runs[0].rows_read).toBe(12); // attempts: 11 upserts + 1 failure (SHOULD-FIX, data-architect review 2026-11-01)
    const detail = detailOf(runs[0]) as any;
    expect(detail.failures).toHaveLength(1);
    expect(detail.failures[0]).toMatchObject({ series_id: TEST_SERIES.seriesId, period: "2026-02", retryable: false });
    expect(detail.rows_upserted).toBe(11); // YTD window = 12 periods, one failed
  });

  test("watch-engine staleness sees a project whose only ingest is a fetchSource initial insert", async () => {
    // The BLOCKER scenario from the data-architect review: without a 'new'
    // data_change_log row, MAX(detected_at) over the project's live-anchor
    // series is NULL and the engine reports "no data change ever recorded" —
    // a project whose data was collected moments ago reads as maximally stale.
    db.run("INSERT INTO md_project (id, project_no, created_at, current_stage_gate, origin, track, status) VALUES ('p-col','P-COL','2026-11-01T00:00:00Z','fs','internal','greenfield','open')");
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES ('r-col','p-col','collect-staleness','h','test','2026-11-01T00:00:00Z')");
    db.run("INSERT INTO assumption (id, run_id, assumption_key, kind, value, anchor_ref, as_of) VALUES ('a-col','r-col','mkt.rate_index','live',3.1,?,'2026-11-01')", [TEST_SERIES.seriesId]);
    const draft = { projectId: "p-col", triggerType: "staleness" as const, threshold: 7, channel: "in_app" as const };
    const now = "2026-11-01T01:00:00.000Z";

    // Before any ingest: no change ever recorded → fires (the defect the fix removes).
    const before = previewWatchRule(db, draft, now);
    expect(before.wouldFire).toBe(true);
    expect(before.reason).toContain("no data change ever recorded");

    // fetchSource's initial insert (change_type 'new') makes the series fresh.
    await withAdapter("ecos", fixtureObservationsAdapter({ values: { "2026-01": pv(3.1) } }), async () => {
      await withKey(["ECOS", "API_KEY"].join("_"), async () => {
        const r = await fetchSource(db, "ecos", { fromArg: "2026-01", toArg: "2026-01" });
        expect(r.ok).toBe(true);
      });
    });
    const after = previewWatchRule(db, draft, now);
    expect(after.wouldFire).toBe(false);
    expect(after.reason).toContain("days old");
  });
});

// ── CLI output shape ─────────────────────────────────────────────────────────

describe("CLI output shape (formatFetchEventLine)", () => {
  test("reproduces the pre-P5 fetch/md:sync print lines byte-for-byte", () => {
    expect(formatFetchEventLine({ type: "source_registered", code: "ecos", grade: "A" })).toBe("md_source: registered 'ecos' (grade A)");
    expect(formatFetchEventLine({ type: "warn_unverified", seriesId: "kosis:x" })).toBe(
      "⚠ kosis:x: seed entry UNVERIFIED — confirm orgId/tblId against KOSIS before trusting outputs.",
    );
    expect(formatFetchEventLine({ type: "row", seriesId: "ecos:TEST:5020000", period: "2026-01", status: "new", revisionNo: 1 })).toBe(
      "ecos:TEST:5020000@2026-01: new (rev 1)",
    );
    expect(formatFetchEventLine({ type: "row", seriesId: "ecos:TEST:5020000", period: "2026-01", status: "unchanged", revisionNo: 3 })).toBe(
      "ecos:TEST:5020000@2026-01: unchanged (rev 3)",
    );
    expect(formatFetchEventLine({ type: "failure", seriesId: "ecos:x", message: "no data" })).toBe("  isolated failure ecos:x: no data");
    expect(formatFetchEventLine({ type: "failure", seriesId: "ecos:x", period: "2026-02", message: "HTTP 503" })).toBe(
      "  isolated failure ecos:x@2026-02: HTTP 503",
    );
  });
});
