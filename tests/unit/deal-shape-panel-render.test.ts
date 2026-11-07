// ADR-0194 item A (PR-1): the S4 deal-shape evaluation panel renders as designed (design 2026-11-07-kill-data-sources §3.6).
// Status line (null is unassessed, never zero), verdicts as icon + text, "not evaluated" shapes, human-only recording
// (empty form, no AI pre-fill, viewer read-only), history collapsed, ko/en parity, and the link from the #9 snapshot row.
import { describe, expect, test } from "bun:test";

const WEB = "../../app/web-next";
const { renderToStaticMarkup } = (await import(`${WEB}/node_modules/react-dom/server.js`)) as { renderToStaticMarkup: (el: unknown) => string };
const { createElement } = (await import(`${WEB}/node_modules/react/index.js`)) as { createElement: (type: unknown, props: unknown, ...c: unknown[]) => unknown };
const { NextIntlClientProvider } = (await import(`${WEB}/node_modules/next-intl`)) as { NextIntlClientProvider: unknown };
const ko = (await import(`${WEB}/locales/ko.json`)).default as Record<string, unknown>;
const en = (await import(`${WEB}/locales/en.json`)).default as Record<string, unknown>;
const { DealShapePanelView } = (await import(`${WEB}/components/stages/route-decision/DealShapePanel.tsx`)) as { DealShapePanelView: unknown };
const { GateAckBlock } = (await import(`${WEB}/components/GateSnapshotAck.tsx`)) as { GateAckBlock: unknown };
const { EMPTY_ACK_STATE } = (await import(`${WEB}/lib/gate-ack-view.ts`)) as { EMPTY_ACK_STATE: unknown };
const V = await import(`${WEB}/lib/deal-shape-view.ts`);

const SHAPES = ["full_acquisition", "majority_stake", "spv", "holdco_route", "joint_venture", "minority_stake", "license_in", "co_development"];
const INTENTS = ["integration", "capability_access"];

const render = (el: unknown, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" }, el));

const row = (shape: string, viable: boolean, over: Record<string, unknown> = {}) => ({
  id: `r-${shape}`, opportunity_id: "o1", shape, intent: "integration", viable, rationale: `reason for ${shape}`, evidence_ref: null,
  evaluated_by: "user-7", evaluated_at: "2026-11-07T01:00:00.000Z", superseded_by: null, ...over,
});
const data = (live: ReturnType<typeof row>[], over: Record<string, unknown> = {}) => ({
  opportunity_id: "o1", live, history: live, unevaluated_shapes: SHAPES.filter((s) => !live.some((r) => r.shape === s)),
  viable_count: live.length === 0 ? null : live.filter((r) => r.viable).length, vocabulary: { shapes: SHAPES, intents: INTENTS }, ...over,
});
const view = (d: unknown, over: Record<string, unknown> = {}, locale: "ko" | "en" = "ko") => render(createElement(DealShapePanelView, {
  data: d, loadError: null, canAct: true, form: V.EMPTY_DEAL_SHAPE_FORM, onForm: () => {}, onSubmit: () => {}, onEdit: () => {},
  busy: false, problem: null, serverError: null, notice: null, loadedFromRow: false, ...over,
}), locale);

describe("view logic", () => {
  test("viableStatus: null is unassessed (never zero), a recorded 0 triggers, >=1 counts", () => {
    expect(V.viableStatus(null)).toEqual({ kind: "unassessed" });
    expect(V.viableStatus(0)).toEqual({ kind: "triggered" });
    expect(V.viableStatus(3)).toEqual({ kind: "viable", count: 3 });
  });
  test("shapeVerdictRows keeps vocabulary order and marks shapes without a live row unevaluated", () => {
    const rows = V.shapeVerdictRows(data([row("spv", true), row("license_in", false)]));
    expect(rows.map((r: { shape: string }) => r.shape)).toEqual(SHAPES);
    expect(rows.find((r: { shape: string }) => r.shape === "spv").state).toBe("viable");
    expect(rows.find((r: { shape: string }) => r.shape === "license_in").state).toBe("not_viable");
    expect(rows.filter((r: { state: string }) => r.state === "unevaluated").length).toBe(6);
  });
  test("form validation follows field order; the verdict has no default; the body carries no evaluator", () => {
    const f = V.EMPTY_DEAL_SHAPE_FORM;
    expect(f.viable).toBeNull();
    expect(V.validateDealShapeForm(f)).toBe("shape");
    expect(V.validateDealShapeForm({ ...f, shape: "spv" })).toBe("intent");
    expect(V.validateDealShapeForm({ ...f, shape: "spv", intent: "integration" })).toBe("viable");
    expect(V.validateDealShapeForm({ ...f, shape: "spv", intent: "integration", viable: false, rationale: "   " })).toBe("rationale");
    expect(V.validateDealShapeForm({ ...f, shape: "spv", intent: "integration", viable: false, rationale: "x".repeat(2001) })).toBe("rationaleTooLong");
    expect(V.validateDealShapeForm({ ...f, shape: "spv", intent: "integration", viable: true, rationale: "ok", evidenceRef: "y".repeat(2001) })).toBe("evidenceTooLong");
    const ok = { ...f, shape: "spv", intent: "capability_access", viable: false, rationale: "  no  ", evidenceRef: "  " };
    expect(V.validateDealShapeForm(ok)).toBeNull();
    expect(V.buildDealShapeBody(ok)).toEqual({ shape: "spv", intent: "capability_access", viable: false, rationale: "no" });
    expect(V.buildDealShapeBody({ ...ok, evidenceRef: " doc-1 " }).evidence_ref).toBe("doc-1");
  });
  test("error envelope maps to a message kind", () => {
    expect(V.dealShapeErrorKind(403, "role_required")).toBe("viewer");
    expect(V.dealShapeErrorKind(403, "role_forbidden")).toBe("admin");
    expect(V.dealShapeErrorKind(404, "not_found")).toBe("notFound");
    expect(V.dealShapeErrorKind(400, "invalid_request")).toBe("invalid");
    expect(V.dealShapeErrorKind(500, "internal")).toBe("other");
  });
});

describe("status line", () => {
  test("nothing recorded: unassessed text, every shape not evaluated, no verdict chip", () => {
    const html = view(data([]));
    expect(html).toContain("아직 기록된 평가가 없습니다 — 중단 조건 #9는 평가 전으로 남습니다");
    expect(html).toContain('data-status="unassessed"');
    expect(html).not.toContain("가능한 형태 0건");
    expect(html.match(/data-state="unevaluated"/g)?.length).toBe(8);
  });
  test("zero viable: warning that #9 is triggered, conditional, with an icon", () => {
    const html = view(data([row("spv", false), row("license_in", false)]));
    expect(html).toContain('data-status="triggered"');
    expect(html).toContain("중단 조건 #9에 해당합니다(조건부 표시)");
    expect(html).toContain('<span aria-hidden="true">⚠</span>');
  });
  test("one or more viable: count line", () => {
    const html = view(data([row("spv", true), row("license_in", false), row("joint_venture", true)]));
    expect(html).toContain('data-status="viable"');
    expect(html).toContain("가능한 형태 2건 (평가한 3건 중, 전체 8건)");
  });
});

describe("shape rows", () => {
  const html = view(data([row("spv", true, { evidence_ref: "doc-9" }), row("license_in", false, { intent: "capability_access" })]));
  test("verdicts are icon plus text, not colour alone", () => {
    expect(html).toContain('<span aria-hidden="true">✓</span> 가능');
    expect(html).toContain('<span aria-hidden="true">✕</span> 불가');
    expect(html).toContain('<span aria-hidden="true">○</span> 평가 전');
  });
  test("shape and intent labels are localized (existing S10 wording reused, two new keys added)", () => {
    for (const label of ["전량 인수", "과반 지분", "SPC/SPV(목적법인)", "홀딩스 경유(holdco)", "합작(JV)", "소수 지분", "라이선스 도입", "공동 개발"]) expect(html).toContain(label);
    expect(html).toContain("역량접근");
    expect(html).not.toContain(">full_acquisition<");
    const enHtml = view(data([row("spv", true)]), {}, "en");
    for (const label of ["Full acquisition", "Majority stake", "Joint venture (JV)", "Minority stake", "License-in", "Co-development"]) expect(enHtml).toContain(label);
  });
  test("a recorded row shows rationale, evidence, who and when", () => {
    expect(html).toContain("reason for spv");
    expect(html).toContain("근거 자료: doc-9");
    expect(html).toContain("user-7 · ");
  });
});

describe("human-only recording", () => {
  test("states that no AI suggestion is pre-filled, and the form starts empty with required fields marked", () => {
    const html = view(data([]));
    expect(html).toContain("AI 제안을 미리 채우지 않습니다");
    const form = html.match(/<form[\s\S]*?<\/form>/)![0];
    expect(form).not.toContain("checked");
    expect(form).toContain('aria-required="true"');
    expect(form.match(/<textarea[^>]*>[^<]*<\/textarea>/)![0]).toMatch(/><\/textarea>$/);
    expect(form).toContain("근거 (필수, 2000자 이내)");
    expect(form).toContain("평가 기록");
  });
  test("the page keeps one primary action: the record button is not btn-primary", () => {
    expect(view(data([]))).not.toContain("btn-primary");
  });
  test("a viewer or admin gets the read-only note and no form or edit buttons", () => {
    const html = view(data([row("spv", true)]), { canAct: false });
    expect(html).toContain('data-testid="deal-shape-readonly"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain("수정");
  });
  test("an editor sees an edit button per recorded shape only", () => {
    const html = view(data([row("spv", true)]));
    expect(html.match(/수정</g)?.length).toBe(1);
  });
  test("problem and server error render as alerts with an icon", () => {
    const html = view(data([]), { problem: "rationale", serverError: "boom" });
    expect(html).toContain("근거를 적어야 기록할 수 있습니다.");
    expect(html).toContain('data-testid="deal-shape-server-error"');
  });
});

describe("history and load errors", () => {
  test("history is a collapsed details listing only superseded rows", () => {
    const old = row("spv", false, { id: "old", superseded_by: "r-spv", rationale: "old reason" });
    const d = data([row("spv", true)], { history: [row("spv", true), old] });
    const html = view(d);
    const hist = html.match(/<details[^>]*data-testid="deal-shape-history"[\s\S]*?<\/details>/)![0];
    expect(hist).not.toContain("open=");
    expect(hist).toContain("평가 이력 (1건)");
    expect(hist).toContain("old reason");
    expect(view(data([row("spv", true)]))).not.toContain("deal-shape-history");
  });
  test("a 403 admin load error is explained and renders no form", () => {
    const html = view(null, { loadError: "admin" });
    expect(html).toContain("관리자 역할은 사업 내용을 볼 수 없습니다");
    expect(html).not.toContain("<form");
  });
});

describe("catalog", () => {
  const keys = (o: unknown, prefix = ""): string[] => Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
  test("ko and en carry the same keys, none empty", () => {
    const k = (ko.stages as { s4: { dealShapePanel: unknown } }).s4.dealShapePanel;
    const e = (en.stages as { s4: { dealShapePanel: unknown } }).s4.dealShapePanel;
    expect(keys(k).sort()).toEqual(keys(e).sort());
    for (const key of keys(k)) expect(key.length).toBeGreaterThan(0);
    for (const o of [k, e]) for (const key of keys(o)) expect(String(key.split(".").reduce((a: any, p) => a[p], o as any)).length).toBeGreaterThan(0);
  });
});

describe("gate snapshot link to the panel", () => {
  const snapshot = {
    gate: "pre_fs",
    kill: { triggered: [], unassessed: [{ key: V.DEAL_SHAPE_KILL_KEY, procedure: "deal-shape-chain", criterion_id: "no_viable_deal_shape", title: "No deal shape", action: "mark_conditional" }], inert: 0, inert_list: [] },
    rag: null, validators: null, nonwaivable_open: [], wacc: null, waivers: { active: [], expiring_14d: [] },
    ladder: { prior_gate: null, prior_decision: null, effective: true, blocker: null }, ai: null,
    required_acks: [{ key: V.DEAL_SHAPE_KILL_KEY, kind: "kill_unassessed", procedure: "deal-shape-chain", criterion_id: "no_viable_deal_shape", action: "mark_conditional" }],
    hard_blocks: [],
  };
  const block = (dealId?: string, locale: "ko" | "en" = "ko") => render(createElement(GateAckBlock, {
    snapshot, state: EMPTY_ACK_STATE, onChange: () => {}, problems: null, decision: "go", divergence: null, notice: null, dealId,
  }), locale);
  test("the unassessed #9 row links to the S4 panel anchor", () => {
    const html = block("opp 1");
    expect(html).toContain('data-testid="deal-shape-link"');
    expect(html).toContain('href="/deals/opp%201/s4#deal-shape-panel"');
    expect(html).toContain("진출 형태 평가를 기록하러 가기");
    expect(block("opp-1", "en")).toContain("Go to the deal-shape evaluation");
  });
  test("no deal id, no link; other unassessed rows never get it", () => {
    expect(block()).not.toContain("deal-shape-link");
  });
});
