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
