// @version 1.0.0
/**
 * ADR-0174 follow-up - human-triggered S5 investment plan re-import.
 * Real route handlers + scratch SQLite. ASCII-only (Korean via \u escapes).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-s5-reimport.sqlite";
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
const { runAsPrincipal } = await import("../../app/web-next/lib/mcp/principal-context.ts");
const { isHumanOnly } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
const route = await import("../../app/web-next/app/api/projects/[id]/business-case/s5-reimport/route.ts");

const NOW = new Date().toISOString();
const ANALYST = "s5r-analyst";
const VIEWER = "s5r-viewer";
const NAME_AUTO = "S5 투자비 검토 요건 (자동 이관)";
let cookie = "";
let viewerCookie = "";

const LINES = [
  { line: "Plant", category: "capex", amount: 50, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "lumpsum", startYear: 1 },
  { line: "Staff", category: "labor", amount: 10, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "yearly" },
  { line: "NoUnit", category: "opex", amount: 3 },
  { line: "Dollar", category: "opex", amount: 7, amountUnit: "fx_m", amountUnitConfirmed: true, currency: "USD", period: "yearly" },
];

function req(path: string, init?: RequestInit) { return nextRequest(path, init); }
async function login(userId: string, pw: string) {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password: pw }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
function makeOpp(track: "greenfield" | "brownfield", lines: unknown[] | null): string {
  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, capability_gap_json) VALUES (?,?,?,?,?,?,?)",
    [oppId, "opp " + oppId.slice(-5), "scope", "selected", ANALYST, NOW, JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW })]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)",
    [ulid(), oppId, track, "r", "alt", ANALYST, NOW]);
  for (const gate of track === "greenfield" ? ["screening", "pre_fs"] : ["screening", "pre_fs", "target_screening"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "t", ANALYST, NOW]);
  }
  if (track === "greenfield") {
    db.run("INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at, business_case_lines_json) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), oppId, "s", "a", "r", ANALYST, NOW, NOW, lines ? JSON.stringify(lines) : null]);
  } else {
    db.run("INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [ulid(), oppId, "T", "shortlisted", 1, NOW, NOW]);
  }
  return oppId;
}
function promote(oppId: string): string {
  return promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "t" }).project.id;
}
function models(projectId: string) {
  return db.query("SELECT id, name, kind, archived_at, archived_by FROM business_case_model WHERE project_id = ? AND kind = 'greenfield_cost' ORDER BY created_at, id").all(projectId) as Array<{ id: string; name: string; kind: string; archived_at: string | null; archived_by: string | null }>;
}
function linesOf(modelId: string) {
  return db.query("SELECT category, name, annual_amount_krw_m, unit, start_year, end_year, note FROM business_case_line WHERE model_id = ? ORDER BY name").all(modelId);
}
const url = (id: string) => `/api/projects/${id}/business-case/s5-reimport`;

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-s5r-analyst-1", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-s5r-viewer-12", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await login(ANALYST, "pw-s5r-analyst-1");
  viewerCookie = await login(VIEWER, "pw-s5r-viewer-12");
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("promotion parity", () => {
  test("promotion copies only confirmed KRW lines with exact rows", () => {
    const pid = promote(makeOpp("greenfield", LINES));
    const [m] = models(pid);
    expect(m.name).toBe(NAME_AUTO);
    expect(linesOf(m.id)).toEqual([
      { category: "capex", name: "Plant", annual_amount_krw_m: 50, unit: "KRW_M", start_year: 1, end_year: 1, note: "일시불 총액 — 연반복 아님. S5에서 이관됨 — 검증 필요" },
      { category: "labor", name: "Staff", annual_amount_krw_m: 10, unit: "KRW_M", start_year: 1, end_year: null, note: "S5에서 이관됨 — 검증 필요" },
    ]);
    const audits = db.query("SELECT action FROM audit_log WHERE action = 'greenfield_cost.promotion_skipped' AND target LIKE ?").all(`${(db.query("SELECT source_opportunity_id AS o FROM md_project WHERE id = ?").get(pid) as { o: string }).o}:%`);
    expect(audits.length).toBe(2);
  });

  test("promotion copies the S5 line's own growth rate (validated, clamped to [0,1])", () => {
    const LINES_G = [
      { line: "Grow", category: "capex", amount: 100, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "yearly", startYear: 1, endYear: 3, growthRate: 0.05 },
      { line: "Neg", category: "labor", amount: 10, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "yearly", startYear: 1, growthRate: -0.5 },
      { line: "Huge", category: "labor", amount: 10, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "yearly", startYear: 1, growthRate: 5 },
      { line: "Text", category: "labor", amount: 10, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "yearly", startYear: 1, growthRate: "0.1" },
    ];
    const pid = promote(makeOpp("greenfield", LINES_G));
    const [m] = models(pid);
    const growth = db.query("SELECT name, growth_rate FROM business_case_line WHERE model_id = ? ORDER BY name").all(m.id) as Array<{ name: string; growth_rate: number }>;
    expect(growth).toEqual([
      { name: "Grow", growth_rate: 0.05 },  // the S5 line's own rate, copied
      { name: "Huge", growth_rate: 1 },     // > 1 clamped to 1
      { name: "Neg", growth_rate: 0 },      // negative -> 0, never fabricated
      { name: "Text", growth_rate: 0 },     // non-numeric -> 0
    ]);
  });
});

describe("reimport", () => {
  test("creates a new model, archives the previous one (not deleted), basis unchanged, audit row", async () => {
    const oppId = makeOpp("greenfield", null);
    const pid = promote(oppId);
    expect(models(pid).length).toBe(0);
    db.run("UPDATE greenfield_assessment SET business_case_lines_json = ? WHERE opportunity_id = ?", [JSON.stringify(LINES), oppId]);
    const basisBefore = db.query("SELECT COUNT(*) AS n FROM assumption WHERE assumption_key = 'bc.investment_basis'").get();

    const pv = await req(url(pid), { headers: { cookie } });
    expect(pv.status).toBe(200);
    const pvd = (await pv.json()).data;
    expect(pvd.manual_lines).toBe(2);
    expect(pvd.skipped.map((s: { reason: string }) => s.reason).sort()).toEqual(["currency_non_krw", "unit_unconfirmed"]);
    expect(pvd.will_archive).toEqual([]);

    const r1 = await req(url(pid), { method: "POST", headers: { cookie } });
    expect(r1.status).toBe(200);
    const first = (await r1.json()).data;
    expect(first.imported).toBe(2);
    expect(models(pid).length).toBe(1);
    expect(models(pid)[0].name).toContain("재이관");
    expect(linesOf(first.model_id).length).toBe(2);

    // second import archives the first, never deletes it
    const pv2 = (await (await req(url(pid), { headers: { cookie } })).json()).data;
    expect(pv2.will_archive.map((m: { id: string }) => m.id)).toEqual([first.model_id]);
    const second = (await (await req(url(pid), { method: "POST", headers: { cookie } })).json()).data;
    const all = models(pid);
    expect(all.length).toBe(2);
    const old = all.find((m) => m.id === first.model_id)!;
    expect(old.archived_at).not.toBeNull();
    expect(old.archived_by).toBe(ANALYST);
    expect(all.find((m) => m.id === second.model_id)!.archived_at).toBeNull();
    expect(linesOf(first.model_id).length).toBe(2);

    const audit = db.query("SELECT actor_user_id, target FROM audit_log WHERE action = 'business_case.s5_reimport' AND target LIKE ?").all(`${pid}:%`) as Array<{ actor_user_id: string; target: string }>;
    expect(audit.length).toBe(2);
    expect(audit[1].actor_user_id).toBe(ANALYST);
    expect(audit[1].target).toContain(`new=${second.model_id}`);
    expect(audit[1].target).toContain(`old=${first.model_id}`);
    expect(db.query("SELECT COUNT(*) AS n FROM assumption WHERE assumption_key = 'bc.investment_basis'").get()).toEqual(basisBefore);
  });

  test("no importable lines -> 409; brownfield -> 409", async () => {
    const pid = promote(makeOpp("greenfield", [{ line: "NoUnit", category: "opex", amount: 3 }]));
    const r = await req(url(pid), { method: "POST", headers: { cookie } });
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("no_importable_lines");
    expect(models(pid).length).toBe(0);
    const bf = promote(makeOpp("brownfield", null));
    const rb = await req(url(bf), { method: "POST", headers: { cookie } });
    expect(rb.status).toBe(409);
    expect((await rb.json()).error.code).toBe("not_greenfield");
  });

  test("agent principals and viewers are refused; route registered human-only", async () => {
    const pid = promote(makeOpp("greenfield", LINES));
    const principal = { userId: ANALYST, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" };
    const res = (await runAsPrincipal(principal, () => route.POST(new Request("http://x/s5-reimport", { method: "POST" }), { params: Promise.resolve({ id: pid }) })))!;
    expect(res.status).toBe(403);
    expect((await req(url(pid), { method: "POST", headers: { cookie: viewerCookie } })).status).toBe(403);
    expect(isHumanOnly("POST", url(pid), {})).toBe(true);
    expect(models(pid).length).toBe(1);
  });
});
