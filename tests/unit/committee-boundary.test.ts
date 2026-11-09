// @version 1.0.0
/**
 * Committee boundary regression — ADR-0097 §8, design boundary #2.
 *
 * The single invariant this file exists to prove: a committee session can
 * produce a gate_evaluation PROPOSAL (with risk-officer dissent preserved
 * verbatim) but NO confirming record — gate_decision / route_decision /
 * brownfield_target rows stay at zero until a HUMAN confirms through the
 * existing confirm path, passing the session's gate_evaluation_id.
 *
 * Drives the real Route Handlers via nextRequest() (same harness as
 * api.test.ts) with the deterministic member executor — no mocking of the
 * routes, the engine, or the confirm path.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");

const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-committee-boundary.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
// Owner decision 10 (ADR-0196 amendment 2026-11-09): the mode env var is
// gone — REST convene requires the provider seam to be registered, so this
// suite injects the deterministic agent AS the factory. The provider is
// forced offline so the ADR-0196 chair passes stay deterministic.
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { setCallAgentFactory, deterministicCallAgent } = await import("../../app/web-next/lib/committee-agents.ts");
setCallAgentFactory(() => deterministicCallAgent());

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

const NOW = new Date().toISOString();

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

let analystCookie: string;

beforeAll(async () => {
  await createUser(db, { userId: "alice", role: "analyst", password: "pw-alice-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "alice", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie("alice", "pw-alice-12345");
});

afterAll(async () => {
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

async function createOpportunity(): Promise<string> {
  const res = await req("/api/opportunities", {
    method: "POST",
    headers: { cookie: analystCookie },
    body: JSON.stringify({ name: "Boundary test opportunity" }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data.id as string;
}

function confirmingRowCounts(oppId: string): { gate: number; route: number; target: number } {
  const one = (sql: string, id: string) => (db.query(sql).get(id) as { n: number }).n;
  return {
    gate: one("SELECT COUNT(*) AS n FROM gate_decision WHERE entity_id = ?", oppId),
    route: one("SELECT COUNT(*) AS n FROM route_decision WHERE opportunity_id = ?", oppId),
    target: one("SELECT COUNT(*) AS n FROM brownfield_target WHERE opportunity_id = ?", oppId),
  };
}

/**
 * Async convene contract (202): the deliberation runs in the background of the
 * SAME test process — poll the session meta until it leaves the convening
 * state, then continue with the assertions.
 */
async function waitForSessionSettled(sessionId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const row = db.query("SELECT meta_json FROM process_run WHERE id = ?").get(sessionId) as { meta_json: string };
    const meta = JSON.parse(row.meta_json) as { convening?: boolean };
    if (!meta.convening) return meta;
    await Bun.sleep(20);
  }
  throw new Error(`committee session ${sessionId} did not settle in time`);
}

describe("committee deliberation boundary (ADR-0097 §8)", () => {
  test("agent_team session proposes; nothing confirms without a human", async () => {
    const oppId = await createOpportunity();

    // Convene: 202 + background deliberation with the deterministic member
    // executor (risk-officer = kill + veto dissent; others go).
    const res = await req(`/api/opportunities/${oppId}/committee-sessions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ committeeKey: "route-steering-committee", decisionMode: "agent_team" }),
    });
    expect(res.status).toBe(202);
    const { data } = await res.json();
    expect(data.decisionMode).toBe("agent_team");
    expect(data.status).toBe("convening");
    const meta = await waitForSessionSettled(data.sessionId as string);
    expect(meta.convening_error).toBeUndefined();
    expect(meta.synthesized).toBe(true);
    const evaluationId = meta.evaluation_id as string;
    expect(evaluationId).toBeTruthy();

    // BOUNDARY #2: no confirming record may exist from the session.
    expect(confirmingRowCounts(oppId)).toEqual({ gate: 0, route: 0, target: 0 });

    // The proposal exists as a gate_evaluation, with verbatim dissent.
    const ev = db
      .query("SELECT id, gate, recommendation, dissent_json, evaluated_by FROM gate_evaluation WHERE id = ?")
      .get(evaluationId) as {
      id: string;
      gate: string;
      recommendation: string;
      dissent_json: string | null;
      evaluated_by: string;
    };
    expect(ev).toBeDefined();
    expect(ev.gate).toBe("pre_fs");
    expect(ev.evaluated_by).toBe("process-governance-manager"); // chair, synthesis only — votes nothing
    expect(ev.dissent_json).toBeTruthy();

    // Dissent carries the risk-officer position VERBATIM — never a paraphrase.
    const transcript = await req(`/api/opportunities/${oppId}/committee-sessions/${data.sessionId}`, {
      headers: { cookie: analystCookie },
    });
    expect(transcript.status).toBe(200);
    const t = (await transcript.json()).data;
    const riskOfficer = t.rounds
      .flatMap((r: { positions: Array<{ agentKey: string | null; positionMd: string }> }) => r.positions)
      .find((p: { agentKey: string | null }) => p.agentKey === "risk-officer");
    expect(riskOfficer).toBeDefined();
    const dissents = JSON.parse(ev.dissent_json ?? "[]") as Array<{ member_key: string; position_md: string }>;
    const roDissent = dissents.find((d) => d.member_key === "risk-officer");
    expect(roDissent).toBeDefined();
    expect(roDissent?.position_md).toBe(riskOfficer?.positionMd);

    // agent_team sessions have no human seats — deliberation cannot be
    // used as a side channel to confirm.
    const pos = await req(`/api/opportunities/${oppId}/committee-sessions/${data.sessionId}/positions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ positionMd: "human override attempt" }),
    });
    expect(pos.status).toBe(400);
    expect((await pos.json()).error.code).toBe("human_seat_closed");

    // Still nothing confirmed.
    expect(confirmingRowCounts(oppId)).toEqual({ gate: 0, route: 0, target: 0 });

    // Simulated HUMAN confirm through the existing confirm path (the same
    // POST the web confirm form makes), citing the committee PROPOSAL.
    const confirm = await req(`/api/opportunities/${oppId}/gate-decisions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({
        gate: "pre_fs",
        decision: "hold",
        missing_artifacts: ["S4 route decision"],
        rationale: "위원회 PROPOSAL 확인 후 인적 결재",
        gate_evaluation_id: evaluationId,
      }),
    });
    expect(confirm.status).toBe(201);

    // Only now does a confirming record exist — linked to the proposal.
    const rows = confirmingRowCounts(oppId);
    expect(rows.gate).toBe(1);
    expect(rows.route).toBe(0);
    expect(rows.target).toBe(0);
    const gd = db.query("SELECT gate_evaluation_id, decided_by FROM gate_decision WHERE gate = 'pre_fs'").get() as {
      gate_evaluation_id: string | null;
      decided_by: string;
    };
    expect(gd.gate_evaluation_id).toBe(evaluationId);
    expect(gd.decided_by).toBe("alice"); // a human account, not a committee chair
  });

  test("the brownfield committee defaults to the target_screening gate (0111 alignment)", async () => {
    const oppId = await createOpportunity();
    const res = await req(`/api/opportunities/${oppId}/committee-sessions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ committeeKey: "target-longlist-shortlist-committee", decisionMode: "human_only" }),
    });
    expect(res.status).toBe(202);
    const { data } = await res.json();
    expect(data.status).toBe("ready"); // human_only convenes synchronously — no background deliberation
    const transcript = await req(`/api/opportunities/${oppId}/committee-sessions/${data.sessionId}`, {
      headers: { cookie: analystCookie },
    });
    expect(transcript.status).toBe(200);
    const t = (await transcript.json()).data;
    expect(t.meta.committee_key).toBe("target-longlist-shortlist-committee");
    expect(t.meta.gate).toBe("target_screening");
  });

  test("hybrid session requires a human voice per round before synthesis", async () => {
    const oppId = await createOpportunity();
    const res = await req(`/api/opportunities/${oppId}/committee-sessions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ committeeKey: "route-steering-committee", decisionMode: "hybrid" }),
    });
    expect(res.status).toBe(202);
    const sessionId = (await res.json()).data.sessionId as string;
    await waitForSessionSettled(sessionId); // hybrid round-1 agent positions run in the background

    // Round 1 has agent positions only — advance is refused.
    const advance1 = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/advance`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({}),
    });
    expect(advance1.status).toBe(400);
    expect((await advance1.json()).error.code).toBe("human_position_required");
    expect(confirmingRowCounts(oppId)).toEqual({ gate: 0, route: 0, target: 0 });

    // Human speaks (round 1) — advance then completes the rounds and
    // synthesizes a PROPOSAL, still without confirming anything. No `seat`
    // claim: a human speaks under their OWN user identity.
    const pos = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/positions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ positionMd: "인간 위원 관점: 시장성 충분", recommendation: "go", confidence: 70 }),
    });
    expect(pos.status).toBe(201);

    // Same round again → conflict: one position per (round, member).
    const dup = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/positions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ positionMd: "중복 제출 시도", recommendation: "go" }),
    });
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe("duplicate_position");

    // Speaking as another member's seat is a forbidden identity claim —
    // industry-lead is an AGENT seat, never claimable by a human submitter.
    const impersonation = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/positions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ seat: "industry-lead", positionMd: "다른 위원 사칭 시도", recommendation: "go" }),
    });
    expect(impersonation.status).toBe(403);
    expect((await impersonation.json()).error.code).toBe("seat_not_assignable");

    let last = "";
    for (let i = 0; i < 3; i++) {
      const r = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/advance`, {
        method: "POST",
        headers: { cookie: analystCookie },
        body: JSON.stringify({}),
      });
      expect(r.status).toBe(200);
      last = (await r.json()).data.status;
      if (last === "synthesized") break;
      // each new round needs its own human voice
      const hp = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/positions`, {
        method: "POST",
        headers: { cookie: analystCookie },
        body: JSON.stringify({ positionMd: `round ${i + 2} human position`, recommendation: "go" }),
      });
      expect(hp.status).toBe(201);
    }
    expect(last).toBe("synthesized");
    expect(confirmingRowCounts(oppId)).toEqual({ gate: 0, route: 0, target: 0 });
  });

  test("session binding: another opportunity's session is 404 here, not readable or advanceable", async () => {
    const oppA = await createOpportunity();
    const oppB = await createOpportunity();
    const res = await req(`/api/opportunities/${oppA}/committee-sessions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ committeeKey: "route-steering-committee", decisionMode: "human_only" }),
    });
    expect(res.status).toBe(202);
    const sessionId = (await res.json()).data.sessionId as string;

    // The session belongs to oppA's process_run — under oppB's path it is
    // simply not found (existence protection on every session surface).
    const get = await req(`/api/opportunities/${oppB}/committee-sessions/${sessionId}`, {
      headers: { cookie: analystCookie },
    });
    expect(get.status).toBe(404);
    const pos = await req(`/api/opportunities/${oppB}/committee-sessions/${sessionId}/positions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ positionMd: "교차 기회 입장 시도" }),
    });
    expect(pos.status).toBe(404);
    const adv = await req(`/api/opportunities/${oppB}/committee-sessions/${sessionId}/advance`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({}),
    });
    expect(adv.status).toBe(404);
  });
});
