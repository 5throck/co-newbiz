// @version 1.0.0
/**
 * Wave 5.6A API tests — docs/api-spec.md, exercising the real Hono app via
 * app.request() against a scratch SQLite file (deleted after), not mocked
 * handlers. Every assertion here was first verified with a throwaway smoke
 * run (bun smoke.api.ts, now removed) before being encoded.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-api.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { buildApp } = await import("../../app/server/index.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { grantProjectMembership } = await import("../../db/lib/access-control.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

const app = buildApp();
const NOW = new Date().toISOString();

function req(path: string, init?: RequestInit) {
  return app.request(path, init);
}
function loginBody(userId: string, password: string) {
  return { method: "POST", body: JSON.stringify({ userId, password }) };
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", loginBody(userId, password));
  const setCookie = res.headers.getSetCookie()[0] ?? "";
  return setCookie.split(";")[0];
}

let rootCookie: string;
let aliceCookie: string;
let bobCookie: string;
let projectId: string;

beforeAll(async () => {
  await createUser(db, { userId: "root", role: "admin", password: "pw-root-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "root", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "alice", role: "analyst", password: "pw-alice-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "alice", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "bob", role: "analyst", password: "pw-bob-123456", createdBy: "test", now: NOW });
  approveUser(db, { userId: "bob", approvedBy: "test", now: NOW });

  rootCookie = await loginCookie("root", "pw-root-12345");
  aliceCookie = await loginCookie("alice", "pw-alice-12345");
  bobCookie = await loginCookie("bob", "pw-bob-123456");

  const res = await req("/api/projects", {
    method: "POST",
    headers: { cookie: aliceCookie },
    body: JSON.stringify({ project_no: "NP-2026-101" }),
  });
  projectId = (await res.json()).data.id;
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

describe("auth", () => {
  test("register lands as pending viewer", async () => {
    const res = await req("/api/auth/register", { method: "POST", body: JSON.stringify({ userId: "carol", password: "pw-carol-12345" }) });
    expect(res.status).toBe(201);
    expect((await res.json()).data.status).toBe("pending");
  });

  test("pending account cannot log in", async () => {
    const res = await req("/api/auth/login", loginBody("carol", "pw-carol-12345"));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("pending_approval");
  });

  test("wrong password does not leak existence", async () => {
    const res = await req("/api/auth/login", loginBody("alice", "wrong-password"));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("invalid_credentials");
  });

  test("/api/auth/me resolves the cookie session", async () => {
    const res = await req("/api/auth/me", { headers: { cookie: aliceCookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ userId: "alice", role: "analyst" });
  });

  test("unauthenticated request is rejected", async () => {
    const res = await req("/api/auth/me");
    expect(res.status).toBe(401);
  });
});

describe("projects — deny-by-default access (FR-SEC-01/02)", () => {
  test("creator becomes lead and sees the project", async () => {
    const res = await req("/api/projects", { headers: { cookie: aliceCookie } });
    const data = (await res.json()).data;
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(projectId);
  });

  test("a non-member's list is empty", async () => {
    const res = await req("/api/projects", { headers: { cookie: bobCookie } });
    expect((await res.json()).data).toHaveLength(0);
  });

  test("a non-member's direct fetch is 404, not 403 — existence is protected", async () => {
    const res = await req(`/api/projects/${projectId}`, { headers: { cookie: bobCookie } });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  test("admin without membership sees nothing (FR-SEC-02)", async () => {
    const res = await req("/api/projects", { headers: { cookie: rootCookie } });
    expect((await res.json()).data).toHaveLength(0);
  });

  test("project lead grants membership", async () => {
    const res = await req(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ userId: "bob", project_role: "contributor", need_to_know_basis: "screening support" }),
    });
    expect(res.status).toBe(201);
  });

  test("a blank need-to-know basis is rejected", async () => {
    const res = await req(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ userId: "bob", project_role: "observer", need_to_know_basis: "   " }),
    });
    expect(res.status).toBe(400);
  });

  test("a non-lead member cannot grant membership", async () => {
    const res = await req(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { cookie: bobCookie },
      body: JSON.stringify({ userId: "carol", project_role: "observer", need_to_know_basis: "x" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("MNPI classification (FR-SEC-06)", () => {
  test("admin without membership cannot classify — 404, not 403", async () => {
    const res = await req(`/api/projects/${projectId}/classification`, {
      method: "PUT",
      headers: { cookie: rootCookie },
      body: JSON.stringify({ sensitivity: "restricted", mnpi_flag: 1 }),
    });
    expect(res.status).toBe(404);
  });

  test("member admin sets MNPI classification", async () => {
    grantProjectMembership(db, { projectId, userId: "root", projectRole: "reviewer", grantedBy: "alice", needToKnowBasis: "security review", now: NOW });
    const res = await req(`/api/projects/${projectId}/classification`, {
      method: "PUT",
      headers: { cookie: rootCookie },
      body: JSON.stringify({ sensitivity: "restricted", mnpi_flag: 1 }),
    });
    expect(res.status).toBe(200);
  });

  test("MNPI project excluded from the default list", async () => {
    const res = await req("/api/projects", { headers: { cookie: aliceCookie } });
    expect((await res.json()).data).toHaveLength(0);
  });

  test("include_mnpi=1 opts back in", async () => {
    const res = await req("/api/projects?include_mnpi=1", { headers: { cookie: aliceCookie } });
    expect((await res.json()).data).toHaveLength(1);
  });

  test("member detail carries the mnpi_banner meta flag", async () => {
    const res = await req(`/api/projects/${projectId}`, { headers: { cookie: aliceCookie } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.meta.mnpi_banner).toBe(true);
  });
});

describe("bearer API tokens", () => {
  let readToken: string;

  test("a token is returned once, on issue", async () => {
    const res = await req("/api/tokens", { method: "POST", headers: { cookie: bobCookie }, body: JSON.stringify({ label: "mcp", scopes: ["read"] }) });
    const body = (await res.json()).data;
    expect(res.status).toBe(201);
    expect(body.token).toHaveLength(64);
    readToken = body.token;
  });

  test("a read-scoped token can read a visible project", async () => {
    const res = await req(`/api/projects/${projectId}`, { headers: { authorization: `Bearer ${readToken}` } });
    expect(res.status).toBe(200);
  });

  test("a read-scoped token cannot mutate", async () => {
    const res = await req("/api/tokens", { method: "POST", headers: { authorization: `Bearer ${readToken}` }, body: JSON.stringify({ label: "x" }) });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("insufficient_scope");
  });
});

describe("must-change-password gate", () => {
  let resetCookie: string;

  test("admin resets a password, forcing the change flow", async () => {
    const res = await req("/api/auth/password-reset", {
      method: "POST",
      headers: { cookie: rootCookie },
      body: JSON.stringify({ userId: "bob", tempPassword: "pw-temp-98765" }),
    });
    expect(res.status).toBe(200);
    resetCookie = await loginCookie("bob", "pw-temp-98765");
  });

  test("every other route is gated until the password changes", async () => {
    const res = await req("/api/projects", { headers: { cookie: resetCookie } });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("must_change_password");
  });

  test("password-change lifts the gate and issues a fresh session", async () => {
    const changeRes = await req("/api/auth/password-change", {
      method: "POST",
      headers: { cookie: resetCookie },
      body: JSON.stringify({ currentPassword: "pw-temp-98765", newPassword: "pw-bob-678901" }),
    });
    expect(changeRes.status).toBe(200);
    const freshCookie = await loginCookie("bob", "pw-bob-678901");
    const meRes = await req("/api/auth/me", { headers: { cookie: freshCookie } });
    expect((await meRes.json()).data.mustChangePassword).toBe(false);
    bobCookie = freshCookie; // subsequent describes use the post-reset credential
  });
});

describe("CSRF", () => {
  test("a cross-origin cookie POST is rejected", async () => {
    const res = await req("/api/tokens", {
      method: "POST",
      headers: { cookie: aliceCookie, origin: "http://evil.example", host: "localhost:8787" },
      body: JSON.stringify({ label: "csrf-probe" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("csrf_rejected");
  });
});

describe("governance and glossary", () => {
  test("RAG reads always carry a rationale (ui-spec: no color-only signal)", async () => {
    const runId = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [runId, projectId, "test v1", "deadbeef", "alice", NOW]);
    db.run(
      "INSERT INTO rag_assessment (id, run_id, project_id, dimension, grade, rationale, assessed_at) VALUES (?,?,?,?,?,?,?)",
      [ulid(), runId, projectId, "financial", "green", "IRR clears hurdle by 3.1%p", NOW],
    );
    const res = await req(`/api/projects/${projectId}/rag`, { headers: { cookie: aliceCookie } });
    const body = await res.json();
    expect(body.data.dimensions).toHaveLength(1);
    expect(body.data.dimensions[0].rationale).toContain("IRR");
  });

  test("RAG is visible to a member added after the assessment", async () => {
    const res = await req(`/api/projects/${projectId}/rag`, { headers: { cookie: bobCookie } });
    expect(res.status).toBe(200);
  });

  test("glossary lookup by key", async () => {
    const res = await req("/api/glossary/WACC", { headers: { cookie: aliceCookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).data.ko.length).toBeGreaterThan(0);
  });

  test("glossary lookup by Korean alias", async () => {
    const res = await req(`/api/glossary/${encodeURIComponent("표준화물선환산톤수")}`, { headers: { cookie: aliceCookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).data.key).toBe("CGT");
  });

  test("procedure resolve returns merged steps with source layers", async () => {
    const res = await req("/api/procedures/resolve?procedure=brownfield-screening", { headers: { cookie: aliceCookie } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.steps.length).toBeGreaterThan(0);
    expect(body.data).toHaveProperty("layersApplied");
  });

  test("an unknown procedure is 404", async () => {
    const res = await req("/api/procedures/resolve?procedure=no-such-proc", { headers: { cookie: aliceCookie } });
    expect(res.status).toBe(404);
  });
});

describe("watch and notifications", () => {
  test("a watch can be created on a visible project", async () => {
    const res = await req("/api/watch", {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ project_id: projectId, rules: [{ trigger_type: "rag_downgrade", channel: "in_app" }] }),
    });
    expect(res.status).toBe(201);
  });

  test("a watch cannot be created on an invisible project — never an existence oracle", async () => {
    const res = await req("/api/watch", { method: "POST", headers: { cookie: bobCookie }, body: JSON.stringify({ project_id: "01GHOSTPROJECT0000000000000000" }) });
    expect(res.status).toBe(404);
  });

  test("notifications endpoint responds", async () => {
    const res = await req("/api/notifications", { headers: { cookie: aliceCookie } });
    expect(res.status).toBe(200);
  });
});

describe("admin console", () => {
  test("user list carries no hash material", async () => {
    const res = await req("/api/admin/users", { headers: { cookie: rootCookie } });
    const users = (await res.json()).data;
    expect(users.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(users)).not.toContain("password");
  });

  test("a non-admin is refused admin routes", async () => {
    const res = await req("/api/admin/users", { headers: { cookie: aliceCookie } });
    expect(res.status).toBe(403);
  });

  test("audit log is readable", async () => {
    const res = await req("/api/admin/audit-log?limit=5", { headers: { cookie: rootCookie } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.length).toBeGreaterThan(0);
  });

  test("audit log has no delete route at any privilege level (FR-SEC-07)", async () => {
    const res = await req("/api/admin/audit-log", { method: "DELETE", headers: { cookie: rootCookie } });
    expect(res.status).toBe(404);
  });

  test("data-sources report presence only, never the key value", async () => {
    db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [ulid(), "DART", "A", NOW]);
    const res = await req("/api/admin/data-sources", { headers: { cookie: rootCookie } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data[0]).toHaveProperty("key_present");
    expect(body.data[0]).not.toHaveProperty("key_value");
  });

  test("retention policy can be upserted", async () => {
    const res = await req("/api/admin/retention", {
      method: "POST",
      headers: { cookie: rootCookie },
      body: JSON.stringify({ table_key: "simulation_draw", basis: "G5 capacity", retention_months: 6, action: "archive" }),
    });
    expect(res.status).toBe(201);
  });
});
