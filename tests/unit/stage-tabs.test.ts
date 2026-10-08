// Wave U-1 stage-tab map (design §3.4): max 5 primary tabs, overflow for the
// long tail, and every former ProjectSubNav destination stays reachable.
import { describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_PRIMARY_TABS,
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
    const reachable = new Set(STAGE_TAB_GROUPS.flatMap((g) => [...g.tabs, ...g.more].map((t) => t.seg)));
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
    expect(all[activeTabIndex(s8, "/business-case", "target-costing")].label).toBe("타겟코스팅");
    expect(all[activeTabIndex(s8, "/business-case", "scenarios")].label).toBe("분석");
    expect(tabHref("p1", { seg: "/business-case", query: "target-costing", label: "x" })).toBe("/projects/p1/business-case?tab=target-costing");
  });
});
