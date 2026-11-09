// ADR-0196 Phase C (design 2026-11-08-committee-minutes-as-meeting-design §2.4, §7 M1/M2/M6):
// CommitteeMinutesView renders meeting-form minutes from the ?format=json payload with the
// non-negotiable boundaries intact — dissent VERBATIM, the recommendation labelled a PROPOSAL
// (제안 권고) with NO approval stamp, the AI-drafted label, the confirmed chip, and the
// contested agenda marker. ko/en rendering both asserted.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "../../app/web-next/node_modules/react-dom/server.js";
import { createElement } from "../../app/web-next/node_modules/react/index.js";
import { NextIntlClientProvider } from "../../app/web-next/node_modules/next-intl";
import ko from "../../app/web-next/locales/ko.json";
import en from "../../app/web-next/locales/en.json";
import { CommitteeMinutesView } from "../../app/web-next/components/CommitteeMinutesView.tsx";

const render = (el, locale = "ko") =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" },
      el,
    ),
  );

const FIXTURE_PAYLOAD = {
  sessionId: "run-1",
  status: "done",
  committeeKey: "route-steering-committee",
  gate: "pre_fs",
  decisionMode: "agent_team",
  track: null,
  agenda: [{ id: "I1", title: "시장성 쟁점", contested: true }],
  agendaMeta: { source: "llm" },
  minutesDraft: {
    fallback: false,
    prompt_version: "v1",
    json: {
      agenda: [{ id: "I1", title: "시장성 쟁점" }],
      discussion: [
        {
          issue: "I1",
          exchanges: [
            { position_ref: 12, seat: "risk-officer", act: "raised", summary_md: "기준치 미달 우려 제기" },
            { position_ref: 15, seat: "financial-analyst", act: "rebut", summary_md: "재무 관점 반박" },
          ],
          resolution: "narrowed",
        },
      ],
      agreements: [{ text: "재무 시나리오 범위 합의", seats: ["risk-officer", "financial-analyst"] }],
      open_questions: [{ question: "인허가 일정 확인", owner_seat: "legal-counsel" }],
      action_items: [{ item: "보완 자료 요청", owner_seat: "process-governance-manager" }],
    },
  },
  minutesConfirmed: { by: "user-7", at: "2026-11-09T01:00:00.000Z" },
  recommendation: "go",
  dissentJson: JSON.stringify([{ member_key: "risk-officer", position_md: "기준치 미달로 GO 반대" }]),
};

const renderView = (locale) => render(createElement(CommitteeMinutesView, { payload: FIXTURE_PAYLOAD }), locale);

describe("CommitteeMinutesView (ADR-0196 Phase C)", () => {
  test("dissent renders VERBATIM from dissent_json — never summarized or reworded", () => {
    const html = renderView();
    expect(html).toContain("기준치 미달로 GO 반대");
    expect(html).toContain("&quot;기준치 미달로 GO 반대&quot; — risk-officer");
    expect(html).toContain("보존된 이의");
    expect(html).toContain("원문 그대로 보존됩니다");
  });

  test("recommendation is a proposal (제안 권고) — no approval stamp anywhere", () => {
    const html = renderView();
    expect(html).toContain("제안 권고");
    expect(html).toContain("제안일 뿐 결정이 아닙니다");
    // No approval stamp: the view must never emit PASS / 최종 승인 wording.
    expect(html).not.toContain("PASS");
    expect(html).not.toContain("최종 승인");
    expect(html).not.toContain("승인됨");
  });

  test("AI-drafted label present on AI-drafted sections", () => {
    const html = renderView();
    expect(html).toContain("AI 초안");
    expect(html).toContain("부록의 원문 기록과 대조해 검증");
  });

  test("confirmed chip shown when minutesConfirmed present", () => {
    const html = renderView();
    expect(html).toContain("확정됨");
    expect(html).toContain("user-7 확정");
  });

  test("contested agenda marker is text-paired, not color-only", () => {
    const html = renderView();
    expect(html).toContain("쟁점 분분");
    expect(html).toContain("시장성 쟁점");
  });

  test("en locale renders the same contract in English", () => {
    const html = renderView("en");
    expect(html).toContain("Proposed recommendation");
    expect(html).toContain("Preserved dissent (verbatim)");
    expect(html).toContain("Confirmed");
    expect(html).toContain("AI-drafted");
    expect(html).not.toContain("PASS");
  });
});
