/** Incomplete-matrix guard + demo seed shape (S1 report crash, 2026-10-09). */
import { test, expect, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-sizing-matrix-guard.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { seedS1ToS12Demo } = await import("../../scripts/co-newbiz/seed-s1-s12-demo.ts");
const { isCompleteSizingMatrix, global2026, projection2030 } = await import("../../app/web-next/lib/market-sizing.ts");
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");

describe("isCompleteSizingMatrix", () => {
  test("rejects the old demo shape and non-objects", () => {
    const old = { tam_krw_m: 120000, cagr: 0.13, competitive: { concentration: "moderate", key_players: ["A"] } };
    expect(isCompleteSizingMatrix(old)).toBe(false);
    expect(isCompleteSizingMatrix(null)).toBe(false);
    expect(isCompleteSizingMatrix(undefined)).toBe(false);
    expect(isCompleteSizingMatrix({ regions: [] })).toBe(false);
  });
});

describe("demo seed", () => {
  resetDb();
  const demo = seedS1ToS12Demo(TEST_DB_PATH, { humanDecisions: false });
  const db = getDb(TEST_DB_PATH);
  const row = db.query("SELECT payload FROM market_sizing_version WHERE id IS NOT NULL ORDER BY created_at DESC LIMIT 1").get() as { payload: string };
  const matrix = (JSON.parse(row.payload) as { matrix: unknown }).matrix;

  test("seeded payload passes the guard and report helpers run", () => {
    expect(isCompleteSizingMatrix(matrix)).toBe(true);
    if (!isCompleteSizingMatrix(matrix)) return;
    expect(matrix.regions.length).toBeGreaterThanOrEqual(2);
    expect((matrix.segments ?? []).length).toBeGreaterThanOrEqual(2);
    expect(global2026(matrix).total).toBeGreaterThan(0);
    expect(Object.keys(projection2030(matrix))).toHaveLength(matrix.regions.length);
  });

  test("S1 predicate still reads the competitive structure", () => {
    const missing = evaluateProcess({ type: "opportunity", id: demo.opportunityId }).requiredArtifacts;
    expect(missing).not.toContain("경쟁 구조");
  });
});
