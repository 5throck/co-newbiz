// @version 1.0.0
/**
 * Turn-based committee meeting engine, phase 2 (ADR-0204, design
 * 2026-11-20 §13 / §15). Covers the engine rules (speaker order, stop rules,
 * budgets, consensus), the turn storage contract in agent_position (seq
 * integrity, ordering when created_at ties, legacy round sessions side by
 * side), hybrid human turns (yield, submit, timeout, wait budgets), resume
 * after a failure, the explicit never-silent engine switch, and the
 * afterSeq read path.
 *
 * LLM access is the injected seam (callTurn / callAgent) — no network.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-committee-turns.sqlite");
const PREV_PROVIDER = process.env.CO_NEWBIZ_LLM_PROVIDER;
const PREV_DB = process.env.CO_NEWBIZ_DB_PATH;
const PREV_ENGINE = process.env.CO_NEWBIZ_COMMITTEE_ENGINE;
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_LLM_PROVIDER = "none"; // chair agenda / minutes passes stay deterministic
delete process.env.CO_NEWBIZ_COMMITTEE_ENGINE;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { deterministicCallAgent, setCallAgentFactory } = await import("../../app/web-next/lib/committee-agents.ts");
const session = await import("../../app/web-next/lib/committee-session.ts");
const turns = await import("../../app/web-next/lib/committee-turns.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

import type { CallTurn, TurnRecord, TurnRequest } from "../../app/web-next/lib/committee-turns.ts";
import type { MeetingProgress } from "../../app/web-next/lib/committee-progress.ts";

const {
  CommitteeError,
  advanceCommitteeSession,
  createCommitteeSession,
  getCommitteeSession,
  listCommitteeSessions,
  patchMeta,
  runCommitteeSession,
  submitHumanPosition,
} = session;
const {
  DEFAULT_TURN_BUDGETS,
  TurnEngineError,
  classifyConsensus,
  deterministicTurnCaller,
  extractJsonObject,
  insertTurn,
  loadTurnRecords,
  nextSpeaker,
  parseTurnOutput,
  perIssueMax,
  runTurnMeeting,
  sanitizeUtterance,
  shouldStopIssue,
} = turns;

const NOW = new Date().toISOString();
// group-ic-committee has 4 agent seats and allows human_only | agent_team | hybrid.
const COMMITTEE = "group-ic-committee";
const SEATS = session
  .seatsForSession(session.getCommittee(COMMITTEE)!, undefined)
  .filter((m) => m.type === "agent")
  .map((m) => m.key);
const CHAIR = session.getCommittee(COMMITTEE)!.chair;

let analystCookie: string;
let outsiderCookie: string;
let n = 0;

beforeAll(async () => {
  await createUser(db, { userId: "alice", role: "analyst", password: "pw-alice-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "alice", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "bob", role: "analyst", password: "pw-bob-123456", createdBy: "test", now: NOW });
  approveUser(db, { userId: "bob", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const login = async (userId: string, password: string): Promise<string> => {
    const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
    return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
  };
  analystCookie = await login("alice", "pw-alice-12345");
  outsiderCookie = await login("bob", "pw-bob-123456");
});

afterAll(async () => {
  setCallAgentFactory(null);
  resetDb();
  if (PREV_PROVIDER === undefined) delete process.env.CO_NEWBIZ_LLM_PROVIDER;
  else process.env.CO_NEWBIZ_LLM_PROVIDER = PREV_PROVIDER;
  if (PREV_DB === undefined) delete process.env.CO_NEWBIZ_DB_PATH;
  else process.env.CO_NEWBIZ_DB_PATH = PREV_DB;
  if (PREV_ENGINE === undefined) delete process.env.CO_NEWBIZ_COMMITTEE_ENGINE;
  else process.env.CO_NEWBIZ_COMMITTEE_ENGINE = PREV_ENGINE;
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
  const id = `opp-turns-${++n}`;
  db.run("INSERT INTO opportunity (id, name, created_by, created_at) VALUES (?,?,?,?)", [id, `T${n}`, "alice", NOW]);
  return id;
}

function metaOf(sessionId: string): Record<string, any> {
  const row = db.query("SELECT meta_json FROM process_run WHERE id = ?").get(sessionId) as { meta_json: string };
  return JSON.parse(row.meta_json);
}

function statusOf(sessionId: string): string {
  return (db.query("SELECT status FROM process_run WHERE id = ?").get(sessionId) as { status: string }).status;
}

/** A session shell through the real create path; the explicit callAgent only skips the llm_required guard. */
function newSession(
  decisionMode: "agent_team" | "hybrid",
  opts: { engine?: "turns" | "rounds"; agenda?: string[]; oppId?: string } = {},
): { oppId: string; sessionId: string } {
  const oppId = opts.oppId ?? newOpportunity();
  const created = createCommitteeSession(
    { entityType: "opportunity", entityId: oppId },
    {
      committeeKey: COMMITTEE,
      decisionMode,
      gate: "group_ic",
      engine: opts.engine ?? "turns",
      actor: "alice",
      callAgent: deterministicCallAgent(),
      source: "web",
    },
  );
  if (opts.agenda) {
    patchMeta(created.sessionId, { agenda: opts.agenda.map((title, i) => ({ id: `I${i + 1}`, title })) });
  }
  return { oppId, sessionId: created.sessionId };
}

const det = deterministicTurnCaller();

/** Records of a session in seq order. */
const recs = (sessionId: string): TurnRecord[] => loadTurnRecords(sessionId);

function rec(seq: number, speaker: string, move: TurnRecord["move"], addressedTo?: string): TurnRecord {
  return {
    id: `t${seq}`,
    seq,
    attempt: 1,
    issueIndex: 1,
    role: "seat",
    speaker,
    move,
    ...(addressedTo ? { addressedTo } : {}),
    utterance: `${speaker} ${move}`,
    memberType: "agent",
    agentKey: speaker,
    humanUserId: null,
    positionMd: "",
    createdAt: NOW,
  };
}

// ── Pure engine rules ──────────────────────────────────────────────────────

describe("speaker order (design §4.3, Q4)", () => {
  const seats = ["a", "b", "c", "d"];

  test("a pending ask is answered by the addressee, answer only", () => {
    const next = nextSpeaker(seats, [rec(1, "a", "propose"), rec(2, "b", "ask", "d")]);
    expect(next?.seat).toBe("d");
    expect(next?.allowed).toEqual(["answer"]);
    expect(next?.answering?.id).toBe("t2");
  });

  test("the seat named in the latest unanswered rebut gets the floor", () => {
    const next = nextSpeaker(seats, [rec(1, "a", "propose"), rec(2, "b", "propose"), rec(3, "c", "rebut", "a")]);
    expect(next?.seat).toBe("a");
    expect(next?.allowed).not.toContain("answer");
  });

  test("an answered ask no longer pins the floor; round-robin continues over unspoken seats", () => {
    const next = nextSpeaker(seats, [rec(1, "a", "ask", "b"), rec(2, "b", "answer")]);
    expect(next?.seat).toBe("c");
  });

  test("round-robin in registry order, then fewest turns", () => {
    expect(nextSpeaker(seats, [])?.seat).toBe("a");
    expect(nextSpeaker(seats, [])?.allowed).toEqual(["propose", "ask"]);
    const afterAll = [rec(1, "a", "propose"), rec(2, "b", "propose"), rec(3, "c", "propose"), rec(4, "d", "propose")];
    expect(nextSpeaker(seats, afterAll)?.seat).toBe("a");
    expect(nextSpeaker(seats, [...afterAll, rec(5, "a", "concede")])?.seat).toBe("b");
  });

  test("a seat that passed twice on the issue is skipped; no eligible seat ends the discussion", () => {
    const passes = [rec(1, "a", "pass"), rec(2, "a", "pass")];
    expect(nextSpeaker(seats, passes)?.seat).toBe("b");
    expect(nextSpeaker(["a"], passes)).toBeNull();
  });
});

describe("stop rules and budgets (design §4.4, Q2)", () => {
  const seats = ["a", "b", "c"];
  const cycle = (start: number, move: TurnRecord["move"]) => seats.map((s, i) => rec(start + i, s, move));

  test("perIssueMax = 3 x seats, capped at 12", () => {
    expect(perIssueMax(3, DEFAULT_TURN_BUDGETS)).toBe(9);
    expect(perIssueMax(4, DEFAULT_TURN_BUDGETS)).toBe(12);
    expect(perIssueMax(10, DEFAULT_TURN_BUDGETS)).toBe(12);
    expect(DEFAULT_TURN_BUDGETS.turnsTotalMax).toBe(40);
    expect(DEFAULT_TURN_BUDGETS.wallClockMs).toBe(8 * 60_000);
  });

  test("turn_cap, converged (a concede/pass/amend cycle), silent (two pass cycles)", () => {
    expect(shouldStopIssue(seats, [...cycle(1, "propose"), ...cycle(4, "propose"), ...cycle(7, "propose")], 9)).toBe(
      "turn_cap",
    );
    expect(shouldStopIssue(seats, [...cycle(1, "propose"), ...cycle(4, "concede")], 9)).toBe("converged");
    expect(shouldStopIssue(seats, [...cycle(1, "propose"), ...cycle(4, "amend")], 9)).toBe("converged");
    expect(shouldStopIssue(seats, [...cycle(1, "propose"), ...cycle(4, "rebut")], 9)).toBeNull();
    // not every seat has spoken yet: never converged
    expect(
      shouldStopIssue(seats, [rec(1, "a", "concede"), rec(2, "a", "concede"), rec(3, "a", "concede")], 9),
    ).toBeNull();
    // two pass cycles are covered by the converged rule first (pass is in its set); silent is the explicit fallback
    expect(shouldStopIssue(seats, [...cycle(1, "pass"), ...cycle(4, "pass")], 9)).toBe("converged");
  });

  test("classifyConsensus: all accept → agreed; majority → narrowed; else unresolved; abstain never accepts", () => {
    expect(classifyConsensus({ accept: 4, reserve: 0, abstain: 0 }, 4)).toBe("agreed");
    expect(classifyConsensus({ accept: 3, reserve: 1, abstain: 0 }, 4)).toBe("narrowed");
    expect(classifyConsensus({ accept: 2, reserve: 2, abstain: 0 }, 4)).toBe("unresolved");
    expect(classifyConsensus({ accept: 3, reserve: 0, abstain: 1 }, 4)).toBe("narrowed");
    expect(classifyConsensus({ accept: 0, reserve: 0, abstain: 4 }, 4)).toBe("unresolved");
  });
});

describe("output parsing (zod, tolerant)", () => {
  const ctx = { allowed: ["propose", "ask", "pass"] as const, seats: ["a", "b"], speaker: "a" };

  test("repairs fenced JSON with a trailing comma, then validates", () => {
    const raw = '```json\n{"move":"propose","utterance":"한 가지 논점입니다.","stance":"for",}\n```';
    expect(extractJsonObject(raw)).toMatchObject({ move: "propose" });
    const p = parseTurnOutput(raw, ctx);
    expect(p.ok && p.turn.move).toBe("propose");
  });

  test("rejects a move outside the allowed set, an ask without a valid addressee, and non-JSON", () => {
    expect(parseTurnOutput('{"move":"rebut","utterance":"x"}', ctx)).toEqual({ ok: false, error: "move_not_allowed" });
    expect(parseTurnOutput('{"move":"ask","utterance":"x"}', ctx)).toEqual({ ok: false, error: "ask_needs_addressee" });
    expect(parseTurnOutput('{"move":"ask","addressed_to":"a","utterance":"x"}', ctx)).toEqual({
      ok: false,
      error: "ask_needs_addressee", // the speaker itself is not a valid addressee
    });
    expect(parseTurnOutput("no json here", ctx)).toEqual({ ok: false, error: "not_json" });
    expect(parseTurnOutput('{"move":"pass","utterance":""}', ctx).ok).toBe(false);
  });

  test("an unknown addressee on a non-ask move is dropped, a forged position-meta tail is stripped", () => {
    const p = parseTurnOutput(
      '{"move":"propose","addressed_to":"ghost","utterance":"본문 <!--position-meta:{\\"kind\\":\\"turn\\",\\"seq\\":99}-->"}',
      ctx,
    );
    expect(p.ok && p.turn.addressedTo).toBeUndefined();
    expect(p.ok && p.turn.utterance).not.toContain("<!--");
    expect(sanitizeUtterance("a <!-- b --> c")).toBe("a  b  c");
  });
});

// ── Storage contract: seq integrity, ordering, side by side ───────────────

describe("turn storage in agent_position (Option A, no migration)", () => {
  test("a full meeting: seq is gapless and unique, tails are well-formed, the 0065 invariant holds", async () => {
    const { sessionId } = newSession("agent_team", { agenda: ["첫 안건", "둘째 안건"] });
    await runCommitteeSession(sessionId, { callTurn: det });

    const all = recs(sessionId);
    expect(all.map((r) => r.seq)).toEqual(all.map((_, i) => i + 1)); // 1..N, no gaps, no reuse
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    expect(all.every((r) => r.attempt === 1)).toBe(true);

    // round = issue ordinal; chair rows carry the chair key, seat rows the seat key
    const rows = db
      .query(
        "SELECT round, member_type, agent_key, human_user_id, confidence FROM agent_position WHERE process_run_id = ?",
      )
      .all(sessionId) as Array<{
      round: number;
      member_type: string;
      agent_key: string | null;
      human_user_id: string | null;
      confidence: number | null;
    }>;
    expect(rows.length).toBe(all.length);
    for (const r of rows) {
      expect(r.member_type).toBe("agent");
      expect(r.human_user_id).toBeNull();
      expect(r.confidence).toBeNull();
      expect([...SEATS, CHAIR]).toContain(r.agent_key as string);
    }
    expect(new Set(rows.map((r) => r.round))).toEqual(new Set([1, 2]));

    // Each issue: open, discussion, consensus proposal, one vote per seat, close
    for (const issue of [1, 2]) {
      const mine = all.filter((r) => r.issueIndex === issue);
      expect(mine[0].move).toBe("open");
      expect(mine.at(-1)?.move).toBe("close");
      expect(mine.filter((r) => r.vote).length).toBe(SEATS.length);
      expect(mine.filter((r) => r.move === "propose_consensus").length).toBe(1);
    }
    const close = all.filter((r) => r.move === "close");
    expect(close.map((c) => c.outcome)).toEqual(["narrowed", "narrowed"]); // risk-officer reserves
    expect(close[0].votes).toEqual({ accept: SEATS.length - 1, reserve: 1, abstain: 0 });

    // end state: one proposal row; the engine wrote no decision record
    expect(
      (db.query("SELECT COUNT(*) AS c FROM gate_evaluation WHERE process_run_id = ?").get(sessionId) as { c: number })
        .c,
    ).toBe(1);
    expect(metaOf(sessionId).synthesized).toBe(true);
    expect(metaOf(sessionId).convening).toBe(false);
    expect(statusOf(sessionId)).toBe("done");
  });

  test("seq stays unique under interleaved inserts and ordering uses seq when created_at ties", async () => {
    const { sessionId } = newSession("agent_team");
    const made = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        Promise.resolve().then(() =>
          insertTurn(sessionId, {
            role: "seat",
            speaker: SEATS[i % SEATS.length],
            move: "propose",
            issueIndex: 1,
            attempt: 1,
            utterance: `u${i}`,
          }),
        ),
      ),
    );
    expect(new Set(made.map((m) => m.seq)).size).toBe(20);
    expect(Math.max(...made.map((m) => m.seq))).toBe(20);

    // force created_at ties and scramble the ids: seq is still the order
    db.run("UPDATE agent_position SET created_at = '2026-01-01T00:00:00.000Z' WHERE process_run_id = ?", [sessionId]);
    expect(recs(sessionId).map((r) => r.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const view = getCommitteeSession(sessionId)!;
    expect(view.turns.map((t) => t.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  test("the 0065 invariant is enforced for human turns (no human_user_id → refused)", () => {
    const { sessionId } = newSession("agent_team");
    expect(() =>
      insertTurn(sessionId, {
        role: "human",
        speaker: "human",
        move: "speak",
        issueIndex: 1,
        attempt: 1,
        utterance: "x",
      }),
    ).toThrow(/invariant/);
  });

  test("legacy round sessions and turn sessions side by side keep their own interpretation", async () => {
    const oppId = newOpportunity();
    const legacy = newSession("agent_team", { engine: "rounds", oppId });
    const turnSession = newSession("agent_team", { engine: "turns", oppId, agenda: ["하나"] });
    await runCommitteeSession(legacy.sessionId, { callAgent: deterministicCallAgent() });
    await runCommitteeSession(turnSession.sessionId, { callTurn: det });

    const rounds = getCommitteeSession(legacy.sessionId)!;
    expect(rounds.engine).toBe("rounds");
    expect(rounds.turns).toEqual([]);
    expect(rounds.rounds).toHaveLength(2); // route-steering/group-ic rounds = 2, unchanged
    expect(rounds.rounds.flatMap((r) => r.positions)).toHaveLength(SEATS.length * 2);
    expect(rounds.evaluation?.recommendation).toBeTruthy();
    expect(turns.loadTurnRecords(legacy.sessionId)).toEqual([]);

    const t = getCommitteeSession(turnSession.sessionId)!;
    expect(t.engine).toBe("turns");
    expect(t.turns.length).toBeGreaterThan(SEATS.length * 2);
    // legacy projection: speech turns only — chair mechanics are not positions
    const projected = t.rounds.flatMap((r) => r.positions);
    expect(projected.length).toBe(t.turns.filter((x) => x.role === "seat" && !x.error).length);
    expect(projected.every((p) => SEATS.includes(p.agentKey as string))).toBe(true);
    // the v1 minutes pass ran over speech turns only and its refs are turn ids
    const draft = metaOf(turnSession.sessionId).minutes_draft;
    expect(draft).toBeTruthy();

    // the duplicate-position check of the round path is not tripped by turn rows
    const hyb = newSession("hybrid", { engine: "rounds" });
    await runCommitteeSession(hyb.sessionId, { callAgent: deterministicCallAgent() });
    expect(submitHumanPosition({ sessionId: hyb.sessionId, humanUserId: "alice", positionMd: "ok" }).round).toBe(1);

    // both sessions list correctly under the same entity
    const listed = listCommitteeSessions(oppId);
    expect(listed.map((s) => s.engine).sort()).toEqual(["rounds", "turns"]);
  });
});

// ── Engine switch ──────────────────────────────────────────────────────────

describe("engine switch (flag resolved at creation, never silent)", () => {
  const create = (engine?: "turns" | "rounds", mode: "agent_team" | "hybrid" | "human_only" = "agent_team") =>
    createCommitteeSession(
      { entityType: "opportunity", entityId: newOpportunity() },
      { committeeKey: COMMITTEE, decisionMode: mode, engine, actor: "alice", callAgent: deterministicCallAgent() },
    ).sessionId;

  test("default is rounds; env turns|rounds applies; an explicit engine beats env; meta.engine is stored", () => {
    delete process.env.CO_NEWBIZ_COMMITTEE_ENGINE;
    expect(metaOf(create()).engine).toBe("rounds");
    process.env.CO_NEWBIZ_COMMITTEE_ENGINE = "turns";
    expect(metaOf(create()).engine).toBe("turns");
    expect(metaOf(create("rounds")).engine).toBe("rounds");
    process.env.CO_NEWBIZ_COMMITTEE_ENGINE = "rounds";
    expect(metaOf(create()).engine).toBe("rounds");
    expect(metaOf(create("turns")).engine).toBe("turns");
    delete process.env.CO_NEWBIZ_COMMITTEE_ENGINE;
  });

  test("an invalid env value throws at convene and is never coerced", () => {
    process.env.CO_NEWBIZ_COMMITTEE_ENGINE = "turn-based";
    try {
      expect(() => create()).toThrow(CommitteeError);
      try {
        create();
      } catch (err) {
        expect((err as InstanceType<typeof CommitteeError>).code).toBe("invalid_engine");
      }
      // no session row was created by the failed call
      expect(() => create("turns")).not.toThrow(); // an explicit valid engine still wins over a broken env
    } finally {
      delete process.env.CO_NEWBIZ_COMMITTEE_ENGINE;
    }
  });

  test("the engine is fixed per session: a later env change does not move a stored session", async () => {
    const sessionId = create("turns");
    process.env.CO_NEWBIZ_COMMITTEE_ENGINE = "rounds";
    try {
      await runCommitteeSession(sessionId, { callTurn: det });
    } finally {
      delete process.env.CO_NEWBIZ_COMMITTEE_ENGINE;
    }
    expect(metaOf(sessionId).engine).toBe("turns");
    expect(recs(sessionId).length).toBeGreaterThan(0);
    expect(session.sessionEngine(metaOf(sessionId))).toBe("turns");
  });

  test("human_only sessions stay on the rounds path (no agent calls)", () => {
    expect(metaOf(create("turns", "human_only")).engine).toBe("rounds");
  });
});

// ── No silent fallback ─────────────────────────────────────────────────────

describe("no silent fallback to the round engine", () => {
  test("an LLM error stops the meeting with failed_at; only turn rows exist, no proposal, engine stays turns", async () => {
    const { sessionId } = newSession("agent_team", { agenda: ["안건"] });
    let calls = 0;
    const callTurn: CallTurn = async (req) => {
      if (calls++ === 2) throw new Error("model 'bad-model' not found");
      return det(req);
    };
    await expect(runCommitteeSession(sessionId, { callTurn })).rejects.toThrow("bad-model");

    const meta = metaOf(sessionId);
    expect(meta.engine).toBe("turns");
    expect(meta.convening).toBe(false);
    expect(meta.convening_error).toBe("model 'bad-model' not found");
    expect(meta.progress.phase).toBe("failed");
    expect(meta.progress.engine).toBe("turns");
    expect(meta.progress.failed_at).toMatchObject({
      phase: "discussion",
      issue_index: 1,
      seq: 4, // open, 2 stored turns → the failed turn would have been #4
      speaker_seat: SEATS[2],
      error_code: "Error",
    });
    expect(JSON.stringify(meta.progress)).not.toContain("bad-model");
    // everything stored is a turn row; nothing from the round engine, no proposal row
    expect(recs(sessionId).length).toBe(3);
    expect(
      (db.query("SELECT COUNT(*) AS c FROM agent_position WHERE process_run_id = ?").get(sessionId) as { c: number }).c,
    ).toBe(3);
    expect(
      (db.query("SELECT COUNT(*) AS c FROM gate_evaluation WHERE process_run_id = ?").get(sessionId) as { c: number })
        .c,
    ).toBe(0);
    expect(statusOf(sessionId)).toBe("failed");
  });

  test("llm_required: a turn session with no injected executor and no LLM factory refuses, still no rounds", async () => {
    setCallAgentFactory(null); // other suites in the same process may have registered one
    const { sessionId } = newSession("agent_team");
    await expect(runCommitteeSession(sessionId)).rejects.toThrow(/LLM provider/);
    expect(metaOf(sessionId).progress.failed_at.error_code).toBe("llm_required");
    expect(recs(sessionId)).toEqual([]);
  });

  test("a seat whose output is unusable twice is stored as pass with the error; three in a row stop the run", async () => {
    const { sessionId } = newSession("agent_team", { agenda: ["안건"] });
    let calls = 0;
    const callTurn: CallTurn = async () => {
      calls += 1;
      return "this is not json at all";
    };
    await expect(runCommitteeSession(sessionId, { callTurn })).rejects.toThrow(TurnEngineError);
    expect(calls).toBe(6); // 3 turns x 2 tries each
    const passes = recs(sessionId).filter((r) => r.move === "pass");
    expect(passes).toHaveLength(3);
    expect(passes.every((p) => p.error === "not_json")).toBe(true);
    const meta = metaOf(sessionId);
    expect(meta.progress.failed_at.error_code).toBe("turn_output_unusable");
    expect(meta.progress.failed_at.issue_index).toBe(1);
    expect(
      (db.query("SELECT COUNT(*) AS c FROM gate_evaluation WHERE process_run_id = ?").get(sessionId) as { c: number })
        .c,
    ).toBe(0);
  });

  test("one retry rescues a malformed first reply; the meeting continues", async () => {
    const { sessionId } = newSession("agent_team", { agenda: ["안건"] });
    const seen = new Set<string>();
    const callTurn: CallTurn = async (req) => {
      const key = `${req.kind}:${req.agentKey}:${req.issueIndex}`;
      if (!seen.has(key) && req.kind === "turn") {
        seen.add(key);
        return "garbage"; // first try fails, second (same key) succeeds
      }
      return det(req);
    };
    await runCommitteeSession(sessionId, { callTurn });
    expect(recs(sessionId).some((r) => r.error)).toBe(false);
    expect(metaOf(sessionId).synthesized).toBe(true);
  });
});

// ── Budgets ────────────────────────────────────────────────────────────────

describe("budgets close open issues as unresolved/budget, not as a failure", () => {
  const entity = () => ({ entityType: "opportunity" as const, entityId: newOpportunity() });
  const agenda = [1, 2, 3].map((i) => ({ id: `I${i}`, title: `안건 ${i}` }));

  test("turnsTotalMax: the discussion in progress and every later issue close unresolved/budget; a proposal row still lands", async () => {
    const result = await runTurnMeeting(entity(), {
      committeeKey: "t",
      seats: ["a", "b", "c"],
      topic: "t",
      chair: "chair",
      agenda,
      callTurn: det,
      actor: "alice",
      budgets: { turnsTotalMax: 4 },
    });
    expect(result.status).toBe("done");
    const all = loadTurnRecords(result.processRunId);
    const closes = all.filter((r) => r.move === "close");
    expect(closes.map((c) => c.issueIndex)).toEqual([1, 2, 3]);
    expect(closes.every((c) => c.outcome === "unresolved" && c.reason === "budget")).toBe(true);
    expect(all.filter((r) => r.role === "seat" && r.move !== "pass").length).toBe(4);
    expect(all.some((r) => r.move === "propose_consensus")).toBe(false); // no vote on a budget close
    expect(result.evaluation?.recommendation).toBe("hold"); // no stated stance → the conservative default
  });

  test("wallClockMs: engine time (fake clock) ends the meeting; later issues close unresolved/budget", async () => {
    let t = 0;
    const result = await runTurnMeeting(entity(), {
      committeeKey: "t",
      seats: ["a", "b", "c"],
      topic: "t",
      chair: "chair",
      agenda,
      callTurn: det,
      actor: "alice",
      clock: () => (t += 3 * 60_000),
    });
    expect(result.status).toBe("done");
    const closes = loadTurnRecords(result.processRunId).filter((r) => r.move === "close");
    expect(closes).toHaveLength(3);
    expect(closes.every((c) => c.reason === "budget")).toBe(true);
    expect(result.turnState.agent_elapsed_ms).toBeGreaterThanOrEqual(8 * 60_000);
  });

  test("progress reports the turn budget and counts discussion turns only", async () => {
    const snaps: MeetingProgress[] = [];
    const result = await runTurnMeeting(entity(), {
      committeeKey: "t",
      seats: ["a", "b"],
      topic: "t",
      chair: "chair",
      agenda: [agenda[0]],
      callTurn: det,
      actor: "alice",
      onProgress: (p) => snaps.push(p),
    });
    expect(result.status).toBe("done");
    expect(snaps.every((p) => p.engine === "turns" && p.turn_budget === 40 && p.issue_count !== 0)).toBe(true);
    const phases = snaps.map((p) => p.phase);
    expect(phases[0]).toBe("discussion");
    expect(phases).toContain("consensus");
    expect(phases.at(-1)).toBe("consensus"); // the synthesis marker; minutes only with a pass
    const last = snaps.filter((p) => p.phase === "discussion").at(-1)!;
    expect(last.speaker_seat).toBeTruthy();
    expect(last.issue_title).toBe("안건 1");
    expect(snaps.every((p, i) => i === 0 || p.turn_count >= snaps[i - 1].turn_count)).toBe(true);
  });
});

// ── Hybrid human turns ─────────────────────────────────────────────────────

describe("hybrid: a human takes a turn mid-meeting (§15.2)", () => {
  async function pausedSession(): Promise<{ sessionId: string; oppId: string }> {
    const s = newSession("hybrid", { agenda: ["첫 안건", "둘째 안건"] });
    await runCommitteeSession(s.sessionId, { callTurn: det });
    return s;
  }

  test("the engine yields at awaiting_human: not convening, run still running, chair call stored, deadline = +3 min", async () => {
    const { sessionId } = await pausedSession();
    const meta = metaOf(sessionId);
    expect(meta.convening).toBe(false);
    expect(meta.synthesized).toBeUndefined();
    expect(meta.progress.phase).toBe("awaiting_human");
    expect(meta.progress.awaiting.seat).toBe("human");
    expect(meta.awaiting.issue_index).toBe(1);
    expect(Date.parse(meta.awaiting.deadline_at) - Date.parse(meta.awaiting.called_at)).toBe(3 * 60_000);
    expect(statusOf(sessionId)).toBe("running");
    const call = recs(sessionId).find((r) => r.move === "call")!;
    expect(call.role).toBe("chair");
    expect(call.seq).toBe(meta.awaiting.seq);
    // the list endpoint keeps streaming turns while paused, and exposes the floor
    const listed = listCommitteeSessions(getOpp(sessionId)).find((s) => s.sessionId === sessionId)!;
    expect(listed.awaiting?.seat).toBe("human");
    expect(listed.turns.length).toBeGreaterThan(0);
    expect(listed.convening).toBe(false);
  });

  const getOpp = (sessionId: string): string =>
    (db.query("SELECT entity_id FROM process_run WHERE id = ?").get(sessionId) as { entity_id: string }).entity_id;

  test("a human submit stores a human row, marks the floor answered, and advance resumes from the same issue", async () => {
    const { sessionId } = await pausedSession();
    const before = recs(sessionId).length;
    const out = submitHumanPosition({
      sessionId,
      humanUserId: "alice",
      positionMd: "현장 확인이 선행되어야 합니다.",
      recommendation: "hold",
    });
    expect(out.awaitingResume).toBe(true);
    expect(out.turnSeq).toBe(before + 1);
    const human = recs(sessionId).find((r) => r.role === "human")!;
    expect(human.move).toBe("speak");
    expect(human.speaker).toBe("human");
    expect(human.humanUserId).toBe("alice");
    expect(human.agentKey).toBeNull();
    expect(metaOf(sessionId).awaiting.answered_at).toBeTruthy();
    // a second submission on the same floor is refused
    expect(() => submitHumanPosition({ sessionId, humanUserId: "alice", positionMd: "again" })).toThrow(
      /no open human turn/,
    );

    const res = await advanceCommitteeSession(sessionId, { actor: "alice", callTurn: det });
    // issue 2 opens its own floor → paused again, not finished
    expect(res.status).toBe("turns_resumed");
    expect(metaOf(sessionId).awaiting.issue_index).toBe(2);
    // the first issue continued into its consensus after the human turn (same sitting, no resume row)
    const all = recs(sessionId);
    const issue1 = all.filter((r) => r.issueIndex === 1);
    expect(issue1.map((r) => r.move).slice(-2 - SEATS.length)[0]).toBe("propose_consensus");
    expect(issue1.at(-1)?.move).toBe("close");
    expect(all.some((r) => r.move === "resume")).toBe(false);
    expect(metaOf(sessionId).attempts).toHaveLength(1);

    // answer issue 2 and the meeting completes; the human's stated stance reaches the synthesis input
    submitHumanPosition({ sessionId, humanUserId: "alice", positionMd: "동의합니다." });
    const done = await advanceCommitteeSession(sessionId, { actor: "alice", callTurn: det });
    expect(done.status).toBe("synthesized");
    expect(done.evaluation?.recommendation).toBeTruthy();
    expect(metaOf(sessionId).synthesized).toBe(true);
    expect(metaOf(sessionId).awaiting).toBeUndefined();
  });

  test("wrong seat, closed floor and agent_team sessions are refused", async () => {
    const { sessionId } = await pausedSession();
    expect(() => submitHumanPosition({ sessionId, humanUserId: "alice", seat: "other", positionMd: "x" })).toThrow(
      /not 'other'/,
    );
    const agentOnly = newSession("agent_team", { agenda: ["안건"] });
    await runCommitteeSession(agentOnly.sessionId, { callTurn: det });
    expect(() =>
      submitHumanPosition({ sessionId: agentOnly.sessionId, humanUserId: "alice", positionMd: "x" }),
    ).toThrow(/no human seats/);
    // a hybrid turn session that is not paused has no open floor
    const fresh = newSession("hybrid", { agenda: ["안건"] });
    expect(() => submitHumanPosition({ sessionId: fresh.sessionId, humanUserId: "alice", positionMd: "x" })).toThrow(
      /no open human turn/,
    );
  });

  test("advance before the deadline is refused; after it the chair stores pass_on_behalf — no human row, no fabricated words", async () => {
    const { sessionId } = await pausedSession();
    await expect(advanceCommitteeSession(sessionId, { actor: "alice", callTurn: det })).rejects.toThrow(
      /waiting for the human turn/,
    );
    expect(metaOf(sessionId).awaiting).toBeTruthy(); // unchanged by the refusal

    const a = metaOf(sessionId).awaiting;
    const past = (ms: number) => new Date(Date.now() - ms).toISOString();
    patchMeta(sessionId, { awaiting: { ...a, called_at: past(4 * 60_000), deadline_at: past(60_000) } });
    // a late submit is refused as well (the deadline passed)
    expect(() => submitHumanPosition({ sessionId, humanUserId: "alice", positionMd: "late" })).toThrow(/expired/);

    await advanceCommitteeSession(sessionId, { actor: "alice", callTurn: det });
    const all = recs(sessionId);
    expect(all.some((r) => r.role === "human")).toBe(false);
    expect(
      (
        db
          .query("SELECT COUNT(*) AS c FROM agent_position WHERE process_run_id = ? AND member_type = 'human'")
          .get(sessionId) as { c: number }
      ).c,
    ).toBe(0);
    const pass = all.find((r) => r.move === "pass_on_behalf")!;
    expect(pass.role).toBe("chair");
    expect(pass.agentKey).toBe(CHAIR);
    expect(pass.reason).toBe("human_timeout");
    expect(pass.forSeat).toBe("human");
    expect(pass.utterance).toContain("응답 없음");
    // human wait is accounted separately from agent compute
    const state = metaOf(sessionId).turn_state;
    expect(Math.abs(state.human_wait_ms - 3 * 60_000)).toBeLessThanOrEqual(5); // called_at → deadline (two Date.now() reads)
    expect(state.agent_elapsed_ms).toBeLessThan(DEFAULT_TURN_BUDGETS.wallClockMs);
  });

  test("human wait does not count toward the 8-minute engine clock", async () => {
    const { sessionId } = await pausedSession();
    // pretend the meeting already waited 19 minutes for humans and used 7 of 8 agent minutes
    patchMeta(sessionId, { turn_state: { agent_elapsed_ms: 7 * 60_000, human_wait_ms: 19 * 60_000 } });
    const a = metaOf(sessionId).awaiting;
    patchMeta(sessionId, { awaiting: { ...a, called_at: new Date(Date.now() - 2 * 60_000).toISOString() } });
    submitHumanPosition({ sessionId, humanUserId: "alice", positionMd: "의견입니다." });
    const res = await advanceCommitteeSession(sessionId, { actor: "alice", callTurn: det });
    // issue 1 finished normally despite 19+ min of human wait; only agent compute is budgeted
    const issue1Close = recs(sessionId).find((r) => r.issueIndex === 1 && r.move === "close")!;
    expect(issue1Close.reason).toBeUndefined();
    expect(issue1Close.outcome).toBe("narrowed");
    // the human wait is carried over (19 + ~2 min) and now exceeds the 20-minute cap: issue 2's floor is skipped
    expect(metaOf(sessionId).turn_state.human_wait_ms).toBeGreaterThanOrEqual(21 * 60_000);
    expect(res.status).toBe("synthesized");
    expect(recs(sessionId).find((r) => r.issueIndex === 2 && r.move === "pass_on_behalf")?.reason).toBe(
      "human_wait_cap",
    );
    expect(metaOf(sessionId).turn_state.agent_elapsed_ms).toBeLessThan(DEFAULT_TURN_BUDGETS.wallClockMs);
  });

  test("past the 20-minute total wait, human calls are skipped as pass_on_behalf without pausing", async () => {
    const { sessionId } = newSession("hybrid", { agenda: ["안건"] });
    patchMeta(sessionId, { turn_state: { agent_elapsed_ms: 0, human_wait_ms: 20 * 60_000 } });
    await runCommitteeSession(sessionId, { callTurn: det });
    expect(metaOf(sessionId).synthesized).toBe(true); // never paused
    const pass = recs(sessionId).find((r) => r.move === "pass_on_behalf")!;
    expect(pass.reason).toBe("human_wait_cap");
    expect(recs(sessionId).some((r) => r.move === "call")).toBe(false);
  });
});

// ── Resume (Q6) ────────────────────────────────────────────────────────────

describe("resume from the issue where the run stopped (§15.2)", () => {
  test("a failure at issue 3 → advance reopens a sitting, restarts issue 3, keeps earlier turns, never reuses seq", async () => {
    const { sessionId } = newSession("agent_team", { agenda: ["일", "이", "삼"] });
    let issue3Calls = 0;
    const flaky: CallTurn = async (req) => {
      if (req.issueIndex === 3 && req.kind === "turn") {
        issue3Calls += 1;
        if (issue3Calls === 1) return JSON.stringify({ move: "propose", utterance: "PARTIAL-ATTEMPT-1 발언입니다." });
        throw new Error("provider overloaded");
      }
      return det(req);
    };
    await expect(runCommitteeSession(sessionId, { callTurn: flaky })).rejects.toThrow("provider overloaded");

    const failed = metaOf(sessionId);
    expect(failed.progress.failed_at).toMatchObject({ phase: "discussion", issue_index: 3, error_code: "Error" });
    expect(failed.attempts).toHaveLength(1);
    expect(failed.attempts[0].stopped_at.issue_index).toBe(3);
    expect(failed.attempts[0].error).toBe("provider overloaded");
    expect(failed.attempts[0].ended_at).toBeTruthy();
    const beforeRows = recs(sessionId);
    const before12 = beforeRows.filter((r) => r.issueIndex <= 2).map((r) => r.id);
    const maxSeqBefore = Math.max(...beforeRows.map((r) => r.seq));
    expect(beforeRows.some((r) => r.utterance.includes("PARTIAL-ATTEMPT-1"))).toBe(true);

    const prompts: string[] = [];
    const healthy: CallTurn = async (req) => {
      prompts.push(req.prompt);
      return det(req);
    };
    const res = await advanceCommitteeSession(sessionId, { actor: "alice", callTurn: healthy });
    expect(res.status).toBe("synthesized");

    const meta = metaOf(sessionId);
    expect(meta.convening_error).toBeUndefined(); // cleared only after it was copied into the sitting entry
    expect(meta.attempts).toHaveLength(2);
    expect(meta.attempts[0].error).toBe("provider overloaded");
    expect(meta.attempts[1]).toMatchObject({ attempt: 2, resumed_from_issue_index: 3 });
    expect(meta.attempts[1].started_at).toBeTruthy();
    expect(meta.progress.phase).toBe("done");
    expect(meta.progress.attempt).toBe(2);
    expect(statusOf(sessionId)).toBe("done");

    const all = recs(sessionId);
    // earlier issues untouched (same rows, same attempt)
    expect(all.filter((r) => r.issueIndex <= 2).map((r) => r.id)).toEqual(before12);
    expect(all.filter((r) => r.issueIndex <= 2).every((r) => r.attempt === 1)).toBe(true);
    // one chair resume row, marking the new sitting
    const resume = all.filter((r) => r.move === "resume");
    expect(resume).toHaveLength(1);
    expect(resume[0]).toMatchObject({ attempt: 2, issueIndex: 3, role: "chair" });
    expect(resume[0].utterance).toBe("회의 재개 — 2차 시도, 안건 3부터");
    // seq is unique, increasing, and continues after the stopped sitting
    expect(all.map((r) => r.seq)).toEqual(all.map((_, i) => i + 1));
    expect(resume[0].seq).toBeGreaterThan(maxSeqBefore);
    // issue 3 restarted from its opening; the stopped sitting's partial turns are kept but abandoned
    const view = getCommitteeSession(sessionId)!;
    const partial = view.turns.find((t) => t.utteranceMd.includes("PARTIAL-ATTEMPT-1"))!;
    expect(partial.attempt).toBe(1);
    expect(partial.abandoned).toBe(true);
    expect(view.turns.filter((t) => t.issueIndex <= 2).every((t) => !t.abandoned)).toBe(true);
    expect(all.filter((r) => r.issueIndex === 3 && r.attempt === 2).some((r) => r.move === "open")).toBe(true);
    // ... and are excluded from the live transcript, the consensus input and the minutes rows
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.some((p) => p.includes("PARTIAL-ATTEMPT-1"))).toBe(false);
  });

  test("advance on a healthy, non-paused session is refused; a running session reports turns_running", async () => {
    const { sessionId } = newSession("agent_team", { agenda: ["안건"] });
    await runCommitteeSession(sessionId, { callTurn: det });
    await expect(advanceCommitteeSession(sessionId, { actor: "alice", callTurn: det })).rejects.toThrow(
      /already synthesized/,
    );

    const stuck = newSession("agent_team", { agenda: ["안건"] });
    // not paused, not failed, not convening (e.g. never started): nothing to advance
    patchMeta(stuck.sessionId, { convening: false });
    await expect(advanceCommitteeSession(stuck.sessionId, { actor: "alice", callTurn: det })).rejects.toThrow(
      /neither waiting/,
    );
    patchMeta(stuck.sessionId, { convening: true });
    const res = await advanceCommitteeSession(stuck.sessionId, { actor: "alice", callTurn: det });
    expect(res.status).toBe("turns_running");
  });
});

// ── Boundary ───────────────────────────────────────────────────────────────

describe("boundary (design boundary #2)", () => {
  test("the turn engine never writes a decision record and copies dissent verbatim from the stored vote", async () => {
    const decisionTables = ["gate_decision", "route_decision", "brownfield_target"];
    const count = (t: string) => (db.query(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
    const before = decisionTables.map(count);
    const { sessionId } = newSession("agent_team", { agenda: ["안건"] });
    const result = await runCommitteeSession(sessionId, { callTurn: det });
    expect(decisionTables.map(count)).toEqual(before);

    const ev = db
      .query("SELECT dissent_json, evaluated_by FROM gate_evaluation WHERE process_run_id = ?")
      .get(sessionId) as {
      dissent_json: string | null;
      evaluated_by: string;
    };
    expect(ev.evaluated_by).toBe(CHAIR);
    expect(result.evaluation?.recommendation).toBe("go"); // 3 go, 1 kill
    const dissent = JSON.parse(ev.dissent_json as string) as Array<{ member_key: string; position_md: string }>;
    expect(dissent.map((d) => d.member_key)).toEqual(["risk-officer"]);
    const vote = recs(sessionId).find((r) => r.speaker === "risk-officer" && r.vote)!;
    expect(dissent[0].position_md).toBe(vote.positionMd); // verbatim, tail included
  });
});

// ── API read path ──────────────────────────────────────────────────────────

describe("afterSeq on the list and GET routes", () => {
  test("returns only newer turns (max 50) and keeps working on a finished session", async () => {
    const { sessionId, oppId } = newSession("agent_team", { agenda: ["안건"] });
    await runCommitteeSession(sessionId, { callTurn: det });
    const total = recs(sessionId).length;

    const full = await nextRequest(`/api/opportunities/${oppId}/committee-sessions/${sessionId}`, {
      headers: { cookie: analystCookie },
    });
    expect(full.status).toBe(200);
    const fullBody = (await full.json()).data as {
      turns: Array<{ seq: number; turnId: string; utteranceMd: string }>;
      engine: string;
      hasMoreTurns: boolean;
    };
    expect(fullBody.engine).toBe("turns");
    expect(fullBody.turns).toHaveLength(total);
    expect(fullBody.hasMoreTurns).toBe(false);
    expect(fullBody.turns[0].utteranceMd).not.toContain("position-meta"); // tail stripped

    const cursor = 5;
    const delta = await nextRequest(`/api/opportunities/${oppId}/committee-sessions/${sessionId}?afterSeq=${cursor}`, {
      headers: { cookie: analystCookie },
    });
    const deltaBody = (await delta.json()).data as { turns: Array<{ seq: number }> };
    expect(deltaBody.turns.map((t) => t.seq)).toEqual(Array.from({ length: total - cursor }, (_, i) => cursor + i + 1));

    // list: sessionId narrows, afterSeq streams turns even after the run finished
    const list = await nextRequest(
      `/api/opportunities/${oppId}/committee-sessions?sessionId=${sessionId}&afterSeq=${total - 2}`,
      {
        headers: { cookie: analystCookie },
      },
    );
    const listBody = (await list.json()).data as {
      sessions: Array<{ sessionId: string; engine: string; turns: Array<{ seq: number }>; progress: MeetingProgress }>;
    };
    expect(listBody.sessions).toHaveLength(1);
    expect(listBody.sessions[0].turns.map((t) => t.seq)).toEqual([total - 1, total]);
    expect(listBody.sessions[0].progress.phase).toBe("done");
    // without afterSeq a finished turn session lists no turns (the GET carries them)
    const plain = await nextRequest(`/api/opportunities/${oppId}/committee-sessions`, {
      headers: { cookie: analystCookie },
    });
    expect((await plain.json()).data.sessions[0].turns).toEqual([]);

    const bad = await nextRequest(`/api/opportunities/${oppId}/committee-sessions?afterSeq=-1`, {
      headers: { cookie: analystCookie },
    });
    expect(bad.status).toBe(400);
    const unauth = await nextRequest(`/api/opportunities/${oppId}/committee-sessions/${sessionId}?afterSeq=1`);
    expect(unauth.status).toBe(401);
  });

  test("pages at 50 turns with hasMoreTurns", async () => {
    const { sessionId, oppId } = newSession("agent_team");
    for (let i = 0; i < 60; i++) {
      insertTurn(sessionId, {
        role: "seat",
        speaker: SEATS[0],
        move: "propose",
        issueIndex: 1,
        attempt: 1,
        utterance: `u${i}`,
      });
    }
    const res = await nextRequest(`/api/opportunities/${oppId}/committee-sessions/${sessionId}?afterSeq=0`, {
      headers: { cookie: analystCookie },
    });
    const body = (await res.json()).data as { turns: Array<{ seq: number }>; hasMoreTurns: boolean };
    expect(body.turns).toHaveLength(50);
    expect(body.turns.at(-1)?.seq).toBe(50);
    expect(body.hasMoreTurns).toBe(true);
  });

  test("project scope: a non-member gets 404 on the list and GET routes (membership stays at visibleProject)", async () => {
    const projectId = "proj-turns-1";
    db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, "NP-TURNS", NOW]);
    db.run(
      "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
      [projectId, "alice", "lead", "root", NOW, "test"],
    );
    const created = createCommitteeSession(
      { entityType: "project", entityId: projectId },
      {
        committeeKey: COMMITTEE,
        decisionMode: "agent_team",
        gate: "group_ic",
        engine: "turns",
        actor: "alice",
        callAgent: deterministicCallAgent(),
      },
    );
    patchMeta(created.sessionId, { agenda: [{ id: "I1", title: "안건" }] });
    await runCommitteeSession(created.sessionId, { callTurn: det });

    const asMember = await nextRequest(
      `/api/projects/${projectId}/committee-sessions/${created.sessionId}?afterSeq=0`,
      {
        headers: { cookie: analystCookie },
      },
    );
    expect(asMember.status).toBe(200);
    expect(((await asMember.json()).data as { turns: unknown[] }).turns.length).toBeGreaterThan(0);

    for (const path of [
      `/api/projects/${projectId}/committee-sessions/${created.sessionId}?afterSeq=0`,
      `/api/projects/${projectId}/committee-sessions?sessionId=${created.sessionId}&afterSeq=0`,
    ]) {
      const res = await nextRequest(path, { headers: { cookie: outsiderCookie } });
      expect(res.status).toBe(404);
    }
  });
});

describe("human turn over the routes (hybrid turn session)", () => {
  test("positions answers the open floor (201 + turnSeq); a second answer and an early advance are 409", async () => {
    const { sessionId, oppId } = newSession("hybrid", { agenda: ["안건"] });
    await runCommitteeSession(sessionId, { callTurn: det });
    const base = `/api/opportunities/${oppId}/committee-sessions/${sessionId}`;

    // The route needs a configured LLM to advance (owner decision 10); register one for this call only.
    setCallAgentFactory(() => deterministicCallAgent());
    const early = await nextRequest(`${base}/advance`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: "{}",
    });
    setCallAgentFactory(null);
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: { code: string } }).error.code).toBe("awaiting_human");

    const logged = console.error;
    console.error = () => {}; // the background resume refuses here (no LLM factory) and logs; the floor stays answered
    const res = await nextRequest(`${base}/positions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ positionMd: "추가 확인이 필요합니다.", recommendation: "hold" }),
    });
    await Bun.sleep(10);
    console.error = logged;
    expect(res.status).toBe(201);
    const data = ((await res.json()) as { data: { positionId: string; turnSeq: number; awaitingResume: boolean } })
      .data;
    expect(data.awaitingResume).toBe(true);
    const stored = recs(sessionId).find((r) => r.id === data.positionId);
    expect(stored?.role).toBe("human");
    expect(stored?.humanUserId).toBe("alice"); // from the session cookie, never the body
    expect(stored?.seq).toBe(data.turnSeq);

    const again = await nextRequest(`${base}/positions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ positionMd: "중복" }),
    });
    expect(again.status).toBe(409);
  });
});

describe("chair readers ignore turn rows (committee-chair.ts agenda fallback)", () => {
  test("computeAgendaFallback never reads a turn row's issue ordinal as a round", async () => {
    const { computeAgendaFallback } = await import("../../app/web-next/lib/committee-chair.ts");
    const tail = (extra: string) =>
      `x\n<!--position-meta:{"kind":"turn","seq":1,"attempt":1,"issue_index":1,"role":"seat","speaker_seat":"a","move":"propose"${extra}}-->`;
    const rows = ["a", "b"].map((seat, i) => ({
      id: `r${i}`,
      seat,
      memberType: "agent",
      round: 1,
      positionMd: tail(`,"recommendation":"${i === 0 ? "go" : "kill"}"`),
    }));
    expect(computeAgendaFallback(rows)).toEqual([]); // two stated recommendations would otherwise raise a split issue
  });
});

// keep the TurnRequest type referenced for editors; the seam is exercised above
export type _Unused = TurnRequest;
