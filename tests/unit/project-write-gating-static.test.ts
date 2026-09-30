// @version 1.0.0
/**
 * Static audit (D4 PR-A): project write screens must gate write controls with
 * canWriteProject (analyst-only) and never reintroduce an admin-inclusive role
 * predicate. Same static-source pattern as verify-skills-guard.test.ts.
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dirname, "../../app/web-next");
const FILES = [
  "app/projects/[id]/proxy-chain/page.tsx",
  "app/projects/[id]/share/page.tsx",
  "app/projects/[id]/incentives/page.tsx",
  "app/projects/[id]/permits/page.tsx",
  "app/projects/[id]/debt/page.tsx",
  "app/projects/[id]/sites/page.tsx",
  "app/projects/[id]/interviews/page.tsx",
  "app/projects/[id]/customer-coc/page.tsx",
  "components/wacc/WaccPanel.tsx",
  "components/FinancialAnalysisPanel.tsx",
];

for (const f of FILES) {
  test(`${f} gates writes with canWriteProject and has no admin-inclusive predicate`, () => {
    const src = readFileSync(join(WEB, f), "utf-8");
    expect(src).toMatch(/import \{ canWriteProject \} from "[./]+\/lib\/project-write-access(\.ts)?"/);
    expect(src).toMatch(/canWriteProject\(me\?\.role\)/);
    expect(src).not.toMatch(/role === "admin" \|\|/);
  });
}
