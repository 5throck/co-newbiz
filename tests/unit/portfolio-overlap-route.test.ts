/**
 * GET /api/portfolio/overlap — route tests (design
 * 2026-10-11-portfolio-view-overlap §4/§6). Same scratch-SQLite +
 * nextRequest pattern as tests/unit/projects-list-route.test.ts. Covers:
 * 401 unauthenticated, 403 admin (role separation, ADR-0091), envelope
 * shape, and visibility — a project outside the caller's
 * listVisibleProjects set never appears as a member, and superseded
 * project_industry rows never become a key.
 */

import { test, expect, beforeAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-portfolio-overlap-route.sqlite";
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

const NOW = new Date().toISOString();
const PATH = "/api/portfolio/overlap";

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  const setCookie = res.headers.getSetCookie()[0] ?? "";
  return setCookie.split(";")[0];
}

let memberCookie: string;
let outsiderCookie: string;
let viewerCookie: string;
let projectId: string;
const INDUSTRY_ID = "ind-test-overlap";
const OTHER_INDUSTRY_ID = "ind-test-other";

beforeAll(async () => {
  await createUser(db, { userId: "member", role: "analyst", password: "pw-member-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "member", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "outsider", role: "analyst", password: "pw-outsider-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "outsider", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "viewer1", role: "viewer", password: "pw-viewer-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "viewer1", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "admin1", role: "admin", password: "pw-admin-123456", createdBy: "test", now: NOW });
  approveUser(db, { userId: "admin1", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");

  memberCookie = await loginCookie("member", "pw-member-12345");
  outsiderCookie = await loginCookie("outsider", "pw-outsider-12345");
  viewerCookie = await loginCookie("viewer1", "pw-viewer-12345");

  db.run(
    "INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)",
    [INDUSTRY_ID, "30111", "조선", "Shipbuilding", NOW],
  );
  db.run(
    "INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)",
    [OTHER_INDUSTRY_ID, null, "기타", "Other", NOW],
  );

  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, "PRJ-OVL-001", NOW]);
  db.run(
    "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
    [projectId, "member", "lead", "test", NOW, "test setup"],
  );
  // Live binding on INDUSTRY_ID; a superseded history row on OTHER_INDUSTRY_ID
  // must never surface as a key.
  const liveId = ulid();
  const oldId = ulid();
  db.run(
    "INSERT INTO project_industry (id, project_id, industry_id, bound_by, bound_at, rationale) VALUES (?,?,?,?,?,?)",
    [oldId, projectId, OTHER_INDUSTRY_ID, "member", NOW, "initial binding"],
  );
  db.run(
    "INSERT INTO project_industry (id, project_id, industry_id, bound_by, bound_at, rationale) VALUES (?,?,?,?,?,?)",
    [liveId, projectId, INDUSTRY_ID, "member", NOW, "re-judged binding"],
  );
  db.run("UPDATE project_industry SET superseded_by = ? WHERE id = ?", [liveId, oldId]);

  // Promoted opportunity (project_id set) — counts on the project side only.
  db.run(
    "INSERT INTO opportunity (id, project_id, name, market_scope, industry_id, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), projectId, "promoted case", "조선", INDUSTRY_ID, "selected", "test", NOW],
  );
  // Active opportunity sharing the industry → exact group with the project.
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, industry_id, status, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
    [ulid(), "active marine case", "조선", INDUSTRY_ID, "assessed", "test", NOW],
  );
  // NULL-industry opportunity with a non-matching scope → na bucket.
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [ulid(), "unmapped case", "전혀 다른 시장", "identified", "test", NOW],
  );
});

describe("GET /api/portfolio/overlap", () => {
  test("401 unauthenticated", async () => {
    const res = await req(PATH);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).not.toBeNull();
    expect(body.data).toBeNull();
  });

  test("403 admin (role separation — admins read no deal content)", async () => {
    const res = await req(PATH, { headers: { cookie: (await loginCookie("admin1", "pw-admin-123456")) } });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("role_forbidden");
  });

  test("viewer may read (analyst+ read gate is write-only for viewers)", async () => {
    const res = await req(PATH, { headers: { cookie: viewerCookie } });
    expect(res.status).toBe(200);
  });

  test("envelope shape and grouping for a member", async () => {
    const res = await req(PATH, { headers: { cookie: memberCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(typeof body.meta.as_of).toBe("string");

    const data = body.data;
    expect(Array.isArray(data.groups)).toBe(true);
    expect(data.counts).toMatchObject({
      projects: 1,
      exact_groups: 1,
      name_prefix_groups: 0,
      na_opportunities: 1,
      na_projects: 0,
    });

    const g = data.groups[0];
    expect(g.tier).toBe("exact");
    expect(g.industry).toMatchObject({ id: INDUSTRY_ID, name_ko: "조선", name_en: "Shipbuilding", ksic_code: "30111" });
    const kinds = g.members.map((m: { kind: string }) => m.kind).sort();
    expect(kinds).toEqual(["opportunity", "project"]);
    // Promotion dedup end-to-end: only the non-promoted opportunity is a
    // member; the promoted one is represented by the project side.
    const oppMembers = g.members.filter((m: { kind: string }) => m.kind === "opportunity");
    expect(oppMembers).toHaveLength(1);
    expect(oppMembers[0].name).toBe("active marine case");

    expect(data.na.opportunities_without_industry).toEqual([
      expect.objectContaining({ reason: "no_pinned_industry" }),
    ]);
    expect(data.na.projects_without_industry).toEqual([]);
  });

  test("visibility: a project outside the caller's visible set never appears", async () => {
    const res = await req(PATH, { headers: { cookie: outsiderCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    const flat = JSON.stringify(body.data);
    expect(flat.includes(projectId)).toBe(false);
    expect(flat.includes("PRJ-OVL-001")).toBe(false);
    expect(body.data.groups).toEqual([]);
    expect(body.data.na.projects_without_industry).toEqual([]);
    expect(body.data.counts.projects).toBe(0);
    // Opportunities are visible to every authenticated business actor — the
    // single active opportunity stays alone (not a group without the project).
    expect(body.data.counts.exact_groups).toBe(0);
  });

  test("superseded project_industry rows never become a key", async () => {
    const res = await req(PATH, { headers: { cookie: memberCookie } });
    const body = await res.json();
    const flat = JSON.stringify(body.data.groups);
    expect(flat.includes(OTHER_INDUSTRY_ID)).toBe(false);
    expect(flat.includes("기타")).toBe(false);
  });

  test("hidden promoted: count-only for outsider, zero for member, dropped/deleted not counted, nothing leaked", async () => {
    // Extra promoted rows that must NOT count: dropped and soft-deleted.
    db.run(
      "INSERT INTO opportunity (id, project_id, name, market_scope, industry_id, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), projectId, "dropped promoted", "조선", INDUSTRY_ID, "dropped", "test", NOW],
    );
    db.run(
      "INSERT INTO opportunity (id, project_id, name, market_scope, industry_id, status, created_by, created_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), projectId, "deleted promoted", "조선", INDUSTRY_ID, "selected", "test", NOW, NOW],
    );
    const out = await (await req(PATH, { headers: { cookie: outsiderCookie } })).json();
    expect(out.data.counts.hidden_promoted_opportunities).toBe(1);
    expect(out.data.na.hidden_promoted).toEqual({ count: 1 });
    const flat = JSON.stringify(out.data);
    for (const leak of [projectId, "PRJ-OVL-001", "promoted case", "dropped promoted", "deleted promoted"]) {
      expect(flat.includes(leak)).toBe(false);
    }
    const mem = await (await req(PATH, { headers: { cookie: memberCookie } })).json();
    expect(mem.data.counts.hidden_promoted_opportunities).toBe(0);
    expect(mem.data.counts.na_total).toBe(mem.data.counts.na_opportunities + mem.data.counts.na_projects);
  });

  test("missing md_industry row degrades to na, not 500", async () => {
    db.run("PRAGMA foreign_keys = OFF");
    const oid = ulid();
    db.run(
      "INSERT INTO opportunity (id, name, market_scope, industry_id, status, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
      [oid, "orphan industry", "x", "ind-does-not-exist", "assessed", "test", NOW],
    );
    db.run("PRAGMA foreign_keys = ON");
    const res = await req(PATH, { headers: { cookie: memberCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(
      body.data.na.opportunities_without_industry.some((n: { id: string; reason: string }) => n.id === oid && n.reason === "industry_unresolved"),
    ).toBe(true);
  });
});
