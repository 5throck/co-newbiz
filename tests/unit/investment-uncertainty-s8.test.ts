// ADR-0176 slice 4 tests - S8 `invest uncertainty` block, fs gate brief and AI support context.
// ASCII-only source (homoglyph gate): Korean via \u escapes.
import { test, expect, beforeAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-investment-uncertainty-s8.sqlite");
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
const unc = await import("../../app/web-next/lib/investment-uncertainty-s8.ts");
const lens = await import("../../app/web-next/lib/s8-lens-summary.ts");
const brief = await import("../../app/web-next/lib/gate-brief.ts");
const repo = await import("../../db/repositories/investment-simulation-run.repository.ts");

const NOW = new Date().toISOString();
const req = (path: string, init?: RequestInit) => nextRequest(path, init);
const json = JSON.stringify;
const LEAD = "s8unc-lead";
let cookie = "";
let oppId = "";
let projectId = "";
const simUrl = () => `/api/greenfield/${oppId}/investment-simulation`;
const NONE_LINE = "\ud22c\uc790 \ubd88\ud655\uc2e4\uc131: \ud655\uc815\ub41c S5";
const LINES = [
  { line: "equipment", category: "capex", amount: 1000, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "lumpsum", startYear: 1, endYear: 1 },
  { line: "ops", category: "opex", amount: 200, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "yearly", startYear: 1, endYear: 5 },
];

function insertCaseNote(note: string): void {
  const modelId = ulid();
  db.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,?,?,?,?,?)", [modelId, projectId, "valuation", "case", 5, "t", NOW]);
  db.run(
    "INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, unit, irr, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [ulid(), projectId, modelId, "base", "p50", 1, "KRW_M", null, note, new Date(Date.now() + 1000).toISOString()],
  );
}

beforeAll(async () => {
  await createUser(db, { userId: LEAD, role: "analyst", password: `pw-${LEAD}-12345`, createdBy: "test", now: NOW });
  approveUser(db, { userId: LEAD, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const login = await req("/api/auth/login", { method: "POST", body: json({ userId: LEAD, password: `pw-${LEAD}-12345` }) });
  cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];
  oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "unc opp", "scope", "selected", LEAD, NOW]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), oppId, "greenfield", "test", "alt", LEAD, NOW]);
  db.run(
    "INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at, business_case_lines_json) VALUES (?,?,?,?,?,?,?,?,?)",
    [ulid(), oppId, "direct", "alt", "test", LEAD, NOW, NOW, json(LINES)],
  );
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows: [{ id: "r1", capability: "cap", source: "manual", held: { status: "unmet" } }], updatedAt: NOW }), oppId]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "t", LEAD, NOW]);
  }
  projectId = promoteOpportunity(oppId, { promotedBy: LEAD, needToKnowBasis: "s8unc test" }).project.id;
});

describe("without a confirmed run", () => {
  test("block is informational only and the fs brief gains just one informational line", () => {
    const v = unc.buildInvestUncertainty(db, projectId);
    expect(v.hasRun).toBe(false);
    expect(v.total).toBeNull();
    expect(v.run).toBeNull();
    expect(v.infoLine).toBe(unc.INVEST_UNCERTAINTY_NONE_LINE);
    expect(lens.buildS8LensSummary(db, projectId).invest_uncertainty.hasRun).toBe(false);
    const ctx = brief.buildGateContext(db, "project", projectId, "fs");
    expect(ctx).toContain(NONE_LINE);
    const b = brief.synthesisGateBrief(db, "project", projectId, "fs", brief.gateManifest("project", "fs") ?? []);
    expect(b.recommendation).toBeNull();
    expect(b.key_evidence.some((e) => e.includes(NONE_LINE))).toBe(true);
    // other gates are unchanged
    expect(brief.buildGateContext(db, "project", projectId, "dd")).not.toContain(NONE_LINE);
  });
});

describe("with a confirmed run", () => {
  let runId = "";
  test("block values equal the confirmed run results, with provenance and the label", async () => {
    const created = await req(simUrl(), { method: "POST", headers: { cookie }, body: json({ draws: 100, envelope_krw_m: 1500 }) });
    expect(created.status).toBe(201);
    runId = ((await created.json()) as { data: { run: { id: string } } }).data.run.id;
    // an unconfirmed run is not shown
    expect(unc.buildInvestUncertainty(db, projectId).hasRun).toBe(false);
    const conf = await req(`${simUrl()}/confirm`, { method: "POST", headers: { cookie }, body: json({ run_id: runId }) });
    expect(conf.status).toBe(200);
    const run = repo.getLatestConfirmedInvestmentSimulationRun(oppId, db)!;
    const r = run.results as { total: { p50: number; p95: number }; exceed: { probability: number; envelopeKrwM: number } | null; tornado: Array<{ key: string; active: boolean; share: number }> };
    const v = unc.buildInvestUncertainty(db, projectId);
    expect(v.hasRun).toBe(true);
    expect(v.total).toEqual({ p50: r.total.p50, p95: r.total.p95 });
    expect(v.exceed).toEqual({ envelopeKrwM: r.exceed!.envelopeKrwM, probability: r.exceed!.probability });
    expect(v.topSensitivities.map((t) => t.key)).toEqual(r.tornado.filter((t) => t.active).slice(0, 3).map((t) => t.key));
    expect(v.run).toMatchObject({ id: run.id, hash: run.input_hash, confirmedBy: LEAD, drawCount: 100 });
    expect(v.disclaimer).toContain("\uc2dc\ubbac\ub808\uc774\uc158 \uc0b0\ucd9c\ubb3c");
    expect(v.opportunityId).toBe(oppId);
  });

  test("npv chip: not applicable, in effect, then stale", () => {
    const run = repo.getLatestConfirmedInvestmentSimulationRun(oppId, db)!;
    expect(unc.buildInvestUncertainty(db, projectId).npv.state).toBe("not_applicable");
    insertCaseNote(`seed=1; basis=s5_plan; s5_model=m; s5_line_hash=ab; s5_skipped=0; s5_sim=${run.input_hash}; engine=inline-ts`);
    const ok = unc.buildInvestUncertainty(db, projectId);
    expect(ok.npv).toMatchObject({ state: "in_effect", includes: true, stale: false });
    insertCaseNote("seed=1; basis=s5_plan; s5_model=m; s5_line_hash=ab; s5_skipped=0; s5_sim=deadbeef; engine=inline-ts");
    const st = unc.buildInvestUncertainty(db, projectId);
    expect(st.npv).toMatchObject({ state: "stale", stale: true, includes: false, label: "\uc7ac\ud3c9\uac00 \ud544\uc694" });
    expect(st.hasRun).toBe(true);
  });

  test("fs gate brief and its fallback carry the labeled simulation output; no gate, grade or decision effect", () => {
    const v = unc.buildInvestUncertainty(db, projectId);
    const text = unc.investUncertaintyBriefText(v);
    expect(text).toContain("p50");
    expect(text).toContain("\uc2dc\ubbac\ub808\uc774\uc158 \uc0b0\ucd9c\ubb3c");
    expect(text).toContain(v.run!.hash.slice(0, 12));
    const ctx = brief.buildGateContext(db, "project", projectId, "fs");
    expect(ctx).toContain(text);
    const b = brief.synthesisGateBrief(db, "project", projectId, "fs", brief.gateManifest("project", "fs") ?? []);
    expect(b.key_evidence.join("\n")).toContain(text);
    expect(b.recommendation).toBeNull();
    expect(brief.gateManifest("project", "fs")!.some((m) => m.includes("\ud22c\uc790 \ubd88\ud655\uc2e4\uc131"))).toBe(true);
    // the summary route payload shape stays decision-support only: no blocking fields
    const summary = lens.buildS8LensSummary(db, projectId);
    expect(summary.invest_uncertainty.total).not.toBeNull();
    expect(JSON.stringify(summary.invest_uncertainty)).not.toMatch(/blocked|grade_cap/);
  });
});
