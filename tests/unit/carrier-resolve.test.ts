// @version 1.0.0
/**
 * D5 (B-2) — serverized CarrierGate auto-redirect resolution
 * (design 2026-11-11-admin-security-and-board-fixes §7).
 *
 * Three layers, matching the design's test plan:
 *   1. planCarrierPage — the rule ORDER (Rule 1 query carrier → Rule 3
 *      single-carrier auto) plus the client-side exemptions (?new=1,
 *      ?known_target=1) and the ?moved= / param-preservation contract.
 *   2. resolveCarriers — real scratch SQLite through the FULL migration
 *      chain: the exact production WHERE clauses (any-track reuses the
 *      opportunities GET query, track routes reuse the route_decision
 *      filters), so promoted-but-archived inclusion and genuine deletion
 *      exclusion are pinned, not assumed.
 *   3. Static page contract — the five flat shells must stay server
 *      components that redirect() (the whole point of D5: the redirect
 *      fires before any HTML is served); a stray "use client" would put
 *      the flash back.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-carrier-resolve.sqlite";
const NOW = "2026-11-11T00:00:00Z";
// CO_NEWBIZ_DB_PATH must be set BEFORE the db client module loads —
// db/client.ts resolves DEFAULT_DB_PATH at import time (review 2026-10-22 L3).
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { planCarrierPage, resolveCarriers, FLAT_ROUTE_STAGE } = await import(
  "../../app/web-next/lib/carrier-resolve.ts"
);
// CR-3 parity tests dispatch to the real Route Handlers (same scratch SQLite).
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
type ValidSession = import("../../db/lib/accounts.ts").ValidSession;

type Db = ReturnType<typeof getDb>;
let db: Db;

const NO_SESSION = null as null;
const SESSION: ValidSession = { userId: "u1", role: "analyst", mustChangePassword: false, sessionId: "s1" };

beforeAll(() => {
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);
}, 60000);

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

function insertOpp(over: { status?: string; deletedAt?: string | null; projectId?: string | null } = {}): string {
  const id = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, status, project_id, deleted_at, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
    [id, `opp-${id.slice(-6)}`, over.status ?? "selected", over.projectId ?? null, over.deletedAt ?? null, "test", NOW],
  );
  return id;
}

/** A real md_project row — opportunity.project_id carries an FK to it. */
function insertProjectFor(over: { projectId?: string | null } = {}): string {
  const id = over.projectId ?? ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `NP-${id.slice(-6)}`, NOW]);
  return id;
}

function insertRouteDecision(oppId: string, track: "greenfield" | "brownfield", isCurrent = true): void {
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), oppId, track, "test", "none", "test", NOW, isCurrent ? 1 : 0],
  );
}

describe("planCarrierPage — rule order and exemptions", () => {
  test("Rule 1: ?opportunity= redirects straight to the deal stage, other params preserved (even exemptions), no moved flag", () => {
    const plan = planCarrierPage({
      route: "market",
      query: { opportunity: "abc123", foo: "bar", new: "1" },
      session: NO_SESSION,
      resolve: () => {
        throw new Error("resolve must not run on a Rule 1 redirect");
      },
    });
    expect(plan).toEqual({ kind: "redirect", href: "/deals/abc123/s1?foo=bar&new=1" });
  });

  test("Rule 1: ?deal= is the alias, on every route, and wins its FLAT_ROUTE_STAGE stage", () => {
    for (const route of ["market", "opportunities", "synergy", "greenfield", "brownfield"] as const) {
      const plan = planCarrierPage({ route, query: { deal: "d9" }, session: NO_SESSION, resolve: () => [] });
      expect(plan).toEqual({ kind: "redirect", href: `/deals/d9/${FLAT_ROUTE_STAGE[route]}` });
    }
  });

  test("Rule 1 takes precedence over the exemptions (?deal= with known_target=1 still redirects, param preserved)", () => {
    const plan = planCarrierPage({
      route: "opportunities",
      query: { deal: "d1", known_target: "1" },
      session: NO_SESSION,
      resolve: () => [],
    });
    expect(plan).toEqual({ kind: "redirect", href: "/deals/d1/s2?known_target=1" });
  });

  test("Rule 3: valid session + exactly one carrier → redirect with moved=<route> appended", () => {
    const plan = planCarrierPage({
      route: "greenfield",
      query: { utm: "mail" },
      session: SESSION,
      resolve: () => [{ id: "gf1", name: "GF deal" }],
    });
    expect(plan).toEqual({ kind: "redirect", href: "/deals/gf1/s5?utm=mail&moved=greenfield" });
  });

  test("Rule 3: zero or many carriers → picker with the resolved rows passed through", () => {
    const zero = planCarrierPage({ route: "synergy", query: {}, session: SESSION, resolve: () => [] });
    expect(zero).toEqual({ kind: "picker", rows: [] });
    const many = planCarrierPage({
      route: "synergy",
      query: {},
      session: SESSION,
      resolve: () => [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
    });
    expect(many).toEqual({
      kind: "picker",
      rows: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
    });
  });

  test("Exemptions: ?new=1 short-circuits on market and opportunities (picker, resolve never runs)", () => {
    for (const route of ["market", "opportunities"] as const) {
      const plan = planCarrierPage({
        route,
        query: { new: "1" },
        session: SESSION,
        resolve: () => {
          throw new Error("resolve must not run on an exemption hit");
        },
      });
      expect(plan).toEqual({ kind: "picker", rows: null });
    }
  });

  test("Exemptions: ?known_target=1 short-circuits on opportunities only", () => {
    const plan = planCarrierPage({
      route: "opportunities",
      query: { known_target: "1" },
      session: SESSION,
      resolve: () => {
        throw new Error("resolve must not run on an exemption hit");
      },
    });
    expect(plan).toEqual({ kind: "picker", rows: null });
    // The same param elsewhere is NOT an exemption — auto-resolution applies.
    const elsewhere = planCarrierPage({
      route: "market",
      query: { known_target: "1" },
      session: null,
      resolve: () => [],
    });
    expect(elsewhere).toEqual({ kind: "picker", rows: null }); // session-less → picker regardless
  });

  test("No valid session → picker with rows=null; the server never resolves and never errors", () => {
    const plan = planCarrierPage({
      route: "market",
      query: {},
      session: null,
      resolve: () => {
        throw new Error("resolve must not run without a session");
      },
    });
    expect(plan).toEqual({ kind: "picker", rows: null });
  });
});

describe("resolveCarriers — production SQL parity (scratch SQLite)", () => {
  test("empty ledger → zero carriers", () => {
    expect(resolveCarriers("market", db)).toEqual([]);
  });

  test("any-track: selected + live → in; deleted without a project → out; deleted-but-promoted → in; non-selected → out", () => {
    const live = insertOpp();
    const deleted = insertOpp({ deletedAt: NOW });
    const projectId = insertProjectFor();
    const promotedArchived = insertOpp({ deletedAt: NOW, projectId });
    insertOpp({ status: "identified" });
    const rows = resolveCarriers("market", db).map((r) => r.id);
    expect(rows).toContain(live);
    expect(rows).not.toContain(deleted);
    expect(rows).toContain(promotedArchived);
  });

  test("track routes: only the route's track with an is_current decision, and deleted rows never resurface", () => {
    const gf = insertOpp();
    insertRouteDecision(gf, "greenfield");
    const bf = insertOpp();
    insertRouteDecision(bf, "brownfield");
    const staleBf = insertOpp();
    insertRouteDecision(staleBf, "brownfield", false); // superseded decision — not a carrier
    const deletedBf = insertOpp({ deletedAt: NOW });
    insertRouteDecision(deletedBf, "brownfield"); // deleted even with a current decision — excluded on track routes

    const gfIds = resolveCarriers("greenfield", db).map((r) => r.id);
    expect(gfIds).toEqual([gf]);
    const bfIds = resolveCarriers("brownfield", db).map((r) => r.id);
    expect(bfIds).toEqual([bf]);
  });

  test("rows carry id+name+score only — the picker surface, no ledger or membership fields", () => {
    const id = insertOpp();
    const row = resolveCarriers("synergy", db).find((r) => r.id === id);
    expect(row).toEqual({ id, name: `opp-${id.slice(-6)}`, attractiveness_score: null, synergy_score: null });
  });
});

describe("CR-1 (DEC-20261122-01) — admin role parity with the carrier APIs", () => {
  const ADMIN_SESSION: ValidSession = { userId: "root", role: "admin", mustChangePassword: false, sessionId: "sa" };

  test("an admin session never resolves server-side — picker rows=null, resolve never runs", () => {
    for (const route of ["market", "opportunities", "synergy", "greenfield", "brownfield"] as const) {
      const plan = planCarrierPage({
        route,
        query: {},
        session: ADMIN_SESSION,
        resolve: () => {
          throw new Error("resolve must not run for an admin session (CR-1, FR-SEC-02)");
        },
      });
      expect(plan).toEqual({ kind: "picker", rows: null });
    }
  });

  test("an admin session with a query carrier still redirects — Rule 1 carries no data access", () => {
    const plan = planCarrierPage({
      route: "market",
      query: { opportunity: "abc" },
      session: ADMIN_SESSION,
      resolve: () => [],
    });
    expect(plan).toEqual({ kind: "redirect", href: "/deals/abc/s1" });
  });

  test("viewer/analyst sessions are unaffected — resolution applies as before", () => {
    const viewer: ValidSession = { userId: "v1", role: "viewer", mustChangePassword: false, sessionId: "sv" };
    const plan = planCarrierPage({
      route: "market",
      query: {},
      session: viewer,
      resolve: () => [{ id: "x", name: "X" }],
    });
    expect(plan).toEqual({ kind: "redirect", href: "/deals/x/s1?moved=market" });
  });
});

describe("CR-3 (DEC-20261122-01) — resolveCarriers SQL predicate parity with the carrier APIs", () => {
  // Live dispatch to the real Route Handlers (same scratch SQLite) so any
  // predicate drift between the page query and the API query fails here
  // instead of diverging silently.

  const ANALYST = { userId: "car-ana", password: "pw-car-ana-12345" };
  const ADMIN = { userId: "car-admin", password: "pw-car-admin-1234" };
  let cookie: string;
  /** Row-set identity independent of tie order on equal created_at. */
  const sorted = (ids: string[]) => [...ids].sort();

  /** Distinct created_at per row — ORDER BY created_at DESC must then agree exactly. */
  let seq = 0;
  function seedOpp(
    over: {
      status?: string;
      deletedAt?: string | null;
      projectId?: string | null;
      track?: "greenfield" | "brownfield" | null;
    } = {},
  ): string {
    const id = ulid();
    const createdAt = new Date(Date.parse(NOW) + ++seq * 1000).toISOString();
    db.run(
      "INSERT INTO opportunity (id, name, status, project_id, deleted_at, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
      [
        id,
        `parity-${seq}`,
        over.status ?? "selected",
        over.projectId ?? null,
        over.deletedAt ?? null,
        "test",
        createdAt,
      ],
    );
    if (over.track) insertRouteDecision(id, over.track);
    return id;
  }

  beforeAll(async () => {
    await createUser(db, {
      userId: ANALYST.userId,
      role: "analyst",
      password: ANALYST.password,
      createdBy: "test",
      now: NOW,
    });
    approveUser(db, { userId: ANALYST.userId, approvedBy: "test", now: NOW });
    await createUser(db, {
      userId: ADMIN.userId,
      role: "admin",
      password: ADMIN.password,
      createdBy: "test",
      now: NOW,
    });
    approveUser(db, { userId: ADMIN.userId, approvedBy: "test", now: NOW });
    db.run("UPDATE app_user SET must_change_password = 0");
    const res = await nextRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId: ANALYST.userId, password: ANALYST.password }),
    });
    cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
    expect(cookie).toContain("co_newbiz_session=");
  });

  test("any-track: page rows are predicate-identical to GET /api/opportunities?status=selected&includePromoted=1", async () => {
    const live = seedOpp();
    const dropped = seedOpp({ status: "identified" });
    const deletedNoProject = seedOpp({ deletedAt: NOW });
    const projectId = insertProjectFor();
    const deletedButPromoted = seedOpp({ deletedAt: NOW, projectId });

    const res = await nextRequest("/api/opportunities?status=selected&includePromoted=1", { headers: { cookie } });
    expect(res.status).toBe(200);
    const apiRows = ((await res.json()) as { data: Array<{ id: string }> }).data.map((r) => r.id);
    // Parity: the page query returns the exact API row SET on the same ledger
    // (rows with a tied created_at — the fixtures above share one — have no
    // defined relative order across two differently-projected queries; the
    // ORDER BY predicate itself is pinned below via the distinct timestamps).
    for (const route of ["market", "opportunities", "synergy"] as const) {
      expect(sorted(resolveCarriers(route, db).map((r) => r.id))).toEqual(sorted(apiRows));
    }
    // ORDER BY created_at DESC parity: the two distinct-timestamp fixtures
    // (promoted-archived seeded after live) must come out newest-first on both sides.
    const pageRows = resolveCarriers("market", db).map((r) => r.id);
    expect(pageRows.indexOf(deletedButPromoted)).toBeLessThan(pageRows.indexOf(live));
    expect(apiRows.indexOf(deletedButPromoted)).toBeLessThan(apiRows.indexOf(live));
    // And the inclusion/exclusion semantics both sides must agree on:
    expect(apiRows).toContain(live);
    expect(apiRows).toContain(deletedButPromoted); // promoted-then-archived survives (includePromoted)
    expect(apiRows).not.toContain(deletedNoProject); // genuinely deleted never resurfaces
    expect(apiRows).not.toContain(dropped); // non-selected never enters
  });

  test("track routes: page rows are predicate-identical to GET /api/{greenfield,brownfield}", async () => {
    const gf = seedOpp({ track: "greenfield" });
    const bf = seedOpp({ track: "brownfield" });
    const staleBf = seedOpp({ track: "brownfield" });
    db.run("UPDATE route_decision SET is_current = 0 WHERE opportunity_id = ?", [staleBf]);

    for (const [route, apiPath] of [
      ["greenfield", "/api/greenfield"],
      ["brownfield", "/api/brownfield"],
    ] as const) {
      const res = await nextRequest(apiPath, { headers: { cookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { opportunities: Array<{ id: string }> } };
      const apiIds = body.data.opportunities.map((r) => r.id);
      // Parity: exact same row SET on both sides of the boundary (tied
      // created_at fixtures have no defined relative order across two
      // differently-projected queries — same rule as the any-track test).
      expect(sorted(resolveCarriers(route, db).map((r) => r.id))).toEqual(sorted(apiIds));
      // Semantics both sides agree on: the route's current-decision rows are in.
      expect(apiIds).toContain(route === "greenfield" ? gf : bf);
    }
    // A superseded (is_current=0) decision is not a carrier on EITHER side.
    const gfBody = (await (await nextRequest("/api/greenfield", { headers: { cookie } })).json()) as {
      data: { opportunities: Array<{ id: string }> };
    };
    expect(gfBody.data.opportunities.map((r) => r.id)).not.toContain(staleBf);
    expect(resolveCarriers("greenfield", db).map((r) => r.id)).not.toContain(staleBf);
  });

  test("role parity: the API denies admin with role_forbidden — the page answers by never resolving (CR-1)", async () => {
    const res = await nextRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId: ADMIN.userId, password: ADMIN.password }),
    });
    const adminCookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
    const apiRes = await nextRequest("/api/opportunities?status=selected&includePromoted=1", {
      headers: { cookie: adminCookie },
    });
    expect(apiRes.status).toBe(403);
    expect(((await apiRes.json()) as { error: { code: string } }).error.code).toBe("role_forbidden");
  });
});

describe("D5 static page contract — the five flat shells are server redirect shells", () => {
  const WEB = join(import.meta.dirname, "../../app/web-next");
  const routes = ["market", "opportunities", "synergy", "greenfield", "brownfield"] as const;

  for (const route of routes) {
    test(`/${route} redirects from the server (no "use client")`, () => {
      const src = readFileSync(join(WEB, `app/${route}/page.tsx`), "utf-8");
      expect(src).toContain('import { redirect } from "next/navigation"');
      expect(src).toContain("redirect(plan.href)");
      expect(src).not.toContain('"use client"');
      expect(src).toContain("planCarrierPage");
      expect(src).toContain("resolveCarriers");
      expect(src).toContain("getRscSession");
      expect(src).toContain("initialRows={plan.rows}");
    });
  }
});
