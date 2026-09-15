import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

// Stage-scoped LLM decision support (ADR-0118) — the six endpoints that put an
// LLM-drafted proposal on human-judgment surfaces (gate briefs, S5 capability/
// strategy, S10 deal structure, S12 monitoring, S8 adoption, S2 attractiveness).
// These tests force the synthesis path (no LLM keys) and verify: the auth
// floor, gate whitelists, and the synthesis shapes — source-tagged, manifest
// present, and no fabricated values (null recommendation where the data alone
// cannot derive one; the screening gate derives only via the published spec
// criteria).
const TEST_DB_PATH = "db/data/test-stage-llm-recommendations.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const NOW = "2026-09-11T00:00:00Z";
let oppId = "";
let projectId = "";
let cookie = "";
let viewerCookie = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  // 결정론 폴백 경로 강제 — "" 할당으로 .env 재주입도 차단 (sketch 테스트와 동일).
  process.env.CO_NEWBIZ_LLM_PROVIDER = "";
  process.env.CO_NEWBIZ_LLM_API_KEY = "";
  process.env.CO_NEWBIZ_LLM_BASE_URL = "";
  process.env.CO_NEWBIZ_LLM_MODEL = "";
  await createUser(db, { userId: "reco2-a", role: "analyst", password: "pw-reco2-a-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "reco2-a", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "reco2-view", role: "viewer", password: "pw-reco2-view-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "reco2-view", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await loginCookie("reco2-a", "pw-reco2-a-12345");
  viewerCookie = await loginCookie("reco2-view", "pw-reco2-view-12345");

  oppId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, status, attractiveness_score, synergy_score, fit_verdict, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [oppId, "단계 추천 테스트 기회", "selected", 72, 55, "Go", "test", NOW],
  );
  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, "NP-RECO-T", NOW]);
  // 프로젝트 표면은 멤버십 게이팅(FR-SEC-03) — analyst를 멤버로 등록
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
    [projectId, "reco2-a", "contributor", "test", NOW, "stage llm reco test"]);
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("POST /api/opportunities/[id]/gate-brief", () => {
  test("401 without a session", async () => {
    const res = await nextRequest(`/api/opportunities/${oppId}/gate-brief`, { method: "POST", body: JSON.stringify({ gate: "screening" }) });
    expect(res.status).toBe(401);
  });

  test("403 for the viewer role", async () => {
    const res = await nextRequest(`/api/opportunities/${oppId}/gate-brief`, { method: "POST", body: JSON.stringify({ gate: "screening" }), headers: { cookie: viewerCookie } });
    expect(res.status).toBe(403);
  });

  test("400 for a non-opportunity gate", async () => {
    const res = await nextRequest(`/api/opportunities/${oppId}/gate-brief`, { method: "POST", body: JSON.stringify({ gate: "fs" }), headers: { cookie } });
    expect(res.status).toBe(400);
  });

  test("synthesis fallback — screening recommendation derives from the published criteria", async () => {
    const res = await nextRequest(`/api/opportunities/${oppId}/gate-brief`, { method: "POST", body: JSON.stringify({ gate: "screening" }), headers: { cookie } });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.source).toBe("synthesis");
    expect(data.manifest.length).toBeGreaterThan(0);
    expect(data.brief.recommendation).toBe("hold"); // 매력도 72 + 적합성 Go + 시너지 55 (< 60) → Hold
    expect(data.brief.key_evidence.length).toBeGreaterThan(0);
  });
});

describe("POST /api/projects/[id]/gate-brief", () => {
  test("400 for a non-project gate", async () => {
    const res = await nextRequest(`/api/projects/${projectId}/gate-brief`, { method: "POST", body: JSON.stringify({ gate: "screening" }), headers: { cookie } });
    expect(res.status).toBe(400);
  });

  test("synthesis fallback — project gates never fabricate a verdict", async () => {
    const res = await nextRequest(`/api/projects/${projectId}/gate-brief`, { method: "POST", body: JSON.stringify({ gate: "entity_ic" }), headers: { cookie } });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.source).toBe("synthesis");
    expect(data.brief.recommendation).toBeNull();
    expect(data.brief.cautions.some((c: string) => c.includes("결정론 폴백") || c.includes("LLM 미구성"))).toBe(true);
  });
});

describe("POST /api/greenfield/[oppId]/recommendation", () => {
  test("synthesis fallback — no fabricated investment items", async () => {
    const res = await nextRequest(`/api/greenfield/${oppId}/recommendation`, { method: "POST", body: JSON.stringify({}), headers: { cookie } });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.source).toBe("synthesis");
    expect(data.recommendation.investment_items).toBeNull();
    expect(data.manifest).toContain("S4 트랙 결정(greenfield)");
  });
});

describe("POST /api/projects/[id]/deal-structure-recommendation", () => {
  test("synthesis fallback — vehicle null, honest cautions", async () => {
    const res = await nextRequest(`/api/projects/${projectId}/deal-structure-recommendation`, { method: "POST", body: JSON.stringify({}), headers: { cookie } });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.source).toBe("synthesis");
    expect(data.recommendation.vehicle).toBeNull();
    expect(data.recommendation.four_axis.tax_structure_note).toContain("검증 필요");
    expect(data.manifest).toContain("S8 채택 BC 요약");
  });
});

describe("POST /api/projects/[id]/monitoring-brief", () => {
  test("synthesis fallback — transition suggestion null", async () => {
    const res = await nextRequest(`/api/projects/${projectId}/monitoring-brief`, { method: "POST", body: JSON.stringify({}), headers: { cookie } });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.source).toBe("synthesis");
    expect(data.brief.transition_suggestion).toBeNull();
    expect(data.brief.key_evidence.length).toBeGreaterThan(0);
  });
});

describe("POST /api/projects/[id]/business-case/adoption-recommendation", () => {
  test("404 without cases", async () => {
    const res = await nextRequest(`/api/projects/${projectId}/business-case/adoption-recommendation`, { method: "POST", body: JSON.stringify({}), headers: { cookie } });
    expect(res.status).toBe(404);
  });

  test("synthesis fallback echoes the deterministic RECOMMENDED (or none)", async () => {
    const modelId = ulid();
    db.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, variant) VALUES (?,?,?,?,?,?,?,?)",
      [modelId, projectId, "valuation", "기본 시나리오", 5, "t", NOW, "market_forward"]);
    const res = await nextRequest(`/api/projects/${projectId}/business-case/adoption-recommendation`, { method: "POST", body: JSON.stringify({}), headers: { cookie } });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.source).toBe("synthesis");
    expect(data.manifest.some((m: string) => m.includes("Business Case"))).toBe(true);
  });
});

describe("POST /api/opportunities/[id]/attractiveness-recommendation", () => {
  test("synthesis fallback — no fabricated score", async () => {
    const res = await nextRequest(`/api/opportunities/${oppId}/attractiveness-recommendation`, { method: "POST", body: JSON.stringify({}), headers: { cookie } });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.source).toBe("synthesis");
    expect(data.recommendation.suggested_score).toBeNull();
    expect(data.recommendation.rationale_draft).toContain("결정론 폴백");
  });

  test("generations land in the audit trail with their source", () => {
    const row = db
      .query("SELECT target FROM audit_log WHERE action = 'attractiveness_recommendation.generate' ORDER BY rowid DESC LIMIT 1")
      .get() as { target: string } | undefined;
    expect(row?.target).toBe(`${oppId}:synthesis`);
  });
});
