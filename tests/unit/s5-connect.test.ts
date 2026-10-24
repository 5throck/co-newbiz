// @version 1.0.0
/**
 * ADR-0178 follow-up (decider feedback 2026-10-16) - S8 `S5 connect` block backend + labels.
 * Connect preview/apply (atomic, audit, human-only, analyst+, Green Field only, 409 without
 * importable lines, existing cases untouched, basis and s5_source set), disconnect, status states,
 * params-table S5-linkage labels, term rename. Real route handlers + scratch SQLite.
 * ASCII-only source (Korean via \u escapes).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-s5-connect.sqlite");
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
const connectRoute = await import("../../app/web-next/app/api/projects/[id]/business-case/s5-connect/route.ts");
const disconnectRoute = await import("../../app/web-next/app/api/projects/[id]/business-case/s5-disconnect/route.ts");
const gen = await import("../../app/web-next/lib/business-case-generator.ts");
const pinS8 = await import("../../app/web-next/lib/s5-plan-pin-s8.ts");
const simLib = await import("../../app/web-next/lib/investment-simulation.ts");
const inputLib = await import("../../app/web-next/lib/investment-simulation-input.ts");
const runRepo = await import("../../db/repositories/investment-simulation-run.repository.ts");
const status = await import("../../app/web-next/lib/s5-connect-status.ts");
const labels = await import("../../app/web-next/lib/s5-linkage-labels.ts");

const NOW = new Date().toISOString();
const ANALYST = "conn-analyst";
const VIEWER = "conn-viewer";
let cookie = "";
let viewerCookie = "";
const json = JSON.stringify;

const ml = (line: string, category: string, amount: number, period: string, startYear?: number, endYear?: number) => ({
  line, category, amount, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period, startYear, endYear,
});
const LINES = [
  ml("Plant", "capex", 1200, "lumpsum", 1),
  ml("Staff", "labor", 40, "monthly", 1),
  ml("Ops", "opex", 150, "yearly", 2, 4),
  { line: "NoUnit", category: "opex", amount: 3 },
  { source: "plan_meta", horizonYears: 5 },
];

async function login(userId: string, pw: string) {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: json({ userId, password: pw }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
function makeOpp(track: "greenfield" | "brownfield", lines: unknown[] | null): string {
  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, capability_gap_json, market_size_krw_m, growth_rate) VALUES (?,?,?,?,?,?,?,?,?)",
    [oppId, "opp " + oppId.slice(-5), "scope", "selected", ANALYST, NOW, json({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), 80000, 0.06]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), oppId, track, "r", "alt", ANALYST, NOW]);
  for (const gate of track === "greenfield" ? ["screening", "pre_fs"] : ["screening", "pre_fs", "target_screening"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "t", ANALYST, NOW]);
  }
  if (track === "greenfield") {
    db.run("INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at, business_case_lines_json) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), oppId, "s", "a", "r", ANALYST, NOW, NOW, lines ? json(lines) : null]);
  } else {
    db.run("INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [ulid(), oppId, "T", "shortlisted", 1, NOW, NOW]);
  }
  return oppId;
}
const promote = (oppId: string): string => promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "t" }).project.id;
const oppOf = (pid: string): string => (db.query("SELECT source_opportunity_id AS o FROM md_project WHERE id = ?").get(pid) as { o: string }).o;
const setLines = (oppId: string, lines: unknown[]) => db.run("UPDATE greenfield_assessment SET business_case_lines_json = ? WHERE opportunity_id = ?", [json(lines), oppId]);
const pinRows = (pid: string) => db.query("SELECT * FROM s5_plan_pin WHERE project_id = ? ORDER BY pinned_at, id").all(pid) as Array<Record<string, unknown>>;
const url = (id: string) => `/api/projects/${id}/business-case/s5-connect`;
const durl = (id: string) => `/api/projects/${id}/business-case/s5-disconnect`;
const params = (pid: string) => gen.resolveBusinessCaseParams(db, pid);
const counts = (pid: string) => ({
  models: (db.query("SELECT COUNT(*) AS n FROM business_case_model WHERE project_id = ?").get(pid) as { n: number }).n,
  sims: (db.query("SELECT COUNT(*) AS n FROM valuation_simulation WHERE project_id = ?").get(pid) as { n: number }).n,
});
function confirmRun(oppId: string, hash: string, confirm = true) {
  const run = runRepo.insertInvestmentSimulationRun({ opportunityId: oppId, inputHash: hash, seed: 99, drawCount: 500, horizonYears: 5, envelopeKrwM: null, assumptions: { salaryRange: 0.1, salaryIncreaseRangePp: 2, onCostRangePp: 2, rampShiftHalfYears: 0.5, capabilityRange: 0.3, manualLineRange: 0.2 }, results: {}, actor: ANALYST, now: new Date().toISOString() }, db);
  if (confirm) runRepo.confirmInvestmentSimulationRun(oppId, run.id, ANALYST, new Date().toISOString(), db);
  return run;
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-conn-analyst-12", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-conn-viewer-123", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await login(ANALYST, "pw-conn-analyst-12");
  viewerCookie = await login(VIEWER, "pw-conn-viewer-123");
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("connect preview and apply", () => {
  test("GET previews lines, skipped reasons, run state and what will change; writes nothing", async () => {
    const opp = makeOpp("greenfield", null);
    const pid = promote(opp); // no S5 lines at promotion -> no pin
    setLines(opp, LINES);
    const before = { pins: pinRows(pid).length, ...counts(pid) };
    const res = await nextRequest(url(pid), { headers: { cookie } });
    expect(res.status).toBe(200);
    const pv = (await res.json()).data.preview;
    expect(pv.import.importable).toBe(3);
    expect(pv.import.skipped.map((s: { reason: string }) => s.reason)).toContain("unit_unconfirmed");
    expect(pv.pin.has_pin).toBe(false);
    expect(pv.confirmed_run_exists).toBe(false);
    expect(pv.current).toEqual({ investment_basis: "ratio", s5_source: 0 });
    expect(pv.will_set).toEqual({ investment_basis: "s5_plan_full", s5_source: 1 });
    expect({ pins: pinRows(pid).length, ...counts(pid) }).toEqual(before);
    expect(params(pid).investmentBasis).toBe("ratio");
  });

  test("POST pins, sets the unified basis (s5_plan_full) and s5_source=1 in one transaction with one audit row; cases untouched", async () => {
    const opp = makeOpp("greenfield", null);
    const pid = promote(opp);
    setLines(opp, LINES);
    const before = counts(pid);
    const res = await nextRequest(url(pid), { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    const d = (await res.json()).data;
    expect(d).toMatchObject({ pin_written: true, investment_basis_set: true, s5_source: 1, audit_action: "s5_plan_pin.connected" });
    expect(pinRows(pid).length).toBe(1);
    expect(pinRows(pid)[0].reason).toBe("initial");
    expect(String(pinRows(pid)[0].input_snapshot_json).length).toBeGreaterThan(10);
    const p = params(pid);
    expect(p.investmentBasis).toBe("s5_plan_full");
    expect(p.s5Source).toBe("pinned");
    expect(p.s5PinId).toBe(d.pin_id);
    expect(counts(pid)).toEqual(before); // no model written, nothing regenerated
    const audits = db.query("SELECT action, target FROM audit_log WHERE action = 's5_plan_pin.connected' AND target LIKE ?").all(`${pid}#%`) as Array<{ target: string }>;
    expect(audits.length).toBe(1);
    expect(audits[0].target).toContain("basis=ratio->s5_plan_full");
    expect(pinS8.s5PinStatusForProject(db, pid).path).toBe("pinned");
  });

  test("an S5 basis already chosen (s5_plan_full) is kept; an existing stale pin is re-pinned", async () => {
    const opp = makeOpp("greenfield", LINES);
    const pid = promote(opp); // initial pin at promotion
    await gen.recordBusinessCaseParams(db, { projectId: pid, params: { investment_basis: "s5_plan_full" }, rationale: "t", actor: ANALYST });
    setLines(opp, LINES.map((l) => ((l as { line?: string }).line === "Ops" ? { ...l, amount: 175 } : l)));
    expect(pinS8.s5PinStatusForProject(db, pid).state).toBe("stale");
    const res = await nextRequest(url(pid), { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ pin_written: true, investment_basis_set: false });
    expect(params(pid).investmentBasis).toBe("s5_plan_full");
    expect(params(pid).s5Source).toBe("pinned");
    expect(pinRows(pid).map((r) => r.reason)).toEqual(["initial", "repin"]);
  });

  test("a stored legacy capex-only basis (s5_plan) moves to the unified basis on connect; audited", async () => {
    const opp = makeOpp("greenfield", LINES);
    const pid = promote(opp); // initial pin at promotion
    await gen.recordBusinessCaseParams(db, { projectId: pid, params: { investment_basis: "s5_plan" }, rationale: "t", actor: ANALYST });
    const res = await nextRequest(url(pid), { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ pin_written: false, investment_basis_set: true }); // source unchanged -> re-pin writes nothing
    expect(params(pid).investmentBasis).toBe("s5_plan_full");
    const audits = db.query("SELECT target FROM audit_log WHERE action = 's5_plan_pin.connected' AND target LIKE ?").all(`${pid}#%`) as Array<{ target: string }>;
    expect(audits.length).toBe(1);
    expect(audits[0].target).toContain("basis=s5_plan->s5_plan_full");
  });

  test("409 no_importable_lines without any S5 line; nothing is written (atomic)", async () => {
    const pid = promote(makeOpp("greenfield", null));
    const res = await nextRequest(url(pid), { method: "POST", headers: { cookie } });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("no_importable_lines");
    const pv = await nextRequest(url(pid), { headers: { cookie } });
    expect(pv.status).toBe(409);
    expect(pinRows(pid).length).toBe(0);
    expect(params(pid).investmentBasis).toBe("ratio");
    expect(params(pid).s5Source).toBe("copy");
    expect(db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 's5_plan_pin.connected' AND target LIKE ?").get(`${pid}#%`)).toEqual({ n: 0 });
  });

  test("agents, viewers and anonymous are refused; Brown Field is 409; registered human-only", async () => {
    const pid = promote(makeOpp("greenfield", LINES));
    const principal = { userId: ANALYST, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" };
    for (const [fn, name] of [[connectRoute.POST, "s5-connect"], [connectRoute.GET, "s5-connect"], [disconnectRoute.POST, "s5-disconnect"]] as const) {
      const r = (await runAsPrincipal(principal, () => fn(new Request(`http://x/${name}`, { method: "POST" }), { params: Promise.resolve({ id: pid }) })))!;
      expect(r.status).toBe(403);
      expect((await r.json()).error.code).toBe("human_only");
    }
    expect((await nextRequest(url(pid), { method: "POST", headers: { cookie: viewerCookie } })).status).toBe(403);
    expect((await nextRequest(durl(pid), { method: "POST", headers: { cookie: viewerCookie } })).status).toBe(403);
    expect((await nextRequest(url(pid), { method: "POST" })).status).toBe(401);
    expect(isHumanOnly("POST", url(pid), {})).toBe(true);
    expect(isHumanOnly("POST", durl(pid), {})).toBe(true);
    const bf = promote(makeOpp("brownfield", null));
    const r = await nextRequest(url(bf), { method: "POST", headers: { cookie } });
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("not_greenfield");
    expect(pinRows(bf).length).toBe(0);
  });
});

describe("disconnect", () => {
  test("sets s5_source=0, keeps pin history and basis, audits; 409 when not connected", async () => {
    const opp = makeOpp("greenfield", null);
    const pid = promote(opp);
    setLines(opp, LINES);
    const notYet = await nextRequest(durl(pid), { method: "POST", headers: { cookie } });
    expect(notYet.status).toBe(409);
    expect((await notYet.json()).error.code).toBe("not_connected");
    await nextRequest(url(pid), { method: "POST", headers: { cookie } });
    const pinsBefore = pinRows(pid).length;
    const res = await nextRequest(durl(pid), { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ s5_source: 0, audit_action: "s5_plan_pin.disconnected" });
    expect(params(pid).s5Source).toBe("copy");
    expect(params(pid).investmentBasis).toBe("s5_plan_full");
    expect(pinRows(pid).length).toBe(pinsBefore);
    expect(db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 's5_plan_pin.disconnected' AND target LIKE ?").get(`${pid}#%`)).toEqual({ n: 1 });
    const again = await nextRequest(durl(pid), { method: "POST", headers: { cookie } });
    expect(again.status).toBe(409);
  });
});

describe("S5 simulation state in the connect view", () => {
  test("none -> unconfirmed -> confirmed -> in_effect -> stale", async () => {
    const opp = makeOpp("greenfield", LINES);
    const pid = promote(opp);
    expect(status.s5ConnectViewForProject(db, pid).sim.state).toBe("none");
    expect(status.s5ConnectViewForProject(db, pid).run).toBeNull();
    const input = inputLib.loadInvestmentVectorsInput(db, opp)!;
    const hash = simLib.simulationInputHash(input, 99, 500);
    confirmRun(opp, hash, false);
    expect(status.s5ConnectViewForProject(db, pid).sim.state).toBe("unconfirmed");
    expect(status.s5ConnectViewForProject(db, pid).sim.nextStep).toContain("`\uAC00\uC815 \uD655\uC815`");
    const run = confirmRunOf(opp);
    // amended default: S8 draws from the PINNED run; the promotion pin predates any run, so the
    // confirmed run is NOT what S8 draws from (the pin flags newer_confirmed_run instead)
    expect(status.s5ConnectViewForProject(db, pid)).toMatchObject({ sim: { state: "confirmed" }, run: null });
    expect(pinS8.s5PinStatusForProject(db, pid).reasons).toContain("newer_confirmed_run");
    await nextRequest(url(pid), { method: "POST", headers: { cookie } }); // re-pin follows the confirmed run
    expect(status.s5ConnectViewForProject(db, pid)).toMatchObject({ sim: { state: "confirmed" }, run: { id: run.id, drawCount: 500 } });
    const modelId = (db.query("SELECT id FROM business_case_model WHERE project_id = ? LIMIT 1").get(pid) as { id: string }).id;
    const insNote = (note: string) => db.run("INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)", [ulid(), pid, modelId, "base", "p50", 1, 0.1, note, new Date().toISOString()]);
    insNote(`seed=1; basis=s5_plan; s5_sim=${hash}`);
    expect(status.s5ConnectViewForProject(db, pid).sim).toMatchObject({ state: "in_effect", nextStep: null });
    setLines(opp, LINES.map((l) => ((l as { line?: string }).line === "Ops" ? { ...l, amount: 175 } : l)));
    expect(status.s5ConnectViewForProject(db, pid).sim).toMatchObject({ state: "stale", staleReason: "s5_lines_changed" });
  });
  function confirmRunOf(opp: string) {
    const r = runRepo.getLatestInvestmentSimulationRun(opp, db)!;
    runRepo.confirmInvestmentSimulationRun(opp, r.id, ANALYST, new Date().toISOString(), db);
    return r;
  }
});

describe("labels", () => {
  const ctx = (basis: "ratio" | "s5_plan" | "s5_plan_full", run: { drawCount: number } | null = null, it = 2000) => ({ basis, run, s8Iterations: it });
  // i18n: the lib now emits catalog keys + ICU params — resolve them with a ko stub translator.
  const koMessages = require("../../app/web-next/locales/ko.json") as Record<string, unknown>;
  const lookup = (key: string): string => key.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], koMessages) as string;
  const tr = (key: string, params?: Record<string, string | number | Date>) => {
    let out = lookup(key);
    for (const [k, v] of Object.entries(params ?? {})) out = out.replaceAll(`{${k}}`, String(v));
    return out;
  };
  test("source line wording per linkage", () => {
    const ratios = { opexRatio: 0.6, capexRatio: 0.1, initialInvestmentRatio: 0.5 };
    expect(labels.s5LinkageOf("ratio", "pinned")).toBe("ratio");
    expect(labels.s5LinkageOf("s5_plan", "pinned")).toBe("pinned");
    expect(labels.s5LinkageOf("s5_plan", "copy")).toBe("copy");
    const pinned = labels.s5SourceLineParts("pinned", { id: "01ABCDEFGHIJKLMNOP12345678", pinnedAt: "2026-10-16T01:00:00Z" }, ratios);
    expect(tr(pinned.key, pinned.params)).toBe("S5와 연결됨 (기본 — 고정 참조 " + "01ABCDEFGHIJKLMNOP12345678".slice(-8) + ", 2026-10-16)");
    const ratio = labels.s5SourceLineParts("ratio", null, ratios);
    expect(tr(ratio.key, ratio.params)).toContain("S5와 연결 안 됨 — S5에 가져올 계획이 없어 비율 추정을 사용합니다");
    expect(tr(ratio.key, ratio.params)).toContain("운영비 60%, 설비투자 10%, year-0 = 매출의 50%");
    const copy = labels.s5SourceLineParts("copy", null, ratios);
    expect(tr(copy.key, copy.params)).toContain("복사본 사용 중");
  });

  test("params-table S5 linkage per row (one chip kind + one reason line, no duplicated wording)", () => {
    const pnl = "s5_pnl \uAE30\uC900(\uC2AC\uB77C\uC774\uC2A4 2)\uC5D0\uC11C S5 \uACC4\uD68D \uC904\uB85C \uB300\uCCB4";
    for (const k of ["opex", "capex", "initial"] as const) {
      expect(labels.s5ParamLinkage(k, ctx("ratio"))).toMatchObject({ kind: "assumed", detail: `S5 \uBBF8\uC5F0\uB3D9 \u2014 ${pnl}`, text: `\uAC00\uC815\uAC12 (S5 \uBBF8\uC5F0\uB3D9 \u2014 ${pnl})` });
    }
    expect(labels.s5ParamLinkage("capex", ctx("s5_plan")).kind).toBe("s5");
    expect(labels.s5ParamLinkage("initial", ctx("s5_plan")).kind).toBe("s5");
    // legacy capex-only s5_plan: opex stays assumed with the migration hint; unified basis covers opex
    expect(labels.s5ParamLinkage("opex", ctx("s5_plan")).kind).toBe("assumed");
    expect(labels.s5ParamLinkage("opex", ctx("s5_plan")).detail).toContain("예전 기준(설비투자만)");
    expect(labels.s5ParamLinkage("opex", ctx("s5_plan_full")).kind).toBe("s5");
    expect(labels.s5ParamLinkage("sigma", ctx("s5_plan")).detail).toBe("S5 \uBBF8\uC5F0\uB3D9 \u2014 \uC2AC\uB77C\uC774\uC2A4 3\uC5D0\uC11C S5 \uC2DC\uBBAC\uB808\uC774\uC158 \uBC18\uC601");
    expect(labels.s5ParamLinkage("ramp", ctx("s5_plan")).detail).toBe("S5 \uBBF8\uC5F0\uB3D9 \u2014 \uC0AC\uB78C\uC774 \uC785\uB825(S5 \uC778\uB825 \uD22C\uC785 \uC77C\uC815\uACFC \uB2E4\uB978 \uAC1C\uB150)");
    // iterations: derived from the real numbers (no hardcoded 500), compact
    expect(labels.s5ParamLinkage("iterations", ctx("s5_plan", { drawCount: 500 })).detail).toBe("S5 \uC2E4\uD589 500\uD68C / S8 2,000\uD68C \u2014 \uD55C \uD45C\uBCF8 4\uD68C \uC7AC\uC0AC\uC6A9");
    expect(labels.s5ParamLinkage("iterations", ctx("s5_plan", { drawCount: 2000 })).detail).toBe("S5 \uC2E4\uD589 2,000\uD68C / S8 2,000\uD68C \u2014 \uD55C \uD45C\uBCF8 1\uD68C \uC7AC\uC0AC\uC6A9");
    expect(labels.s5ParamLinkage("iterations", ctx("s5_plan", { drawCount: 800 }, 2000)).detail).toBe("S5 \uC2E4\uD589 800\uD68C / S8 2,000\uD68C \u2014 \uD55C \uD45C\uBCF8 \uC57D 2.5\uD68C \uC7AC\uC0AC\uC6A9");
    expect(labels.s5ParamLinkage("iterations", ctx("s5_plan", null)).detail).toContain("\uD655\uC815\uB41C S5 \uC2DC\uBBAC\uB808\uC774\uC158 \uC2E4\uD589 \uC5C6\uC74C");
    for (const k of ["capture", "opex", "capex", "initial", "sigma", "iterations", "ramp"] as const) {
      expect(labels.s5ParamLinkage(k, ctx("s5_plan", { drawCount: 500 })).detail).not.toContain("\uAC00\uC815\uAC12");
    }
  });

  test("S5ConnectBlock resolves flat components.s5Linkage.* keys through the ROOT translator (not the scoped one)", () => {
    // Regression (T3-6): the block's `t` is scoped to stages.s8.s5ConnectBlock — full flat keys
    // resolved through it fell back to the raw key. Every key the lib emits must (a) resolve
    // against the ROOT ko catalog and (b) be resolved in the component via the root `tr`.
    const keys = new Set<string>(Object.values(labels.BASIS_LABEL));
    keys.add(labels.s5BasisHintKey("s5_plan")!);
    for (const link of ["pinned", "copy", "ratio"] as const) keys.add(labels.s5SourceLineParts(link, { id: "x", pinnedAt: "2026-01-01" }, { opexRatio: 0, capexRatio: 0, initialInvestmentRatio: 0 }).key);
    for (const b of ["ratio", "s5_plan", "s5_plan_full", "s5_pnl"] as const) for (const k of labels.s5ScopeNoteKeys(b)) keys.add(k);
    for (const k of keys) expect(lookup(k), `ko catalog must contain ${k}`).toBeTruthy();
    const src = readFileSync(join(PROJECT_ROOT, "app/web-next/components/business-case/S5ConnectBlock.tsx"), "utf-8");
    for (const flat of ["tr(BASIS_LABEL[", "tr(part.key, part.params)", "tr(BASIS_LABEL[basis] ?? basis)", "tr(hintKey)", "s5ScopeNoteKeys(basis).map((k) => tr(k))"]) {
      expect(src, `S5ConnectBlock must resolve ${flat.replace("tr(", "")} via the root translator`).toContain(flat);
    }
    // the scoped translator must never receive a full flat key
    expect(src).not.toMatch(/t\(BASIS_LABEL|t\(part\.key|t\(hintKey|map\(\(k\) => t\(k\)\)/);
  });

  test("scope note does not claim rules that are not in force", () => {
    // i18n: the scope note is a key list resolved at render — resolve through the ko stub.
    const full = labels.s5ScopeNoteKeys("s5_plan_full").map((k) => tr(k)).join(" ");
    expect(full).toContain("슬라이스 2");
    expect(full).toContain("슬라이스 3");
    expect(full).toContain("s5_pnl"); // slice 2 in force: the tail names the basis instead of "not yet applied"
    expect(full).toContain("인건비·운영비 줄에 도달");
    expect(full).not.toContain("(전체)");
    const legacy = labels.s5ScopeNoteKeys("s5_plan").map((k) => tr(k)).join(" ");
    expect(legacy).toContain("예전 기준(설비투자만)");
    expect(legacy).toContain("통합 기준으로 옮겨갑니다");
    expect(labels.s5ScopeNoteKeys("s5_plan").map((k) => tr(k)).join(" ")).toContain("설비투자 줄에만");
  });
});

describe("term rename", () => {
  const CAPTURE_RATE_KO = "\uD3EC\uD68D";
  const read = (p: string) => readFileSync(join(PROJECT_ROOT, p), "utf-8");
  test("no user-visible capture term remains; the growth source text uses the new term", () => {
    for (const f of [
      "app/web-next/components/business-case/ParamsPanel.tsx",
      "app/web-next/components/business-case/ValuationMethodology.tsx",
      "app/web-next/components/stages/BusinessCaseStage.tsx",
      "app/web-next/lib/business-case-generator.ts",
      "docs/wiki/ko/52-\uBE0C\uB77C\uC6B4\uD544\uB4DC-S8-\uC0AC\uC5C5\uC131-\uBD84\uC11D.md",
    ]) {
      expect(read(f).includes(CAPTURE_RATE_KO)).toBe(false);
    }
    expect(read("app/web-next/lib/business-case-generator.ts")).toContain("\uC2DC\uC7A5\uADDC\uBAA8 \u00D7 \uC2DC\uC7A5\uC810\uC720\uC728");
    // i18n: the placeholder moved to the catalog (stages.s8.paramsPanel.marketShareRatioEG).
    expect(read("app/web-next/components/business-case/ParamsPanel.tsx")).toContain('t("marketShareRatioEG")');
    // and the ko catalog value itself is pinned (koOf precedent), so an accidental
    // catalog edit that changes the rendered placeholder fails here
    const koCatalog = JSON.parse(read("app/web-next/locales/ko.json"));
    const koOf = (key: string): string =>
      key.split(".").reduce<unknown>((acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), koCatalog) as string;
    expect(koOf("stages.s8.paramsPanel.marketShareRatioEG")).toBe(
      "1\uB144\uCC28 \uC2DC\uC7A5\uC810\uC720\uC728 (\uBE44\uC728, \uC608: 0.005)",
    );
  });
});
