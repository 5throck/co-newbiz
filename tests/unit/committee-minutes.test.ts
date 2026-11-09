// @version 1.0.0
/**
 * ADR-0196 phase B — chair minutes pass end-to-end: meta persistence (S2),
 * the zod-validated draft (no recommendation, no dissent fields), the
 * rendered §2.4 layout with VERBATIM dissent, ?format=json, the GET-never-
 * calls-the-LLM rule (spy on complete), and the regeneration rules
 * (analyst+, audited, refused after confirm / when nothing changed).
 */
import { describe, test, expect, beforeAll, afterAll, afterEach, mock } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-committee-minutes.sqlite");
// Coverage runs share one process across files: capture and restore every
// env var and module mock this suite touches, or the llm-executors /
// agent-orchestrator suites inherit our "no LLM" state.
const PREV_ENV: Record<string, string | undefined> = {};
function setEnv(key: string, value: string): void {
  PREV_ENV[key] = process.env[key];
  process.env[key] = value;
}
setEnv("CO_NEWBIZ_DB_PATH", TEST_DB_PATH);
setEnv("CO_NEWBIZ_COMMITTEE_AGENTS", "deterministic");
setEnv("CO_NEWBIZ_COMMITTEE_RESPONSIVE", "1");
// Chair passes must stay deterministic in tests even on a machine with a
// real provider in the root .env — force "no LLM" (the fallback contract).
setEnv("CO_NEWBIZ_LLM_PROVIDER", "none");

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

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
const { computeMinutesFallback } = await import("../../app/web-next/lib/committee-chair.ts");

const NOW = new Date().toISOString();

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

let analystCookie: string;
let _analyst2Cookie: string;
let viewerCookie: string;

beforeAll(async () => {
  await createUser(db, { userId: "carol", role: "analyst", password: "pw-carol-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "carol", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "drew", role: "analyst", password: "pw-drew-123456", createdBy: "test", now: NOW });
  approveUser(db, { userId: "drew", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "vince", role: "viewer", password: "pw-vince-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "vince", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie("carol", "pw-carol-12345");
  _analyst2Cookie = await loginCookie("drew", "pw-drew-123456");
  viewerCookie = await loginCookie("vince", "pw-vince-12345");
});

afterAll(async () => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  // Restore the env this suite overrode; per-test llm mock restoration
  // happens in afterEach.
  for (const [k, v] of Object.entries(PREV_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function createOpportunity(name = "Minutes test opportunity"): Promise<string> {
  const res = await req("/api/opportunities", {
    method: "POST",
    headers: { cookie: analystCookie },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data.id as string;
}

async function conveneAgentTeam(oppId: string): Promise<string> {
  const res = await req(`/api/opportunities/${oppId}/committee-sessions`, {
    method: "POST",
    headers: { cookie: analystCookie },
    body: JSON.stringify({ committeeKey: "route-steering-committee", decisionMode: "agent_team" }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data.sessionId as string;
}

describe("agent_team minutes (deterministic fallback, S2 storage)", () => {
  let oppId: string;
  let sessionId: string;
  beforeAll(async () => {
    oppId = await createOpportunity();
    sessionId = await conveneAgentTeam(oppId);
  });

  function metaOf(id: string): Record<string, unknown> {
    const row = db.query("SELECT meta_json FROM process_run WHERE id = ?").get(id) as { meta_json: string };
    return JSON.parse(row.meta_json) as Record<string, unknown>;
  }

  test("the agenda pass and the minutes pass persist into meta_json (S2)", () => {
    const meta = metaOf(sessionId);
    expect(Array.isArray(meta.agenda)).toBe(true);
    expect((meta.agenda as unknown[]).length).toBeGreaterThanOrEqual(1); // deterministic seats split kill/go
    const agendaMeta = meta.agenda_meta as { source: string; prompt_version: string; input_hash: string };
    expect(agendaMeta.source).toBe("fallback");
    expect(agendaMeta.prompt_version).toBe("committee.agenda@1");
    expect(agendaMeta.input_hash).toMatch(/^[0-9a-f]{64}$/);
    const draft = meta.minutes_draft as {
      json: Record<string, unknown>;
      fallback: boolean;
      prompt_version: string;
      input_hash: string;
    };
    expect(draft.fallback).toBe(true);
    expect(draft.prompt_version).toBe("committee.minutes@1");
    expect(draft.input_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("the minutes draft has NO recommendation field and NO dissent field", () => {
    const meta = metaOf(sessionId);
    const json = (meta.minutes_draft as { json: Record<string, unknown> }).json;
    expect(json).not.toHaveProperty("recommendation");
    expect(json).not.toHaveProperty("dissent");
    expect(json).not.toHaveProperty("dissent_json");
    expect(Object.keys(json).sort()).toEqual(["action_items", "agenda", "agreements", "discussion", "open_questions"]);
  });

  test("the rendered markdown follows the §2.4 order with the disclaimer and proposal label", async () => {
    const res = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/minutes`, {
      headers: { cookie: analystCookie },
    });
    expect(res.status).toBe(200);
    const md = await res.text();
    expect(md).toContain("Decision support. The gate decision is recorded only by a human in gate_decision.");
    expect(md).toContain("## 안건 쟁점 (의장 제안)");
    expect(md).toContain("## 쟁점별 논의");
    expect(md).toContain("## 보존된 이의 (dissent)");
    expect(md).toContain("## 제안 권고 (proposal, not a decision)");
    expect(md).toContain("## 부록 B — 입장 원문 (전문)");
    expect(md).toContain("AI-drafted (chair minutes pass");
    expect(md).toContain('id="pos-');
    // Section order: agenda < discussion < dissent < recommendation < appendix.
    const idx = (s: string) => md.indexOf(s);
    expect(idx("## 안건 쟁점")).toBeLessThan(idx("## 쟁점별 논의"));
    expect(idx("## 쟁점별 논의")).toBeLessThan(idx("## 보존된 이의"));
    expect(idx("## 보존된 이의")).toBeLessThan(idx("## 제안 권고"));
    expect(idx("## 제안 권고")).toBeLessThan(idx("## 부록"));
  });

  test("preserved dissent is byte-equal to the raw dissent_json position", async () => {
    const t = (
      await (
        await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}`, { headers: { cookie: analystCookie } })
      ).json()
    ).data;
    const md = await (
      await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/minutes`, {
        headers: { cookie: analystCookie },
      })
    ).text();
    const dissents = JSON.parse(t.evaluation.dissentJson) as Array<{ member_key: string; position_md: string }>;
    expect(dissents.length).toBeGreaterThan(0);
    for (const d of dissents) {
      expect(md).toContain(d.position_md);
    }
    // The AI-drafted draft never carries a reworded dissent.
    const meta = JSON.parse(
      (db.query("SELECT meta_json FROM process_run WHERE id = ?").get(sessionId) as { meta_json: string }).meta_json,
    ) as Record<string, unknown>;
    expect(JSON.stringify((meta.minutes_draft as { json: unknown }).json)).not.toContain("veto dissent");
  });

  test("?format=json returns the structured payload for the UI", async () => {
    const res = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/minutes?format=json`, {
      headers: { cookie: analystCookie },
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.sessionId).toBe(sessionId);
    expect(data.agenda.length).toBeGreaterThan(0);
    expect(data.minutesDraft.fallback).toBe(true);
    expect(data.minutesDraft.json.discussion).toBeInstanceOf(Array);
    expect(data.recommendation).toBeTruthy();
    expect(data.scorecard.rows.length).toBeGreaterThan(0);
  });

  test("a GET never calls the LLM — complete() is never invoked while rendering", async () => {
    let calls = 0;
    // Restore the mock before the next test AND before later files in the same
    // coverage process — bun's mock.module is process-global and does not
    // restore on its own (see dd-tailor-korean.test.ts for the pattern).
    llmResets.push(() => mock.restore());
    llmResets.push(() => mock.module("../../app/web-next/lib/llm.ts", () => ({ ...PRISTINE_LLM })));
    mock.module("../../app/web-next/lib/llm.ts", () => ({
      ...PRISTINE_LLM,
      complete: async () => {
        calls += 1;
        throw new Error("LLM must not be called on a GET");
      },
    }));
    const { buildCommitteeMinutes, buildCommitteeMinutesJson } = await import(
      "../../app/web-next/lib/committee-scorecard.ts"
    );
    expect(buildCommitteeMinutes(db, sessionId)).toBeTruthy();
    expect(buildCommitteeMinutesJson(db, sessionId)).not.toBeNull();
    // And through the route.
    expect(
      (
        await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/minutes`, {
          headers: { cookie: analystCookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/minutes?format=json`, {
          headers: { cookie: analystCookie },
        })
      ).status,
    ).toBe(200);
    expect(calls).toBe(0);
  });
});

describe("minutes regeneration rules (decision 4)", () => {
  let oppId: string;
  let sessionId: string;
  beforeAll(async () => {
    oppId = await createOpportunity("Minutes regeneration");
    sessionId = await conveneAgentTeam(oppId);
  });

  test("a viewer is refused (analyst+ required)", async () => {
    const res = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/minutes`, {
      method: "POST",
      headers: { cookie: viewerCookie },
      body: JSON.stringify({ regenerate: true }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("role_required");
  });

  test("regeneration is allowed while unconfirmed (fallback draft) and lands an audit row", async () => {
    const res = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/minutes`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ regenerate: true }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.fallback).toBe(true);
    const audit = db
      .query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'committee_minutes.regenerate' AND target = ?")
      .get(sessionId) as { n: number };
    expect(audit.n).toBe(1);
  });

  test("confirm works once, then regeneration is refused with 409", async () => {
    const confirm = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/minutes`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ confirm: true }),
    });
    expect(confirm.status).toBe(200);
    const again = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/minutes`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ confirm: true }),
    });
    expect(again.status).toBe(409);
    const regen = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/minutes`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ regenerate: true }),
    });
    expect(regen.status).toBe(409);
    expect((await regen.json()).error.code).toBe("minutes_already_confirmed");
  });

  test("confirm and regenerate are mutually exclusive", async () => {
    const opp2 = await createOpportunity("Minutes exclusive");
    const sid = await conveneAgentTeam(opp2);
    const res = await req(`/api/opportunities/${opp2}/committee-sessions/${sid}/minutes`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ confirm: true, regenerate: true }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });
});

describe("minutes at synthesis with human voices (hybrid)", () => {
  test("the synthesis of a hybrid session stores the minutes draft too", async () => {
    const oppId = await createOpportunity("Minutes hybrid");
    const res = await req(`/api/opportunities/${oppId}/committee-sessions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ committeeKey: "route-steering-committee", decisionMode: "hybrid" }),
    });
    const sessionId = (await res.json()).data.sessionId as string;
    // Round 1: the human voice gates the agent round (hybrid rule).
    await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/positions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ positionMd: "인간 위원 1라운드", recommendation: "go" }),
    });
    await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/advance`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ agenda: [{ title: "수요 전제" }, { title: "인증 이전" }] }),
    });
    let last = "";
    for (let i = 0; i < 3; i++) {
      const adv = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/advance`, {
        method: "POST",
        headers: { cookie: analystCookie },
        body: JSON.stringify({}),
      });
      last = (await adv.json()).data?.status;
      if (last === "synthesized") break;
      await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/positions`, {
        method: "POST",
        headers: { cookie: analystCookie },
        body: JSON.stringify({ positionMd: `인간 위원 라운드 ${i + 2}`, recommendation: "go" }),
      });
    }
    expect(last).toBe("synthesized");
    const meta = JSON.parse(
      (db.query("SELECT meta_json FROM process_run WHERE id = ?").get(sessionId) as { meta_json: string }).meta_json,
    ) as Record<string, unknown>;
    const draft = meta.minutes_draft as { json: { discussion: unknown[] }; fallback: boolean } | undefined;
    expect(draft).toBeDefined();
    expect(draft?.fallback).toBe(true);
    // The human-edited agenda from the advance body is what the draft resolved against.
    expect((meta.agenda as Array<{ id: string }>).map((a) => a.id)).toEqual(["I1", "I2"]);
  });
});

describe("computeMinutesFallback (deterministic minutes)", () => {
  test("builds the discussion from responds_to tails grouped by issue", () => {
    const rows = [
      {
        id: "POS-1",
        seat: "risk-officer",
        memberType: "agent",
        round: 2,
        positionMd:
          '### risk-officer\n\n반박\n\n<!--position-meta:{"recommendation":"kill","confidence":80,"responds_to":[{"seat":"industry-lead","act":"rebut","issue":"I1"}],"stance_changed":false,"issues":["I1"]}-->',
      },
      {
        id: "POS-2",
        seat: "industry-lead",
        memberType: "agent",
        round: 2,
        positionMd:
          '### industry-lead\n\n동의\n\n<!--position-meta:{"recommendation":"go","confidence":72,"responds_to":[{"seat":"risk-officer","act":"agree","issue":"I1"}],"stance_changed":false,"issues":["I1"]}-->',
      },
    ];
    const json = computeMinutesFallback(
      [{ id: "I1", title: "수요 전제 신뢰度".replace("度", "도"), contested: true }],
      rows,
    );
    expect(json.discussion).toHaveLength(1);
    expect(json.discussion[0].exchanges).toHaveLength(2);
    expect(json.discussion[0].exchanges[0].position_ref).toBe("POS-1");
    expect(json.discussion[0].exchanges[0].act).toBe("rebut");
    expect(json.discussion[0].exchanges[1].act).toBe("agree");
    expect(json.discussion[0].resolution).toBe("unresolved"); // a rebut stands
    expect(json.agenda[0].id).toBe("I1");
  });

  test("an ask surfaces as an open question owned by the addressed seat", () => {
    const rows = [
      {
        id: "POS-3",
        seat: "legal-counsel",
        memberType: "agent",
        round: 2,
        positionMd:
          '### legal-counsel\n\n질문\n\n<!--position-meta:{"recommendation":"go","confidence":70,"responds_to":[{"seat":"industry-lead","act":"ask","issue":"I2"}],"stance_changed":false,"issues":["I2"]}-->',
      },
    ];
    const json = computeMinutesFallback([{ id: "I2", title: "인증 이전 가능성" }], rows);
    expect(json.open_questions).toHaveLength(1);
    expect(json.open_questions[0].owner_seat).toBe("industry-lead");
    expect(json.discussion[0].resolution).toBe("narrowed");
  });

  test("no agenda and no tails → empty thin minutes", () => {
    const rows = [
      {
        id: "POS-4",
        seat: "risk-officer",
        memberType: "agent",
        round: 1,
        positionMd: "### risk-officer\n\n텍스트뿐 입장",
      },
    ];
    const json = computeMinutesFallback([], rows);
    expect(json.discussion).toHaveLength(0);
    expect(json.agreements).toHaveLength(0);
    expect(json.action_items).toHaveLength(0);
  });
});
