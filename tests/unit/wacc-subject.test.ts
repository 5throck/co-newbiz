// @version 1.0.0
/**
 * WACC application subject (design 2026-09-18-s8-business-case-evaluation
 * REQ-W4-1..4) — route + resolver contract:
 *  (a) the track default derives from the source opportunity's route decision
 *      (greenfield → promoter, brownfield → target);
 *  (b) POST with subject requires subject_rationale (enum-validated);
 *  (c) GET returns the recorded subject with its provenance and the
 *      relevering reference when the subject is not the promoter;
 *  (d) the job-spec's discount_rate.subject carries the resolution
 *      (asserted through the business-case bridge in its own test file).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-wacc-subject.sqlite";
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
const { resolveProjectWaccSubject } = await import("../../db/lib/wacc.ts");

const NOW = new Date().toISOString();
const ANALYST = "waccsubj1";
let analystCookie = "";
let greenfieldProject = "";
let brownfieldProject = "";

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}

function seedProject(track: "greenfield" | "brownfield"): string {
  const oppId = ulid();
  const projectId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [oppId, `${track} 주체 테스트`, "테스트 산업", "selected", ANALYST, NOW],
  );
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)",
    [ulid(), oppId, track, "test route", ANALYST, NOW],
  );
  db.run(
    "INSERT INTO md_project (id, project_no, source_opportunity_id, created_at) VALUES (?,?,?,?)",
    [projectId, `P-${track}-${ulid().slice(0, 6)}`, oppId, NOW],
  );
  db.run(
    "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
    [projectId, ANALYST, "lead", ANALYST, NOW, "wacc subject test"],
  );
  return projectId;
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-waccsubj-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: ANALYST, password: "pw-waccsubj-12345" }) });
  analystCookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
  greenfieldProject = seedProject("greenfield");
  brownfieldProject = seedProject("brownfield");
});

afterAll(async () => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("WACC subject", () => {
  test("(a) track defaults: greenfield → promoter, brownfield → target (REQ-W4-2)", () => {
    const gf = resolveProjectWaccSubject(db, greenfieldProject);
    expect(gf.subject).toBe("promoter");
    expect(gf.source).toBe("track_default");
    expect(gf.default_track).toBe("greenfield");
    const bf = resolveProjectWaccSubject(db, brownfieldProject);
    expect(bf.subject).toBe("target");
    expect(bf.default_track).toBe("brownfield");
  });

  test("(b) POST without subject_rationale is rejected; enum is validated (REQ-W4-1)", async () => {
    const noRationale = await req(`/api/projects/${greenfieldProject}/wacc`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ wacc: 0.09, subject: "target" }),
    });
    expect(noRationale.status).toBe(400);

    const badEnum = await req(`/api/projects/${greenfieldProject}/wacc`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ wacc: 0.09, subject: "shareholders", subject_rationale: "x" }),
    });
    expect(badEnum.status).toBe(400);
  });

  test("(c) recorded subject returns with provenance; GET exposes it (REQ-W4-4)", async () => {
    const post = await req(`/api/projects/${greenfieldProject}/wacc`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({
        wacc: 0.09,
        subject: "project_newco",
        subject_rationale: "신설 법인이 별도 차입 구조로 추진 — 신규법인 자본구조 기준 할인",
      }),
    });
    expect(post.status).toBe(201);
    const posted = (await post.json()).data as { subject: { subject: string; source: string } };
    expect(posted.subject.subject).toBe("project_newco");
    expect(posted.subject.source).toBe("user");

    const get = await req(`/api/projects/${greenfieldProject}/wacc`, { method: "GET", headers: { cookie: analystCookie } });
    expect(get.status).toBe(200);
    const view = (await get.json()).data as { subject: { subject: string; source: string; rationale: string | null } };
    expect(view.subject.subject).toBe("project_newco");
    expect(view.subject.rationale).toContain("신설 법인");

    // Resolution reads the recorded user decision, not the track default.
    const resolved = resolveProjectWaccSubject(db, greenfieldProject);
    expect(resolved.subject).toBe("project_newco");
    expect(resolved.source).toBe("user");
  });
});
