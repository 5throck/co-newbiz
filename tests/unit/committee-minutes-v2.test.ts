// @version 1.0.0
/**
 * Minutes v2 for turn-engine meetings (ADR-0204 phase 3, design 2026-11-20
 * §4.6 / §13 Q7 / §15.2):
 *
 *   - the v2 schema and the code-assembled body (participants, consensus, votes
 *     incl. 불참, outcome, per-seat recommendation, sittings);
 *   - the no-fabrication rules: an excerpt turn must resolve to a live speech turn
 *     of the same issue, a quote must be verbatim (else repaired to the whole
 *     utterance), and every reject / repair is counted, not silent;
 *   - the deterministic fallback when the model fails (consensus proposal + close row);
 *   - appendix A (all non-abandoned turns, seq order) and B (abandoned attempts);
 *   - v1 sessions render exactly as before; a turn session with a v1 draft still
 *     gets the full transcript appended;
 *   - the minutes routes: version field, appendix, the markdown download;
 *   - the session list filter and the no-repeated-disclaimer prompt rule.
 *
 * LLM access is the injected seam (callTurn / `call`) — no network.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-committee-minutes-v2.sqlite");
const PREV_PROVIDER = process.env.CO_NEWBIZ_LLM_PROVIDER;
const PREV_DB = process.env.CO_NEWBIZ_DB_PATH;
const PREV_ENGINE = process.env.CO_NEWBIZ_COMMITTEE_ENGINE;
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_LLM_PROVIDER = "none"; // the chair minutes pass stays deterministic
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
const v2 = await import("../../app/web-next/lib/committee-minutes-v2.ts");
const schema = await import("../../app/web-next/lib/committee-minutes-schema.ts");
const chair = await import("../../app/web-next/lib/committee-chair.ts");
const scorecard = await import("../../app/web-next/lib/committee-scorecard.ts");
const { PROMPTS } = await import("../../app/web-next/lib/prompts.generated.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

import type { CallTurn, TurnRecord } from "../../app/web-next/lib/committee-turns.ts";

const { advanceCommitteeSession, createCommitteeSession, getCommitteeSession, patchMeta, runCommitteeSession } =
  session;
const { deterministicTurnCaller, loadTurnRecords, seatDisplayName, CHAIR_DISPLAY_NAME } = turns;

const NOW = new Date().toISOString();
const COMMITTEE = "group-ic-committee";
const SEATS = session
  .seatsForSession(session.getCommittee(COMMITTEE)!, undefined)
  .filter((m) => m.type === "agent")
  .map((m) => m.key);
const CHAIR = session.getCommittee(COMMITTEE)!.chair;
const det = deterministicTurnCaller();

let analystCookie: string;
let n = 0;

beforeAll(async () => {
  await createUser(db, { userId: "mina", role: "analyst", password: "pw-mina-123456", createdBy: "test", now: NOW });
  approveUser(db, { userId: "mina", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ userId: "mina", password: "pw-mina-123456" }),
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

// ── Synthetic rows (no database) ───────────────────────────────────────────

const FA = "financial-analyst";
const LC = "legal-counsel";
const RO = "risk-officer";
const VA = "valuation-agent";
const SYN_SEATS = [FA, LC, RO, VA];
const name = seatDisplayName;

function mk(
  seq: number,
  over: Partial<TurnRecord> & Pick<TurnRecord, "role" | "speaker" | "move" | "utterance">,
): TurnRecord {
  return {
    id: `t${seq}`,
    seq,
    attempt: 1,
    issueIndex: 1,
    issueId: "I1",
    memberType: "agent",
    agentKey: over.speaker,
    humanUserId: null,
    positionMd: "",
    createdAt: new Date(Date.parse("2026-11-20T10:00:00.000Z") + seq * 1000).toISOString(),
    ...over,
  };
}

const U3 = "자본 구조가 충분히 검증되지 않았다고 봅니다. 담보 조건을 다시 확인해야 합니다.";
const U2 = "차입 비율 60%까지는 감당 가능하다고 제안합니다.";
const U4 = "담보 조건은 별도 약정서에 있으며 이번 주 안에 확인하겠습니다.";

/** Issue 1 closes in sitting 1; issue 2 is abandoned in sitting 1 and re-run (and closed) in sitting 2. */
function scenario(): TurnRecord[] {
  return [
    mk(1, {
      role: "chair",
      speaker: CHAIR,
      move: "open",
      utterance: "안건 1/2 — 차입 구조",
      participants: [FA, LC, RO],
    }),
    mk(2, { role: "seat", speaker: FA, move: "propose", utterance: U2 }),
    mk(3, { role: "seat", speaker: LC, move: "rebut", addressedTo: FA, utterance: U3, respondsToTurn: "t2" }),
    mk(4, { role: "seat", speaker: FA, move: "answer", addressedTo: LC, utterance: U4 }),
    mk(5, { role: "seat", speaker: LC, move: "concede", utterance: "약정서를 확인하는 조건이라면 수긍합니다." }),
    mk(6, {
      role: "chair",
      speaker: CHAIR,
      move: "propose_consensus",
      utterance: "차입 60% 이내로 하되 담보 조건 확인을 전제로 한다.",
      restsOn: ["t3", "t4"],
    }),
    mk(7, {
      role: "seat",
      speaker: FA,
      move: "accept",
      vote: "accept",
      recommendation: "go",
      utterance: "동의합니다.",
    }),
    mk(8, {
      role: "seat",
      speaker: LC,
      move: "reserve",
      vote: "reserve",
      recommendation: "hold",
      utterance: "약정서 확인 전에는 유보합니다.",
    }),
    mk(9, {
      role: "seat",
      speaker: RO,
      move: "accept",
      vote: "accept",
      recommendation: "go",
      utterance: "동의합니다.",
    }),
    mk(10, {
      role: "chair",
      speaker: CHAIR,
      move: "close",
      utterance: "안건 1 마침 — 일부 합의 (동의 2, 유보 1, 불참 1).",
      outcome: "narrowed",
      votes: { accept: 2, reserve: 1, abstain: 0, not_participating: 1 },
      nonParticipants: [VA],
    }),
    // sitting 1 stopped inside issue 2: these two rows are abandoned once sitting 2 exists
    mk(11, {
      role: "chair",
      speaker: CHAIR,
      move: "open",
      issueIndex: 2,
      issueId: "I2",
      utterance: "안건 2/2 — 인력 계획",
      participants: [FA, RO],
    }),
    mk(12, {
      role: "seat",
      speaker: FA,
      move: "propose",
      issueIndex: 2,
      issueId: "I2",
      utterance: "ABANDONED-PARTIAL 발언입니다.",
    }),
    mk(13, {
      role: "chair",
      speaker: CHAIR,
      move: "resume",
      attempt: 2,
      issueIndex: 2,
      issueId: "I2",
      utterance: "회의 재개 — 2차 시도, 안건 2부터",
      reason: "resume",
    }),
    mk(14, {
      role: "chair",
      speaker: CHAIR,
      move: "open",
      attempt: 2,
      issueIndex: 2,
      issueId: "I2",
      utterance: "안건 2/2 — 인력 계획",
      participants: [FA, RO],
    }),
    mk(15, {
      role: "seat",
      speaker: RO,
      move: "ask",
      addressedTo: FA,
      attempt: 2,
      issueIndex: 2,
      issueId: "I2",
      utterance: "필요 인력은 몇 명입니까?",
    }),
    mk(16, {
      role: "seat",
      speaker: FA,
      move: "answer",
      addressedTo: RO,
      attempt: 2,
      issueIndex: 2,
      issueId: "I2",
      utterance: "초기 12명이며 1년 뒤 20명까지 늘립니다.",
    }),
    mk(17, {
      role: "chair",
      speaker: CHAIR,
      move: "propose_consensus",
      attempt: 2,
      issueIndex: 2,
      issueId: "I2",
      utterance: "초기 12명으로 시작한다.",
      restsOn: ["t16"],
    }),
    mk(18, {
      role: "seat",
      speaker: FA,
      move: "pass",
      attempt: 2,
      issueIndex: 2,
      issueId: "I2",
      error: "unusable",
      utterance: "(표결 응답을 받지 못했습니다)",
    }),
    mk(19, {
      role: "seat",
      speaker: RO,
      move: "reserve",
      vote: "reserve",
      recommendation: "kill",
      vetoDissent: true,
      attempt: 2,
      issueIndex: 2,
      issueId: "I2",
      utterance: "채용 계획의 근거가 없어 반대합니다.",
    }),
    mk(20, {
      role: "chair",
      speaker: CHAIR,
      move: "close",
      attempt: 2,
      issueIndex: 2,
      issueId: "I2",
      utterance: "안건 2 마침 — 미해결.",
      outcome: "unresolved",
      votes: { accept: 0, reserve: 1, abstain: 1, not_participating: 2 },
      nonParticipants: [LC, VA],
    }),
  ];
}

const AGENDA = [
  {
    id: "I1",
    title: "차입 구조",
    participants: [
      { seat: FA, reason: "차입 비율을 검토한다" },
      { seat: LC, reason: "담보 조건을 본다" },
      { seat: RO, reason: "필수 위원" },
    ],
  },
  {
    id: "I2",
    title: "인력 계획",
    participants: [
      { seat: FA, reason: "인건비 추정" },
      { seat: RO, reason: "필수 위원" },
    ],
  },
];

const input = (records: TurnRecord[] = scenario()) => ({
  agenda: AGENDA,
  records,
  currentAttempt: 2,
  chairSeat: CHAIR,
  seats: SYN_SEATS,
  attempts: [
    { attempt: 1, started_at: "2026-11-20T10:00:00.000Z", ended_at: "2026-11-20T10:00:12.000Z" },
    { attempt: 2, started_at: "2026-11-20T10:05:00.000Z" },
  ],
});

describe("verbatim quotes", () => {
  test("whole turn, contiguous cut, ellipsis fragments are verbatim; reworded text is not", () => {
    expect(v2.isVerbatim(U3, U3)).toBe(true);
    expect(v2.isVerbatim(U3, "담보 조건을 다시 확인해야 합니다")).toBe(true);
    expect(v2.isVerbatim(U3, "자본 구조가 충분히 … 담보 조건을 다시")).toBe(true);
    expect(v2.isVerbatim(U3, "담보 조건을 다시 … 자본 구조가")).toBe(false); // out of order
    expect(v2.isVerbatim(U3, "담보 조건을 꼭 다시 확인해야 합니다")).toBe(false);
    expect(v2.isVerbatim(U3, "")).toBe(false);
  });

  test("verbatimQuote: no quote = whole turn; a cut gets ellipses; a non-verbatim quote is repaired to the whole turn", () => {
    expect(v2.verbatimQuote(U3, undefined)).toEqual({ quote: U3, full: true, repaired: false });
    expect(v2.verbatimQuote(U3, U3)).toEqual({ quote: U3, full: true, repaired: false });
    expect(v2.verbatimQuote(U3, "담보 조건을 다시 확인해야 합니다")).toEqual({
      quote: "… 담보 조건을 다시 확인해야 합니다 …",
      full: false,
      repaired: false,
    });
    expect(v2.verbatimQuote(U3, "담보를 반드시 다시 확인해야 합니다")).toEqual({
      quote: U3,
      full: true,
      repaired: true,
    });
  });
});

describe("minutes v2 assembled from the rows", () => {
  test("body facts come from the stored turns: participants, consensus, votes with 응답 없음, tally with 불참, per-seat recommendation", () => {
    const inp = input();
    const json = v2.assembleMinutesV2(inp, v2.collectIssueFacts(inp), null);
    expect(json.version).toBe(2);
    expect(schema.isMinutesV2(json)).toBe(true);
    expect(schema.committeeMinutesV2Schema.safeParse(json).success).toBe(true);

    const [i1, i2] = json.issues;
    expect(i1.participants).toEqual([
      { seat: FA, name: name(FA), reason: "차입 비율을 검토한다" },
      { seat: LC, name: name(LC), reason: "담보 조건을 본다" },
      { seat: RO, name: name(RO), reason: "필수 위원" },
    ]);
    expect(i1.consensus).toEqual({
      turn_id: "t6",
      proposal: "차입 60% 이내로 하되 담보 조건 확인을 전제로 한다.",
      rests_on_turns: ["t3", "t4"],
    });
    expect(i1.votes.map((v) => [v.seat, v.vote])).toEqual([
      [FA, "accept"],
      [LC, "reserve"],
      [RO, "accept"],
    ]);
    expect(i1.votes[1].reason).toBe("약정서 확인 전에는 유보합니다.");
    expect(i1.outcome).toBe("narrowed");
    expect(i1.tally).toEqual({ accept: 2, reserve: 1, abstain: 0, not_participating: 1 });
    expect(i1.sat_out).toEqual([{ seat: VA, name: name(VA) }]);
    expect(i1.seat_recommendations.map((r) => [r.seat, r.recommendation])).toEqual([
      [FA, "go"],
      [LC, "hold"],
      [RO, "go"],
    ]);

    // issue 2 was re-run in sitting 2: the abandoned partial turn is not in its facts
    expect(i2.outcome).toBe("unresolved");
    expect(i2.votes.map((v) => [v.seat, v.vote])).toEqual([
      [FA, "no_response"],
      [RO, "reserve"],
    ]);
    expect(i2.tally).toEqual({ accept: 0, reserve: 1, abstain: 1, not_participating: 2 });
    expect(i2.seat_recommendations).toEqual([{ seat: RO, name: name(RO), recommendation: "kill", veto_dissent: true }]);
    expect(JSON.stringify(json)).not.toContain("ABANDONED-PARTIAL");
    // no recommendation / dissent field exists on the schema (ADR-0096 §6)
    expect(Object.keys(json)).toEqual(["version", "overview", "issues", "open_items", "provenance"]);
  });

  test("overview: seats by display name, not-participating seats, sittings with the issues each closed", () => {
    const inp = input();
    const json = v2.assembleMinutesV2(inp, v2.collectIssueFacts(inp), null);
    expect(json.overview.kind).toBe("ai_committee_meeting");
    expect(json.overview.engine).toBe("turns");
    expect(json.overview.chair_seat).toBe(CHAIR);
    expect(json.overview.held_at).toBe("2026-11-20T10:00:00.000Z");
    expect(json.overview.seats.map((s) => s.name)).toEqual(SYN_SEATS.map(name));
    // valuation-agent never spoke and never voted: reported as not participating (a seat that spoke is not)
    expect(json.overview.not_participating).toEqual([{ seat: VA, name: name(VA) }]);
    expect(json.overview.sittings).toEqual([
      {
        attempt: 1,
        started_at: "2026-11-20T10:00:00.000Z",
        ended_at: "2026-11-20T10:00:12.000Z",
        closed_issue_ids: ["I1"],
      },
      { attempt: 2, started_at: "2026-11-20T10:05:00.000Z", ended_at: expect.any(String), closed_issue_ids: ["I2"] },
    ]);
  });

  test("sittings header: 'N번에 나눠 진행' only when the meeting was restarted", () => {
    const inp = input();
    const json = v2.assembleMinutesV2(inp, v2.collectIssueFacts(inp), null);
    expect(v2.minutesV2HeaderLines(json).join("\n")).toContain("이 회의는 2번에 나눠 진행되었습니다");
    expect(v2.minutesV2HeaderLines(json).join("\n")).toContain(v2.MINUTES_V2_HEADER);

    const one = scenario().filter((r) => r.attempt === 1 && r.issueIndex === 1);
    const inp1 = { ...input(one), currentAttempt: 1, agenda: [AGENDA[0]], attempts: [{ attempt: 1 }] };
    const json1 = v2.assembleMinutesV2(inp1, v2.collectIssueFacts(inp1), null);
    expect(v2.minutesV2HeaderLines(json1).join("\n")).not.toContain("나눠 진행");
  });
});

describe("the model only selects: references and quotes are validated against the stored turns", () => {
  test("a good pick is kept with the speaker's display name; a verbatim cut is stored with ellipses", () => {
    const inp = input();
    const facts = v2.collectIssueFacts(inp);
    const sel = v2.resolveMinutesV2Selection(
      {
        issues: [
          { issue_id: "I1", excerpt: [{ turn: 3, quote: "담보 조건을 다시 확인해야 합니다" }, { turn: "#4" }] },
          { issue_id: "I2", excerpt: [{ turn: 15 }, { turn: "t16" }] },
        ],
        open_items: [{ text: "담보 약정서를 확인한다", owner_seat: name(FA), issue_id: "I1" }],
      },
      facts,
      inp,
    );
    expect(sel.rejectedRefs).toBe(0);
    expect(sel.repairedQuotes).toBe(0);
    const e1 = sel.excerpts.get("I1")!;
    expect(e1.map((e) => [e.turn_id, e.speaker_name, e.move, e.addressed_name, e.quote_full])).toEqual([
      ["t3", name(LC), "rebut", name(FA), false],
      ["t4", name(FA), "answer", name(LC), true],
    ]);
    expect(e1[0].quote).toBe("… 담보 조건을 다시 확인해야 합니다 …");
    expect(sel.openItems).toEqual([
      { text: "담보 약정서를 확인한다", owner_seat: FA, owner_name: name(FA), issue_id: "I1" },
    ]);
    const json = v2.assembleMinutesV2(inp, facts, sel);
    expect(json.provenance).toMatchObject({
      source: "llm",
      fallback_issue_ids: [],
      rejected_refs: 0,
      repaired_quotes: 0,
    });
    expect(json.issues.every((i) => i.excerpt_source === "llm")).toBe(true);
    expect(v2.verifyMinutesV2(json, inp.records, 2)).toEqual([]);
  });

  test("a fabricated, other-issue, abandoned, chair or vote turn is rejected and counted; a reworded quote is repaired", () => {
    const inp = input();
    const facts = v2.collectIssueFacts(inp);
    const sel = v2.resolveMinutesV2Selection(
      {
        issues: [
          {
            issue_id: "I1",
            excerpt: [
              { turn: 99 }, // fabricated
              { turn: 15 }, // a turn of issue 2
              { turn: 6 }, // the chair's consensus row is not a speech turn
              { turn: 7 }, // a vote
              { turn: 2, quote: "차입 비율 90%까지 가능합니다" }, // reworded
            ],
          },
          { issue_id: "I2", excerpt: [{ turn: 12 }] }, // abandoned partial turn
          { issue_id: "I9", excerpt: [{ turn: 1 }] }, // not on the agenda
        ],
      },
      facts,
      inp,
    );
    expect(sel.rejectedRefs).toBe(6);
    expect(sel.repairedQuotes).toBe(1);
    expect(sel.notes.length).toBe(7);
    // the reworded quote was replaced by the WHOLE utterance, never stored
    expect(sel.excerpts.get("I1")).toEqual([
      expect.objectContaining({ turn_id: "t2", quote: U2, quote_full: true, quote_repaired: true }),
    ]);
    expect(sel.excerpts.has("I2")).toBe(false);

    const json = v2.assembleMinutesV2(inp, facts, sel);
    // I2 got no valid pick: the deterministic excerpt is used and recorded
    expect(json.provenance).toMatchObject({
      source: "mixed",
      fallback_issue_ids: ["I2"],
      rejected_refs: 6,
      repaired_quotes: 1,
    });
    expect(json.issues.map((i) => i.excerpt_source)).toEqual(["llm", "fallback"]);
  });

  test("verifyMinutesV2 catches a tampered quote, an unknown turn id and a turn of another issue", () => {
    const inp = input();
    const json = v2.assembleMinutesV2(inp, v2.collectIssueFacts(inp), null);
    expect(v2.verifyMinutesV2(json, inp.records, 2)).toEqual([]);
    const bad = structuredClone(json);
    bad.issues[0].excerpt[0].quote = "원문에 없는 문장입니다";
    bad.issues[0].excerpt.push({ ...bad.issues[0].excerpt[0], turn_id: "t999", quote: U2 });
    bad.issues[1].excerpt.push({ ...bad.issues[0].excerpt[0], turn_id: "t3", seq: 3, quote: U3 });
    const problems = v2.verifyMinutesV2(bad, inp.records, 2);
    expect(problems.some((p) => p.includes("is not verbatim"))).toBe(true);
    expect(problems.some((p) => p.includes("t999") && p.includes("not a live turn"))).toBe(true);
    expect(problems.some((p) => p.includes("belongs to another issue"))).toBe(true);
  });
});

describe("deterministic fallback", () => {
  test("no selection: the excerpt is the consensus proposal and the close row, verbatim; the draft says so", () => {
    const inp = input();
    const json = v2.assembleMinutesV2(inp, v2.collectIssueFacts(inp), null);
    expect(json.provenance).toMatchObject({ source: "fallback", fallback_issue_ids: ["I1", "I2"] });
    const [i1, i2] = json.issues;
    expect(i1.excerpt_source).toBe("fallback");
    expect(i1.excerpt.map((e) => [e.turn_id, e.speaker_name, e.move, e.quote_full])).toEqual([
      ["t6", CHAIR_DISPLAY_NAME, "propose_consensus", true],
      ["t10", CHAIR_DISPLAY_NAME, "close", true],
    ]);
    expect(i1.excerpt[0].quote).toBe("차입 60% 이내로 하되 담보 조건 확인을 전제로 한다.");
    expect(i2.excerpt.map((e) => e.turn_id)).toEqual(["t17", "t20"]);
    // open items: every non-agreed issue, plus each reservation with its reason
    expect(json.open_items.map((o) => o.issue_id)).toEqual(["I1", "I1", "I2", "I2"]);
    expect(json.open_items[1].text).toContain(`유보(${name(LC)}): 약정서 확인 전에는 유보합니다.`);
    expect(json.open_items[2].text).toContain("미합의(보류)");
  });

  test("a model that throws or returns junk degrades to the deterministic draft (fallback: true), dialogue kept in appendix A", async () => {
    const inp = input();
    const warn = console.warn;
    console.warn = () => {};
    try {
      const boom = await chair.runChairMinutesV2({
        topic: "t",
        ...inp,
        call: async () => {
          throw new Error("outage");
        },
      });
      expect(boom.fallback).toBe(true);
      expect(boom.promptVersion).toBe("committee.minutes@3");
      expect(boom.model).toBeUndefined();
      expect(schema.isMinutesV2(boom.json)).toBe(true);
      const junk = await chair.runChairMinutesV2({ topic: "t", ...inp, call: async () => "not json at all" });
      expect(junk.fallback).toBe(true);
      expect((junk.json as { provenance: { source: string } }).provenance.source).toBe("fallback");
    } finally {
      console.warn = warn;
    }
    // the dialogue is never dropped: appendix A still lists every live turn
    expect(v2.buildMinutesAppendix(inp.records, 2).transcript.length).toBe(inp.records.length - 2);
  });

  test("the chair pass end to end with an injected model: material is the numbered transcript; picks are validated; model recorded", async () => {
    const inp = input();
    let material = "";
    const warn = console.warn;
    console.warn = () => {};
    try {
      const out = await chair.runChairMinutesV2({
        topic: "차입·인력 계획 심의",
        ...inp,
        call: async (m) => {
          material = m;
          return JSON.stringify({
            issues: [
              { issue_id: "I1", excerpt: [{ turn: 3, quote: "담보 조건을 다시 확인해야 합니다" }, { turn: 4 }] },
              { issue_id: "I2", excerpt: [{ turn: 15 }, { turn: 16 }, { turn: 404 }] },
            ],
            open_items: [{ text: "채용 근거 자료를 제출한다", owner_seat: FA, issue_id: "I2" }],
          });
        },
      });
      expect(out.fallback).toBe(false);
      expect(out.model).toBe("injected");
      const json = out.json as ReturnType<typeof v2.assembleMinutesV2>;
      expect(json.provenance).toMatchObject({ source: "llm", rejected_refs: 1 });
      expect(json.issues[1].excerpt.map((e) => e.turn_id)).toEqual(["t15", "t16"]);
      // the open-item rule: I1 (narrowed) had none from the model, so the deterministic ones are added
      expect(json.open_items.filter((o) => o.issue_id === "I1").length).toBeGreaterThan(0);
      expect(json.open_items[0]).toMatchObject({ owner_seat: FA, issue_id: "I2" });
    } finally {
      console.warn = warn;
    }
    expect(material).toContain("## 안건별 발언 기록");
    expect(material).toContain(`#3 ${name(LC)} [rebut → ${name(FA)}]: ${U3}`);
    expect(material).not.toContain("ABANDONED-PARTIAL"); // abandoned turns are never offered to the model
    expect(material).not.toContain(`legal-counsel`); // display names only, never an agent key
    expect(material).toContain("합의안(의장): 차입 60% 이내로");
  });
});

describe("appendix A / B", () => {
  test("A lists every non-abandoned turn in seq order, in the documented line format; B groups the abandoned turns by attempt", () => {
    const shuffled = [...scenario()].reverse();
    const ap = v2.buildMinutesAppendix(shuffled, 2);
    const seqs = ap.transcript.map((t) => t.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14, 15, 16, 17, 18, 19, 20]); // 11, 12 abandoned
    expect(ap.transcript[2].line).toBe(`[3] ${name(LC)} · rebut → ${name(FA)}: ${U3}`);
    expect(ap.transcript[0].line).toBe(`[1] ${CHAIR_DISPLAY_NAME} · open: 안건 1/2 — 차입 구조`);
    expect(ap.abandoned.map((g) => [g.attempt, g.turns.map((t) => t.seq)])).toEqual([[1, [11, 12]]]);
    expect(ap.abandoned[0].turns[1].line).toContain("ABANDONED-PARTIAL");
    expect(ap.transcript.some((t) => t.line.includes("ABANDONED-PARTIAL"))).toBe(false);
  });

  test("a single-sitting meeting has no appendix B; markdown pieces print A with anchors and B only when present", () => {
    const one = scenario().filter((r) => r.attempt === 1 && r.issueIndex === 1);
    const ap = v2.buildMinutesAppendix(one, 1);
    expect(ap.abandoned).toEqual([]);
    const md = v2.minutesAppendixLines(ap, { transcript: "A", abandoned: "B" }).join("\n");
    expect(md).toContain("## 부록 A — 전체 발언 기록");
    expect(md).not.toContain("부록 B");
    expect(md).toContain('<a id="turn-t3"></a>[3]');

    const both = v2
      .minutesAppendixLines(v2.buildMinutesAppendix(scenario(), 2), { transcript: "A", abandoned: "B" })
      .join("\n");
    expect(both).toContain("## 부록 B — 중단된 시도");
    expect(both).toContain("### 1차 시도");
  });
});

// ── Real meetings ──────────────────────────────────────────────────────────

function newSession(opts: { engine?: "turns" | "rounds"; agenda?: string[] } = {}): {
  oppId: string;
  sessionId: string;
} {
  const oppId = `opp-min2-${++n}`;
  db.run("INSERT INTO opportunity (id, name, created_by, created_at) VALUES (?,?,?,?)", [oppId, `M${n}`, "mina", NOW]);
  const created = createCommitteeSession(
    { entityType: "opportunity", entityId: oppId },
    {
      committeeKey: COMMITTEE,
      decisionMode: "agent_team",
      gate: "group_ic",
      engine: opts.engine ?? "turns",
      actor: "mina",
      callAgent: deterministicCallAgent(),
      source: "web",
    },
  );
  if (opts.agenda)
    patchMeta(created.sessionId, { agenda: opts.agenda.map((title, i) => ({ id: `I${i + 1}`, title })) });
  return { oppId, sessionId: created.sessionId };
}

const metaOf = (sessionId: string): Record<string, any> =>
  JSON.parse(
    (db.query("SELECT meta_json FROM process_run WHERE id = ?").get(sessionId) as { meta_json: string }).meta_json,
  );

describe("a real turn meeting stores minutes v2 and the md download carries the dialogue", () => {
  let oppId: string;
  let sessionId: string;
  beforeAll(async () => {
    ({ oppId, sessionId } = newSession({ agenda: ["차입 구조", "인력 계획"] }));
    await runCommitteeSession(sessionId, { callTurn: det });
  });

  test("the stored draft is v2 (no model configured → deterministic, recorded as such)", () => {
    const draft = getCommitteeSession(sessionId)!.minutesDraft!;
    expect(draft.prompt_version).toBe("committee.minutes@3");
    expect(draft.fallback).toBe(true);
    expect(schema.isMinutesV2(draft.json)).toBe(true);
    const json = draft.json as ReturnType<typeof v2.assembleMinutesV2>;
    expect(json.issues).toHaveLength(2);
    expect(json.issues.every((i) => i.excerpt.length > 0 && i.excerpt_source === "fallback")).toBe(true);
    // every excerpt resolves against the rows
    expect(v2.verifyMinutesV2(json, loadTurnRecords(sessionId), 1)).toEqual([]);
  });

  test("the markdown has header, body and appendix A; every live turn appears once, in seq order", () => {
    const md = scorecard.buildCommitteeMinutes(db, sessionId)!;
    expect(md).toContain(v2.MINUTES_V2_HEADER);
    expect(md).toContain("## 안건별 논의");
    expect(md).toContain("**핵심 발언**");
    expect(md).toContain("## 부록 A — 전체 발언 기록");
    expect(md).not.toContain("## 부록 B");
    expect(md).not.toContain("나눠 진행");
    const records = loadTurnRecords(sessionId);
    const appendix = md.slice(md.indexOf("## 부록 A"));
    let at = -1;
    for (const r of records) {
      const line = `[${r.seq}] `;
      const found = appendix.indexOf(line, at + 1);
      expect(found).toBeGreaterThan(at);
      at = found;
    }
    // speakers by display name, never an agent key
    expect(appendix).toContain(name(SEATS[0]));
    for (const key of SEATS) if (name(key) !== key) expect(appendix).not.toContain(`] ${key} ·`);
    // dissent and recommendation sections are still there (read from gate_evaluation)
    expect(md).toContain("## 보존된 이의 (dissent)");
    expect(md).toContain("## 제안 권고 (proposal, not a decision)");
    expect(md).toContain("verify against appendix A");
  });

  test("the minutes route: ?format=json carries version 2 and the appendix; the default response is the markdown", async () => {
    const jsonRes = await nextRequest(
      `/api/opportunities/${oppId}/committee-sessions/${sessionId}/minutes?format=json`,
      { headers: { cookie: analystCookie } },
    );
    expect(jsonRes.status).toBe(200);
    const body = (await jsonRes.json()).data as {
      minutesVersion: number;
      engine: string;
      minutesDraft: { json: { version: number }; prompt_version: string };
      appendix: { transcript: Array<{ seq: number; line: string }>; abandoned: unknown[] };
    };
    expect(body.minutesVersion).toBe(2);
    expect(body.engine).toBe("turns");
    expect(body.minutesDraft.json.version).toBe(2);
    expect(body.appendix.transcript).toHaveLength(loadTurnRecords(sessionId).length);
    expect(body.appendix.abandoned).toEqual([]);

    const mdRes = await nextRequest(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/minutes`, {
      headers: { cookie: analystCookie },
    });
    expect(mdRes.headers.get("content-type")).toContain("text/markdown");
    const md = await mdRes.text();
    expect(md).toContain("## 부록 A — 전체 발언 기록");
    expect(md).toContain(body.appendix.transcript[2].line);
  });

  test("regeneration works on a turn session: a deterministic draft is regenerable and stays v2", async () => {
    const draft = await session.regenerateCommitteeMinutes(sessionId);
    expect(schema.isMinutesV2(draft.json)).toBe(true);
    expect(draft.prompt_version).toBe("committee.minutes@3");
  });
});

describe("resume: sittings header and appendix B (design §15.2)", () => {
  test("a restarted meeting says it ran in 2 sittings and lists the stopped attempt's turns under 중단된 시도", async () => {
    const { sessionId } = newSession({ agenda: ["일", "이", "삼"] });
    let calls = 0;
    const flaky: CallTurn = async (req) => {
      if (req.issueIndex === 3 && req.kind === "turn") {
        calls += 1;
        if (calls === 1) return JSON.stringify({ move: "propose", utterance: "PARTIAL-ATTEMPT-1 발언입니다." });
        throw new Error("provider overloaded");
      }
      return det(req);
    };
    await expect(runCommitteeSession(sessionId, { callTurn: flaky })).rejects.toThrow("provider overloaded");
    expect((await advanceCommitteeSession(sessionId, { actor: "mina", callTurn: det })).status).toBe("synthesized");

    const draft = getCommitteeSession(sessionId)!.minutesDraft!;
    const json = draft.json as ReturnType<typeof v2.assembleMinutesV2>;
    expect(json.overview.sittings.map((s) => s.attempt)).toEqual([1, 2]);
    expect(json.overview.sittings[0].closed_issue_ids).toEqual(["I1", "I2"]);
    expect(json.overview.sittings[1].closed_issue_ids).toEqual(["I3"]);
    // the abandoned partial turn is nowhere in the body
    expect(JSON.stringify(json)).not.toContain("PARTIAL-ATTEMPT-1");

    const md = scorecard.buildCommitteeMinutes(db, sessionId)!;
    expect(md).toContain("이 회의는 2번에 나눠 진행되었습니다");
    const a = md.indexOf("## 부록 A");
    const b = md.indexOf("## 부록 B — 중단된 시도");
    expect(b).toBeGreaterThan(a);
    expect(md.slice(a, b)).not.toContain("PARTIAL-ATTEMPT-1");
    expect(md.slice(b)).toContain("PARTIAL-ATTEMPT-1");
    expect(md).toContain("### 1차 시도");

    const payload = scorecard.buildCommitteeMinutesJson(db, sessionId)!;
    expect(payload.appendix!.abandoned.map((g) => g.attempt)).toEqual([1]);
  });
});

describe("v1 sessions are unchanged", () => {
  test("a round-engine session keeps v1 minutes: version 1, no appendix, legacy sections", async () => {
    const { oppId, sessionId } = newSession({ engine: "rounds" });
    await runCommitteeSession(sessionId, { callAgent: deterministicCallAgent() });
    const t = getCommitteeSession(sessionId)!;
    expect(t.engine).toBe("rounds");
    expect(schema.isMinutesV2(t.minutesDraft!.json)).toBe(false);
    expect(t.minutesDraft!.prompt_version).toBe("committee.minutes@2");

    const md = scorecard.buildCommitteeMinutes(db, sessionId)!;
    expect(md).toContain("## 쟁점별 논의");
    expect(md).toContain("## 부록 B — 입장 원문 (전문)");
    expect(md).not.toContain("전체 발언 기록");
    expect(md).not.toContain(v2.MINUTES_V2_HEADER);

    const res = await nextRequest(`/api/opportunities/${oppId}/committee-sessions/${sessionId}/minutes?format=json`, {
      headers: { cookie: analystCookie },
    });
    const body = (await res.json()).data as { minutesVersion: number; appendix: unknown; engine: string };
    expect(body.minutesVersion).toBe(1);
    expect(body.engine).toBe("rounds");
    expect(body.appendix).toBeNull();
  });

  test("a turn session whose stored draft is still v1 renders the v1 body and gets the stored dialogue appended (no backfill of the draft)", async () => {
    const { sessionId } = newSession({ agenda: ["안건"] });
    await runCommitteeSession(sessionId, { callTurn: det });
    const v1Draft = {
      json: {
        agenda: [{ id: "I1", title: "안건" }],
        discussion: [],
        agreements: [],
        open_questions: [],
        action_items: [],
      },
      fallback: true,
      prompt_version: "committee.minutes@2",
      input_hash: "old",
      created_at: NOW,
    };
    patchMeta(sessionId, { minutes_draft: v1Draft as never });

    const md = scorecard.buildCommitteeMinutes(db, sessionId)!;
    expect(md).toContain("## 쟁점별 논의");
    expect(md).not.toContain(v2.MINUTES_V2_HEADER);
    expect(md).toContain("## 부록 C — 전체 발언 기록");
    expect(md).toContain(`[1] ${CHAIR_DISPLAY_NAME} · open`);
    const payload = scorecard.buildCommitteeMinutesJson(db, sessionId)!;
    expect(payload.minutesVersion).toBe(1);
    expect(payload.appendix!.transcript.length).toBe(loadTurnRecords(sessionId).length);
    // the stored draft was not rewritten
    expect(metaOf(sessionId).minutes_draft.json.discussion).toEqual([]);
    // ... and it is regeneration-eligible (a different input hash), which produces v2
    const regen = await session.regenerateCommitteeMinutes(sessionId);
    expect(schema.isMinutesV2(regen.json)).toBe(true);
  });
});

describe("session list filter (S4 panel must not list another committee's sessions)", () => {
  test("committeeKey and gate narrow the list; garbage is a 400", async () => {
    const { oppId, sessionId: groupSession } = newSession({ engine: "rounds" });
    const other = createCommitteeSession(
      { entityType: "opportunity", entityId: oppId },
      {
        committeeKey: "route-steering-committee",
        decisionMode: "agent_team",
        gate: "target_screening",
        engine: "rounds",
        actor: "mina",
        callAgent: deterministicCallAgent(),
        source: "web",
      },
    );
    const list = async (qs: string) => {
      const res = await nextRequest(`/api/opportunities/${oppId}/committee-sessions${qs}`, {
        headers: { cookie: analystCookie },
      });
      return {
        status: res.status,
        ids: ((await res.json()).data?.sessions ?? []).map((s: { sessionId: string }) => s.sessionId),
      };
    };
    expect((await list("")).ids.sort()).toEqual([groupSession, other.sessionId].sort());
    expect((await list(`?committeeKey=${COMMITTEE}`)).ids).toEqual([groupSession]);
    expect((await list("?committeeKey=route-steering-committee")).ids).toEqual([other.sessionId]);
    expect((await list("?gate=target_screening")).ids).toEqual([other.sessionId]);
    expect((await list(`?committeeKey=route-steering-committee&gate=group_ic`)).ids).toEqual([]);
    expect((await list("?committeeKey=a%20b")).status).toBe(400);
    expect(session.sessionListFilterFromQuery(new URLSearchParams("gate=pre_fs&committeeKey=x-y"))).toEqual({
      gate: "pre_fs",
      committeeKey: "x-y",
    });
    expect(session.sessionListFilterFromQuery(new URLSearchParams("gate=../x"))).toBeNull();
  });
});

describe("no repeated 'a human decides' disclaimers in utterances", () => {
  test("the turn, consensus and vote prompts tell seats once not to repeat it; the system prompts say the same", () => {
    const agenda = [{ id: "I1", title: "안건" }];
    const turn = turns.buildTurnPrompt({
      seat: FA,
      topic: "t",
      agenda,
      issueIndex: 1,
      live: [],
      allowed: ["propose", "ask"],
      seats: SYN_SEATS,
    });
    expect(turn).toContain(turns.NO_DISCLAIMER_RULE);
    const cons = turns.buildConsensusPrompt({ chair: CHAIR, topic: "t", agenda, issueIndex: 1, live: [] });
    expect(cons).toContain(turns.NO_DISCLAIMER_RULE);
    const vote = turns.buildVotePrompt({
      seat: FA,
      topic: "t",
      agenda,
      issueIndex: 1,
      live: [],
      proposal: "p",
      seats: SYN_SEATS,
    });
    expect(vote).toContain("이 점을 이유 문장에 되풀이하지 않습니다");
    expect(PROMPTS["committee.turn"].system).toContain("Do not repeat the notice that a human decides");
    expect(PROMPTS["committee.consensus"].system).toContain("Do not add a notice that a human decides");
    expect(PROMPTS["committee.minutes_turns"].system).toContain("Do not repeat the notice that a human decides");
  });

  test("the v2 minutes prompt is registered, takes turn numbers and has no field for recommendation or dissent", () => {
    const p = PROMPTS["committee.minutes_turns"];
    expect(p.agent).toBeNull();
    expect(p.system).toContain('"issues":[{"issue_id":"I1","excerpt":[{"turn":7');
    expect(p.system).toContain("NO field for the recommendation");
    expect(chair.MINUTES_V2_PROMPT_VERSION).toBe("committee.minutes@3");
    expect(chair.MINUTES_PROMPT_VERSION).toBe("committee.minutes@2"); // v1 stays for round sessions
  });
});
