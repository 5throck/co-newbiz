// @version 1.0.0
/**
 * Committee live progress, phase 1 (design 2026-11-20 §4.2/§5, ADR-0204):
 *
 *   - patchMeta merges into the CURRENT meta_json, so a concurrent edit
 *     (hybrid agenda) is not lost by a progress write;
 *   - meta.progress advances through the engine phases (agenda / discussion /
 *     consensus / minutes), one position at a time, ending at "done";
 *   - a failing seat records progress.failed_at (phase / round / seat /
 *     error_code) next to convening_error, and keeps the positions written;
 *   - finished positions are readable under the SESSION id WHILE convening
 *     (agent_team adopts the session shell as the engine run; hybrid round 1
 *     already wrote there), through the list (poll) and transcript (GET)
 *     paths, with the response envelope unchanged;
 *   - the end-of-run state is unchanged: one process_run, every row under
 *     the sessionId, gate_evaluation present.
 *
 * Member execution is the injected callAgent seam (ADR-0196 decision 10).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-committee-progress.sqlite");
const PREV_PROVIDER = process.env.CO_NEWBIZ_LLM_PROVIDER;
const PREV_DB = process.env.CO_NEWBIZ_DB_PATH;
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
// Chair agenda/minutes passes stay on their deterministic fallbacks.
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { deterministicCallAgent, setCallAgentFactory } = await import("../../app/web-next/lib/committee-agents.ts");
const {
  CommitteeError,
  createCommitteeSession,
  getCommittee,
  getCommitteeSession,
  listCommitteeSessions,
  patchMeta,
  runCommitteeSession,
  seatsForSession,
} = await import("../../app/web-next/lib/committee-session.ts");
const { runDeliberationRounds } = await import("../../app/web-next/lib/deliberation.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

import type { CallAgent } from "../../app/web-next/lib/agent-orchestrator.ts";
import type { MeetingProgress } from "../../app/web-next/lib/committee-progress.ts";
import type { DeliberationProgressEvent } from "../../app/web-next/lib/deliberation.ts";

const NOW = new Date().toISOString();
const COMMITTEE = "route-steering-committee"; // rounds = 2
const seats = seatsForSession(getCommittee(COMMITTEE)!, undefined)
  .filter((m) => m.type === "agent")
  .map((m) => m.key);
const ROUNDS = getCommittee(COMMITTEE)!.rounds;

let analystCookie: string;
let seq = 0;

beforeAll(async () => {
  await createUser(db, { userId: "alice", role: "analyst", password: "pw-alice-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "alice", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ userId: "alice", password: "pw-alice-12345" }),
  });
  analystCookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
});

afterAll(async () => {
  setCallAgentFactory(null);
  resetDb();
  if (PREV_PROVIDER === undefined) delete process.env.CO_NEWBIZ_LLM_PROVIDER;
  else process.env.CO_NEWBIZ_LLM_PROVIDER = PREV_PROVIDER;
  if (PREV_DB === undefined) delete process.env.CO_NEWBIZ_DB_PATH;
  else process.env.CO_NEWBIZ_DB_PATH = PREV_DB;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
      return;
    } catch {
      await Bun.sleep(50 * (attempt + 1));
    }
  }
});

function newOpportunity(): string {
  const id = `opp-progress-${++seq}`;
  db.run("INSERT INTO opportunity (id, name, created_by, created_at) VALUES (?,?,?,?)", [id, `P${seq}`, "alice", NOW]);
  return id;
}

function metaOf(sessionId: string): Record<string, unknown> & { progress?: MeetingProgress } {
  const row = db.query("SELECT meta_json FROM process_run WHERE id = ?").get(sessionId) as { meta_json: string };
  return JSON.parse(row.meta_json);
}

/** Session shell via the real create path; the explicit callAgent skips the llm_required guard only. */
function newSession(
  decisionMode: "agent_team" | "hybrid",
  oppId = newOpportunity(),
): { oppId: string; sessionId: string } {
  const created = createCommitteeSession(
    { entityType: "opportunity", entityId: oppId },
    { committeeKey: COMMITTEE, decisionMode, actor: "alice", callAgent: deterministicCallAgent(), source: "web" },
  );
  return { oppId, sessionId: created.sessionId };
}

function positionCount(sessionId: string): number {
  return (db.query("SELECT COUNT(*) AS n FROM agent_position WHERE process_run_id = ?").get(sessionId) as { n: number })
    .n;
}

describe("patchMeta (design §4.2 write race)", () => {
  test("merges into the CURRENT meta_json — a concurrent agenda edit survives a progress write", () => {
    const { sessionId } = newSession("agent_team");
    // Stale copy a background writer would hold from convene time.
    const stale = metaOf(sessionId);
    // A concurrent edit lands (what the hybrid agenda edit does).
    patchMeta(sessionId, { agenda: [{ id: "I1", title: "edited by an analyst" }] });
    // The progress writer patches only its own key.
    const now = new Date().toISOString();
    patchMeta(sessionId, {
      progress: { engine: "rounds", phase: "discussion", turn_count: 1, started_at: now, updated_at: now },
    });
    const after = metaOf(sessionId);
    expect(after.agenda).toEqual([{ id: "I1", title: "edited by an analyst" }]);
    expect(after.progress?.turn_count).toBe(1);
    expect(after.committee_key).toBe(stale.committee_key as string);
    expect(after.convening).toBe(true); // keys the patch does not name are untouched
  });

  test("undefined removes a key; stage ledgers and unknown runs are refused", () => {
    const { sessionId } = newSession("agent_team");
    patchMeta(sessionId, { convening: false, convening_error: "boom" });
    patchMeta(sessionId, { convening_error: undefined });
    expect(metaOf(sessionId).convening_error).toBeUndefined();
    expect(() => patchMeta("no-such-run", { convening: false })).toThrow(CommitteeError);

    db.run(
      `INSERT INTO process_run (id, entity_type, entity_id, spec_version, stage, status, source, started_by, started_at, meta_json)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        "ledger-run",
        "opportunity",
        "opp-x",
        "v",
        "s8_case_adopt",
        "running",
        "web",
        "alice",
        NOW,
        '{"committee_key":"x"}',
      ],
    );
    expect(() => patchMeta("ledger-run", { convening: false })).toThrow(CommitteeError);
  });
});

describe("engine progress events", () => {
  test("phases advance agenda -> discussion -> consensus -> minutes, turn_count per position", async () => {
    const events: DeliberationProgressEvent[] = [];
    const agent = deterministicCallAgent();
    const oppId = newOpportunity();
    const result = await runDeliberationRounds(
      { entityType: "opportunity", entityId: oppId },
      {
        committeeKey: "test-committee",
        agents: [{ agentKey: "industry-lead" }, { agentKey: "region-lead" }, { agentKey: "risk-officer" }],
        rounds: 2,
        topic: "t",
        callAgent: agent,
        actor: "alice",
        onProgress: (ev) => events.push(ev),
        chairAgendaPass: async () => null,
        chairMinutesPass: async () => null,
      },
    );
    expect(result.status).toBe("done");
    const phases = events.map((e) => e.phase);
    // round 1 (3 seats) -> agenda -> round 2 (3 seats) -> consensus -> minutes
    expect(phases).toEqual([
      "discussion",
      "discussion",
      "discussion",
      "agenda",
      "discussion",
      "discussion",
      "discussion",
      "consensus",
      "minutes",
    ]);
    const discussion = events.filter((e) => e.phase === "discussion");
    expect(discussion.map((e) => `${e.round}:${e.speakerSeat}:${e.turnCount}`)).toEqual([
      "1:industry-lead:0",
      "1:region-lead:1",
      "1:risk-officer:2",
      "2:industry-lead:3",
      "2:region-lead:4",
      "2:risk-officer:5",
    ]);
    expect(events.find((e) => e.phase === "agenda")?.turnCount).toBe(3);
    expect(events.find((e) => e.phase === "consensus")?.turnCount).toBe(6);
    expect(events.every((e) => e.roundCount === 2 && e.turnBudget === 6)).toBe(true);
  });

  test("a throwing onProgress never fails the run", async () => {
    const oppId = newOpportunity();
    const result = await runDeliberationRounds(
      { entityType: "opportunity", entityId: oppId },
      {
        committeeKey: "test-committee",
        agents: [{ agentKey: "industry-lead" }],
        rounds: 1,
        topic: "t",
        callAgent: deterministicCallAgent(),
        actor: "alice",
        onProgress: () => {
          throw new Error("observer bug");
        },
      },
    );
    expect(result.status).toBe("done");
  });
});

describe("agent_team session: persisted progress, live positions, end state", () => {
  test("progress is persisted before each speaker; positions are readable under sessionId mid-run", async () => {
    const { oppId, sessionId } = newSession("agent_team");
    const snaps: Array<{
      seat: string;
      progress: MeetingProgress | undefined;
      positions: number;
      listPositions: number;
      transcriptPositions: number;
      convening: boolean;
    }> = [];
    const agent: CallAgent = async (agentKey, prompt) => {
      const listed = listCommitteeSessions(oppId).find((s) => s.sessionId === sessionId)!;
      snaps.push({
        seat: agentKey,
        progress: metaOf(sessionId).progress,
        positions: positionCount(sessionId),
        listPositions: listed.positions.length,
        transcriptPositions: getCommitteeSession(sessionId)!.rounds.reduce((n, r) => n + r.positions.length, 0),
        convening: listed.convening,
      });
      return deterministicCallAgent()(agentKey, prompt);
    };

    await runCommitteeSession(sessionId, { callAgent: agent });

    expect(snaps).toHaveLength(seats.length * ROUNDS);
    snaps.forEach((snap, i) => {
      // Progress was written BEFORE this seat spoke: it names the seat and
      // the count of positions already persisted.
      expect(snap.progress?.phase).toBe("discussion");
      expect(snap.progress?.engine).toBe("rounds");
      expect(snap.progress?.speaker_seat).toBe(snap.seat);
      expect(snap.progress?.round).toBe(Math.floor(i / seats.length) + 1);
      expect(snap.progress?.round_count).toBe(ROUNDS);
      expect(snap.progress?.turn_budget).toBe(seats.length * ROUNDS);
      expect(snap.progress?.turn_count).toBe(i);
      // Live positions are readable under the SESSION id: DB rows, the poll
      // (list) path and the GET (transcript) path all agree.
      expect(snap.positions).toBe(i);
      expect(snap.listPositions).toBe(i);
      expect(snap.transcriptPositions).toBe(i);
      expect(snap.convening).toBe(true);
    });

    // End state is unchanged by the engine adopting the shell: ONE run for the
    // session, every row under sessionId, evaluation + minutes persisted.
    const meta = metaOf(sessionId) as Record<string, unknown> & { progress: MeetingProgress };
    expect(meta.convening).toBe(false);
    expect(meta.synthesized).toBe(true);
    expect(meta.minutes_draft).toBeTruthy();
    expect(meta.progress.phase).toBe("done");
    expect(meta.progress.turn_count).toBe(seats.length * ROUNDS);
    expect(meta.progress.started_at <= meta.progress.updated_at).toBe(true);
    expect(positionCount(sessionId)).toBe(seats.length * ROUNDS);
    expect(
      (db.query("SELECT COUNT(*) AS n FROM gate_evaluation WHERE process_run_id = ?").get(sessionId) as { n: number })
        .n,
    ).toBe(1);
    expect((db.query("SELECT COUNT(*) AS n FROM process_run WHERE entity_id = ?").get(oppId) as { n: number }).n).toBe(
      1,
    );
    const run = db.query("SELECT status, finished_at FROM process_run WHERE id = ?").get(sessionId) as {
      status: string;
      finished_at: string | null;
    };
    expect(run.status).toBe("done");
    expect(run.finished_at).toBeTruthy();
    // After completion the list stops carrying positions (GET has them).
    const listed = listCommitteeSessions(oppId)[0];
    expect(listed.positions).toEqual([]);
    expect(listed.progress?.phase).toBe("done");
    expect(getCommitteeSession(sessionId)!.progress?.phase).toBe("done");
    expect(getCommitteeSession(sessionId)!.rounds).toHaveLength(ROUNDS);
  });

  test("a failing seat records progress.failed_at next to convening_error and keeps the positions written", async () => {
    const { oppId, sessionId } = newSession("agent_team");
    const failAt = seats.length + 2; // round 2, third seat (0-based call index)
    let calls = 0;
    const agent: CallAgent = async (agentKey, prompt) => {
      if (calls++ === failAt) throw new Error("model 'bad-model' not found");
      return deterministicCallAgent()(agentKey, prompt);
    };

    await expect(runCommitteeSession(sessionId, { callAgent: agent })).rejects.toThrow("bad-model");

    const meta = metaOf(sessionId) as Record<string, unknown> & { progress: MeetingProgress };
    expect(meta.convening).toBe(false);
    expect(meta.convening_error).toBe("model 'bad-model' not found");
    expect(meta.progress.phase).toBe("failed");
    expect(meta.progress.failed_at).toEqual({
      phase: "discussion",
      round: 2,
      speaker_seat: seats[2],
      error_code: "Error",
    });
    expect(meta.progress.turn_count).toBe(failAt);
    // The turns written before the stop are kept and readable under sessionId.
    expect(positionCount(sessionId)).toBe(failAt);
    const listed = listCommitteeSessions(oppId)[0];
    expect(listed.positions).toHaveLength(failAt);
    expect(listed.progress?.failed_at?.speaker_seat).toBe(seats[2]);
    expect((db.query("SELECT status FROM process_run WHERE id = ?").get(sessionId) as { status: string }).status).toBe(
      "failed",
    );
    // No stray engine run is left behind.
    expect((db.query("SELECT COUNT(*) AS n FROM process_run WHERE entity_id = ?").get(oppId) as { n: number }).n).toBe(
      1,
    );
  });

  test("a CommitteeError keeps its code as failed_at.error_code (never the message)", async () => {
    const { sessionId } = newSession("agent_team");
    const agent: CallAgent = async () => {
      throw new CommitteeError("llm_required", "secret detail that must stay out of failed_at");
    };
    await expect(runCommitteeSession(sessionId, { callAgent: agent })).rejects.toThrow();
    const meta = metaOf(sessionId) as { progress: MeetingProgress };
    expect(meta.progress.failed_at).toEqual({
      phase: "discussion",
      round: 1,
      speaker_seat: seats[0],
      error_code: "llm_required",
    });
    expect(JSON.stringify(meta.progress)).not.toContain("secret detail");
  });
});

describe("hybrid session round 1", () => {
  test("progress + finished positions are live under sessionId; ends at done", async () => {
    const { oppId, sessionId } = newSession("hybrid");
    const snaps: Array<{ progress: MeetingProgress | undefined; listPositions: number }> = [];
    const agent: CallAgent = async (agentKey, prompt) => {
      snaps.push({
        progress: metaOf(sessionId).progress,
        listPositions: listCommitteeSessions(oppId)[0].positions.length,
      });
      return deterministicCallAgent()(agentKey, prompt);
    };
    await runCommitteeSession(sessionId, { callAgent: agent });

    expect(snaps).toHaveLength(seats.length);
    snaps.forEach((snap, i) => {
      expect(snap.progress?.phase).toBe("discussion");
      expect(snap.progress?.round).toBe(1);
      expect(snap.progress?.round_count).toBe(1);
      expect(snap.progress?.speaker_seat).toBe(seats[i]);
      expect(snap.progress?.turn_count).toBe(i);
      expect(snap.listPositions).toBe(i);
    });
    const meta = metaOf(sessionId) as { convening: boolean; progress: MeetingProgress };
    expect(meta.convening).toBe(false);
    expect(meta.progress.phase).toBe("done");
    expect(meta.progress.turn_count).toBe(seats.length);
  });

  test("a concurrent agenda edit made while a seat is speaking survives the next progress write", async () => {
    const { sessionId } = newSession("hybrid");
    let edited = false;
    const agent: CallAgent = async (agentKey, prompt) => {
      if (!edited) {
        edited = true;
        patchMeta(sessionId, { agenda: [{ id: "I1", title: "analyst edit" }] });
      }
      return deterministicCallAgent()(agentKey, prompt);
    };
    await runCommitteeSession(sessionId, { callAgent: agent });
    const meta = metaOf(sessionId) as { agenda?: unknown; progress: MeetingProgress };
    expect(meta.agenda).toEqual([{ id: "I1", title: "analyst edit" }]);
    expect(meta.progress.phase).toBe("done");
  });
});

describe("API: poll and GET carry progress and live positions (envelope unchanged)", () => {
  test("list shows progress + finished positions while convening; GET transcript shows done after", async () => {
    // Gate the 3rd seat call so the session is observably mid-run over HTTP.
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let reached!: () => void;
    const atGate = new Promise<void>((r) => (reached = r));
    setCallAgentFactory(() => async (agentKey, prompt) => {
      if (calls++ === 2) {
        reached();
        await gate;
      }
      return deterministicCallAgent()(agentKey, prompt);
    });

    const oppId = newOpportunity();
    const res = await nextRequest(`/api/opportunities/${oppId}/committee-sessions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ committeeKey: COMMITTEE, decisionMode: "agent_team" }),
    });
    expect(res.status).toBe(202);
    const sessionId = (await res.json()).data.sessionId as string;
    await atGate;

    const listRes = await nextRequest(`/api/opportunities/${oppId}/committee-sessions`, {
      headers: { cookie: analystCookie },
    });
    expect(listRes.status).toBe(200);
    const body = (await listRes.json()) as {
      data: { sessions: Array<Record<string, any>> };
      meta?: { count?: number };
    };
    expect(body.meta?.count).toBe(1); // envelope: { data, meta: { count } } as before
    const s = body.data.sessions[0];
    expect(s.sessionId).toBe(sessionId);
    expect(s.convening).toBe(true);
    expect(s.conveningError).toBeNull();
    expect(s.progress).toMatchObject({
      engine: "rounds",
      phase: "discussion",
      round: 1,
      speaker_seat: seats[2],
      turn_count: 2,
    });
    expect(s.positions).toHaveLength(2);
    expect(s.positions.map((p: { agentKey: string }) => p.agentKey)).toEqual(seats.slice(0, 2));

    const getRes = await nextRequest(`/api/opportunities/${oppId}/committee-sessions/${sessionId}`, {
      headers: { cookie: analystCookie },
    });
    const live = (await getRes.json()).data;
    expect(live.progress.turn_count).toBe(2);
    expect(live.rounds[0].positions).toHaveLength(2);

    release();
    const deadline = Date.now() + 10_000;
    while (metaOf(sessionId).convening && Date.now() < deadline) await Bun.sleep(20);
    expect(metaOf(sessionId).convening).toBe(false);

    const doneRes = await nextRequest(`/api/opportunities/${oppId}/committee-sessions/${sessionId}`, {
      headers: { cookie: analystCookie },
    });
    const done = (await doneRes.json()).data;
    expect(done.progress.phase).toBe("done");
    expect(done.rounds).toHaveLength(ROUNDS);
    setCallAgentFactory(null);
  });
});
