// @version 1.0.0
/**
 * S5 Green Field tabs (presentation only): tab list/order, URL parser, dirty aggregation,
 * 출처 요약, completion checklist, and source-structure assertions (panel contents,
 * always-mounted panels, staffing save wiring). Nothing exercised in a browser.
 */
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { normSrc } from "./helpers/src-normalize.ts";
import { join } from "node:path";
import {
  aggregateDirty,
  buildCompletionChecklist,
  buildSourceSummary,
  dirtyIndicatorText,
  filledComponentCount,
  GF_TAB_KEYS,
  parseGfTab,
  simRerunNeeded,
  statusParts,
  tabMarker,
} from "../../app/web-next/lib/greenfield-tabs.ts";

// Catalog-backed test translator: resolves stages.s5.tabs.* keys exactly like the render sites do.
const tabs = (await import("../../app/web-next/locales/ko.json")).default as unknown as {
  stages: { s5: { tabs: Record<string, string> } };
};
const TABS = tabs.stages.s5.tabs;
const tf = (key: string, values: Record<string, string | number> = {}): string => {
  let out: string = TABS[key] ?? "";
  for (const [k, v] of Object.entries(values ?? {})) out = out.replaceAll(`{${k}}`, String(v));
  return out;
};

const WEB = join(import.meta.dirname, "../../app/web-next");
const stage = normSrc(readFileSync(join(WEB, "components/stages/GreenfieldStage.tsx"), "utf8"));
const tabNav = readFileSync(join(WEB, "components/TabNav.tsx"), "utf8");

describe("tab list and URL parser", () => {
  test("six tabs, exact labels, dependency order", () => {
    expect(GF_TAB_KEYS).toHaveLength(6); // labels resolve from stages.s5.tabs at the render site
    expect(tf("entry")).toBe("진출전략");
    expect(tf("review")).toBe("검토");
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
    expect(dirtyIndicatorText(aggregateDirty({ entry: false }), tf)).toBeNull();
  });
  test("counts sections, lists tab labels in tab order", () => {
    const a = aggregateDirty({ review: true, entry: true, staffing: true, capability: false });
    expect(a.count).toBe(3);
    expect(a.tabs).toEqual(["entry", "staffing", "review"]);
    expect(a.tabs.map((k) => tf(k))).toEqual(["진출전략", "인력 운영 계획", "검토"]);
    expect(dirtyIndicatorText(a, tf)).toBe("저장하지 않은 변경 3곳");
  });
});

describe("buildSourceSummary", () => {
  test("four chips with text and a jump target each", () => {
    const c = buildSourceSummary({
      reflectedCapabilityCount: 2,
      staffingKrwM: 1234.5,
      manualCount: 3,
      needsConfirmCount: 1,
    });
    expect(c.map((x) => tf(x.textKey, x.values))).toEqual([
      "역량 2건 반영",
      "인력 운영 계획 인건비 1,234.5백만원",
      "수동 항목 3건",
      "확인 필요 1건",
    ]);
    expect(c.map((x) => x.tab)).toEqual(["capability", "staffing", "investment", "investment"]);
    expect(
      tf(
        buildSourceSummary({ reflectedCapabilityCount: 0, staffingKrwM: 0, manualCount: 0, needsConfirmCount: 0 })[1]
          .textKey,
        { amount: "0" },
      ),
    ).toBe("인력 운영 계획 인건비 0백만원");
  });
});

describe("completion checklist", () => {
  const base = {
    entry: { filled: true, dirty: false },
    capability: { filled: true, dirty: false, issues: 0 },
    staffing: { filled: false, dirty: false, issues: 0 },
    investment: { filled: true, dirty: false, issues: 2 },
  };
  test("status precedence: dirty > empty > issues > filled", () => {
    const rows = buildCompletionChecklist({ ...base, capability: { filled: true, dirty: true, issues: 3 } });
    expect(rows.map((r) => r.status)).toEqual(["filled", "dirty", "empty", "issues"]);
    expect(rows.map((r) => tf(r.statusTextKey, r.statusTextValues))).toEqual([
      "채움",
      "저장 전 변경",
      "미입력",
      "확인 필요 2건",
    ]);
    expect(rows.map((r) => r.tab)).toEqual(["entry", "capability", "staffing", "investment"]);
  });
  test("counter N/4 counts components with content", () => {
    expect(filledComponentCount(buildCompletionChecklist(base))).toBe(3);
  });
  test("tab markers: dirty, issues, done, none", () => {
    expect(tabMarker({ status: "dirty", issues: 0 }, tf)).toEqual({ kind: "dirty", text: "저장 전 변경" });
    expect(tabMarker({ status: "issues", issues: 4 }, tf)).toEqual({ kind: "issues", text: "확인 필요 4" });
    expect(tabMarker({ status: "filled", issues: 0 }, tf).kind).toBe("done");
    expect(tabMarker({ status: "empty", issues: 0 }, tf).kind).toBe("none");
    expect(tabMarker(null, tf).kind).toBe("none");
  });
  test("statusParts returns catalog keys for all four statuses", () => {
    for (const st of ["dirty", "issues", "filled", "empty"] as const) {
      const p = statusParts(st, 7);
      expect(TABS[p.key]).toBeTruthy();
    }
  });
  test("simRerunNeeded: server stale or unsaved plan edits both demand a rerun (finding #4)", () => {
    expect(simRerunNeeded(true, false)).toBe(true);
    expect(simRerunNeeded(false, true)).toBe(true);
    expect(simRerunNeeded(true, true)).toBe(true);
    expect(simRerunNeeded(false, false)).toBe(false);
  });
});

describe("GreenfieldStage tab structure (source)", () => {
  const slice = (from: string, to: string) => stage.slice(stage.indexOf(normSrc(from)), stage.indexOf(normSrc(to)));
  test("tablist semantics come from TabNav; default tab is entry via the parser", () => {
    expect(tabNav).toContain(normSrc('role="tablist"'));
    expect(tabNav).toContain(normSrc("aria-selected"));
    // ARIA tabs pattern: roving tabindex — active tab 0, inactive -1 (2026-11-17 ruling).
    expect(tabNav).toContain(normSrc("tabIndex={t.key === active ? 0 : -1}"));
    expect(stage).toContain(normSrc("<TabNav"));
    expect(stage).toContain(normSrc('parseGfTab(searchParams.get("tab"))'));
    expect(stage).toContain(normSrc("GF_TAB_KEYS.map"));
  });
  test("every panel is a role=tabpanel that is hidden, not unmounted", () => {
    expect(stage).toContain(normSrc('role="tabpanel"'));
    expect(stage).toContain(normSrc("hidden={tab !== key}"));
    expect(stage).not.toMatch(/\{tab === "(entry|capability|staffing|investment|simulation|review)" &&\s*/);
    for (const k of GF_TAB_KEYS) expect(stage).toContain(normSrc(`panel("${k}"`));
  });
  test("panels hold the right sections in dependency order", () => {
    const order = GF_TAB_KEYS.map((k) => stage.indexOf(normSrc(`panel("${k}"`)));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(slice('panel("entry"', 'panel("capability"')).toContain(normSrc("<EntryStrategySection"));
    const cap = slice('panel("capability"', 'panel("staffing"');
    expect(cap).toContain(normSrc("<CapabilityJudgementEditor"));
    expect(cap).toContain(normSrc('t("saveToTheS3Register")')); // i18n: stages.s5.stage.saveToTheS3Register
    const staff = slice('panel("staffing"', 'panel("investment"');
    expect(staff).toContain(normSrc("<StaffingPlanSection"));
    expect(staff).toContain(normSrc('t("thisButtonSavesTheInvestment")')); // i18n: stages.s5.stage.thisButtonSavesTheInvestment
    expect(staff).toContain(normSrc('{linesSaveButton(t("saveLaborCostItems"))}'));
    const inv = slice('panel("investment"', 'panel("simulation"');
    for (const s of [
      "invest-source-summary",
      "s5-horizon",
      "<CapabilityCostBlock",
      'data-testid="invest-item-list"',
      'data-testid="invest-summary"',
      't("investmentItemRecommendation")',
      '{linesSaveButton(t("saveInvestmentItems"))}',
    ])
      expect(inv).toContain(normSrc(s));
    expect(inv).not.toContain(normSrc("<StaffingPlanSection"));
    expect(inv).not.toContain(normSrc("invest-summary-by-category"));
    expect(inv).not.toContain(normSrc("분류별 투자비 (단위"));
    // Order (decider): 출처 요약, 투자비 항목 추천 (AI) at the top, the item table (+ save bar, 검토 기간 in its header),
    // then 역량 해소 비용, then 투자비 요약 (tiles, charts, yearly table) last; no by-category table.
    const at = (needle: string) => inv.indexOf(normSrc(needle));
    expect(at('data-testid="invest-source-summary"')).toBeLessThan(at('data-testid="invest-reco"'));
    expect(at('data-testid="invest-reco"')).toBeLessThan(at('t("investmentItemsS8BusinessCase")'));
    // Decider 2026-10-15: add-item control directly under the heading (above the table); save area below the table, footer and notes.
    expect(at("s5-horizon")).toBeLessThan(at('t("addItem")'));
    expect(at("\uFF0B \uD56D\uBAA9 \uCD94\uAC00")).toBeLessThan(at('data-testid="invest-item-list"'));
    expect(at('data-testid="invest-item-list"')).toBeLessThan(at('data-testid="invest-item-footer"'));
    expect(at('data-testid="invest-item-footer"')).toBeLessThan(at('data-testid="invest-excluded-note"'));
    expect(at('data-testid="invest-excluded-note"')).toBeLessThan(at('data-testid="invest-item-save-actions"'));
    expect(at('data-testid="invest-item-save-actions"')).toBeLessThan(at('data-testid="invest-item-note"'));
    expect(at('data-testid="invest-item-note"')).toBeLessThan(at('data-testid="invest-item-error"'));
    expect(at('data-testid="invest-item-error"')).toBeLessThan(at("<CapabilityCostBlock"));
    expect(at("<CapabilityCostBlock")).toBeLessThan(at('data-testid="invest-summary"'));
    expect(at('data-testid="invest-summary"')).toBeLessThan(at('data-testid="invest-summary-schedule"'));
    expect(at("s5-horizon")).toBeLessThan(at('data-testid="invest-item-list"'));
    expect(inv).toContain(normSrc("aria-expanded={recoOpen}"));
    // Charts mount only while the investment tab is active.
    expect(inv).toContain(normSrc("{investTabActive && <InvestmentSummaryCharts summary={summary} />}"));
    const sim = slice('panel("simulation"', 'panel("review"');
    // ADR-0176 slice 1: the simulation tab is the deterministic band UI (no placeholder).
    expect(sim).not.toContain(normSrc("구현 예정 (ADR-0176)"));
    expect(sim).toContain(normSrc('data-testid="invest-simulation"'));
    expect(sim).toContain(normSrc('data-testid="invest-simulation-basis"'));
    expect(sim).toContain(normSrc("data-testid={`invest-simulation-${k}`}"));
    expect(sim).toContain(normSrc('data-testid="invest-simulation-schedule"'));
    expect(sim).toContain(normSrc("data-testid={`invest-simulation-row-${k}`}"));
    expect(sim).toContain(normSrc("{BAND_LABEL(tr)[k]}"));
    const rev = stage.slice(stage.indexOf(normSrc('panel("review"')));
    // i18n: review-tab copy moved to the catalog (stages.s5.stage.*) — pin the keys.
    for (const s of [
      't("evaluationEvidence")',
      't("evaluationRecordConfirmedByA2")',
      "gf-checklist",
      "<GateDecisionPanel",
      'gates={["pre_fs"]}',
    ])
      expect(rev).toContain(normSrc(s));
  });
  test("one save handler for 투자비 항목 저장 (no duplicated logic)", () => {
    expect(stage.match(/void saveInvestmentLines\(\)/g)?.length).toBe(1);
    expect(stage.match(/const linesSaveButton/g)?.length).toBe(1);
  });
  test("top-level unsaved indicator aggregates the per-section flags", () => {
    expect(stage).toContain(
      normSrc("aggregateDirty({ entry: entryIsDirty, capability: judgeDirty, staffing: staffDirty"),
    );
    expect(stage).toContain(normSrc('data-testid="gf-dirty-indicator"'));
  });
});
