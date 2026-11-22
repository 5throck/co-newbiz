// @version 1.0.0
/**
 * F-11 (review 2026-11-22) — share-link MNPI gate. POST
 * /api/projects/[id]/share-links must refuse an mnpi_flag=1 project with
 * 403 mnpi_share_blocked (FR-SEC-06 / ADR-0040 / security-model §6): a share
 * link is unauthenticated external delivery (GET /api/share/[token]), so
 * MNPI never leaves through it. Non-flagged creation is byte-unchanged.
 *
 * Pre-fix behavior: the route checked role + visibility only, so an analyst
 * member of a flagged project could mint a public tokenized link to its
 * snapshot — the exact leak class the review flagged (flagged projects are
 * otherwise excluded from machine principals and banner-gated for members).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-share-mnpi.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { createProject } = await import("../../db/repositories/project.repository.ts");
const { grantProjectMembership, setMnpiFlag } = await import("../../db/lib/access-control.ts");
const { issueApiToken } = await import("../../db/lib/api-tokens.ts");

const NOW = "2026-11-22T00:00:00Z";
const USER = { userId: "sl-ana", password: "pw-sl-ana-123456" };

let cookie: string;
let bearer: string;
let mnpiId: string;
let plainId: string;

function shareLinkRows(projectId: string): unknown[] {
  return db.query("SELECT id FROM share_link WHERE project_id = ?").all(projectId) as unknown[];
}

function audits(action: string, projectId: string): unknown[] {
  // share_link.create target = `${projectId}:${linkId}` — prefix match.
  return db
    .query("SELECT target FROM audit_log WHERE action = ? AND target LIKE ?")
    .all(action, `${projectId}%`) as unknown[];
}

async function createLink(projectId: string, init?: RequestInit): Promise<Response> {
  return nextRequest(`/api/projects/${projectId}/share-links`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ title: "F-11 fixture", recipient: "partner@example.com", payload: { summary: "v" } }),
    ...init,
  });
}

beforeAll(async () => {
  await createUser(db, { userId: USER.userId, role: "analyst", password: USER.password, createdBy: "test", now: NOW });
  approveUser(db, { userId: USER.userId, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  bearer = issueApiToken(db, { userId: USER.userId, label: "sl-control", scopes: ["read", "write"], now: NOW }).token;

  plainId = createProject("NP-SL-PLAIN").id;
  grantProjectMembership(db, {
    projectId: plainId,
    userId: USER.userId,
    projectRole: "lead",
    grantedBy: "test",
    needToKnowBasis: "plain fixture",
    now: NOW,
  });

  mnpiId = createProject("NP-SL-MNPI").id;
  grantProjectMembership(db, {
    projectId: mnpiId,
    userId: USER.userId,
    projectRole: "lead",
    grantedBy: "test",
    needToKnowBasis: "mnpi fixture",
    now: NOW,
  });
  db.run(
    "INSERT INTO project_classification (project_id, sensitivity, mnpi_flag, classified_by, classified_at) VALUES (?,?,?,?,?)",
    [mnpiId, "restricted", 0, "test", NOW],
  );
  setMnpiFlag(db, { projectId: mnpiId, mnpiFlag: 1, setBy: USER.userId, reason: "F-11 fixture", now: NOW });

  const login = await nextRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ userId: USER.userId, password: USER.password }),
  });
  cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];
  expect(cookie).toContain("co_newbiz_session=");
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

describe("F-11 — share-link MNPI gate", () => {
  test("flagged project → 403 mnpi_share_blocked, no share_link row, no create audit", async () => {
    const res = await createLink(mnpiId);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("mnpi_share_blocked");
    expect(shareLinkRows(mnpiId)).toEqual([]);
    expect(audits("share_link.create", mnpiId)).toEqual([]);
  });

  test("non-flagged project → 201 unchanged, link + audit row land as before", async () => {
    const res = await createLink(plainId);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; token: string; expires_at: string } };
    expect(body.data.id.length).toBeGreaterThan(0);
    expect(body.data.token.length).toBeGreaterThan(0);
    expect(shareLinkRows(plainId)).toHaveLength(1);
    expect(audits("share_link.create", plainId)).toHaveLength(1);
  });

  test("the machine-principal layer already 404s flagged projects for bearer callers (FR-SYS-02) — the gate is defense in depth behind it", async () => {
    const res = await nextRequest(`/api/projects/${mnpiId}/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ title: "machine probe", recipient: "x@example.com", payload: {} }),
    });
    // F-2 wiring: visibleProject hides MNPI projects from bearer principals → 404, never 403/201.
    expect(res.status).toBe(404);
  });
});
