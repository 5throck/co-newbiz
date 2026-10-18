// ADR-0182 Phase 4/5 — S3 시너지 점수 평가 탭 + AI 제안 + 검토 확정 기록.
// Covers: the tab restructure (TABS order, no 개요), the
// /api/synergy/ai-score-adjustment route's deterministic paths (no LLM →
// graceful proposal-less note; validation), and the gate decision's
// judgement_confirmations sidecar (persisted, sanitized, echoed in history).
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-synergy-score-eval.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const NOW = "2026-10-17T00:00:00Z";
let cookie = "";
let oppId = "";
let synId = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  await createUser(db, { userId: "score-eval", role: "analyst", password: "pw-score-eval-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "score-eval", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await loginCookie("score-eval", "pw-score-eval-12345");

  oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [oppId, "점수평가 기회", "assessed", "test", NOW]);
  synId = ulid();
  db.run("INSERT INTO synergy_analysis (id, company_id, status, current_step, created_by, created_at, opportunity_id) VALUES (?,?,?,?,?,?,?)", [synId, "md-synergy-registry-sentinel", "completed", 5, "test", NOW, oppId]);
  const payload = JSON.stringify({
    synergyScore: 72,
    synergyRationale: "규칙 기반 종합 판단 — 반영 요소: 시장 매력도.",
    synergyScoreFactors: [{ key: "market_attractiveness", label: "시장 매력도", value: 88, weight: 0.3, note: "CAGR 30% → 정규화 88/100" }],
    scoreAdjustment: { delta: -2, reason: "경쟁 강도 반영" },
    shortList: [{ area: "정밀 감속기", verdict: "Short List", reason: "강점 직결" }],
    capabilityCoverage: 60,
    capabilityCoverageNote: "필요 역량 5건 중 판정 4건",
    opportunity: { id: oppId, name: "점수평가 기회" },
  });
  db.run("INSERT INTO synergy_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)", [ulid(), synId, 1, payload, "test", NOW]);
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("TABS restructure (ADR-0182)", () => {
  test("tab order follows the flow: 연계 → 주요 검토 영역 → 필요 역량 → 시너지 점수 평가 → 의사결정 → 출처·노트", async () => {
    const { TABS } = await import("../../app/web-next/components/stages/synergy/synergyFormat.ts");
    expect(TABS.map(([k]) => k)).toEqual(["linkage", "shortlist", "capability", "scoreEval", "decision", "refs"]);
    expect(TABS.find(([k]) => k === "shortlist")?.[1]).toBe("주요 검토 영역");
    expect(TABS.find(([k]) => k === "scoreEval")?.[1]).toBe("시너지 점수 평가");
  });
  test("the old 개요 tab is gone from every synergy surface", () => {
    for (const f of [
      "app/web-next/components/stages/synergy/synergyFormat.ts",
      "app/web-next/components/stages/synergy/SynergyResult.tsx",
      "app/web-next/components/stages/synergy/SynergyTabs.tsx",
      "app/web-next/components/stages/synergy/useSynergyList.ts",
    ]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/"overview"|tab === "overview"/);
    }
  });
  test("profile summary moved out of the tab into the always-on context", () => {
    const result = readFileSync("app/web-next/components/stages/synergy/SynergyResult.tsx", "utf8");
    expect(result).toContain("<SynergyProfileContext p={p} />");
    expect(result).toContain('{tab === "scoreEval" && <SynergyScoreEvaluationTab ctx={ctx} p={p} />}');
    const linkage = readFileSync("app/web-next/components/stages/synergy/SynergyLinkageTab.tsx", "utf8");
    expect(linkage).toContain("재분석"); // rerun lives on the linkage tab now
  });
});

describe("POST /api/synergy/ai-score-adjustment (deterministic paths)", () => {
  test("401 for anonymous caller", async () => {
    const res = await nextRequest("/api/synergy/ai-score-adjustment", { method: "POST", body: JSON.stringify({ analysisId: synId }) });
    expect(res.status).toBe(401);
  });

  test("400 when analysisId is missing", async () => {
    const res = await nextRequest("/api/synergy/ai-score-adjustment", { method: "POST", headers: { cookie }, body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });

  test("404 for an unknown analysis", async () => {
    const res = await nextRequest("/api/synergy/ai-score-adjustment", { method: "POST", headers: { cookie }, body: JSON.stringify({ analysisId: "nope" }) });
    expect(res.status).toBe(404);
  });

  test("an analysis with no linked opportunity answers proposal-less before any LLM call", async () => {
    const freeId = ulid();
    db.run("INSERT INTO synergy_analysis (id, company_id, status, current_step, created_by, created_at) VALUES (?,?,?,?,?,?)", [freeId, "md-synergy-registry-sentinel", "completed", 5, "test", NOW]);
    db.run("INSERT INTO synergy_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)", [ulid(), freeId, 1, JSON.stringify({ synergyScore: 50 }), "test", NOW]);
    const res = await nextRequest("/api/synergy/ai-score-adjustment", { method: "POST", headers: { cookie }, body: JSON.stringify({ analysisId: freeId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.proposal).toBeNull();
    expect(body.data.note).toContain("기회");
  });
});

describe("gate decision judgement_confirmations sidecar (ADR-0182 §5)", () => {
  test("POST holds the checked claims; GET history echoes them sanitized", async () => {
    const res = await nextRequest(`/api/opportunities/${oppId}/gate-decisions`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({
        gate: "screening",
        decision: "hold",
        rationale: "판단 필요 항목 검토 후 보완",
        missing_artifacts: ["시너지 점수 확정"],
        judgement_confirmations: ["  근거 A  ", "근거 A", "근거 B", ""],
      }),
    });
    expect(res.status).toBe(201);
    const row = db.query("SELECT judgement_confirmations_json FROM gate_decision WHERE entity_id = ? ORDER BY decided_at DESC LIMIT 1").get(oppId) as { judgement_confirmations_json: string | null };
    expect(JSON.parse(row.judgement_confirmations_json ?? "[]")).toEqual(["근거 A", "근거 B"]);

    const get = await nextRequest(`/api/opportunities/${oppId}/gate-decisions`, { headers: { cookie } });
    expect(get.status).toBe(200);
    const list = (await get.json()).data.history as Array<{ judgement_confirmations: string[] }>;
    expect(list[0].judgement_confirmations).toEqual(["근거 A", "근거 B"]);
  });

  test("a decision without confirmations stores none (column stays null)", async () => {
    const res = await nextRequest(`/api/opportunities/${oppId}/gate-decisions`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ gate: "screening", decision: "hold", rationale: "체크 없이 기록", missing_artifacts: ["x"] }),
    });
    expect(res.status).toBe(201);
    const row = db.query("SELECT judgement_confirmations_json FROM gate_decision WHERE entity_id = ? ORDER BY decided_at DESC LIMIT 1").get(oppId) as { judgement_confirmations_json: string | null };
    expect(row.judgement_confirmations_json).toBeNull();
  });

  test("checkbox UI is gated behind the decision panel and rides with the POST", () => {
    const buckets = readFileSync("app/web-next/components/ReviewBuckets.tsx", "utf8");
    expect(buckets).toContain("onToggleJudgement");
    expect(buckets).toContain("사람 확인");
    const panel = readFileSync("app/web-next/components/GateDecisionPanel.tsx", "utf8");
    expect(panel).toContain("judgement_confirmations:");
    expect(panel).toContain("onDecisionJump={canRecord ? () => focusGateDecision(gates[0]) : undefined}");
  });
});
