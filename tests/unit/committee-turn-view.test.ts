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
    expect(html).toContain("<h4");
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

  test("empty transcript is an honest line; finished sessions can be collapsed", () => {
    expect(renderTranscript({ turns: [] })).toContain("아직 오간 발언이 없습니다.");
    const collapsed = renderTranscript({ turns: [turn(1)], collapsible: true });
    expect(collapsed).toMatch(/^<details/);
    expect((collapsed.match(/<details[^>]*\sopen/g) ?? []).length).toBe(0);
  });

  test("no hardcoded colors in the new sources", () => {
    for (const f of [
      "components/CommitteeTurnTranscript.tsx",
      "components/CommitteeProgress.tsx",
      "lib/committee-progress-view.ts",
    ]) {
      const src = readFileSync(new URL(`${WEB}/${f}`, import.meta.url), "utf8");
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    }
  });
});

describe("turn progress view", () => {
  test("stepper with one aria-current step, status line with issue i/n, speaker and turn count (ko)", () => {
    const html = renderView({ progress: progress(), turns: [turn(1)] });
    expect(count(html, 'aria-current="step"')).toBe(1);
    expect(html).toMatch(/data-step="discussion"[^>]*data-state="current"/);
    expect(html).toContain("자금 조달 위원 발언 중…");
    expect(html).toContain("(안건 2/4, 발언 7/40회)");
    expect(html).toContain("안건 2/4: Capex scope");
    expect(html).toContain("3분 12초 지남");
    expect(html).toContain("토의 기록 1건");
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

  describe("awaiting_human: the human's turn", () => {
    const awaiting = { seat: "human", seq: 9, issue_index: 2, called_at: iso(T0), deadline_at: iso(T0 + 180_000) };
    const aw = progress({ phase: "awaiting_human", awaiting });
    const form = createElement("form", { "data-testid": "the-form" }, "FORM");

    test("a writer gets the your-turn title, a countdown to the deadline and the form slot", () => {
      const html = renderView({ progress: aw, canAct: true, humanForm: form }, "ko", T0 + 60_000);
      expect(html).toContain('data-testid="committee-awaiting"');
      expect(html).toContain("내 차례입니다 — 사람 위원 자리에서 발언해 주세요");
      expect(html).toContain("남은 시간 2분 0초");
      expect(html).toContain('data-testid="the-form"');
      expect(html).toContain('data-expired="false"');
      // the countdown is plain text, not a live region
      expect(html.match(/<p[^>]*data-testid="committee-awaiting-countdown"[^>]*>/)?.[0]).not.toContain("aria-live");
    });

    test("English", () => {
      const html = renderView({ progress: aw, canAct: true, humanForm: form }, "en", T0 + 60_000);
      expect(html).toContain("Your turn — please speak for the Human member");
      expect(html).toContain("2m 0s left");
    });

    test("past the deadline: the form goes, an honest note and the resume button appear", () => {
      const html = renderView({ progress: aw, canAct: true, humanForm: form, onResume: () => {} }, "ko", T0 + 181_000);
      expect(html).toContain('data-expired="true"');
      expect(html).toContain("시간이 지났습니다");
      expect(html).not.toContain('data-testid="the-form"');
      expect(html).toContain("회의 이어가기");
    });

    test("a viewer without write access sees the read-only line, no form and no buttons", () => {
      const html = renderView({ progress: aw, canAct: false, humanForm: form, onResume: () => {} }, "ko", T0 + 181_000);
      expect(html).toContain("사람 위원 발언 대기 — 사람 위원");
      expect(html).toContain("발언은 분석가 이상 권한으로 제출할 수 있습니다.");
      expect(html).not.toContain('data-testid="the-form"');
      expect(html).not.toContain("회의 이어가기");
    });

    test("an answered floor hides the form while the meeting resumes", () => {
      const answered = progress({ phase: "awaiting_human", awaiting: { ...awaiting, answered_at: iso(T0 + 30_000) } });
      const html = renderView({ progress: answered, canAct: true, humanForm: form }, "ko", T0 + 40_000);
      expect(html).not.toContain('data-testid="the-form"');
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
      expect(alert).toContain("끝난 발언 1건은 아래에 남아 있습니다"); // the abandoned turn is not counted
      expect(html).toContain("멈춘 안건부터 다시 시작");
      expect(html).toMatch(/data-step="discussion"[^>]*data-state="failed"/);
      expect(count(html, 'aria-current="step"')).toBe(0);
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
    ];
    for (const cat of [ko, en]) {
      const m = turnsOf(cat).move as Record<string, string>;
      for (const move of moves) expect(m[move]).toBeTruthy();
      const r = turnsOf(cat).reason as Record<string, string>;
      for (const reason of ["budget", "consensus_failed", "human_timeout", "human_wait_cap", "resume"]) {
        expect(r[reason]).toBeTruthy();
      }
    }
  });
});
