/**
 * T-20261022-002 — listGateAging carries the carrier track on every HOLD/KILL
 * row, so the inbox can deep link a pre_fs HOLD to the track-appropriate
 * decision surface (brownfield -> S4 committee tab, greenfield -> S5).
 * Real scratch SQLite, no HTTP.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-gate-aging-track.sqlite";
const NOW = "2026-10-21T10:00:00Z";
// CO_NEWBIZ_DB_PATH must be set BEFORE the db client module loads —
// db/client.ts resolves DEFAULT_DB_PATH at import time (review 2026-10-22 L3:
// the former beforeAll assignment was a no-op after the static import).
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { listGateAging } = await import("../../app/web-next/lib/gate-aging.ts");

type Db = ReturnType<typeof getDb>;
let db: Db;

beforeAll(() => {
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);

  // Brownfield opportunity: latest route_decision says brownfield.
  const oppBf = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [oppBf, "BF deal", "selected", "test", NOW]);
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)",
    [ulid(), oppBf, "brownfield", "test", "none", "test", NOW],
  );
  db.run(
    "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), "opportunity", oppBf, "pre_fs", "hold", "보류", "test", "2026-10-01T00:00:00Z"],
  );

  // Greenfield opportunity: route_decision says greenfield.
  const oppGf = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [oppGf, "GF deal", "selected", "test", NOW]);
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)",
    [ulid(), oppGf, "greenfield", "test", "none", "test", NOW],
  );
  db.run(
    "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), "opportunity", oppGf, "pre_fs", "hold", "보류", "test", "2026-10-02T00:00:00Z"],
  );

  // Project hold: track lives on md_project itself.
  const projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, track) VALUES (?,?,?,?)", [projectId, "NP-T002", NOW, "brownfield"]);
  db.run(
    "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), "project", projectId, "dd", "hold", "보류", "test", "2026-10-03T00:00:00Z"],
  );

  // Opportunity with no route_decision at all: track stays null.
  const oppNone = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [oppNone, "no-route deal", "selected", "test", NOW]);
  db.run(
    "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), "opportunity", oppNone, "screening", "hold", "보류", "test", "2026-10-04T00:00:00Z"],
  );
});

afterAll(() => {
  // Close the singleton handle first so later files in the same process do not inherit a handle to the deleted file.
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("listGateAging track resolution", () => {
  test("opportunity rows carry the latest route_decision track", () => {
    const rows = listGateAging(db, { minAgeDays: 1 });
    const bf = rows.find((r) => r.gate === "pre_fs" && r.label === "BF deal");
    const gf = rows.find((r) => r.gate === "pre_fs" && r.label === "GF deal");
    expect(bf?.track).toBe("brownfield");
    expect(gf?.track).toBe("greenfield");
  });

  test("project rows carry md_project.track; undecided carriers stay null", () => {
    const rows = listGateAging(db, { minAgeDays: 1 });
    expect(rows.find((r) => r.gate === "dd")?.track).toBe("brownfield");
    expect(rows.find((r) => r.label === "no-route deal")?.track).toBeNull();
  });
});
