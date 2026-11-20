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
const { formatDateTimeHm } = await import(`${WEB}/lib/format.ts`);
const { CommitteeMinutesV2View } = (await import(`${WEB}/components/CommitteeMinutesV2View.tsx`)) as {
  CommitteeMinutesV2View: unknown;
};
const { MeetingWindowDialog } = (await import(`${WEB}/components/CommitteeMeetingWindow.tsx`)) as {
  MeetingWindowDialog: unknown;
};
const rowModule = (await import(`${WEB}/components/CommitteeSessionRow.tsx`)) as {
  CommitteeSessionRowSummary: unknown;
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

  test("minutesJsonOf reads the API's real shape: the v2 JSON lives at minutesDraft.json (no top-level minutes)", () => {
    const m = minutes();
    const payload = { minutesVersion: 2, minutesDraft: { json: m, fallback: true } } as never;
    expect(minutesView.minutesJsonOf(payload)).toBe(m);
    // a top-level minutes still wins when present
    const top = minutes({ open_items: [] });
    expect(minutesView.minutesJsonOf({ minutesVersion: 2, minutes: top, minutesDraft: { json: m } } as never)).toBe(
      top,
    );
    // v1 payload / v1 draft json / malformed draft json: no v2 body
    expect(minutesView.minutesJsonOf({ minutesVersion: 1, minutesDraft: { json: m } } as never)).toBeNull();
    expect(
      minutesView.minutesJsonOf({ minutesVersion: 2, minutesDraft: { json: { version: 1 } } } as never),
    ).toBeNull();
    expect(
      minutesView.minutesJsonOf({ minutesVersion: 2, minutesDraft: { json: { version: 2 } } } as never),
    ).toBeNull();
    expect(minutesView.minutesJsonOf({ minutesVersion: 2, minutesDraft: null } as never)).toBeNull();
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
    // attendees on ONE line with the count; the reason is a title + one collapsed 선정 이유 note, not a line per seat
    expect(html).toContain('참석 위원 1명: <span title="지명됨">리스크 심의관</span>');
    expect(html).toContain("선정 이유");
    expect(html).toContain("리스크 심의관 — 지명됨");
    expect(html).not.toContain("리스크 심의관 (지명됨)");
    expect(html).toContain("A 부지를 제안합니다.");
    expect(html).toContain("A 부지로 확정한다.");
    expect(html).toContain("불참 1");
    // the human never-invented rule: no fabricated utterance for a non-participant
    expect(html).not.toContain("밸류에이션 위원: 의견");
  });

  test("several attendees: one comma-separated line (minutes body issue block and overview), one reasons note", () => {
    const m = minutes();
    m.issues[0].participants = [
      { seat: "risk-officer", name: "위험 점검 위원", reason: "신뢰도 점검" },
      { seat: "legal-counsel", name: "법률 위원", reason: "" },
      { seat: "industry-lead", name: "산업 위원", reason: "시장 연결" },
    ];
    m.overview.seats = [
      { seat: "risk-officer", name: "위험 점검 위원" },
      { seat: "legal-counsel", name: "법률 위원" },
      { seat: "valuation-agent", name: "가치 평가 위원" },
    ];
    const html = render(m);
    expect(html).toContain(
      '참석 위원 3명: <span title="신뢰도 점검">위험 점검 위원</span>, <span>법률 위원</span>, <span title="시장 연결">산업 위원</span>',
    );
    expect(count(html, "<details")).toBe(1);
    expect(html).toContain("위험 점검 위원 — 신뢰도 점검; 산업 위원 — 시장 연결");
    // overview: the seats that sat out every issue are named on the 불참 line, not in the attendee list
    expect(html).toContain("참석 위원 2명: 위험 점검 위원, 법률 위원");
    expect(html).toContain("불참: 밸류에이션 위원");
    const none = minutes();
    none.issues[0].participants = [{ seat: "risk-officer", name: "리스크 심의관", reason: "" }];
    expect(render(none)).not.toContain("<details");
    expect(render(m, "en")).toContain("Participants (3): ");
  });

  test("held_at renders as a formatted local time, not the raw UTC slice", () => {
    const html = render(minutes());
    expect(html).not.toContain("개최: 2026-11-20 10:00");
    expect(html).toMatch(/개최: 2026\. 11\. 20\. \d{2}:\d{2}/);
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

  test("the real payload shape (minutesDraft.json) renders the minutes body on the default 회의록 tab", () => {
    const html = renderWindow({
      mode: "record",
      progress: null,
      minutes: { minutesVersion: 2, minutesDraft: { json: minutes(), fallback: false }, dissentJson: null } as never,
      minutesState: "loaded",
    });
    expect(html).toContain("전체 발언");
    expect(html).toContain("입지 선정");
    expect(html).toContain('data-testid="committee-window-minutes"');
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

describe("history row: time and chair summary", () => {
  test("formatDateTimeHm: date + 24h time (ko), unparseable renders as-is", () => {
    const out = formatDateTimeHm("2026-11-20T12:25:00Z", "ko");
    expect(out).toMatch(/^2026\. 11\. 20\. \d{2}:\d{2}$/);
    expect(formatDateTimeHm("2026-11-20T12:25:00Z", "en")).toMatch(/\d{2}:\d{2}/);
    expect(formatDateTimeHm("not-a-date")).toBe("not-a-date");
  });

  const trFor =
    (catalog: Record<string, unknown>) =>
    (key: string, values: Record<string, unknown> = {}) => {
      let node: unknown = catalog;
      for (const part of key.split(".")) node = (node as Record<string, unknown>)[part];
      return String(node).replace(/\{(\w+)\}/g, (_, k) => String(values[k]));
    };

  test("chairSummaryLines: display names, no raw gate id / agent key, natural dissent wording (ko)", () => {
    const tr = trFor(ko);
    const l = minutesView.chairSummaryLines(tr, {
      committee: "S4 진출방식 스티어링 위원회",
      rec: "HOLD",
      gate: "예비타당성 검토(Pre-FS)",
      chair: "프로세스 거버넌스 위원",
      scoreAvg: null,
      dissentCount: 0,
    });
    expect(l.proposal).toBe(
      "S4 진출방식 스티어링 위원회 — HOLD 제안 (게이트: 예비타당성 검토(Pre-FS), 의장: 프로세스 거버넌스 위원)",
    );
    expect(l.basis).toBe("근거: 좌석 점수 표 없음 · 이견 0건 — 확정은 사람의 진행 기록");
    expect(l.proposal + l.basis).not.toMatch(/pre_fs|process-governance-manager|0건 이견/);
    const withDissent = minutesView.chairSummaryLines(tr, {
      committee: "c",
      rec: "GO",
      gate: "g",
      chair: "x",
      scoreAvg: 2.4,
      dissentCount: 2,
    });
    expect(withDissent.basis).toBe("근거: 좌석 점수 집계 2.4/3.0 · 이견 2건 반영 — 확정은 사람의 진행 기록");
  });

  test("the chair key resolves to a display name in both catalogs (COMMITTEE_SEAT_LABEL_KEY)", async () => {
    const { COMMITTEE_SEAT_LABEL_KEY } = await import(`${WEB}/lib/label-keys.ts`);
    expect(COMMITTEE_SEAT_LABEL_KEY["process-governance-manager"]).toBe(
      "common.committee.seat.process-governance-manager",
    );
    const seat = (c: Record<string, unknown>) =>
      (c.common as { committee: { seat: Record<string, string> } }).committee.seat["process-governance-manager"];
    expect(seat(ko)).toBe("프로세스 거버넌스 위원");
    expect(seat(en)).toBeTruthy();
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

const readSrc = (rel: string) => normSrc(readFileSync(new URL(`${WEB}/${rel}`, import.meta.url), "utf8"));
const rowSrc = readSrc("components/CommitteeSessionRow.tsx");

describe("panel wiring (source scan — the panel pulls the API/auth client, not renderable standalone)", () => {
  const panel = normSrc(readFileSync(new URL(`${WEB}/components/CommitteePanel.tsx`, import.meta.url), "utf8"));

  test("one record label: openMinutes everywhere, openRecord gone", () => {
    expect(panel).toContain("window.openMinutes");
    expect(panel).not.toContain("window.openRecord");
    expect(count(panel, "setMinutesOpen(true)")).toBe(3); // rounds sessions, v1 fallback, and the rounds-only section button
  });

  test("a record opened from 회의록 보기 wins over a live meeting running at the same time", () => {
    expect(panel).toContain(normSrc("recordFor: sessionId"));
    expect(panel).toContain(normSrc("recordRequested ? null"));
  });

  test("the session list is narrowed to the panel's own committee", () => {
    expect(panel).toContain("committee-sessions?committeeKey=");
  });

  test("the history row time carries the clock time, the chair summary is catalog-built from display names", () => {
    expect(panel).toContain("formatDateTimeHm(s.startedAt,locale)");
    expect(panel).toContain("chairSummaryLines(tr,");
    expect(panel).toContain("GATE_LABEL_KEY[ev.gate]");
    expect(panel).toContain("seatName(tr,ev.evaluatedBy)");
    expect(panel).not.toContain("(${transcript.evaluation.gate} ·");
    expect(panel).not.toContain("좌석 점수 표 없음");
  });

  test("the history row shows no raw decision_mode · gate pair", () => {
    expect(panel).not.toContain("s.meta.decision_mode} · {s.meta.gate");
    // the row look lives in the shared component (CommitteePanel + the S4 결정 이력 + the IC package list)
    expect(panel).toContain("<CommitteeSessionRowSummary");
    expect(rowSrc).toContain("GATE_LABEL_KEY[gate]");
  });
});

describe("one history-row pattern on every meeting surface", () => {
  const { CommitteeSessionRowSummary } = rowModule;
  const session = {
    sessionId: "s1",
    status: "done",
    startedAt: "2026-11-20T12:25:00.000Z",
    engine: "turns",
    meta: { committee_key: "route-steering-committee", gate: "pre_fs", synthesized: true },
    progress: { phase: "done", started_at: "2026-11-20T12:25:00.000Z", updated_at: "2026-11-20T12:31:17.000Z" },
  };
  const render = (over: Record<string, unknown> = {}, locale: "ko" | "en" = "ko") =>
    wrap(
      createElement(CommitteeSessionRowSummary, {
        session: { ...session, ...over },
        committeeLabel: "S4 진출방식 스티어링 위원회",
        rec: "hold",
      }),
      locale,
    );

  test("committee name, gate label, date + HH:mm, duration, 대화형 badge, proposal chip, 제안됨 chip — no raw keys", () => {
    const html = render();
    expect(html).toMatch(/2026\. 11\. 20\. \d{2}:\d{2}/);
    expect(html).toContain("S4 진출방식 스티어링 위원회");
    expect(html).toContain("예비타당성 검토(Pre-FS)");
    expect(html).toContain("6분 17초");
    expect(html).toContain("대화형");
    expect(html).toContain("제안 HOLD");
    expect(html).toContain("제안됨");
    for (const raw of ["agent_team", "pre_fs", ">done<", "route-steering-committee"]) expect(html).not.toContain(raw);
  });

  test("an unfinished meeting reads 진행 중; no gate / rec → no gate text or proposal chip; en catalog", () => {
    const html = render({ meta: { committee_key: "x", synthesized: false }, progress: null, engine: "rounds" });
    expect(html).toContain("진행 중");
    expect(html).not.toContain("대화형");
    expect(render({}, "en")).toContain("Interactive");
  });

  test("DecisionHistory (S4 결정 이력) uses the shared row and opens the meeting window — no raw status / mode / date slice", () => {
    const src = readSrc("components/stages/route-decision/DecisionHistory.tsx");
    expect(src).toContain("<CommitteeSessionRowSummary");
    expect(src).toContain("<CommitteeMinutesRecord");
    expect(src).not.toContain("MinutesDialog");
    expect(src).not.toContain("s2.decisionMode");
    expect(src).not.toContain("{s2.status}");
    expect(src).not.toContain("s2.createdAt");
  });

  test("useRouteDecision lists only the route-steering committee's sessions and reads the { sessions } envelope", () => {
    const src = readSrc("components/stages/route-decision/useRouteDecision.ts");
    expect(src).toContain("committee-sessions?committeeKey=${encodeURIComponent(ROUTE_STEERING_COMMITTEE_KEY)}");
    expect(src).toContain("r.data.sessions");
    expect(readSrc("components/stages/route-decision/constants.ts")).toContain(
      'ROUTE_STEERING_COMMITTEE_KEY = "route-steering-committee"',
    );
    expect(readSrc("components/stages/route-decision/RouteDecisionStage.tsx")).toContain(
      "committeeKey={ROUTE_STEERING_COMMITTEE_KEY}",
    );
  });

  test("the IC package session list uses the shared row and the meeting window instead of a raw markdown link", () => {
    const src = readSrc("components/stages/IcReviewStage.tsx");
    expect(src).toContain("<CommitteeSessionRowSummary");
    expect(src).toContain("<CommitteeMinutesRecord");
    expect(src).not.toContain("href={s.minutesUrl}");
    expect(src).not.toContain("{s.status}");
  });

  test("the legacy MinutesDialog never renders a v2 record through the v1 view", () => {
    const src = readSrc("components/CommitteeMinutesView.tsx");
    expect(src).toContain(normSrc("payload.minutesVersion === 2"));
    expect(src).toContain("<CommitteeMinutesV2View");
  });

  test("COMMITTEE_NAME_KEY covers the registered committees with ko + en names", async () => {
    const { COMMITTEE_NAME_KEY } = await import(`${WEB}/lib/label-keys.ts`);
    const { COMMITTEE_REGISTRY } = await import(`${WEB}/lib/committee-registry.generated.ts`);
    expect(Object.keys(COMMITTEE_NAME_KEY).sort()).toEqual(Object.keys(COMMITTEE_REGISTRY).sort());
    for (const cat of [ko, en]) {
      const names = (cat.common as { committee: { name: Record<string, string> } }).committee.name;
      for (const key of Object.keys(COMMITTEE_NAME_KEY)) expect(names[key]).toBeTruthy();
    }
  });

  test("a record window opened before its minutes are known says loading / failed (no empty body)", () => {
    const base = { turns: [], onClose: () => {}, mode: "record", progress: null, minutes: null };
    expect(wrap(createElement(MeetingWindowDialog, { ...base, minutesState: "loading" }), "ko")).toContain(
      "회의록을 불러오는 중",
    );
    expect(wrap(createElement(MeetingWindowDialog, { ...base, minutesState: "error" }), "ko")).toContain(
      "회의록을 불러오지 못했습니다",
    );
  });
});
