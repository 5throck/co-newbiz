import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Source-reading tests for design 2026-10-11-ui-label-and-mobile-table-sweep
// (Row 2). They assert the sweep stays swept: raw enum keys do not come back.

const ROOT = join(import.meta.dir, "..", "..", "app", "web-next");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function expectNoMatch(src: string, patterns: RegExp[], file: string) {
  for (const re of patterns) {
    expect(src.match(re), `${file} should not match ${re}`).toBeNull();
  }
}

describe("ui label sweep (design 2026-10-11)", () => {
  test("raw track/subTrack/status/category keys are not interpolated in the section 1.2 files", () => {
    expectNoMatch(read("app/projects/[id]/page.tsx"), [/\{process\.track\}/], "projects overview");
    expectNoMatch(
      read("app/projects/[id]/process/page.tsx"),
      [/s\.requiredArtifacts\.join/, /\{g\}\s*$/],
      "process page",
    );
    expectNoMatch(read("app/deals/[id]/page.tsx"), [/\{g\} \{v\.toUpperCase/], "deal overview");
    expectNoMatch(read("app/deals/[id]/[stage]/page.tsx"), [/\{stage\?\.status\}/], "deal stage page");
    expectNoMatch(read("app/glossary/page.tsx"), [/\{t\.category\}/, /\{detail\.category\}/], "glossary");
    expectNoMatch(read("components/stages/IcReviewStage.tsx"), [/missing_dimensions\.join/], "ic review");
    expectNoMatch(
      read("components/stages/IcReviewStage.tsx"),
      [/<strong>\{f\.category\}<\/strong>/],
      "ic review findings",
    );
    expectNoMatch(read("components/stages/DdStage.tsx"), [/<strong>\{f\.category\}<\/strong>/], "dd findings");
    expectNoMatch(read("components/FinancialAnalysisPanel.tsx"), [/dart corp code/], "financial panel");
    expectNoMatch(read("app/companies/[companyId]/page.tsx"), [/dart corp code/], "companies page");
    expectNoMatch(read("app/strategy/page.tsx"), [/why_it_matters_ko/], "strategy page");
    expectNoMatch(read("components/CommitteePanel.tsx"), [/agent_team — /], "committee options");
    expectNoMatch(read("components/ClosureModal.tsx"), [/graduate_to_core와/], "closure hints");
    expectNoMatch(read("components/stages/DealStructureStage.tsx"), [/"deal_structure_review/], "deal structure");
  });

  test("charter page uses the shared track key vocabulary, not a local English map (i18n re-pin T3-6)", () => {
    const src = read("app/projects/[id]/charter/page.tsx");
    expect(src).toMatch(/from "[^"]*lib\/label-keys\.ts"/);
    expect(src).not.toMatch(/greenfield: "Greenfield"/);
  });

  test("PortfolioStage consumes the shared transition/record key maps (i18n re-pin T3-6)", () => {
    const src = read("components/stages/PortfolioStage.tsx");
    expect(src).toMatch(/TRANSITION_DECISION_KEY/);
    expect(src).toMatch(/RECORD_KEY/);
    expect(src).not.toMatch(/\(tranche_condition — 필수\)/);
    expect(src).not.toMatch(/결정자\(decided_by\)/);
  });

  test("/agents and /our-company do not use StageFrame; titles are not stage names", async () => {
    for (const p of ["app/agents/page.tsx", "app/our-company/page.tsx"]) {
      const src = read(p);
      expect(src).not.toMatch(/StageFrame/);
    }
    // i18n: layout titles resolve through pages.titles — key call site + ko master value.
    expect(read("app/agents/layout.tsx")).toMatch(/pages\.titles/);
    expect(read("app/our-company/layout.tsx")).toMatch(/pages\.titles/);
    const koTitles = await import("../../app/web-next/locales/ko.json");
    expect(koTitles.pages.titles.agents).toBe("에이전트 질의");
    expect(koTitles.pages.titles.ourCompany).toBe("그룹/계열사 분석");
    expect(read("app/agents/layout.tsx")).not.toMatch(/S2/);
    expect(read("app/our-company/layout.tsx")).not.toMatch(/S3/);
  });

  test("styles.css has the shared table-scroll data-table rule and cell tokens", () => {
    const css = read("app/styles.css");
    expect(css).toMatch(/\.table-scroll \.data-table:not\(\.table-fixed-pct\) \{ display: table; width: max-content/);
    expect(css).toMatch(/\.cell-nowrap \{ white-space: nowrap; \}/);
    expect(css).toMatch(/\.cell-wrap \{ max-width: 28ch; \}/);
    // The old targets-table-only rules are folded in (no standalone selector block).
    expect(css).not.toMatch(/\.data-table\.targets-table \{/);
  });

  test("table-scroll wrappers are focusable, labelled regions", () => {
    for (const p of [
      "app/projects/page.tsx",
      "app/deals/page.tsx",
      "app/projects/[id]/agent-runs/page.tsx",
      "app/projects/archives/page.tsx",
      "app/portfolio-view/page.tsx",
      "app/projects/[id]/incentives/page.tsx",
      "components/stages/BusinessCaseStage.tsx",
    ]) {
      const src = read(p);
      if (src.includes("table-scroll")) {
        // Whitespace-tolerant (the biome formatter may wrap the attributes),
        // and role="region" is optional: a named <section> carries the region
        // role implicitly, which is what lint/a11y/noRedundantRoles enforces —
        // the contract is a focusable, labelled, keyboard-scrollable region.
        expect(src).toMatch(/className="table-scroll"(?:\s+role="region")?\s+aria-label=[^>]*tabIndex=\{0\}/);
      }
    }
  });

  test("/settings index redirects to the connected-apps child", () => {
    expect(read("app/settings/page.tsx")).toMatch(/redirect\("\/settings\/connected-apps"\)/);
  });

  test("project layout renders the Korean not-found guard instead of raw English", () => {
    expect(read("app/projects/[id]/layout.tsx")).toMatch(/ProjectAccessGuard/);
    const guard = read("components/ProjectAccessGuard.tsx");
    expect(guard).toMatch(/403|404/);
    const nf = read("components/ProjectNotFound.tsx");
    expect(nf).toMatch(/프로젝트를 찾을 수 없습니다/);
    expect(nf).not.toMatch(/Not found\./);
  });

  test("AdminGuard shows the in-place administrator notice; no silent /deals redirect", () => {
    const src = read("components/AdminGuard.tsx");
    expect(src).toMatch(/관리자 권한이 필요합니다/);
    expect(src).toMatch(/\/deals/); // link back
    expect(src).not.toMatch(/router\.replace\("\/deals/);
    expect(src).not.toMatch(/useRouter/);
  });
});
