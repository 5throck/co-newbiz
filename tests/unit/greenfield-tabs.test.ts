// @version 1.0.0
/**
 * S5 Green Field tabs (presentation only): tab list/order, URL parser, dirty aggregation,
 * 출처 요약, completion checklist, and source-structure assertions (panel contents,
 * always-mounted panels, staffing save wiring). Nothing exercised in a browser.
 */
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aggregateDirty, buildCompletionChecklist, buildSourceSummary, dirtyIndicatorText, filledComponentCount, GF_TAB_KEYS, GF_TAB_LABELS, parseGfTab, tabMarker } from "../../app/web-next/lib/greenfield-tabs.ts";

const WEB = join(import.meta.dirname, "../../app/web-next");
const stage = readFileSync(join(WEB, "components/stages/GreenfieldStage.tsx"), "utf8");
const tabNav = readFileSync(join(WEB, "components/TabNav.tsx"), "utf8");

describe("tab list and URL parser", () => {
  test("six tabs, exact labels, dependency order", () => {
    expect(GF_TAB_KEYS.map((k) => GF_TAB_LABELS[k])).toEqual(["진출전략", "필요 역량", "인력 운영 계획", "투자비", "투자 시뮬레이션", "검토/확정"]);
    expect([...GF_TAB_KEYS]).toEqual(["entry", "capability", "staffing", "investment", "simulation", "review"]);
  });
  test("parseGfTab: known keys pass, unknown/empty/null fall back to entry, #suffix ignored", () => {
    for (const k of GF_TAB_KEYS) expect(parseGfTab(k)).toBe(k);
    expect(parseGfTab(null)).toBe("entry");
    expect(parseGfTab(undefined)).toBe("entry");
    expect(parseGfTab("")).toBe("entry");
    expect(parseGfTab("nope")).toBe("entry");
    expect(parseGfTab("investment#item")).toBe("investment");
  });
});

describe("aggregateDirty", () => {
  test("empty and all-false flags", () => {
    expect(aggregateDirty({}).count).toBe(0);
    expect(dirtyIndicatorText(aggregateDirty({ entry: false }))).toBeNull();
  });
  test("counts sections, lists tab labels in tab order", () => {
    const a = aggregateDirty({ review: true, entry: true, staffing: true, capability: false });
    expect(a.count).toBe(3);
    expect(a.tabs).toEqual(["entry", "staffing", "review"]);
    expect(a.labels).toEqual(["진출전략", "인력 운영 계획", "검토/확정"]);
    expect(dirtyIndicatorText(a)).toBe("저장하지 않은 변경 3곳");
  });
});

describe("buildSourceSummary", () => {
  test("four chips with text and a jump target each", () => {
    const c = buildSourceSummary({ reflectedCapabilityCount: 2, staffingKrwM: 1234.5, manualCount: 3, needsConfirmCount: 1 });
    expect(c.map((x) => x.text)).toEqual(["역량 2건 반영", "인력 운영 계획 인건비 1,234.5백만원", "수동 항목 3건", "확인 필요 1건"]);
    expect(c.map((x) => x.tab)).toEqual(["capability", "staffing", "investment", "investment"]);
    expect(buildSourceSummary({ reflectedCapabilityCount: 0, staffingKrwM: 0, manualCount: 0, needsConfirmCount: 0 })[1].text).toBe("인력 운영 계획 인건비 0백만원");
  });
});

describe("completion checklist", () => {
  const base = { entry: { filled: true, dirty: false }, capability: { filled: true, dirty: false, issues: 0 }, staffing: { filled: false, dirty: false, issues: 0 }, investment: { filled: true, dirty: false, issues: 2 } };
  test("status precedence: dirty > empty > issues > filled", () => {
    const rows = buildCompletionChecklist({ ...base, capability: { filled: true, dirty: true, issues: 3 } });
    expect(rows.map((r) => r.status)).toEqual(["filled", "dirty", "empty", "issues"]);
    expect(rows.map((r) => r.statusText)).toEqual(["채움", "저장 전 변경", "미입력", "확인 필요 2건"]);
    expect(rows.map((r) => r.tab)).toEqual(["entry", "capability", "staffing", "investment"]);
  });
  test("counter N/4 counts components with content", () => {
    expect(filledComponentCount(buildCompletionChecklist(base))).toBe(3);
  });
  test("tab markers: dirty, issues, done, none", () => {
    expect(tabMarker({ status: "dirty", issues: 0 })).toEqual({ kind: "dirty", text: "저장 전 변경" });
    expect(tabMarker({ status: "issues", issues: 4 })).toEqual({ kind: "issues", text: "확인 필요 4" });
    expect(tabMarker({ status: "filled", issues: 0 }).kind).toBe("done");
    expect(tabMarker({ status: "empty", issues: 0 }).kind).toBe("none");
    expect(tabMarker(null).kind).toBe("none");
  });
});

describe("GreenfieldStage tab structure (source)", () => {
  const slice = (from: string, to: string) => stage.slice(stage.indexOf(from), stage.indexOf(to));
  test("tablist semantics come from TabNav; default tab is entry via the parser", () => {
    expect(tabNav).toContain('role="tablist"');
    expect(tabNav).toContain("aria-selected");
    expect(stage).toContain("<TabNav");
    expect(stage).toContain("parseGfTab(searchParams.get(\"tab\"))");
    expect(stage).toContain("GF_TAB_KEYS.map");
  });
  test("every panel is a role=tabpanel that is hidden, not unmounted", () => {
    expect(stage).toContain('role="tabpanel"');
    expect(stage).toContain("hidden={tab !== key}");
    expect(stage).not.toMatch(/\{tab === "(entry|capability|staffing|investment|simulation|review)" && /);
    for (const k of GF_TAB_KEYS) expect(stage).toContain(`panel("${k}"`);
  });
  test("panels hold the right sections in dependency order", () => {
    const order = GF_TAB_KEYS.map((k) => stage.indexOf(`panel("${k}"`));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(slice('panel("entry"', 'panel("capability"')).toContain("<EntryStrategySection");
    const cap = slice('panel("capability"', 'panel("staffing"');
    expect(cap).toContain("<CapabilityJudgementEditor");
    expect(cap).toContain("S3 레지스터에 저장");
    const staff = slice('panel("staffing"', 'panel("investment"');
    expect(staff).toContain("<StaffingPlanSection");
    expect(staff).toContain("이 버튼은 인력 운영 계획과 함께 투자비 항목 전체를 저장합니다");
    expect(staff).toContain('{linesSaveButton("인건비 항목 저장")}');
    const inv = slice('panel("investment"', 'panel("simulation"');
    for (const s of ["invest-source-summary", "s5-horizon", "<CapabilityCostBlock", 'data-testid="invest-item-list"', 'data-testid="invest-summary"', "투자비 항목 추천", '{linesSaveButton("투자비 항목 저장")}']) expect(inv).toContain(s);
    expect(inv).not.toContain("<StaffingPlanSection");
    // Order (decider): 출처 요약, 투자비 항목 추천 (AI) at the top, the item table (+ save bar, 검토 기간 in its header),
    // then 역량 해소 비용, then 투자비 요약 (tiles, charts, yearly and by-category tables) last.
    const at = (needle: string) => inv.indexOf(needle);
    expect(at('data-testid="invest-source-summary"')).toBeLessThan(at('data-testid="invest-reco"'));
    expect(at('data-testid="invest-reco"')).toBeLessThan(at("투자비 항목 (S8 사업성 분석 입력)"));
    expect(at("투자비 항목 (S8 사업성 분석 입력)")).toBeLessThan(at('data-testid="invest-item-save-actions"'));
    expect(at('data-testid="invest-item-save-actions"')).toBeLessThan(at('data-testid="invest-item-list"'));
    expect(at('data-testid="invest-item-list"')).toBeLessThan(at("<CapabilityCostBlock"));
    expect(at("<CapabilityCostBlock")).toBeLessThan(at('data-testid="invest-summary"'));
    expect(at('data-testid="invest-summary"')).toBeLessThan(at('data-testid="invest-summary-schedule"'));
    expect(at("s5-horizon")).toBeLessThan(at('data-testid="invest-item-list"'));
    expect(inv).toContain('aria-expanded={recoOpen}');
    // Charts mount only while the investment tab is active.
    expect(inv).toContain('{investTabActive && <InvestmentSummaryCharts summary={summary} />}');
    const sim = slice('panel("simulation"', 'panel("review"');
    expect(sim).toContain("구현 예정 (ADR-0176)");
    const rev = stage.slice(stage.indexOf('panel("review"'));
    for (const s of ['aria-label="평가 근거"', "타당성 검토 실행", "gf-checklist", "<GateDecisionPanel", 'gates={["pre_fs"]}']) expect(rev).toContain(s);
  });
  test("one save handler for 투자비 항목 저장 (no duplicated logic)", () => {
    expect(stage.match(/void saveInvestmentLines\(\)/g)?.length).toBe(1);
    expect(stage.match(/const linesSaveButton/g)?.length).toBe(1);
  });
  test("top-level unsaved indicator aggregates the per-section flags", () => {
    expect(stage).toContain("aggregateDirty({ entry: entryIsDirty, capability: judgeDirty, staffing: staffDirty");
    expect(stage).toContain('data-testid="gf-dirty-indicator"');
  });
});
