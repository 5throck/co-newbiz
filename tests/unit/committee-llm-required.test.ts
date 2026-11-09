// @version 1.0.0
/**
 * Committee LLM-availability gate — owner decision 10 (2026-11-09 chat),
 * ADR-0196 amendment.
 *
 * The single invariant: agent-backed committee deliberation (agent_team and
 * the hybrid agent round) convenes ONLY when an LLM-backed callAgent can
 * actually be constructed (the bootstrap factory seam), or the caller
 * explicitly injects a callAgent. There is NO mode env var — the
 * deterministic emitter is reachable only via explicit injection.
 * human_only is unaffected; the pipeline auto-convene (M3) skips with a
 * recorded notice on llm_required.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");

const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-committee-llm-required.sqlite");
// Keep the provider offline so the chair passes stay deterministic — this
// suite must not depend on a machine's real root-.env provider.
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { CommitteeError, conveneCommitteeSession } = await import("../../app/web-next/lib/committee-session.ts");
const { setCallAgentFactory, deterministicCallAgent, committeeLlmAvailable, CommitteeLlmRequiredError } = await import(
  "../../app/web-next/lib/committee-agents.ts"
);
const { startPipeline, advancePipeline, resumePausedPipelines } = await import("../../app/web-next/lib/pipeline.ts");

const NOW = new Date().toISOString();
const ANALYST = "analyst-llmreq";
const ENTITY = { entityType: "opportunity" as const, entityId: "llmreq-opp" };

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

function seedOpportunity(id: string, name: string): void {
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [
    id,
    name,
    "industry",
    "selected",
    ANALYST,
    NOW,
  ]);
}

function count(sql: string): number {
  return (db.query(sql).get() as { c: number }).c;
}

let analystCookie = "";
let industryId = "";
let companyId = "";
let sizingVersionId = "";

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-llmreq-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie(ANALYST, "pw-llmreq-12345");

  industryId = ulid();
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
    industryId,
    "28119",
    "테스트 산업",
    "Test Industry",
    NOW,
  ]);
  companyId = ulid();
  db.run("INSERT INTO md_company (id, name_ko, name_en, created_at) VALUES (?,?,?,?)", [
    companyId,
    "테스트 계열사",
    "Test Co",
    NOW,
  ]);
  const analysisId = ulid();
  db.run(
    "INSERT INTO market_sizing_analysis (id, industry_id, status, current_step, methodology_version, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?,?,?)",
    [analysisId, industryId, "completed", 8, "test", "test", NOW, NOW],
  );
  sizingVersionId = ulid();
  db.run(
    "INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at, data_confidence_grade, chain_hops) VALUES (?,?,?,?,?,?,?,?)",
    [
      sizingVersionId,
      analysisId,
      1,
      JSON.stringify({ matrix: { competitive: { concentration: "moderate", key_players: ["A"] } } }),
      "test",
      NOW,
      "B",
      0,
    ],
  );
});

afterAll(async () => {
  setCallAgentFactory(null);
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

describe("conveneCommitteeSession — llm_required gate (owner decision 10)", () => {
  test("(a) agent_team, no factory, no injected callAgent → llm_required", async () => {
    seedOpportunity("llmreq-opp", "가드 테스트 기회");
    setCallAgentFactory(null);
    expect(committeeLlmAvailable()).toBe(false);
    try {
      await conveneCommitteeSession(ENTITY, {
        committeeKey: "route-steering-committee",
        decisionMode: "agent_team",
        gate: "pre_fs",
        actor: ANALYST,
        source: "system",
      });
      throw new Error("expected conveneCommitteeSession to refuse");
    } catch (err) {
      expect(err).toBeInstanceOf(CommitteeError);
      const e = err as Error & { code: string };
      expect(e.code).toBe("llm_required");
      expect(e.message).toContain("configured LLM provider");
    }
    expect(count("SELECT COUNT(*) c FROM gate_evaluation")).toBe(0);
  });

  test("(b) factory registered (provider seam) → convenes through it", async () => {
    let calls = 0;
    setCallAgentFactory(() => {
      calls += 1;
      return async (agentKey) => ({
        positionMd: `### 스텁 입장 (${agentKey})\n\n공장 경유 스텁 입장입니다.`,
        confidence: 55,
        recommendation: "hold" as const,
      });
    });
    expect(committeeLlmAvailable()).toBe(true);
    const result = await conveneCommitteeSession(ENTITY, {
      committeeKey: "route-steering-committee",
      decisionMode: "agent_team",
      gate: "pre_fs",
      actor: ANALYST,
      source: "system",
    });
    expect(result.evaluation).not.toBeNull();
    expect(calls).toBeGreaterThan(0);
    expect(count("SELECT COUNT(*) c FROM gate_evaluation")).toBe(1);
  });

  test("(b2) explicit injection convenes regardless of availability", async () => {
    setCallAgentFactory(null);
    const result = await conveneCommitteeSession(ENTITY, {
      committeeKey: "route-steering-committee",
      decisionMode: "agent_team",
      gate: "pre_fs",
      actor: ANALYST,
      callAgent: deterministicCallAgent(),
      source: "system",
    });
    expect(result.evaluation).not.toBeNull();
  });

  test("(c) llm_required guidance text is the shared constant", () => {
    const err = new CommitteeLlmRequiredError();
    expect(err.code).toBe("llm_required");
    expect(err.message).toContain("hybrid/human_only");
  });

  test("(d) hybrid, no factory → refused at convene, no session shell created", async () => {
    setCallAgentFactory(null);
    await expect(
      conveneCommitteeSession(ENTITY, {
        committeeKey: "route-steering-committee",
        decisionMode: "hybrid",
        gate: "pre_fs",
        actor: ANALYST,
        source: "system",
      }),
    ).rejects.toMatchObject({ code: "llm_required" });
    // Refusal happens BEFORE createSessionRun — no hollow shell to clean up.
    expect(count("SELECT COUNT(*) c FROM process_run WHERE stage = 'pre_fs' AND meta_json LIKE '%hybrid%'")).toBe(0);
  });

  test("(e) human_only convenes with no factory (no agent calls)", async () => {
    setCallAgentFactory(null);
    const result = await conveneCommitteeSession(ENTITY, {
      committeeKey: "route-steering-committee",
      decisionMode: "human_only",
      gate: "pre_fs",
      actor: ANALYST,
      source: "system",
    });
    expect(result.evaluation).toBeNull();
    expect(result.sessionId).toBeTruthy();
  });
});

describe("pipeline auto-convene — skip with a recorded notice (M3)", () => {
  test("(f) no factory → convene skipped, run paused at committee_llm_required with a notification", async () => {
    setCallAgentFactory(null);
    // Seed an S1–S3-complete greenfield opportunity (same shape as pipeline.test.ts).
    const opp = ulid();
    db.run(
      `INSERT INTO opportunity (id, name, market_scope, value_chain_node, market_size_krw_m, growth_rate,
         attractiveness_score, synergy_score, rationale, status, created_by, created_at, capability_gap_json,
         synergy_score_confirmed_at, synergy_rationale, sizing_version_id, target_scope_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        opp,
        "파이프라인 llm_required 기회",
        "테스트 산업",
        "크랭크샤프트",
        5000,
        8.0,
        80,
        70,
        "전략적 적합성 근거",
        "selected",
        ANALYST,
        NOW,
        JSON.stringify({
          rows: [{ id: "gap-1", capability: "g1", source: "manual", resolution: "hire" }],
          updatedAt: NOW,
        }),
        NOW,
        "사람이 확정한 시너지 근거 (ADR-0192)",
        sizingVersionId,
        JSON.stringify({ regions: ["kr"], segments: [], unit_basis: "krw_m_year", set_by: ANALYST, set_at: NOW }),
      ],
    );
    db.run(
      "INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), opp, "직접 진출", "M&A 대안 검토", "test", ANALYST, NOW, NOW],
    );

    const started = startPipeline({
      entityType: "opportunity",
      entityId: opp,
      industryId,
      initiatingCompanyId: companyId,
      startedBy: ANALYST,
    });
    const first = await advancePipeline(started.id, { actor: ANALYST });
    expect(first.run.status).toBe("paused_for_human");
    let run = db.query("SELECT id, status, paused_reason FROM pipeline_run WHERE id = ?").get(started.id) as {
      id: string;
      status: string;
      paused_reason: string;
    };
    expect(run.paused_reason).toBe("route_confirmation:S4");

    // Human steps only — route decision and screening GO, no LLM needed.
    const routeRes = await req(`/api/opportunities/${opp}/route-decision`, {
      method: "POST",
      headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({
        track: "greenfield",
        rationale: "트랙 결정 (사람, 테스트)",
        alternatives_considered: "M&A 대안 검토 후 제외",
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
    expect([200, 201]).toContain(routeRes.status);
    await resumePausedPipelines({});
    run = db.query("SELECT id, status, paused_reason FROM pipeline_run WHERE id = ?").get(run.id) as typeof run;
    expect(run.paused_reason).toBe("gate_decision:screening");

    const gateRes = await req(`/api/opportunities/${opp}/gate-decisions`, {
      method: "POST",
      headers: { cookie: analystCookie, "content-type": "application/json" },
      body: JSON.stringify({ gate: "screening", decision: "go", rationale: "사람 게이트 결정 (테스트)" }),
    });
    expect([200, 201]).toContain(gateRes.status);

    // Resume with no factory: the auto-convene must SKIP (paused notice),
    // never convene a hollow deterministic session, never fail the run.
    const outcomes = await resumePausedPipelines({});
    expect(outcomes.some((o) => o.pipelineRunId === run.id && o.action === "resumed")).toBe(true);
    run = db.query("SELECT id, status, paused_reason FROM pipeline_run WHERE id = ?").get(run.id) as typeof run;
    expect(run.status).toBe("paused_for_human");
    expect(run.paused_reason).toBe("committee_llm_required:pre_fs");

    // No hollow proposal, and the skip is not silent: a pause notification
    // carrying the llm_required notice exists.
    expect(
      count(
        `SELECT COUNT(*) c FROM gate_evaluation g JOIN process_run r ON r.id = g.process_run_id WHERE g.gate = 'pre_fs' AND r.entity_id = '${opp}'`,
      ),
    ).toBe(0);
    const notice = db
      .query("SELECT payload FROM notification WHERE trigger_type = 'pipeline_paused' ORDER BY rowid DESC LIMIT 1")
      .get() as { payload: string };
    expect(JSON.parse(notice.payload).paused_reason).toBe("committee_llm_required:pre_fs");
  });
});
