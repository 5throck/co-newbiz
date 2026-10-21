// @version 1.0.0
/**
 * T-20261022-016 — POST /api/projects/[id]/milestones/import-baseline imports
 * the GREENFIELD execution baseline, so the carrier must still resolve
 * greenfield (resolveTrack). A project re-classified to brownfield keeps its
 * historical baseline rows but must not import from them — 409
 * not_applicable_track, same guard shape as the S5 route (T-20261022-007).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-milestones-import-track.sqlite";
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

const NOW = "2026-10-22T09:00:00Z";
const ANALYST = "imp-track-analyst";
let cookie = "";

const post = (projectId: string) =>
  nextRequest(`/api/projects/${projectId}/milestones/import-baseline`, { method: "POST", headers: { cookie } });
const milestonesOf = (projectId: string) =>
  (db.query("SELECT COUNT(*) n FROM project_milestone WHERE project_id = ?").get(projectId) as { n: number }).n;

/** A project whose current route decision + md_project.track both say `track`. */
function seedProject(track: "greenfield" | "brownfield" | null): string {
  const opp = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [opp, `import-track ${ulid().slice(-6)}`, "산업", "selected", ANALYST, NOW]);
  if (track) {
    db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)", [ulid(), opp, track, "test", ANALYST, NOW]);
  }
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, source_opportunity_id, track, origin) VALUES (?,?,?,?,?,?)", [id, `IMP-${id.slice(-8)}`, NOW, opp, track, null]);
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [id, ANALYST, "lead", "root", NOW, "test"]);
  return id;
}

/** A confirmed S11 execution baseline (process_run row, status done + confirmation). */
function seedConfirmedBaseline(projectId: string): void {
  db.run(
    `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      ulid(), "project", projectId, projectId, "test", "s11_execution_baseline", "done", "human", ANALYST, NOW, NOW,
      JSON.stringify({
        entries: { permit_milestones: [{ name: "건축허가", issuer: "시청", target_date: "2027-03-01" }] },
        confirmation: { rationale: "테스트 확인" },
      }),
    ],
  );
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-imp-track-1234", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: ANALYST, password: "pw-imp-track-1234" }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("POST milestones/import-baseline — greenfield-only via resolveTrack", () => {
  test("brownfield carrier with a historical confirmed baseline -> 409 not_applicable_track, nothing imported", async () => {
    const p = seedProject("brownfield");
    seedConfirmedBaseline(p);
    const res = await post(p);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_applicable_track");
    expect(milestonesOf(p)).toBe(0);
  });

  test("unresolved track (no signal) -> 409 not_applicable_track", async () => {
    const p = seedProject(null);
    seedConfirmedBaseline(p);
    const res = await post(p);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_applicable_track");
  });

  test("greenfield carrier -> unchanged: confirmed baseline imports its permit milestone", async () => {
    const p = seedProject("greenfield");
    seedConfirmedBaseline(p);
    const res = await post(p);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ added: 1, skipped: 0 });
    const row = db.query("SELECT title, source FROM project_milestone WHERE project_id = ?").get(p) as { title: string; source: string };
    expect(row).toMatchObject({ title: "건축허가", source: "execution_baseline" });
  });
});
