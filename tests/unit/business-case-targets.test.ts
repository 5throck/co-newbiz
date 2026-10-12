// @version 1.0.0
/**
 * S8 brownfield multi-target feasibility — ADR-0143 regression.
 *
 * Proves, against the REAL route handlers and the real scratch SQLite:
 *  (a) generation produces one case set PER SHORTLISTED TARGET (3 scenarios
 *      × market_forward × N targets), each model carrying target_id, with
 *      genuinely different numbers per target (seed = project:target:scenario);
 *  (b) the S8 completion predicate is track-aware: brownfield blocks until
 *      EVERY shortlisted target is analyzed AND the human target-selection
 *      record exists;
 *  (c) target selection is a human analyst+ act (viewer 403, non-member 404,
 *      rationale mandatory, shortlist membership enforced) that finalizes
 *      md_project.company_id, and the latest record wins on re-selection;
 *  (d) boundary #2 holds on the target axis: adoption is rejected before a
 *      selection exists and outside the selected target, allowed within it;
 *  (e) the comparison read model flags exactly one RECOMMENDED target.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-business-case-targets.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS = "deterministic";

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
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");
const { flagRecommendedTarget, recommendTargetsFromDb, enginesMixedAcrossTargets, crossCheckOfNote, XCHECK_DIVERGENCE_WARN_RATIO, ACQUISITION_EV_REVENUE_BAND, resolveConfirmedEvBand, recordEvRevenueBand, recordBusinessCaseParams, evRevenueBandPayload, EV_BAND_OPTIMISM_FLAG_FACTOR, EV_BAND_MAX_SANE, EV_BAND_RATIONALE_MAX, EV_BAND_SOURCE_MAX, EV_BAND_SPREAD_FLAG_RATIO, EV_BAND_STALE_DAYS, validateEvBandInput } = await import("../../app/web-next/lib/business-case-generator.ts");

const NOW = new Date().toISOString();
const NOXC = { xcheckFadeNpv: null, xcheckFadeIrr: null, xcheckDivergence: null, structureMismatch: false, acqEvRevenue: null, acqEvRevenueInBand: null, acqEvBandSource: "none" as const };

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const ANALYST = "bf-analyst";
const VIEWER = "bf-viewer";
const OUTSIDER = "bf-outsider";
let analystCookie = "";
let viewerCookie = "";
let outsiderCookie = "";
let projectId = "";
let targetAId = "";
let targetBId = "";

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-bf-analyst-1", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-bf-viewer-12", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  await createUser(db, { userId: OUTSIDER, role: "analyst", password: "pw-bf-outsider", createdBy: "test", now: NOW });
  approveUser(db, { userId: OUTSIDER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie(ANALYST, "pw-bf-analyst-1");
  viewerCookie = await loginCookie(VIEWER, "pw-bf-viewer-12");
  outsiderCookie = await loginCookie(OUTSIDER, "pw-bf-outsider");

  // Promote a brownfield opportunity carrying TWO shortlisted targets.
  const oppId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [oppId, "BF 다중 대상 기회", "테스트 산업", "selected", ANALYST, NOW],
  );
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)",
    [ulid(), oppId, "brownfield", "m_and_a", "test route", ANALYST, NOW],
  );
  for (const gate of ["screening", "pre_fs", "target_screening"]) {
    db.run(
      "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), "opportunity", oppId, gate, "go", "test", ANALYST, NOW],
    );
  }
  targetAId = ulid();
  targetBId = ulid();
  db.run(
    `INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?), (?,?,?,?,?,?,?)`,
    [targetAId, oppId, "대상A", "shortlisted", 1, NOW, NOW, targetBId, oppId, "대상B", "shortlisted", 2, NOW, NOW],
  );
  // Promotion binds rank-1 (대상A) as the PROVISIONAL company (ADR-0143).
  projectId = promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "BF S8 test" }).project.id;
});

afterAll(async () => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("S8 brownfield per-target generation (ADR-0143)", () => {
  test("(a) one case set per shortlisted target — target axis on every model", async () => {
    const res = await req(`/api/projects/${projectId}/business-case/generate`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const { runId } = (await res.json()).data as { runId: string };

    const models = db
      .query("SELECT id, name, target_id, variant FROM business_case_model WHERE project_id = ? ORDER BY created_at, id")
      .all(projectId) as Array<{ id: string; name: string; target_id: string | null; variant: string }>;
    // 2 targets × 3 scenarios × market_forward (no company facts → no historical variant).
    expect(models.length).toBe(6);
    for (const m of models) expect(m.target_id === targetAId || m.target_id === targetBId).toBe(true);
    expect(models.filter((m) => m.target_id === targetAId).length).toBe(3);
    expect(models.filter((m) => m.target_id === targetBId).length).toBe(3);
    expect(models[0].name).toContain("대상A");

    // Same scenario across different targets → genuinely different numbers
    // (seed = project:target:scenario), reproducible (note carries the seed).
    // Each model is scenario-specific (ADR-0098): its sims carry ITS scenario,
    // so per model we read its own scenario's p50 row.
    const scenariosByTarget = new Map<string, Set<string>>();
    const baseP50ByTarget = new Map<string, number>();
    for (const m of models) {
      const sims = db
        .query("SELECT scenario, percentile, npv_krw_m, note FROM valuation_simulation WHERE model_id = ?")
        .all(m.id) as Array<{ scenario: string; percentile: string; npv_krw_m: number; note: string }>;
      expect(sims.length).toBe(3);
      const scenarioSet = new Set(sims.map((s) => s.scenario));
      expect(scenarioSet.size).toBe(1);
      const scenario = [...scenarioSet][0];
      if (!scenariosByTarget.has(m.target_id!)) scenariosByTarget.set(m.target_id!, new Set());
      scenariosByTarget.get(m.target_id!)!.add(scenario);
      const p50 = sims.find((s) => s.percentile === "p50")!;
      expect(p50.note).toContain("seed=");
      if (scenario === "base") baseP50ByTarget.set(m.target_id!, p50.npv_krw_m);
    }
    for (const t of [targetAId, targetBId]) expect(scenariosByTarget.get(t)).toEqual(new Set(["base", "upside", "downside"]));
    // GENUINELY different numbers across targets for the same scenario.
    expect(baseP50ByTarget.get(targetAId)).not.toBe(baseP50ByTarget.get(targetBId));

    // Run status route: activity ids carry the target subject prefix.
    const status = await req(`/api/projects/${projectId}/business-case/generate/${runId}`, { headers: { cookie: analystCookie } });
    const st = (await status.json()).data as { status: string; activities: Array<{ activityId: string; status: string }>; cases: unknown[] };
    expect(st.status).toBe("done");
    expect(st.activities.length).toBe(24); // 2 targets × 3 scenarios × 4 steps
    // D6: the activity id carries the unique target id — the company name
    // ("대상A") is not unique across opportunities and must not key the id.
    expect(st.activities.find((a) => a.activityId.startsWith(`${targetAId}/base:market_forward:growth_projection`))).toBeTruthy();
    expect(st.cases.length).toBe(6);
  });

  test("(b) S8 completion is track-aware — all targets analyzed + human selection", async () => {
    // Generation covered both targets, but no target selection yet → blocked,
    // and the blocker names the missing selection record.
    const noSelection = evaluateProcess({ type: "project", id: projectId });
    expect(noSelection.completedStages).not.toContain("S8");
    expect(noSelection.blockers.join()).toContain("대상 선정");

    // A third target added post-promotion (late shortlist edit) re-blocks S8:
    // every shortlisted target must be analyzed.
    const targetCId = ulid();
    db.run(
      "INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      [targetCId, (db.query("SELECT source_opportunity_id FROM md_project WHERE id = ?").get(projectId) as { source_opportunity_id: string }).source_opportunity_id, "대상C", "shortlisted", 3, NOW, NOW],
    );
    const withC = evaluateProcess({ type: "project", id: projectId });
    expect(withC.completedStages).not.toContain("S8");
    expect(withC.blockers.join()).toContain("대상C");
    expect(withC.blockers.join()).toContain("대상C]의 Business Case");

    // Analyze C via the manual write path — now through the API (ADR-0143:
    // manual CRUD accepts a validated shortlist target_id, so late shortlist
    // edits are recoverable without direct DB writes).
    const offList = await req(`/api/projects/${projectId}/business-case`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ name: "부정 케이스", target_id: ulid() }),
    });
    expect(offList.status).toBe(400);
    const create = await req(`/api/projects/${projectId}/business-case`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ name: "수동 — 대상C", kind: "valuation", target_id: targetCId }),
    });
    expect(create.status).toBe(201);
    const manualModelId = ((await create.json()).data as { id: string }).id;
    db.run("UPDATE business_case_model SET inputs_json = ? WHERE id = ?", ["{}", manualModelId]);
    db.run(
      "INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, bep_year, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), projectId, manualModelId, "base", "p50", 42, 2.5, NOW],
    );
    const withCAnalyzed = evaluateProcess({ type: "project", id: projectId });
    expect(withCAnalyzed.completedStages).not.toContain("S8");
    expect(withCAnalyzed.blockers.join()).not.toContain("대상C");
    expect(withCAnalyzed.blockers.join()).toContain("대상 선정");

    // Human target selection flips the last blocker → S8 completes.
    const sel = await req(`/api/projects/${projectId}/target-selection`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ target_id: targetAId, rationale: "p05 생존 관점 최고" }),
    });
    expect(sel.status).toBe(201);
    const done = evaluateProcess({ type: "project", id: projectId });
    expect(done.completedStages).toContain("S8");
  });

  test("(c) selection is human-only, rationale-mandatory, shortlist-bound, finalizes company_id", async () => {
    // (Uses the post-(b) state: targetA already selected in (b).)
    const companyId = (db.query("SELECT company_id FROM md_project WHERE id = ?").get(projectId) as { company_id: string | null }).company_id;
    expect(companyId).toBeTruthy();

    // Viewer cannot select (boundary #2).
    const viewerRes = await req(`/api/projects/${projectId}/target-selection`, {
      method: "POST",
      headers: { cookie: viewerCookie },
      body: JSON.stringify({ target_id: targetBId, rationale: "viewer 시도" }),
    });
    expect(viewerRes.status).toBe(403);

    // Non-member 404 (deny-by-default).
    const outsiderRes = await req(`/api/projects/${projectId}/target-selection`, {
      method: "POST",
      headers: { cookie: outsiderCookie },
      body: JSON.stringify({ target_id: targetBId, rationale: "outsider 시도" }),
    });
    expect(outsiderRes.status).toBe(404);

    // Rationale is mandatory (ADR-0053 decision record).
    const noRationale = await req(`/api/projects/${projectId}/target-selection`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ target_id: targetBId, rationale: "  " }),
    });
    expect(noRationale.status).toBe(400);

    // Off-shortlist target is rejected.
    const offShortlist = await req(`/api/projects/${projectId}/target-selection`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ target_id: ulid(), rationale: "없는 대상" }),
    });
    expect(offShortlist.status).toBe(400);

    // Re-selection is allowed — the latest record wins and company_id follows.
    const reselect = await req(`/api/projects/${projectId}/target-selection`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ target_id: targetBId, rationale: "DD 대기 후 재검토로 B 선정" }),
    });
    expect(reselect.status).toBe(201);
    const newCompanyId = (db.query("SELECT company_id FROM md_project WHERE id = ?").get(projectId) as { company_id: string | null }).company_id;
    expect(newCompanyId).not.toBeNull();
    const list = await req(`/api/projects/${projectId}/business-case`, { headers: { cookie: analystCookie } });
    const data = (await list.json()).data as { target_selection: { targetId: string } };
    expect(data.target_selection?.targetId).toBe(targetBId);
    expect(newCompanyId).not.toBe(companyId ?? null);
  });

  test("(d) adoption is constrained to the selected target's cases", async () => {
    const modelOf = (targetId: string) =>
      (db.query("SELECT id FROM business_case_model WHERE project_id = ? AND target_id = ? LIMIT 1").get(projectId, targetId) as { id: string }).id;

    // State: targetB selected (from (c) re-selection). Adopting targetA's
    // case is rejected with a 400 naming the constraint.
    const wrongTarget = await req(`/api/projects/${projectId}/business-case/adopt`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ model_id: modelOf(targetAId) }),
    });
    expect(wrongTarget.status).toBe(400);

    // Adopting the selected target's case is the only allowed path.
    const adopt = await req(`/api/projects/${projectId}/business-case/adopt`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ model_id: modelOf(targetBId), goals_ack: { acknowledged: true, note: "test: 목표 비교 없이 진행" } }),
    });
    expect(adopt.status).toBe(201);
    const list = await req(`/api/projects/${projectId}/business-case`, { headers: { cookie: analystCookie } });
    const data = (await list.json()).data as { adoption: { modelId: string } | null; targets: Array<{ targetId: string; recommended: boolean; caseCount: number }> };
    expect(data.adoption?.modelId).toBe(modelOf(targetBId));

    // (e) exactly one RECOMMENDED target on the comparison read model.
    const recommended = data.targets.filter((t) => t.recommended);
    expect(recommended.length).toBe(1);
    expect(data.targets.length).toBe(3); // A, B, C — every shortlisted target
    expect(data.targets.every((t) => t.caseCount >= 0)).toBe(true);
  });

  test("(f) error taxonomy — NotFoundError maps to 404, constraint violations stay 400", async () => {
    // D5: unknown model on adopt → lib throws NotFoundError → route maps via
    // instanceof to 404 (previously matched by msg.startsWith("business case ")).
    const unknownModel = await req(`/api/projects/${projectId}/business-case/adopt`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ model_id: "no-such-model" }),
    });
    expect(unknownModel.status).toBe(404);

    // D5: ADR-0143 constraint violation (wrong target) stays a client-fixable
    // 400 — the instanceof 404 mapping must not swallow it.
    const modelOf = (targetId: string) =>
      (db.query("SELECT id FROM business_case_model WHERE project_id = ? AND target_id = ? LIMIT 1").get(projectId, targetId) as { id: string }).id;
    const wrongTarget = await req(`/api/projects/${projectId}/business-case/adopt`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ model_id: modelOf(targetAId) }),
    });
    expect(wrongTarget.status).toBe(400);

    // D5: off-shortlist selection stays 400 (selection_rejected path).
    const offShortlist = await req(`/api/projects/${projectId}/target-selection`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ target_id: ulid(), rationale: "없는 대상" }),
    });
    expect(offShortlist.status).toBe(400);
  });

  test("flagRecommendedTarget: positive pool first, then max p05 (pure rule)", () => {
    const rows = [
      { targetId: "t1", companyName: "A", rank: 1, baseP05: -5, baseP50: 10, irr: 0.1, caseCount: 3, engine: null, anchorMethod: null, recommended: false, ...NOXC },
      { targetId: "t2", companyName: "B", rank: 2, baseP05: 3, baseP50: 12, irr: 0.2, caseCount: 3, engine: null, anchorMethod: null, recommended: false, ...NOXC },
      { targetId: "t3", companyName: "C", rank: 3, baseP05: 1, baseP50: 30, irr: 0.3, caseCount: 3, engine: null, anchorMethod: null, recommended: false, ...NOXC },
    ];
    const flagged = flagRecommendedTarget(rows);
    expect(flagged[0].targetId).toBe("t2"); // positive pool, max p05 — not the max p50
    expect(flagged.filter((r) => r.recommended).length).toBe(1);
  });
});

describe("D2 engine provenance on the target comparison", () => {
  function setEngine(targetId: string, engine: string) {
    db.run(
      `UPDATE valuation_simulation SET note = REPLACE(note, SUBSTR(note, INSTR(note, 'engine='), INSTR(SUBSTR(note, INSTR(note, 'engine=')), ';') - 1), ?)
       WHERE model_id IN (SELECT id FROM business_case_model WHERE project_id = ? AND target_id = ?)`,
      [`engine=${engine}`, projectId, targetId],
    );
  }
  const snapshot = () => recommendTargetsFromDb(projectId).map((r) => ({ id: r.targetId, rank: r.rank, rec: r.recommended, p05: r.baseP05 }));

  test("python-only, fallback-only and mixed; ranking untouched", () => {
    setEngine(targetAId, "python-sim-engine@1.0.0");
    setEngine(targetBId, "python-sim-engine@1.0.0");
    const before = snapshot();
    const ab = () => recommendTargetsFromDb(projectId).filter((r) => r.targetId === targetAId || r.targetId === targetBId);
    let rows = ab();
    expect(rows.every((r) => r.engine === "python-sim-engine")).toBe(true);
    expect(enginesMixedAcrossTargets(rows)).toBe(false);

    setEngine(targetAId, "inline-ts");
    setEngine(targetBId, "inline-ts");
    rows = ab();
    expect(rows.every((r) => r.engine === "ts-fallback")).toBe(true);
    expect(enginesMixedAcrossTargets(rows)).toBe(false);

    setEngine(targetBId, "python-sim-engine@1.0.0");
    rows = ab();
    expect(new Set(rows.map((r) => r.engine))).toEqual(new Set(["ts-fallback", "python-sim-engine"]));
    expect(enginesMixedAcrossTargets(rows)).toBe(true);
    expect(snapshot()).toEqual(before);
  });

  test("a target whose own cases mix engines is 'mixed'; flagRecommendedTarget stays pure", () => {
    const base = { rank: 1, baseP05: 1, baseP50: 2, irr: 0.1, caseCount: 1, anchorMethod: "company_revenue" as const, recommended: false, ...NOXC };
    const rows = [
      { ...base, targetId: "a", companyName: "A", engine: "mixed" as const },
      { ...base, targetId: "b", companyName: "B", engine: null },
    ];
    expect(enginesMixedAcrossTargets(rows)).toBe(true);
    const frozen = JSON.stringify(rows);
    const out = flagRecommendedTarget(rows);
    expect(JSON.stringify(rows)).toBe(frozen);
    expect(out[0]).not.toBe(rows[0]);
  });
});

describe("S8 fade-DCF cross-check and acquisition benchmark (display-only)", () => {
  // Built exactly the way the generator builds the p50 note fragments.
  const genNote = (npv: number, irr: number | null, ev: number) =>
    `seed=1; revenue_anchor=company; acq_ev=${ev.toFixed(2)}x; exit_ev=${ev.toFixed(2)}x; xcheck=fade-dcf; xcheck_horizon=10; xcheck_terminal_growth=0.0300; xcheck_fade_npv=${npv.toFixed(2)}; xcheck_fade_irr=${irr != null ? irr.toFixed(4) : "null"}; engine=python-sim-engine`;
  const row = (id: string, p05: number, p50: number, fade: number | null, ev: number | null, rank = 1) => {
    const div = fade !== null && p50 !== 0 ? (fade - p50) / Math.abs(p50) : null;
    return {
      targetId: id, companyName: id, rank, baseP05: p05, baseP50: p50, irr: 0.1, caseCount: 1, engine: null, anchorMethod: null, recommended: false,
      xcheckFadeNpv: fade, xcheckFadeIrr: null, xcheckDivergence: div, structureMismatch: false,
      acqEvRevenue: ev, acqEvRevenueInBand: null, acqEvBandSource: "none" as const,
    };
  };

  test("UI-mirrored constants match the generator", async () => {
    const src = await Bun.file("app/web-next/components/stages/BusinessCaseStage.tsx").text();
    const warn = /const XCHECK_WARN_PCT = (\d+(?:\.\d+)?);/.exec(src);
    const band = /const ACQ_BAND = \{ min: (\d+(?:\.\d+)?), max: (\d+(?:\.\d+)?) \}/.exec(src);
    expect(warn).not.toBeNull();
    expect(band).not.toBeNull();
    expect(Number(warn![1]) / 100).toBe(XCHECK_DIVERGENCE_WARN_RATIO);
    expect({ min: Number(band![1]), max: Number(band![2]) }).toEqual(ACQUISITION_EV_REVENUE_BAND);
  });

  test("ParamsPanel EV-band mirrored constants match the generator", async () => {
    const src = await Bun.file("app/web-next/components/business-case/ParamsPanel.tsx").text();
    const factor = /const EV_BAND_OPTIMISM_FLAG_FACTOR = (\d+(?:\.\d+)?);/.exec(src);
    const sane = /const EV_BAND_MAX_SANE = (\d+(?:\.\d+)?);/.exec(src);
    const ref = /const EV_BAND_REF = \{ min: (\d+(?:\.\d+)?), max: (\d+(?:\.\d+)?) \}/.exec(src);
    const spread = /const EV_BAND_SPREAD_FLAG_RATIO = (\d+(?:\.\d+)?);/.exec(src);
    expect(factor && sane && ref && spread).toBeTruthy();
    const gen = await import("../../app/web-next/lib/business-case-generator.ts");
    expect(Number(factor![1])).toBe(gen.EV_BAND_OPTIMISM_FLAG_FACTOR);
    expect(Number(sane![1])).toBe(gen.EV_BAND_MAX_SANE);
    expect(Number(spread![1])).toBe(gen.EV_BAND_SPREAD_FLAG_RATIO);
    expect({ min: Number(ref![1]), max: Number(ref![2]) }).toEqual(ACQUISITION_EV_REVENUE_BAND);
  });

  test("BusinessCaseStage renders band review warnings (display only)", async () => {
    const src = await Bun.file("app/web-next/components/stages/BusinessCaseStage.tsx").text();
    const gen = await import("../../app/web-next/lib/business-case-generator.ts");
    expect(src).toContain(`&gt; ${gen.EV_BAND_SPREAD_FLAG_RATIO}배`);
    expect(src).toContain("evBand?.spreadFlag");
    expect(src).toContain("evBand?.stale");
    expect(src).toContain("data.target_selection.selectedBy === evBand.confirmed.confirmedBy");
    expect(src).toContain("재확인 필요");
    expect(src).toContain("(참고 표시)");
    expect(src).not.toContain("범위 내</");
    expect(src).toContain("평가 기준이 다른 대상 간에는 밴드 판정을 비교할 수 없습니다");
  });

  test("constants", () => {
    expect(XCHECK_DIVERGENCE_WARN_RATIO).toBe(0.5);
    expect(ACQUISITION_EV_REVENUE_BAND).toEqual({ min: 2, max: 6 });
  });

  test("crossCheckOfNote parses the generator format, incl. irr=null", () => {
    expect(crossCheckOfNote(genNote(1234.5, 0.1234, 3))).toEqual({ fadeNpv: 1234.5, fadeIrr: 0.1234, acqEvRevenue: 3 });
    expect(crossCheckOfNote(genNote(-80.25, null, 2.5))).toEqual({ fadeNpv: -80.25, fadeIrr: null, acqEvRevenue: 2.5 });
  });

  test("crossCheckOfNote returns all-null for market-capture, null and garbage notes (never 0)", () => {
    const empty = { fadeNpv: null, fadeIrr: null, acqEvRevenue: null };
    expect(crossCheckOfNote("seed=1; capture_rate=0.05; capture_source=default; engine=x")).toEqual(empty);
    expect(crossCheckOfNote(null)).toEqual(empty);
    expect(crossCheckOfNote("xcheck_fade_npv=abc; xcheck_fade_irr=; acq_ev=NaNx")).toEqual(empty);
    expect(crossCheckOfNote("xcheck_fade_npv=Infinity; acq_ev=x")).toEqual(empty);
  });

  test("divergence sign and zero p50", () => {
    expect(row("a", 1, 1000, 1300, 3).xcheckDivergence).toBeCloseTo(0.3);
    expect(row("a", 1, 1000, 400, 3).xcheckDivergence).toBeCloseTo(-0.6);
    expect(row("a", 1, 0, 400, 3).xcheckDivergence).toBeNull();
    expect(row("a", 1, -1000, -500, 3).xcheckDivergence).toBeCloseTo(0.5);
  });

  test("structureMismatch only on the starred row; ranking invariant", () => {
    const rows = [row("best", 50, 1000, 400, 3, 2), row("other", 10, 1000, 100, 3, 1), row("clean", 5, 1000, 1300, 3, 3)];
    const out = flagRecommendedTarget(rows);
    expect(out.map((r) => r.targetId)).toEqual(["best", "other", "clean"]); // same order as pre-change rule
    expect(out[0].recommended).toBe(true);
    expect(out[0].structureMismatch).toBe(true); // -0.6
    expect(out.slice(1).every((r) => !r.structureMismatch)).toBe(true); // other is -0.9 but not starred
    const ok = flagRecommendedTarget([row("x", 50, 1000, 1300, 3)]);
    expect(ok[0].structureMismatch).toBe(false);
    const boundary = flagRecommendedTarget([row("x", 50, 1000, 500, 3)]); // exactly -0.5 -> not > threshold
    expect(boundary[0].structureMismatch).toBe(false);
  });

  test("no cross-check: nulls, no mismatch, still recommendable", () => {
    const out = flagRecommendedTarget([row("n", 50, 1000, null, null)]);
    expect(out[0].recommended).toBe(true);
    expect(out[0].xcheckFadeNpv).toBeNull();
    expect(out[0].xcheckDivergence).toBeNull();
    expect(out[0].structureMismatch).toBe(false);
    expect(out[0].acqEvRevenueInBand).toBeNull();
  });

  test("out-of-high-multiple target stays recommendable", () => {
    const out = flagRecommendedTarget([row("out", 50, 1000, 1000, 9), row("in", 10, 1000, 1000, 3)]);
    expect(out[0].targetId).toBe("out");
    expect(out[0].recommended).toBe(true);
  });

  test("recommendTargetsFromDb populates fields from the latest base model's p50 note only", () => {
    const before = recommendTargetsFromDb(projectId).map((r) => ({ id: r.targetId, rank: r.rank, rec: r.recommended, p05: r.baseP05 }));
    const modelOf = (t: string) =>
      (db.query("SELECT m.id FROM business_case_model m WHERE m.project_id = ? AND m.target_id = ? AND m.archived_at IS NULL AND COALESCE(m.variant,'market_forward')='market_forward' AND EXISTS (SELECT 1 FROM valuation_simulation v WHERE v.model_id = m.id AND v.scenario='base') ORDER BY m.created_at DESC, m.id DESC").get(projectId, t) as { id: string }).id;
    const mid = modelOf(targetAId);
    const p50 = (db.query("SELECT npv_krw_m FROM valuation_simulation WHERE model_id = ? AND scenario='base' AND percentile='p50'").get(mid) as { npv_krw_m: number }).npv_krw_m;
    // p05 note carries a decoy that must be ignored.
    db.run("UPDATE valuation_simulation SET note = ? WHERE model_id = ? AND scenario='base' AND percentile='p05'", [genNote(999999, 0.9, 9), mid]);
    db.run("UPDATE valuation_simulation SET note = ? WHERE model_id = ? AND scenario='base' AND percentile='p50'", [genNote(p50 * 0.4, 0.07, 6), mid]);
    const a = recommendTargetsFromDb(projectId).find((r) => r.targetId === targetAId)!;
    expect(a.xcheckFadeNpv).toBeCloseTo(p50 * 0.4, 1);
    expect(a.xcheckFadeIrr).toBeCloseTo(0.07);
    expect(a.xcheckDivergence).toBeCloseTo(-0.6, 2);
    expect(a.acqEvRevenue).toBe(6);
    expect(a.acqEvRevenueInBand).toBeNull(); // no confirmed band -> never judged against the global band
    expect(a.acqEvBandSource).toBe("none");
    const b = recommendTargetsFromDb(projectId).find((r) => r.targetId === targetBId)!;
    expect(b.structureMismatch).toBe(false);
    const after = recommendTargetsFromDb(projectId).map((r) => ({ id: r.targetId, rank: r.rank, rec: r.recommended, p05: r.baseP05 }));
    expect(after).toEqual(before);
    expect(a.structureMismatch).toBe(a.recommended && Math.abs(a.xcheckDivergence!) > 0.5);
  });
});

describe("S8 human-confirmed EV/Revenue band (design 2026-10-11-s8-ev-band-user-confirmed)", () => {
  const bandRoute = (cookie: string, body: unknown) =>
    req(`/api/projects/${projectId}/business-case/ev-band`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
  const good = { min: 4, max: 8, rationale: "service robot comps reviewed by analyst", source: "management judgement: analyst" };
  const setTargetEv = (targetId: string, ev: number) => {
    const mid = (db.query("SELECT m.id FROM business_case_model m WHERE m.project_id = ? AND m.target_id = ? AND m.archived_at IS NULL AND COALESCE(m.variant,'market_forward')='market_forward' AND EXISTS (SELECT 1 FROM valuation_simulation v WHERE v.model_id = m.id AND v.scenario='base') ORDER BY m.created_at DESC, m.id DESC").get(projectId, targetId) as { id: string }).id;
    db.run("UPDATE valuation_simulation SET note = ? WHERE model_id = ? AND scenario='base' AND percentile='p50'", [`seed=1; acq_ev=${ev.toFixed(2)}x; engine=python-sim-engine`, mid]);
  };
  const snapshot = () => recommendTargetsFromDb(projectId).map((r) => ({ id: r.targetId, rank: r.rank, rec: r.recommended, p05: r.baseP05 }));

  test("1-null: nothing confirmed -> inBand null even with acq 3.0 (regression), source none", () => {
    setTargetEv(targetAId, 3.0);
    const a = recommendTargetsFromDb(projectId).find((r) => r.targetId === targetAId)!;
    expect(a.acqEvRevenue).toBe(3);
    expect(a.acqEvRevenueInBand).toBeNull();
    expect(a.acqEvBandSource).toBe("none");
    expect(resolveConfirmedEvBand(db, projectId)).toBeNull();
    expect(evRevenueBandPayload(null).optimismFlag).toBe(false);
    expect(evRevenueBandPayload(null).reference).toEqual({ min: 2, max: 6, label: "global robotics/automation M&A screening band", sourced: false });
  });

  test("validation rejects bad input", async () => {
    const bad: Array<Record<string, unknown>> = [
      { ...good, min: 0 }, { ...good, min: 5, max: 5 }, { ...good, min: 9, max: 5 }, { ...good, min: Number.NaN },
      { ...good, max: Infinity }, { ...good, max: EV_BAND_MAX_SANE + 1 }, { ...good, rationale: "   " }, { ...good, rationale: "short" }, { ...good, source: "" },
    ];
    for (const b of bad) {
      await expect(recordEvRevenueBand(db, { projectId, ...(b as typeof good), actor: ANALYST })).rejects.toThrow();
    }
    expect(resolveConfirmedEvBand(db, projectId)).toBeNull();
    // route-level: NaN/Infinity cannot be JSON, so strings/missing fields are 400
    expect((await bandRoute(analystCookie, { ...good, min: "4" })).status).toBe(400);
    expect((await bandRoute(analystCookie, { ...good, source: "ab" })).status).toBe(400);
    expect((await bandRoute(analystCookie, { ...good, max: 51 })).status).toBe(400);
  });

  test("role gate: viewer 403, outsider 404, analyst 201 and audited", async () => {
    expect((await bandRoute(viewerCookie, good)).status).toBe(403);
    expect((await bandRoute(outsiderCookie, good)).status).toBe(404);
    const before = snapshot();
    const res = await bandRoute(analystCookie, good);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { evRevenueBand: { confirmed: { min: number; max: number; confirmedBy: string; source: string; rationale: string } | null; optimismFlag: boolean } } };
    expect(body.data.evRevenueBand.confirmed).toMatchObject({ min: 4, max: 8, confirmedBy: ANALYST, source: good.source, rationale: good.rationale });
    expect(body.data.evRevenueBand.optimismFlag).toBe(false);
    const audits = db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'assumption_set' AND target LIKE '%bc.acquisition_ev_revenue_band.%'").get() as { n: number };
    expect(audits.n).toBe(2);
    expect(snapshot()).toEqual(before); // display-only invariant
  });

  test("4: confirmed 4-8 -> 3.0 false, 5.0 true, inclusive boundaries; ranking unchanged", () => {
    const before = snapshot();
    const inBand = (ev: number) => {
      setTargetEv(targetAId, ev);
      return recommendTargetsFromDb(projectId).find((r) => r.targetId === targetAId)!;
    };
    expect(inBand(3.0).acqEvRevenueInBand).toBe(false);
    expect(inBand(5.0).acqEvRevenueInBand).toBe(true);
    expect(inBand(4.0).acqEvRevenueInBand).toBe(true);
    expect(inBand(8.0).acqEvRevenueInBand).toBe(true);
    expect(inBand(8.01).acqEvRevenueInBand).toBe(false);
    expect(inBand(5.0).acqEvBandSource).toBe("confirmed");
    expect(snapshot()).toEqual(before);
  });

  test("latest run wins; half-written (min-only) newer run is ignored", async () => {
    await recordEvRevenueBand(db, { projectId, min: 3, max: 7, rationale: "second confirmation rationale", source: "src two", actor: ANALYST, now: new Date(Date.now() + 5000).toISOString() });
    expect(resolveConfirmedEvBand(db, projectId)).toMatchObject({ min: 3, max: 7, source: "src two" });
    const { createRun } = await import("../../db/lib/versioning.ts");
    const { recordAssumption } = await import("../../db/lib/assumption.ts");
    const later = new Date(Date.now() + 10000).toISOString();
    const run = createRun(db, { projectId, label: "half", createdBy: ANALYST, overrides: {}, now: later });
    recordAssumption(db, { runId: run.run_id, assumptionKey: "bc.acquisition_ev_revenue_band.min", kind: "user", value: 1, asOf: later.slice(0, 10), rationale: "orphan min only", anchorRef: "x", actor: ANALYST, now: later });
    expect(resolveConfirmedEvBand(db, projectId)).toMatchObject({ min: 3, max: 7 });
  });

  test("5: optimismFlag true at max 9.01, false at 9", () => {
    expect(EV_BAND_OPTIMISM_FLAG_FACTOR * ACQUISITION_EV_REVENUE_BAND.max).toBe(9);
    const mk = (max: number) => evRevenueBandPayload({ min: 2, max, rationale: "r", source: "s", confirmedBy: "u", confirmedAt: "t", runId: "x" }).optimismFlag;
    expect(mk(9.01)).toBe(true);
    expect(mk(9)).toBe(false);
  });

  test("6: general params route and recordBusinessCaseParams reject band keys; GET shows band read-only", async () => {
    const res = await req(`/api/projects/${projectId}/business-case/params`, {
      method: "POST", headers: { cookie: analystCookie },
      body: JSON.stringify({ params: { acquisition_ev_revenue_band_min: 1 }, rationale: "try to write band via params" }),
    });
    expect(res.status).toBe(400);
    await expect(recordBusinessCaseParams(db, { projectId, params: { acquisition_ev_revenue_band_max: 99 } as never, rationale: "x", actor: ANALYST })).rejects.toThrow(/ev-band/);
    const get = await req(`/api/projects/${projectId}/business-case/params`, { headers: { cookie: analystCookie } });
    const j = (await get.json()) as { data: { params: { acquisitionEvRevenueBand: { min: number; max: number } | null } } };
    expect(j.data.params.acquisitionEvRevenueBand).toMatchObject({ min: 3, max: 7 });
  });

  test("7: ev-band is human-only and refused by the in-process port", async () => {
    const { isHumanOnly } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
    expect(isHumanOnly("POST", "/api/projects/x/business-case/ev-band", {})).toBe(true);
  });

  test("listBusinessCases exposes evRevenueBand payload", async () => {
    const { listBusinessCases } = await import("../../app/web-next/lib/business-case.ts");
    const l = listBusinessCases(projectId);
    expect(l.evRevenueBand.confirmed).toMatchObject({ min: 3, max: 7 });
    expect(l.evRevenueBand.reference.sourced).toBe(false);
    expect(l.evRevenueBand.optimismFlag).toBe(false);
  });

  test("review amendments: length caps at boundary", () => {
    expect(() => validateEvBandInput({ ...good, rationale: "r".repeat(EV_BAND_RATIONALE_MAX) })).not.toThrow();
    expect(() => validateEvBandInput({ ...good, rationale: "r".repeat(EV_BAND_RATIONALE_MAX + 1) })).toThrow(/rationale/);
    expect(() => validateEvBandInput({ ...good, source: "s".repeat(EV_BAND_SOURCE_MAX) })).not.toThrow();
    expect(() => validateEvBandInput({ ...good, source: "s".repeat(EV_BAND_SOURCE_MAX + 1) })).toThrow(/source/);
    expect(() => validateEvBandInput({ ...good, source: " ".repeat(600) + "abc" })).not.toThrow(); // cap applies after trim
  });

  test("review amendments: route 400 for oversized fields; unknown errors are generic 500", async () => {
    const res = await bandRoute(analystCookie, { ...good, rationale: "r".repeat(EV_BAND_RATIONALE_MAX + 1) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain("rationale");
    const orig = db.run.bind(db);
    (db as { run: unknown }).run = () => { throw new Error("SQLITE_SECRET_internal_detail"); };
    const origErr = console.error; console.error = () => {};
    try {
      const r = await bandRoute(analystCookie, good);
      expect(r.status).toBe(500);
      expect(JSON.stringify(await r.json())).not.toContain("SQLITE_SECRET");
    } finally {
      (db as { run: unknown }).run = orig; console.error = origErr;
    }
  });

  test("review amendments: spreadFlag boundary at exactly 4.5", () => {
    expect(EV_BAND_SPREAD_FLAG_RATIO).toBe(1.5 * (ACQUISITION_EV_REVENUE_BAND.max / ACQUISITION_EV_REVENUE_BAND.min));
    const mk = (min: number, max: number) => evRevenueBandPayload({ min, max, rationale: "r", source: "s", confirmedBy: "u", confirmedAt: new Date().toISOString(), runId: "x" }).spreadFlag;
    expect(mk(2, 9)).toBe(false); // exactly 4.5
    expect(mk(2, 9.02)).toBe(true);
    expect(mk(4, 8)).toBe(false);
    expect(evRevenueBandPayload(null).spreadFlag).toBe(false);
  });

  test("review amendments: stale at 89/90/91 days with injected now", () => {
    const at = new Date("2026-10-11T00:00:00.000Z");
    const mk = (days: number) => evRevenueBandPayload({ min: 2, max: 6, rationale: "r", source: "s", confirmedBy: "u", confirmedAt: new Date(at.getTime() - days * 86_400_000).toISOString(), runId: "x" }, at);
    expect(EV_BAND_STALE_DAYS).toBe(90);
    expect(mk(89)).toMatchObject({ stale: false, ageDays: 89 });
    expect(mk(90)).toMatchObject({ stale: true, ageDays: 90 });
    expect(mk(91)).toMatchObject({ stale: true, ageDays: 91 });
    expect(evRevenueBandPayload(null, at)).toMatchObject({ stale: false, ageDays: null });
  });

  test("review amendments: audit_log content, methodsMixed alongside band, rank invariant across none/confirmed/flagged", async () => {
    const audits = db.query("SELECT target FROM audit_log WHERE action = 'assumption_set' AND target LIKE '%bc.acquisition_ev_revenue_band.%'").all() as Array<{ target: string }>;
    expect(audits.length).toBeGreaterThanOrEqual(2);
    for (const a of audits) expect(a.target).toMatch(/^[^:]+:bc\.acquisition_ev_revenue_band\.(min|max):user$/); // run:key:kind only; values not logged
    const { listBusinessCases } = await import("../../app/web-next/lib/business-case.ts");
    const l = listBusinessCases(projectId);
    expect(typeof l.methodsMixed).toBe("boolean");
    expect(l.evRevenueBand).toBeDefined();
    const base = snapshot();
    await recordEvRevenueBand(db, { projectId, min: 1, max: 30, rationale: "optimistic wide band for invariant", source: "invariant test", actor: ANALYST, now: new Date(Date.now() + 60000).toISOString() });
    const p = evRevenueBandPayload(resolveConfirmedEvBand(db, projectId));
    expect(p.optimismFlag).toBe(true);
    expect(p.spreadFlag).toBe(true);
    expect(snapshot()).toEqual(base);
  });

  test("9: generator rationale carries the no-source relabel", async () => {
    const src = await Bun.file("app/web-next/lib/business-case-generator.ts").text();
    expect(src).toContain("이 도메인에 대한 출처 없음, 참고용");
    expect(src).not.toContain("(보수 스크리닝)");
  });
});
