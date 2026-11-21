/**
 * DEC-20261121-01 — listGateAging must exclude delete-marked (tombstoned)
 * carriers of BOTH entity types. The pre-fix predicate filtered tombstones
 * for project rows only, so a tombstoned opportunity's HOLD kept surfacing in
 * /api/portfolio/pipeline currentHolds (board badges + dashboard HOLD KPI)
 * after the deal was deleted. Real scratch SQLite, no HTTP — same style as
 * gate-aging-track.test.ts.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-gate-aging-tombstone.sqlite";
const NOW = "2026-11-21T00:00:00Z";
// CO_NEWBIZ_DB_PATH must be set BEFORE the db client module loads —
// db/client.ts resolves DEFAULT_DB_PATH at import time (see
// gate-aging-track.test.ts for the review note behind this ordering).
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { listGateAging } = await import("../../app/web-next/lib/gate-aging.ts");

type Db = ReturnType<typeof getDb>;
let db: Db;

const insertOpportunity = (opts: { name: string; deletedAt?: string }): string => {
  const id = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at, deleted_at) VALUES (?,?,?,?,?,?)", [
    id,
    opts.name,
    "selected",
    "test",
    NOW,
    opts.deletedAt ?? null,
  ]);
  return id;
};

const insertGateHold = (entityType: "opportunity" | "project", entityId: string, gate = "pre_fs"): void => {
  db.run(
    "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), entityType, entityId, gate, "hold", "보류", "test", "2026-11-01T00:00:00Z"],
  );
};

const insertProject = (opts: { projectNo: string; deletedAt?: string }): string => {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, deleted_at) VALUES (?,?,?,?)", [
    id,
    opts.projectNo,
    NOW,
    opts.deletedAt ?? null,
  ]);
  return id;
};

beforeAll(() => {
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);

  // (a) Tombstoned opportunity: HOLD rows must be excluded.
  const oppTombstoned = insertOpportunity({ name: "tombstoned deal", deletedAt: "2026-11-20T00:00:00Z" });
  insertGateHold("opportunity", oppTombstoned);

  // (b) Live opportunity: still counts (regression guard).
  const oppLive = insertOpportunity({ name: "live deal" });
  insertGateHold("opportunity", oppLive);

  // (c) Project tombstone behavior must stay exactly as before.
  const projTombstoned = insertProject({ projectNo: "NP-TOMBSTONE", deletedAt: "2026-11-20T00:00:00Z" });
  insertGateHold("project", projTombstoned, "dd");
  const projLive = insertProject({ projectNo: "NP-LIVE" });
  insertGateHold("project", projLive, "dd");
});

afterAll(() => {
  // Close the singleton handle first so later files in the same process do not inherit a handle to the deleted file.
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("listGateAging tombstone filtering (DEC-20261121-01)", () => {
  test("a tombstoned opportunity's HOLD rows are excluded", () => {
    const rows = listGateAging(db, { minAgeDays: 0 });
    expect(rows.find((r) => r.label === "tombstoned deal")).toBeUndefined();
  });

  test("a live opportunity still counts (regression guard)", () => {
    const rows = listGateAging(db, { minAgeDays: 0 });
    const live = rows.find((r) => r.label === "live deal");
    expect(live).toBeDefined();
    expect(live?.entityType).toBe("opportunity");
    expect(live?.decision).toBe("hold");
  });

  test("project tombstone behavior unchanged: tombstoned excluded, open included", () => {
    const rows = listGateAging(db, { minAgeDays: 0 });
    expect(rows.find((r) => r.entityType === "project" && r.label.includes("NP-TOMBSTONE"))).toBeUndefined();
    expect(rows.find((r) => r.entityType === "project" && r.label.includes("NP-LIVE"))).toBeDefined();
  });
});
