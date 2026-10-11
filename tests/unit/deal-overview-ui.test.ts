import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(`./app/web-next/${p}`, "utf8");

describe("deal overview page structure", () => {
  const page = read("app/deals/[id]/page.tsx");
  test("labelled sections, one primary action, no in-page breadcrumb", () => {
    for (const h of ["현재 단계", "다음 할 일", "완료 조건", "주요 사실"]) expect(page).toContain(h);
    expect(page).toContain("aria-labelledby");
    expect(page).not.toContain("DealBreadcrumb");
    expect(page.match(/ov\.nextAction\.href/g)?.length).toBe(1);
  });
  test("stepper uses stage names and aria-current; values go through displayOrNotRecorded", () => {
    expect(page).toContain("STAGE_META");
    expect(page).toContain('aria-current={isCurrent ? "step" : undefined}');
    expect(page).toContain("displayOrNotRecorded");
    expect(page).not.toMatch(/tabIndex/);
  });
  test("HOLD rows link to the decision screen; no hardcoded colors", () => {
    expect(page).toContain("h.href");
    expect(page).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("sidebar active state", () => {
  test("board item is not active inside a deal; overview item is", () => {
    const shell = read("components/AppShell.tsx");
    expect(shell).toContain('(item.href === "/deals" && dealId)');
    expect(shell).toContain('${dealId ? "side-nav-link-active" : ""}');
  });
});

describe("S3 deal scope", () => {
  const hook = read("components/stages/synergy/useSynergyList.ts");
  const list = read("components/stages/synergy/SynergyListSection.tsx");
  test("fetches with opportunityId and defaults to this deal only", () => {
    expect(hook).toContain("?opportunityId=");
    expect(hook).toContain('useState<"deal" | "all">("deal")');
  });
  test("toggle, badge, empty state, start action pre-fills without submitting", () => {
    expect(list).toContain("이 딜만");
    expect(list).toContain("이 딜에 연결된 시너지 분석이 없습니다");
    expect(list).toContain("setOppSel(opportunityId)");
    expect(list).toContain("setShowNewForm(true)");
    expect(list).toContain("disabled={startDisabledReason !== null}");
    expect(list).not.toContain("createAnalysis");
  });
  test("table is wrapped in table-scroll with min-width modifier", () => {
    expect(list).toContain('<div className="table-scroll">');
    expect(list).toContain("synergy-list-table");
    expect(read("app/styles.css")).toMatch(/\.list-table\.synergy-list-table\s*\{[^}]*min-width/);
  });
});
