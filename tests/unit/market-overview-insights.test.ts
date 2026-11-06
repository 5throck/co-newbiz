// @version 1.0.0
/**
 * GET /api/market-overview/insights — 산업별 dedupe (2026-11-06
 * insights-dedupe-and-step-key): 가치사슬 연계 재분석이 같은 산업에
 * COMPLETED analysis 행을 추가로 만들 수 있고, 라우트가 analysis 행별
 * 최신 version만 고르던 시절엔 같은 산업이 insights 배열에 두 번
 * 노출됐다(→ OpportunityFunnelStage 드롭다운 중복 key). 이제 산업별
 * 최신 완료 analysis(completed_at DESC, id DESC tiebreak) 한 건만
 * 반환한다. 미완료 재분석이 더 최신이어도 완료분을 가리지 않는다.
 * DB 시임재는 sizing-link-versions.test.ts와 동일하다.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-market-overview-insights.sqlite");
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

const ANALYST = "insights-analyst";
let cookie = "";
const json = JSON.stringify;
const NOW = new Date().toISOString();

async function login(userId: string, pw: string) {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: json({ userId, password: pw }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

function seedIndustry(industryId: string, name: string) {
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
    industryId,
    industryId,
    name,
    name,
    NOW,
  ]);
}

function seedAnalysis(id: string, industryId: string, status: string, completedAt: string | null) {
  db.run(
    "INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
    [id, industryId, status, ANALYST, completedAt ?? NOW, completedAt],
  );
  if (completedAt) {
    db.run(
      "INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)",
      [`ver-${id}`, id, 1, json({}), ANALYST, completedAt],
    );
  }
}

const getInsights = (headers: Record<string, string> = { cookie }) =>
  nextRequest("/api/market-overview/insights", { method: "GET", headers });

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-insights-1", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await login(ANALYST, "pw-insights-1");
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("market-overview insights per-industry dedupe", () => {
  test("two completed analyses for one industry -> exactly one insight, the newer completed_at", async () => {
    const ind = `ind-dup-${ulid().slice(-8)}`;
    seedIndustry(ind, "중복 산업");
    seedAnalysis(`ana-old-${ulid().slice(-8)}`, ind, "completed", "2026-01-01T00:00:00.000Z");
    const newer = `ana-new-${ulid().slice(-8)}`;
    seedAnalysis(newer, ind, "completed", "2026-02-01T00:00:00.000Z");

    const body = await (await getInsights()).json();
    expect(body.error).toBeNull();
    const dup = body.data.insights.filter((s: { industry_id: string }) => s.industry_id === ind);
    expect(dup).toHaveLength(1);
    expect(dup[0].analysis_id).toBe(newer);
  });

  test("single-analysis industry is unaffected; duplicate industry adds no extra row", async () => {
    const dupInd = `ind-dup2-${ulid().slice(-8)}`;
    const soloInd = `ind-solo-${ulid().slice(-8)}`;
    seedIndustry(dupInd, "중복 산업 2");
    seedIndustry(soloInd, "단일 산업");
    seedAnalysis(`ana-d2a-${ulid().slice(-8)}`, dupInd, "completed", "2026-01-01T00:00:00.000Z");
    seedAnalysis(`ana-d2b-${ulid().slice(-8)}`, dupInd, "completed", "2026-03-01T00:00:00.000Z");
    seedAnalysis(`ana-solo-${ulid().slice(-8)}`, soloInd, "completed", "2026-02-15T00:00:00.000Z");

    const body = await (await getInsights()).json();
    // 전역 dedupe 불변식 — insights 배열 전체에서 어떤 산업도 두 번 나오지 않는다.
    const ids = body.data.insights.map((s: { industry_id: string }) => s.industry_id);
    expect(new Set(ids).size).toBe(ids.length);
    const solo = body.data.insights.filter((s: { industry_id: string }) => s.industry_id === soloInd);
    expect(solo).toHaveLength(1);
    const dup = body.data.insights.filter((s: { industry_id: string }) => s.industry_id === dupInd);
    expect(dup).toHaveLength(1);
    expect(dup[0].completed_at).toBe("2026-03-01T00:00:00.000Z");
  });

  test("a newer non-completed re-analysis does not shadow the completed one", async () => {
    const ind = `ind-run-${ulid().slice(-8)}`;
    seedIndustry(ind, "진행 중 재분석 산업");
    seedAnalysis(`ana-done-${ulid().slice(-8)}`, ind, "completed", "2026-01-10T00:00:00.000Z");
    seedAnalysis(`ana-run-${ulid().slice(-8)}`, ind, "in_progress", null);

    const body = await (await getInsights()).json();
    const rows = body.data.insights.filter((s: { industry_id: string }) => s.industry_id === ind);
    expect(rows).toHaveLength(1);
    expect(rows[0].analysis_id.startsWith("ana-done-")).toBe(true);
  });

  test("unauthenticated GET is 401", async () => {
    expect((await getInsights({})).status).toBe(401);
  });
});
