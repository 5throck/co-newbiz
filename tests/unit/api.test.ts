// @version 1.5.0
/**
 * Wave 5.6A API tests — docs/api-spec.md, exercising the real Hono app via
 * app.request() against a scratch SQLite file (deleted after), not mocked
 * handlers. Every assertion here was first verified with a throwaway smoke
 * run (bun smoke.api.ts, now removed) before being encoded. Wave 5.7B
 * added the analysis/deal-review suites; the engine-1 wave added the
 * runs/versioning suite; engine-2 added the simulations suite, whose POST
 * tests spawn the real python engine (same discipline as simulate.test.ts);
 * the badge/provenance wave added the list-card enrichment + envelope
 * provenance suite (rag_overall list fields, observations meta.source,
 * dd-finding run linkage); the ADR-0059 E.4 wave added the scorecard
 * routes suite (portfolio rollup scope honesty, per-project reads, MNPI
 * inclusion).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

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
const { grantProjectMembership, setMnpiFlag } = await import("../../db/lib/access-control.ts");
const { recordVentureScorecardCycle } = await import("../../db/repositories/venture-scorecard.repository.ts");
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

// Wave 5.7B fixtures — dave (viewer, non-member) exercises the 404 side of
// the membership gate; erin (viewer, member) exercises the 403 role gate.
let daveCookie: string;
let erinCookie: string;
const SERIES_ID = "TEST.SHIP.CGT";
let analysisRunId: string;

describe("analysis — series, observations, changes, assumptions (Wave 5.7B)", () => {
  beforeAll(async () => {
    await createUser(db, { userId: "dave", role: "viewer", password: "pw-dave-123456", createdBy: "test", now: NOW });
    approveUser(db, { userId: "dave", approvedBy: "test", now: NOW });
    await createUser(db, { userId: "erin", role: "viewer", password: "pw-erin-123456", createdBy: "test", now: NOW });
    approveUser(db, { userId: "erin", approvedBy: "test", now: NOW });
    daveCookie = await loginCookie("dave", "pw-dave-123456");
    erinCookie = await loginCookie("erin", "pw-erin-123456");
    grantProjectMembership(db, { projectId, userId: "erin", projectRole: "observer", grantedBy: "alice", needToKnowBasis: "5.7B viewer role-gate test", now: NOW });

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

    analysisRunId = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [analysisRunId, projectId, "5.7B test", "cafebabe", "alice", NOW]);
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

  test("data-changes scan returns the seeded revision", async () => {
    const res = await req(`/api/data-changes?series_id=${SERIES_ID}`, { headers: { cookie: aliceCookie } });
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ change_type: "revised", old_value: 100, new_value: 110 });
  });

  test("assumption write lands for an analyst member", async () => {
    const res = await req("/api/assumptions", {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ run_id: analysisRunId, assumption_key: "test.wacc", kind: "live", value: 0.08, as_of: "2026-08-21" }),
    });
    expect(res.status).toBe(201);
    const read = await req(`/api/assumptions?run_id=${analysisRunId}&key=test.wacc`, { headers: { cookie: aliceCookie } });
    expect((await read.json()).data).toHaveLength(1);
  });

  test("kind='assumed' without rationale is 400 (FR-DATA-07)", async () => {
    const res = await req("/api/assumptions", {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ run_id: analysisRunId, assumption_key: "test.churn", kind: "assumed", value: 0.12, as_of: "2026-08-21" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("rationale_required");
  });

  test("a viewer member cannot write assumptions — 403 role gate", async () => {
    const res = await req("/api/assumptions", {
      method: "POST",
      headers: { cookie: erinCookie },
      body: JSON.stringify({ run_id: analysisRunId, assumption_key: "test.churn", kind: "assumed", value: 0.12, as_of: "2026-08-21", rationale: "x" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("role_required");
  });

  test("run-scoped assumption read is 404 for a non-member — existence protected", async () => {
    const res = await req(`/api/assumptions?run_id=${analysisRunId}`, { headers: { cookie: daveCookie } });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});

describe("deal review — membership-gated reads and audited writes (Wave 5.7B)", () => {
  let permitA: string;
  let permitB: string;
  let permitC: string;
  let certX: string;
  let certY: string;

  beforeAll(() => {
    db.run("INSERT INTO dd_finding (id, project_id, category, description, value_impact, created_at) VALUES (?,?,?,?,?,?)", [ulid(), projectId, "commercial", "Customer concentration 42% of revenue", -1.2, NOW]);
    db.run(
      "INSERT INTO dd_finding (id, project_id, category, description, trl_grade, parent_relationship_json, rbd_source, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), projectId, "rbd", "Crankshaft coating process", "TRL6", '{"parent":"HD","spinout":false}', "internal_only", NOW],
    );

    permitA = ulid();
    permitB = ulid();
    permitC = ulid();
    for (const [id, name, days] of [[permitA, "Factory establishment permit", 30], [permitB, "Emissions approval", 60], [permitC, "Fire safety inspection", 90]] as const) {
      db.run("INSERT INTO permit (id, project_id, name, agency, statutory_days, status) VALUES (?,?,?,?,?,?)", [id, projectId, name, "MOIS", days, "not_started"]);
    }
    db.run("INSERT INTO permit_edge (from_permit_id, to_permit_id) VALUES (?,?)", [permitA, permitB]);
    db.run("INSERT INTO permit_edge (from_permit_id, to_permit_id) VALUES (?,?)", [permitB, permitC]);

    certX = ulid();
    certY = ulid();
    for (const [id, name, days] of [[certX, "Type approval", 40], [certY, "Class society certification", 120]] as const) {
      db.run("INSERT INTO certification (id, project_id, name, agency, statutory_days, status) VALUES (?,?,?,?,?,?)", [id, projectId, name, "KR", days, "not_started"]);
    }
    db.run("INSERT INTO certification_edge (from_certification_id, to_certification_id) VALUES (?,?)", [certX, certY]);

    db.run(
      "INSERT INTO debt_instrument (id, project_id, lender, principal, rate_type, rate) VALUES (?,?,?,?,?,?)",
      [ulid(), projectId, "KB", 50_000, "fixed", 3.5],
    );
    db.run(
      "INSERT INTO contingent_liability (id, project_id, category, description, probability, amount_low, amount_expected, amount_high, expected_timing_year) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), projectId, "litigation", "Patent suit", 0.3, 1000, 2000, 4000, 1],
    );
    const simRunId = ulid();
    const simId = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [simRunId, projectId, "5.7B sim", "seeded", "alice", NOW]);
    db.run("INSERT INTO simulation (id, run_id, seed, iterations, discount_rate, created_at) VALUES (?,?,?,?,?,?)", [simId, simRunId, 42, 1000, 0.08, NOW]);
    db.run(
      "INSERT INTO covenant_test (simulation_id, period_id, covenant_key, threshold, projected_value, breached) VALUES (?,?,?,?,?,?)",
      [simId, "2027", "debt_ebitda", 3.5, 2.8, 1],
    );

    for (const [name, rank] of [["Ulsan", 2], ["Changwon", 1], ["Pohang", null]] as const) {
      db.run("INSERT INTO site_candidate (id, project_id, name, rank) VALUES (?,?,?,?)", [ulid(), projectId, name, rank]);
    }
    db.run("INSERT INTO partner_candidate (id, project_id, name, partner_type) VALUES (?,?,?,?)", [ulid(), projectId, "Acme Marine", "supplier"]);
    db.run(
      "INSERT INTO antitrust_finding (id, project_id, market_definition, hhi_before, hhi_after, remedy_type, created_at) VALUES (?,?,?,?,?,?,?)",
      [ulid(), projectId, "KR marine crankshaft", 1200, 1650, "none", NOW],
    );
    db.run("INSERT INTO incentive (id, project_id, direction, type, status) VALUES (?,?,?,?,?)", [ulid(), projectId, "prospective", "cash_grant", "prospective"]);
    db.run("INSERT INTO incentive (id, project_id, direction, type, status) VALUES (?,?,?,?,?)", [ulid(), projectId, "granted", "tax_credit", "granted"]);

    const fromIndustry = ulid();
    const toIndustry = ulid();
    db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [fromIndustry, "30110", "선박용 엔진", "Marine engines", NOW]);
    db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [toIndustry, "30111", "조선업", "Shipbuilding", NOW]);
    db.run(
      "INSERT INTO value_chain_link (id, project_id, from_industry_id, to_industry_id, direction, assessed_at) VALUES (?,?,?,?,?,?)",
      [ulid(), projectId, fromIndustry, toIndustry, "upstream", NOW],
    );
  });

  test("dd-findings list with count meta", async () => {
    const res = await req(`/api/projects/${projectId}/dd-findings`, { headers: { cookie: aliceCookie } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.meta.count).toBe(2);
  });

  test("?category=rbd filters to the R&BD row", async () => {
    const res = await req(`/api/projects/${projectId}/dd-findings?category=rbd`, { headers: { cookie: aliceCookie } });
    const body = await res.json();
    expect(body.meta.count).toBe(1);
    expect(body.data[0].rbd_source).toBe("internal_only");
  });

  test("dd-findings are invisible to a non-member — 404, not 403", async () => {
    const res = await req(`/api/projects/${projectId}/dd-findings`, { headers: { cookie: daveCookie } });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  test("dd-finding POST lands for an analyst member", async () => {
    const res = await req(`/api/projects/${projectId}/dd-findings`, {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ category: "legal", description: "Pending arbitration", value_impact: -0.4 }),
    });
    expect(res.status).toBe(201);
  });

  test("category='rbd' without rbd_source is 400 before the DB CHECK", async () => {
    const res = await req(`/api/projects/${projectId}/dd-findings`, {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ category: "rbd", description: "Missing provenance" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("rbd_source_required");
  });

  test("a viewer member cannot record findings — 403 role gate", async () => {
    const res = await req(`/api/projects/${projectId}/dd-findings`, {
      method: "POST",
      headers: { cookie: erinCookie },
      body: JSON.stringify({ category: "legal", description: "x" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("role_required");
  });

  test("permits default response is flat — parallel lists, no dag", async () => {
    const res = await req(`/api/projects/${projectId}/permits`, { headers: { cookie: aliceCookie } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.permits).toHaveLength(3);
    expect(body.data.certifications).toHaveLength(2);
    expect(body.data).not.toHaveProperty("dag");
  });

  test("?include_dag=1 adds edges and the statutory-days critical path for both kinds", async () => {
    const res = await req(`/api/projects/${projectId}/permits?include_dag=1`, { headers: { cookie: aliceCookie } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.dag.permit_edges).toHaveLength(2);
    expect(body.data.dag.permit_critical_path).toEqual([permitA, permitB, permitC]);
    expect(body.data.dag.certification_edges).toHaveLength(1);
    expect(body.data.dag.certification_critical_path).toEqual([certX, certY]);
  });

  test("liabilities combines debt, contingencies and the latest simulation's covenant tests", async () => {
    const res = await req(`/api/projects/${projectId}/liabilities`, { headers: { cookie: aliceCookie } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.debt_instruments).toHaveLength(1);
    expect(body.data.contingent_liabilities).toHaveLength(1);
    expect(body.data.covenant_tests).toHaveLength(1);
    expect(body.data.covenant_tests[0]).toMatchObject({ covenant_key: "debt_ebitda", breached: 1 });
    expect(typeof body.meta.simulation_id).toBe("string");
  });

  test("sites order rank-first, nulls last", async () => {
    const res = await req(`/api/projects/${projectId}/sites`, { headers: { cookie: aliceCookie } });
    const names = (await res.json()).data.map((s: { name: string }) => s.name);
    expect(names).toEqual(["Changwon", "Ulsan", "Pohang"]);
  });

  test("value-chain links carry industry names on both ends", async () => {
    const res = await req(`/api/projects/${projectId}/value-chain-links`, { headers: { cookie: aliceCookie } });
    const rows = (await res.json()).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ from_industry_en: "Marine engines", to_industry_en: "Shipbuilding" });
  });

  test("antitrust / incentives / partners respond for a member, with direction counts", async () => {
    const antitrust = await req(`/api/projects/${projectId}/antitrust`, { headers: { cookie: aliceCookie } });
    expect((await antitrust.json()).data).toHaveLength(1);
    const incentives = await req(`/api/projects/${projectId}/incentives`, { headers: { cookie: aliceCookie } });
    const incentiveBody = await incentives.json();
    expect(incentiveBody.data).toHaveLength(2);
    expect(incentiveBody.meta).toMatchObject({ prospective: 1, granted: 1 });
    const partners = await req(`/api/projects/${projectId}/partners`, { headers: { cookie: aliceCookie } });
    expect((await partners.json()).data).toHaveLength(1);
  });
});

// Backend badge/provenance wave: GET /api/projects list-row enrichment
// (rag_overall/rag_assessed_at — stale deliberately omitted, no honest
// per-project freshness signal exists) and FR-SYS-03 meta provenance on
// observations/dd-findings. projectId is MNPI-classified by now, so list
// reads go through ?include_mnpi=1.
describe("list-card enrichment and envelope provenance", () => {
  let plainProjectId: string;
  let mixedSeriesId: string;

  beforeAll(async () => {
    // Two overall rows on the main project — the later one must win.
    const runId = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [runId, projectId, "badge test", "baadf00d", "alice", NOW]);
    db.run(
      "INSERT INTO rag_assessment (id, run_id, project_id, dimension, grade, rationale, assessed_at) VALUES (?,?,?,?,?,?,?)",
      [ulid(), runId, projectId, "overall", "amber", "earlier partial assessment", "2026-01-01T00:00:00.000Z"],
    );
    db.run(
      "INSERT INTO rag_assessment (id, run_id, project_id, dimension, grade, rationale, assessed_at) VALUES (?,?,?,?,?,?,?)",
      [ulid(), runId, projectId, "overall", "green", "later complete assessment", "2026-02-01T00:00:00.000Z"],
    );

    // A fresh project with no assessments — its rows must stay unenriched.
    const res = await req("/api/projects", {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ project_no: "NP-2026-901" }),
    });
    plainProjectId = (await res.json()).data.id;

    // A series whose periods trace to two different sources — the shared-
    // source meta rule must decline to pick one.
    const unit = db.query("SELECT unit_id FROM fact_market_observation WHERE series_id = ? LIMIT 1").get(SERIES_ID) as { unit_id: string };
    const sourceA = ulid();
    const sourceB = ulid();
    db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [sourceA, "MIXSRCA", "A", NOW]);
    db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [sourceB, "MIXSRCB", "B", NOW]);
    mixedSeriesId = "TEST.SHIP.MIX";
    for (const [periodId, source] of [["2025", sourceA], ["2026", sourceB]] as const) {
      db.run(
        "INSERT INTO fact_market_observation (series_id, period_id, revision_no, value, unit_id, source_id, content_hash, fetched_at) VALUES (?,?,?,?,?,?,?,?)",
        [mixedSeriesId, periodId, 1, 100.0, unit.unit_id, source, `hash-mix-${periodId}`, NOW],
      );
    }

    // A newer registry row for test.wacc — dd-finding provenance must link
    // to the LATEST row for the key, not the first.
    const newerRun = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [newerRun, projectId, "wacc v2", "wacc2", "alice", NOW]);
    db.run(
      "INSERT INTO assumption (id, run_id, assumption_key, kind, value, anchor_ref, as_of) VALUES (?,?,?,?,?,?,?)",
      [ulid(), newerRun, "test.wacc", "user", 0.07, "FS§5.2", "2026-08-22"],
    );
  });

  test("list rows carry the latest overall grade and its timestamp", async () => {
    const res = await req("/api/projects?include_mnpi=1", { headers: { cookie: aliceCookie } });
    const row = (await res.json()).data.find((p: { id: string }) => p.id === projectId);
    expect(row).toMatchObject({ rag_overall: "green", rag_assessed_at: "2026-02-01T00:00:00.000Z" });
  });

  test("rows without an overall assessment carry no badge fields — absence is meaningful", async () => {
    const res = await req("/api/projects?include_mnpi=1", { headers: { cookie: aliceCookie } });
    const row = (await res.json()).data.find((p: { id: string }) => p.id === plainProjectId);
    expect(row).toBeDefined();
    expect("rag_overall" in row).toBe(false);
    expect("rag_assessed_at" in row).toBe(false);
    // No honest per-project freshness signal exists (observations carry no
    // project binding), so the server never emits a fabricated one.
    expect("stale" in row).toBe(false);
  });

  test("observations meta.source carries the shared source of the returned rows", async () => {
    const res = await req(`/api/series/${SERIES_ID}/observations`, { headers: { cookie: aliceCookie } });
    const body = await res.json();
    const expected = (db.query("SELECT source_id FROM fact_market_observation WHERE series_id = ? LIMIT 1").get(SERIES_ID) as { source_id: string }).source_id;
    expect(body.meta.source).toBe(expected);
  });

  test("observations with mixed sources omit meta.source — provenance stays per-row", async () => {
    const res = await req(`/api/series/${mixedSeriesId}/observations`, { headers: { cookie: aliceCookie } });
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(new Set(body.data.map((r: { source_id: string }) => r.source_id)).size).toBe(2);
    expect("source" in body.meta).toBe(false);
  });

  test("dd-finding POST meta links the assumption key to its latest registry row", async () => {
    const res = await req(`/api/projects/${projectId}/dd-findings`, {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ category: "financial_model", description: "WACC sensitivity", value_impact: -0.3, assumption_key: "test.wacc" }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    const newerRun = db
      .query("SELECT run_id FROM assumption WHERE assumption_key = ? ORDER BY as_of DESC, id DESC LIMIT 1")
      .get("test.wacc") as { run_id: string };
    expect(body.meta).toMatchObject({ assumption_key: "test.wacc", run_id: newerRun.run_id, anchor_ref: "FS§5.2" });
  });

  test("dd-finding POST echoes an unregistered key without inventing a run linkage", async () => {
    const res = await req(`/api/projects/${projectId}/dd-findings`, {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ category: "legal", description: "Unregistered key probe", assumption_key: "test.no-registry" }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.meta.assumption_key).toBe("test.no-registry");
    expect("run_id" in body.meta).toBe(false);
  });

  test("dd-finding POST without an assumption key carries no provenance meta", async () => {
    const res = await req(`/api/projects/${projectId}/dd-findings`, {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ category: "commercial", description: "No provenance fields" }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect("assumption_key" in body.meta).toBe(false);
    expect("run_id" in body.meta).toBe(false);
    expect("anchor_ref" in body.meta).toBe(false);
  });
});

describe("runs — versioned input snapshots (Wave engine-1)", () => {
  // Seed source runs with strictly increasing created_at. Note the main
  // project already holds analysisRunId (created at wall-clock NOW, later
  // than these seeds) — so the latest-run DEFAULT is exercised on
  // NP-2026-102, which has exactly one prior run, not here.
  const T1 = "2026-01-01T00:00:00.000Z";
  const T2 = "2026-01-02T00:00:00.000Z";
  let seedRunA: string;
  let seedRunB: string;
  let createdRun: string;
  let v2Run: string;
  let otherProjectId: string;
  let otherProjectRun: string;

  beforeAll(async () => {
    seedRunA = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [seedRunA, projectId, "seed A", "hash-a", "alice", T1]);
    db.run("INSERT INTO run_input (run_id, assumption_key, value) VALUES (?,?,?)", [seedRunA, "run.wacc", 0.08]);
    seedRunB = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [seedRunB, projectId, "seed B", "hash-b", "alice", T2]);
    db.run("INSERT INTO run_input (run_id, assumption_key, value) VALUES (?,?,?)", [seedRunB, "run.wacc", 0.08]);
    db.run("INSERT INTO run_input (run_id, assumption_key, value) VALUES (?,?,?)", [seedRunB, "run.growth", 0.03]);

    const res = await req("/api/projects", {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ project_no: "NP-2026-102" }),
    });
    otherProjectId = (await res.json()).data.id;
    otherProjectRun = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [otherProjectRun, otherProjectId, "other project", "hash-o", "alice", T2]);
    db.run("INSERT INTO run_input (run_id, assumption_key, value) VALUES (?,?,?)", [otherProjectRun, "o.x", 7]);
  });

  test("POST with from_run_id copies that snapshot and layers overrides on top", async () => {
    const res = await req(`/api/projects/${projectId}/runs`, {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ label: "v1 Pre-FS", from_run_id: seedRunB, set: { "run.tax": 0.25 } }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.from_run_id).toBe(seedRunB);
    expect(body.data.input_count).toBe(3); // wacc + growth copied, tax added
    createdRun = body.data.run_id;
    expect(body.data.input_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("POST without from_run_id defaults to the project's latest run", async () => {
    // NP-2026-102 has exactly one prior run (otherProjectRun), so the
    // latest-run default is deterministic here.
    const res = await req(`/api/projects/${otherProjectId}/runs`, {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ label: "first by default", set: { "o.y": 1 } }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.from_run_id).toBe(otherProjectRun);
    expect(body.data.input_count).toBe(2); // o.x copied, o.y added
  });

  test("GET run detail returns the run row and its sorted input snapshot", async () => {
    const res = await req(`/api/runs/${createdRun}`, { headers: { cookie: aliceCookie } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.meta.input_count).toBe(3);
    expect(body.data.run.id).toBe(createdRun);
    expect(body.data.inputs.map((i: { assumption_key: string }) => i.assumption_key)).toEqual(["run.growth", "run.tax", "run.wacc"]);
  });

  test("POST from an explicitly named earlier run snapshots that run, not the latest", async () => {
    const res = await req(`/api/projects/${projectId}/runs`, {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ label: "v2 sensitivity", from_run_id: seedRunA, set: { "run.wacc": 0.09 } }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.from_run_id).toBe(seedRunA);
    expect(body.data.input_count).toBe(1);
    v2Run = body.data.run_id;
  });

  test("runs list is newest first with per-run input counts", async () => {
    const res = await req(`/api/projects/${projectId}/runs`, { headers: { cookie: aliceCookie } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.meta.count).toBeGreaterThanOrEqual(5); // analysisRunId + 2 seeds + 2 created
    expect(body.data[0].id).toBe(v2Run); // created last (wall clock > T2 seeds)
    expect(body.data.find((r: { id: string }) => r.id === createdRun).input_count).toBe(3);
  });

  test("diff returns the variable-level bridge between two runs", async () => {
    const res = await req(`/api/runs/${createdRun}/diff/${v2Run}`, { headers: { cookie: aliceCookie } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.changed).toHaveLength(1);
    expect(body.data.changed[0]).toMatchObject({ key: "run.wacc", from: 0.08, to: 0.09 });
    expect(body.data.removed.map((r: { key: string }) => r.key)).toEqual(["run.growth", "run.tax"]);
    expect(body.data.added).toEqual([]);
    expect(typeof body.data.input_hash_a).toBe("string");
  });

  test("POST without a label is 400", async () => {
    const res = await req(`/api/projects/${projectId}/runs`, {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ set: { x: 1 } }),
    });
    expect(res.status).toBe(400);
  });

  test("a from_run_id from another project is 400 — version chains stay in one project", async () => {
    const res = await req(`/api/projects/${projectId}/runs`, {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ label: "bad chain", from_run_id: otherProjectRun }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("run_rejected");
  });

  test("diffing runs from different projects is 400", async () => {
    const res = await req(`/api/runs/${createdRun}/diff/${otherProjectRun}`, { headers: { cookie: aliceCookie } });
    expect(res.status).toBe(400);
  });

  test("a viewer member cannot create runs — 403 role gate", async () => {
    const res = await req(`/api/projects/${projectId}/runs`, {
      method: "POST",
      headers: { cookie: erinCookie },
      body: JSON.stringify({ label: "viewer attempt" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("role_required");
  });

  test("a non-member cannot list runs — 404, existence protected", async () => {
    const res = await req(`/api/projects/${projectId}/runs`, { headers: { cookie: daveCookie } });
    expect(res.status).toBe(404);
  });

  test("run detail is 404 for a non-member", async () => {
    const res = await req(`/api/runs/${createdRun}`, { headers: { cookie: daveCookie } });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});

describe("simulations — Monte Carlo engine over REST (Wave engine-2)", () => {
  // NP-2026-103 carries NO contingent_liability rows and its run holds
  // exactly the simulation-no-liabilities.json inputs, so a POST with the
  // fixture's seed/iterations must reproduce the fixture's quantiles —
  // REST and CLI hit the same engine (design §12 verification item 13).
  // The "no sim inputs" run is created FIRST (empty snapshot — the
  // project has no prior run); "sim v1" then layers the six sim.* keys on
  // top of that empty copy.
  let simRunId: string;
  let noSimInputsRunId: string;
  let createdSimId: string;
  let fixture: { base_npv: number; p05: number; p50: number; p95: number; mean: number; std: number };

  beforeAll(async () => {
    const res = await req("/api/projects", {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ project_no: "NP-2026-103" }),
    });
    const simProjectId = (await res.json()).data.id;
    // erin joins as observer so the viewer role gate fires after the
    // membership check passes (dave stays out entirely for the 404 side).
    grantProjectMembership(db, { projectId: simProjectId, userId: "erin", projectRole: "observer", grantedBy: "alice", needToKnowBasis: "engine-2 viewer role-gate test", now: NOW });

    const emptyRes = await req(`/api/projects/${simProjectId}/runs`, {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ label: "no sim inputs" }),
    });
    noSimInputsRunId = (await emptyRes.json()).data.run_id;

    const runRes = await req(`/api/projects/${simProjectId}/runs`, {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({
        label: "sim v1",
        set: { "sim.discount_rate": 0.1, "sim.cf1": 100, "sim.cf2": 110, "sim.cf3": 120, "sim.cf4": 130, "sim.cf5": 140 },
      }),
    });
    simRunId = (await runRes.json()).data.run_id;

    const { runSimulation } = await import("../../scripts/co-newbiz/simulate.ts");
    fixture = await runSimulation(resolve(import.meta.dirname, "..", "fixtures", "simulation-no-liabilities.json"));
  });

  test("POST runs the engine and reproduces the CLI fixture's quantiles (same seed + inputs)", async () => {
    const res = await req("/api/simulations", {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ run_id: simRunId, seed: 42, iterations: 5000 }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.run_id).toBe(simRunId);
    expect(body.data.seed).toBe(42);
    expect(body.data.iterations).toBe(5000);
    expect(body.data.discount_rate).toBe(0.1);
    expect(body.data.contingent_liability_count).toBe(0);
    expect(body.data.simulation_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    for (const key of ["base_npv", "p05", "p50", "p95", "mean", "std"] as const) {
      expect(body.data[key]).toBe(fixture[key]);
    }
    createdSimId = body.data.simulation_id;
  });

  test("the same seed twice reproduces identical quantiles", async () => {
    const posts: number[][] = [];
    for (let i = 0; i < 2; i++) {
      const res = await req("/api/simulations", {
        method: "POST",
        headers: { cookie: aliceCookie },
        body: JSON.stringify({ run_id: simRunId, seed: 7, iterations: 500 }),
      });
      expect(res.status).toBe(201);
      const d = (await res.json()).data;
      posts.push([d.p05, d.p50, d.p95, d.mean, d.std]);
    }
    expect(posts[0]).toEqual(posts[1]);
  });

  test("GET results returns the quantile summary only — never raw draws", async () => {
    const res = await req(`/api/simulations/${createdSimId}/results`, { headers: { cookie: aliceCookie } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.simulation).toMatchObject({ id: createdSimId, run_id: simRunId, seed: 42, iterations: 5000 });
    expect(body.data.simulation).not.toHaveProperty("project_id"); // internal join column, not part of the contract
    expect(body.data.results).toEqual([
      { metric: "npv", p05: fixture.p05, p50: fixture.p50, p95: fixture.p95, mean: fixture.mean, std: fixture.std },
    ]);
    expect(body.data).not.toHaveProperty("draws"); // retention_policy: simulation_draw is never exposed
    expect(body.meta.seed).toBe(42);
    expect(body.meta.iterations).toBe(5000);
  });

  test("a run without sim.* inputs is 400 before the engine spawns", async () => {
    const res = await req("/api/simulations", {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ run_id: noSimInputsRunId, seed: 1, iterations: 10 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("simulation_rejected");
    expect(body.error.message).toContain("sim.discount_rate");
  });

  test("iterations outside 1..100000 is 400", async () => {
    const res = await req("/api/simulations", {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ run_id: simRunId, iterations: 0 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("simulation_rejected");
  });

  test("POST without run_id is 400", async () => {
    const res = await req("/api/simulations", {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ seed: 1 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });

  test("POST for an unknown run is 404", async () => {
    const res = await req("/api/simulations", {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: JSON.stringify({ run_id: "01NOEXISTINGRUNID0000000" }),
    });
    expect(res.status).toBe(404);
  });

  test("a viewer member cannot run simulations — 403 role gate", async () => {
    const res = await req("/api/simulations", {
      method: "POST",
      headers: { cookie: erinCookie },
      body: JSON.stringify({ run_id: simRunId, seed: 1, iterations: 10 }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("role_required");
  });

  test("a non-member cannot run a simulation — 404, existence protected", async () => {
    const res = await req("/api/simulations", {
      method: "POST",
      headers: { cookie: daveCookie },
      body: JSON.stringify({ run_id: simRunId, seed: 1, iterations: 10 }),
    });
    expect(res.status).toBe(404);
  });

  test("simulation results are 404 for a non-member", async () => {
    const res = await req(`/api/simulations/${createdSimId}/results`, { headers: { cookie: daveCookie } });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  test("GET for an unknown simulation is 404", async () => {
    const res = await req(`/api/simulations/01NOSUCHSIMULATION000000000/results`, { headers: { cookie: aliceCookie } });
    expect(res.status).toBe(404);
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

// ADR-0059 E.4 scorecard routes. This describe runs BEFORE any
// venture_scorecard row exists (the seeding describe below follows it in
// file order), so the empty-table contract is asserted on a genuinely
// empty table.
describe("scorecard routes — unauthenticated + empty-table reads (E.4)", () => {
  test("both routes reject an unauthenticated caller", async () => {
    expect((await req("/api/portfolio-scorecard")).status).toBe(401);
    expect((await req(`/api/projects/${projectId}/scorecard`)).status).toBe(401);
  });

  test("a portfolio read over an empty table is an honestly empty envelope", async () => {
    const res = await req("/api/portfolio-scorecard", { headers: { cookie: aliceCookie } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.review_cycle).toBe(null);
    expect(body.data.resolved_from).toBe("latest");
    expect(body.data.financial).toEqual([]);
    expect(body.data.strategic).toEqual([]);
    expect(body.data.class_rollup).toEqual([]);
    expect(body.data.insufficient_evidence).toEqual([]);
    expect(body.meta).toMatchObject({
      scope: "membership-filtered",
      scope_incomplete: false,
      projects_with_rows_total: 0,
      projects_excluded: 0,
    });
    expect(body.meta.projects_visible).toBeGreaterThanOrEqual(1); // alice's projects exist; none carry scorecard rows yet
    expect(body.meta.review_cycles_available).toEqual([]);
  });
});

// E.4 seeding: frank is a member of project A ONLY (until the MNPI test
// adds M), so his rollup exercises the membership filter while B's rows
// exist group-wide. Rows go in through recordVentureScorecardCycle — the
// reads here see exactly what production writes.
describe("scorecard routes — membership scope, cycles, MNPI (E.4)", () => {
  type ScRow = Parameters<typeof recordVentureScorecardCycle>[0]["rows"][number];
  function scoreRow(overrides: Partial<ScRow> = {}): ScRow {
    return {
      venture_class: "driving",
      section: "financial",
      measure_key: "sc.revenue_growth",
      target_value: ">= 0pp",
      actual_value: "+3pp",
      status: "on_target",
      evidence_ref: "doc:cim-2026-001",
      observed_at: NOW,
      ...overrides,
    };
  }
  function seedRun(projectId: string, label: string): string {
    const runId = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [runId, projectId, label, `hash-${label}`, "alice", NOW]);
    return runId;
  }

  let frankCookie: string;
  let projectA: string;
  let projectB: string;

  beforeAll(async () => {
    await createUser(db, { userId: "frank", role: "analyst", password: "pw-frank-123456", createdBy: "test", now: NOW });
    approveUser(db, { userId: "frank", approvedBy: "test", now: NOW });
    frankCookie = await loginCookie("frank", "pw-frank-123456");

    const resA = await req("/api/projects", { method: "POST", headers: { cookie: aliceCookie }, body: JSON.stringify({ project_no: "NP-2026-110" }) });
    projectA = (await resA.json()).data.id;
    grantProjectMembership(db, { projectId: projectA, userId: "frank", projectRole: "contributor", grantedBy: "alice", needToKnowBasis: "E.4 portfolio scope test", now: NOW });

    const resB = await req("/api/projects", { method: "POST", headers: { cookie: aliceCookie }, body: JSON.stringify({ project_no: "NP-2026-111" }) });
    projectB = (await resB.json()).data.id;

    recordVentureScorecardCycle(
      { runId: seedRun(projectA, "sc-a-q2"), projectId: projectA, sourceProcedure: "portfolio-venture-monitoring", reviewCycle: "2026-Q2", rows: [scoreRow()], actor: "alice", now: NOW },
      db,
    );
    recordVentureScorecardCycle(
      {
        runId: seedRun(projectA, "sc-a-q3"),
        projectId: projectA,
        sourceProcedure: "portfolio-venture-monitoring",
        reviewCycle: "2026-Q3",
        rows: [scoreRow(), scoreRow({ section: "strategic", measure_key: "sc.market_share", actual_value: "-1pp", status: "deviation" })],
        actor: "alice",
        now: NOW,
      },
      db,
    );
    recordVentureScorecardCycle(
      { runId: seedRun(projectB, "sc-b-q3"), projectId: projectB, sourceProcedure: "portfolio-venture-monitoring", reviewCycle: "2026-Q3", rows: [scoreRow({ venture_class: "enabling" })], actor: "alice", now: NOW },
      db,
    );
  });

  test("the rollup carries only the caller's visible projects — and says it is a subset", async () => {
    const res = await req("/api/portfolio-scorecard", { headers: { cookie: frankCookie } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.review_cycle).toBe("2026-Q3"); // latest within frank's scope
    const allRows = [...body.data.financial, ...body.data.strategic];
    expect(allRows.length).toBe(2); // A's Q3 rows only (Q2's row is out of cycle)
    expect(allRows.every((r: { project_id: string }) => r.project_id === projectA)).toBe(true);
    expect(body.data.class_rollup).toHaveLength(1); // driving only — B's enabling row is out of scope
    expect(body.data.insufficient_evidence).toEqual([]);
    expect(body.meta).toMatchObject({
      scope: "membership-filtered",
      projects_visible: 1,
      projects_with_rows_total: 2, // A + B have rows in 2026-Q3, visibility ignored
      scope_incomplete: true,
      projects_excluded: 1,
      review_cycle: "2026-Q3",
    });
    expect(body.meta.review_cycles_available).toEqual(["2026-Q2", "2026-Q3"]); // the selector axis, scoped to frank
  });

  test("?review_cycle=2026-Q2 resolves that cycle explicitly", async () => {
    const res = await req("/api/portfolio-scorecard?review_cycle=2026-Q2", { headers: { cookie: frankCookie } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.review_cycle).toBe("2026-Q2");
    expect(body.data.resolved_from).toBe("explicit");
    expect(body.meta.review_cycle).toBe("2026-Q2");
    expect([...body.data.financial, ...body.data.strategic]).toHaveLength(1);
  });

  test("a malformed review_cycle is 400, never a silent latest fallback", async () => {
    const res = await req("/api/portfolio-scorecard?review_cycle=2026-Q9", { headers: { cookie: frankCookie } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_review_cycle");
  });

  test("project scorecard is 404 for a non-member — existence protected", async () => {
    const res = await req(`/api/projects/${projectB}/scorecard`, { headers: { cookie: frankCookie } });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  test("project scorecard returns a member's rows, explicit cycle and latest fallback alike", async () => {
    const explicit = await req(`/api/projects/${projectA}/scorecard?review_cycle=2026-Q2`, { headers: { cookie: frankCookie } });
    const explicitBody = await explicit.json();
    expect(explicit.status).toBe(200);
    expect(explicitBody.meta).toMatchObject({ project_id: projectA, review_cycle: "2026-Q2", count: 1 });

    const latest = await req(`/api/projects/${projectA}/scorecard`, { headers: { cookie: frankCookie } });
    const latestBody = await latest.json();
    expect(latest.status).toBe(200);
    expect(latestBody.meta).toMatchObject({ project_id: projectA, review_cycle: "2026-Q3", count: 2 });
    expect(latestBody.data.every((r: { review_cycle: string }) => r.review_cycle === "2026-Q3")).toBe(true);
  });

  test("an MNPI venture's rows stay in a member's rollup and the read is logged (FR-SEC-06)", async () => {
    // Seed the MNPI venture through the sanctioned paths: classification
    // row, setMnpiFlag 0→1 (retroactive insider enrollment for alice),
    // then frank's grant (insider enrollment at grant time).
    const resM = await req("/api/projects", { method: "POST", headers: { cookie: aliceCookie }, body: JSON.stringify({ project_no: "NP-2026-112" }) });
    const projectM = (await resM.json()).data.id;
    db.run("INSERT INTO project_classification (project_id, sensitivity, mnpi_flag, classified_by, classified_at) VALUES (?,?,?,?,?)", [projectM, "restricted", 0, "test", NOW]);
    setMnpiFlag(db, { projectId: projectM, mnpiFlag: 1, setBy: "alice", reason: "E.4 MNPI portfolio fixture", now: NOW });
    grantProjectMembership(db, { projectId: projectM, userId: "frank", projectRole: "observer", grantedBy: "alice", needToKnowBasis: "E.4 MNPI inclusion test", now: NOW });
    recordVentureScorecardCycle(
      { runId: seedRun(projectM, "sc-m-q3"), projectId: projectM, sourceProcedure: "jv-lifecycle-governance", reviewCycle: "2026-Q3", rows: [scoreRow({ venture_class: "jv", section: "strategic", measure_key: "sc.jv.synergy" })], actor: "alice", now: NOW },
      db,
    );

    const rollup = await req("/api/portfolio-scorecard?review_cycle=2026-Q3", { headers: { cookie: frankCookie } });
    const body = await rollup.json();
    expect(rollup.status).toBe(200);
    expect([...body.data.financial, ...body.data.strategic].some((r: { project_id: string }) => r.project_id === projectM)).toBe(true);
    expect(body.meta).toMatchObject({ projects_visible: 2, projects_with_rows_total: 3, projects_excluded: 1, scope_incomplete: true });
    expect(body.data.class_rollup.find((e: { venture_class: string }) => e.venture_class === "jv")).toMatchObject({ ventures: 1 });

    // The access trail: the route's own scorecard read, plus the visibility
    // layer's MNPI read of the project itself.
    const routeLog = db
      .query("SELECT COUNT(*) AS n FROM data_access_log WHERE user_id = ? AND table_key = 'venture_scorecard' AND record_ref = ? AND action = 'read'")
      .get("frank", "portfolio:2026-Q3") as { n: number };
    expect(routeLog.n).toBeGreaterThan(0);
    const mnpiLog = db
      .query("SELECT COUNT(*) AS n FROM data_access_log WHERE user_id = ? AND table_key = 'project' AND record_ref = ? AND action = 'read'")
      .get("frank", projectM) as { n: number };
    expect(mnpiLog.n).toBeGreaterThan(0);
  });
});
