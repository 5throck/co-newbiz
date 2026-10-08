// @version 1.0.0
// Internal demo (Wave C-2). Boots the production build of the web app on a free
// port against a throwaway SQLite DB seeded with the S1-S12 demo deals, using
// the same harness as the E2E scenarios (tests/scenarios/_support/harness.ts):
// never port 7749, LLM / DART / web-research env blanked (offline fallbacks),
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
import { grantProjectLead, seedGreenfieldDeal } from "../../tests/scenarios/_support/deals.ts";
import { launchBrowser, loginThroughUi, visit } from "../../tests/scenarios/_support/browser.ts";
import { seedS1ToS12Demo } from "./seed-s1-s12-demo.ts";

const EVIDENCE_DIR = join(REPO_ROOT, "docs", "evidence", "demo");

/** The demo brownfield chain with its human decisions already recorded, plus the greenfield deal. */
async function seed({ dbPath, analystId }: { dbPath: string; analystId: string }): Promise<{ opportunityId: string; projectId: string }> {
  const ids = seedS1ToS12Demo(dbPath, { humanDecisions: true, subTrackDd: true });
  grantProjectLead(dbPath, ids.projectId, analystId);
  await seedGreenfieldDeal(dbPath, analystId);
  return ids;
}

async function capture(app: TestApp, ids: { opportunityId: string; projectId: string }): Promise<string[]> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const O = ids.opportunityId;
  const P = ids.projectId;
  const shots: Array<[string, string]> = [
    ["01-deal-board", "/deals"],
    ["02-s1-market-analysis", `/deals/${O}/s1`],
    ["03-s2-opportunity", `/deals/${O}/s2`],
    ["04-s4-route-decision", `/deals/${O}/s4`],
    ["05-s6-s7-target-screening", `/deals/${O}/s7`],
    ["06-s8-business-case", `/projects/${P}/business-case`],
    ["07-s9-dd-workspace", `/projects/${P}/dd`],
    ["08-s10-deal-structure", `/projects/${P}/deal-structure`],
    ["09-s11-ic-review", `/projects/${P}/ic-review`],
    ["10-s12-portfolio", `/projects/${P}/portfolio`],
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
  let ids: { opportunityId: string; projectId: string } = { opportunityId: "", projectId: "" };
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
  console.log(`  demo deal: ${app.baseUrl}/deals/${ids.opportunityId}  ·  project: ${app.baseUrl}/projects/${ids.projectId}/process`);
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
