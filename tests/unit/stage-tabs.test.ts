// Wave U-1 stage-tab map (design §3.4): max 5 primary tabs, overflow for the
// long tail, and every former ProjectSubNav destination stays reachable.
import { describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_PRIMARY_TABS,
  activeSubtabIndex,
  allDefs,
  groupForTrack,
  STAGE_TAB_GROUPS,
  activeTabIndex,
  groupForSegment,
  projectSegment,
  tabHref,
} from "../../app/web-next/lib/stage-tabs.ts";

const PROJECT_DIR = join(import.meta.dirname, "../../app/web-next/app/projects/[id]");

describe("stage tabs", () => {
  test("at most 5 primary tabs per stage; first two cover the primary job", () => {
    for (const g of STAGE_TAB_GROUPS) {
      expect(g.tabs.length).toBeGreaterThanOrEqual(2);
      expect(g.tabs.length).toBeLessThanOrEqual(MAX_PRIMARY_TABS);
    }
  });

  test("every project sub-page route is reachable from some stage tab (no orphans)", () => {
    const reachable = new Set(STAGE_TAB_GROUPS.flatMap((g) => allDefs(g).map((t) => t.seg)));
    const pages = readdirSync(PROJECT_DIR).filter((e) => statSync(join(PROJECT_DIR, e)).isDirectory());
    const orphans = pages.filter((p) => !reachable.has(`/${p}`));
    expect(orphans).toEqual([]);
  });

  test("no duplicate destinations across groups", () => {
    const keys = STAGE_TAB_GROUPS.flatMap((g) => [...g.tabs, ...g.more].map((t) => `${t.seg}|${t.query ?? ""}`));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("segment parsing and group lookup", () => {
    expect(projectSegment("/projects/p1")).toBe("");
    expect(projectSegment("/projects/p1/dd")).toBe("/dd");
    expect(projectSegment("/deals/p1/s4")).toBeNull();
    expect(groupForSegment("")?.stage).toBe("S8");
    expect(groupForSegment("/debt")?.stage).toBe("S10");
    expect(groupForSegment("/timeline")?.stage).toBe("S12");
  });

  test("active tab: ?tab= match wins, else the plain page entry", () => {
    const s8 = groupForSegment("/business-case")!;
    const all = [...s8.tabs, ...s8.more];
    // Moved keys highlight the financial primary tab; their own entry is in the financial sub-tab row.
    for (const k of ["overview", "params", "target-costing"]) expect(all[activeTabIndex(s8, "/business-case", k)].label).toBe("재무적 타당성");
    expect(all[activeTabIndex(s8, "/business-case", "decision")].label).toBe("결정");
    // ADR-0169: the default analysis view (no or unknown ?tab=) highlights 재무적 타당성.
    expect(all[activeTabIndex(s8, "/business-case", null)].label).toBe("재무적 타당성");
    expect(all[activeTabIndex(s8, "/business-case", "bogus")].label).toBe("재무적 타당성");
    expect(all[activeTabIndex(s8, "/business-case", "scenarios")].label).toBe("재무적 타당성");
    expect(all[activeTabIndex(s8, "/wacc", null)].label).toBe("재무적 타당성");
    expect(all[activeTabIndex(s8, "/financial-analysis", null)].label).toBe("재무적 타당성");
    expect(all[activeTabIndex(s8, "/business-case", "goals")].label).toBe("사업 목표");
    expect(all[activeTabIndex(s8, "/business-case", "technical")].label).toBe("기술적 타당성");
    expect(all[activeTabIndex(s8, "/business-case", "capability")].label).toBe("기술적 타당성");
    expect(all[activeTabIndex(s8, "/business-case", "targets")].label).toBe("대상 비교·선정");
    expect(all[activeTabIndex(s8, "/business-case", "decision")].label).toBe("결정");
    expect(tabHref("p1", { seg: "/business-case", query: "target-costing", label: "x" })).toBe("/projects/p1/business-case?tab=target-costing");
  });

  test("financial sub-tab row shows only under the financial lens (ADR-0169)", () => {
    const s8 = groupForSegment("/business-case")!;
    expect(s8.tabs.length).toBeLessThanOrEqual(MAX_PRIMARY_TABS);
    const sub = (seg: string, tab: string | null) => s8.subtabs![activeSubtabIndex(s8, seg, tab)]?.label;
    expect(sub("/business-case", null)).toBe("시나리오 비교");
    expect(sub("/business-case", "scenarios")).toBe("시나리오 비교");
    expect(sub("/wacc", null)).toBe("WACC");
    expect(sub("/financial-analysis", null)).toBe("재무분석");
    expect(sub("/business-case", "overview")).toBe("설명·생성·권고");
    expect(sub("/business-case", "params")).toBe("파라미터·스냅샷");
    expect(sub("/business-case", "target-costing")).toBe("타겟코스팅");
    for (const t of ["goals", "technical", "targets", "decision"]) expect(activeSubtabIndex(s8, "/business-case", t)).toBe(-1);
  });

  test("S8 sub-tab and more-menu membership; deep links stay reachable", () => {
    const s8 = groupForSegment("/business-case")!;
    expect(s8.subtabs!.map((t) => t.query ?? t.seg)).toEqual(["scenarios", "/wacc", "/financial-analysis", "overview", "params", "target-costing"]);
    expect(s8.more.map((t) => t.query ?? (t.seg || "summary"))).toEqual(["summary", "/risk-heatmap"]);
    expect(allDefs(s8).some((t) => t.query === "overview")).toBe(true);
  });

  test("greenfield drops the targets tab; unknown ?tab=targets lands on the financial lens", () => {
    const gf = groupForTrack(groupForSegment("/business-case")!, "greenfield");
    expect(gf.tabs.map((t) => t.label)).toEqual(["사업 목표", "기술적 타당성", "재무적 타당성", "결정"]);
    expect([...gf.tabs, ...gf.more][activeTabIndex(gf, "/business-case", "targets")].label).toBe("재무적 타당성");
  });
});
