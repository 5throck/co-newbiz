// @version 1.0.0
/**
 * Committee live progress UI, phase 1 (design 2026-11-20 §4.8/§8, ADR-0204):
 *
 *   - stepper state mapping for every phase of the round engine, incl. the
 *     agenda pass sitting between round 1 and round 2, a 1-round committee
 *     (agenda skipped), and a failed run;
 *   - the rendered view: ordered list, exactly one aria-current="step", an
 *     icon + text state on every step (never color alone), the status line
 *     naming the speaker, finished positions collapsed by default with the
 *     position-meta footnote stripped, ko and en;
 *   - the failure display: ONE role="alert" carrying where the run stopped
 *     (phase / round / seat) and the message, the kept positions, and an empty
 *     live region so the alert is the only announcement;
 *   - the polite live region (role="status", aria-live="polite") carries the
 *     status text, and the throttle rule allows one announcement per 10 s;
 *   - the panel is wired to the view and polls every 3 s;
 *   - the new ko/en catalog keys exist in both locales and every known seat
 *     has a display name.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { LivePosition, MeetingProgress } from "../../app/web-next/lib/committee-progress.ts";
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
const { CommitteeProgressView } = (await import(`${WEB}/components/CommitteeProgress.tsx`)) as {
  CommitteeProgressView: unknown;
};
const view = await import(`${WEB}/lib/committee-progress-view.ts`);
const { COMMITTEE_SEAT_LABEL_KEY } = await import(`${WEB}/lib/label-keys.ts`);

const T0 = Date.parse("2026-11-20T10:00:00.000Z");

const progress = (over: Partial<MeetingProgress> = {}): MeetingProgress => ({
  engine: "rounds",
  phase: "discussion",
  round: 2,
  round_count: 3,
  speaker_seat: "financing-agent",
  turn_count: 5,
  turn_budget: 12,
  started_at: new Date(T0).toISOString(),
  updated_at: new Date(T0 + 1000).toISOString(),
  ...over,
});

const pos = (n: number, over: Partial<LivePosition> = {}): LivePosition => ({
  positionId: `pos-${n}`,
  round: 1,
  memberType: "agent",
  agentKey: "risk-officer",
  humanUserId: null,
  positionMd: `Seat statement ${n}.\n<!--position-meta:{"recommendation":"hold","confidence":0.7}-->`,
  confidence: 0.7,
  createdAt: new Date(T0).toISOString(),
  ...over,
});

const render = (
  props: { progress: MeetingProgress; positions?: LivePosition[]; failureMessage?: string | null },
  locale: "ko" | "en" = "ko",
  nowMs = T0 + 192_000, // 3 min 12 s after start
) =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" },
      createElement(CommitteeProgressView, { positions: [], ...props, nowMs }),
    ),
  );

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("stepStates (round engine -> four steps)", () => {
  test("round 1 discussion: agenda still to do, discussion current", () => {
    const s = view.stepStates(progress({ round: 1, speaker_seat: undefined }));
    expect(s).toEqual({ agenda: "todo", discussion: "current", consensus: "todo", minutes: "todo" });
  });

  test("agenda pass: agenda current, discussion waits for the next round", () => {
    const s = view.stepStates(progress({ phase: "agenda", round: 1, speaker_seat: undefined }));
    expect(s.agenda).toBe("current");
    expect(s.discussion).toBe("todo");
  });

  test("round 2+ discussion: agenda done, discussion current", () => {
    const s = view.stepStates(progress({ round: 2 }));
    expect(s.agenda).toBe("done");
    expect(s.discussion).toBe("current");
  });

  test("consensus and minutes phases mark the earlier steps done", () => {
    expect(view.stepStates(progress({ phase: "consensus" }))).toEqual({
      agenda: "done",
      discussion: "done",
      consensus: "current",
      minutes: "todo",
    });
    expect(view.stepStates(progress({ phase: "minutes" }))).toEqual({
      agenda: "done",
      discussion: "done",
      consensus: "done",
      minutes: "current",
    });
  });

  test("a 1-round committee has no agenda pass: the step is skipped, never current", () => {
    const s = view.stepStates(progress({ round_count: 1, round: 1 }));
    expect(s.agenda).toBe("skipped");
    expect(view.stepStates(progress({ round_count: 1, phase: "done" })).agenda).toBe("skipped");
  });

  test("done: every applicable step done, no current step", () => {
    const p = progress({ phase: "done" });
    expect(Object.values(view.stepStates(p))).toEqual(["done", "done", "done", "done"]);
    expect(view.currentStep(p)).toBeNull();
  });

  test("failed: the stop step is failed, earlier steps done, later steps to do", () => {
    const p = progress({
      phase: "failed",
      failed_at: { phase: "discussion", round: 2, speaker_seat: "financing-agent", error_code: "llm_error" },
    });
    expect(view.stepStates(p)).toEqual({ agenda: "done", discussion: "failed", consensus: "todo", minutes: "todo" });
    expect(view.currentStep(p)).toBeNull();
  });

  test("failed in round 1: agenda was not reached yet", () => {
    const p = progress({
      phase: "failed",
      round: 1,
      failed_at: { phase: "discussion", round: 1, error_code: "llm_error" },
    });
    expect(view.stepStates(p).agenda).toBe("todo");
  });
});

describe("elapsed time and the announcement throttle", () => {
  test("elapsed seconds clamp at 0 and survive a bad date", () => {
    expect(view.elapsedSeconds(new Date(T0).toISOString(), T0 + 192_000)).toBe(192);
    expect(view.elapsedSeconds(new Date(T0).toISOString(), T0 - 5000)).toBe(0);
    expect(view.elapsedSeconds("not-a-date", T0)).toBe(0);
    expect(view.splitElapsed(192)).toEqual({ minutes: 3, seconds: 12 });
  });

  test("at most one announcement per 10 s", () => {
    expect(view.ANNOUNCE_THROTTLE_MS).toBe(10_000);
    expect(view.throttleDecision(0, 4_000)).toEqual({ emitNow: false, waitMs: 6_000 });
    expect(view.throttleDecision(0, 10_000)).toEqual({ emitNow: true, waitMs: 0 });
    expect(view.throttleDecision(0, 25_000).emitNow).toBe(true);
  });

  test("the poll interval while convening is 3 s", () => {
    expect(view.CONVENING_POLL_MS).toBe(3000);
  });
});

describe("mount-resume decision (pickResumableSession)", () => {
  const item = (id: string, over: Record<string, unknown> = {}) => ({
    sessionId: id,
    startedAt: new Date(T0).toISOString(),
    convening: true,
    progress: null,
    ...over,
  });

  test("nothing convening -> nothing to resume", () => {
    expect(view.pickResumableSession([], T0)).toBeNull();
    expect(
      view.pickResumableSession([item("a", { convening: false }), item("b", { convening: undefined })], T0),
    ).toBeNull();
  });

  test("a convening session is resumed and its deadline anchor is its own start, not now", () => {
    const got = view.pickResumableSession([item("a")], T0 + 5 * 60_000);
    expect(got).toEqual({ sessionId: "a", startedAtMs: T0 });
    // the deadline the panel derives: start + 10 min (5 min left at mount, not 10)
    expect(got.startedAtMs + view.CONVENING_DEADLINE_MS - (T0 + 5 * 60_000)).toBe(5 * 60_000);
  });

  test("the most recently started convening session wins; finished ones are ignored", () => {
    const got = view.pickResumableSession(
      [
        item("old", { startedAt: new Date(T0 - 60_000).toISOString() }),
        item("new", { startedAt: new Date(T0 + 60_000).toISOString() }),
        item("done", { convening: false, startedAt: new Date(T0 + 120_000).toISOString() }),
      ],
      T0 + 180_000,
    );
    expect(got?.sessionId).toBe("new");
  });

  test("falls back to progress.started_at, then to now, when startedAt does not parse", () => {
    const p = new Date(T0 + 1000).toISOString();
    expect(
      view.pickResumableSession([item("a", { startedAt: "x", progress: { started_at: p } })], T0 + 9)?.startedAtMs,
    ).toBe(T0 + 1000);
    expect(view.pickResumableSession([item("a", { startedAt: "x" })], T0 + 9)?.startedAtMs).toBe(T0 + 9);
  });

  test("a session already past its deadline is still returned (the poll then reports the timeout)", () => {
    const got = view.pickResumableSession([item("a")], T0 + view.CONVENING_DEADLINE_MS + 1);
    expect(got?.sessionId).toBe("a");
    expect(view.CONVENING_DEADLINE_MS).toBe(600_000);
  });
});

describe("CommitteeProgressView render", () => {
  test("discussion: ordered stepper, one aria-current, icon + text state on every step", () => {
    const html = render({ progress: progress() });
    expect(html).toContain("<ol");
    expect(count(html, 'aria-current="step"')).toBe(1);
    expect(html).toMatch(
      /aria-current="step"[^>]*data-step="discussion"|data-step="discussion"[^>]*aria-current="step"/,
    );
    // text state per step (ko)
    expect(html).toContain("안건 정리");
    expect(html).toContain("토의");
    expect(html).toContain("합의");
    expect(html).toContain("회의록");
    expect(html).toContain("끝남"); // agenda done in round 2
    expect(html).toContain("진행 중");
    expect(html).toContain("남음");
    // one decorative icon per step (aria-hidden svg) next to the text, plus the clock icon
    expect(count(html, "<svg")).toBeGreaterThanOrEqual(4);
    expect(count(html, 'aria-hidden="true"')).toBeGreaterThanOrEqual(4);
  });

  test("status line names the speaker seat, round, statement count and elapsed time (ko)", () => {
    const html = render({ progress: progress() });
    expect(html).toContain("자금 조달 위원 발언 중…");
    expect(html).toContain("(라운드 2/3, 발언 5/12)");
    expect(html).toContain("3분 12초 지남");
  });

  test("status line (en)", () => {
    const html = render({ progress: progress() }, "en");
    expect(html).toContain("Financing seat is speaking…");
    expect(html).toContain("(round 2/3, statement 5/12)");
    expect(html).toContain("3m 12s elapsed");
    expect(html).toContain("Agenda");
    expect(html).toContain("In progress");
  });

  test("elapsed under a minute drops the minutes", () => {
    const html = render({ progress: progress() }, "ko", T0 + 42_000);
    expect(html).toContain("42초 지남");
    expect(html).not.toContain("분");
  });

  test("an unknown seat key renders raw rather than a missing-message", () => {
    const html = render({ progress: progress({ speaker_seat: "future-seat" }) });
    expect(html).toContain("future-seat 발언 중…");
  });

  test("polite live region carries the status text without the elapsed time", () => {
    const html = render({ progress: progress() });
    const m = html.match(/<p[^>]*data-testid="committee-live-region"[^>]*>([^<]*)<\/p>/);
    expect(m).not.toBeNull();
    const tag = html.match(/<p[^>]*data-testid="committee-live-region"[^>]*>/)?.[0] ?? "";
    expect(tag).toContain('role="status"');
    expect(tag).toContain('aria-live="polite"');
    expect(m?.[1]).toContain("자금 조달 위원 발언 중…");
    expect(m?.[1]).not.toContain("지남");
  });

  test("chair phases have their own status text", () => {
    expect(render({ progress: progress({ phase: "agenda", speaker_seat: undefined }) })).toContain(
      "의장이 안건을 정리하는 중…",
    );
    expect(render({ progress: progress({ phase: "consensus", speaker_seat: undefined }) })).toContain(
      "의장이 위원 의견을 모아 제안을 만드는 중…",
    );
    expect(render({ progress: progress({ phase: "minutes", speaker_seat: undefined }) })).toContain(
      "의장이 회의록을 쓰는 중…",
    );
    expect(render({ progress: progress({ round: 1, speaker_seat: undefined, turn_count: 0 }) })).toContain(
      "회의를 시작하는 중…",
    );
  });

  test("finished positions: grouped by round (current round open), items collapsed, meta footnote stripped", () => {
    const html = render({
      progress: progress(),
      positions: [pos(1), pos(2, { round: 2, agentKey: "financing-agent" })],
    });
    // 2 round groups + 2 positions; only the current round's group (round 2) is open.
    expect(count(html, "<details")).toBe(4);
    expect((html.match(/<details[^>]*\sopen/g) ?? []).length).toBe(1);
    expect(html).toContain("끝난 발언 2건");
    expect(html).toContain("라운드 1 · 발언 1/4");
    expect(html).toContain("라운드 2 · 발언 1/4");
    expect(html.indexOf("라운드 1 · 발언")).toBeLessThan(html.indexOf("라운드 2 · 발언"));
    expect(html).toContain("위험 점검 위원");
    expect(html).toContain("자금 조달 위원");
    expect(html).toContain("Seat statement 1.");
    expect(html).not.toContain("position-meta");
    expect(html).toContain("신뢰도 0.7");
  });

  test("no finished positions yet: an honest empty line", () => {
    expect(render({ progress: progress({ turn_count: 0 }), positions: [] })).toContain("아직 끝난 발언이 없습니다.");
  });

  test("no hardcoded colors in the new view sources", () => {
    for (const f of ["components/CommitteeProgress.tsx", "lib/committee-progress-view.ts"]) {
      const src = readFileSync(new URL(`${WEB}/${f}`, import.meta.url), "utf8");
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    }
  });
});

describe("failure display", () => {
  const failedProgress = (over: Partial<MeetingProgress> = {}) =>
    progress({
      phase: "failed",
      failed_at: { phase: "discussion", round: 2, speaker_seat: "financing-agent", error_code: "llm_error" },
      ...over,
    });

  test("one role=alert with the stop location, the message, the code and the kept statements (ko)", () => {
    const html = render({
      progress: failedProgress(),
      positions: [pos(1), pos(2)],
      failureMessage: "모델 응답이 비어 있습니다",
    });
    expect(count(html, 'role="alert"')).toBe(1);
    const alert = html.match(/<div[^>]*role="alert"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(alert).toContain("회의가 중간에 멈췄습니다");
    expect(alert).toContain("멈춘 곳 — 토의 · 라운드 2 · 자금 조달 위원");
    expect(alert).toContain("모델 응답이 비어 있습니다");
    expect(alert).toContain("오류 코드 llm_error");
    expect(alert).toContain("끝난 발언 2건은 아래에 남아 있습니다");
  });

  test("failure (en) and the failed step reads Stopped with an icon", () => {
    const html = render({ progress: failedProgress(), failureMessage: "empty reply" }, "en");
    expect(html).toContain("Stopped at — Discussion · Round 2 · Financing seat");
    expect(html).toContain("Stopped");
    expect(html).toMatch(/data-step="discussion"[^>]*data-state="failed"/);
  });

  test("the kept positions stay listed and the live region is empty (the alert is the only announcement)", () => {
    const html = render({ progress: failedProgress(), positions: [pos(1)] });
    expect(count(html, "<details")).toBe(2); // one round group + its position
    const m = html.match(/<p[^>]*data-testid="committee-live-region"[^>]*>([^<]*)<\/p>/);
    expect(m?.[1]).toBe("");
    expect(html).not.toContain('data-testid="committee-status-line"');
    expect(count(html, 'aria-current="step"')).toBe(0);
  });

  test("a chair-phase failure names the phase without round or seat", () => {
    const html = render({
      progress: progress({
        phase: "failed",
        speaker_seat: undefined,
        failed_at: { phase: "minutes", error_code: "llm_error" },
      }),
    });
    expect(html).toContain("멈춘 곳 — 회의록");
    expect(html).not.toContain("라운드 2 ·");
  });
});

describe("panel wiring and catalogs", () => {
  const panel = normSrc(readFileSync(new URL(`${WEB}/components/CommitteePanel.tsx`, import.meta.url), "utf8"));

  test("the panel renders the live view from the poll and polls at CONVENING_POLL_MS", () => {
    expect(panel).toContain(normSrc("<CommitteeProgressView"));
    expect(panel).toContain(normSrc("setTimeout(resolve, CONVENING_POLL_MS)"));
    expect(panel).not.toContain(normSrc("setTimeout(resolve, 5000)"));
    expect(panel).toContain(normSrc("setLive({ progress, positions: s.positions ?? [] })"));
  });

  test("the click handler and the mount path share ONE poll (watchConvening), guarded to a single timer and cancelled on cleanup", () => {
    expect(panel).toContain(normSrc("await watchConvening(r.data.sessionId, Date.now(), false)"));
    expect(panel).toContain(normSrc("await watchConvening(target.sessionId, target.startedAtMs, true)"));
    expect(panel).toContain(normSrc("pickResumableSession(list, Date.now())"));
    expect(panel).toContain(normSrc("if (watchRef.current) return;"));
    expect(panel).toContain(normSrc("w.cancelled = true"));
    expect(panel).toContain(normSrc("clearTimeout(w.timer)"));
    // the deadline counts from the session start passed in, never from "now" inside the poll
    expect(panel).toContain(normSrc("const deadline = startedAtMs + CONVENING_DEADLINE_MS"));
    expect(count(panel, normSrc("setTimeout(resolve, CONVENING_POLL_MS)"))).toBe(1);
  });

  test("a failure with a stop location goes through the live view's single alert, not a second one", () => {
    expect(panel).toContain(normSrc("if (stopLocated) setLive("));
    expect(panel).toContain(normSrc("else setError(message)"));
  });

  test("ko/en carry the same progress and seat keys; every known seat has a name", () => {
    const keysOf = (o: unknown, prefix = ""): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
        typeof v === "object" && v !== null ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`],
      );
    const pick = (cat: Record<string, unknown>) => {
      const committee = (cat.common as { committee: Record<string, unknown> }).committee;
      return keysOf({ progress: committee.progress, seat: committee.seat }).sort();
    };
    expect(pick(ko)).toEqual(pick(en));
    const seatKo = (ko.common as { committee: { seat: Record<string, string> } }).committee.seat;
    for (const key of Object.keys(COMMITTEE_SEAT_LABEL_KEY)) {
      expect(seatKo[key]).toBeTruthy();
      expect(COMMITTEE_SEAT_LABEL_KEY[key]).toBe(`common.committee.seat.${key}`);
    }
  });
});

describe("meeting stepper stays visible on narrow screens", () => {
  test("the stepper carries its own modifier and the css overrides the <880px hide", () => {
    const html = render({ progress: progress() });
    expect(html).toContain("meeting-stepper");
    const css = readFileSync(new URL(`${WEB}/app/styles.css`, import.meta.url), "utf8");
    // Specificity (two classes) beats the bare `.stage-stepper { display: none }` below 880px
    // and the nowrap/scroll rule of the page stage rail.
    expect(css).toMatch(/\.stage-stepper\.meeting-stepper\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/);
  });
});

describe("groupPositionsByRound", () => {
  const p = (round: number, n: number) => ({ round, id: `p${n}` });

  test("groups ascending by round, keeping the incoming order inside a group", () => {
    const g = view.groupPositionsByRound([p(2, 3), p(1, 1), p(2, 4), p(1, 2)]);
    expect(g.map((x: { round: number }) => x.round)).toEqual([1, 2]);
    expect(g[0].positions.map((x: { id: string }) => x.id)).toEqual(["p1", "p2"]);
    expect(g[1].positions.map((x: { id: string }) => x.id)).toEqual(["p3", "p4"]);
  });

  test("counts: finished per round, total = turn budget / round count", () => {
    const g = view.groupPositionsByRound([p(1, 1), p(1, 2), p(2, 3)], { roundCount: 2, turnBudget: 22 });
    expect(g.map((x: { finished: number }) => x.finished)).toEqual([2, 1]);
    expect(g.map((x: { total: number | null }) => x.total)).toEqual([11, 11]);
  });

  test("total is null when the run shape is unknown or degenerate", () => {
    expect(view.groupPositionsByRound([p(1, 1)])[0].total).toBeNull();
    expect(view.groupPositionsByRound([p(1, 1)], { roundCount: 0, turnBudget: 12 })[0].total).toBeNull();
    expect(view.groupPositionsByRound([p(1, 1)], { roundCount: 2 })[0].total).toBeNull();
  });

  test("open by default: the current round when it has positions, else the latest round", () => {
    const list = [p(1, 1), p(2, 2), p(3, 3)];
    const open = (g: { round: number; open: boolean }[]) => g.filter((x) => x.open).map((x) => x.round);
    expect(open(view.groupPositionsByRound(list, { currentRound: 2 }))).toEqual([2]);
    expect(open(view.groupPositionsByRound(list))).toEqual([3]);
    // current round has no finished position yet -> fall back to the latest finished round
    expect(open(view.groupPositionsByRound([p(1, 1), p(2, 2)], { currentRound: 3 }))).toEqual([2]);
  });

  test("no positions: no groups", () => {
    expect(view.groupPositionsByRound([])).toEqual([]);
  });
});

describe("failed run keeps positions grouped by round", () => {
  test("kept positions render in round groups, the failed round open", () => {
    const html = render({
      progress: progress({
        phase: "failed",
        failed_at: { phase: "discussion", round: 2, speaker_seat: "financing-agent", error_code: "llm_error" },
      }),
      positions: [pos(1), pos(2, { round: 2 })],
      failureMessage: "boom",
    });
    expect(html).toContain("라운드 1 · 발언 1/4");
    expect(html).toContain("라운드 2 · 발언 1/4");
    expect((html.match(/<details[^>]*\sopen/g) ?? []).length).toBe(1);
  });
});
