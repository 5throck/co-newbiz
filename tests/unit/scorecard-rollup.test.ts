/**
 * Unit tests for scripts/co-newbiz/scorecard-rollup.ts — the
 * `scorecard:rollup` CLI core (ADR-0059 E.4). Covers the two CLI postures
 * the command contract names: an empty migrated DB prints valid JSON with
 * review_cycle null and empty sections (exit-0 zero point, never a silent
 * pass), and a seeded 2-project/2-cycle DB resolves both the explicit and
 * the latest cycle correctly. Seeding goes through the repository writer so
 * the CLI reads exactly what production writes.
 */
import { test, describe, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { recordVentureScorecardCycle, type ScorecardRowInput } from "../../db/repositories/venture-scorecard.repository.ts";
import { runScorecardRollup } from "../../scripts/co-newbiz/scorecard-rollup.ts";

const TEST_DB_PATH = "db/data/test-scorecard-rollup.sqlite";
const NOW = "2026-08-23T00:00:00.000Z";
const U1 = "user-001";

type Db = ReturnType<typeof GetDb>;
let db: Db;

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);
  db.run("INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), U1, "analyst", "active", "salt", "hash", 1, NOW]);
});

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (!existsSync(p)) continue;
    try {
      rmSync(p);
    } catch {
      // best-effort cleanup only
    }
  }
});

function seedProjectWithCycle(reviewCycle: string, rows: ScorecardRowInput[]): { projectId: string; runId: string } {
  const projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, `NP-${projectId.slice(-6)}`, NOW]);
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [projectId, U1, "contributor", "admin", NOW, "test fixture basis"]);
  const runId = ulid();
  db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [runId, projectId, `hash-${runId.slice(-6)}`, U1, NOW]);
  recordVentureScorecardCycle(
    { runId, projectId, sourceProcedure: "portfolio-venture-monitoring", reviewCycle, rows, actor: U1, now: NOW },
    db,
  );
  return { projectId, runId };
}

function row(overrides: Partial<ScorecardRowInput> = {}): ScorecardRowInput {
  return {
    venture_class: "driving",
    section: "financial",
    measure_key: `measure-${ulid().slice(-8)}`,
    target_value: ">= 0pp",
    actual_value: "+3pp",
    status: "on_target",
    evidence_ref: "doc:cim-2026-001",
    observed_at: NOW,
    ...overrides,
  };
}

describe("runScorecardRollup — the `scorecard:rollup` CLI core", () => {
  test("an empty (migrated) DB is a valid zero point: parseable JSON, review_cycle null, empty sections", () => {
    const json = runScorecardRollup({ dbPath: TEST_DB_PATH });
    const parsed = JSON.parse(json);

    expect(parsed).toEqual({
      review_cycle: null,
      resolved_from: "latest",
      financial: [],
      strategic: [],
      class_rollup: [],
      insufficient_evidence: [],
      provenance: { runs: [], review_cycles_available: [] },
    });
  });

  test("a seeded 2-project/2-cycle DB: explicit and latest cycle both resolve correctly", () => {
    seedProjectWithCycle("2026-Q3", [row({ venture_class: "emergent", measure_key: "seed-q3", status: "deviation" })]);
    seedProjectWithCycle("2026-Q4", [
      row({ venture_class: "driving", measure_key: "seed-q4-fin", status: "on_target" }),
      row({ venture_class: "jv", section: "strategic", measure_key: "seed-q4-str", target_value: null, actual_value: null, status: "insufficient_evidence" }),
    ]);

    const explicit = JSON.parse(runScorecardRollup({ dbPath: TEST_DB_PATH, reviewCycle: "2026-Q3" }));
    expect(explicit.review_cycle).toBe("2026-Q3");
    expect(explicit.resolved_from).toBe("explicit");
    expect(explicit.financial.map((r: { measure_key: string }) => r.measure_key)).toEqual(["seed-q3"]);
    expect(explicit.strategic).toEqual([]);

    const latest = JSON.parse(runScorecardRollup({ dbPath: TEST_DB_PATH }));
    expect(latest.review_cycle).toBe("2026-Q4");
    expect(latest.resolved_from).toBe("latest");
    expect(latest.financial.map((r: { measure_key: string }) => r.measure_key)).toEqual(["seed-q4-fin"]);
    expect(latest.strategic.map((r: { measure_key: string }) => r.measure_key)).toEqual(["seed-q4-str"]);
    expect(latest.insufficient_evidence).toHaveLength(1);
    expect(latest.provenance.review_cycles_available).toEqual(["2026-Q3", "2026-Q4"]);
  });
});
