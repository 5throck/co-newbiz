// @version 1.0.0
/**
 * Committee UI for the turn engine (ADR-0204 phase 2, design 2026-11-20 §4.8/§8/§15.2):
 *
 *   - pure helpers: merge/dedupe of polled turns by seq, the afterSeq poll URL
 *     (round sessions keep the plain list URL), attempt-change reset, grouping by
 *     issue with abandoned turns split off, row kinds, turn step states, the
 *     human-floor deadline and "advance once" rule, the paused convening deadline,
 *     resume / re-attach picking;
 *   - the rendered views (ko / en): issue-grouped transcript with a distinct chair
 *     row, close rows with outcome + votes, pass_on_behalf without invented
 *     speech, abandoned turns out of the flow, utterances escaped as text;
 *     the "your turn" floor with a countdown, a failed run with its stop location
 *     and retry button, the polite live region;
 *   - the panel is wired to all of it and round sessions keep the plain poll URL;
 *   - the turns catalog exists in ko and en, with a label for every move.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { MeetingProgress } from "../../app/web-next/lib/committee-progress.ts";
import type { TurnView } from "../../app/web-next/lib/committee-progress-view.ts";
import { normSrc } from "./helpers/src-normalize.ts";

const WEB = "../../app/web-next";
const { renderToStaticMarkup } = (await import(`${WEB}/node_modules/react-dom/server.js`)) as {
  renderToStaticMarkup: (el: unknown) => string;
};
const { createElement } = (await import(`${WEB}/node_modules/react/index.js`)) as {
  createElement: (type: unknown, props: unknown, ...c: unknown[]) => unknown;
};
const { NextIntlClientProvider } = (await import(`${WEB}/node_modules/next-intl`)) as {
  NextIntlClientProvider: unknown;
};
const ko = (await import(`${WEB}/locales/ko.json`)).default as Record<string, unknown>;
const en = (await import(`${WEB}/locales/en.json`)).default as Record<string, unknown>;
const { CommitteeTurnProgressView } = (await import(`${WEB}/components/CommitteeProgress.tsx`)) as {
  CommitteeTurnProgressView: unknown;
};
const { CommitteeTurnTranscript } = (await import(`${WEB}/components/CommitteeTurnTranscript.tsx`)) as {
  CommitteeTurnTranscript: unknown;
};
const { MeetingWindowDialog } = (await import(`${WEB}/components/CommitteeMeetingWindow.tsx`)) as {
  MeetingWindowDialog: unknown;
};
const view = await import(`${WEB}/lib/committee-progress-view.ts`);

const T0 = Date.parse("2026-11-20T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const turn = (seq: number, over: Partial<TurnView> = {}): TurnView => ({
  turnId: `turn-${seq}`,
  seq,
  attempt: 1,
  issueIndex: 1,
  issueId: null,
  role: "seat",
  speakerSeat: "risk-officer",
  memberType: "agent",
  agentKey: "risk-officer",
  humanUserId: null,
  move: "propose",
  addressedTo: null,
  respondsToTurn: null,
  vote: null,
  stance: null,
  recommendation: null,
  vetoDissent: false,
  outcome: null,
  votes: null,
  participants: null,
  nonParticipants: null,
  restsOn: [],
  reason: null,
  forSeat: null,
  error: null,
  utteranceMd: `Statement ${seq}.`,
  abandoned: false,
  createdAt: iso(T0 + seq * 1000),
  ...over,
});

const progress = (over: Partial<MeetingProgress> = {}): MeetingProgress => ({
  engine: "turns",
  phase: "discussion",
  issue_index: 2,
  issue_count: 4,
  issue_title: "Capex scope",
  speaker_seat: "financing-agent",
  turn_count: 7,
  turn_budget: 40,
  attempt: 1,
  started_at: iso(T0),
  updated_at: iso(T0 + 1000),
  ...over,
});

const wrap = (el: unknown, locale: "ko" | "en") =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" },
      el,
    ),
  );

const renderView = (
  props: Record<string, unknown> & { progress: MeetingProgress },
  locale: "ko" | "en" = "ko",
  nowMs = T0 + 192_000,
) => wrap(createElement(CommitteeTurnProgressView, { turns: [], ...props, nowMs }), locale);

const renderWindow = (props: Record<string, unknown>, locale: "ko" | "en" = "ko", nowMs = T0 + 192_000) =>
  wrap(createElement(MeetingWindowDialog, { turns: [], onClose: () => {}, ...props, nowMs }), locale);

const renderTranscript = (props: Record<string, unknown>, locale: "ko" | "en" = "ko") =>
  wrap(createElement(CommitteeTurnTranscript, props), locale);

describe("mergeTurns / lastSeq", () => {
  test("dedupes by seq, newer copy wins, ascending order, inputs untouched", () => {
    const a = [turn(1), turn(2)];
    const b = [turn(3), turn(2, { utteranceMd: "newer copy" })];
    const merged = view.mergeTurns(a, b);
    expect(merged.map((t: TurnView) => t.seq)).toEqual([1, 2, 3]);
    expect(merged[1].utteranceMd).toBe("newer copy");
    expect(a[1].utteranceMd).toBe("Statement 2.");
    expect(a).toHaveLength(2);
  });

  test("an empty delta changes nothing; out-of-order arrival is re-sorted", () => {
    expect(view.mergeTurns([turn(1)], [])).toHaveLength(1);
    expect(view.mergeTurns([turn(5)], [turn(3), turn(4)]).map((t: TurnView) => t.seq)).toEqual([3, 4, 5]);
  });

  test("lastSeq is the cursor: 0 when empty, the max otherwise", () => {
    expect(view.lastSeq([])).toBe(0);
    expect(view.lastSeq([turn(2), turn(9), turn(4)])).toBe(9);
  });

  test("a new sitting resets the held turns, the same sitting does not", () => {
    expect(view.turnsNeedReset(null, 1)).toBe(false);
    expect(view.turnsNeedReset(1, 1)).toBe(false);
    expect(view.turnsNeedReset(1, 2)).toBe(true);
    expect(view.attemptOf(undefined)).toBe(1);
    expect(view.attemptOf({ attempt: 3 })).toBe(3);
  });
});

describe("buildTurnPollUrl", () => {
  const base = "/api/opportunities/opp-1/committee-sessions";
  test("round sessions and the first poll keep the plain list URL", () => {
    expect(view.buildTurnPollUrl(base, "s-1", null)).toBe(base);
  });
  test("a turn session narrows to its id and streams after the cursor", () => {
    expect(view.buildTurnPollUrl(base, "s-1", 12)).toBe(`${base}?sessionId=s-1&afterSeq=12`);
    expect(view.buildTurnPollUrl(base, "a b", 0)).toBe(`${base}?sessionId=a%20b&afterSeq=0`);
  });
});

describe("groupTurnsByIssue", () => {
  test("groups ascending by issue, seq order inside, abandoned split into interrupted", () => {
    const turns = [
      turn(4, { issueIndex: 2 }),
      turn(1, { issueIndex: 1 }),
      turn(3, { issueIndex: 1, abandoned: true }),
      turn(2, { issueIndex: 1 }),
    ];
    const g = view.groupTurnsByIssue(turns);
    expect(g.map((x: { issueIndex: number }) => x.issueIndex)).toEqual([1, 2]);
    expect(g[0].turns.map((t: TurnView) => t.seq)).toEqual([1, 2]);
    expect(g[0].interrupted.map((t: TurnView) => t.seq)).toEqual([3]);
    expect(g[1].turns.map((t: TurnView) => t.seq)).toEqual([4]);
  });

  test("titles: stored agenda first, the live title only for the current issue", () => {
    const g = view.groupTurnsByIssue(
      [turn(1, { issueIndex: 1 }), turn(2, { issueIndex: 2 }), turn(3, { issueIndex: 3 })],
      {
        titles: ["Agenda one"],
        currentIssue: 2,
        currentTitle: "Live two",
      },
    );
    expect(g.map((x: { title: string | null }) => x.title)).toEqual(["Agenda one", "Live two", null]);
  });

  test("an issue whose turns are all abandoned is kept, empty flow plus interrupted note", () => {
    const g = view.groupTurnsByIssue([turn(1, { abandoned: true })]);
    expect(g).toHaveLength(1);
    expect(g[0].turns).toHaveLength(0);
    expect(g[0].interrupted).toHaveLength(1);
    expect(view.visibleTurnCount([turn(1, { abandoned: true }), turn(2)])).toBe(1);
  });

  test("no turns, no groups", () => {
    expect(view.groupTurnsByIssue([])).toEqual([]);
  });
});

describe("turnRowKind", () => {
  test("chair mechanics, close, pass_on_behalf, votes, seat speech and human turns", () => {
    expect(view.turnRowKind({ role: "chair", move: "open" })).toBe("chair");
    expect(view.turnRowKind({ role: "chair", move: "propose_consensus" })).toBe("chair");
    expect(view.turnRowKind({ role: "chair", move: "close" })).toBe("close");
    expect(view.turnRowKind({ role: "chair", move: "pass_on_behalf" })).toBe("pass");
    expect(view.turnRowKind({ role: "seat", move: "accept" })).toBe("vote");
    expect(view.turnRowKind({ role: "seat", move: "reserve" })).toBe("vote");
    expect(view.turnRowKind({ role: "seat", move: "rebut" })).toBe("seat");
    expect(view.turnRowKind({ role: "human", move: "speak" })).toBe("human");
  });
});

describe("turnStepStates", () => {
  const states = (p: MeetingProgress) => view.turnStepStates(p);
  test("agenda pass: agenda current, the rest remaining", () => {
    expect(states(progress({ phase: "agenda", issue_index: undefined }))).toEqual({
      agenda: "current",
      discussion: "todo",
      consensus: "todo",
      minutes: "todo",
    });
  });
  test("discussion and the per-issue consensus keep the discussion step current (no flip-flop)", () => {
    for (const phase of ["discussion", "awaiting_human"] as const) {
      expect(states(progress({ phase })).discussion).toBe("current");
    }
    const perIssue = states(progress({ phase: "consensus", issue_index: 2 }));
    expect(perIssue.discussion).toBe("current");
    expect(perIssue.consensus).toBe("todo");
  });
  test("the closing synthesis (consensus without an issue) moves on to the consensus step", () => {
    expect(states(progress({ phase: "consensus", issue_index: undefined }))).toEqual({
      agenda: "done",
      discussion: "done",
      consensus: "current",
      minutes: "todo",
    });
  });
  test("minutes and done", () => {
    expect(states(progress({ phase: "minutes", issue_index: undefined })).minutes).toBe("current");
    expect(Object.values(states(progress({ phase: "done" })))).toEqual(["done", "done", "done", "done"]);
  });
  test("a failed run marks the step it stopped in and keeps the earlier ones done", () => {
    const f = states(
      progress({
        phase: "failed",
        failed_at: { phase: "discussion", issue_index: 2, seq: 9, error_code: "llm_error" },
      }),
    );
    expect(f).toEqual({ agenda: "done", discussion: "failed", consensus: "todo", minutes: "todo" });
    const fc = states(
      progress({ phase: "failed", failed_at: { phase: "consensus", issue_index: 2, error_code: "llm_error" } }),
    );
    expect(fc.discussion).toBe("failed");
  });
});

describe("human floor deadline", () => {
  const a = { seq: 12, deadline_at: iso(T0 + 180_000), called_at: iso(T0), issue_index: 2, seat: "human" };
  test("remaining time counts down and never goes negative", () => {
    expect(view.awaitingRemainingMs(a, T0 + 60_000)).toBe(120_000);
    expect(view.awaitingRemainingMs(a, T0 + 180_000)).toBe(0);
    expect(view.awaitingRemainingMs(a, T0 + 999_999)).toBe(0);
    expect(view.awaitingRemainingMs({ deadline_at: "not a date" }, T0)).toBe(0);
    expect(view.isAwaitingExpired(a, T0 + 179_999)).toBe(false);
    expect(view.isAwaitingExpired(a, T0 + 180_000)).toBe(true);
  });
  test("countdown text rounds a partial second up so it never shows 0:00 early", () => {
    expect(view.splitCountdown(125_400)).toEqual({ minutes: 2, seconds: 6 });
    expect(view.splitCountdown(0)).toEqual({ minutes: 0, seconds: 0 });
    expect(view.splitCountdown(-5)).toEqual({ minutes: 0, seconds: 0 });
  });
  test("advance is driven only after the deadline, and only once per floor", () => {
    expect(view.shouldAdvanceAwaiting(a, T0 + 100_000, null)).toBe(false);
    expect(view.shouldAdvanceAwaiting(a, T0 + 180_000, null)).toBe(true);
    expect(view.shouldAdvanceAwaiting(a, T0 + 200_000, 12)).toBe(false); // already driven
    expect(view.shouldAdvanceAwaiting(a, T0 + 200_000, 11)).toBe(true); // a different (earlier) floor
  });
  test("an answered floor is left to the server, with a grace-period safety net", () => {
    const answered = { ...a, answered_at: iso(T0 + 30_000) };
    expect(view.shouldAdvanceAwaiting(answered, T0 + 35_000, null)).toBe(false);
    expect(view.shouldAdvanceAwaiting(answered, T0 + 30_000 + view.ANSWERED_RESUME_GRACE_MS, null)).toBe(true);
    expect(view.shouldAdvanceAwaiting(answered, T0 + 60_000, 12)).toBe(false);
  });
});

describe("paused convening deadline", () => {
  const deadline = T0 + view.CONVENING_DEADLINE_MS;
  test("not reached while paused; the paused stretch is added back afterwards", () => {
    let pause = { pausedMs: 0, since: null as number | null };
    pause = view.nextDeadlinePause(pause, true, T0 + 60_000);
    expect(pause).toEqual({ pausedMs: 0, since: T0 + 60_000 });
    // still paused far past the nominal deadline: never reached
    expect(view.convenDeadlineReached(deadline, pause, true, deadline + 3_600_000)).toBe(false);
    // a second paused tick keeps the original start
    expect(view.nextDeadlinePause(pause, true, T0 + 90_000)).toBe(pause);
    // resumes after a 5 minute wait
    pause = view.nextDeadlinePause(pause, false, T0 + 60_000 + 300_000);
    expect(pause).toEqual({ pausedMs: 300_000, since: null });
    expect(view.convenDeadlineReached(deadline, pause, false, deadline + 299_999)).toBe(false);
    expect(view.convenDeadlineReached(deadline, pause, false, deadline + 300_000)).toBe(true);
  });
  test("a meeting that never paused keeps the plain deadline; a running tick is a no-op", () => {
    const none = { pausedMs: 0, since: null as number | null };
    expect(view.nextDeadlinePause(none, false, T0)).toBe(none);
    expect(view.convenDeadlineReached(deadline, none, false, deadline - 1)).toBe(false);
    expect(view.convenDeadlineReached(deadline, none, false, deadline)).toBe(true);
  });
});

describe("resume / re-attach picking", () => {
  const sess = (id: string, startedMin: number, over: Record<string, unknown> = {}) => ({
    sessionId: id,
    startedAt: iso(T0 + startedMin * 60_000),
    ...over,
  });
  test("a paused hybrid turn meeting qualifies although it is not convening; its deadline counts from the latest stretch", () => {
    const paused = sess("t", 0, {
      engine: "turns",
      convening: false,
      awaiting: { seat: "human" },
      progress: { started_at: iso(T0), updated_at: iso(T0 + 20 * 60_000), phase: "awaiting_human" },
    });
    expect(view.pickResumableSession([paused], T0)).toEqual({ sessionId: "t", startedAtMs: T0 + 20 * 60_000 });
  });
  test("a running turn meeting counts from progress.updated_at too; a round session keeps its own start", () => {
    const running = sess("t", 5, {
      engine: "turns",
      convening: true,
      progress: { updated_at: iso(T0 + 8 * 60_000) },
    });
    expect(view.pickResumableSession([running], T0)?.startedAtMs).toBe(T0 + 8 * 60_000);
    const rounds = sess("r", 2, { convening: true, progress: { started_at: iso(T0) } });
    expect(view.pickResumableSession([rounds], T0)).toEqual({ sessionId: "r", startedAtMs: T0 + 2 * 60_000 });
  });
  test("finished or idle sessions never resume; the newest startedAt wins", () => {
    expect(
      view.pickResumableSession([sess("x", 1, { engine: "turns", convening: false, awaiting: null })], T0),
    ).toBeNull();
    const picked = view.pickResumableSession(
      [sess("old", 1, { convening: true }), sess("new", 3, { engine: "turns", convening: true })],
      T0,
    );
    expect(picked?.sessionId).toBe("new");
  });
  test("only the NEWEST session, and only an unfinished failed turn meeting, is re-attached", () => {
    const failed = (id: string, min: number, over: Record<string, unknown> = {}) =>
      sess(id, min, { engine: "turns", convening: false, progress: { phase: "failed" }, ...over });
    expect(view.pickFailedTurnSession([failed("a", 1)])).toEqual({ sessionId: "a" });
    expect(view.pickFailedTurnSession([sess("newer", 9), failed("a", 1)])).toBeNull();
    expect(view.pickFailedTurnSession([failed("a", 1, { meta: { synthesized: true } })])).toBeNull();
    expect(view.pickFailedTurnSession([failed("a", 1, { convening: true })])).toBeNull();
    expect(view.pickFailedTurnSession([sess("r", 1, { progress: { phase: "failed" } })])).toBeNull(); // rounds
    expect(view.pickFailedTurnSession([])).toBeNull();
  });
});

describe("turnErrorKey", () => {
  test("the human-turn and resume codes map to catalog lines; others keep the server message", () => {
    expect(view.turnErrorKey("floor_not_open")).toBe("common.committee.turns.errors.floor_not_open");
    expect(view.turnErrorKey("floor_expired")).toBe("common.committee.turns.errors.floor_expired");
    expect(view.turnErrorKey("awaiting_human")).toBe("common.committee.turns.errors.awaiting_human");
    expect(view.turnErrorKey("something_else")).toBeNull();
  });
});

describe("meeting window helpers", () => {
  const m = (scrollTop: number, clientHeight = 400, scrollHeight = 1000) => ({ scrollTop, clientHeight, scrollHeight });

  test("isNearBottom: at the bottom, within the threshold, and scrolled up", () => {
    expect(view.isNearBottom(m(600))).toBe(true); // exactly at the bottom
    expect(view.isNearBottom(m(560))).toBe(true); // 40px away: still "following"
    expect(view.isNearBottom(m(500))).toBe(false); // 100px away
    expect(view.isNearBottom(m(0))).toBe(false);
    expect(view.isNearBottom({ scrollTop: 0, clientHeight: 400, scrollHeight: 300 })).toBe(true); // short content
    expect(view.isNearBottom(m(550), 40)).toBe(false); // custom threshold
  });

  test("auto-follow: new turns keep following while at the bottom", () => {
    let st = { following: true, seen: 3 };
    st = view.followReducer(st, { type: "items", total: 5 });
    expect(st).toEqual({ following: true, seen: 5 });
    expect(view.unseenCount(st, 5)).toBe(0);
    expect(view.showJumpToLatest(st, true)).toBe(false);
  });

  test("scrolling up pauses auto-follow: new turns are counted as unseen and the jump button shows", () => {
    let st = { following: true, seen: 5 };
    st = view.followReducer(st, { type: "scroll", metrics: m(100), total: 5 });
    expect(st).toEqual({ following: false, seen: 5 });
    st = view.followReducer(st, { type: "items", total: 8 });
    expect(st).toEqual({ following: false, seen: 5 }); // not advanced while paused
    expect(view.unseenCount(st, 8)).toBe(3);
    expect(view.showJumpToLatest(st, true)).toBe(true);
    // a finished record never shows the button
    expect(view.showJumpToLatest(st, false)).toBe(false);
  });

  test("scrolling back to the bottom (or the jump button) resumes following and clears the count", () => {
    const paused = { following: false, seen: 5 };
    expect(view.followReducer(paused, { type: "scroll", metrics: m(600), total: 8 })).toEqual({
      following: true,
      seen: 8,
    });
    expect(view.followReducer(paused, { type: "jump", total: 8 })).toEqual({ following: true, seen: 8 });
    expect(view.unseenCount({ following: true, seen: 8 }, 9)).toBe(0);
    expect(view.unseenCount({ following: false, seen: 9 }, 7)).toBe(0); // never negative (turns dropped on a reset)
  });

  test("a programmatic scroll to the bottom keeps following (scroll event at the bottom)", () => {
    const st = { following: true, seen: 5 };
    expect(view.followReducer(st, { type: "scroll", metrics: m(600, 400, 1000), total: 6 }).following).toBe(true);
  });

  test("currentSpeakerSeat: the human floor holder while paused, the speaker in discussion, none elsewhere", () => {
    expect(view.currentSpeakerSeat(progress())).toBe("financing-agent");
    const aw = progress({
      phase: "awaiting_human",
      awaiting: { seat: "risk-officer", seq: 1, issue_index: 1, called_at: iso(T0), deadline_at: iso(T0 + 1) },
    });
    expect(view.currentSpeakerSeat(aw)).toBe("risk-officer");
    expect(view.currentSpeakerSeat(progress({ phase: "consensus" }))).toBeNull();
    expect(view.currentSpeakerSeat(progress({ phase: "discussion", speaker_seat: undefined }))).toBeNull();
  });

  test("isHumanTurnOpen: only a writer, only an open (unanswered) floor", () => {
    const awaiting = { seat: "human", seq: 1, issue_index: 1, called_at: iso(T0), deadline_at: iso(T0 + 1) };
    const aw = progress({ phase: "awaiting_human", awaiting });
    expect(view.isHumanTurnOpen(aw, true)).toBe(true);
    expect(view.isHumanTurnOpen(aw, false)).toBe(false);
    expect(
      view.isHumanTurnOpen(
        progress({ phase: "awaiting_human", awaiting: { ...awaiting, answered_at: iso(T0) } }),
        true,
      ),
    ).toBe(false);
    expect(view.isHumanTurnOpen(progress(), true)).toBe(false);
  });

  test("normalizeParticipants: tolerant of the settling backend shape, de-duplicated, never throws", () => {
    expect(view.normalizeParticipants(undefined)).toEqual([]);
    expect(view.normalizeParticipants("risk-officer")).toEqual([]);
    expect(
      view.normalizeParticipants([
        "legal-counsel",
        { seat: "risk-officer", label: "위험 점검 위원", reason: "거부권 보유" },
        { agent_key: "financing-agent", display_name: "자금 위원", reason: "  " },
        { key: "ip-agent" },
        { seat: "risk-officer", reason: "duplicate" },
        { label: "no seat" },
        null,
        42,
      ]),
    ).toEqual([
      { seat: "legal-counsel", label: null, reason: null },
      { seat: "risk-officer", label: "위험 점검 위원", reason: "거부권 보유" },
      { seat: "financing-agent", label: "자금 위원", reason: null },
      { seat: "ip-agent", label: null, reason: null },
    ]);
  });

  test("participantsByIssue: index 0 = issue 1; issues without participants give empty lists", () => {
    expect(view.participantsByIssue(undefined)).toEqual([]);
    expect(view.participantsByIssue(null)).toEqual([]);
    expect(view.participantsByIssue([{ participants: [{ seat: "a" }] }, {}, { participants: "x" }, null])).toEqual([
      [{ seat: "a", label: null, reason: null }],
      [],
      [],
      [],
    ]);
  });

  test("voteTally: not_participating is surfaced only when present and positive; a missing tally stays null", () => {
    expect(view.voteTally(null)).toBeNull();
    expect(view.voteTally({ accept: 3, reserve: 1, abstain: 0 })).toEqual({
      accept: 3,
      reserve: 1,
      abstain: 0,
      notParticipating: null,
    });
    expect(view.voteTally({ accept: 3, reserve: 1, abstain: 0, not_participating: 4 })?.notParticipating).toBe(4);
    expect(view.voteTally({ accept: 3, reserve: 1, abstain: 0, not_participating: 0 })?.notParticipating).toBeNull();
  });
});

describe("transcript rendering", () => {
  const chairOpen = turn(1, {
    role: "chair",
    speakerSeat: "valuation-agent",
    move: "open",
    utteranceMd: "Opening issue one.",
  });
  const speech = turn(2, {
    move: "ask",
    addressedTo: "financing-agent",
    stance: "conditional",
    utteranceMd: "Is capex firm?",
  });
  const closeRow = turn(3, {
    role: "chair",
    speakerSeat: "valuation-agent",
    move: "close",
    outcome: "narrowed",
    votes: { accept: 3, reserve: 1, abstain: 0 },
    utteranceMd: "",
  });

  test("grouped by issue under a heading, chair row distinct, speaker seat label and move label (ko)", () => {
    const html = renderTranscript({
      turns: [chairOpen, speech, closeRow, turn(4, { issueIndex: 2 })],
      titles: ["Scope", "Capex"],
    });
    expect(count(html, 'data-testid="committee-turn-issue"')).toBe(2);
    expect(html.indexOf("안건 1. Scope")).toBeLessThan(html.indexOf("안건 2. Capex"));
    expect(html).toContain("<h3");
    // chair: a text chip and the tinted rule, not color alone
    expect(html).toMatch(/data-kind="chair"[^>]*style="[^"]*var\(--primary\)/);
    expect(html).toContain("의장");
    expect(html).toContain("위험 점검 위원"); // COMMITTEE_SEAT_LABEL_KEY
    expect(html).toContain("질문");
    expect(html).toContain("→ 자금 조달 위원");
    expect(html).toContain("조건부");
    expect(html).toContain("Is capex firm?");
    expect(html.indexOf("Opening issue one.")).toBeLessThan(html.indexOf("Is capex firm?"));
    expect(html).toContain("토의 기록 4건");
  });

  test("a close row shows the outcome with an icon plus text and the vote counts (ko + en)", () => {
    const ko1 = renderTranscript({ turns: [closeRow] });
    expect(ko1).toContain("일부 합의 (유보 의견 있음)");
    expect(ko1).toContain("찬성 3 · 유보 1 · 기권 0");
    expect(ko1).toMatch(/data-outcome="narrowed"[^>]*>\s*<svg/);
    const en1 = renderTranscript({ turns: [closeRow] }, "en");
    expect(en1).toContain("Partly agreed (reservations)");
    expect(en1).toContain("Accept 3 · Reserve 1 · Abstain 0");
  });

  test("pass_on_behalf shows the structured fact and the reason, never invented speech", () => {
    const pass = turn(5, {
      role: "chair",
      speakerSeat: "valuation-agent",
      move: "pass_on_behalf",
      forSeat: "human",
      reason: "human_timeout",
      utteranceMd: "SHOULD NOT BE SHOWN",
    });
    const html = renderTranscript({ turns: [pass] });
    expect(html).toContain("의장이 사람 위원 자리의 순서를 대신 넘겼습니다");
    expect(html).toContain("응답 없음 (시간 초과)");
    expect(html).not.toContain("SHOULD NOT BE SHOWN");
    expect(renderTranscript({ turns: [pass] }, "en")).toContain("No response (timed out)");
  });

  test("an unknown pass reason is shown as received, not dropped", () => {
    const pass = turn(5, { role: "chair", move: "pass_on_behalf", forSeat: "risk-officer", reason: "new_reason" });
    expect(renderTranscript({ turns: [pass] })).toContain("new_reason");
  });

  test("a pass stored for unusable output says so instead of showing the stub text", () => {
    const html = renderTranscript({ turns: [turn(6, { move: "pass", error: "unparseable", utteranceMd: "stub" })] });
    expect(html).toContain("발언 결과를 두 번 읽지 못해 순서를 넘겼습니다");
    expect(html).toContain("unparseable");
    expect(html).not.toContain(">stub<");
  });

  test("a human turn is badged apart from members and never names the user id", () => {
    const html = renderTranscript({
      turns: [
        turn(7, {
          role: "human",
          memberType: "human",
          agentKey: null,
          humanUserId: "u-secret",
          speakerSeat: "human",
          move: "speak",
          recommendation: "hold",
          utteranceMd: "My view.",
        }),
      ],
    });
    expect(html).toContain("status-green");
    expect(html).toContain("사람 위원");
    expect(html).toContain("권고 HOLD");
    expect(html).not.toContain("u-secret");
  });

  test("abandoned turns stay out of the flow and sit in a collapsed interrupted note", () => {
    const html = renderTranscript({ turns: [turn(1), turn(2, { abandoned: true, utteranceMd: "Old attempt." })] });
    const flow = html.split("<details")[0];
    expect(flow).toContain("Statement 1.");
    expect(flow).not.toContain("Old attempt.");
    expect(html).toContain("중단된 시도의 발언 1건 (회의 흐름에서 제외됨)");
    expect((html.match(/<details[^>]*\sopen/g) ?? []).length).toBe(0);
    expect(html).toContain("토의 기록 1건"); // the abandoned turn is not counted
  });

  test("utterance text is escaped, never injected as HTML", () => {
    const html = renderTranscript({ turns: [turn(1, { utteranceMd: '<img src=x onerror="alert(1)"> **bold**' })] });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("whitespace-pre-wrap");
  });

  test("empty transcript is an honest line", () => {
    expect(renderTranscript({ turns: [] })).toContain("아직 오간 발언이 없습니다.");
  });

  test("a close row counts seats that did not take part as '불참', never as accept (ko + en)", () => {
    const close = turn(3, {
      role: "chair",
      move: "close",
      outcome: "agreed",
      votes: { accept: 4, reserve: 0, abstain: 0, not_participating: 3 } as TurnView["votes"],
      utteranceMd: "",
    });
    expect(renderTranscript({ turns: [close] })).toContain("찬성 4 · 유보 0 · 기권 0 · 불참 3");
    expect(renderTranscript({ turns: [close] }, "en")).toContain("Not participating 3");
    // absent / zero: the plain tally (older sessions)
    const none = turn(3, { role: "chair", move: "close", votes: { accept: 2, reserve: 0, abstain: 0 } });
    expect(renderTranscript({ turns: [none] })).not.toContain("불참");
  });

  test("a request_floor turn is labelled (ko + en); an unknown move is shown as received", () => {
    const req = turn(4, { move: "request_floor" as TurnView["move"], utteranceMd: "Capex needs a look." });
    expect(renderTranscript({ turns: [req] })).toContain("발언권 요청");
    expect(renderTranscript({ turns: [req] }, "en")).toContain("Floor request");
    expect(renderTranscript({ turns: [turn(5, { move: "brand_new" as TurnView["move"] })] })).toContain("brand_new");
  });

  test("per-issue participants: one comma-separated line, reasons in one collapsed note; absent = nothing", () => {
    const participants = [
      [
        { seat: "risk-officer", label: null, reason: "거부권 보유" },
        { seat: "financing-agent", label: "자금 위원 (표시명)", reason: null },
      ],
    ];
    const html = renderTranscript({ turns: [turn(1)], participants });
    expect(html).toContain('data-testid="committee-issue-participants"');
    // seat key -> catalog label; payload label wins; ONE line, names comma-separated, reason as title
    expect(html).toContain(
      '참석 위원 2명: <span title="거부권 보유">위험 점검 위원</span>, <span>자금 위원 (표시명)</span>',
    );
    // one 선정 이유 note, only for seats with a stated reason — no per-seat list
    expect(html).toContain("선정 이유");
    expect(html).toContain("위험 점검 위원 — 거부권 보유");
    expect(html).not.toContain("사유 없음");
    expect(html).not.toContain('<ul class="list-none p-0 m-0 mt-1 pl-2"');
    expect((html.match(/<details[^>]*\sopen/g) ?? []).length).toBe(0);
    expect(renderTranscript({ turns: [turn(1)], participants }, "en")).toContain("Participants (2): ");
    expect(renderTranscript({ turns: [turn(1)] })).not.toContain("committee-issue-participants");
    expect(renderTranscript({ turns: [turn(1)], participants: [[]] })).not.toContain("committee-issue-participants");
  });

  test("no hardcoded colors in the new sources", () => {
    for (const f of [
      "components/CommitteeTurnTranscript.tsx",
      "components/CommitteeProgress.tsx",
      "components/CommitteeMeetingWindow.tsx",
      "lib/committee-progress-view.ts",
    ]) {
      const src = readFileSync(new URL(`${WEB}/${f}`, import.meta.url), "utf8");
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    }
  });
});

describe("turn progress view (page: one status line)", () => {
  test("ONE status line with issue i/n, speaker and turns used, and the view-meeting button; no transcript on the page (ko)", () => {
    const html = renderView({ progress: progress(), turns: [turn(1)], onOpenWindow: () => {} });
    expect(html).toContain("자금 조달 위원 발언 중…");
    expect(html).toContain("(안건 2/4, 발언 7/40회)");
    expect(html).toContain("3분 12초 지남");
    expect(html).toContain('data-testid="committee-open-window"');
    expect(html).toContain(">회의 보기<");
    expect(html).toContain('aria-haspopup="dialog"');
    // the transcript, stepper and statements are in the window, not on the page
    expect(html).not.toContain('data-testid="committee-turn-transcript"');
    expect(html).not.toContain("stage-stepper");
    expect(html).not.toContain("Statement 1.");
    expect(html).not.toContain('role="dialog"'); // never auto-opened
  });

  test("status line (en)", () => {
    const html = renderView({ progress: progress() }, "en");
    expect(html).toContain("Financing seat is speaking…");
    expect(html).toContain("(issue 2/4, turn 7/40)");
  });

  test("polite throttled live region carries the status text; the visible line is not a live region", () => {
    const html = renderView({ progress: progress() });
    const m = html.match(/<p[^>]*data-testid="committee-live-region"[^>]*>([^<]*)<\/p>/);
    expect(m?.[1]).toContain("자금 조달 위원 발언 중…");
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"/);
    expect(html.match(/<p[^>]*data-testid="committee-status-line"[^>]*>/)?.[0]).not.toContain("aria-live");
    expect(count(html, 'aria-live="polite"')).toBe(1); // no per-turn announcements
  });

  test("per-issue consensus and the awaiting call have their own status sentences", () => {
    expect(renderView({ progress: progress({ phase: "consensus", speaker_seat: undefined }) })).toContain(
      "의장이 안건 2의 뜻을 모으는 중…",
    );
    const aw = progress({
      phase: "awaiting_human",
      awaiting: { seat: "human", seq: 9, issue_index: 2, called_at: iso(T0), deadline_at: iso(T0 + 180_000) },
    });
    expect(renderView({ progress: aw })).toContain("사람 위원 발언 대기 중: 사람 위원");
  });

  test("a resumed sitting says where it continues from", () => {
    const html = renderView({ progress: progress({ attempt: 2, resumed_from_issue_index: 2 }) });
    expect(html).toContain("2번째 진행 — 안건 2부터 이어서 진행 중입니다.");
  });

  describe("awaiting_human: the human's turn (page alert)", () => {
    const awaiting = { seat: "human", seq: 9, issue_index: 2, called_at: iso(T0), deadline_at: iso(T0 + 180_000) };
    const aw = progress({ phase: "awaiting_human", awaiting });

    test("a writer gets a prominent your-turn alert with the countdown and a button that opens the window at the input", () => {
      const html = renderView({ progress: aw, canAct: true, onOpenWindow: () => {} }, "ko", T0 + 60_000);
      expect(html).toContain('data-testid="committee-awaiting"');
      expect(html).toContain("meeting-turn-alert");
      expect(html).toContain("내 차례입니다 — 사람 위원 자리에서 발언해 주세요");
      expect(html).toMatch(/status-chip status-info">내 차례</); // text badge, not color alone
      expect(html).toContain("남은 시간 2분 0초");
      expect(html).toContain('data-testid="committee-open-window-input"');
      expect(html).toContain("발언하러 가기");
      expect(html).toContain('data-expired="false"');
      // the form is NOT on the page — it lives in the window
      expect(html).not.toContain("<form");
      // the countdown is plain text, not a live region
      expect(html.match(/<p[^>]*data-testid="committee-awaiting-countdown"[^>]*>/)?.[0]).not.toContain("aria-live");
    });

    test("English", () => {
      const html = renderView({ progress: aw, canAct: true, onOpenWindow: () => {} }, "en", T0 + 60_000);
      expect(html).toContain("Your turn — please speak for the Human member");
      expect(html).toContain("2m 0s left");
      expect(html).toContain("Go to my statement");
    });

    test("past the deadline: an honest note and the resume button replace the open-window button", () => {
      const html = renderView(
        { progress: aw, canAct: true, onResume: () => {}, onOpenWindow: () => {} },
        "ko",
        T0 + 181_000,
      );
      expect(html).toContain('data-expired="true"');
      expect(html).toContain("시간이 지났습니다");
      expect(html).not.toContain('data-testid="committee-open-window-input"');
      expect(html).toContain("회의 이어가기");
    });

    test("a viewer without write access gets no alert: the status line and the plain view button only", () => {
      const html = renderView(
        { progress: aw, canAct: false, onResume: () => {}, onOpenWindow: () => {} },
        "ko",
        T0 + 181_000,
      );
      expect(html).not.toContain('data-testid="committee-awaiting"');
      expect(html).toContain("사람 위원 발언 대기 중: 사람 위원");
      expect(html).toContain('data-testid="committee-open-window"');
      expect(html).not.toContain("회의 이어가기");
    });

    test("an answered floor shows no alert while the meeting resumes", () => {
      const answered = progress({ phase: "awaiting_human", awaiting: { ...awaiting, answered_at: iso(T0 + 30_000) } });
      const html = renderView({ progress: answered, canAct: true }, "ko", T0 + 40_000);
      expect(html).not.toContain('data-testid="committee-awaiting"');
    });
  });

  describe("failed run", () => {
    const failed = progress({
      phase: "failed",
      failed_at: {
        phase: "discussion",
        issue_index: 2,
        seq: 9,
        speaker_seat: "financing-agent",
        error_code: "llm_error",
      },
    });

    test("ONE alert with the stop location, message, code and kept turns, plus the retry button (ko)", () => {
      const html = renderView({
        progress: failed,
        turns: [turn(1), turn(2, { abandoned: true })],
        failureMessage: "모델 응답이 비어 있습니다",
        canAct: true,
        onRetry: () => {},
      });
      expect(count(html, 'role="alert"')).toBe(1);
      const alert = html.match(/<div[^>]*role="alert"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? "";
      expect(alert).toContain("회의가 중간에 멈췄습니다");
      expect(alert).toContain("멈춘 곳 — 토의 · 안건 2/4, 발언 9번째 · 자금 조달 위원");
      expect(alert).toContain("모델 응답이 비어 있습니다");
      expect(alert).toContain("오류 코드 llm_error");
      expect(alert).toContain("끝난 발언 1건은 회의 창에서 볼 수 있습니다"); // the abandoned turn is not counted
      expect(html).toContain("멈춘 안건부터 다시 시작");
      // the live region is empty so the alert is the only announcement
      expect(html.match(/<p[^>]*data-testid="committee-live-region"[^>]*>([^<]*)<\/p>/)?.[1]).toBe("");
      expect(html).not.toContain('data-testid="committee-status-line"');
    });

    test("English, and no retry for a viewer", () => {
      const html = renderView({ progress: failed, canAct: false, onRetry: () => {} }, "en");
      expect(html).toContain("Stopped at — Discussion · Issue 2/4, turn 9 · Financing seat");
      expect(html).not.toContain("Restart from the stopped issue");
    });

    test("a retry in flight says so and is disabled", () => {
      const html = renderView({ progress: failed, canAct: true, onRetry: () => {}, busy: true });
      expect(html).toContain("다시 시작하는 중...");
      expect(html).toMatch(/<button[^>]*disabled[^>]*>다시 시작하는 중/);
    });

    test("a run lost with its process shows the runner_lost explanation instead of the raw message, and keeps the code line", () => {
      const lost = progress({
        phase: "failed",
        failed_at: { phase: "discussion", issue_index: 2, seq: 9, error_code: "runner_lost" },
      });
      const html = renderView({
        progress: lost,
        canAct: true,
        onRetry: () => {},
        failureMessage: "Convening process was lost",
      });
      expect(html).toContain("회의 진행이 도중에 끊겼습니다");
      expect(html).not.toContain("Convening process was lost");
      expect(html).toContain("오류 코드 runner_lost");
    });
  });
});

describe("meeting window (dialog body)", () => {
  const awaiting = { seat: "human", seq: 9, issue_index: 2, called_at: iso(T0), deadline_at: iso(T0 + 180_000) };
  const form = createElement("form", { "data-testid": "the-form" }, "FORM");
  const liveProps = (over: Record<string, unknown> = {}) => ({
    mode: "live",
    progress: progress(),
    turns: [turn(1, { issueIndex: 2, utteranceMd: "Latest words." })],
    titles: ["Scope", "Capex scope"],
    ...over,
  });

  test("a labelled modal dialog: role, aria-modal, labelled by its title; the title names the live meeting", () => {
    const html = renderWindow(liveProps());
    expect(html).toMatch(/role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="([^"]+)"/);
    const id = html.match(/aria-labelledby="([^"]+)"/)?.[1] ?? "";
    expect(html).toContain(`<h2 id="${id}"`);
    expect(html).toContain("회의 창");
    expect(html).toContain('data-testid="committee-window-close"');
    expect(html).toContain("창을 닫아도 회의는 계속됩니다.");
  });

  test("pinned header: stepper with one current step, issue title, current speaker, turns used (ko)", () => {
    const html = renderWindow(liveProps());
    const head = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(count(head, 'aria-current="step"')).toBe(1);
    expect(head).toMatch(/data-step="discussion"[^>]*data-state="current"/);
    expect(head).toContain("안건 2/4: Capex scope");
    expect(head).toContain("발언 중: 자금 조달 위원");
    expect(head).toContain("발언 7/40회");
  });

  test("header (en) and the turn count without a budget", () => {
    const head = renderWindow(liveProps(), "en").match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(head).toContain("Issue 2/4: Capex scope");
    expect(head).toContain("Speaking: Financing seat");
    expect(head).toContain("Turn 7/40");
    const noBudget = renderWindow(liveProps({ progress: progress({ turn_budget: undefined }) }), "en");
    expect(noBudget).toContain("Turn 7");
  });

  test("the transcript sits in a labelled, keyboard-reachable scroll region that is NOT a live region", () => {
    const html = renderWindow(liveProps());
    const scroll = html.match(/<section[^>]*data-testid="committee-window-scroll"[^>]*>/)?.[0] ?? "";
    expect(scroll).toContain("aria-label=");
    expect(scroll).toContain('tabindex="0"');
    expect(scroll).toContain('data-following="true"'); // a live window starts following the newest turn
    expect(scroll).not.toContain("aria-live");
    expect(html).not.toContain("aria-live"); // no announcements from inside the window
    expect(html).toContain("Latest words.");
    // no jump button while following
    expect(html).not.toContain('data-testid="committee-jump-latest"');
  });

  test("open human floor: the statement form is in the pinned footer for a writer; a viewer gets the read-only line", () => {
    const aw = progress({ phase: "awaiting_human", awaiting });
    const writer = renderWindow(liveProps({ progress: aw, canAct: true, humanForm: form }), "ko", T0 + 60_000);
    const foot = writer.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";
    expect(foot).toContain('data-testid="the-form"');
    expect(foot).toContain('data-testid="committee-awaiting-form"');
    expect(foot).toContain("남은 시간 2분 0초");
    expect(writer).toContain("발언 중: 사람 위원");
    const viewer = renderWindow(liveProps({ progress: aw, canAct: false, humanForm: form }), "ko", T0 + 60_000);
    expect(viewer).not.toContain('data-testid="the-form"');
    expect(viewer).toContain("발언은 분석가 이상 권한으로 제출할 수 있습니다.");
  });

  test("past the deadline or answered: no form, the resume button for a writer", () => {
    const aw = progress({ phase: "awaiting_human", awaiting });
    const expired = renderWindow(
      liveProps({ progress: aw, canAct: true, humanForm: form, onResume: () => {} }),
      "ko",
      T0 + 181_000,
    );
    expect(expired).not.toContain('data-testid="the-form"');
    expect(expired).toContain("회의 이어가기");
    const answered = progress({ phase: "awaiting_human", awaiting: { ...awaiting, answered_at: iso(T0 + 30_000) } });
    expect(
      renderWindow(liveProps({ progress: answered, canAct: true, humanForm: form }), "ko", T0 + 40_000),
    ).not.toContain('data-testid="the-form"');
  });

  test("failed run: the stop location and the retry button are in the footer, no second role=alert", () => {
    const failed = progress({
      phase: "failed",
      failed_at: {
        phase: "discussion",
        issue_index: 2,
        seq: 9,
        speaker_seat: "financing-agent",
        error_code: "llm_error",
      },
    });
    const html = renderWindow(
      liveProps({ progress: failed, canAct: true, onRetry: () => {}, failureMessage: "empty reply" }),
    );
    const foot = html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";
    expect(foot).toContain("멈춘 곳 — 토의 · 안건 2/4, 발언 9번째 · 자금 조달 위원");
    expect(foot).toContain("empty reply");
    expect(foot).toContain("멈춘 안건부터 다시 시작");
    expect(html).not.toContain('role="alert"'); // the page owns the alert
    expect(html).toMatch(/data-step="discussion"[^>]*data-state="failed"/);
  });

  test("failed run lost with its process: the window footer shows the runner_lost explanation, not the raw message", () => {
    const lost = progress({
      phase: "failed",
      failed_at: { phase: "discussion", issue_index: 2, seq: 9, error_code: "runner_lost" },
    });
    const html = renderWindow(
      liveProps({ progress: lost, canAct: true, onRetry: () => {}, failureMessage: "Convening process was lost" }),
    );
    const foot = html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";
    expect(foot).toContain("회의 진행이 도중에 끊겼습니다");
    expect(foot).not.toContain("Convening process was lost");
  });

  test("record mode: the finished session's full transcript, no stepper, no footer, no follow, participants shown", () => {
    const html = renderWindow({
      mode: "record",
      turns: [turn(1), turn(2, { issueIndex: 2 })],
      titles: ["Scope", "Capex"],
      participants: [[{ seat: "risk-officer", label: null, reason: "veto seat" }], []],
    });
    expect(html).toContain('data-mode="record"');
    expect(html).toContain("회의 기록");
    expect(html).not.toContain("회의 창");
    expect(html).not.toContain("창을 닫아도 회의는 계속됩니다");
    expect(html).not.toContain("stage-stepper");
    expect(html).not.toContain("<footer");
    expect(html).toContain("토의 기록 2건");
    expect(html).toContain("안건 1. Scope");
    expect(html).toContain("안건 2. Capex");
    expect(html).toContain("veto seat");
    expect(html).toContain('data-following="false"');
    expect(html).not.toContain('data-testid="committee-jump-latest"');
  });
});

describe("panel and window wiring (design §16.5)", () => {
  const panel = normSrc(readFileSync(new URL(`${WEB}/components/CommitteePanel.tsx`, import.meta.url), "utf8"));
  const win = normSrc(readFileSync(new URL(`${WEB}/components/CommitteeMeetingWindow.tsx`, import.meta.url), "utf8"));

  test("the window is opt-in: state starts closed and only the buttons open it", () => {
    expect(panel).toContain(normSrc("useState<MeetingWindowState | null>(null)"));
    expect(panel).toContain(normSrc("onOpenWindow={setMeetingWindow}"));
    expect(panel).toContain(normSrc("setMeetingWindow({ focusInput: false, recordFor: sessionId })"));
    expect(panel).toContain(normSrc("{meetingWindow && windowProps && <CommitteeMeetingWindow"));
  });

  test("closing the window only clears window state — it never touches the watch", () => {
    expect(panel).toContain(normSrc("const closeMeetingWindow = () => setMeetingWindow(null);"));
  });

  test("the window uses the shared modal focus trap (Esc, Tab trap, focus return) and aria-modal", () => {
    expect(win).toContain(normSrc("useModalFocus(onClose)"));
    expect(win).toContain(normSrc('aria-modal="true"'));
    expect(win).toContain(normSrc("onKeyDown={onKeyDown}"));
    expect(win).toContain(normSrc("createPortal("));
  });

  test("the statement form keeps its state in the panel and is rendered inside the window", () => {
    expect(panel).toContain(normSrc("humanForm,"));
    expect(win).toContain("humanForm");
  });
});

describe("panel wiring and catalogs", () => {
  const panel = normSrc(readFileSync(new URL(`${WEB}/components/CommitteePanel.tsx`, import.meta.url), "utf8"));

  test("the poll streams turns by cursor, pages while hasMoreTurns, resets on a new sitting", () => {
    expect(panel).toContain(normSrc("buildTurnPollUrl(listUrl, sessionId, afterSeq)"));
    expect(panel).toContain(normSrc("mergeTurns(heldTurns, s.turns ?? [])"));
    expect(panel).toContain(normSrc("if (!s.hasMoreTurns) break;"));
    expect(panel).toContain(normSrc("turnsNeedReset(seenAttempt, attemptOf(s.progress))"));
    expect(panel).toContain(normSrc("MAX_TURN_PAGES_PER_TICK"));
  });

  test("round sessions keep the phase-1 path: plain list URL, setLive, ONE poll timer", () => {
    expect(panel).toContain(normSrc("let turnCursor: number | null = null;"));
    expect(panel).toContain(normSrc("setLive({ progress, positions: s.positions ?? [] })"));
    expect(panel.split(normSrc("setTimeout(resolve, CONVENING_POLL_MS)")).length - 1).toBe(1);
  });

  test("a paused meeting is not settled, the deadline pauses, the human deadline advances once", () => {
    expect(panel).toContain(normSrc("if (s && !s.convening && !s.awaiting)"));
    expect(panel).toContain(normSrc("nextDeadlinePause(pause, pausedNow, Date.now())"));
    expect(panel).toContain(normSrc("convenDeadlineReached(deadline, pause, pausedNow, Date.now())"));
    expect(panel).toContain(normSrc("shouldAdvanceAwaiting(s.awaiting, Date.now(), advancedSeq)"));
    expect(panel).toContain(normSrc('err.code === "awaiting_human"'));
  });

  test("a failed turn meeting is re-attached on mount and retried through advance", () => {
    expect(panel).toContain(normSrc("pickFailedTurnSession(list)"));
    expect(panel).toContain(normSrc("onRetry={() => void driveTurnMeeting()}"));
    expect(panel).toContain(normSrc("/advance`"));
  });

  test("the human turn posts to positions and does not depend on the watch's busy flag", () => {
    expect(panel).toContain(normSrc("{ positionMd: position.text, recommendation: position.recommendation }"));
    expect(panel).toContain(normSrc("disabled={turnBusy || !position.text.trim()}"));
  });

  test("finished turn sessions render the turn transcript instead of the rounds list", () => {
    expect(panel).toContain(normSrc('transcript.engine === "turns" && turnLive?.sessionId !== transcript.sessionId'));
    expect(panel).toContain(normSrc('data-testid="committee-open-record"'));
    expect(panel).toContain(normSrc('transcript.engine !== "turns" && ('));
  });

  test("ko and en carry the same turns keys, and every move has a label", () => {
    const keysOf = (o: unknown, prefix = ""): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
        typeof v === "object" && v !== null ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`],
      );
    const turnsOf = (cat: Record<string, unknown>) =>
      (cat.common as { committee: { turns: Record<string, unknown> } }).committee.turns;
    expect(keysOf(turnsOf(ko)).sort()).toEqual(keysOf(turnsOf(en)).sort());
    const moves = [
      "propose",
      "ask",
      "answer",
      "rebut",
      "concede",
      "amend",
      "pass",
      "accept",
      "reserve",
      "open",
      "call",
      "propose_consensus",
      "close",
      "resume",
      "pass_on_behalf",
      "speak",
      "request_floor",
      "grant_floor",
      "decline_floor",
    ];
    for (const cat of [ko, en]) {
      const m = turnsOf(cat).move as Record<string, string>;
      for (const move of moves) expect(m[move]).toBeTruthy();
      const r = turnsOf(cat).reason as Record<string, string>;
      for (const reason of [
        "budget",
        "consensus_failed",
        "human_timeout",
        "human_wait_cap",
        "resume",
        "floor_granted",
        "floor_limit",
        "turn_cap",
        "mentioned",
      ]) {
        expect(r[reason]).toBeTruthy();
      }
    }
  });
});

describe("session history rows (소집 이력, 2026-11-20 UI revision)", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    sessionId: "s-1",
    status: "done",
    startedAt: iso(T0),
    convening: false,
    engine: "turns" as const,
    meta: { committee_key: "pre_fs_committee", gate: "pre_fs", synthesized: true },
    progress: { phase: "done", updated_at: iso(T0 + 190_000) },
    ...over,
  });

  test("committeeKeyLabel: readable words for a registry-less key", () => {
    expect(view.committeeKeyLabel("pre_fs_committee")).toBe("Pre Fs Committee");
    expect(view.committeeKeyLabel("route-decision")).toBe("Route Decision");
    expect(view.committeeKeyLabel("")).toBe("");
  });

  test("sessionFinished: synthesized / done phase / done status count; convening and failures do not", () => {
    expect(view.sessionFinished(row())).toBe(true);
    expect(view.sessionFinished(row({ meta: { committee_key: "c", gate: "pre_fs" }, status: "done" }))).toBe(true);
    expect(
      view.sessionFinished(
        row({
          meta: { committee_key: "c", gate: "pre_fs", synthesized: false },
          status: "failed",
          progress: { phase: "failed", updated_at: iso(T0) },
        }),
      ),
    ).toBe(false);
    expect(view.sessionFinished(row({ convening: true }))).toBe(false);
    expect(
      view.sessionFinished(
        row({
          meta: { committee_key: "c", gate: "pre_fs", synthesized: false },
          progress: { phase: "done", updated_at: iso(T0) },
        }),
      ),
    ).toBe(true);
  });

  test("sessionDurationSeconds: finished only, progress write minus start, floored seconds; null on missing data", () => {
    expect(view.sessionDurationSeconds(row())).toBe(190);
    expect(view.sessionDurationSeconds(row({ progress: { phase: "done", updated_at: iso(T0 + 1999) } }))).toBe(1);
    expect(view.sessionDurationSeconds(row({ convening: true }))).toBeNull();
    expect(view.sessionDurationSeconds(row({ progress: {} }))).toBeNull();
    expect(view.sessionDurationSeconds(row({ startedAt: "not-a-date" }))).toBeNull();
  });

  test("sessionDurationSeconds: resumed meeting sums sittings; runner_lost sitting ends at its last heartbeat, not the reap time", () => {
    const beat = iso(T0 + 82_000); // 1m22s into the first sitting
    const reaped = iso(T0 + 14 * 60_000); // reap long after the process died
    const resumed = T0 + 14 * 60_000 + 20_000;
    const lost = {
      started_at: iso(T0),
      ended_at: reaped,
      stopped_at: { error_code: "runner_lost" },
      error: `The meeting process was lost (no heartbeat since ${beat}); the server was probably restarted.`,
    };
    const r = row({
      meta: {
        committee_key: "c",
        synthesized: true,
        attempts: [lost, { started_at: iso(resumed) }],
      },
      progress: { phase: "done", updated_at: iso(resumed + 266_000) },
    });
    expect(view.sessionDurationSeconds(r)).toBe(82 + 266);

    // Unparseable runner_lost message falls back to ended_at.
    const noBeat = row({
      meta: {
        committee_key: "c",
        synthesized: true,
        attempts: [{ ...lost, error: "lost" }, { started_at: iso(resumed) }],
      },
      progress: { phase: "done", updated_at: iso(resumed + 10_000) },
    });
    expect(view.sessionDurationSeconds(noBeat)).toBe(14 * 60 + 10);

    // A non-runner_lost stop ends at ended_at; the heartbeat text is ignored.
    const failed = row({
      meta: {
        committee_key: "c",
        synthesized: true,
        attempts: [
          {
            started_at: iso(T0),
            ended_at: iso(T0 + 30_000),
            stopped_at: { error_code: "llm_timeout" },
            error: `no heartbeat since ${beat}`,
          },
          { started_at: iso(T0 + 600_000) },
        ],
      },
      progress: { phase: "done", updated_at: iso(T0 + 645_000) },
    });
    expect(view.sessionDurationSeconds(failed)).toBe(30 + 45);

    // Single-attempt sessions are unchanged by an attempts array of one.
    const one = row({ meta: { committee_key: "c", synthesized: true, attempts: [{ started_at: iso(T0) }] } });
    expect(view.sessionDurationSeconds(one)).toBe(190);

    // A stopped sitting with no end at all makes the total unknowable.
    const open = row({
      meta: {
        committee_key: "c",
        synthesized: true,
        attempts: [{ started_at: iso(T0) }, { started_at: iso(T0 + 1000) }],
      },
    });
    expect(view.sessionDurationSeconds(open)).toBeNull();
  });
});
