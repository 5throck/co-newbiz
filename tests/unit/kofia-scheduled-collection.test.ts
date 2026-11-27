// @version 1.0.0
/**
 * ADR-0208 slice 4 - SCHEDULED KOFIA collection: the collect.kofia job handler, the backfill/skip behaviour of the collector,
 * the stored-data freshness that makes the manual button read-mostly, the status the WACC panel shows (last stored day,
 * next scheduled run), and the guarantee that suggestions read stored data only. Scratch SQLite, the KOFIA transport is the
 * injected `post` seam or a stubbed global fetch with the recorded fixtures (tests/fixtures/kofia): NO live network.
 *
 * The property "the collector is reachable only through the dedicated paths" is pinned here too: no SOURCE_ADAPTERS entry,
 * so the generic fetch / md:sync / collect.* machinery cannot fetch KOFIA.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DB_PATH = "db/data/test-kofia-scheduled-collection.sqlite";
const ENV_ORIGINALS: Record<string, string | undefined> = {
  CO_NEWBIZ_DB_PATH: process.env.CO_NEWBIZ_DB_PATH,
  CO_NEWBIZ_KOFIA_COLLECT: process.env.CO_NEWBIZ_KOFIA_COLLECT,
};
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
delete process.env.CO_NEWBIZ_KOFIA_COLLECT;
const restoreRootEnv = await (await import("./helpers/isolate-root-env.ts")).isolateRootEnv();
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const kofia = await import("../../db/lib/kofia-grade-yield.ts");
const { collectKofiaGradeYields } = await import("../../app/web-next/lib/kofia-collector.ts");
const { kofiaCollectStatus, kofiaNextRun } = await import("../../app/web-next/lib/kofia-collect-status.ts");
const { KOFIA_COLLECT_JOB_KEY, kofiaCollectionIdle, setKofiaCollectionTestHooks } = await import(
  "../../app/web-next/lib/kofia-collection-runner.ts"
);
const { getJobHandler } = await import("../../scripts/co-newbiz/jobs/index.ts");
const { seedScheduleJobs } = await import("../../scripts/co-newbiz/schedule-seed.ts");
const { runJob } = await import("../../scripts/co-newbiz/run-job.ts");
const { SOURCE_ADAPTERS } = await import("../../scripts/co-newbiz/source-adapters.ts");

const NOW = new Date().toISOString();
const FIXTURES = join(import.meta.dirname, "..", "fixtures", "kofia");
const fx = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const EMPTY_DAY = fx("select-day-average.xml").replace(/<BISBndSrtPrcDayDTO>[\s\S]*<\/BISBndSrtPrcDayDTO>/, "");
const compact = (d: string) => d.replaceAll("-", "");

/** Recorded transport: latest day `maxDate`; every day answers the fixture rows except `holidays` (no rows). */
function transport(maxDate: string, opts: { holidays?: string[]; failOn?: string } = {}) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      async post(body: string): Promise<string> {
        const fn = body.match(/<pfmFnName>(\w+)<\/pfmFnName>/)?.[1] ?? "";
        const day = body.match(/<standardDt>(\d{8})<\/standardDt>/)?.[1];
        calls.push(day ? `${fn}:${day}` : fn);
        if (opts.failOn && day === compact(opts.failOn) && fn === "selectDay")
          throw new Error("HTTP 503 from www.kofiabond.or.kr");
        if (fn === "getExistMaxDate") return fx("get-exist-max-date.xml").replace("20261126", compact(maxDate));
        if (fn === "getHeadList") return fx("get-head-list.xml");
        if (fn === "selectDay")
          return opts.holidays?.some((h) => compact(h) === day) ? EMPTY_DAY : fx("select-day-average.xml");
        throw new Error(`unexpected call ${fn}`);
      },
    },
  };
}

const storedDays = () =>
  (
    db
      .query(
        `SELECT p.start_date AS d FROM fact_market_observation o JOIN md_period p ON p.id = o.period_id
         WHERE o.series_id = ? ORDER BY p.start_date`,
      )
      .all(kofia.KOFIA_KTB_SERIES_ID) as Array<{ d: string }>
  ).map((r) => r.d);
const clear = () => {
  db.run("DELETE FROM fact_market_observation WHERE series_id LIKE 'kofia:%'");
  db.run("DELETE FROM job_run WHERE job_key IN (?, ?)", [kofia.KOFIA_JOB_KEY, KOFIA_COLLECT_JOB_KEY]);
  db.run("DELETE FROM schedule_job WHERE job_key = ?", [kofia.KOFIA_JOB_KEY]);
};

afterEach(() => {
  delete process.env.CO_NEWBIZ_KOFIA_COLLECT;
  setKofiaCollectionTestHooks({});
  clear();
});
afterAll(() => {
  restoreRootEnv();
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  for (const [key, value] of Object.entries(ENV_ORIGINALS)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// ── business-day helpers (pure) ─────────────────────────────────────────────

describe("expected latest day and backfill window", () => {
  // 2026-11-26 is a Thursday.
  test("before the 18:30 KST publication the previous weekday is expected; after it, the same day", () => {
    expect(kofia.kofiaExpectedLatestDate(new Date("2026-11-26T10:00:00+09:00"))).toBe("2026-11-25");
    expect(kofia.kofiaExpectedLatestDate(new Date("2026-11-26T18:29:00+09:00"))).toBe("2026-11-25");
    expect(kofia.kofiaExpectedLatestDate(new Date("2026-11-26T18:30:00+09:00"))).toBe("2026-11-26");
    expect(kofia.kofiaExpectedLatestDate(new Date("2026-11-26T23:59:00+09:00"))).toBe("2026-11-26");
  });
  test("weekends and Monday morning expect Friday; the KST date, not the UTC date, decides", () => {
    expect(kofia.kofiaExpectedLatestDate(new Date("2026-11-27T20:00:00+09:00"))).toBe("2026-11-27"); // Fri evening
    expect(kofia.kofiaExpectedLatestDate(new Date("2026-11-28T12:00:00+09:00"))).toBe("2026-11-27"); // Sat
    expect(kofia.kofiaExpectedLatestDate(new Date("2026-11-29T12:00:00+09:00"))).toBe("2026-11-27"); // Sun
    expect(kofia.kofiaExpectedLatestDate(new Date("2026-11-30T09:00:00+09:00"))).toBe("2026-11-27"); // Mon morning
    // 2026-11-26T20:00Z is already Fri 05:00 KST: the previous weekday (Thursday) is expected.
    expect(kofia.kofiaExpectedLatestDate(new Date("2026-11-26T20:00:00Z"))).toBe("2026-11-26");
  });
  test("publication moment is D 18:30 KST", () => {
    expect(kofia.kofiaPublishMoment("2026-11-26").toISOString()).toBe("2026-11-26T09:30:00.000Z");
  });
  test("missing business days: weekdays after the stored day, before the latest, within the look-back", () => {
    // latest Thu 2026-11-26, nothing stored, 10 days back: Mon 16 .. Wed 25 minus the weekend
    expect(kofia.kofiaMissingBusinessDays(null, "2026-11-26", 10)).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
    ]);
    // stored through Tue 24: only Wed 25 is missing
    expect(kofia.kofiaMissingBusinessDays("2026-11-24", "2026-11-26", 10)).toEqual(["2026-11-25"]);
    // stored through Fri 20: Mon 23, Tue 24, Wed 25 (the weekend is skipped)
    expect(kofia.kofiaMissingBusinessDays("2026-11-20", "2026-11-26", 10)).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
    ]);
    // already stored through the latest, or a zero window: nothing
    expect(kofia.kofiaMissingBusinessDays("2026-11-26", "2026-11-26", 10)).toEqual([]);
    expect(kofia.kofiaMissingBusinessDays(null, "2026-11-26", 0)).toEqual([]);
    // the look-back caps an old store
    expect(kofia.kofiaMissingBusinessDays("2026-01-02", "2026-11-26", 3)).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
    ]);
  });
});

// ── the collector: backfill and skip ────────────────────────────────────────

describe("collector backfill and skip of stored days", () => {
  test("never collected: the latest day plus the missing business days; a holiday (no rows) is skipped, not an error", async () => {
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    const t = transport("2026-11-26", { holidays: ["2026-11-18"] });
    const r = await collectKofiaGradeYields(db, new Date(), t.deps, { backfillDays: 10 });
    expect(r.date).toBe("2026-11-26");
    expect(r.max_published_date).toBe("2026-11-26");
    expect(r.backfill_no_data).toEqual(["2026-11-18"]);
    expect(r.backfill_failed).toEqual([]);
    expect(r.days_stored[0]).toBe("2026-11-26"); // the latest first
    expect(storedDays()).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-19",
      "2026-11-20",
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
    ]);
    expect(r.grades_written).toBe(10); // the latest day
    expect(r.rows_written_total).toBe(8 * 11); // KTB + ten grades per stored day
    // 1 getExistMaxDate + (getHeadList + selectDay) for the latest day and for every backfilled day, holiday included
    expect(t.calls).toHaveLength(1 + 2 * 9);
    expect(t.calls[1]).toBe("getHeadList:20261126");
  });

  test("a stored store is a one-call no-op (skipStoredDays) and a second look back finds nothing missing", async () => {
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    await collectKofiaGradeYields(db, new Date(), transport("2026-11-26").deps, { backfillDays: 10 });
    const t = transport("2026-11-26");
    const r = await collectKofiaGradeYields(db, new Date(), t.deps, { backfillDays: 10, skipStoredDays: true });
    expect(t.calls).toEqual(["getExistMaxDate"]);
    expect(r.days_stored).toEqual([]);
    expect(r.days_already_stored).toEqual(["2026-11-26"]);
    expect(r.ktb_pct).toBe(3.612); // read back from the stored day
    expect(r.rows_written_total).toBe(0);
  });

  test("a gap after the latest stored day is filled newest first; only the gap is fetched", async () => {
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    await collectKofiaGradeYields(db, new Date(), transport("2026-11-24").deps);
    const t = transport("2026-11-27");
    const r = await collectKofiaGradeYields(db, new Date(), t.deps, { backfillDays: 10, skipStoredDays: true });
    expect(r.days_stored).toEqual(["2026-11-27", "2026-11-26", "2026-11-25"]);
    expect(t.calls.filter((c) => c.startsWith("selectDay"))).toEqual([
      "selectDay:20261127",
      "selectDay:20261126",
      "selectDay:20261125",
    ]);
    expect(storedDays()).toEqual(["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]);
  });

  test("a transport failure while backfilling is recorded and stops the backfill; the latest day is kept", async () => {
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    const t = transport("2026-11-26", { failOn: "2026-11-24" });
    const r = await collectKofiaGradeYields(db, new Date(), t.deps, { backfillDays: 10 });
    expect(r.days_stored).toEqual(["2026-11-26", "2026-11-25"]);
    expect(r.backfill_failed).toEqual([{ date: "2026-11-24", error: "HTTP 503 from www.kofiabond.or.kr" }]);
    expect(storedDays()).toEqual(["2026-11-25", "2026-11-26"]);
    expect(t.calls.some((c) => c.endsWith("20261123"))).toBe(false); // stopped: nothing older was requested
  });

  test("the LATEST day failing is the run's failure (nothing stored); no option means no backfill (the button's behaviour)", async () => {
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    await expect(
      collectKofiaGradeYields(db, new Date(), transport("2026-11-26", { failOn: "2026-11-26" }).deps, {
        backfillDays: 10,
      }),
    ).rejects.toThrow(/HTTP 503/);
    expect(storedDays()).toEqual([]);
    const t = transport("2026-11-26");
    await collectKofiaGradeYields(db, new Date(), t.deps);
    expect(t.calls).toEqual(["getExistMaxDate", "getHeadList:20261126", "selectDay:20261126"]);
    expect(storedDays()).toEqual(["2026-11-26"]);
  });

  test("an aborted signal stops the run between service calls", async () => {
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    const ac = new AbortController();
    ac.abort();
    await expect(
      collectKofiaGradeYields(db, new Date(), transport("2026-11-26").deps, { signal: ac.signal }),
    ).rejects.toThrow(/aborted/);
    expect(storedDays()).toEqual([]);
  });
});

// ── the collect.kofia handler ───────────────────────────────────────────────

describe("collect.kofia job handler", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  /** Stub the global fetch the collector's default transport uses; answers the fixtures and counts requests. */
  function stubFetch(maxDate = "2026-11-26", status = 200) {
    const urls: string[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      urls.push(String(_url));
      const t = transport(maxDate);
      if (status !== 200) return new Response("busy", { status });
      return new Response(await t.deps.post(String(init?.body ?? "")), { status: 200 });
    }) as unknown as typeof fetch;
    return urls;
  }

  test("registered with the documented defaults, and it is NOT a SOURCE_ADAPTERS entry", () => {
    const h = getJobHandler("collect.kofia");
    expect(h).toBeDefined();
    expect(h?.defaultCron).toBe("45 18 * * 1-5");
    expect(h?.timeoutSec).toBe(600);
    expect(h?.maxRetries).toBe(2);
    expect(h?.catchup).toEqual({ mode: "once", maxAgeHours: 24 });
    // the generic fetch / md:sync / collect.* machinery enumerates SOURCE_ADAPTERS: KOFIA must stay out of it
    expect(Object.keys(SOURCE_ADAPTERS)).not.toContain("kofia");
    expect(
      Object.values(SOURCE_ADAPTERS).some(
        (a) => (a.code as string) === "kofia" || a.credentialEnv === kofia.KOFIA_COLLECT_ENV,
      ),
    ).toBe(false);
  });

  test("schedule-seed creates the row disabled with the handler's cron", () => {
    const res = seedScheduleJobs(db, new Date());
    expect(res.inserted).toContain("collect.kofia");
    const row = db
      .query("SELECT enabled, cron_expr, timeout_sec, max_retries FROM schedule_job WHERE job_key = 'collect.kofia'")
      .get();
    expect(row).toEqual({ enabled: 0, cron_expr: "45 18 * * 1-5", timeout_sec: 600, max_retries: 2 });
  });

  test("switch off: the run ends skipped (logged), with ZERO network calls and nothing stored", async () => {
    seedScheduleJobs(db, new Date());
    const urls = stubFetch();
    const res = await runJob(db, { jobKey: "collect.kofia", env: "dev", trigger: "manual", retryDelayMs: 0 });
    expect(res.outcome).toBe("skipped");
    expect(urls).toEqual([]);
    const run = db.query("SELECT status, error, detail_json FROM job_run WHERE job_key = 'collect.kofia'").get() as {
      status: string;
      error: string | null;
      detail_json: string;
    };
    expect(run.status).toBe("skipped");
    expect(run.error).toBeNull();
    expect(JSON.parse(run.detail_json)).toMatchObject({
      reason: "kofia_collect_off",
      switch: "CO_NEWBIZ_KOFIA_COLLECT",
    });
    expect(storedDays()).toEqual([]);
  });

  test("switch on: stores the latest day and the missing ones, job_run carries the counts and the service's latest day", async () => {
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    seedScheduleJobs(db, new Date());
    const urls = stubFetch();
    const res = await runJob(db, { jobKey: "collect.kofia", env: "dev", trigger: "manual", retryDelayMs: 0 });
    expect(res.outcome).toBe("success");
    expect(urls.every((u) => u === kofia.KOFIA_ENDPOINT)).toBe(true);
    expect(storedDays().at(-1)).toBe("2026-11-26");
    expect(storedDays().length).toBeGreaterThan(1); // backfilled business days of the look-back
    const run = db
      .query("SELECT status, rows_written, rows_changed, detail_json FROM job_run WHERE job_key = 'collect.kofia'")
      .get() as { status: string; rows_written: number; rows_changed: number; detail_json: string };
    expect(run.status).toBe("success");
    expect(run.rows_written).toBe(storedDays().length * 11);
    expect(run.rows_changed).toBe(0);
    expect(JSON.parse(run.detail_json)).toMatchObject({ max_published_date: "2026-11-26" });
    // a scheduled run the same day is one request: everything is stored
    db.run("UPDATE schedule_job SET enabled = 1 WHERE job_key = 'collect.kofia'");
    urls.length = 0;
    expect(
      (await runJob(db, { jobKey: "collect.kofia", env: "dev", trigger: "schedule", retryDelayMs: 0 })).outcome,
    ).toBe("success");
    expect(urls).toHaveLength(1);
    // ... while a MANUAL run (admin "run now") is the admin's force: it fetches the latest day again (unchanged values: no revision)
    urls.length = 0;
    expect(
      (await runJob(db, { jobKey: "collect.kofia", env: "dev", trigger: "manual", retryDelayMs: 0 })).outcome,
    ).toBe("success");
    expect(urls).toHaveLength(3);
    const last = db
      .query(
        "SELECT rows_changed FROM job_run WHERE job_key = 'collect.kofia' ORDER BY started_at DESC, id DESC LIMIT 1",
      )
      .get() as { rows_changed: number };
    expect(last.rows_changed).toBe(0);
  });

  test("a 5xx from the service is retryable; a layout change is a terminal failure", async () => {
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    seedScheduleJobs(db, new Date());
    db.run("UPDATE schedule_job SET max_retries = 1 WHERE job_key = 'collect.kofia'");
    stubFetch("2026-11-26", 503);
    const retried = await runJob(db, { jobKey: "collect.kofia", env: "dev", trigger: "manual", retryDelayMs: 0 });
    expect(retried.outcome).toBe("failed");
    expect(retried.attempts).toBe(2); // 1 try + 1 retry
    db.run("DELETE FROM job_run WHERE job_key = 'collect.kofia'");
    globalThis.fetch = (async () =>
      new Response("<html><body>moved</body></html>", { status: 200 })) as unknown as typeof fetch;
    const terminal = await runJob(db, { jobKey: "collect.kofia", env: "dev", trigger: "manual", retryDelayMs: 0 });
    expect(terminal.outcome).toBe("failed");
    expect(terminal.attempts).toBe(1);
    expect(storedDays()).toEqual([]);
  });
});

// ── freshness (what the button reads) and the panel status ──────────────────

function storeDay(date: string, ktb = 3.6) {
  const unit =
    (db.query("SELECT id FROM md_unit WHERE code = 'percent'").get() as { id: string } | undefined)?.id ?? ulid();
  if (!db.query("SELECT 1 FROM md_unit WHERE id = ?").get(unit)) {
    db.run("INSERT INTO md_unit (id, code, dimension, si_coefficient, created_at) VALUES (?,?,?,?,?)", [
      unit,
      "percent",
      "ratio",
      0.01,
      NOW,
    ]);
  }
  const src =
    (db.query("SELECT id FROM md_source WHERE code = 'kofia'").get() as { id: string } | undefined)?.id ?? ulid();
  if (!db.query("SELECT 1 FROM md_source WHERE id = ?").get(src)) {
    db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [
      src,
      "kofia",
      "B",
      NOW,
    ]);
  }
  let period = (
    db.query("SELECT id FROM md_period WHERE period_type = 'date' AND start_date = ?").get(date) as
      | { id: string }
      | undefined
  )?.id;
  if (!period) {
    period = ulid();
    db.run(
      "INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)",
      [period, "date", date, date, Number(date.slice(0, 4)), NOW],
    );
  }
  db.run(
    "INSERT INTO fact_market_observation (series_id, period_id, revision_no, value, unit_id, source_id, content_hash, fetched_at) VALUES (?,?,1,?,?,?,?,?)",
    [kofia.KOFIA_KTB_SERIES_ID, period, ktb, unit, src, `h-${date}`, NOW],
  );
}
function successRun(key: string, finishedAt: string, maxPublished: string) {
  db.run(
    `INSERT INTO job_run (id, job_key, started_at, finished_at, status, "trigger", attempt, detail_json) VALUES (?,?,?,?,'success','manual',1,?)`,
    [ulid(), key, finishedAt, finishedAt, JSON.stringify({ max_published_date: maxPublished })],
  );
}

describe("freshness from stored data", () => {
  const thuEvening = new Date("2026-11-26T20:00:00+09:00"); // expected: Thu 2026-11-26

  test("nothing stored is not up to date", () => {
    expect(kofia.kofiaFreshness(db, thuEvening)).toEqual({
      latestStoredDate: null,
      expectedDate: "2026-11-26",
      upToDate: false,
    });
  });
  test("the expected day (or newer) stored is up to date; an older one is stale", () => {
    storeDay("2026-11-26");
    expect(kofia.kofiaFreshness(db, thuEvening).upToDate).toBe(true);
    expect(kofia.kofiaFreshness(db, new Date("2026-11-26T10:00:00+09:00")).upToDate).toBe(true); // morning: Wed expected
    expect(kofia.kofiaFreshness(db, new Date("2026-11-27T20:00:00+09:00")).upToDate).toBe(false); // Fri evening: Fri expected
  });
  test("a holiday: stale by the calendar, but a successful check after the publication that saw nothing newer settles it", () => {
    storeDay("2026-11-25");
    expect(kofia.kofiaFreshness(db, thuEvening).upToDate).toBe(false);
    // a check BEFORE the publication moment of the expected day proves nothing
    successRun(kofia.KOFIA_JOB_KEY, "2026-11-26T08:00:00.000Z", "2026-11-25");
    expect(kofia.kofiaFreshness(db, thuEvening).upToDate).toBe(false);
    // a check after it that saw the service's latest day equal to the stored one: nothing newer exists
    successRun(kofia.KOFIA_MANUAL_JOB_KEY, "2026-11-26T10:00:00.000Z", "2026-11-25");
    expect(kofia.kofiaFreshness(db, thuEvening).upToDate).toBe(true);
    // ... but not when the service already published something newer than what we stored
    db.run("DELETE FROM job_run");
    successRun(kofia.KOFIA_JOB_KEY, "2026-11-26T10:00:00.000Z", "2026-11-26");
    expect(kofia.kofiaFreshness(db, thuEvening).upToDate).toBe(false);
  });
});

describe("panel status: last stored day and next scheduled run", () => {
  const now = new Date("2026-11-26T10:00:00+09:00"); // Thu 10:00 KST
  test("no job row -> not_registered; seeded -> disabled; enabled -> the next 18:45 KST weekday fire", () => {
    expect(kofiaNextRun(db, now)).toEqual({ state: "not_registered", at: null, cron: null });
    seedScheduleJobs(db, new Date());
    expect(kofiaNextRun(db, now)).toEqual({ state: "disabled", at: null, cron: "45 18 * * 1-5" });
    db.run("UPDATE schedule_job SET enabled = 1 WHERE job_key = 'collect.kofia'");
    expect(kofiaNextRun(db, now)).toEqual({
      state: "scheduled",
      at: "2026-11-26T09:45:00.000Z",
      cron: "45 18 * * 1-5",
    });
    // Friday evening -> Monday
    expect(kofiaNextRun(db, new Date("2026-11-27T20:00:00+09:00")).at).toBe("2026-11-30T09:45:00.000Z");
    // an admin-edited cron is what the panel shows (read at call time, like the tick)
    db.run("UPDATE schedule_job SET cron_expr = '0 19 * * 1-5' WHERE job_key = 'collect.kofia'");
    expect(kofiaNextRun(db, now)).toEqual({ state: "scheduled", at: "2026-11-26T10:00:00.000Z", cron: "0 19 * * 1-5" });
    // an unparsable cron never throws into a GET
    db.run("UPDATE schedule_job SET cron_expr = 'nope' WHERE job_key = 'collect.kofia'");
    expect(kofiaNextRun(db, now).state).toBe("not_registered");
  });

  test("kofiaCollectStatus: stored date, expectation and the enabled switch", () => {
    storeDay("2026-11-25");
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    const s = kofiaCollectStatus(db, now);
    expect(s).toMatchObject({
      enabled: true,
      latest_date: "2026-11-25",
      expected_date: "2026-11-25",
      up_to_date: true,
    });
    delete process.env.CO_NEWBIZ_KOFIA_COLLECT;
    expect(kofiaCollectStatus(db, now).enabled).toBe(false);
  });
});

// ── the manual button is read-mostly ────────────────────────────────────────

describe("POST .../wacc/kofia/collect is read-mostly", () => {
  const cookies: Record<string, string> = {};
  let project = "";
  async function mkUser(userId: string, role: "analyst" | "admin"): Promise<void> {
    await createUser(db, { userId, role, password: `pw-${userId}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
    db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id = ?", [userId]);
    const res = await nextRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId, password: `pw-${userId}-12345` }),
    });
    cookies[userId] = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
  }
  beforeAll(async () => {
    await mkUser("ks-analyst", "analyst");
    await mkUser("ks-admin", "admin"); // an admin never reaches a project route (FR-SEC-03)
    project = ulid();
    db.run("INSERT INTO md_project (id, project_no, created_at, status) VALUES (?,?,?, 'open')", [
      project,
      "PRJ-KS-A",
      NOW,
    ]);
    for (const u of ["ks-analyst", "ks-admin"]) {
      db.run(
        "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
        [project, u, "lead", "test", NOW, "kofia scheduled collection test"],
      );
    }
  });
  const post = (user: string, body?: unknown) =>
    nextRequest(`/api/projects/${project}/wacc/kofia/collect`, {
      method: "POST",
      headers: { cookie: cookies[user] },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const runs = () => db.query("SELECT id FROM job_run WHERE job_key = ?").all(KOFIA_COLLECT_JOB_KEY);
  const auditCount = () =>
    (
      db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'wacc_kofia.collect_requested'").get() as {
        n: number;
      }
    ).n;
  /** Today's expected day, stored: the data is fresh whatever day the suite runs on. */
  const storeToday = () => storeDay(kofia.kofiaExpectedLatestDate(new Date()));

  test("data up to date: 200 up_to_date, NO network call, no job_run, no audit row", async () => {
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    storeToday();
    const t = transport("2026-11-26");
    setKofiaCollectionTestHooks({ deps: t.deps });
    const a0 = auditCount();
    const res = await post("ks-analyst");
    expect(res.status).toBe(200);
    const data = ((await res.json()) as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({
      status: "up_to_date",
      run_id: null,
      latest_date: kofia.kofiaExpectedLatestDate(new Date()),
    });
    expect(t.calls).toEqual([]);
    expect(runs()).toHaveLength(0);
    expect(auditCount()).toBe(a0);
  }, 60000);

  test("there is no force flag on the project route: a body {force:true} does not defeat 'up to date'; an admin gets 404", async () => {
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    storeToday();
    const t = transport("2026-11-26");
    setKofiaCollectionTestHooks({ deps: t.deps });
    const res = await post("ks-analyst", { force: true });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { status: string } }).data.status).toBe("up_to_date");
    expect((await post("ks-admin")).status).toBe(404);
    expect(t.calls).toEqual([]);
    expect(runs()).toHaveLength(0);
  }, 60000);

  test("stale data: any analyst collects, and the run records the service's latest day", async () => {
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    storeDay("2020-01-02");
    const t = transport("2026-11-26");
    setKofiaCollectionTestHooks({ deps: t.deps });
    const res = await post("ks-analyst");
    expect(res.status).toBe(202);
    await kofiaCollectionIdle();
    expect(t.calls).toEqual(["getExistMaxDate", "getHeadList:20261126", "selectDay:20261126"]); // the button never backfills
    const row = db.query("SELECT detail_json FROM job_run WHERE job_key = ?").get(KOFIA_COLLECT_JOB_KEY) as {
      detail_json: string;
    };
    expect(JSON.parse(row.detail_json)).toMatchObject({ max_published_date: "2026-11-26", date: "2026-11-26" });
  }, 60000);

  test("switch off wins over everything (503), even with up-to-date data", async () => {
    storeToday();
    const t = transport("2026-11-26");
    setKofiaCollectionTestHooks({ deps: t.deps });
    expect((await post("ks-analyst")).status).toBe(503);
    expect(t.calls).toEqual([]);
  }, 60000);

  test("GET carries the status (stored data and the schedule row only)", async () => {
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    storeToday();
    seedScheduleJobs(db, new Date());
    const res = await nextRequest(`/api/projects/${project}/wacc/kofia/collect`, {
      headers: { cookie: cookies["ks-analyst"] },
    });
    expect(res.status).toBe(200);
    const data = ((await res.json()) as { data: { enabled: boolean; status: Record<string, unknown> } }).data;
    expect(data.enabled).toBe(true);
    expect(data.status).toMatchObject({
      enabled: true,
      latest_date: kofia.kofiaExpectedLatestDate(new Date()),
      up_to_date: true,
      next_run: { state: "disabled", at: null, cron: "45 18 * * 1-5" },
    });
  }, 60000);
});

// ── suggestions read stored data only ───────────────────────────────────────

describe("suggestions never fetch KOFIA data", () => {
  test("the suggestions route and the reference calculation have no path to the collector or the network", () => {
    const route = readFileSync(
      join(import.meta.dirname, "..", "..", "app/web-next/app/api/projects/[id]/wacc/suggestions/route.ts"),
      "utf8",
    );
    // code only: the header comment names the runner and the collector on purpose
    const code = route.replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/collectKofiaGradeYields|kofia-collection-runner|startKofiaCollection|\bfetch\(/);
    // the only KOFIA import of the route is the stored-data status (no network)
    expect(code.match(/kofia[\w-]*\.ts/g)).toEqual(["kofia-collect-status.ts"]);
    for (const f of [
      "db/lib/kofia-grade-yield.ts",
      "db/lib/wacc-reference.ts",
      "app/web-next/lib/kofia-collect-status.ts",
    ]) {
      const src = readFileSync(join(import.meta.dirname, "..", "..", f), "utf8").replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
      expect(src, f).not.toMatch(/\bfetch\(|XMLHttpRequest|node:https?/);
    }
  });

  test("GET suggestions with stored KOFIA data makes zero service calls and reports the stored-data status", async () => {
    process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
    const t = transport("2026-11-26");
    setKofiaCollectionTestHooks({ deps: t.deps });
    const realFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched += 1;
      throw new Error("no network in this test");
    }) as unknown as typeof fetch;
    try {
      await mkSuggestionsProject();
      const res = await nextRequest(`/api/projects/${suggestionsProject}/wacc/suggestions`, {
        headers: { cookie: suggestionsCookie },
      });
      expect(res.status).toBe(200);
      const data = ((await res.json()) as { data: { kofia_collect: Record<string, unknown> } }).data;
      expect(data.kofia_collect).toMatchObject({ enabled: true, latest_date: "2026-11-26" });
      expect(data.kofia_collect.next_run).toBeDefined();
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(t.calls).toEqual([]);
    expect(fetched).toBe(0);
  }, 60000);
});

let suggestionsProject = "";
let suggestionsCookie = "";
async function mkSuggestionsProject(): Promise<void> {
  storeDay("2026-11-26");
  await createUser(db, {
    userId: "ks-sugg",
    role: "analyst",
    password: "pw-ks-sugg-12345",
    createdBy: "test",
    now: NOW,
  });
  approveUser(db, { userId: "ks-sugg", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id = 'ks-sugg'");
  const login = await nextRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ userId: "ks-sugg", password: "pw-ks-sugg-12345" }),
  });
  suggestionsCookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];
  const company = ulid();
  db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [company, "Kofia Schedule Co", NOW]);
  suggestionsProject = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, status, company_id) VALUES (?,?,?, 'open', ?)", [
    suggestionsProject,
    "PRJ-KS-S",
    NOW,
    company,
  ]);
  db.run(
    "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
    [suggestionsProject, "ks-sugg", "lead", "test", NOW, "kofia scheduled collection test"],
  );
}

// ── wording ─────────────────────────────────────────────────────────────────

describe("locale wording of the 'not used' status", () => {
  const loc = (l: string) =>
    JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "app/web-next/locales", `${l}.json`), "utf8")).stages
      .s8.wacc.waccPanel;
  test("KOFIA covers AAA..BBB-, so it is unused for a rating BELOW BBB- (speculative grade), not above it", () => {
    expect(loc("ko").collectStatusKofiaNotUsed).toBe(
      "\uC774 \uAC00\uC0B0\uAE08\uB9AC\uC5D0\uB294 \uC4F0\uC774\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4 (\uB4F1\uAE09\uC774 BBB\u2212\uBCF4\uB2E4 \uB0AE\uC544 \uD22C\uAE30\uB4F1\uAE09\uC774\uAC70\uB098, \uB354 \uCD5C\uC2E0\uC758 ECOS \uC6D4\uC774 \uC788\uC2B5\uB2C8\uB2E4).",
    );
    expect(loc("ko").collectStatusKofiaNotUsed).not.toContain("\uCD08\uACFC"); // the old, wrong "exceeds" wording
    expect(loc("en").collectStatusKofiaNotUsed).toContain("below BBB-");
    expect(loc("en").collectStatusKofiaNotUsed).toContain("speculative grade");
  });
  test("the new status keys exist in both locales with the same placeholders", () => {
    for (const k of [
      "collectStatusKofiaNext",
      "collectStatusKofiaScheduleOff",
      "collectStatusKofiaNotScheduled",
      "collectKofiaUpToDate",
    ]) {
      expect(typeof loc("ko")[k], k).toBe("string");
      expect(typeof loc("en")[k], k).toBe("string");
      expect((loc("ko")[k].match(/\{\w+\}/g) ?? []).sort()).toEqual((loc("en")[k].match(/\{\w+\}/g) ?? []).sort());
    }
  });
});
