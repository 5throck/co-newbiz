// ADR-0194 item A (PR-1), relocated to the end of S7 by ADR-0195: the deal-shape evaluation panel renders as designed
// (design 2026-11-07-kill-data-sources §3.6; 2026-11-08-deal-shape-to-s7-design).
// Status line (null is unassessed, never zero), verdicts as icon + text, "not evaluated" shapes, human-only recording
// (empty form, no AI pre-fill, viewer read-only), history collapsed, ko/en parity, and the link from the #9 snapshot row.
import { describe, expect, test } from "bun:test";

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
const { DealShapePanelView } = (await import(`${WEB}/components/stages/DealShapePanel.tsx`)) as {
  DealShapePanelView: unknown;
};
const { GateAckBlock } = (await import(`${WEB}/components/GateSnapshotAck.tsx`)) as { GateAckBlock: unknown };
const { EMPTY_ACK_STATE } = (await import(`${WEB}/lib/gate-ack-view.ts`)) as { EMPTY_ACK_STATE: unknown };
const V = await import(`${WEB}/lib/deal-shape-view.ts`);

const SHAPES = [
  "full_acquisition",
  "majority_stake",
  "spv",
  "holdco_route",
  "joint_venture",
  "minority_stake",
  "license_in",
  "co_development",
];
const INTENTS = ["integration", "capability_access"];

const render = (el: unknown, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" },
      el,
    ),
  );

const row = (shape: string | null, viable: boolean, over: Record<string, unknown> = {}) => ({
  id: `r-${shape ?? "overall"}`,
  opportunity_id: "o1",
  shape,
  intent: shape === null ? null : "integration",
  viable,
  rationale: `reason for ${shape ?? "overall"}`,
  evidence_ref: null,
  evaluated_by: "user-7",
  evaluated_at: "2026-11-07T01:00:00.000Z",
  superseded_by: null,
  ...over,
});
const data = (live: ReturnType<typeof row>[], over: Record<string, unknown> = {}) => ({
  opportunity_id: "o1",
  live,
  overall: null,
  history: [],
  live_token: "tok-1",
  unselected_shapes: SHAPES.filter((s) => !live.some((r) => r.shape === s)),
  viable_count: live.length === 0 ? null : live.filter((r) => r.viable).length,
  vocabulary: { shapes: SHAPES, intents: INTENTS },
  ...over,
});
const notViable = (over: Record<string, unknown> = {}) => {
  const overall = row(null, false, { rationale: "no route works" });
  return data([], { overall, viable_count: 0, ...over });
};
const view = (d: unknown, over: Record<string, unknown> = {}, locale: "ko" | "en" = "ko") =>
  render(
    createElement(DealShapePanelView, {
      data: d,
      loadError: null,
      canAct: true,
      form: V.EMPTY_DEAL_SHAPE_FORM,
      onForm: () => {},
      onSubmit: () => {},
      onEdit: () => {},
      reco: { busy: false, error: null, note: null, item: null },
      onRecommend: () => {},
      onApply: () => {},
      busy: false,
      problem: null,
      serverError: null,
      notice: null,
      loadedFromRow: false,
      ...over,
    }),
    locale,
  );
const formOf = (html: string) => (html.match(/<form[\s\S]*?<\/form>/) ?? [""])[0];
const viableForm = (over: Record<string, unknown> = {}) => ({ ...V.EMPTY_DEAL_SHAPE_FORM, viable: true, ...over });

describe("view logic", () => {
  test("verdictOf: the server verdict wins; an older payload is derived from rows, null is never read as zero", () => {
    expect(V.verdictOf(data([]))).toBe("unassessed");
    expect(V.verdictOf(notViable())).toBe("not_viable");
    expect(V.verdictOf(data([row("spv", false)]))).toBe("not_viable");
    expect(V.verdictOf(data([row("spv", true)]))).toBe("viable");
    expect(V.verdictOf({ ...data([]), verdict: "viable" })).toBe("viable");
  });
  test("validation follows field order; the verdict has no default", () => {
    const f = V.EMPTY_DEAL_SHAPE_FORM;
    expect(f.viable).toBeNull();
    expect(V.validateDealShapeForm(f, SHAPES)).toBe("viable");
    // not viable: rationale only; shape and intent are never asked
    expect(V.validateDealShapeForm({ ...f, viable: false, rationale: "  " }, SHAPES)).toBe("rationale");
    expect(V.validateDealShapeForm({ ...f, viable: false, rationale: "x".repeat(2001) }, SHAPES)).toBe(
      "rationaleTooLong",
    );
    expect(V.validateDealShapeForm({ ...f, viable: false, rationale: "no" }, SHAPES)).toBeNull();
    // viable: shapes, intent, per-shape rationale (vocabulary order), evidence
    expect(V.validateDealShapeForm(viableForm(), SHAPES)).toBe("shapes");
    expect(V.validateDealShapeForm(viableForm({ shapes: ["spv"] }), SHAPES)).toBe("intent");
    const base = viableForm({
      shapes: ["joint_venture", "spv"],
      intent: "integration",
      drafts: { spv: { rationale: "a", evidenceRef: "" }, joint_venture: { rationale: " ", evidenceRef: "" } },
    });
    expect(V.validateDealShapeForm(base, SHAPES)).toBe("shapeRationale:joint_venture");
    expect(
      V.validateDealShapeForm(
        { ...base, drafts: { ...base.drafts, spv: { rationale: " ", evidenceRef: "" } } },
        SHAPES,
      ),
    ).toBe("shapeRationale:spv"); // spv comes first in vocabulary order
    expect(
      V.validateDealShapeForm(
        { ...base, drafts: { ...base.drafts, joint_venture: { rationale: "y".repeat(2001), evidenceRef: "" } } },
        SHAPES,
      ),
    ).toBe("shapeRationaleTooLong:joint_venture");
    const ok = {
      ...base,
      drafts: { ...base.drafts, joint_venture: { rationale: "b", evidenceRef: "y".repeat(2001) } },
    };
    expect(V.validateDealShapeForm(ok, SHAPES)).toBe("evidenceTooLong");
    expect(
      V.validateDealShapeForm(
        { ...ok, drafts: { ...ok.drafts, joint_venture: { rationale: "b", evidenceRef: "" } } },
        SHAPES,
      ),
    ).toBeNull();
  });
  test("buildDealShapeBody emits the ADR-0201 union with live_token, only the active branch, no evaluator", () => {
    const notV = {
      ...V.EMPTY_DEAL_SHAPE_FORM,
      viable: false,
      rationale: "  no  ",
      evidenceRef: " doc-1 ",
      intent: "integration",
      shapes: ["spv"],
    };
    expect(V.buildDealShapeBody(notV, "tok", SHAPES)).toEqual({
      viable: false,
      rationale: "no",
      evidence_ref: "doc-1",
      live_token: "tok",
    });
    expect(V.buildDealShapeBody({ ...notV, evidenceRef: " " }, "tok", SHAPES)).toEqual({
      viable: false,
      rationale: "no",
      live_token: "tok",
    });
    const body = V.buildDealShapeBody(
      viableForm({
        rationale: "ignored overall text",
        shapes: ["joint_venture", "spv", "license_in"],
        intent: "capability_access",
        drafts: {
          spv: { rationale: " r-spv ", evidenceRef: " e1 " },
          joint_venture: { rationale: "r-jv", evidenceRef: "" },
          license_in: { rationale: "never sent", evidenceRef: "" },
          minority_stake: { rationale: "unchecked draft", evidenceRef: "" },
        },
      }),
      "tok",
      SHAPES,
    );
    expect(body).toEqual({
      viable: true,
      intent: "capability_access",
      shapes: [
        { shape: "spv", rationale: "r-spv", evidence_ref: "e1" },
        { shape: "joint_venture", rationale: "r-jv" },
        { shape: "license_in", rationale: "never sent" },
      ],
      live_token: "tok",
    });
    expect(JSON.stringify(body)).not.toContain("unchecked draft");
    expect(JSON.stringify(body)).not.toContain("evaluated_by");
  });
  test("formFromLive loads the recorded verdict; mixed legacy intents leave the intent empty", () => {
    expect(V.formFromLive(notViable())).toMatchObject({ viable: false, rationale: "no route works", shapes: [] });
    const f = V.formFromLive(
      data([
        row("spv", true, { evidence_ref: "d" }),
        row("joint_venture", true, { intent: "capability_access" }),
        row("license_in", false),
      ]),
    );
    expect(f).toMatchObject({ viable: true, shapes: ["spv", "joint_venture"], intent: "" });
    expect(f.drafts.spv).toEqual({ rationale: "reason for spv", evidenceRef: "d" });
    expect(V.formFromLive(data([row("spv", true), row("joint_venture", true)])).intent).toBe("integration");
    expect(V.formFromLive(data([]))).toEqual(V.EMPTY_DEAL_SHAPE_FORM);
  });
  test("formIsEmpty gates the 'recorded evaluation loaded' note (review fix 2026-11-17)", () => {
    // A record with no viable shapes and no drafts parses to the blank form → no misleading "loaded" note on edit.
    expect(V.formIsEmpty(V.formFromLive(data([])))).toBe(true);
    expect(V.formIsEmpty(V.formFromLive(notViable()))).toBe(false); // a recorded rationale is content
    expect(V.formIsEmpty(V.formFromLive(data([row("spv", true)])))).toBe(false);
    expect(V.formIsEmpty(V.EMPTY_DEAL_SHAPE_FORM)).toBe(true);
    // any user-entered content makes the form non-empty
    expect(V.formIsEmpty({ ...V.EMPTY_DEAL_SHAPE_FORM, viable: false })).toBe(false);
    expect(V.formIsEmpty({ ...V.EMPTY_DEAL_SHAPE_FORM, rationale: "x" })).toBe(false);
    expect(V.formIsEmpty({ ...V.EMPTY_DEAL_SHAPE_FORM, shapes: ["spv"] })).toBe(false);
    expect(V.formIsEmpty({ ...V.EMPTY_DEAL_SHAPE_FORM, drafts: { spv: { rationale: "r" } } })).toBe(false);
  });
  test("formFromRecommendation fills the whole form; a null verdict fills nothing", () => {
    const reco = {
      overall_viable: true,
      intent: "integration",
      rationale: "overall",
      shapes: [{ shape: "spv", rationale: "why spv" }],
    };
    expect(V.formFromRecommendation(reco)).toMatchObject({ viable: true, intent: "integration", shapes: ["spv"] });
    expect(V.formFromRecommendation({ ...reco, overall_viable: false, shapes: [] })).toMatchObject({
      viable: false,
      rationale: "overall",
      shapes: [],
    });
    expect(V.formFromRecommendation({ ...reco, overall_viable: null, shapes: [] })).toEqual(V.EMPTY_DEAL_SHAPE_FORM);
  });
  test("error envelope maps to a message kind", () => {
    expect(V.dealShapeErrorKind(403, "role_required")).toBe("viewer");
    expect(V.dealShapeErrorKind(403, "role_forbidden")).toBe("admin");
    expect(V.dealShapeErrorKind(404, "not_found")).toBe("notFound");
    expect(V.dealShapeErrorKind(400, "invalid_request")).toBe("invalid");
    expect(V.dealShapeErrorKind(413, "payload_too_large")).toBe("tooLarge");
    expect(V.dealShapeErrorKind(409, "deal_shape_not_open")).toBe("notOpen");
    expect(V.dealShapeErrorKind(409, "deal_shape_stale")).toBe("stale");
    expect(V.dealShapeErrorKind(409, "anything_else")).toBe("conflict");
    expect(V.dealShapeErrorKind(500, "internal")).toBe("other");
  });
});

describe("status line and recorded list", () => {
  test("nothing recorded: unassessed text, no recorded list (no table), no edit button", () => {
    const html = view(data([]));
    expect(html).toContain("아직 기록된 평가가 없습니다 — 중단 조건 #9는 평가 전으로 남습니다");
    expect(html).toContain('data-status="unassessed"');
    expect(html).not.toContain("<table");
    expect(html).not.toContain("deal-shape-recorded");
    expect(html).not.toContain("deal-shape-edit");
  });
  test("overall not viable: amber warning with an icon, one entry with the rationale, no shape or intent", () => {
    const html = view(notViable());
    expect(html).toContain('data-status="not_viable"');
    expect(html).toContain("불가능: 가능한 진출 형태 없음 (중단 조건 #9 해당)");
    expect(html).toContain('<span aria-hidden="true">⚠</span>');
    expect(html.match(/data-state="overall_not_viable"/g)?.length).toBe(1);
    expect(html).toContain("no route works");
    expect(html).toContain("전체 불가능");
  });
  test("viable: count line and one entry per live shape row with shape, intent, rationale, evidence, who and when", () => {
    const html = view(
      data([row("spv", true, { evidence_ref: "doc-9" }), row("joint_venture", true, { intent: "capability_access" })]),
    );
    expect(html).toContain('data-status="viable"');
    expect(html).toContain("가능 형태 2건");
    expect(html.match(/data-state="viable"/g)?.length).toBe(2);
    expect(html).toContain('<span aria-hidden="true">✓</span> 가능');
    expect(html).toContain("reason for spv");
    expect(html).toContain("근거 자료: doc-9");
    expect(html).toContain("user-7 · ");
    expect(html).toContain("역량접근");
  });
  test("legacy not-viable shape rows keep the old-method label and read as not viable", () => {
    const html = view(data([row("spv", false)]));
    expect(html).toContain("형태별 불가 (이전 방식)");
    expect(html).toContain('data-status="not_viable"');
    expect(html).toContain('data-state="legacy_not_viable"');
  });
  test("shape and intent labels are localized (existing S10 wording reused, two new keys added)", () => {
    const html = view(data(SHAPES.map((s) => row(s, true))));
    for (const label of [
      "전량 인수",
      "과반 지분",
      "SPC/SPV(목적법인)",
      "홀딩스 경유(holdco)",
      "합작(JV)",
      "소수 지분",
      "라이선스 도입",
      "공동 개발",
    ])
      expect(html).toContain(label);
    expect(html).not.toContain(">full_acquisition<");
    const enHtml = view(data([row("spv", true), row("joint_venture", true), row("license_in", true)]), {}, "en");
    for (const label of ["Joint venture (JV)", "License-in"]) expect(enHtml).toContain(label);
  });
  test("an editor sees one 수정 button above the list; it loads the whole recorded set", () => {
    const html = view(data([row("spv", true), row("joint_venture", true)]));
    expect(html.match(/data-testid="deal-shape-edit"/g)?.length).toBe(1);
    expect(html.indexOf("deal-shape-edit")).toBeLessThan(html.indexOf("deal-shape-recorded"));
    expect(html).not.toContain("평가 수정");
    expect(html).toContain('aria-label="수정: ');
    expect(view(notViable())).toContain("deal-shape-edit");
  });
});

describe("overall-first form", () => {
  test("before 가능 is chosen: no default, shape group and intent disabled, aria-describedby points at the hint", () => {
    const form = formOf(view(data([])));
    expect(form).not.toContain("checked");
    expect(form).toContain("가능을 선택하면 형태와 의도를 고를 수 있습니다");
    const hintId = (form.match(/id="([^"]*-disabled-hint)"/) ?? [])[1];
    expect(hintId).toBeTruthy();
    const group = (form.match(/<fieldset[^>]*data-testid="deal-shape-shapes"[^>]*>/) ?? [""])[0];
    expect(group).toContain("disabled");
    expect(group).toContain(`aria-describedby="${hintId}"`);
    const select = (form.match(/<select[^>]*>/) ?? [""])[0];
    expect(select).toContain("disabled");
    expect(select).toContain(`aria-describedby="${hintId}"`);
    expect(form).not.toContain("deal-shape-overall-fields");
    expect(form).not.toContain("deal-shape-shape-block");
    expect(form).toContain("평가 기록");
  });
  test("one wrapping horizontal row holds viability, shapes and intent", () => {
    const form = formOf(view(data([])));
    expect(form).toContain('class="flex flex-wrap items-start gap-x-6 gap-y-2"');
    const row1 = (form.match(/data-testid="deal-shape-controls"[\s\S]*?<\/select>/) ?? [""])[0];
    expect(row1.indexOf("가능 여부")).toBeLessThan(row1.indexOf("진출 형태"));
    expect(row1.indexOf("진출 형태")).toBeLessThan(row1.indexOf("의도"));
    expect(row1.match(/type="checkbox"/g)?.length).toBe(8);
  });
  test("불가능: one rationale and evidence, shape and intent stay disabled", () => {
    const form = formOf(view(data([]), { form: { ...V.EMPTY_DEAL_SHAPE_FORM, viable: false } }));
    expect(form).toContain("deal-shape-overall-fields");
    expect(form.match(/<textarea/g)?.length).toBe(1);
    expect(form).toContain("근거 (필수, 2000자 이내)");
    expect(form).not.toContain("deal-shape-shape-block");
    expect((form.match(/<fieldset[^>]*data-testid="deal-shape-shapes"[^>]*>/) ?? [""])[0]).toContain("disabled");
    expect((form.match(/<select[^>]*>/) ?? [""])[0]).toContain("disabled");
  });
  test("가능: controls enabled and one rationale block per checked shape in vocabulary order", () => {
    const f = viableForm({ shapes: ["license_in", "spv"], intent: "integration" });
    const form = formOf(view(data([]), { form: f }));
    expect(form).not.toContain("deal-shape-disabled-hint");
    expect((form.match(/<fieldset[^>]*data-testid="deal-shape-shapes"[^>]*>/) ?? [""])[0]).not.toContain("disabled");
    expect((form.match(/<select[^>]*>/) ?? [""])[0]).not.toContain("disabled");
    expect(form.match(/data-testid="deal-shape-shape-block"/g)?.length).toBe(2);
    expect(form.indexOf('data-shape="spv"')).toBeLessThan(form.indexOf('data-shape="license_in"'));
    expect(form).toContain("SPC/SPV(목적법인) 근거 (필수, 2000자 이내)");
    expect(form).not.toContain("deal-shape-overall-fields");
    expect(form).not.toContain("공동 개발 근거");
  });
  test("a per-shape problem is announced and marks that textarea invalid", () => {
    const f = viableForm({ shapes: ["spv"], intent: "integration" });
    const form = formOf(view(data([]), { form: f, problem: "shapeRationale:spv" }));
    expect(form).toContain("SPC/SPV(목적법인) 근거를 적어야 기록할 수 있습니다.");
    expect(form).toContain('aria-invalid="true"');
  });
});

describe("human-only recording", () => {
  test("states that no AI suggestion is pre-filled and offers the AI button", () => {
    const html = view(data([]));
    expect(html).toContain("AI 추천은 제안일 뿐입니다");
    expect(html).toContain("AI 추천</button>");
    expect(formOf(html)).toContain('aria-hidden="true" class="text-[color:var(--red-fg)]">*</span>'); // required marker
  });
  test("the page keeps one primary action: no btn-primary in the panel", () => {
    expect(view(data([]))).not.toContain("btn-primary");
  });
  test("a viewer or admin gets the read-only note and no form, edit or AI buttons", () => {
    const html = view(data([row("spv", true)]), { canAct: false });
    expect(html).toContain('data-testid="deal-shape-readonly"');
    expect(html).toContain("reason for spv");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("deal-shape-edit");
    expect(html).not.toContain("deal-shape-ai");
  });
  test("problem and server error render as alerts with an icon", () => {
    const html = view(data([]), {
      problem: "rationale",
      serverError: "boom",
      form: { ...V.EMPTY_DEAL_SHAPE_FORM, viable: false },
    });
    expect(html).toContain("근거를 적어야 기록할 수 있습니다.");
    expect(html).toContain('data-testid="deal-shape-server-error"');
  });
});

describe("AI recommendation card", () => {
  const card = (item: unknown, over: Record<string, unknown> = {}) =>
    view(data([]), { reco: { busy: false, error: null, note: null, item }, ...over });
  const viableReco = {
    overall_viable: true,
    intent: "integration",
    rationale: "overall reason",
    shapes: [
      { shape: "spv", rationale: "why spv" },
      { shape: "joint_venture", rationale: "why jv" },
    ],
  };
  test("viable: overall verdict first, then the proposed shapes with rationales, and an apply button", () => {
    const html = card(viableReco);
    expect(html).toContain('data-testid="deal-shape-ai-card"');
    expect(html.indexOf("전체 판단")).toBeLessThan(html.indexOf("why spv"));
    expect(html).toContain("overall reason");
    expect(html).toContain("why jv");
    expect(html).toContain('aria-label="양식에 채우기: ');
    expect(html).toContain("양식에 채우기</button>");
  });
  test("not viable: only the overall rationale, no shapes list", () => {
    const html = card({ overall_viable: false, intent: "", rationale: "blocked", shapes: [] });
    expect(html).toContain("blocked");
    expect(html).not.toContain("AI가 제안한 진출 형태");
    expect(html).toContain("양식에 채우기</button>");
  });
  test("undecided: 판단 보류 with the missing data and no apply button", () => {
    const html = card({ overall_viable: null, intent: "", rationale: "need financials", shapes: [] });
    expect(html).toContain("판단 보류");
    expect(html).toContain("need financials");
    expect(html).not.toContain("양식에 채우기</button>");
  });
  test("applying never saves: the card has no submit control", () => {
    expect(card(viableReco)).not.toMatch(/<form[^>]*>[\s\S]*양식에 채우기/);
  });
});

describe("history and load errors", () => {
  test("history is a collapsed details listing superseded rows of both kinds", () => {
    const old = row("spv", false, { id: "old", superseded_by: "r-spv", rationale: "old reason" });
    const oldOverall = row(null, false, { id: "old-all", superseded_by: "r-spv", rationale: "old overall reason" });
    const d = data([row("spv", true)], { history: [row("spv", true), old, oldOverall] });
    const html = view(d);
    const hist = (html.match(/<details[^>]*data-testid="deal-shape-history"[\s\S]*?<\/details>/) ?? [""])[0];
    expect(hist).not.toContain("open=");
    expect(hist).toContain("평가 이력 (2건)");
    expect(hist).toContain("old reason");
    expect(hist).toContain("old overall reason");
    expect(hist).toContain("전체 불가능");
    expect(view(data([row("spv", true)]))).not.toContain("deal-shape-history");
  });
  test("a 403 admin load error is explained and renders no form", () => {
    const html = view(null, { loadError: "admin" });
    expect(html).toContain("관리자 역할은 사업 내용을 볼 수 없습니다");
    expect(html).not.toContain("<form");
  });
});

describe("catalog", () => {
  const keys = (o: unknown, prefix = ""): string[] =>
    Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
      v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    );
  test("the panel namespace left S4 for S67 and the intro says it is recorded after the short list is set", () => {
    expect((ko.stages as { s4: Record<string, unknown> }).s4.dealShapePanel).toBeUndefined();
    expect((en.stages as { s4: Record<string, unknown> }).s4.dealShapePanel).toBeUndefined();
    expect(view(data([]))).toContain("단축 후보 목록(최종 후보 목록)을 정한 뒤");
    expect(view(data([]), {}, "en")).toContain("Once the short list is set");
  });
  test("the stale (409) and too-large (413) messages exist in both locales", () => {
    for (const cat of [ko, en]) {
      const se = (cat.stages as { s67: { dealShapePanel: { serverError: Record<string, string> } } }).s67.dealShapePanel
        .serverError;
      expect(se.stale.length).toBeGreaterThan(0);
      expect(se.tooLarge.length).toBeGreaterThan(0);
    }
  });
  test("the 409 not-open message exists in both locales", () => {
    expect(
      (ko.stages as { s67: { dealShapePanel: { serverError: { notOpen: string } } } }).s67.dealShapePanel.serverError
        .notOpen,
    ).toContain("S7");
    expect(
      (en.stages as { s67: { dealShapePanel: { serverError: { notOpen: string } } } }).s67.dealShapePanel.serverError
        .notOpen,
    ).toContain("S7");
  });
  test("ko and en carry the same keys, none empty", () => {
    const k = (ko.stages as { s67: { dealShapePanel: unknown } }).s67.dealShapePanel;
    const e = (en.stages as { s67: { dealShapePanel: unknown } }).s67.dealShapePanel;
    expect(keys(k).sort()).toEqual(keys(e).sort());
    for (const key of keys(k)) expect(key.length).toBeGreaterThan(0);
    for (const o of [k, e])
      for (const key of keys(o))
        expect(
          String(key.split(".").reduce((a: unknown, p) => (a as Record<string, unknown>)[p], o)).length,
        ).toBeGreaterThan(0);
  });
});

describe("gate snapshot link to the panel", () => {
  const snapshot = {
    gate: "pre_fs",
    kill: {
      triggered: [],
      unassessed: [
        {
          key: V.DEAL_SHAPE_KILL_KEY,
          procedure: "deal-shape-chain",
          criterion_id: "no_viable_deal_shape",
          title: "No deal shape",
          action: "mark_conditional",
        },
      ],
      inert: 0,
      inert_list: [],
    },
    rag: null,
    validators: null,
    nonwaivable_open: [],
    wacc: null,
    waivers: { active: [], expiring_14d: [] },
    ladder: { prior_gate: null, prior_decision: null, effective: true, blocker: null },
    ai: null,
    required_acks: [
      {
        key: V.DEAL_SHAPE_KILL_KEY,
        kind: "kill_unassessed",
        procedure: "deal-shape-chain",
        criterion_id: "no_viable_deal_shape",
        action: "mark_conditional",
      },
    ],
    hard_blocks: [],
  };
  const block = (dealId?: string, locale: "ko" | "en" = "ko") =>
    render(
      createElement(GateAckBlock, {
        snapshot,
        state: EMPTY_ACK_STATE,
        onChange: () => {},
        problems: null,
        decision: "go",
        divergence: null,
        notice: null,
        dealId,
      }),
      locale,
    );
  test("the unassessed #9 row links to the S7 panel anchor", () => {
    const html = block("opp 1");
    expect(html).toContain('data-testid="deal-shape-link"');
    expect(html).toContain('href="/deals/opp%201/s7#deal-shape-panel"');
    expect(html).toContain("진출 형태 평가를 기록하러 가기");
    expect(block("opp-1", "en")).toContain("Go to the deal-shape evaluation");
  });
  test("no deal id, no link; other unassessed rows never get it", () => {
    expect(block()).not.toContain("deal-shape-link");
  });
});

describe("mount points (source pins)", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const src = (rel: string) => readFileSync(`${import.meta.dir}/${WEB}/${rel}`, "utf8");
  test("S4 route decision no longer mounts the panel", () => {
    expect(src("components/stages/route-decision/RouteDecisionStage.tsx")).not.toContain("DealShapePanel");
  });
  test("S7 mounts it in the shortlist section before the gate decision, only when asked (S7 tab, not S6)", () => {
    const section = src("components/stages/brownfield/ShortlistSection.tsx");
    expect(section).toContain("<S7DecisionTabs");
    expect(section).toContain("dealShapePanel &&");
    const tabs = src("components/stages/brownfield/S7DecisionTabs.tsx");
    const at = tabs.indexOf("<DealShapePanel");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(tabs.indexOf("<GateDecisionPanel"));
    expect(src("app/deals/[id]/[stage]/page.tsx")).toContain('dealShapePanel={stageId === "S7"}');
    expect(src("components/stages/brownfield/BrownfieldStage.tsx")).toContain(
      "dealShapePanel={props0.dealShapePanel === true}",
    );
  });
});
