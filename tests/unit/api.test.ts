// @version 1.6.0
/**
 * API tests — exercising the real app/web-next Route Handlers via
 * nextRequest() against a scratch SQLite file (deleted after), not mocked
 * handlers. Every assertion here was first verified with a throwaway smoke
 * run before being encoded.
 *
 * ADR-0094 surface alignment: the project-keyed REST tree (/api/projects/**
 * plus /api/assumptions, /api/runs, /api/simulations, /api/watch, the
 * scorecard routes and the deal-review/PMI surfaces) was deliberately
 * deleted — the lifecycle is opportunity-keyed now (see
 * /api/opportunities/**). The describes exercising those routes were
 * removed with them. What survives here is the live surface's own guard
 * set: the auth/password lifecycle, bearer-token scopes, CSRF, the
 * must-change-password gate, glossary/procedure reads, the analysis series
 * catalog, the admin console's privilege split, and the role-gated
 * opportunity writes (the live analogue of the old deny-by-default suite).
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

// ADR-0069/0070 Phase 6 test port: nextRequest() dispatches to app/web-next's
// Next.js Route Handlers. See tests/unit/helpers/next-route-dispatch.ts.
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

const NOW = new Date().toISOString();

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
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

beforeAll(async () => {
  await createUser(db, { userId: "root", role: "admin", password: "pw-root-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "root", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "alice", role: "analyst", password: "pw-alice-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "alice", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "bob", role: "analyst", password: "pw-bob-123456", createdBy: "test", now: NOW });
  approveUser(db, { userId: "bob", approvedBy: "test", now: NOW });
  // createUser flags must_change_password=1 (the initial password is a
  // known value). These seeds use fixed credentials and the flag itself is
  // exercised separately in the must-change-password describe below —
  // clear it so the seeded sessions start unrestricted.
  db.run("UPDATE app_user SET must_change_password = 0");

  rootCookie = await loginCookie("root", "pw-root-12345");
  aliceCookie = await loginCookie("alice", "pw-alice-12345");
  bobCookie = await loginCookie("bob", "pw-bob-123456");
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

describe("bearer API tokens", () => {
  let readToken: string;

  test("a token is returned once, on issue", async () => {
    const res = await req("/api/tokens", { method: "POST", headers: { cookie: bobCookie }, body: JSON.stringify({ label: "mcp", scopes: ["read"] }) });
    const body = (await res.json()).data;
    expect(res.status).toBe(201);
    expect(body.token).toHaveLength(64);
    readToken = body.token;
  });

  test("a read-scoped token can read an authenticated surface", async () => {
    const res = await req("/api/series", { headers: { authorization: `Bearer ${readToken}` } });
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
    const res = await req("/api/series", { headers: { cookie: resetCookie } });
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

describe("glossary and procedures", () => {
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

describe("notifications", () => {
  test("notifications endpoint responds", async () => {
    const res = await req("/api/notifications", { headers: { cookie: aliceCookie } });
    expect(res.status).toBe(200);
  });
});

describe("analysis — series catalog, observations, changes (live 5.7B surface)", () => {
  const SERIES_ID = "TEST.SHIP.CGT";

  beforeAll(() => {
    const unitId = ulid();
    const sourceId = ulid();
    db.run("INSERT INTO md_unit (id, code, dimension, si_coefficient, created_at) VALUES (?,?,?,?,?)", [unitId, "TEST.UNIT", "dimensionless", 1, NOW]);
    db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [sourceId, "TESTSRC", "A", NOW]);
    for (const [periodId, fiscalYear] of [["2025", 2025], ["2026", 2026]] as const) {
      db.run("INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)", [periodId, "year", `${fiscalYear}-01-01`, `${fiscalYear}-12-31`, fiscalYear, NOW]);
    }
    for (const [periodId, revisionNo, value] of [["2025", 1, 100.0], ["2025", 2, 110.0], ["2026", 1, 120.0]] as const) {
      db.run(
        "INSERT INTO fact_market_observation (series_id, period_id, revision_no, value, unit_id, source_id, content_hash, fetched_at) VALUES (?,?,?,?,?,?,?,?)",
        [SERIES_ID, periodId, revisionNo, value, unitId, sourceId, `hash-${periodId}-${revisionNo}`, NOW],
      );
    }
    db.run("INSERT INTO data_change_log (id, series_id, detected_at, change_type, old_value, new_value) VALUES (?,?,?,?,?,?)", [ulid(), SERIES_ID, NOW, "revised", 100, 110]);
  });

  test("series catalog aggregates observations per series", async () => {
    const res = await req("/api/series", { headers: { cookie: aliceCookie } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.meta.count).toBe(1);
    expect(body.data[0]).toMatchObject({ series_id: SERIES_ID, observation_count: 3, min_period_id: "2025", max_period_id: "2026" });
  });

  test("?q= filters the catalog by substring", async () => {
    const res = await req("/api/series?q=nomatch", { headers: { cookie: aliceCookie } });
    expect((await res.json()).data).toHaveLength(0);
  });

  test("observations default to the latest revision per period", async () => {
    const res = await req(`/api/series/${SERIES_ID}/observations`, { headers: { cookie: aliceCookie } });
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data.find((r: { period_id: string }) => r.period_id === "2025")).toMatchObject({ revision_no: 2, value: 110 });
  });

  test("?all_revisions=1 returns every revision row", async () => {
    const res = await req(`/api/series/${SERIES_ID}/observations?all_revisions=1`, { headers: { cookie: aliceCookie } });
    expect((await res.json()).data).toHaveLength(3);
  });

  test("observations meta.source carries the shared source of the returned rows", async () => {
    const res = await req(`/api/series/${SERIES_ID}/observations`, { headers: { cookie: aliceCookie } });
    const body = await res.json();
    const expected = (db.query("SELECT source_id FROM fact_market_observation WHERE series_id = ? LIMIT 1").get(SERIES_ID) as { source_id: string }).source_id;
    expect(body.meta.source).toBe(expected);
  });

  test("data-changes scan returns the seeded revision", async () => {
    const res = await req(`/api/data-changes?series_id=${SERIES_ID}`, { headers: { cookie: aliceCookie } });
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ change_type: "revised", old_value: 100, new_value: 110 });
  });
});

describe("opportunities — role-gated writes over an open read surface (ADR-0094)", () => {
  // The S2 funnel is pre-project intelligence: every authenticated user can
  // read it; writes require analyst+. This is the live analogue of the old
  // project-surface deny-by-default suite — role separation (FR-SEC-02) now
  // lives here and in the admin console.
  let viewerCookie: string;

  beforeAll(async () => {
    await createUser(db, { userId: "dave", role: "viewer", password: "pw-dave-123456", createdBy: "test", now: NOW });
    approveUser(db, { userId: "dave", approvedBy: "test", now: NOW });
    // createUser flags must_change_password=1; clear it so the viewer session
    // exercises the role gates, not the change-password gate.
    db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id = 'dave'");
    viewerCookie = await loginCookie("dave", "pw-dave-123456");
  });

  test("unauthenticated reads are rejected", async () => {
    expect((await req("/api/opportunities")).status).toBe(401);
  });

  test("any authenticated role can read the funnel", async () => {
    expect((await req("/api/opportunities", { headers: { cookie: viewerCookie } })).status).toBe(200);
    expect((await req("/api/opportunities", { headers: { cookie: rootCookie } })).status).toBe(200);
  });

  test("a viewer cannot create an opportunity — 403 role gate", async () => {
    const res = await req("/api/opportunities", {
      method: "POST",
      headers: { cookie: viewerCookie },
      body: JSON.stringify({ name: "viewer attempt" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("role_required");
  });

  test("an analyst registers an opportunity; an invalid score is 400", async () => {
    const ok = await req("/api/opportunities", {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ name: "Marine crankshaft JV", status: "identified" }),
    });
    expect(ok.status).toBe(201);

    const bad = await req("/api/opportunities", {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ name: "bad score", attractiveness_score: 101 }),
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("invalid_request");
  });

  test("gate decisions carry the same viewer role gate", async () => {
    const oppId = ((await (await req("/api/opportunities", { headers: { cookie: aliceCookie } })).json()).data as { id: string }[])[0].id;
    const res = await req(`/api/opportunities/${oppId}/gate-decisions`, {
      method: "POST",
      headers: { cookie: viewerCookie },
      body: JSON.stringify({ gate: "screening", decision: "go", rationale: "viewer attempt" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("role_required");
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
    // 405, not 404 (ADR-0069/0070 Phase 6 port): Next.js's routing
    // convention for "this path exists but has no handler for this verb"
    // is 405 Method Not Allowed. Either status conveys FR-SEC-07's actual
    // guarantee identically — no DELETE capability exists on this path.
    expect(res.status).toBe(405);
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
