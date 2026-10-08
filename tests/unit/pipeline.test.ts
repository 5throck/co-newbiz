// @version 1.0.0
/**
 * Phase 7 — industry × company end-to-end auto pipeline (ADR-0102).
 *
 * Proves, against the REAL route handlers (nextRequest harness) and the real
 * scratch SQLite:
 *  (a) BOUNDARY #2 (project CLAUDE.md non-negotiable, test-enforced): a full
 *      run on a fresh opportunity produces ZERO gate_decision rows, ZERO
 *      case adoptions, ZERO checklist approvals from the pipeline itself.
 *      Automation outputs land as PROPOSALS (S8 business cases + simulations,
 *      S9 checklist items 'proposed'); the run pauses at the first human gate
 *      with a notification row (trigger_type 'pipeline_paused', project_id
 *      NULL on the opportunity branch, set on the project branch);
 *  (b) resume: after the human confirmation is recorded through the EXISTING
 *      routes (route-decision, gate-decisions), the resume pass
 *      (resumePausedPipelines — the watch:run pass) proceeds past the gate;
 *  (c) a stage with no automation pauses (paused_for_human), never fails;
 *  (d) validation: unknown industry/company → 400, viewer → 403 on start;
 *  (e) the max-iteration safety cap fails the run (never spins silently).
 */

import { judgeAllStandardDdItems } from "./_dd-standard.ts";
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-pipeline.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const {
  startPipeline, advancePipeline, resumePausedPipelines,
} = await import("../../app/web-next/lib/pipeline.ts");
const { setBusinessCaseExecutorFactory } = await import("../../app/web-next/lib/business-case-generator.ts");

const NOW = new Date().toISOString();

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const ANALYST = "analyst1";
const VIEWER = "viewer1";
let analystCookie = "";
let viewerCookie = "";

let industryId = "";
let companyId = "";
let oppId = ""; // the full-journey opportunity
let freshOppId = ""; // the no-automation (c) opportunity

/** Insert an opportunity whose S1–S3 artifacts are complete (fields set, selected). */
function seedOpportunity(name: string, completeS1S3: boolean): string {
  const id = ulid();
  db.run(
    `INSERT INTO opportunity (id, name, market_scope, value_chain_node, market_size_krw_m, growth_rate,
       attractiveness_score, synergy_score, rationale, status, created_by, created_at, capability_gap_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, name, completeS1S3 ? "테스트 산업" : "미분석 산업", completeS1S3 ? "크랭크샤프트" : null,
      completeS1S3 ? 5000 : null, completeS1S3 ? 8.0 : null,
      completeS1S3 ? 80 : null, completeS1S3 ? 70 : null,
      completeS1S3 ? "전략적 적합성 근거" : null,
      completeS1S3 ? "selected" : "identified", ANALYST, NOW,
      completeS1S3 ? JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", source: "manual", resolution: "hire" }], updatedAt: NOW }) : null,
    ],
  );
  return id;
}

/** Seed the greenfield S5 artifacts (human work, pre-existing — not pipeline output). */
function seedGreenfieldAssessment(opportunityId: string): void {
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [ulid(), opportunityId, "직접 진출", "M&A 대안 검토", "test", ANALYST, NOW, NOW],
  );
  // ADR-0136: 역량 격차 건수는 S3 레지스터(opportunity.capability_gap_json)에서 센다.
  db.run(
    "UPDATE opportunity SET capability_gap_json = ? WHERE id = ?",
    [JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", source: "manual", resolution: "hire" }], updatedAt: NOW }), opportunityId],
  );
}

function count(sql: string, ...params: unknown[]): number {
  return (db.query(sql).get(...params) as { c: number }).c;
}

async function startPipelineFor(opportunityId: string): Promise<{ pipelineRunId: string; status: string }> {
  const res = await req(`/api/opportunities/${opportunityId}/pipeline/start`, {
    method: "POST",
    headers: { cookie: analystCookie },
    body: JSON.stringify({ industry_id: industryId, initiating_company_id: companyId }),
  });
  expect([200, 201]).toContain(res.status);
  const body = await res.json();
  return body.data as { pipelineRunId: string; status: string };
}

/** The human confirmation: record a gate decision through the EXISTING route. */
async function recordGate(opportunityId: string, gate: string): Promise<void> {
  const res = await req(`/api/opportunities/${opportunityId}/gate-decisions`, {
    method: "POST",
    headers: { cookie: analystCookie, "content-type": "application/json" },
    body: JSON.stringify({ gate, decision: "go", rationale: "사람 게이트 결정 (테스트)" }),
  });
  expect([200, 201]).toContain(res.status);
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-analyst-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-viewer-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie(ANALYST, "pw-analyst-12345");
  viewerCookie = await loginCookie(VIEWER, "pw-viewer-12345");

  industryId = ulid();
  db.run(
    "INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)",
    [industryId, "28119", "테스트 산업", "Test Industry", NOW],
  );
  companyId = ulid();
  db.run("INSERT INTO md_company (id, name_ko, name_en, created_at) VALUES (?,?,?,?)", [companyId, "테스트 계열사", "Test Co", NOW]);
  // Wave F-6: S1 now requires a completed sizing matrix with a recorded
  // data-confidence grade (flow.spec S1 criterion 3) for non-grandfathered opportunities.
  const analysisId = ulid();
  db.run(
    "INSERT INTO market_sizing_analysis (id, industry_id, status, current_step, methodology_version, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?,?,?)",
    [analysisId, industryId, "completed", 8, "test", "test", NOW, NOW],
  );
  db.run(
    "INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at, data_confidence_grade, chain_hops) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), analysisId, 1, JSON.stringify({ matrix: { competitive: { concentration: "moderate", key_players: ["A"] } } }), "test", NOW, "B", 0],
  );
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) {
    try {
      if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
    } catch {
      /* best effort */
    }
  }
});

describe("(a) full run — boundary #2 is test-enforced", () => {
  let runId = "";

  test("start pauses at the first human blocker (S4 route confirmation)", async () => {
    oppId = seedOpportunity("파이프라인 전 구간 기회", true);
    seedGreenfieldAssessment(oppId);
    const started = await startPipelineFor(oppId);
    runId = started.pipelineRunId;
    expect(started.status).toBe("paused_for_human");

    const run = db.query("SELECT * FROM pipeline_run WHERE id = ?").get(runId) as { paused_reason: string; current_stage: string };
    expect(run.paused_reason).toBe("route_confirmation:S4");
    expect(run.current_stage).toBe("S4");
  });

  test("every pause wrote a notification (trigger pipeline_paused, project_id NULL on the opportunity branch)", () => {
    const rows = db
      .query("SELECT project_id, payload FROM notification WHERE trigger_type = 'pipeline_paused'")
      .all() as Array<{ project_id: string | null; payload: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].project_id).toBeNull();
    expect(JSON.parse(rows[0].payload).paused_reason).toBe("route_confirmation:S4");
  });

  test("boundary #2: the pipeline itself wrote NO confirmation records", () => {
    expect(count("SELECT COUNT(*) c FROM gate_decision")).toBe(0);
    expect(count("SELECT COUNT(*) c FROM route_decision")).toBe(0);
    expect(count("SELECT COUNT(*) c FROM project_checklist_item_state")).toBe(0);
    expect(count("SELECT COUNT(*) c FROM venture_transition_decision")).toBe(0);
  });

  test("human records the S4 route via the EXISTING route; resume proceeds (b: resume)", async () => {
    const res = await req(`/api/opportunities/${oppId}/route-decision`, {
      method: "POST",
      headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({
        track: "greenfield",
        rationale: "트랙 결정 (사람, 테스트)",
        alternatives_considered: "M&A 대안 검토 후 제외 (S4 필수 산출물)",
        intent: "integration",
        scores: [
          { criterion: "control_need", score: 2, evidence_note: "t" },
          { criterion: "capability_criticality", score: 3, evidence_note: "t" },
          { criterion: "market_uncertainty", score: 2, evidence_note: "t" },
          { criterion: "integration_capacity", score: 2, evidence_note: "t" },
          { criterion: "speed_to_capability", score: 2, evidence_note: "t" },
        ],
      }),
    });
    expect([200, 201]).toContain(res.status);

    const outcomes = await resumePausedPipelines({});
    const mine = outcomes.find((o) => o.action === "resumed");
    expect(mine).toBeDefined();
    const run = db.query("SELECT * FROM pipeline_run WHERE id = ?").get(runId) as { status: string; paused_reason: string };
    // Greenfield: S6/S7 skipped; S5 artifacts pre-seeded → next human blocker
    // is the screening gate (S1–S7 artifacts all complete).
    expect(run.status).toBe("paused_for_human");
    expect(run.paused_reason).toBe("gate_decision:screening");
  });

  test("screening go (via route) → committee convenes a PROPOSAL, then pauses at pre_fs", async () => {
    await recordGate(oppId, "screening");
    const outcomes = await resumePausedPipelines({});
    expect(outcomes.some((o) => o.action === "resumed")).toBe(true);
    const run = db.query("SELECT * FROM pipeline_run WHERE id = ?").get(runId) as { status: string; paused_reason: string };
    expect(run.paused_reason).toBe("gate_decision:pre_fs");

    // The committee session produced a gate_evaluation PROPOSAL — the gate
    // decision itself is still missing (zero gate_decision rows so far).
    expect(count("SELECT COUNT(*) c FROM gate_decision")).toBe(1); // the HUMAN screening decision only
    const proposal = count(
      "SELECT COUNT(*) c FROM gate_evaluation WHERE gate = 'pre_fs'",
    );
    expect(proposal).toBeGreaterThanOrEqual(1);
  });

  test("pre_fs go (via route) → promotion → S8 cases proposed → paused at case adoption", async () => {
    await recordGate(oppId, "pre_fs");
    const outcomes = await resumePausedPipelines({});
    expect(outcomes.some((o) => o.action === "resumed")).toBe(true);

    // The run re-pointed to a project segment (append-only lineage).
    const projectRow = db.query("SELECT project_id FROM opportunity WHERE id = ?").get(oppId) as { project_id: string };
    expect(projectRow.project_id).not.toBeNull();
    const segments = db
      .query("SELECT * FROM pipeline_run WHERE (entity_type = 'opportunity' AND entity_id = ?) OR (entity_type = 'project' AND entity_id = ?) ORDER BY started_at")
      .all(oppId, projectRow.project_id) as Array<{ entity_type: string; status: string; current_stage: string | null; paused_reason: string | null }>;
    expect(segments.length).toBe(2);
    expect(segments[0].entity_type).toBe("opportunity");
    expect(segments[0].status).toBe("completed"); // the S1–S7 segment closed at promotion
    expect(segments[1].entity_type).toBe("project");
    expect(segments[1].status).toBe("paused_for_human");
    expect(segments[1].paused_reason).toBe("case_adoption:S8");
  });

  test("automation outputs are PROPOSALS: S8 cases + simulations + S9 checklist items; still zero confirmations", () => {
    const projectRow = db.query("SELECT project_id FROM opportunity WHERE id = ?").get(oppId) as { project_id: string };
    const pid = projectRow.project_id;
    // S8: three scenario cases with NPV percentiles — no adoption marker.
    expect(count("SELECT COUNT(*) c FROM business_case_model WHERE project_id = ?", pid)).toBeGreaterThanOrEqual(3);
    expect(count("SELECT COUNT(*) c FROM valuation_simulation WHERE project_id = ?", pid)).toBeGreaterThanOrEqual(3);
    // S9: tailored items all 'proposed', nothing approved.
    expect(count("SELECT COUNT(*) c FROM project_checklist_item_custom WHERE project_id = ?", pid)).toBeGreaterThanOrEqual(1);
    expect(count("SELECT COUNT(*) c FROM project_checklist_item_custom WHERE project_id = ? AND status != 'proposed'", pid)).toBe(0);
    // Boundary #2, project branch: no gate_decision, no adoption, no approval.
    expect(count("SELECT COUNT(*) c FROM gate_decision WHERE entity_type = 'project'")).toBe(0);
    expect(count("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id = ?", pid)).toBe(0);
    // The project-branch pause notified WITH project_id (0072's nullable column keeps it set here).
    const notif = db
      .query("SELECT project_id FROM notification WHERE trigger_type = 'pipeline_paused' AND project_id IS NOT NULL")
      .get() as { project_id: string } | undefined;
    expect(notif?.project_id).toBe(pid);
  });

  test("GET status returns the live project segment with a deep link", async () => {
    const res = await req(`/api/opportunities/${oppId}/pipeline/status`, { headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body.status).toBe("paused_for_human");
    expect(body.paused_reason).toBe("case_adoption:S8");
    expect(body.deep_link).toBe(`/projects/${body.entity_id}`);
  });
});

describe("(f) dd gate — the dead-rule regression", () => {
  test("fs go + S9 fully resolved → the pipeline pauses at gate_decision:dd (NOT entity_ic)", async () => {
    // The (a) run is paused at case_adoption:S8 on the project segment.
    const projectRow = db.query("SELECT project_id FROM opportunity WHERE id = ?").get(oppId) as { project_id: string };
    const pid = projectRow.project_id;

    // The HUMAN fs decision through the project gate route clears case_adoption.
    const fs = await req(`/api/projects/${pid}/gate-decisions`, {
      method: "POST",
      headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ gate: "fs", decision: "go", rationale: "사람 FS 결정 (테스트)" }),
    });
    expect(fs.status).toBe(201);

    // Next human blocker: the proposed checklist items await approval (the
    // proposal-shaped S9 work has no automation).
    await resumePausedPipelines({});
    const run1 = db.query("SELECT * FROM pipeline_run WHERE entity_type = 'project' AND entity_id = ?").get(pid) as { paused_reason: string };
    expect(run1.paused_reason).toBe("no_automation:S9");

    // The human approves every proposed tailored item (S9 work) via the
    // EXISTING review route — approval moves the item INTO the gate-relevant
    // set as a PENDING judgment (ADR-0099 §5), so the human must then judge
    // it through the state route. Both steps are ordinary S9 human work.
    const items = db
      .query("SELECT id, domain FROM project_checklist_item_custom WHERE project_id = ? AND status = 'proposed'")
      .all(pid) as Array<{ id: string; domain: string }>;
    expect(items.length).toBeGreaterThanOrEqual(1);
    for (const item of items) {
      const res = await req(`/api/projects/${pid}/dd-checklist/tailor/${item.id}/review`, {
        method: "PUT",
        headers: { cookie: analystCookie, "content-type": "application/json" },
        body: JSON.stringify({ decision: "approved" }),
      });
      expect(res.status).toBe(200);

      const judged = await req(`/api/projects/${pid}/dd-checklist/state`, {
        method: "PUT",
        headers: { cookie: analystCookie, "content-type": "application/json" },
        body: JSON.stringify({ checklist_id: `custom:${item.domain}`, item_id: item.id, status: "pass" }),
      });
      expect(judged.status).toBe(200);
    }

    // ADR-0148: standard items must be judged too (never-assessed items count as pending).
    judgeAllStandardDdItems(db, pid, "analyst-test", new Date().toISOString());

    // S9 is now COMPLETE (completedStages includes S9, currentStage has moved
    // past it) and the dd gate is still pending — the pipeline must pause for
    // the dd gate decision, not skip ahead to entity_ic.
    const resumed2 = await resumePausedPipelines({});
    expect(resumed2.some((o) => o.pipelineRunId && o.action === "resumed")).toBe(true);
    const run2 = db.query("SELECT * FROM pipeline_run WHERE entity_type = 'project' AND entity_id = ?").get(pid) as {
      status: string;
      paused_reason: string;
    };
    expect(run2.status).toBe("paused_for_human");
    expect(run2.paused_reason).toBe("gate_decision:dd");
  });
});

describe("(c) blocked automation pauses, never fails", () => {
  test("an opportunity with no automatable stage work pauses with a machine reason", async () => {
    freshOppId = seedOpportunity("자동화 없는 단계 기회", false);
    const started = await startPipelineFor(freshOppId);
    expect(started.status).toBe("paused_for_human");
    const run = db.query("SELECT * FROM pipeline_run WHERE id = ?").get(started.pipelineRunId) as { paused_reason: string; status: string };
    expect(run.paused_reason).toBe("no_automation:S1");
    expect(run.status).toBe("paused_for_human");
  });

  test("resume leaves it paused when nothing changed (no change = no action)", async () => {
    const before = count("SELECT COUNT(*) c FROM notification WHERE trigger_type = 'pipeline_paused'");
    const outcomes = await resumePausedPipelines({});
    const mine = outcomes.find((o) => o.detail.includes("no_automation:S1"));
    expect(mine?.action).toBe("left_paused");
    expect(count("SELECT COUNT(*) c FROM notification WHERE trigger_type = 'pipeline_paused'")).toBe(before);
  });
});

describe("(d) validation", () => {
  test("unknown industry_id → 400", async () => {
    const res = await req(`/api/opportunities/${freshOppId}/pipeline/start`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ industry_id: "no-such-industry", initiating_company_id: companyId }),
    });
    expect(res.status).toBe(400);
  });

  test("unknown initiating_company_id → 400", async () => {
    const res = await req(`/api/opportunities/${freshOppId}/pipeline/start`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ industry_id: industryId, initiating_company_id: "no-such-company" }),
    });
    expect(res.status).toBe(400);
  });

  test("viewer → 403 on start", async () => {
    const res = await req(`/api/opportunities/${freshOppId}/pipeline/start`, {
      method: "POST",
      headers: { cookie: viewerCookie },
      body: JSON.stringify({ industry_id: industryId, initiating_company_id: companyId }),
    });
    expect(res.status).toBe(403);
  });

  test("a second active run for the entity → 400 (active-run exclusivity)", async () => {
    const res = await req(`/api/opportunities/${freshOppId}/pipeline/start`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ industry_id: industryId, initiating_company_id: companyId }),
    });
    expect(res.status).toBe(400);
  });
});

describe("(e) max-iteration safety cap", () => {
  test("an automation that keeps changing state without completing fails the run", async () => {
    // A stub executor that persists a NEW model per call but never the
    // simulation percentiles — S8 never completes, the blocker signature
    // (model count) keeps changing, so the guard never trips and the cap must.
    const prevMode = process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS;
    process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS = "llm";
    setBusinessCaseExecutorFactory(() => async (step, ctx) => {
      if (step === "valuation_model") {
        const modelId = ulid();
        db.run(
          "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
          [modelId, ctx.inputs.projectId, "valuation", "캡 테스트 모델", 5, "test", NOW],
        );
        ctx.modelId = modelId;
      }
      return `stub ${step}`;
    });
    try {
      // Promote a DEDICATED opportunity (the (c)/(d) one keeps its own active
      // run) to get a project entity fast.
      const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
      const capOppId = seedOpportunity("캡 테스트 기회", true);
      seedGreenfieldAssessment(capOppId);
      // alternatives_considered: S4 completion predicate requires it (v2.4.1 alignment).
      db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), capOppId, "greenfield", "test", "M&A 대안 검토 후 제외", ANALYST, NOW]);
      // Promotion preconditions (2026-09-12 hardening): screening + pre_fs must be GO.
      for (const gate of ["screening", "pre_fs"]) {
        db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", capOppId, gate, "go", "test", ANALYST, NOW]);
      }
      const projectId = promoteOpportunity(capOppId, { promotedBy: ANALYST, needToKnowBasis: "cap test" }).project.id;

      const run = startPipeline({
        entityType: "project", entityId: projectId,
        industryId, initiatingCompanyId: companyId, startedBy: ANALYST,
      });
      const result = await advancePipeline(run.id);
      expect(result.run.status).toBe("failed");
      expect(result.run.paused_reason).toContain("max_iterations_exceeded");
    } finally {
      process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS = prevMode;
      setBusinessCaseExecutorFactory(null);
    }
  });
});

describe("(g) pipeline/status — no-run entity is a defined state, not an error", () => {
  test("existing opportunity with zero pipeline_run rows → 200 with status 'none'", async () => {
    const noRunOppId = seedOpportunity("실행 없는 기회", false);
    const res = await req(`/api/opportunities/${noRunOppId}/pipeline/status`, { headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body).toEqual({
      pipeline_run_id: null,
      status: "none",
      current_stage: null,
      paused_reason: null,
      deep_link: null,
      segments: [],
    });
  });

  test("unknown opportunity id → 404", async () => {
    const res = await req(`/api/opportunities/does-not-exist/pipeline/status`, { headers: { cookie: analystCookie } });
    expect(res.status).toBe(404);
  });

  test("viewer can read the 'none' status (read-mode allows viewer)", async () => {
    const noRunOppId = seedOpportunity("뷰어 조회 기회", false);
    const res = await req(`/api/opportunities/${noRunOppId}/pipeline/status`, { headers: { cookie: viewerCookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe("none");
  });
});
