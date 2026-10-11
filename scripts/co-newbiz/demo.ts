// @version 1.0.0
// Internal demo (Wave C-2). Boots the production build of the web app on a free
// port against a throwaway SQLite DB seeded with the S1-S12 demo deals, using
// the same harness as the E2E scenarios (tests/scenarios/_support/harness.ts):
// never port 7748 or 7749, LLM / DART / web-research env blanked (offline fallbacks),
// temp directory removed on exit.
//
// Usage:
//   bun run demo              start and keep running until Ctrl-C; prints the URL
//                             and the runtime-generated first-login passwords
//                             (each forces a change on first login)
//   bun run demo -- --capture walk S1 -> S12 in a headless browser, write numbered
//                             screenshots to docs/evidence/demo/, then exit
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, startApp, type TestApp } from "../../tests/scenarios/_support/harness.ts";
import { grantProjectLead } from "../../tests/scenarios/_support/deals.ts";
import { launchBrowser, loginThroughUi, visit } from "../../tests/scenarios/_support/browser.ts";
import { seedS1ToS12Demo, seedGreenfieldS1ToS12Demo } from "./seed-s1-s12-demo.ts";

const EVIDENCE_DIR = join(REPO_ROOT, "docs", "evidence", "demo");

interface DemoIds {
  brownfield: { opportunityId: string; projectId: string };
  greenfield: { opportunityId: string; projectId: string };
}

/** Both demo chains with their human decisions already recorded — the full
 *  S1→S12 lifecycle per track (brownfield M&A and greenfield 신설). */
async function seed({ dbPath, analystId }: { dbPath: string; analystId: string }): Promise<DemoIds> {
  const brownfield = seedS1ToS12Demo(dbPath, { humanDecisions: true, subTrackDd: true });
  grantProjectLead(dbPath, brownfield.projectId, analystId);
  const greenfield = await seedGreenfieldS1ToS12Demo(dbPath, { humanDecisions: true });
  grantProjectLead(dbPath, greenfield.projectId, analystId);
  return { brownfield, greenfield };
}

async function capture(app: TestApp, ids: DemoIds): Promise<string[]> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const BF = ids.brownfield;
  const GF = ids.greenfield;
  const shots: Array<[string, string]> = [
    // Brownfield track — S1 → S12 through the target axis.
    ["01-deal-board", "/deals"],
    ["02-s1-market-analysis", `/deals/${BF.opportunityId}/s1`],
    ["03-s2-opportunity", `/deals/${BF.opportunityId}/s2`],
    ["04-s4-route-decision", `/deals/${BF.opportunityId}/s4`],
    ["05-s6-s7-target-screening", `/deals/${BF.opportunityId}/s7`],
    ["06-s8-business-case", `/projects/${BF.projectId}/business-case`],
    ["07-s9-dd-workspace", `/projects/${BF.projectId}/dd`],
    ["08-s10-deal-structure", `/projects/${BF.projectId}/deal-structure`],
    ["09-s11-ic-review", `/projects/${BF.projectId}/ic-review`],
    ["10-s12-portfolio", `/projects/${BF.projectId}/portfolio`],
    // Greenfield track — S1 → S5 (entry strategy, no target axis) → S8 → S12.
    ["11-gf-s1-market-analysis", `/deals/${GF.opportunityId}/s1`],
    ["12-gf-s2-opportunity", `/deals/${GF.opportunityId}/s2`],
    ["13-gf-s4-route-decision", `/deals/${GF.opportunityId}/s4`],
    ["14-gf-s5-entry-strategy", `/deals/${GF.opportunityId}/s5`],
    ["15-gf-s8-business-case", `/projects/${GF.projectId}/business-case`],
    ["16-gf-s9-dd-workspace", `/projects/${GF.projectId}/dd`],
    ["17-gf-s10-deal-structure", `/projects/${GF.projectId}/deal-structure`],
    ["18-gf-s11-ic-review", `/projects/${GF.projectId}/ic-review`],
    ["19-gf-s12-portfolio", `/projects/${GF.projectId}/portfolio`],
  ];
  const browser = await launchBrowser();
  const written: string[] = [];
  try {
    const session = await loginThroughUi(browser, app, "analyst");
    for (const [name, path] of shots) {
      await visit(session.page, app, path);
      await session.page.mouse.move(0, 0);
      await session.page.waitForTimeout(800);
      const file = join(EVIDENCE_DIR, `${name}.png`);
      await session.page.screenshot({ path: file });
      written.push(file);
    }
  } finally {
    await browser.close();
  }
  return written;
}

async function main(): Promise<void> {
  const captureMode = process.argv.includes("--capture");
  let ids: DemoIds = { brownfield: { opportunityId: "", projectId: "" }, greenfield: { opportunityId: "", projectId: "" } };
  const app = await startApp("demo", {
    seed: async (ctx) => {
      ids = await seed(ctx);
    },
  });
  if (captureMode) {
    try {
      const files = await capture(app, ids);
      console.log(`wrote ${files.length} screenshots to ${EVIDENCE_DIR}`);
    } finally {
      await app.stop();
    }
    return;
  }
  console.log(`co-newbiz demo: ${app.baseUrl}`);
  console.log(`  analyst (deal work)  user: ${app.analystId}  first-login password: ${app.analystPassword}`);
  console.log(`  admin (no deal data) user: ${app.adminId}  first-login password: ${app.adminPassword}`);
  console.log("  passwords are generated for this run only; the first login forces a change.");
  console.log(`  brownfield (M&A)      deal: ${app.baseUrl}/deals/${ids.brownfield.opportunityId}  ·  project: ${app.baseUrl}/projects/${ids.brownfield.projectId}/process`);
  console.log(`  greenfield (신설)      deal: ${app.baseUrl}/deals/${ids.greenfield.opportunityId}  ·  project: ${app.baseUrl}/projects/${ids.greenfield.projectId}/process`);
  // The harness's own SIGINT/SIGTERM handlers kill the server and delete the temp directory.
  console.log("Ctrl-C stops the server and deletes the temporary database.");
  await new Promise<never>(() => undefined);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
