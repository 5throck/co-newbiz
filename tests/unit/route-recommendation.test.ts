import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

// S4 LLM route recommendation — the decision-support side of boundary #2
// (CLAUDE.md amendment 2026-09-11: humans record the final decision, LLM
// provides information and recommendations). These tests force the synthesis
// path (no LLM keys) and verify: the auth floor, the selected-only
// precondition shared with POST /route-decision, and the synthesis response
// shape — source-tagged, advisory-grounded, and never fabricating 5-criteria
// scores (drafting scores is the LLM's or the human's job, not a template's).
const TEST_DB_PATH = "db/data/test-route-recommendation.sqlite";
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
let draftId = "";
let cookie = "";
let viewerCookie = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  // 이 테스트는 결정론 폴백 경로를 검증한다 — LLM 키가 구성된 머신에서도
  // synthesis 경로로 강제한다. "" 할당: loadRootEnvPipelineKeys가 undefined 키만
  // 채우므로 .env 재주입도 동시에 차단된다(getProviderConfig는 빈 값을 falsy로 본다).
  process.env.CO_NEWBIZ_LLM_PROVIDER = "";
  process.env.CO_NEWBIZ_LLM_API_KEY = "";
  process.env.CO_NEWBIZ_LLM_BASE_URL = "";
  process.env.CO_NEWBIZ_LLM_MODEL = "";
  await createUser(db, { userId: "reco-a", role: "analyst", password: "pw-reco-a-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "reco-a", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "reco-view", role: "viewer", password: "pw-reco-view-123456", createdBy: "test", now: NOW });
  approveUser(db, { userId: "reco-view", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await loginCookie("reco-a", "pw-reco-a-12345");
  viewerCookie = await loginCookie("reco-view", "pw-reco-view-123456");

  oppId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, status, attractiveness_score, synergy_score, fit_verdict, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [oppId, "추천 테스트 기회", "selected", 72, 55, "Go", "test", NOW],
  );
  draftId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)",
    [draftId, "미선별 기회", "assessed", "test", NOW],
  );
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("POST /api/opportunities/[id]/route-recommendation", () => {
  test("401 without a session", async () => {
    const res = await nextRequest(`/api/opportunities/${oppId}/route-recommendation`, { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(401);
  });

  test("403 for the viewer role", async () => {
    const res = await nextRequest(`/api/opportunities/${oppId}/route-recommendation`, { method: "POST", body: JSON.stringify({}), headers: { cookie: viewerCookie } });
    expect(res.status).toBe(403);
  });

  test("404 for an unknown opportunity", async () => {
    const res = await nextRequest("/api/opportunities/UNKNOWNID/route-recommendation", { method: "POST", body: JSON.stringify({}), headers: { cookie } });
    expect(res.status).toBe(404);
  });

  test("400 for a non-selected opportunity", async () => {
    const res = await nextRequest(`/api/opportunities/${draftId}/route-recommendation`, { method: "POST", body: JSON.stringify({}), headers: { cookie } });
    expect(res.status).toBe(400);
  });

  test("synthesis fallback — advisory-based proposal without fabricated scores", async () => {
    const res = await nextRequest(`/api/opportunities/${oppId}/route-recommendation`, { method: "POST", body: JSON.stringify({}), headers: { cookie } });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.source).toBe("synthesis");
    expect(data.provider).toBeNull();
    expect(data.note).toContain("LLM 미구성");
    const rec = data.recommendation;
    expect(["greenfield", "brownfield"]).toContain(rec.track);
    expect(rec.sub_track).toBeNull();
    expect(rec.scores).toBeNull();
    expect(rec.rationale_draft.length).toBeGreaterThan(0);
    expect(rec.key_evidence.length).toBeGreaterThan(0);
    expect(rec.cautions.some((c: string) => c.includes("LLM 미구성"))).toBe(true);
  });

  test("generation lands in the audit trail with its source", () => {
    const row = db
      .query("SELECT target FROM audit_log WHERE action = 'route_recommendation.generate' ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get() as { target: string } | undefined;
    expect(row?.target).toBe(`${oppId}:synthesis`);
  });
});
