// @version 1.1.0
/**
 * Static audit (ADR-0146 PR4 + follow-up): opportunity-carrier screens must gate
 * write controls with canWriteBusiness (analyst-only) and never reintroduce an
 * admin-inclusive role predicate. Mirrors project-write-gating-static.test.ts.
 *
 * Follow-up tests catch the PR4 omission class: ungated write controls in
 * secondary components (list views, inner panels) that sit outside the
 * component where canAct/canCurate was defined.
 */
import { test, expect } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dirname, "../../app/web-next");
const FILES = [
  "components/stages/GreenfieldStage.tsx",
  "components/stages/BrownfieldStage.tsx",
  "components/stages/OpportunityFunnelStage.tsx",
  "components/stages/RouteDecisionStage.tsx",
  "components/stages/OurCompanyStage.tsx",
  "components/stages/SynergyStage.tsx",
  "components/stages/MarketAnalysisStage.tsx",
  "components/CommitteePanel.tsx",
  "components/GateDecisionPanel.tsx",
  "app/opportunities/[id]/page.tsx",
  "app/companies/[companyId]/page.tsx",
  "app/brownfield/targets/[targetId]/page.tsx",
];

// Wave U-3 decomposed the largest stages into sibling directories behind a re-export
// shim; the audit must cover the implementation files, not only the shim.
const SPLIT_DIRS: Record<string, string> = {
  "components/stages/BrownfieldStage.tsx": "components/stages/brownfield",
  "components/stages/RouteDecisionStage.tsx": "components/stages/route-decision",
  "components/stages/OurCompanyStage.tsx": "components/stages/our-company",
  "components/stages/SynergyStage.tsx": "components/stages/synergy",
  "components/stages/MarketAnalysisStage.tsx": "components/stages/market",
  "app/brownfield/targets/[targetId]/page.tsx": "components/brownfield-target",
};

/** Sources that implement a screen: the file itself plus its split directory (if any). */
function sourcesOf(f: string): Array<{ name: string; src: string }> {
  const out = [{ name: f, src: readFileSync(join(WEB, f), "utf-8") }];
  const dir = SPLIT_DIRS[f];
  if (dir && existsSync(join(WEB, dir))) {
    for (const n of readdirSync(join(WEB, dir)).sort()) out.push({ name: `${dir}/${n}`, src: readFileSync(join(WEB, dir, n), "utf-8") });
  }
  return out;
}
const joinedSource = (f: string) => sourcesOf(f).map((x) => x.src).join("\n");

// Admin role granting write access: `role === "admin"` followed by `||` within a short window.
const ADMIN_OR = /role\s*===\s*"admin"[^\n;]{0,40}\|\|/;
const ADMIN_OR_LEFT = /\|\|[^\n;]{0,40}role\s*===\s*"admin"/;

for (const f of FILES) {
  test(`${f} gates writes with canWriteBusiness and has no admin-inclusive predicate`, () => {
    const src = joinedSource(f);
    // import from the project-write-access module (relative or alias form)
    expect(src).toMatch(/import \{[^}]*\bcanWriteBusiness\b[^}]*\} from "[^"]*\/lib\/project-write-access(\.ts)?"/);
    expect(src).toMatch(/canWriteBusiness\(me\?\.role\)/);
    expect(src).not.toMatch(ADMIN_OR);
    expect(src).not.toMatch(ADMIN_OR_LEFT);
    if (f.endsWith("GateDecisionPanel.tsx")) {
      // project branch uses canWriteProject, opportunity/company branch uses canWriteBusiness
      expect(src).toMatch(/import \{[^}]*\bcanWriteProject\b[^}]*\} from "[^"]*\/lib\/project-write-access(\.ts)?"/);
      expect(src).toMatch(/canWriteProject\(me\?\.role\)/);
    }
  });
}

test("brownfield target page guards the company-sync auto-fire effect with !canAct", () => {
  // Viewers previously fired the auto-sync POST on page load and got swallowed 403s.
  const host = sourcesOf("app/brownfield/targets/[targetId]/page.tsx").find((x) => x.src.includes("/sync`"));
  expect(host).toBeDefined();
  const src = host!.src;
  const idx = src.indexOf("/sync`");
  expect(idx).toBeGreaterThan(-1);
  const window = src.slice(Math.max(0, idx - 800), idx);
  expect(window).toMatch(/if \(!canAct\) return/);
});

test("OurCompanyStage member-role select is disabled without write access (!canAct)", () => {
  // The member-role <select> fires updateMemberRole (PATCH /api/our-company/groups/{id}/members).
  // The section defining/calling updateMemberRole must gate it with !canAct within 5 lines.
  const host = sourcesOf("components/stages/OurCompanyStage.tsx").find((x) => x.src.includes("updateMemberRole(m.id"));
  expect(host).toBeDefined();
  const lines = host!.src.split("\n");
  const idx = lines.findIndex((l) => l.includes("updateMemberRole(m.id"));
  expect(idx).toBeGreaterThan(-1);
  const around = lines.slice(Math.max(0, idx - 5), idx + 6).join("\n");
  expect(around).toMatch(/!canAct/);
});

test("SynergyStage and MarketAnalysisStage gate list/report write controls with canCurate (>= 6 occurrences)", () => {
  // PR4 missed list-view and calibration-panel write controls. Each gate site
  // (new-analysis entry, rerun/delete/pin/edit, capability-gap, calibration,
  // escalation) adds at least one canCurate reference; a leaner file means a
  // gate was dropped.
  for (const f of [
    "components/stages/SynergyStage.tsx",
    "components/stages/MarketAnalysisStage.tsx",
  ]) {
    const src = joinedSource(f);
    const count = (src.match(/canCurate/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(6);
  }
});
