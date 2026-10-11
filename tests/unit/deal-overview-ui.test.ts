import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(`./app/web-next/${p}`, "utf8");

describe("deal overview page structure", () => {
  const page = read("app/deals/[id]/page.tsx");
  test("labelled sections, one primary action, no in-page breadcrumb", () => {
    for (const h of ["현재 단계", "다음 할 일", "완료 조건", "주요 사실"]) expect(page).toContain(h);
    expect(page).toContain("aria-labelledby");
    expect(page).not.toContain("DealBreadcrumb");
    expect(page.match(/href=\{a\.href\}/g)?.length).toBe(1);
  });
  test("identity header: deal name is the H1, title is set per deal, one h1", () => {
    expect(page).toContain('<h1 id="deal-title">{knownName ?? EYEBROW}</h1>');
    expect(page).toContain("document.title = documentTitle(knownName, EYEBROW)");
    expect(page).toContain('aria-labelledby="deal-title"');
    expect(page.match(/<h1\b/g)?.length).toBe(3); // loaded, loading (sr-only), error
  });
  test("stepper is the shared StageRail with status, non-sticky; no ad-hoc rail", () => {
    expect(page).toContain("<StageRail");
    expect(page).toContain("status={railStatus}");
    expect(page).toContain("sticky={false}");
    expect(page).not.toContain("sizing-step-rail");
    expect(page).not.toContain(".handoff");
    expect(page).not.toContain("NEXT_ACTION_LABEL");
  });
  test("facts use the four states; gate chips carry icons; error states retry without reload", () => {
    expect(page).toContain("factView(");
    expect(page).toContain("GateChip");
    expect(page).toContain("onRetry={retryAll}");
    expect(page).toContain("onRetry={retryOpp}");
    expect(page).not.toContain("window.location.reload");
  });
  test("HOLD card renders once per breakpoint; links to the decision screen; no hardcoded colors", () => {
    expect(page).toContain('suffix="inline"');
    expect(page).toContain('suffix="aside"');
    expect(page).toContain("href={h.href}");
    expect(page).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const css = read("app/styles.css");
    expect(css).toMatch(/\.deal-overview-hold-aside\s*\{\s*display:\s*none/);
    expect(css).toMatch(/@media \(min-width: 1024px\)\s*\{[^}]*grid-template-columns: minmax\(0, 2fr\) minmax\(18rem, 1fr\)/);
  });
});

describe("StageRail backward compatibility", () => {
  const frame = read("components/StageFrame.tsx");
  test("status and sticky are optional; default stays sticky and unchanged for other callers", () => {
    expect(frame).toContain("status?: Partial<Record<StageMetaId, StageRailStatus>>");
    expect(frame).toContain("sticky = true");
    expect(frame).toContain("{!status && isCurrent && <span className=\"stage-step-state\">현재</span>}");
  });
  test("state words are sr-only in the full rail; later steps use a colour token, not opacity", () => {
    expect(frame).toContain('<span className="sr-only">');
    const css = read("app/styles.css");
    expect(css).toContain(".stage-stepper--status .stage-step-current");
    expect(css).not.toMatch(/\.stage-stepper--status[^{]*\{[^}]*opacity/);
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
