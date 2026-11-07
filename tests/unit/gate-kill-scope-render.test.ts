// ADR-0193 PR-C: the stage-scoped kill criteria surfaces render as designed (design 2026-11-07, UI section and 12/13).
// Not-reached group: collapsed, no checkbox, not counted in the items to confirm. Carried items and hard blocks carry text + icon.
import { describe, expect, test } from "bun:test";

const WEB = "../../app/web-next";
const { renderToStaticMarkup } = (await import(`${WEB}/node_modules/react-dom/server.js`)) as { renderToStaticMarkup: (el: unknown) => string };
const { createElement } = (await import(`${WEB}/node_modules/react/index.js`)) as { createElement: (type: unknown, props: unknown, ...c: unknown[]) => unknown };
const { NextIntlClientProvider } = (await import(`${WEB}/node_modules/next-intl`)) as { NextIntlClientProvider: unknown };
const ko = (await import(`${WEB}/locales/ko.json`)).default as Record<string, unknown>;
const en = (await import(`${WEB}/locales/en.json`)).default as Record<string, unknown>;
const { GateSnapshotSummary, GateAckBlock } = (await import(`${WEB}/components/GateSnapshotAck.tsx`)) as { GateSnapshotSummary: unknown; GateAckBlock: unknown };
const { KillCarriesPanel } = (await import(`${WEB}/components/KillCarriesPanel.tsx`)) as { KillCarriesPanel: unknown };
const { EMPTY_ACK_STATE } = (await import(`${WEB}/lib/gate-ack-view.ts`)) as { EMPTY_ACK_STATE: unknown };

const render = (el: unknown, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" }, el));

const item = (id: string, over: Record<string, unknown> = {}) => ({ key: `p:${id}`, procedure: "p", criterion_id: id, title: `Title ${id}`, action: "halt", ...over });
const carry = (id: string, closure: string, over: Record<string, unknown> = {}) => ({
  key: `p:${id}`, title: `Title ${id}`, from_decision_id: "d1", outcome: closure === "open" ? "unassessed" : "false", reason: null, closure,
  action: "halt", evaluable_from: "S5", reevaluate_at: "pre_fs", route_decision_id: null, implicit: false, ...over,
});
const snapshot = (kill: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  gate: "screening",
  kill: { triggered: [], unassessed: [], inert: 0, inert_list: [], ...kill },
  rag: null, validators: null, nonwaivable_open: [], wacc: null,
  waivers: { active: [], expiring_14d: [] },
  ladder: { prior_gate: null, prior_decision: null, effective: true, blocker: null },
  ai: null, required_acks: [], hard_blocks: [], ...extra,
});
const gateLabel = (g: string) => g;

describe("GateSnapshotSummary kill-scope notes", () => {
  const html = render(createElement(GateSnapshotSummary, {
    gateLabel,
    snapshot: snapshot({
      not_reached: [{ ...item("a"), evaluable_from: "S5", reevaluate_at: "pre_fs" }, { ...item("b", { action: "mark_conditional" }), evaluable_from: "S6", reevaluate_at: "target_screening" }],
      carried_in: [carry("c", "open"), carry("d", "evaluated"), carry("e", "open_monitoring", { reevaluate_at: "open_monitoring", evaluable_from: "S12" }), carry("f", "out_of_track", { route_decision_id: "rd-9" })],
      scheduled: [{ ...item("g"), evaluable_from: "S4", reevaluate_at: "pre_fs", status: "pending" }],
      caveats: [{ key: "p:zzz", caveat: "server caveat text" }],
      triggered: [item("t", { binding: true, override_id: null, partial_input: true })],
    }),
  }));
  test("not-reached group is collapsed, lists title, action and stage/gate, and has no checkbox", () => {
    const group = html.match(/<details[^>]*data-testid="kill-not-reached"[\s\S]*?<\/details>/)![0];
    expect(group).not.toContain("open=");
    expect(group).toContain("아직 도달하지 않음 (2건)");
    expect(group).toContain("S5부터 평가 · pre_fs 게이트에서 재평가");
    expect(group).toContain("S6부터 평가 · target_screening 게이트에서 재평가");
    expect(group).toContain("Title a");
    expect(group).not.toContain("<input");
    expect(html).not.toContain("checkbox");
  });
  test("not-reached items are not counted as unassessed (the chip still says 0) and get their own neutral chip", () => {
    expect(html).toContain("평가 못 함 0건");
    expect(html).toContain("아직 도달 안 함 2건");
  });
  test("carried-in line shows count and closed count; every closure state is text plus icon", () => {
    expect(html).toContain("이전 게이트에서 넘어온 항목 4건 (닫힘 2건)");
    for (const [text, icon] of [["평가함", "✓"], ["평가 못 함", "⚠"], ["인수 후 데이터 대기", "◐"], ["경로 밖", "↷"]] as const) expect(html).toContain(`<span aria-hidden="true">${icon}</span> ${text}`);
    expect(html).toContain("경로 결정 rd-9로 닫힘");
    // an open carry opens the list so it cannot hide
    expect(html.match(/<details[^>]*data-testid="kill-carried-in"/)![0]).toContain("open");
  });
  test("scheduled criteria read as pending at their gate", () => {
    expect(html).toContain("pre_fs 게이트에서 평가 예정");
    expect(html).toContain("평가 예정 (1건)");
  });
  test("partial-input chip on a triggered item and the note that it stays triggered", () => {
    expect(html).toContain("입력 일부");
    expect(html).toContain("그래도 발동으로 다룹니다");
    expect(html).toContain("Title t");
  });
  test("a caveat on a criterion that no other list shows still appears", () => {
    expect(html).toContain("server caveat text");
  });
  test("renders nothing extra for a legacy snapshot and in English", () => {
    const legacy = render(createElement(GateSnapshotSummary, { gateLabel, snapshot: snapshot({}) }));
    expect(legacy).not.toContain("gate-kill-scope");
    const enHtml = render(createElement(GateSnapshotSummary, { gateLabel, snapshot: snapshot({ not_reached: [{ ...item("a"), evaluable_from: "S5", reevaluate_at: "pre_fs" }] }) }), "en");
    expect(enHtml).toContain("Not reached yet (1)");
    expect(enHtml).toContain("Evaluated from S5 · re-checked at the pre_fs gate");
  });
});

describe("GateAckBlock with a not-reached item present", () => {
  const view = snapshot(
    { not_reached: [{ ...item("a"), evaluable_from: "S5", reevaluate_at: "pre_fs" }], unassessed: [item("u")], triggered: [item("t", { binding: false, override_id: null, partial_input: true, action: "mark_conditional" })], caveats: [{ key: "p:t", caveat: "caveat on t" }] },
    { required_acks: [{ key: "p:u", kind: "kill_unassessed", procedure: "p", criterion_id: "u", action: "halt" }, { key: "p:t", kind: "kill_triggered", procedure: "p", criterion_id: "t", action: "mark_conditional" }] },
  );
  const html = render(createElement(GateAckBlock, { snapshot: view, state: EMPTY_ACK_STATE, onChange: () => {}, problems: null, decision: "go", divergence: null, notice: null }));
  test("only the real required items get a checkbox or reason field; the not-reached key does not", () => {
    expect(html.match(/type="checkbox"/g)?.length).toBe(2); // select-all + the one unassessed item
    expect(html).not.toContain("Title a");
  });
  test("the triggered item shows the partial-input chip and its caveat next to it", () => {
    expect(html).toContain("입력 일부");
    expect(html).toContain("caveat on t");
  });
});

describe("hard blocks for the ADR-0193 codes (ko and en)", () => {
  const block = (code: string, keys: string[], locale: "ko" | "en") => render(createElement(GateAckBlock, {
    snapshot: snapshot({ carried_in: [carry("c", "open")] }, { hard_blocks: [{ code, keys, enforced: true }], entity: undefined }),
    state: EMPTY_ACK_STATE, onChange: () => {}, problems: null, decision: "go", divergence: null, notice: null,
  }), locale);
  for (const code of ["kill_carry_overdue", "kill_carry_unassessed", "kill_lineage_missing", "kill_enforce_unsafe"]) {
    test(`${code} renders catalog title and body in both locales`, () => {
      for (const locale of ["ko", "en"] as const) {
        const html = block(code, ["p:c"], locale);
        expect(html).toContain(`data-block-code="${code}"`);
        expect(html).not.toContain("hardBlock."); // no raw catalog key leaks
        expect(html).toContain("⛔");
      }
    });
  }
  test("the lineage block names the repair in Korean and lists no keys", () => {
    const html = block("kill_lineage_missing", ["proj-1"], "ko");
    expect(html).toContain("프로모션");
    expect(html).toContain("관리자에게 연결 요청");
    expect(html).not.toContain("proj-1");
  });
  test("a carry block lists the criterion by name", () => {
    expect(block("kill_carry_unassessed", ["p:c"], "ko")).toContain("Title c");
  });
});

describe("IC package KillCarriesPanel", () => {
  const row = (id: string, closure: string) => ({ key: `p:${id}`, title: `Title ${id}`, action: "halt", outcome: "unassessed", closure, reason: null, evaluable_from: "S9", reevaluate_at: "entity_ic", from_decision_id: "d" });
  test("null is shown as not computable, never as none", () => {
    const html = render(createElement(KillCarriesPanel, { carries: null }));
    expect(html).toContain("ic-kill-carries-unavailable");
    expect(html).not.toContain("ic-kill-carries-none");
  });
  test("an older response without the field renders nothing", () => {
    expect(render(createElement(KillCarriesPanel, { carries: undefined }))).toBe("");
  });
  test("open and open-monitoring carries are listed by name with text + icon chips", () => {
    const html = render(createElement(KillCarriesPanel, { carries: { gate: "entity_ic", open: [row("a", "open")], open_monitoring: [row("b", "open_monitoring")] } }));
    expect(html).toContain("Title a");
    expect(html).toContain("Title b");
    expect(html).toContain('<span aria-hidden="true">⚠</span> 평가 못 함');
    expect(html).toContain('<span aria-hidden="true">◐</span> 인수 후 데이터 대기');
  });
  test("empty lists say nothing is open for that gate", () => {
    expect(render(createElement(KillCarriesPanel, { carries: { gate: "entity_ic", open: [], open_monitoring: [] } }))).toContain("ic-kill-carries-none");
  });
});
