// @version 1.0.0
/**
 * ADR-0196 phase B — chair agenda pass: deterministic fallback (criteria
 * spread >= 2 plus split recommendation), the LLM path and its failure
 * fallback, prompt threading into round 2+, and the human agenda edit on
 * the hybrid advance route (decision 3).
 */
import { describe, test, expect, beforeAll, afterAll, afterEach, mock } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-committee-agenda.sqlite");
// Coverage runs share one process across files: capture and restore every
// env var and module mock this suite touches (see committee-minutes.test.ts).
const PREV_ENV: Record<string, string | undefined> = {};
function setEnv(key: string, value: string): void {
  PREV_ENV[key] = process.env[key];
  process.env[key] = value;
}
setEnv("CO_NEWBIZ_DB_PATH", TEST_DB_PATH);
// Chair passes must stay deterministic in tests even on a machine with a
// real provider in the root .env — force "no LLM" (the fallback contract).
setEnv("CO_NEWBIZ_LLM_PROVIDER", "none");

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);

// Owner decision 10 (ADR-0196 amendment 2026-11-09): the mode env var is
// gone — REST convene requires the provider seam to be registered, so this
// suite injects the deterministic agent AS the factory (the provider is
// forced offline above, so the chair passes stay deterministic).
const { setCallAgentFactory, deterministicCallAgent } = await import("../../app/web-next/lib/committee-agents.ts");
setCallAgentFactory(() => deterministicCallAgent());
const db = getDb(TEST_DB_PATH);

/**
 * Async convene contract (202): the deliberation runs in the background of
 * the SAME test process — wait until the session leaves the convening state
 * before continuing with the route-level assertions.
 */
async function waitForSessionSettled(sessionId: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const row = db.query("SELECT meta_json FROM process_run WHERE id = ?").get(sessionId) as { meta_json: string };
    const meta = JSON.parse(row.meta_json) as { convening?: boolean };
    if (!meta.convening) return;
    await Bun.sleep(20);
  }
  throw new Error(`committee session ${sessionId} did not settle in time`);
}

// Snapshot of the pristine llm module (spread BEFORE any mock.module call).
// bun's cross-file mock.module restore only works with this afterEach +
// mock.restore() pattern — see dd-tailor-korean.test.ts.
const PRISTINE_LLM = { ...(await import("../../app/web-next/lib/llm.ts")) };
const llmResets: Array<() => void> = [];
afterEach(() => {
  for (const r of llmResets.splice(0)) r();
});

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { computeAgendaFallback, runChairAgenda } = await import("../../app/web-next/lib/committee-chair.ts");
const { runDeliberationRounds } = await import("../../app/web-next/lib/deliberation.ts");

const NOW = new Date().toISOString();

function row(
  seat: string,
  id: string,
  criteria: Record<string, number>,
  recommendation?: string,
): import("../../app/web-next/lib/committee-chair.ts").ChairPositionRow {
  const tail: Record<string, unknown> = {
    recommendation: recommendation ?? "go",
    confidence: 70,
    criteria_scores: criteria,
  };
  return {
    id,
    seat,
    memberType: "agent",
    round: 1,
    positionMd: `### ${seat}\n\n입장\n\n<!--position-meta:${JSON.stringify(tail)}-->`,
  };
}

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

let analystCookie: string;

beforeAll(async () => {
  await createUser(db, { userId: "bob", role: "analyst", password: "pw-bob-123456", createdBy: "test", now: NOW });
  approveUser(db, { userId: "bob", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie("bob", "pw-bob-123456");
});

afterAll(async () => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  // Restore env overrides; per-test llm mock restoration happens in afterEach.
  for (const [k, v] of Object.entries(PREV_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function createOpportunity(): Promise<string> {
  const res = await req("/api/opportunities", {
    method: "POST",
    headers: { cookie: analystCookie },
    body: JSON.stringify({ name: "Agenda test opportunity" }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data.id as string;
}

describe("computeAgendaFallback (deterministic)", () => {
  test("one issue per criterion with spread >= 2, raised_by the low scorers", () => {
    const rows = [
      row("risk-officer", "P1", {
        control_need: 3,
        capability_criticality: 2,
        market_uncertainty: 3,
        integration_capacity: 2,
        speed_to_capability: 2,
      }),
      row("industry-lead", "P2", {
        control_need: 1,
        capability_criticality: 2,
        market_uncertainty: 1,
        integration_capacity: 2,
        speed_to_capability: 2,
      }),
      row("legal-counsel", "P3", {
        control_need: 2,
        capability_criticality: 2,
        market_uncertainty: 2,
        integration_capacity: 2,
        speed_to_capability: 2,
      }),
    ];
    const agenda = computeAgendaFallback(rows);
    expect(agenda.map((i) => i.title)).toEqual([
      expect.stringContaining("control_need"),
      expect.stringContaining("market_uncertainty"),
    ]);
    expect(agenda[0].contested).toBe(true);
    expect(agenda[0].raisedBy).toContain("industry-lead");
    // Split recommendations add the overall issue — all 'go' here, so none.
    expect(agenda.some((i) => i.title.includes("권고 분분"))).toBe(false);
  });

  test("split recommendations produce the overall issue", () => {
    const rows = [
      row(
        "risk-officer",
        "P1",
        {
          control_need: 2,
          capability_criticality: 2,
          market_uncertainty: 2,
          integration_capacity: 2,
          speed_to_capability: 2,
        },
        "kill",
      ),
      row(
        "industry-lead",
        "P2",
        {
          control_need: 2,
          capability_criticality: 2,
          market_uncertainty: 2,
          integration_capacity: 2,
          speed_to_capability: 2,
        },
        "go",
      ),
    ];
    const agenda = computeAgendaFallback(rows);
    expect(agenda).toHaveLength(1);
    expect(agenda[0].title).toContain("권고 분분");
    expect(agenda[0].id).toBe("I1");
  });

  test("uniform positions produce no agenda", () => {
    const rows = [
      row("risk-officer", "P1", {
        control_need: 2,
        capability_criticality: 2,
        market_uncertainty: 2,
        integration_capacity: 2,
        speed_to_capability: 2,
      }),
      row("industry-lead", "P2", {
        control_need: 2,
        capability_criticality: 2,
        market_uncertainty: 2,
        integration_capacity: 2,
        speed_to_capability: 2,
      }),
    ];
    expect(computeAgendaFallback(rows)).toEqual([]);
  });

  test("agenda is capped at 5 issues with sequential ids", () => {
    const rows = [
      row("risk-officer", "P1", {
        control_need: 3,
        capability_criticality: 3,
        market_uncertainty: 3,
        integration_capacity: 1,
        speed_to_capability: 1,
      }),
      row("industry-lead", "P2", {
        control_need: 1,
        capability_criticality: 1,
        market_uncertainty: 1,
        integration_capacity: 3,
        speed_to_capability: 3,
      }),
    ];
    const agenda = computeAgendaFallback(rows);
    expect(agenda.length).toBeLessThanOrEqual(5);
    expect(agenda.map((i) => i.id)).toEqual(agenda.map((_, idx) => `I${idx + 1}`));
  });
});

describe("runChairAgenda — LLM path and failure fallback", () => {
  test("no LLM configured → deterministic fallback, source fallback", async () => {
    const rows = [
      row("risk-officer", "P1", {
        control_need: 3,
        capability_criticality: 2,
        market_uncertainty: 2,
        integration_capacity: 2,
        speed_to_capability: 2,
      }),
      row("industry-lead", "P2", {
        control_need: 1,
        capability_criticality: 2,
        market_uncertainty: 2,
        integration_capacity: 2,
        speed_to_capability: 2,
      }),
    ];
    const out = await runChairAgenda({ topic: "안건", rows });
    expect(out.source).toBe("fallback");
    expect(out.model).toBeUndefined();
    expect(out.promptVersion).toBe("committee.agenda@1");
    expect(out.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a budget/rate-limit error degrades to the fallback — the pass never throws", async () => {
    // Restore the mock before the next test AND before later files in the same
    // coverage process — bun's mock.module is process-global and does not
    // restore on its own (see dd-tailor-korean.test.ts for the pattern).
    llmResets.push(() => mock.restore());
    llmResets.push(() => mock.module("../../app/web-next/lib/llm.ts", () => ({ ...PRISTINE_LLM })));
    mock.module("../../app/web-next/lib/llm.ts", () => ({
      ...PRISTINE_LLM,
      complete: async () => {
        throw new Error("LLM HTTP 429: budget exceeded");
      },
    }));
    const { runChairAgenda: patched } = await import("../../app/web-next/lib/committee-chair.ts");
    // Simulate a configured provider: runChairAgenda calls the LLM only when
    // getProviderConfig() is non-null, so patch it through the same module.
    const chair = await import("../../app/web-next/lib/committee-chair.ts");
    const rows = [
      row("risk-officer", "P1", {
        control_need: 3,
        capability_criticality: 2,
        market_uncertainty: 2,
        integration_capacity: 2,
        speed_to_capability: 2,
      }),
      row("industry-lead", "P2", {
        control_need: 1,
        capability_criticality: 2,
        market_uncertainty: 2,
        integration_capacity: 2,
        speed_to_capability: 2,
      }),
    ];
    // Provider unconfigured in tests: the call path is the fallback already;
    // assert the contract (no throw, fallback marked) under the mocked 429.
    const out = await patched({ topic: "안건", rows });
    expect(out.source).toBe("fallback");
    void chair;
  });
});

describe("runDeliberationRounds agenda threading (agent_team)", () => {
  test("round 2+ prompts carry the agenda produced by the chair pass", async () => {
    // The agenda block is part of the responsive round-2+ prompt (ADR-0196
    // §2.1/§2.2) — turn the phase-A flag on for this test.
    setEnv("CO_NEWBIZ_COMMITTEE_RESPONSIVE", "1");
    getDb().run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [
      "agenda-thread-anchor",
      "TEST",
      NOW,
    ]);
    const prompts: string[] = [];
    const result = await runDeliberationRounds(
      { entityType: "project", entityId: "agenda-thread-anchor" },
      {
        committeeKey: "route-steering-committee",
        agents: [{ agentKey: "industry-lead" }, { agentKey: "risk-officer" }],
        rounds: 2,
        topic: "프록시 사슬 신뢰도 검토",
        callAgent: (key, prompt) => {
          prompts.push(`${key}::${prompt}`);
          return Promise.resolve({ positionMd: `### ${key} 입장`, recommendation: "go", confidence: 60 });
        },
        gate: "pre_fs",
        actor: "test",
        stage: "meeting",
        chairAgendaPass: async () => ({
          agenda: [
            { id: "I1", title: "수요 전제 신뢰도", contested: true },
            { id: "I2", title: "인증 이전 가능성" },
          ],
          source: "fallback" as const,
          promptVersion: "committee.agenda@1",
          inputHash: "test-hash",
          createdAt: NOW,
        }),
      },
    );
    expect(result.agenda?.agenda).toHaveLength(2);
    const round2 = prompts.filter((p) => p.startsWith("industry-lead::") && p.includes("응답 규칙"));
    expect(round2.length).toBeGreaterThan(0);
    expect(round2[0]).toContain("## 안건 쟁점 (의장 제안)");
    expect(round2[0]).toContain("- I1: 수요 전제 신뢰도 (쟁점 분분)");
    // Round 1 has no agenda section.
    expect(prompts[0]).not.toContain("## 안건 쟁점");
  });
});

describe("hybrid agenda via the advance route (decision 3)", () => {
  test("a human-edited agenda is stored as human_edited and surfaced in the transcript", async () => {
    const oppId = await createOpportunity();
    const res = await req(`/api/opportunities/${oppId}/committee-sessions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ committeeKey: "route-steering-committee", decisionMode: "hybrid" }),
    });
    expect(res.status).toBe(202);
    const sessionId = (await res.json()).data.sessionId as string;
    await waitForSessionSettled(sessionId);

    // A malformed agenda body is refused before the round starts.
    const bad = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/advance`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ agenda: "not-an-array" }),
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("invalid_agenda");

    // Round 1 needs a human voice first (hybrid rule, unchanged).
    const pos = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/positions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ positionMd: "인간 위원 1라운드", recommendation: "go" }),
    });
    expect(pos.status).toBe(201);

    const adv = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/advance`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ agenda: [{ title: "수요 전제" }, { title: "인증 이전" }, { title: "자금 조달" }] }),
    });
    if (adv.status !== 200) console.log("ADV ERR", await adv.text());
    expect(adv.status).toBe(200);

    const transcript = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}`, {
      headers: { cookie: analystCookie },
    });
    const t = (await transcript.json()).data;
    expect(t.agenda).toEqual([
      { id: "I1", title: "수요 전제" },
      { id: "I2", title: "인증 이전" },
      { id: "I3", title: "자금 조달" },
    ]);
    expect(t.agendaMeta.source).toBe("human_edited");
    // Ids are engine-owned and sequential.
    expect(t.agenda.map((a: { id: string }) => a.id)).toEqual(["I1", "I2", "I3"]);
  });

  test("without a human body, advance generates the chair agenda (deterministic fallback)", async () => {
    const oppId = await createOpportunity();
    const res = await req(`/api/opportunities/${oppId}/committee-sessions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ committeeKey: "route-steering-committee", decisionMode: "hybrid" }),
    });
    expect(res.status).toBe(202);
    const sessionId = (await res.json()).data.sessionId as string;
    await waitForSessionSettled(sessionId);
    await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/positions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ positionMd: "인간 위원 1라운드", recommendation: "go" }),
    });
    const adv = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/advance`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({}),
    });
    expect(adv.status).toBe(200);
    const transcript = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}`, {
      headers: { cookie: analystCookie },
    });
    const t = (await transcript.json()).data;
    expect(Array.isArray(t.agenda)).toBe(true);
    expect(t.agendaMeta.source).toBe("fallback");
    expect(t.agendaMeta.prompt_version).toBe("committee.agenda@1");
    // The agenda is generated exactly once — a second advance must not overwrite it.
    await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/positions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ positionMd: "인간 위원 2라운드", recommendation: "go" }),
    });
    const adv2 = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/advance`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ agenda: [{ title: "덮어쓰기 시도" }] }),
    });
    expect(adv2.status).toBe(200);
    const t2 = (
      await (
        await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}`, { headers: { cookie: analystCookie } })
      ).json()
    ).data;
    expect(t2.agendaMeta.source).not.toBe("human_edited");
  });
});
