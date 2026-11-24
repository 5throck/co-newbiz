// @version 1.0.0
/**
 * S8 AI decision-support inputs only see cases of targets still on the Short List.
 *
 * Defect: the "AI 판단 지원" panel recommended a brownfield target that had
 * already been excluded from the Short List, because listBusinessCases returns
 * every case ever generated while the target comparison filters to
 * brownfield_target.status = 'shortlisted'. Covers the shared helpers
 * (activeTargetCases / shortlistedTargetIds) and the two decision-support
 * surfaces that feed an LLM: POST .../business-case/adoption-recommendation and
 * POST .../gate-brief (fs gate).
 */
import { test, expect, beforeAll, afterAll, afterEach, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-decision-support-active-targets.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { activeTargetCases, shortlistedTargetIds } = await import("../../app/web-next/lib/business-case.ts");

resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const NOW = "2026-11-24T00:00:00Z";

const KEPT_NAME = "태웅테스트";
const DROPPED_NAME = "삼미금속테스트";
let projectId = "";
let keptTargetId = "";
let droppedTargetId = "";
let keptCaseId = "";
let droppedCaseIds: string[] = [];
let cookie = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

function insertCase(name: string, targetId: string | null): string {
  const id = ulid();
  db.run(
    "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, variant, target_id) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, projectId, "valuation", name, 5, "t", NOW, "market_forward", targetId],
  );
  return id;
}

const origFetch = globalThis.fetch;
const ENV_KEYS = [
  "CO_NEWBIZ_LLM_PROVIDER",
  "CO_NEWBIZ_LLM_API_KEY",
  "CO_NEWBIZ_LLM_BASE_URL",
  "CO_NEWBIZ_LLM_MODEL",
] as const;
const savedEnv: Array<readonly [string, string | undefined]> = [];

/** Configure a stub provider whose reply is `reply`; returns the user-message prompts the route sent. */
function stubLlm(reply: unknown): string[] {
  const prompts: string[] = [];
  for (const k of ENV_KEYS) savedEnv.push([k, process.env[k]] as const);
  process.env.CO_NEWBIZ_LLM_PROVIDER = "openai";
  process.env.CO_NEWBIZ_LLM_API_KEY = ["test", "-key"].join("");
  process.env.CO_NEWBIZ_LLM_BASE_URL = "http://llm.invalid/v1";
  process.env.CO_NEWBIZ_LLM_MODEL = "test-model";
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
    prompts.push((body.messages ?? []).map((m) => m.content).join("\n"));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return prompts;
}

afterEach(() => {
  globalThis.fetch = origFetch as typeof fetch;
  for (const [k, v] of savedEnv.splice(0).reverse()) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeAll(async () => {
  await createUser(db, {
    userId: "active-a",
    role: "analyst",
    password: "pw-active-a-12345",
    createdBy: "test",
    now: NOW,
  });
  approveUser(db, { userId: "active-a", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await loginCookie("active-a", "pw-active-a-12345");

  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [
    oppId,
    "활성 대상 테스트",
    "selected",
    "test",
    NOW,
  ]);
  keptTargetId = ulid();
  droppedTargetId = ulid();
  db.run(
    `INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?), (?,?,?,?,?,?,?)`,
    [
      keptTargetId,
      oppId,
      KEPT_NAME,
      "shortlisted",
      1,
      NOW,
      NOW,
      droppedTargetId,
      oppId,
      DROPPED_NAME,
      "excluded",
      null,
      NOW,
      NOW,
    ],
  );
  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, track, source_opportunity_id, created_at) VALUES (?,?,?,?,?)", [
    projectId,
    "NP-ACTIVE-T",
    "brownfield",
    oppId,
    NOW,
  ]);
  db.run(
    "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
    [projectId, "active-a", "member", "test", NOW, "active target test"],
  );
  keptCaseId = insertCase(`[${KEPT_NAME}] 기본`, keptTargetId);
  droppedCaseIds = [1, 2, 3, 4, 5, 6].map((n) => insertCase(`[${DROPPED_NAME}] 케이스${n}`, droppedTargetId));
  insertCase("레거시 대상 미귀속", null);
});

afterAll(() => {
  globalThis.fetch = origFetch as typeof fetch;
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("activeTargetCases (pure)", () => {
  const cases = [
    { id: "a1", target_id: "A" },
    { id: "b1", target_id: "B" },
    { id: "n1", target_id: null },
  ];
  test("keeps shortlisted-target cases and target-less cases, drops the rest", () => {
    expect(activeTargetCases(cases, new Set(["A"])).map((c) => c.id)).toEqual(["a1", "n1"]);
  });
  test("an empty Short List keeps only target-less cases", () => {
    expect(activeTargetCases(cases, new Set()).map((c) => c.id)).toEqual(["n1"]);
  });
  test("does not mutate its input", () => {
    activeTargetCases(cases, new Set(["A"]));
    expect(cases.length).toBe(3);
  });
});

describe("shortlistedTargetIds (DB)", () => {
  test("matches the target comparison rule — only status 'shortlisted'", () => {
    expect([...shortlistedTargetIds(projectId)]).toEqual([keptTargetId]);
  });
  test("a project without a source opportunity has an empty Short List", () => {
    const orphan = ulid();
    db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [orphan, "NP-ACTIVE-ORPHAN", NOW]);
    expect(shortlistedTargetIds(orphan).size).toBe(0);
  });
  test("dropping a target from the Short List removes its cases from the active set", () => {
    db.run("UPDATE brownfield_target SET status = 'excluded' WHERE id = ?", [keptTargetId]);
    expect(shortlistedTargetIds(projectId).size).toBe(0);
    db.run("UPDATE brownfield_target SET status = 'shortlisted' WHERE id = ?", [keptTargetId]);
    expect(shortlistedTargetIds(projectId).has(keptTargetId)).toBe(true);
  });
});

describe("POST /api/projects/[id]/business-case/adoption-recommendation", () => {
  const url = () => `/api/projects/${projectId}/business-case/adoption-recommendation`;

  test("the LLM prompt carries no excluded-target case", async () => {
    const prompts = stubLlm({
      recommended_model_id: keptCaseId,
      rationale_draft: "r",
      what_would_change: null,
      key_evidence: [],
      cautions: [],
    });
    const res = await nextRequest(url(), { method: "POST", body: JSON.stringify({}), headers: { cookie } });
    expect(res.status).toBe(200);
    expect(prompts.length).toBe(1);
    expect(prompts[0]).toContain(KEPT_NAME);
    expect(prompts[0]).toContain("레거시 대상 미귀속");
    expect(prompts[0]).not.toContain(DROPPED_NAME);
  });

  test("the prompt lists each active case id so the model can return a valid recommended_model_id", async () => {
    const prompts = stubLlm({
      recommended_model_id: keptCaseId,
      rationale_draft: "r",
      what_would_change: null,
      key_evidence: [],
      cautions: [],
    });
    const res = await nextRequest(url(), { method: "POST", body: JSON.stringify({}), headers: { cookie } });
    const data = (await res.json()).data;
    expect(prompts[0]).toContain(`id=${keptCaseId}`);
    for (const id of droppedCaseIds) expect(prompts[0]).not.toContain(id);
    expect(data.recommendation.recommended_model_id).toBe(keptCaseId);
  });

  test("a model-returned id of an excluded-target case is rejected (null), a shortlisted id passes", async () => {
    stubLlm({
      recommended_model_id: droppedCaseIds[0],
      rationale_draft: "r",
      what_would_change: null,
      key_evidence: [],
      cautions: [],
    });
    let res = await nextRequest(url(), { method: "POST", body: JSON.stringify({}), headers: { cookie } });
    let data = (await res.json()).data;
    expect(data.source).toBe("llm");
    expect(data.recommendation.recommended_model_id).toBeNull();
    globalThis.fetch = origFetch as typeof fetch;
    for (const [k, v] of savedEnv.splice(0).reverse()) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }

    stubLlm({
      recommended_model_id: keptCaseId,
      rationale_draft: "r",
      what_would_change: null,
      key_evidence: [],
      cautions: [],
    });
    res = await nextRequest(url(), { method: "POST", body: JSON.stringify({}), headers: { cookie } });
    data = (await res.json()).data;
    expect(data.recommendation.recommended_model_id).toBe(keptCaseId);
  });

  test("404 when every case belongs to an excluded target", async () => {
    const solo = ulid();
    const oppId = (
      db.query("SELECT source_opportunity_id AS o FROM md_project WHERE id = ?").get(projectId) as { o: string }
    ).o;
    db.run("INSERT INTO md_project (id, project_no, track, source_opportunity_id, created_at) VALUES (?,?,?,?,?)", [
      solo,
      "NP-ACTIVE-SOLO",
      "brownfield",
      oppId,
      NOW,
    ]);
    db.run(
      "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
      [solo, "active-a", "member", "test", NOW, "active target test"],
    );
    db.run(
      "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, variant, target_id) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), solo, "valuation", "제외 대상 단독", 5, "t", NOW, "market_forward", droppedTargetId],
    );
    const res = await nextRequest(`/api/projects/${solo}/business-case/adoption-recommendation`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { cookie },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/projects/[id]/gate-brief (fs)", () => {
  test("the S8 Business Case context excludes excluded-target cases", async () => {
    const prompts = stubLlm({
      recommendation: null,
      rationale_draft: "r",
      key_evidence: [],
      cautions: [],
      open_questions: [],
    });
    const res = await nextRequest(`/api/projects/${projectId}/gate-brief`, {
      method: "POST",
      body: JSON.stringify({ gate: "fs" }),
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(prompts.length).toBeGreaterThan(0);
    const prompt = prompts.join("\n");
    expect(prompt).toContain(KEPT_NAME);
    expect(prompt).not.toContain(DROPPED_NAME);
  });

  test("buildGateContext (fs) lists only active-target cases", async () => {
    const { buildGateContext } = await import("../../app/web-next/lib/gate-brief.ts");
    const ctx = buildGateContext(db, "project", projectId, "fs");
    expect(ctx).toContain(KEPT_NAME);
    expect(ctx).toContain("레거시 대상 미귀속");
    expect(ctx).not.toContain(DROPPED_NAME);
  });
});
