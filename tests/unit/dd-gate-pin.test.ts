// @version 1.0.0
/**
 * DEC-20261013-05 (ADR-0160 addendum f, ADR-0162 addendum c): a valid recorded dd
 * gate decision pins the pre-scope S9 view; opt-in stays valid; a stale marker releases.
 */
import { test, expect, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-dd-gate-pin.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { ulid } = await import("../../db/lib/ulid.ts");
const gf = await import("../../app/web-next/lib/greenfield-subtrack.ts");
const bf = await import("../../app/web-next/lib/brownfield-subtrack.ts");
const tailor = await import("../../app/web-next/lib/dd-checklist-tailor.ts");

const NOW = new Date().toISOString();
const CREATED = "2026-09-10T00:00:00.000Z"; // after 2026-07-01 and after WAVE_F
const U = "pin_user";

function seedProject(track: "greenfield" | "brownfield", subTrack: string): string {
  const opp = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [opp, `pin ${ulid()}`, "t", "selected", U, NOW]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), opp, track, subTrack, "t", U, NOW]);
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, source_opportunity_id, track) VALUES (?,?,?,?,?)", [id, `PIN-${id.slice(-8)}`, CREATED, opp, track]);
  db.run("UPDATE project_policy_pin SET pinned_at = ? WHERE project_id = ?", [CREATED, id]);
  return id;
}
function decideDd(projectId: string, decision = "go"): string {
  const id = ulid();
  db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [id, "project", projectId, "dd", decision, "t", U, NOW]);
  return id;
}
function optIn(projectId: string, doc: string, version: string) {
  db.run("INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by) VALUES (?,?,?,?,?,?)", [ulid(), projectId, doc, version, NOW, U]);
}

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("greenfield", () => {
  test("no dd decision: scope by date applies", () => {
    const p = seedProject("greenfield", "existing_business_rbd");
    expect(gf.hasValidDdGateDecision(p, db)).toBe(false);
    expect(gf.workspaceScopeByDate(p, db)).toBe(true);
    expect(gf.subTrackSelectionActive(p, db)).toBe(true);
    expect(tailor.subTrackChecklistIds(p).length).toBeGreaterThan(0);
  });
  test("gate-passed project stays on the pre-scope view (any verdict)", () => {
    for (const verdict of ["go", "hold", "kill"]) {
      const p = seedProject("greenfield", "existing_business_rbd");
      decideDd(p, verdict);
      expect(gf.workspaceScopeByDate(p, db)).toBe(false);
      expect(gf.subTrackSelectionActive(p, db)).toBe(false);
      expect(tailor.subTrackChecklistIds(p)).toEqual([]);
    }
  });
  test("opt-in recorded by a person stays valid", () => {
    const p = seedProject("greenfield", "existing_business_rbd");
    decideDd(p);
    optIn(p, gf.GF_DD_POLICY_DOC_ID, gf.GF_DD_SUBTRACK_VERSION);
    optIn(p, gf.GF_WS_POLICY_DOC_ID, "1.0.0");
    expect(gf.subTrackSelectionActive(p, db)).toBe(true);
    expect(gf.hasWorkspaceScopeOptIn(p, db)).toBe(true);
    expect(tailor.subTrackChecklistIds(p).length).toBeGreaterThan(0);
  });
  test("stale marker releases the pin", () => {
    const p = seedProject("greenfield", "existing_business_rbd");
    const d = decideDd(p);
    expect(gf.workspaceScopeByDate(p, db)).toBe(false);
    db.run("INSERT INTO gate_decision_stale (decision_id, stale_at, stale_reason) VALUES (?,?,?)", [d, NOW, "target changed"]);
    expect(gf.hasValidDdGateDecision(p, db)).toBe(false);
    expect(gf.workspaceScopeByDate(p, db)).toBe(true);
    expect(gf.subTrackSelectionActive(p, db)).toBe(true);
  });
});

describe("brownfield", () => {
  test("no dd decision: scope by date applies", () => {
    const p = seedProject("brownfield", "strategic_investment");
    expect(bf.brownfieldScopeByDate(p, db)).toBe(true);
    expect(bf.brownfieldAttachedExtras(p, "strategic_investment", db).length).toBeGreaterThan(0);
  });
  test("gate-passed project stays on the pre-scope view (any verdict)", () => {
    for (const verdict of ["go", "hold", "kill"]) {
      const p = seedProject("brownfield", "strategic_investment");
      decideDd(p, verdict);
      expect(bf.brownfieldScopeByDate(p, db)).toBe(false);
      expect(bf.brownfieldRouteInfo(p, db)?.by_date).toBe(false);
      // created after WAVE_F: falls through to the pre-existing unscoped sub-track extras, not the scoped set
      expect(bf.brownfieldAttachedExtras(p, "strategic_investment", db)).toEqual(tailor.subTrackChecklistIds(p));
    }
    const gated = seedProject("brownfield", "strategic_investment");
    const open = seedProject("brownfield", "strategic_investment");
    decideDd(gated);
    expect(tailor.subTrackChecklistIds(gated)).not.toEqual(tailor.subTrackChecklistIds(open));
  });
  test("opt-in recorded by a person stays valid", () => {
    const p = seedProject("brownfield", "strategic_investment");
    decideDd(p);
    optIn(p, bf.BF_WS_POLICY_DOC_ID, "1.0.0");
    expect(bf.brownfieldScopeByDate(p, db)).toBe(false);
    expect(bf.hasBrownfieldScopeOptIn(p, db)).toBe(true);
    expect(bf.brownfieldAttachedExtras(p, "strategic_investment", db).length).toBeGreaterThan(0);
    expect(tailor.subTrackChecklistIds(p)).toEqual(bf.brownfieldAttachedExtras(p, "strategic_investment", db));
  });
  test("stale marker releases the pin", () => {
    const p = seedProject("brownfield", "strategic_investment");
    const d = decideDd(p);
    expect(bf.brownfieldScopeByDate(p, db)).toBe(false);
    db.run("INSERT INTO gate_decision_stale (decision_id, stale_at, stale_reason) VALUES (?,?,?)", [d, NOW, "target changed"]);
    expect(bf.brownfieldScopeByDate(p, db)).toBe(true);
  });
});
