// Amendment 2026-11-12 of design 2026-10-18-synergy-4element-design — the
// /api/synergy/ai-score-adjustment route reads the LIVE capability register
// (readLiveCapabilityCoverage blend) for the 필요 역량 충족도 prompt line, not
// the stored payload snapshot. The pipeline stores coverage BEFORE the human
// 보유 판정 seeds the rows (synergy-pipeline.ts:418-433 → :569-590), so the
// stored value is pre-judgement by design; the advertised input must be what
// the user has actually judged.
//
// Asserts the PROMPT-CONSTRUCTION INPUT (not LLM output) — completeDetailed is
// mocked to capture the prompt (the dd-tailor-korean / committee-minutes
// mock.module pattern; PRISTINE snapshot + afterEach restore because bun's
// mock.module is process-global).
import { test, expect, beforeAll, afterAll, afterEach, describe, mock } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-synergy-ai-calibration-live.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const NOW = "2026-10-18T00:00:00Z";

// Snapshot of the pristine llm module (spread BEFORE any mock.module call) —
// bun's cross-file mock.module restore only works with the afterEach +
// mock.restore() pattern.
const PRISTINE_LLM = { ...(await import("../../app/web-next/lib/llm.ts")) };
const llmResets: Array<() => void> = [];
afterEach(() => {
  for (const r of llmResets.splice(0)) r();
});

/** Mock the LLM seam: capture the prompt, answer with a canned adjustment. */
function mockLlmWith(adjustment: number): { prompts: string[] } {
  const prompts: string[] = [];
  llmResets.push(() => mock.restore());
  llmResets.push(() => mock.module("../../app/web-next/lib/llm.ts", () => ({ ...PRISTINE_LLM })));
  mock.module("../../app/web-next/lib/llm.ts", () => ({
    ...PRISTINE_LLM,
    isLlmConfigured: () => true,
    completeDetailed: async (messages: Array<{ role: string; content: string }>) => {
      prompts.push(messages.map((m) => m.content).join("\n"));
      return { text: `\`\`\`json\n{"adjustment": ${adjustment}, "rationale": "보정 사유"}\n\`\`\`` };
    },
  }));
  return { prompts };
}

let cookie = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

/** Register JSON: 2 judged rows (1 essential leading, 1 optional partial).
 *  Pre-extraction blend: coveragePct = round((1+0.5)/2*100) = 75,
 *  essentialCoveragePct = round(1/1*100) = 100 → round(75*0.5 + 100*0.5) = 88. */
const JUDGED_REGISTER = JSON.stringify({
  rows: [
    {
      id: "gap-1",
      capability: "정밀 감속기 설계",
      source: "manual",
      necessity: "essential",
      held: { status: "leading", holders: ["계열사 A"], evidence: "프로필" },
    },
    {
      id: "gap-2",
      capability: "해외 유통망",
      source: "manual",
      necessity: "optional",
      held: { status: "partial", holders: ["계열사 B"], evidence: "프로필" },
    },
  ],
  updatedAt: NOW,
});
const ALL_UNJUDGED_REGISTER = JSON.stringify({
  rows: [
    {
      id: "gap-1",
      capability: "정밀 감속기 설계",
      source: "manual",
      necessity: "essential",
      held: { status: "unevaluated", holders: [], evidence: "" },
    },
    {
      id: "gap-2",
      capability: "해외 유통망",
      source: "manual",
      necessity: "optional",
      held: { status: "unevaluated", holders: [], evidence: "" },
    },
  ],
  updatedAt: NOW,
});

/** Seed an analysis whose STORED payload deliberately disagrees with the live
 *  register (stored 60 / "저장 스냅샷" note) — pins the fresh-read rule. */
function seedAnalysis(opportunityId: string | null, registerJson: string | null): string {
  const oppId = opportunityId;
  if (oppId) {
    db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [
      oppId,
      "보정 기회",
      "assessed",
      "test",
      NOW,
    ]);
    db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [registerJson, oppId]);
  }
  const synId = ulid();
  db.run(
    "INSERT INTO synergy_analysis (id, company_id, status, current_step, created_by, created_at, opportunity_id) VALUES (?,?,?,?,?,?,?)",
    [synId, "md-synergy-registry-sentinel", "completed", 5, "test", NOW, oppId],
  );
  const payload = JSON.stringify({
    synergyScore: 72,
    synergyRationale: "규칙 기반 종합 판단",
    synergyScoreFactors: [{ key: "market_attractiveness", label: "시장 매력도", value: 80, weight: 0.3, note: "n" }],
    shortList: [{ area: "정밀 감속기", verdict: "Short List", reason: "강점 직결" }],
    // The stale stored snapshot the amendment retires from this prompt:
    capabilityCoverage: 60,
    capabilityCoverageNote: "저장 스냅샷 노트 — 프롬프트에 있으면 안 된다",
    opportunity: { id: oppId, name: "보정 기회" },
  });
  db.run(
    "INSERT INTO synergy_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [ulid(), synId, 1, payload, "test", NOW],
  );
  return synId;
}

beforeAll(async () => {
  await createUser(db, {
    userId: "calibration-live",
    role: "analyst",
    password: "pw-calibration-12345",
    createdBy: "test",
    now: NOW,
  });
  approveUser(db, { userId: "calibration-live", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await loginCookie("calibration-live", "pw-calibration-12345");
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("AI calibration draft reads the live capability register (Amendment 2026-11-12)", () => {
  test("judged register → the prompt carries the live blended value, not the stored payload value", async () => {
    const synId = seedAnalysis(ulid(), JUDGED_REGISTER);
    const { prompts } = mockLlmWith(0);
    const res = await nextRequest("/api/synergy/ai-score-adjustment", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ analysisId: synId }),
    });
    expect(res.status).toBe(200);
    expect(prompts).toHaveLength(1);
    const prompt = prompts[0];
    // Live blend of the register the human has judged (75/100 보유율, 100%
    // 필수 충족율 → 88), with the shared note strings.
    expect(prompt).toContain("- 필요 역량 충족도: 88/100");
    expect(prompt).toContain("필요 역량 2건 중 판정 2건 — 보유율 75%, 필수 충족율 100%");
    // The stored pre-judgement snapshot must not reach the prompt.
    expect(prompt).not.toContain("60/100");
    expect(prompt).not.toContain("저장 스냅샷 노트");
    // Not the fallback either — the advertised input is present.
    expect(prompt).not.toContain("미입력");
  });

  test("empty register (no rows) → 미입력 in the prompt (null rule)", async () => {
    const synId = seedAnalysis(ulid(), null);
    const { prompts } = mockLlmWith(0);
    const res = await nextRequest("/api/synergy/ai-score-adjustment", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ analysisId: synId }),
    });
    expect(res.status).toBe(200);
    expect(prompts[0]).toContain("- 필요 역량 충족도: 미입력");
    expect(prompts[0]).not.toContain("60/100");
  });

  test("register with rows but all unevaluated → 미입력 in the prompt (모두 미판정 note)", async () => {
    const synId = seedAnalysis(ulid(), ALL_UNJUDGED_REGISTER);
    const { prompts } = mockLlmWith(0);
    const res = await nextRequest("/api/synergy/ai-score-adjustment", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ analysisId: synId }),
    });
    expect(res.status).toBe(200);
    expect(prompts[0]).toContain("- 필요 역량 충족도: 미입력");
    expect(prompts[0]).toContain("필요 역량 2건 모두 미판정 — 충족도 팩터 미반영");
  });

  test("the ±10 clamp is unchanged — an LLM proposing +25 yields a clamped 10", async () => {
    const synId = seedAnalysis(ulid(), JUDGED_REGISTER);
    const { prompts } = mockLlmWith(25);
    const res = await nextRequest("/api/synergy/ai-score-adjustment", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ analysisId: synId }),
    });
    expect(res.status).toBe(200);
    expect(prompts).toHaveLength(1);
    const body = (await res.json()) as {
      data: { proposal: { adjustment: number; rationale: string } | null; note: string };
    };
    expect(body.data.proposal?.adjustment).toBe(10);
    // A non-integer proposal rounds before clamping (route.ts:97 unchanged).
    const { prompts: p2 } = mockLlmWith(7.6);
    const res2 = await nextRequest("/api/synergy/ai-score-adjustment", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ analysisId: synId }),
    });
    const body2 = (await res2.json()) as { data: { proposal: { adjustment: number } | null } };
    expect(body2.data.proposal?.adjustment).toBe(8);
    expect(p2).toHaveLength(1);
  });
});
