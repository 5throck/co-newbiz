// ADR-0196 Phase C (design 2026-11-08-committee-minutes-as-meeting-design §2.4, §7 M1/M2/M6,
// §8.6/§8.7/§8.9/§8.10): CommitteeMinutesView renders meeting-form minutes from the ?format=json
// payload with the non-negotiable boundaries intact — dissent VERBATIM, the recommendation
// labelled a PROPOSAL (제안 권고) with NO approval stamp, the AI-drafted label, the confirmed
// chip, and the contested agenda marker. ko/en rendering both asserted.
// Amendment §8.7 coverage: locale resolution labels (never the raw enum, unknown falls back
// raw), the open-questions badge on unresolved conclusion lines, the degraded-resolutions chip
// (only when count > 0), and the markdown renderer's Korean labels (§8.7, server-rendered).
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-committee-minutes-view.sqlite");
// Coverage runs share one process across files: capture and restore every env
// var this suite touches (docs/context.md §Project testing notes).
const PREV_ENV: Record<string, string | undefined> = {};
function setEnv(key: string, value: string): void {
  PREV_ENV[key] = process.env[key];
  process.env[key] = value;
}
setEnv("CO_NEWBIZ_DB_PATH", TEST_DB_PATH);
// The markdown renderer must never dial an LLM (it is a read-only GET path);
// force "no LLM" even on a machine with a real provider in the root .env.
setEnv("CO_NEWBIZ_LLM_PROVIDER", "none");

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  for (const [k, v] of Object.entries(PREV_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

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
const { CommitteeMinutesView } = (await import(`${WEB}/components/CommitteeMinutesView.tsx`)) as {
  CommitteeMinutesView: unknown;
};

const render = (el: unknown, locale: "ko" | "en" = "ko") =>
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
          issue_id: "I1",
          exchanges: [
            { position_ref: 12, seat: "risk-officer", act: "raised", summary: "기준치 미달 우려 제기" },
            { position_ref: 15, seat: "financial-analyst", act: "rebut", summary: "재무 관점 반박" },
          ],
          resolution: "narrowed",
        },
      ],
      agreements: [{ text: "재무 시나리오 범위 합의", seats: ["risk-officer", "financial-analyst"] }],
      open_questions: [{ text: "인허가 일정 확인", owner_seat: "legal-counsel" }],
      action_items: [{ text: "보완 자료 요청", owner_seat: "process-governance-manager" }],
    },
  },
  minutesConfirmed: { by: "user-7", at: "2026-11-09T01:00:00.000Z" },
  recommendation: "go",
  dissentJson: JSON.stringify([{ member_key: "risk-officer", position_md: "기준치 미달로 GO 반대" }]),
};

const renderView = (locale: "ko" | "en" = "ko") =>
  render(createElement(CommitteeMinutesView, { payload: FIXTURE_PAYLOAD }), locale);

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

// ── Design §8.7: resolution labels, open-questions badge, degraded chip ────

const payloadWith = (overrides: Record<string, unknown>) => ({ ...FIXTURE_PAYLOAD, ...overrides });

function payloadWithDiscussion(resolution: string, openQuestions = 1) {
  const base = FIXTURE_PAYLOAD as {
    minutesDraft: { json: { discussion: Array<Record<string, unknown>>; open_questions: unknown[] } };
  };
  return payloadWith({
    minutesDraft: {
      ...base.minutesDraft,
      json: {
        ...base.minutesDraft.json,
        discussion: [{ ...base.minutesDraft.json.discussion[0], resolution }],
        open_questions:
          openQuestions > 0
            ? Array.from({ length: openQuestions }, (_, i) => ({ text: `질문 ${i + 1}`, owner_seat: "legal-counsel" }))
            : [],
      },
    },
  });
}

const renderPayload = (payload: unknown, locale: "ko" | "en" = "ko") =>
  render(createElement(CommitteeMinutesView, { payload }), locale);

describe("CommitteeMinutesView resolution labels (§8.7)", () => {
  test("all three enum values print the locale label — never the raw enum", () => {
    for (const [resolution, label] of [
      ["agreed", "합의"],
      ["narrowed", "일부 합의"],
      ["unresolved", "미합의(보류)"],
    ] as const) {
      const html = renderPayload(payloadWithDiscussion(resolution));
      expect(html).toContain(`<strong>${label}</strong>`);
      expect(html).not.toContain(`<strong>${resolution}</strong>`);
    }
  });

  test("an unknown resolution value falls back to the raw string — never blank, never a crash", () => {
    const html = renderPayload(payloadWithDiscussion("escalated"));
    expect(html).toContain("<strong>escalated</strong>");
    expect(html).not.toContain("<strong></strong>");
  });

  test("en locale prints the English labels for all three values", () => {
    for (const [resolution, label] of [
      ["agreed", "Agreed"],
      ["narrowed", "Partially agreed"],
      ["unresolved", "Unresolved (deferred)"],
    ] as const) {
      const html = renderPayload(payloadWithDiscussion(resolution), "en");
      expect(html).toContain(`<strong>${label}</strong>`);
      expect(html).not.toContain(`<strong>${resolution}</strong>`);
    }
  });
});

describe("CommitteeMinutesView open-questions badge (§8.7)", () => {
  test("unresolved issue with open questions shows the badge, anchored to the Open questions section", () => {
    const html = renderPayload(payloadWithDiscussion("unresolved", 2));
    expect(html).toContain("미해결 질문 2건");
    expect(html).toContain(`href="#committee-minutes-open-questions"`);
    // The anchor target exists on the Open questions section header.
    expect(html).toContain(`id="committee-minutes-open-questions"`);
  });

  test("no badge on agreed/narrowed lines even when open questions exist", () => {
    for (const resolution of ["agreed", "narrowed"]) {
      const html = renderPayload(payloadWithDiscussion(resolution, 3));
      expect(html).not.toContain("미해결 질문 3건");
    }
  });

  test("no badge when the session has zero open questions, even on unresolved", () => {
    const html = renderPayload(payloadWithDiscussion("unresolved", 0));
    // No badge anchor anywhere (the section header keeps its id, legitimately).
    expect(html).not.toContain(`href="#committee-minutes-open-questions"`);
    expect(html).not.toContain("미해결 질문 0건");
  });
});

describe("CommitteeMinutesView degraded-resolutions chip (§8.6)", () => {
  test("count > 0 renders the amber chip with the interpolated count", () => {
    const html = renderPayload(payloadWith({ degradedResolutions: 3 }));
    expect(html).toContain("일부 결론 자동 대체(3건)");
    expect(html).toContain("status-amber");
  });

  test("count 0, null, and an absent key render no chip", () => {
    for (const degraded of [0, null, undefined]) {
      const payload = payloadWith({ degradedResolutions: degraded });
      if (degraded === undefined) delete (payload as Record<string, unknown>).degradedResolutions;
      const html = renderPayload(payload);
      expect(html).not.toContain("자동 대체");
    }
  });

  test("en locale renders the English degraded chip text", () => {
    const html = renderPayload(payloadWith({ degradedResolutions: 2 }), "en");
    expect(html).toContain("2 conclusions auto-filled");
  });
});

// ── Design §8.7: the markdown renderer prints Korean labels (server-side) ──

describe("buildCommitteeMinutes markdown resolution labels (§8.7)", () => {
  test("committeeResolutionLabel maps all three values and falls back raw", async () => {
    const { committeeResolutionLabel } = (await import(`${WEB}/lib/committee-scorecard.ts`)) as {
      committeeResolutionLabel: (resolution: string) => string;
    };
    expect(committeeResolutionLabel("agreed")).toBe("합의");
    expect(committeeResolutionLabel("narrowed")).toBe("일부 합의");
    expect(committeeResolutionLabel("unresolved")).toBe("미합의(보류)");
    expect(committeeResolutionLabel("escalated")).toBe("escalated");
    expect(committeeResolutionLabel("")).toBe("");
  });

  test("the rendered markdown never prints the raw enum on a conclusion line", async () => {
    const db = getDb(TEST_DB_PATH);
    const now = new Date().toISOString();
    const draftJson = {
      agenda: [
        { id: "I1", title: "수요 전제" },
        { id: "I2", title: "인증 이전" },
        { id: "I3", title: "자금 조달" },
        { id: "I4", title: "출시 시점" },
      ],
      discussion: [
        { issue_id: "I1", exchanges: [], resolution: "agreed", resolution_note: "근거: CAGR 수치 합치" },
        { issue_id: "I2", exchanges: [], resolution: "narrowed" },
        { issue_id: "I3", exchanges: [], resolution: "unresolved" },
        { issue_id: "I4", exchanges: [], resolution: "escalated_unknown" },
      ],
      agreements: [],
      open_questions: [{ text: "인허가 일정 확인", owner_seat: "legal-counsel" }],
      action_items: [],
    };
    const metaJson = JSON.stringify({
      committee_key: "route-steering-committee",
      gate: "pre_fs",
      minutes_draft: {
        json: draftJson,
        fallback: false,
        prompt_version: "committee.minutes@2",
        input_hash: "test-hash",
        created_at: now,
        degraded_resolutions: 0,
      },
    });
    db.run(
      "INSERT INTO process_run (id, entity_type, entity_id, spec_version, stage, status, source, started_by, started_at, meta_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ["md-view-run-1", "opportunity", "opp-md-view", "test", "meeting", "done", "web", "test", now, metaJson],
    );
    const { buildCommitteeMinutes } = (await import(`${WEB}/lib/committee-scorecard.ts`)) as {
      buildCommitteeMinutes: (db: unknown, sessionId: string) => string | null;
    };
    const md = buildCommitteeMinutes(db, "md-view-run-1");
    expect(md).not.toBeNull();
    // Korean labels on every conclusion line, including the unknown raw fallback.
    expect(md).toContain("- 결론: **합의** — 근거: CAGR 수치 합치");
    expect(md).toContain("- 결론: **일부 합의**");
    expect(md).toContain("- 결론: **미합의(보류)**");
    expect(md).toContain("- 결론: **escalated_unknown**");
    // The raw enum never reaches the rendered conclusion line.
    for (const raw of ["**agreed**", "**narrowed**", "**unresolved**"]) {
      expect(md).not.toContain(raw);
    }
  });
});
