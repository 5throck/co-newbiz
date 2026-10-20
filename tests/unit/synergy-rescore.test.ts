// POST /api/synergy/analyses/[id]/rescore — ADR-0182 legacy-scheme conversion.
// A legacy 4-factor stored payload, when rescoured, gains the capability
// coverage factor (current scheme), appends a NEW version (append-only), and
// follows the rerun rule for the opportunity recommendation: a changed score
// invalidates the person's confirmation, the same score keeps it.
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-synergy-rescore.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
// Hermetic: the rescore rerun must not dial the real LLM from the dev .env —
// with `bun test --isolate` this file runs in a fresh env and the rerun made
// a real ~5s LLM call that timed out. Same guard the other route suites set.
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const NOW = "2026-10-18T00:00:00Z";
let cookie = "";
let oppId = "";
let synId = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  await createUser(db, { userId: "rescore-test", role: "analyst", password: "pw-rescore-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "rescore-test", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await loginCookie("rescore-test", "pw-rescore-12345");

  // completed S1 market the rescore reads (same query as the pipeline)
  const indId = ulid();
  db.run("INSERT INTO md_industry (id, name_ko, name_en, created_at) VALUES (?,?,?,?)", [indId, "휴머노이드 로봇", "Humanoid robot", NOW]);
  const msId = ulid();
  db.run("INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)", [msId, indId, "completed", "test", NOW, NOW]);
  db.run("INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [ulid(), msId, 1, JSON.stringify({ matrix: { consistency: { bottomUpCagr: 12 }, chainDirection: { relatedIndustries: [] } } }), "test", NOW]);

  // opportunity with a judged capability register (coverage 50, essential 100 → blended 75)
  oppId = ulid();
  const gapJson = JSON.stringify({ rows: [
    { id: "g1", capability: "정밀 감속기", necessity: "essential", held: { status: "leading", evidence: "보유" } },
    { id: "g2", capability: "유통 채널", necessity: "", held: { status: "none", evidence: "없음" } },
  ], updatedAt: NOW });
  db.run("INSERT INTO opportunity (id, name, status, market_scope, synergy_score, synergy_rationale, synergy_score_confirmed_at, synergy_score_confirmed_by, capability_gap_json, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [oppId, "재계산 기회", "assessed", "휴머노이드 로봇", 50, "구 확정 근거", NOW, "techcross", gapJson, "test", NOW]);

  // legacy 4-factor analysis (no capability_coverage factor) linked to it
  synId = ulid();
  db.run("INSERT INTO synergy_analysis (id, company_id, status, current_step, created_by, created_at, opportunity_id) VALUES (?,?,?,?,?,?,?)",
    [synId, "md-synergy-registry-sentinel", "completed", 5, "test", NOW, oppId]);
  const legacyPayload = JSON.stringify({
    synergyScore: 47,
    synergyRationale: "구 체계 산출",
    synergyScoreFactors: [
      { key: "market_attractiveness", label: "시장 매력도", value: 28, weight: 0.35, baseWeight: 0.35, note: "구 체계" },
      { key: "industry_match", label: "산업·역량 교집합", value: 17, weight: 0.3, baseWeight: 0.3, note: "구 체계" },
      { key: "financial_capacity", label: "재무 여력", value: 77, weight: 0.2, baseWeight: 0.2, note: "구 체계" },
      { key: "scope_match", label: "기회-시장 일치도", value: 100, weight: 0.15, baseWeight: 0.15, note: "구 체계" },
    ],
    scoreAdjustment: null,
    financialStrengths: ["정밀 가공"],
    marketLinkage: { marketSummaries: [], synergyAreas: [{ area: "정밀 감속기 공동 개발", synergyType: "기술·역량", rationale: "r", opportunity: "o", risk: "k", sources: [] }] },
  });
  db.run("INSERT INTO synergy_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [ulid(), synId, 1, legacyPayload, "test", NOW]);
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("POST /api/synergy/analyses/[id]/rescore (legacy → current scheme)", () => {
  test("401 anonymous / 404 unknown analysis", async () => {
    expect((await nextRequest(`/api/synergy/analyses/x/rescore`, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await nextRequest(`/api/synergy/analyses/x/rescore`, { method: "POST", headers: { cookie }, body: "{}" })).status).toBe(404);
  });

  test("400 for an analysis without an opportunity", async () => {
    const freeId = ulid();
    db.run("INSERT INTO synergy_analysis (id, company_id, status, current_step, created_by, created_at) VALUES (?,?,?,?,?,?)", [freeId, "md-synergy-registry-sentinel", "completed", 5, "test", NOW]);
    db.run("INSERT INTO synergy_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)", [ulid(), freeId, 1, JSON.stringify({ synergyScore: 40 }), "test", NOW]);
    const res = await nextRequest(`/api/synergy/analyses/${freeId}/rescore`, { method: "POST", headers: { cookie }, body: "{}" });
    expect(res.status).toBe(400);
  });

  test("converts the legacy payload: new version carries the capability factor and the recommendation follows the rerun rule", async () => {
    const res = await nextRequest(`/api/synergy/analyses/${synId}/rescore`, { method: "POST", headers: { cookie }, body: "{}" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.versionNo).toBe(2);

    // The appended version is the current scheme: capability_coverage present,
    // weights renormalized to 1, and the old four are recomputed — not copied.
    const stored = JSON.parse(db.query("SELECT payload FROM synergy_version WHERE analysis_id = ? AND version_no = 2").get(synId).payload);
    const keys = stored.synergyScoreFactors.map((f: { key: string }) => f.key);
    expect(keys).toContain("capability_coverage");
    const wsum = stored.synergyScoreFactors.filter((f: { value: unknown }) => f.value !== null).reduce((s: number, f: { weight: number }) => s + f.weight, 0);
    expect(wsum).toBeCloseTo(1, 5);
    expect(stored.capabilityCoverage).not.toBeNull();
    expect([typeof stored.synergyScore, stored.synergyScore === null ? "null" : "number"]).toContain("number");

    // The opportunity recommendation was re-recorded from the new payload, and
    // the person's 50 confirmation is invalidated iff the score changed.
    const opp = db.query("SELECT synergy_score, synergy_score_confirmed_at FROM opportunity WHERE id = ?").get(oppId) as { synergy_score: number; synergy_score_confirmed_at: string | null };
    expect(opp.synergy_score).toBe(stored.synergyScore);
    if (stored.synergyScore !== 50) expect(opp.synergy_score_confirmed_at).toBeNull();
    else expect(opp.synergy_score_confirmed_at).not.toBeNull();
  });

  test("the scoreEval tab exposes the conversion only for legacy payloads", () => {
    const tabs = readFileSync("app/web-next/components/stages/synergy/SynergyTabs.tsx", "utf8");
    expect(tabs).toContain("현재 체계로 재계산 (AI)");
    expect(tabs).toContain("!storedFactors.some((f) => f?.key === \"capability_coverage\")");
    const route = readFileSync("app/web-next/app/api/synergy/analyses/[id]/rescore/route.ts", "utf8");
    expect(route).toContain("requireBusinessActor");
  });
});
