// @version 1.0.0
/**
 * F-2 live control test (review 2026-11-22, FR-SYS-02 / ADR-0040) — the MNPI
 * MCP default-exclusion exercised over the REAL in-process MCP/REST path,
 * mirroring tests/unit/mcp.test.ts's boot (Bun.serve on an ephemeral port
 * dispatching to app/web-next's Route Handlers; the MCP dispatch goes over
 * real HTTP with a real Bearer token; the "mcp" call path is entered through
 * the documented AsyncLocalStorage seam, principal-context.ts's
 * runAsPrincipal — the same scope InProcessRestPort enters for
 * OAuth-delegated calls).
 *
 * PRE-FIX BEHAVIOR (what this test would have caught): every production
 * call site passed excludeMnpi:false, so an MNPI-flagged project was served
 * to bearer/MCP principals in listing and detail responses with NO
 * mnpi_scope_override audit row — the exclusion existed only as repository
 * plumbing (listVisibleProjects' excludeMnpi option), never as a live
 * control. Control (a) below fails on that tree (flagged project present).
 *
 * Controls:
 *   (a) MNPI-flagged project is ABSENT from machine-principal listing and
 *       detail without an override — bearer REST (callPathOf "api"), the
 *       stdio MCP server's REST-client dispatch (also bearer), and the
 *       in-process MCP port path (callPathOf "mcp").
 *   (b) WITH the scoped override (GET /api/projects?include_mnpi=1) the
 *       flagged project is present, and every disclosed row fired the
 *       mnpi_scope_override audit row (FR-SEC-06) plus the data_access_log
 *       read row.
 *   (c) Web cookie sessions are unaffected — the member still sees the
 *       flagged project (MNPI banner posture, security-model §6), and the
 *       machine-only override param neither changes that nor fires audits.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "bun";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-mnpi-mcp.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextFetch } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { issueApiToken } = await import("../../db/lib/api-tokens.ts");
const { createProject, listVisibleProjects } = await import("../../db/repositories/project.repository.ts");
const { grantProjectMembership, setMnpiFlag } = await import("../../db/lib/access-control.ts");
const { runAsPrincipal } = await import("../../app/web-next/lib/mcp/principal-context.ts");
const { mnpiExclusionFor } = await import("../../app/web-next/lib/project-visibility.ts");

const NOW = "2026-11-22T00:00:00Z";
const USER = { userId: "mn-ana", password: "pw-mn-ana-12345" };

let server: Server<undefined>;
let baseUrl: string;
let bearer: string;
let cookie: string;
let mnpiProjectId: string;
let plainProjectId: string;

function auditRows(action: string): Array<{ actor_user_id: string; target: string }> {
  return db.query("SELECT actor_user_id, target FROM audit_log WHERE action = ?").all(action) as Array<{
    actor_user_id: string;
    target: string;
  }>;
}

async function listIdsViaBearer(query = ""): Promise<string[]> {
  const res = await fetch(`${baseUrl}/api/projects${query}`, { headers: { authorization: `Bearer ${bearer}` } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: Array<{ id: string }> };
  return body.data.map((r) => r.id);
}

beforeAll(async () => {
  server = Bun.serve({ port: 0, fetch: nextFetch });
  baseUrl = `http://localhost:${server.port}`;
  process.env.CO_NEWBIZ_API_BASE_URL = baseUrl;

  await createUser(db, { userId: USER.userId, role: "analyst", password: USER.password, createdBy: "test", now: NOW });
  approveUser(db, { userId: USER.userId, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");

  bearer = issueApiToken(db, { userId: USER.userId, label: "mnpi-control", scopes: ["read"], now: NOW }).token;
  process.env.CO_NEWBIZ_API_TOKEN = bearer;

  // Two member-visible projects, one flagged MNPI through the real flag path
  // (classification row first — setMnpiFlag enrolls the member on the insider
  // list and audits the flip).
  mnpiProjectId = createProject("NP-MNPI-CTRL").id;
  grantProjectMembership(db, {
    projectId: mnpiProjectId,
    userId: USER.userId,
    projectRole: "lead",
    grantedBy: "test",
    needToKnowBasis: "mnpi control fixture",
    now: NOW,
  });
  db.run(
    "INSERT INTO project_classification (project_id, sensitivity, mnpi_flag, classified_by, classified_at) VALUES (?,?,?,?,?)",
    [mnpiProjectId, "restricted", 0, "test", NOW],
  );
  setMnpiFlag(db, {
    projectId: mnpiProjectId,
    mnpiFlag: 1,
    setBy: USER.userId,
    reason: "F-2 control fixture",
    now: NOW,
  });
  plainProjectId = createProject("NP-PLAIN-CTRL").id;
  grantProjectMembership(db, {
    projectId: plainProjectId,
    userId: USER.userId,
    projectRole: "lead",
    grantedBy: "test",
    needToKnowBasis: "plain control fixture",
    now: NOW,
  });

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: USER.userId, password: USER.password }),
  });
  cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];
  expect(cookie).toContain("co_newbiz_session=");
});

afterAll(async () => {
  server.stop(true);
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

describe("(a) default exclusion — MNPI project absent from machine principals' listing/detail", () => {
  test("bearer REST listing omits the flagged project, keeps the plain one", async () => {
    const ids = await listIdsViaBearer();
    expect(ids).not.toContain(mnpiProjectId);
    expect(ids).toContain(plainProjectId);
  });

  test("the stdio MCP server's REST-client dispatch (bearer) gets 404 on the flagged project detail", async () => {
    const { dispatch } = await import("../../mcp/co-newbiz/index.ts");
    const flagged = (await dispatch("get_portfolio_scorecard", { projectId: mnpiProjectId })) as {
      error: { code: string } | null;
    };
    expect(flagged.error?.code).toBe("not_found");
    const plain = (await dispatch("get_portfolio_scorecard", { projectId: plainProjectId })) as {
      error: { code: string } | null;
    };
    expect(plain.error?.code).not.toBe("not_found");
  });

  test('the in-process MCP port path (callPathOf "mcp", runAsPrincipal) omits the flagged project from the listing', async () => {
    // The same AsyncLocalStorage scope InProcessRestPort enters for
    // OAuth-delegated MCP calls; inside it authenticate() takes the
    // delegated branch and callPathOf() reports "mcp".
    const ids = await runAsPrincipal(
      {
        userId: USER.userId,
        role: "analyst",
        scopes: ["read"],
        mustChangePassword: false,
        tokenId: "test-token",
        clientId: "mnpi-control-client",
      },
      async () => {
        const res = await fetch(`${baseUrl}/api/projects`, { headers: { authorization: `Bearer ${bearer}` } });
        expect(res.status).toBe(200);
        return ((await res.json()) as { data: Array<{ id: string }> }).data.map((r) => r.id);
      },
    );
    expect(ids).not.toContain(mnpiProjectId);
    expect(ids).toContain(plainProjectId);
    // No override was requested — no mnpi_scope_override row may exist yet.
    expect(auditRows("mnpi_scope_override")).toEqual([]);
  });

  test("the repository's own default is untouched — the helper derives exclusion from the principal", () => {
    // Direct cross-check of the same control at the helper every route now
    // runs through: the exclusion decision comes from the principal, not
    // from an option default.
    expect(
      mnpiExclusionFor({ via: "bearer", role: "analyst", userId: USER.userId } as Parameters<
        typeof mnpiExclusionFor
      >[0]).excludeMnpi,
    ).toBe(true);
    expect(
      mnpiExclusionFor({ via: "cookie", role: "analyst", userId: USER.userId } as Parameters<
        typeof mnpiExclusionFor
      >[0]).excludeMnpi,
    ).toBe(false);
    expect(listVisibleProjects(USER.userId, { excludeMnpi: true }).some((p) => p.id === mnpiProjectId)).toBe(false);
    expect(listVisibleProjects(USER.userId, { excludeMnpi: false }).some((p) => p.id === mnpiProjectId)).toBe(true);
  });
});

describe("(b) scoped override — explicit, audited, machine-only", () => {
  test("?include_mnpi=1 discloses the flagged project to the bearer principal and fires mnpi_scope_override per row", async () => {
    const before = auditRows("mnpi_scope_override").length;
    const ids = await listIdsViaBearer("?include_mnpi=1");
    expect(ids).toContain(mnpiProjectId);
    expect(ids).toContain(plainProjectId);

    const rows = auditRows("mnpi_scope_override");
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1)).toEqual({ actor_user_id: USER.userId, target: mnpiProjectId });
    // FR-SEC-06: the disclosure is also a logged data access.
    const reads = db
      .query("SELECT user_id, project_id, action FROM data_access_log WHERE project_id = ? AND action = 'read'")
      .all(mnpiProjectId) as Array<{ user_id: string; project_id: string; action: string }>;
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.at(-1)?.user_id).toBe(USER.userId);
  });
});

describe("(c) web sessions unchanged", () => {
  test("the cookie-session member still sees the flagged project in the listing (banner posture)", async () => {
    const res = await fetch(`${baseUrl}/api/projects`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as { data: Array<{ id: string }> }).data.map((r) => r.id);
    expect(ids).toContain(mnpiProjectId);
    expect(ids).toContain(plainProjectId);
  });

  test("the override param is machine-only — a cookie request carrying it is ignored and fires no audit", async () => {
    const before = auditRows("mnpi_scope_override").length;
    const res = await fetch(`${baseUrl}/api/projects?include_mnpi=1`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as { data: Array<{ id: string }> }).data.map((r) => r.id);
    expect(ids).toContain(mnpiProjectId); // visible anyway — membership, not the param
    expect(auditRows("mnpi_scope_override").length).toBe(before); // no override fired
  });
});
