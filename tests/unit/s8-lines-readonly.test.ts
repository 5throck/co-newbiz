// @version 1.0.0
/**
 * ADR-0178 (decider decision 2026-10-16) — Green Field S8 business-case line
 * editing is READ-ONLY. S5 is the single source of the investment plan; S8 line
 * edits would silently diverge from it. Proves with real route handlers +
 * scratch SQLite:
 *  - Green Field + importable S5 plan: PUT lines -> 409 greenfield_lines_readonly
 *    with the Korean guidance (S5 investment tab + re-pin via the S5 connect block).
 *  - Brown Field: PUT lines unchanged (200, full-line replacement still works).
 *  - Carve-out: a Green Field project whose source opportunity has NO importable
 *    S5 plan keeps the manual editor (200) — fully manual legacy projects work.
 *  - Source-guard: the component renders the read-only section (testids
 *    s8-lines-readonly*) for Green Field and keeps the JSON editor for Brown Field.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-s8-lines-readonly.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const route = await import("../../app/web-next/app/api/projects/[id]/business-case/route.ts");

const NOW = new Date().toISOString();
const ANALYST = "lr-analyst";
let cookie = "";
let gfId = ""; // greenfield project WITH an importable S5 plan
let gfManualId = ""; // greenfield project WITHOUT an importable S5 plan (carve-out)
let bfId = ""; // brownfield project

const IMPORTABLE_LINES = [
  { line: "equipment", category: "capex", amount: 1000, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "lumpsum", startYear: 1, endYear: 1 },
  { line: "ops", category: "opex", amount: 200, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "yearly", startYear: 1, endYear: 5 },
];

const json = (v: unknown): string => JSON.stringify(v);

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

/** Green Field fixture: opportunity + route_decision + greenfield_assessment + gates + promote. */
function makeGreenfield(linesJson: string): string {
  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "LR \uac00\ub9ac", "s5 investment plan", "selected", ANALYST, NOW]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), oppId, "greenfield", "test", "alt", ANALYST, NOW]);
  db.run(
    "INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at, business_case_lines_json) VALUES (?,?,?,?,?,?,?,?,?)",
    [ulid(), oppId, "direct", "alt", "test", ANALYST, NOW, NOW, linesJson],
  );
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows: [{ id: "r1", capability: "cap", source: "manual", held: { status: "unmet" } }], updatedAt: NOW }), oppId]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "t", ANALYST, NOW]);
  }
  return promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "s8-lines-readonly test" }).project.id;
}

function makeBrownfield(): string {
  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "LR \ubc18", "test scope", "selected", ANALYST, NOW]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), oppId, "brownfield", "m_and_a", "test", ANALYST, NOW]);
  for (const gate of ["screening", "pre_fs", "target_screening"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "t", ANALYST, NOW]);
  }
  db.run("INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [ulid(), oppId, "\ub300\uc0c1A", "shortlisted", 1, NOW, NOW]);
  return promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "s8-lines-readonly test" }).project.id;
}

function addModel(projectId: string, name: string) {
  const res = req(`/api/projects/${projectId}/business-case`, {
    method: "POST",
    headers: { cookie },
    body: json({ name, kind: "valuation", horizon_years: 5, lines: [{ category: "opex", name, annual_amount_krw_m: 100, start_year: 1 }] }),
  });
  return res;
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-lr-analyst-1", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await loginCookie(ANALYST, "pw-lr-analyst-1");

  gfId = makeGreenfield(json(IMPORTABLE_LINES));
  gfManualId = makeGreenfield("[]");
  bfId = makeBrownfield();
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("greenfield_lines_readonly (ADR-0178 decider decision 2026-10-16)", () => {
  test("PUT lines on a greenfield with an importable S5 plan -> 409 with the guidance", async () => {
    const created = await addModel(gfId, "GF \uc0ac\ub840");
    const model = ((await created.json()) as { data: { id: string } }).data.id;
    expect(created.status).toBe(201);

    const res = await req(`/api/projects/${gfId}/business-case`, {
      method: "PUT",
      headers: { cookie },
      body: json({ model_id: model, lines: [{ category: "capex", name: "hack", annual_amount_krw_m: 1, start_year: 1 }] }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("greenfield_lines_readonly");
    // Korean guidance must point at the S5 investment tab and the re-pin path.
    expect(body.error.message).toContain("S5\uac00 \ub2e8\uc77c \uc6d0\ubcf8\uc785\ub2c8\ub2e4");
    expect(body.error.message).toContain("\ucd5c\uc2e0 S5\ub85c \uac31\uc2e0");
  });

  test("brownfield PUT lines is unchanged (200, full-line replacement)", async () => {
    const created = await addModel(bfId, "BF \uc0ac\ub840");
    const model = ((await created.json()) as { data: { id: string } }).data.id;
    expect(created.status).toBe(201);

    const res = await req(`/api/projects/${bfId}/business-case`, {
      method: "PUT",
      headers: { cookie },
      body: json({ model_id: model, lines: [{ category: "capex", name: "\uc124\ube44", annual_amount_krw_m: 500, start_year: 1 }] }),
    });
    expect(res.status).toBe(200);
    const lines = db.query("SELECT COUNT(*) AS c FROM business_case_line WHERE model_id = ?").get(model) as { c: number };
    expect(lines.c).toBe(1);
    const stored = db.query("SELECT name, annual_amount_krw_m FROM business_case_line WHERE model_id = ?").get(model) as { name: string; annual_amount_krw_m: number };
    expect(stored.name).toBe("\uc124\ube44");
    expect(stored.annual_amount_krw_m).toBe(500);
  });

  test("carve-out: greenfield WITHOUT an importable S5 plan keeps the manual editor (200)", async () => {
    const created = await addModel(gfManualId, "\uc218\ub3d9 \uc0ac\ub840");
    const model = ((await created.json()) as { data: { id: string } }).data.id;
    expect(created.status).toBe(201);

    const res = await req(`/api/projects/${gfManualId}/business-case`, {
      method: "PUT",
      headers: { cookie },
      body: json({ model_id: model, lines: [{ category: "labor", name: "\uc778\ub825", annual_amount_krw_m: 300, start_year: 1 }] }),
    });
    expect(res.status).toBe(200);
    const stored = db.query("SELECT COUNT(*) AS c FROM business_case_line WHERE model_id = ?").get(model) as { c: number };
    expect(stored.c).toBe(1);
  });
});

describe("source-guard: read-only view for Green Field, editor kept for Brown Field", () => {
  const src = readFileSync("app/web-next/components/stages/BusinessCaseStage.tsx", "utf8");

  test("read-only section renders with the required testids and S5 link", () => {
    expect(src).toContain('data-testid="s8-lines-readonly"');
    expect(src).toContain('data-testid="s8-lines-readonly-caption"');
    expect(src).toContain('data-testid="s8-lines-readonly-stale"');
    expect(src).toContain('data-testid="s8-lines-readonly-table"');
    expect(src).toContain('data-testid="s8-lines-readonly-row"');
    expect(src).toContain("/s5?tab=investment");
    expect(src).toContain("S5\uac00 \ub2e8\uc77c \uc6d0\ubcf8\uc785\ub2c8\ub2e4");
    expect(src).toContain("\ucd5c\uc2e0 S5\ub85c \uac31\uc2e0");
  });

  test("RowMenu switches to view for greenfield, edit stays for brownfield", () => {
    expect(src).toContain('greenfield ? "\ub77c\uc778 \ubcf4\uae30" : "\ub77c\uc778 \ud3b8\uc9d1"');
    // The brownfield JSON editor still exists.
    expect(src).toContain("editing");
    expect(src).toContain("JSON");
  });
});
