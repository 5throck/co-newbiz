// @version 1.0.0
/**
 * Static audit (ADR-0146 PR4): opportunity-carrier screens must gate write
 * controls with canWriteBusiness (analyst-only) and never reintroduce an
 * admin-inclusive role predicate. Mirrors project-write-gating-static.test.ts.
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
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

// Admin role granting write access: `role === "admin"` followed by `||` within a short window.
const ADMIN_OR = /role\s*===\s*"admin"[^\n;]{0,40}\|\|/;
const ADMIN_OR_LEFT = /\|\|[^\n;]{0,40}role\s*===\s*"admin"/;

for (const f of FILES) {
  test(`${f} gates writes with canWriteBusiness and has no admin-inclusive predicate`, () => {
    const src = readFileSync(join(WEB, f), "utf-8");
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
  const src = readFileSync(join(WEB, "app/brownfield/targets/[targetId]/page.tsx"), "utf-8");
  const idx = src.indexOf("/sync`");
  expect(idx).toBeGreaterThan(-1);
  const window = src.slice(Math.max(0, idx - 800), idx);
  expect(window).toMatch(/if \(!canAct\) return/);
});
