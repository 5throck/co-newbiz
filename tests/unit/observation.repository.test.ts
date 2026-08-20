// @version 1.0.0
/**
 * Unit tests for ensure_fresh() (db/repositories/observation.repository.ts)
 * — FR-DATA-05. Runs against a real (scratch, deleted after) SQLite file,
 * not a mock DB layer, so the actual SQL and constraints are exercised.
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { ensureFresh, type Fetcher } from "../../db/repositories/observation.repository.ts";

const TEST_DB_PATH = "db/data/test-observation-repository.sqlite";
let sourceId: string;
let unitId: string;
let periodId: string;

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);

  const db = getDb(TEST_DB_PATH);
  const now = new Date().toISOString();
  sourceId = ulid();
  db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [
    sourceId,
    "TEST-SRC",
    "A",
    now,
  ]);
  unitId = ulid();
  db.run("INSERT INTO md_unit (id, code, dimension, si_coefficient, created_at) VALUES (?,?,?,?,?)", [
    unitId,
    "PCT",
    "ratio",
    1,
    now,
  ]);
  periodId = ulid();
  db.run(
    "INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)",
    [periodId, "month", "2026-08-01", "2026-08-31", 2026, now]
  );
});

afterAll(() => {
  resetDb();
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  const wal = TEST_DB_PATH + "-wal";
  const shm = TEST_DB_PATH + "-shm";
  if (existsSync(wal)) rmSync(wal);
  if (existsSync(shm)) rmSync(shm);
});

function makeFetcher(getValue: () => number): { fetcher: Fetcher; callCount: () => number } {
  let calls = 0;
  const fetcher: Fetcher = async () => {
    calls++;
    const value = getValue();
    return { value, contentHash: `hash-${value}`, raw: "{}" };
  };
  return { fetcher, callCount: () => calls };
}

test("first call fetches and inserts revision 1", async () => {
  const { fetcher, callCount } = makeFetcher(() => 4.5);
  const result = await ensureFresh({ seriesId: "SERIES-A", periodId, unitId, sourceId, fetcher });

  expect(result.value).toBe(4.5);
  expect(result.revisionNo).toBe(1);
  expect(result.fromCache).toBe(false);
  expect(result.changeType).toBe("new");
  expect(callCount()).toBe(1);
});

test("second call within TTL is a cache hit — zero network calls", async () => {
  const { fetcher, callCount } = makeFetcher(() => 999); // would be wrong if actually called
  const result = await ensureFresh({ seriesId: "SERIES-A", periodId, unitId, sourceId, fetcher });

  expect(result.fromCache).toBe(true);
  expect(result.value).toBe(4.5); // unchanged from the first call, not the fetcher's new value
  expect(callCount()).toBe(0);
});

test("forced re-fetch with an unchanged value makes no new revision", async () => {
  const { fetcher, callCount } = makeFetcher(() => 4.5);
  const result = await ensureFresh({ seriesId: "SERIES-A", periodId, unitId, sourceId, fetcher, ttlMs: -1 });

  expect(result.changeType).toBe("unchanged");
  expect(result.revisionNo).toBe(1);
  expect(callCount()).toBe(1);
});

test("forced re-fetch with a changed value inserts a NEW revision, preserving the old one", async () => {
  const { fetcher } = makeFetcher(() => 5.0);
  const result = await ensureFresh({ seriesId: "SERIES-A", periodId, unitId, sourceId, fetcher, ttlMs: -1 });

  expect(result.changeType).toBe("revised");
  expect(result.revisionNo).toBe(2);
  expect(result.value).toBe(5.0);

  const db = getDb(TEST_DB_PATH);
  const rows = db
    .query("SELECT revision_no, value FROM fact_market_observation WHERE series_id = ? ORDER BY revision_no")
    .all("SERIES-A") as { revision_no: number; value: number }[];

  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual({ revision_no: 1, value: 4.5 });
  expect(rows[1]).toEqual({ revision_no: 2, value: 5.0 });
});

test("every insert (new and revised) is logged to data_change_log", async () => {
  const db = getDb(TEST_DB_PATH);
  const changes = db
    // change_type tiebreak: both rows can land in the same millisecond, and a
    // bare ORDER BY detected_at is unstable on ties ('new' < 'revised' keeps
    // insertion order deterministic without relying on rowid).
    .query("SELECT change_type, old_value, new_value FROM data_change_log WHERE series_id = ? ORDER BY detected_at, change_type")
    .all("SERIES-A") as { change_type: string; old_value: number | null; new_value: number }[];

  expect(changes).toHaveLength(2);
  expect(changes[0]).toEqual({ change_type: "new", old_value: null, new_value: 4.5 });
  expect(changes[1]).toEqual({ change_type: "revised", old_value: 4.5, new_value: 5.0 });
});
