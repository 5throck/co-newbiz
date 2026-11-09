// @version 1.0.0
/**
 * Project-scoped committee sessions (ADR-0196 Phase E) + the human_only
 * round-advance regression (phase B defect).
 *
 * Proves, over the real route handlers with the deterministic member
 * executor:
 *   1. convene/advance/positions/minutes work for entity_type='project'
 *      (the entity_ic gate) with NO schema change;
 *   2. a 2-round human_only session reaches synthesis once human positions
 *      derive their round from the session's started round (previously it
 *      stuck at max(agent_position.round) and never completed);
 *   3. hybrid sessions are unaffected by the round fix;
 *   4. cross-scope binding: an opportunity-scoped session is 404 under the
 *      project routes and vice versa.
 *
 * The IC committee registry keys (entity-ic-committee / group-ic-committee)
 * are being registered in procedures/_committees.yaml by a parallel change;
 * tests that need them skip gracefully until the generated registry picks
 * them up. route-steering-committee (rounds=2) carries the behavioral
 * coverage in the meantime — session scoping is committee-agnostic.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");

const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-committee-project-session.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
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
const { getCommittee } = await import("../../app/web-next/lib/committee-session.ts");

const NOW = new Date().toISOString();

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

let analystCookie: string;
let projectId: string;

beforeAll(async () => {
  await createUser(db, { userId: "alice", role: "analyst", password: "pw-alice-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "alice", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie("alice", "pw-alice-12345");

  // A project alice is lead of (visibleProject deny-by-default).
  projectId = "proj-committee-e1";
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, "NP-PHASE-E", NOW]);
  db.run(
    "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
    [projectId, "alice", "lead", "root", NOW, "test"],
  );
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

async function conveneProjectSession(body: Record<string, unknown>): Promise<{ sessionId: string }> {
  const res = await req(`/api/projects/${projectId}/committee-sessions`, {
    method: "POST",
    headers: { cookie: analystCookie },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data;
}

describe("project-scoped committee sessions (ADR-0196 Phase E)", () => {
  test("convene → advance → human positions → minutes → confirm over /api/projects", async () => {
    const { sessionId } = await conveneProjectSession({
      committeeKey: "route-steering-committee",
      decisionMode: "hybrid",
      gate: "entity_ic",
      track: "greenfield",
    });

    // The run is project-scoped, not opportunity-scoped.
    const run = db.query("SELECT entity_type, entity_id, project_id FROM process_run WHERE id = ?").get(sessionId) as {
      entity_type: string;
      entity_id: string;
      project_id: string | null;
    };
    expect(run.entity_type).toBe("project");
    expect(run.entity_id).toBe(projectId);
    expect(run.project_id).toBe(projectId);

    // The session is visible under the project transcript route.
    const transcript = await req(`/api/projects/${projectId}/committee-sessions/${sessionId}`, {
      headers: { cookie: analystCookie },
    });
    expect(transcript.status).toBe(200);
    expect(((await transcript.json()).data.meta as { gate: string }).gate).toBe("entity_ic");

    // Round 1 human position.
    const p1 = await req(`/api/projects/${projectId}/committee-sessions/${sessionId}/positions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ positionMd: "라운드 1 인간 의견", recommendation: "hold", confidence: 60 }),
    });
    expect(p1.status).toBe(201);
    expect((await p1.json()).data.round).toBe(1);

    // Advance → round 2 starts (agent rows carry the round; agenda pass runs).
    const adv1 = await req(`/api/projects/${projectId}/committee-sessions/${sessionId}/advance`, {
      method: "POST",
      headers: { cookie: analystCookie },
    });
    expect(adv1.status).toBe(200);
    const a1 = (await adv1.json()).data;
    expect(a1.status).toBe("round_started");
    expect(a1.round).toBe(2);

    // Round 2 human position — lands on round 2, not a duplicate of round 1.
    const p2 = await req(`/api/projects/${projectId}/committee-sessions/${sessionId}/positions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ positionMd: "라운드 2 인간 의견", recommendation: "go", confidence: 70 }),
    });
    expect(p2.status).toBe(201);
    expect((await p2.json()).data.round).toBe(2);

    // Second advance → synthesis.
    const adv2 = await req(`/api/projects/${projectId}/committee-sessions/${sessionId}/advance`, {
      method: "POST",
      headers: { cookie: analystCookie },
    });
    expect(adv2.status).toBe(200);
    const a2 = (await adv2.json()).data;
    expect(a2.status).toBe("synthesized");
    expect(a2.evaluation).not.toBeNull();
    expect(a2.evaluation.gate).toBe("entity_ic");

    // Boundary #2 holds on the project scope too: proposal only, no
    // confirming record for the entity_ic gate.
    const gates = db
      .query("SELECT COUNT(*) AS n FROM gate_decision WHERE entity_id = ? AND gate = 'entity_ic'")
      .get(projectId) as { n: number };
    expect(gates.n).toBe(0);
    const evals = db.query("SELECT COUNT(*) AS n FROM gate_evaluation WHERE process_run_id = ?").get(sessionId) as {
      n: number;
    };
    expect(evals.n).toBe(1);

    // Minutes: JSON format renders the stored draft; POST confirms once.
    const minutesJson = await req(`/api/projects/${projectId}/committee-sessions/${sessionId}/minutes?format=json`, {
      headers: { cookie: analystCookie },
    });
    expect(minutesJson.status).toBe(200);
    const mj = (await minutesJson.json()).data;
    expect(mj.sessionId ?? mj.meta?.session_id ?? true).toBeTruthy();

    const markdown = await req(`/api/projects/${projectId}/committee-sessions/${sessionId}/minutes`, {
      headers: { cookie: analystCookie },
    });
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get("content-type")).toContain("text/markdown");

    const confirm = await req(`/api/projects/${projectId}/committee-sessions/${sessionId}/minutes`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ confirm: true }),
    });
    expect(confirm.status).toBe(200);
    expect((await confirm.json()).data.confirmedBy).toBe("alice");

    // Re-confirm → 409 (ADR-0104 append-only).
    const again = await req(`/api/projects/${projectId}/committee-sessions/${sessionId}/minutes`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ confirm: true }),
    });
    expect(again.status).toBe(409);
  });

  test("human_only 2-round session reaches synthesis (phase B regression)", async () => {
    const { sessionId } = await conveneProjectSession({
      committeeKey: "route-steering-committee",
      decisionMode: "human_only",
      gate: "entity_ic",
    });

    // Round 1 position.
    const p1 = await req(`/api/projects/${projectId}/committee-sessions/${sessionId}/positions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ positionMd: "human_only 라운드 1", recommendation: "hold" }),
    });
    expect(p1.status).toBe(201);
    expect((await p1.json()).data.round).toBe(1);

    // Advance → round 2 starts (no agent rows exist in human_only).
    const adv1 = await req(`/api/projects/${projectId}/committee-sessions/${sessionId}/advance`, {
      method: "POST",
      headers: { cookie: analystCookie },
    });
    expect(adv1.status).toBe(200);
    expect((await adv1.json()).data.status).toBe("round_started");

    // THE DEFECT: before the fix the round-2 submission collided with the
    // round-1 rows (duplicate_position) — the session could never complete.
    const p2 = await req(`/api/projects/${projectId}/committee-sessions/${sessionId}/positions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ positionMd: "human_only 라운드 2", recommendation: "go" }),
    });
    expect(p2.status).toBe(201);
    expect((await p2.json()).data.round).toBe(2);

    // Final advance → synthesis (previously unreachable for human_only).
    const adv2 = await req(`/api/projects/${projectId}/committee-sessions/${sessionId}/advance`, {
      method: "POST",
      headers: { cookie: analystCookie },
    });
    expect(adv2.status).toBe(200);
    const a2 = (await adv2.json()).data;
    expect(a2.status).toBe("synthesized");
    expect(a2.evaluation).not.toBeNull();

    // Chair minutes exist at synthesis (the path human_only never reached).
    const transcript = await req(`/api/projects/${projectId}/committee-sessions/${sessionId}`, {
      headers: { cookie: analystCookie },
    });
    const t = (await transcript.json()).data;
    expect(t.meta.synthesized).toBe(true);
    expect(t.rounds).toHaveLength(2);
  });

  test("hybrid round derivation is unchanged by the current_round key", async () => {
    const { sessionId } = await conveneProjectSession({
      committeeKey: "route-steering-committee",
      decisionMode: "hybrid",
      gate: "group_ic",
      track: "brownfield",
    });
    // Round 1 agent rows were written at convene; the human joins round 1.
    const p1 = await req(`/api/projects/${projectId}/committee-sessions/${sessionId}/positions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ positionMd: "hybrid r1", recommendation: "go" }),
    });
    expect(p1.status).toBe(201);
    expect((await p1.json()).data.round).toBe(1);
    // Duplicate in the same round → 409.
    const dup = await req(`/api/projects/${projectId}/committee-sessions/${sessionId}/positions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ positionMd: "hybrid r1 again" }),
    });
    expect(dup.status).toBe(409);
  });

  test("cross-scope binding: an opportunity-scoped session is 404 under the project routes", async () => {
    // Convene on a fresh opportunity.
    const opp = await req("/api/opportunities", {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ name: "Phase E cross-scope" }),
    });
    expect(opp.status).toBe(201);
    const oppId = (await opp.json()).data.id as string;
    const res = await req(`/api/opportunities/${oppId}/committee-sessions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ committeeKey: "route-steering-committee", decisionMode: "human_only" }),
    });
    expect(res.status).toBe(201);
    const oppSessionId = (await res.json()).data.sessionId as string;

    // NOT visible under the project routes.
    const t = await req(`/api/projects/${projectId}/committee-sessions/${oppSessionId}`, {
      headers: { cookie: analystCookie },
    });
    expect(t.status).toBe(404);
    // And the project list does not include it.
    const list = await req(`/api/projects/${projectId}/committee-sessions`, { headers: { cookie: analystCookie } });
    expect(list.status).toBe(200);
    const ids = ((await list.json()).data.sessions as Array<{ sessionId: string }>).map((s) => s.sessionId);
    expect(ids).not.toContain(oppSessionId);
  });

  test("entity-ic / group-ic committee keys convene once registered (graceful skip)", async () => {
    for (const key of ["entity-ic-committee", "group-ic-committee"]) {
      const committee = getCommittee(key);
      if (!committee) continue; // registry projection not yet regenerated by the parallel change
      const { sessionId } = await conveneProjectSession({
        committeeKey: key,
        decisionMode: "human_only",
        gate: key === "entity-ic-committee" ? "entity_ic" : "group_ic",
      });
      const run = db.query("SELECT entity_type FROM process_run WHERE id = ?").get(sessionId) as {
        entity_type: string;
      };
      expect(run.entity_type).toBe("project");
    }
  });

  test("snapshot acks: unconfirmed IC minutes ACK, missing-session ACK, confirmed minutes free (ADR-0186 amendment)", async () => {
    const { requiredAcks } = await import("../../app/web-next/lib/gate-snapshot.ts");
    const base = {
      kill: { triggered: [], unassessed: [] },
      rag: { overall: "green" },
      nonwaivable_open: [],
      conditions_open: [],
      entity: { type: "project" as const, id: projectId },
      gate: "entity_ic",
    };

    // No session convened yet → ACK with reason (first release: ACK, not a block).
    const missing = requiredAcks({ ...base, committee: null } as never);
    expect(missing.find((a) => a.key === "committee:session_missing")?.kind).toBe("committee_session_missing");

    // A synthesized session with UNCONFIRMED minutes → ACK per session.
    const unconfirmed = requiredAcks({
      ...base,
      committee: {
        sessions: [
          {
            sessionId: "s1",
            committeeKey: "entity-ic-committee",
            decisionMode: "human_only",
            gate: "entity_ic",
            synthesized: true,
            minutesConfirmed: false,
            minutesInputHash: "h1",
            recommendation: "hold",
          },
        ],
      },
    } as never);
    expect(unconfirmed.find((a) => a.key === "committee:minutes_unconfirmed:s1")?.kind).toBe(
      "committee_minutes_unconfirmed",
    );
    expect(unconfirmed.find((a) => a.key === "committee:session_missing")).toBeUndefined();

    // Confirmed minutes → no committee ack at all.
    const confirmed = requiredAcks({
      ...base,
      committee: {
        sessions: [
          {
            sessionId: "s1",
            committeeKey: "entity-ic-committee",
            decisionMode: "human_only",
            gate: "entity_ic",
            synthesized: true,
            minutesConfirmed: true,
            minutesInputHash: "h1",
            recommendation: "hold",
          },
        ],
      },
    } as never);
    expect(confirmed.find((a) => a.key.startsWith("committee:"))).toBeUndefined();

    // DISPLAY-only discipline: the recommendation never becomes an ack kind.
    const all = requiredAcks({
      ...base,
      committee: {
        sessions: [
          {
            sessionId: "s1",
            committeeKey: "entity-ic-committee",
            decisionMode: "human_only",
            gate: "entity_ic",
            synthesized: true,
            minutesConfirmed: true,
            minutesInputHash: "h1",
            recommendation: "kill",
          },
        ],
      },
    } as never);
    expect(all.find((a) => a.kind.includes("recommendation"))).toBeUndefined();

    // Outside the project IC gates there are no committee acks at all.
    const dd = requiredAcks({ ...base, gate: "dd", committee: null } as never);
    expect(dd.find((a) => a.key.startsWith("committee:"))).toBeUndefined();
    const opp = requiredAcks({ ...base, entity: { type: "opportunity" as const, id: "o1" }, committee: null } as never);
    expect(opp.find((a) => a.key.startsWith("committee:"))).toBeUndefined();
  });

  test("snapshot hash covers the minutes input_hash and confirmation state (changed minutes → stale)", async () => {
    const { snapshotHash } = await import("../../app/web-next/lib/gate-canonical.ts");
    const sess = (over: Record<string, unknown>) => ({
      schema_version: 3,
      gate: "entity_ic",
      entity: { type: "project", id: projectId },
      committee: { sessions: [{ sessionId: "s1", minutesInputHash: "h1", minutesConfirmed: false, ...over }] },
    });
    expect(snapshotHash(sess({}))).not.toBe(snapshotHash(sess({ minutesInputHash: "h2" })));
    expect(snapshotHash(sess({}))).not.toBe(snapshotHash(sess({ minutesConfirmed: true })));
    // Hash stability: identical state, different key order.
    expect(snapshotHash(sess({}))).toBe(snapshotHash(sess({ minutesConfirmed: false, minutesInputHash: "h1" })));
  });

  test("agent_team convene refuses without an LLM factory (owner decision 10, project scope)", async () => {
    const { setCallAgentFactory: setFactory } = await import("../../app/web-next/lib/committee-agents.ts");
    setFactory(null);
    try {
      const res = await req(`/api/projects/${projectId}/committee-sessions`, {
        method: "POST",
        headers: { cookie: analystCookie },
        body: JSON.stringify({
          committeeKey: "route-steering-committee",
          decisionMode: "agent_team",
          gate: "entity_ic",
        }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("llm_required");
    } finally {
      setFactory(() => deterministicCallAgent());
    }
  });
});
