// @version 1.0.0
/**
 * Committee minutes v2 UI (ADR-0204 phase 3, design 2026-11-20 §4.6 — 2026-11-20 UI revision):
 *
 *   - pure helpers: the v2 JSON of a minutes GET payload, the tab rule (v2 only),
 *     the tally with 불참 kept apart from 기권, verbatim dissent parsing;
 *   - static renders (ko / en): the minutes v2 body (issue title, 참석 위원 with
 *     reasons, excerpt dialogue lines, consensus proposal, outcome + tally incl.
 *     불참, seat recommendations, dissent verbatim), the provenance badge
 *     "일부 인용 자동 교정", the meeting window's 회의록 / 전체 발언 tabs in
 *     record mode (and their absence for v1), the dedupe fixes (the record count
 *     appears once, a vote turn renders its stance label once);
 *   - the record-entry rule in the panel source: one "회의록 보기" button for a
 *     finished turn meeting, and the history row carries no raw "agent_team · pre_fs" pair.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { CommitteeMinutesV2Json } from "../../app/web-next/lib/committee-minutes-schema.ts";
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
const minutesView = await import(`${WEB}/lib/committee-minutes-view.ts`);
const { CommitteeMinutesV2View } = (await import(`${WEB}/components/CommitteeMinutesV2View.tsx`)) as {
  CommitteeMinutesV2View: unknown;
};
const { MeetingWindowDialog } = (await import(`${WEB}/components/CommitteeMeetingWindow.tsx`)) as {
  MeetingWindowDialog: unknown;
};
const { CommitteeTurnTranscript } = (await import(`${WEB}/components/CommitteeTurnTranscript.tsx`)) as {
  CommitteeTurnTranscript: unknown;
};

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const wrap = (el: unknown, locale: "ko" | "en") =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" },
      el,
    ),
  );

const minutes = (over: Partial<CommitteeMinutesV2Json> = {}): CommitteeMinutesV2Json =>
  ({
    version: 2,
    overview: {
      kind: "ai_committee_meeting",
      engine: "turns",
      held_at: "2026-11-20T10:00:00.000Z",
      chair_seat: "greenfield-agent",
      seats: [{ seat: "risk-officer", name: "리스크 심의관" }],
      not_participating: [{ seat: "valuation-agent", name: "밸류에이션 위원" }],
      human_participants: [],
      sittings: [{ attempt: 1, closed_issue_ids: ["i-1"] }],
    },
    issues: [
      {
        issue_id: "i-1",
        title: "입지 선정",
        participants: [{ seat: "risk-officer", name: "리스크 심의관", reason: "지명됨" }],
        guests: [],
        sat_out: [{ seat: "valuation-agent", name: "밸류에이션 위원" }],
        excerpt: [
          {
            turn_id: "t-1",
            seq: 1,
            speaker_seat: "risk-officer",
            speaker_name: "리스크 심의관",
            role: "seat",
            move: "propose",
            quote: "A 부지를 제안합니다.",
            quote_full: true,
          },
          {
            turn_id: "t-2",
            seq: 2,
            speaker_seat: "risk-officer",
            speaker_name: "리스크 심의관",
            role: "seat",
            move: "propose",
            quote: "B 부지를 제안합니다.",
            quote_full: false,
            quote_repaired: true,
          },
        ],
        excerpt_source: "llm",
        consensus: { turn_id: "t-3", proposal: "A 부지로 확정한다.", rests_on_turns: ["t-1"] },
        votes: [{ seat: "risk-officer", name: "리스크 심의관", vote: "accept" }],
        outcome: "agreed",
        tally: { accept: 2, reserve: 1, abstain: 0, not_participating: 1 },
        seat_recommendations: [
          { seat: "risk-officer", name: "리스크 심의관", recommendation: "go", veto_dissent: true },
        ],
      },
    ],
    open_items: [{ text: "잔여 이슈", owner_name: "리스크 심의관" }],
    provenance: { source: "llm", fallback_issue_ids: [], rejected_refs: 1, repaired_quotes: 2, notes: [] },
    ...over,
  }) as CommitteeMinutesV2Json;

const turn = (over: Partial<TurnView> = {}): TurnView =>
  ({
    turnId: "t-1",
    seq: 1,
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
    utteranceMd: "Statement.",
    abandoned: false,
    createdAt: "2026-11-20T10:00:00.000Z",
    ...over,
  }) as TurnView;

describe("minutes payload helpers", () => {
  test("minutesJsonOf: the v2 JSON only for minutesVersion 2", () => {
    const m = minutes();
    expect(minutesView.minutesJsonOf({ minutesVersion: 2, minutes: m })).toBe(m);
    expect(minutesView.minutesJsonOf({ minutesVersion: 2, minutes: null })).toBeNull();
    expect(minutesView.minutesJsonOf({ minutesVersion: 1, minutes: m })).toBeNull();
    expect(minutesView.minutesJsonOf({ minutesVersion: null, minutes: m })).toBeNull();
    expect(minutesView.minutesJsonOf(null)).toBeNull();
  });

  test("minutesHasBodyTabs: v2 only", () => {
    expect(minutesView.minutesHasBodyTabs({ minutesVersion: 2 })).toBe(true);
    expect(minutesView.minutesHasBodyTabs({ minutesVersion: 1 })).toBe(false);
    expect(minutesView.minutesHasBodyTabs({ minutesVersion: null })).toBe(false);
    expect(minutesView.minutesHasBodyTabs(null)).toBe(false);
  });

  test("tallyOf keeps 불참 as its own number (never folded into 기권)", () => {
    const t = minutesView.tallyOf(minutes().issues[0]);
    expect(t).toEqual({ accept: 2, reserve: 1, abstain: 0, notParticipating: 1 });
  });

  test("parseMinutesDissent: string or array, parse failure degrades to none", () => {
    const d = [{ member_key: "risk-officer", position_md: "원문" }];
    expect(minutesView.parseMinutesDissent(JSON.stringify(d))).toEqual(d);
    expect(minutesView.parseMinutesDissent(d)).toEqual(d);
    expect(minutesView.parseMinutesDissent("{broken")).toEqual([]);
    expect(minutesView.parseMinutesDissent(null)).toEqual([]);
  });
});

describe("minutes v2 body render", () => {
  const render = (m: CommitteeMinutesV2Json, locale: "ko" | "en" = "ko") =>
    wrap(
      createElement(CommitteeMinutesV2View, {
        minutes: m,
        dissents: [{ member_key: "risk-officer", position_md: "이견 원문" }],
      }),
      locale,
    );

  test("issue body: title, participants with reasons, excerpts as dialogue lines, consensus, tally incl. 불참", () => {
    const html = render(minutes());
    expect(html).toContain("입지 선정");
    expect(html).toContain("리스크 심의관 (지명됨)");
    expect(html).toContain("A 부지를 제안합니다.");
    expect(html).toContain("A 부지로 확정한다.");
    expect(html).toContain("불참 1");
    // the human never-invented rule: no fabricated utterance for a non-participant
    expect(html).not.toContain("밸류에이션 위원: 의견");
  });

  test("provenance badge 일부 인용 자동 교정 renders only when repaired_quotes > 0", () => {
    expect(render(minutes())).toContain("일부 인용 자동 교정");
    const clean = minutes();
    clean.provenance.repaired_quotes = 0;
    expect(render(clean)).not.toContain("일부 인용 자동 교정");
  });

  test("seat recommendation + 거부권 이견 marker; dissent verbatim", () => {
    const html = render(minutes());
    expect(html).toContain("GO");
    expect(html).toContain("거부권 이견");
    expect(html).toContain("이견 원문");
    expect(html).toContain("— risk-officer");
  });

  test("en locale renders the English catalog lines", () => {
    const html = render(minutes(), "en");
    expect(html).toContain("Vote: accept 2 · reserve 1 · abstain 0 · not participating 1");
    expect(html).toContain("Open items");
  });
});

describe("meeting window record tabs", () => {
  const renderWindow = (props: Record<string, unknown>, locale: "ko" | "en" = "ko") =>
    wrap(createElement(MeetingWindowDialog, { turns: [], onClose: () => {}, ...props }), locale);

  const progress = {
    engine: "turns" as const,
    phase: "done" as const,
    turn_count: 3,
    started_at: "2026-11-20T10:00:00.000Z",
    updated_at: "2026-11-20T10:00:01.000Z",
  };

  test("minutesVersion 2 record: 회의록 / 전체 발언 tabs, minutes body as the default tab", () => {
    const html = renderWindow({
      mode: "record",
      progress: null,
      minutes: { minutesVersion: 2, minutes: minutes(), dissentJson: null } as never,
      minutesState: "loaded",
    });
    expect(html).toContain("회의록");
    expect(html).toContain("전체 발언");
    expect(html).toContain("입지 선정"); // minutes body rendered by default
    expect(html).not.toContain("아직 오간 발언이 없습니다"); // transcript tab hidden
  });

  test("transcript tab shows the full transcript (with the collapsed 중단된 시도 note when present)", () => {
    const html = renderWindow({
      mode: "record",
      progress: null,
      minutes: { minutesVersion: 2, minutes: minutes(), dissentJson: null } as never,
      minutesState: "loaded",
    });
    // default is the minutes tab; the transcript content is not there
    expect(html).not.toContain("Statement.");
  });

  test("minutesVersion 1 / null: no tabs, plain transcript record (as today)", () => {
    for (const minutesVersion of [1, null]) {
      const html = renderWindow({
        mode: "record",
        progress: null,
        minutes: { minutesVersion, minutes: null, dissentJson: null } as never,
        minutesState: "loaded",
      });
      expect(html).not.toContain("전체 발언");
      expect(html).toContain("아직 오간 발언이 없습니다");
    }
  });

  test("live mode: no tabs", () => {
    const html = renderWindow({ mode: "live", progress, minutes: null, minutesState: null });
    expect(html).not.toContain("전체 발언");
  });

  test("dedupe: the 토의 기록 count line appears at most once in a record window", () => {
    const html = renderWindow({
      mode: "record",
      progress: null,
      minutes: { minutesVersion: 1, minutes: null, dissentJson: null } as never,
      minutesState: "loaded",
      turns: [turn(), turn({ seq: 2, turnId: "t-2" })],
    });
    expect(count(html, "토의 기록 2건")).toBe(1);
  });
});

describe("vote stance dedupe in the transcript", () => {
  const renderTranscript = (turns: TurnView[]) => wrap(createElement(CommitteeTurnTranscript, { turns }), "ko");

  test("a vote turn renders 찬성 once (move label), not 찬성 찬성", () => {
    const html = renderTranscript([turn({ move: "accept", vote: "accept", stance: "for" })]);
    expect(count(html, "찬성")).toBe(1);
  });

  test("a speech turn with a stance keeps its stance label", () => {
    const html = renderTranscript([turn({ move: "propose", stance: "for" })]);
    expect(html).toContain("찬성");
    expect(html).toContain("제안");
  });
});

describe("panel wiring (source scan — the panel pulls the API/auth client, not renderable standalone)", () => {
  const panel = normSrc(readFileSync(new URL(`${WEB}/components/CommitteePanel.tsx`, import.meta.url), "utf8"));

  test("one record label: openMinutes everywhere, openRecord gone", () => {
    expect(panel).toContain("window.openMinutes");
    expect(panel).not.toContain("window.openRecord");
    expect(count(panel, "setMinutesOpen(true)")).toBe(3); // rounds sessions, v1 fallback, and the rounds-only section button
  });

  test("the session list is narrowed to the panel's own committee", () => {
    expect(panel).toContain("committee-sessions?committeeKey=");
  });

  test("the history row shows no raw decision_mode · gate pair", () => {
    expect(panel).not.toContain("s.meta.decision_mode} · {s.meta.gate");
    expect(panel).toContain("GATE_LABEL_KEY[s.meta.gate]");
  });
});
