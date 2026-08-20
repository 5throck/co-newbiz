// @version 1.0.0
/**
 * Unit tests for db/lib/versioning.ts — ADR-0005 run-based versioning:
 * snapshot copy, overrides, input_hash reproducibility (design §12
 * verification item 13), and the diffRuns added/removed/changed bridge.
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";

const TEST_DB_PATH = "db/data/test-versioning.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { createRun, diffRuns, hashInputs } = await import("../../db/lib/versioning.ts");
const { createProject } = await import("../../db/repositories/project.repository.ts");

// Strictly increasing timestamps so "latest run" resolution is never a
// same-millisecond tie in these tests.
const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const T3 = "2026-01-03T00:00:00.000Z";
const T9 = "2026-06-01T00:00:00.000Z";

let pA: string;
let pB: string;
let pC: string;
let pD: string;
let pE: string;

beforeAll(() => {
  pA = createProject("NP-2026-801").id;
  pB = createProject("NP-2026-802").id;
  pC = createProject("NP-2026-803").id;
  pD = createProject("NP-2026-804").id;
  pE = createProject("NP-2026-805").id;
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

function inputsOf(runId: string): Record<string, number> {
  const rows = db
    .query("SELECT assumption_key, value FROM run_input WHERE run_id = ?")
    .all(runId) as { assumption_key: string; value: number }[];
  return Object.fromEntries(rows.map((r) => [r.assumption_key, r.value]));
}

test("a project's first run starts from an empty input set; the empty set hashes as sha256(\"\")", () => {
  const run = createRun(db, { projectId: pE, label: "first", createdBy: "alice", overrides: { x: 1 }, now: T1 });
  expect(run.from_run_id).toBeNull();
  expect(run.input_count).toBe(1);

  const empty = createRun(db, { projectId: pB, label: "empty", createdBy: "alice", now: T1 });
  expect(empty.input_count).toBe(0);
  // Documented serialization contract: no entries -> nothing to join -> "".
  expect(empty.input_hash).toBe(createHash("sha256").update("", "utf8").digest("hex"));
});

test("from_run_id copies the source snapshot and overrides land on top; the source stays untouched", () => {
  const seed = createRun(db, {
    projectId: pD,
    label: "v1",
    createdBy: "alice",
    overrides: { wacc: 0.08, growth: 0.03 },
    now: T1,
  });
  const v2 = createRun(db, {
    projectId: pD,
    label: "v2",
    createdBy: "alice",
    fromRunId: seed.run_id,
    overrides: { growth: 0.05 },
    now: T2,
  });
  expect(v2.from_run_id).toBe(seed.run_id);
  expect(v2.input_count).toBe(2);
  expect(inputsOf(v2.run_id)).toEqual({ wacc: 0.08, growth: 0.05 });
  // Immutable snapshot: the seed run is unchanged by the copy.
  expect(inputsOf(seed.run_id)).toEqual({ wacc: 0.08, growth: 0.03 });
});

test("without from_run_id the source is the project's latest run", () => {
  const r1 = createRun(db, { projectId: pA, label: "r1", createdBy: "alice", overrides: { k: 1 }, now: T1 });
  const r2 = createRun(db, {
    projectId: pA,
    label: "r2",
    createdBy: "alice",
    fromRunId: r1.run_id,
    overrides: { k: 2 },
    now: T2,
  });
  const r3 = createRun(db, { projectId: pA, label: "r3", createdBy: "alice", now: T3 });
  expect(r3.from_run_id).toBe(r2.run_id);
  expect(inputsOf(r3.run_id)).toEqual({ k: 2 });
});

test("same inputs produce the same input_hash regardless of label, time, creator, project, or insertion order", () => {
  const r1 = createRun(db, {
    projectId: pB,
    label: "one",
    createdBy: "alice",
    overrides: { x: 0.1, y: 2 },
    now: T1,
  });
  const r2 = createRun(db, {
    projectId: pC,
    label: "two",
    createdBy: "bob",
    overrides: { y: 2, x: 0.1 }, // insertion order must not matter
    now: T9,
  });
  expect(r2.input_hash).toBe(r1.input_hash);
  expect(r1.input_hash).toBe(hashInputs(new Map([["x", 0.1], ["y", 2]])));
  expect(r1.input_hash).toMatch(/^[0-9a-f]{64}$/);
});

test("diffRuns reports changed / added / removed with both input hashes", () => {
  // Dedicated project so `base` is its first run — no silent chaining from
  // another test's leftovers via the latest-run default.
  const pDiff = createProject("NP-2026-806").id;
  const base = createRun(db, {
    projectId: pDiff,
    label: "base",
    createdBy: "alice",
    overrides: { a: 1, b: 2, c: 3 },
    now: T1,
  });
  const next = createRun(db, {
    projectId: pDiff,
    label: "next",
    createdBy: "alice",
    fromRunId: base.run_id,
    overrides: { b: 2.5, d: 4 },
    now: T2,
  });
  const bridge = diffRuns(db, base.run_id, next.run_id);
  expect(bridge.input_hash_a).toBe(base.input_hash);
  expect(bridge.input_hash_b).toBe(next.input_hash);
  expect(bridge.changed).toEqual([{ key: "b", from: 2, to: 2.5, delta: 0.5 }]);
  expect(bridge.added).toEqual([{ key: "d", value: 4 }]);
  expect(bridge.removed).toEqual([]);

  // v1 createRun can only add or override keys, so a removal fixture is
  // constructed directly: diffRuns is a pure function over run_input reads
  // and must report a dropped key as removed.
  const pruned = createRun(db, { projectId: pDiff, label: "pruned", createdBy: "alice", fromRunId: next.run_id, now: T3 });
  db.run("DELETE FROM run_input WHERE run_id = ? AND assumption_key = 'a'", [pruned.run_id]);
  const b2 = diffRuns(db, next.run_id, pruned.run_id);
  expect(b2.changed).toEqual([]);
  expect(b2.added).toEqual([]);
  expect(b2.removed).toEqual([{ key: "a", value: 1 }]);
});

test("a cross-project from_run_id is refused, not silently merged", () => {
  const foreign = createRun(db, { projectId: pB, label: "foreign", createdBy: "alice", overrides: { z: 9 }, now: T1 });
  expect(() => createRun(db, { projectId: pA, label: "bad", createdBy: "alice", fromRunId: foreign.run_id, now: T2 })).toThrow(
    /different project/,
  );
});

test("an unknown project or from_run_id fails loudly", () => {
  expect(() => createRun(db, { projectId: "no-such-project", label: "x", createdBy: "alice" })).toThrow(/not found/);
  expect(() => createRun(db, { projectId: pA, label: "x", createdBy: "alice", fromRunId: "no-such-run" })).toThrow(/does not exist/);
});

test("diffRuns on a missing run throws", () => {
  const run = createRun(db, { projectId: pD, label: "solo", createdBy: "alice", overrides: { q: 1 }, now: T1 });
  expect(() => diffRuns(db, run.run_id, "no-such-run")).toThrow(/not found/);
});
