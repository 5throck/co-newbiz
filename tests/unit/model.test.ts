// @version 1.0.0
/**
 * CLI tests for scripts/co-newbiz/model.ts (the `model` / `diff` cases of
 * newbiz.ts) — run-based versioning happy path, following the
 * simulate.test.ts pattern of importing the command's business function
 * directly rather than spawning the CLI process.
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-model-cli.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { createProject } = await import("../../db/repositories/project.repository.ts");
const { parseSetPairs, runModelCreate, runModelDiff } = await import("../../scripts/co-newbiz/model.ts");

let projectId: string;

beforeAll(() => {
  projectId = createProject("NP-2026-901").id;
});

afterAll(async () => {
  resetDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
      return;
    } catch {
      await Bun.sleep(50 * (attempt + 1));
    }
  }
});

test("model creates a versioned run from --set pairs, diff bridges the two runs", () => {
  const v1 = runModelCreate(
    { projectId, label: "v1 Pre-FS", setPairs: ["wacc=0.08", "growth=0.03"] },
    TEST_DB_PATH,
  );
  expect(v1.label).toBe("v1 Pre-FS");
  expect(v1.run_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID (db/lib/ulid.ts)
  expect(v1.input_count).toBe(2);
  expect(v1.from_run_id).toBeNull(); // first run of this project
  expect(v1.input_hash).toMatch(/^[0-9a-f]{64}$/);

  const v2 = runModelCreate(
    { projectId, label: "v2 sensitivity", fromRunId: v1.run_id, setPairs: ["wacc=0.09"] },
    TEST_DB_PATH,
  );
  expect(v2.input_count).toBe(2);
  expect(v2.from_run_id).toBe(v1.run_id);

  const bridge = runModelDiff(v1.run_id, v2.run_id, TEST_DB_PATH);
  expect(bridge.changed).toHaveLength(1);
  expect(bridge.changed[0]).toMatchObject({ key: "wacc", from: 0.08, to: 0.09 });
  expect(bridge.changed[0].delta).toBeCloseTo(0.01, 10);
  expect(bridge.added).toEqual([]);
  expect(bridge.removed).toEqual([]);
  expect(bridge.input_hash_a).toBe(v1.input_hash);
  expect(bridge.input_hash_b).toBe(v2.input_hash);
});

test("parseSetPairs accepts finite numbers and rejects malformed pairs loudly", () => {
  expect(parseSetPairs(["x=1", "y=-2.5", "z=1e-3"])).toEqual({ x: 1, y: -2.5, z: 0.001 });
  expect(() => parseSetPairs(["no-equals-sign"])).toThrow(/key=value/);
  expect(() => parseSetPairs(["x=abc"])).toThrow(/finite number/);
  expect(() => parseSetPairs(["=1"])).toThrow(/key=value/);
});

test("model against an unknown project fails loudly, never silently", () => {
  expect(() => runModelCreate({ projectId: "no-such-project", label: "x" }, TEST_DB_PATH)).toThrow(/not found/);
  expect(() => runModelDiff("no-run-a", "no-run-b", TEST_DB_PATH)).toThrow(/not found/);
});
