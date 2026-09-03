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

const TEST_DB_PATH = "db/data/test-committee-boundary.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_COMMITTEE_AGENTS = "deterministic";

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

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

let rootCookie: string;

beforeAll(async () => {
  await createUser(db, { userId: "root", role: "admin", password: "pw-root-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "root", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  rootCookie = await loginCookie("root", "pw-root-12345");
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
    headers: { cookie: rootCookie },
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

describe("committee deliberation boundary (ADR-0097 §8)", () => {
  test("agent_team session proposes; nothing confirms without a human", async () => {
    const oppId = await createOpportunity();

    // Convene: full engine run at convene time with the deterministic
    // member executor (risk-officer = kill + veto dissent; others go).
    const res = await req(`/api/opportunities/${oppId}/committee-sessions`, {
      method: "POST",
      headers: { cookie: rootCookie },
      body: JSON.stringify({ committeeKey: "route-steering-committee", decisionMode: "agent_team" }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.decisionMode).toBe("agent_team");
    expect(data.evaluation).not.toBeNull();
    const evaluationId = data.evaluation.gateEvaluationId as string;

    // BOUNDARY #2: no confirming record may exist from the session.
    expect(confirmingRowCounts(oppId)).toEqual({ gate: 0, route: 0, target: 0 });

    // The proposal exists as a gate_evaluation, with verbatim dissent.
    const ev = db.query("SELECT id, gate, recommendation, dissent_json, evaluated_by FROM gate_evaluation WHERE id = ?")
      .get(evaluationId) as { id: string; gate: string; recommendation: string; dissent_json: string | null; evaluated_by: string };
    expect(ev).toBeDefined();
    expect(ev.gate).toBe("pre_fs");
    expect(ev.evaluated_by).toBe("process-governance-manager"); // chair, synthesis only — votes nothing
    expect(ev.dissent_json).toBeTruthy();

    // Dissent carries the risk-officer position VERBATIM — never a paraphrase.
    const transcript = await req(`/api/opportunities/${oppId}/committee-sessions/${data.sessionId}`, { headers: { cookie: rootCookie } });
    expect(transcript.status).toBe(200);
    const t = (await transcript.json()).data;
    const riskOfficer = t.rounds.flatMap((r: { positions: Array<{ agentKey: string | null; positionMd: string }> }) => r.positions)
      .find((p: { agentKey: string | null }) => p.agentKey === "risk-officer");
    expect(riskOfficer).toBeDefined();
    const dissents = JSON.parse(ev.dissent_json!) as Array<{ member_key: string; position_md: string }>;
    const roDissent = dissents.find((d) => d.member_key === "risk-officer");
    expect(roDissent).toBeDefined();
    expect(roDissent!.position_md).toBe(riskOfficer!.positionMd);

    // agent_team sessions have no human seats — deliberation cannot be
    // used as a side channel to confirm.
    const pos = await req(`/api/opportunities/${oppId}/committee-sessions/${data.sessionId}/positions`, {
      method: "POST",
      headers: { cookie: rootCookie },
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
      headers: { cookie: rootCookie },
      body: JSON.stringify({ gate: "pre_fs", decision: "go", rationale: "위원회 PROPOSAL 확인 후 인적 결재", gate_evaluation_id: evaluationId }),
    });
    expect(confirm.status).toBe(201);

    // Only now does a confirming record exist — linked to the proposal.
    const rows = confirmingRowCounts(oppId);
    expect(rows.gate).toBe(1);
    expect(rows.route).toBe(0);
    expect(rows.target).toBe(0);
    const gd = db.query("SELECT gate_evaluation_id, decided_by FROM gate_decision WHERE gate = 'pre_fs'").get() as
      | { gate_evaluation_id: string | null; decided_by: string };
    expect(gd.gate_evaluation_id).toBe(evaluationId);
    expect(gd.decided_by).toBe("root"); // a human account, not a committee chair
  });

  test("hybrid session requires a human voice per round before synthesis", async () => {
    const oppId = await createOpportunity();
    const res = await req(`/api/opportunities/${oppId}/committee-sessions`, {
      method: "POST",
      headers: { cookie: rootCookie },
      body: JSON.stringify({ committeeKey: "route-steering-committee", decisionMode: "hybrid" }),
    });
    expect(res.status).toBe(201);
    const sessionId = (await res.json()).data.sessionId as string;

    // Round 1 has agent positions only — advance is refused.
    const advance1 = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/advance`, {
      method: "POST",
      headers: { cookie: rootCookie },
      body: JSON.stringify({}),
    });
    expect(advance1.status).toBe(400);
    expect((await advance1.json()).error.code).toBe("human_position_required");
    expect(confirmingRowCounts(oppId)).toEqual({ gate: 0, route: 0, target: 0 });

    // Human speaks (round 1) — advance then completes the rounds and
    // synthesizes a PROPOSAL, still without confirming anything.
    const pos = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/positions`, {
      method: "POST",
      headers: { cookie: rootCookie },
      body: JSON.stringify({ seat: "industry-lead", positionMd: "산업 관점: 시장성 충분", recommendation: "go", confidence: 70 }),
    });
    expect(pos.status).toBe(201);

    let last = "";
    for (let i = 0; i < 3; i++) {
      const r = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/advance`, {
        method: "POST",
        headers: { cookie: rootCookie },
        body: JSON.stringify({}),
      });
      expect(r.status).toBe(200);
      last = (await r.json()).data.status;
      if (last === "synthesized") break;
      // each new round needs its own human voice
      const hp = await req(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/positions`, {
        method: "POST",
        headers: { cookie: rootCookie },
        body: JSON.stringify({ seat: "industry-lead", positionMd: `round ${i + 2} human position`, recommendation: "go" }),
      });
      expect(hp.status).toBe(201);
    }
    expect(last).toBe("synthesized");
    expect(confirmingRowCounts(oppId)).toEqual({ gate: 0, route: 0, target: 0 });
  });
});

// ── Registry validation (procedures/_validate.ts committee pass) ────────────

const { validateCommitteeRegistry } = await import("../../procedures/_validate.ts");
const yaml = await import("js-yaml");
const { readFileSync } = await import("node:fs");

describe("_committees.yaml validation", () => {
  test("the shipped registry passes with both committees", () => {
    const doc = yaml.load(readFileSync("procedures/_committees.yaml", "utf-8"), { schema: yaml.JSON_SCHEMA });
    const result = validateCommitteeRegistry(doc, new Set<string>());
    expect(result.committeeCount).toBe(2);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  test("a committee without the risk-officer seat is an ERROR", () => {
    const result = validateCommitteeRegistry(
      {
        committees: {
          "broken-committee": {
            applies_to: "route_decision",
            chair: "process-governance-manager",
            rounds: 2,
            decision_modes_allowed: ["agent_team"],
            members: [
              { type: "agent", key: "industry-lead" },
            ],
          },
        },
      },
      new Set<string>(),
    );
    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => e.message.includes("risk-officer"))).toBe(true);
  });

  test("risk-officer without veto_dissent is an ERROR", () => {
    const result = validateCommitteeRegistry(
      {
        committees: {
          "no-veto-committee": {
            applies_to: "route_decision",
            chair: "process-governance-manager",
            rounds: 2,
            decision_modes_allowed: ["agent_team"],
            members: [{ type: "agent", key: "risk-officer" }],
          },
        },
      },
      new Set<string>(),
    );
    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => e.message.includes("veto_dissent"))).toBe(true);
  });

  test("decision mode outside the closed enum is an ERROR", () => {
    const result = validateCommitteeRegistry(
      {
        committees: {
          "bad-mode-committee": {
            applies_to: "route_decision",
            chair: "process-governance-manager",
            rounds: 2,
            decision_modes_allowed: ["autonomous"],
            members: [{ type: "agent", key: "risk-officer", veto_dissent: true }],
          },
        },
      },
      new Set<string>(),
    );
    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => e.message.includes("closed enum"))).toBe(true);
  });
});
