// ADR-0186 P2 UI: the gate panel loads the snapshot, lists the acknowledgements and records a GO through them
// with the families on `enforce` (production bundle). A GO without the hash/acks would be refused (409/422).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApp, type TestApp } from "./_support/harness.ts";
import { launchBrowser, loginThroughUi, visit, axeScan, formatAxe, type Session } from "./_support/browser.ts";
import { BROWNFIELD, seedBrownfieldDeal } from "./_support/deals.ts";
import { recordGate } from "./_support/ui.ts";
import type { Browser } from "./_support/playwright.ts";

const FAMILIES = ["SNAPSHOT_ACK", "KILL_BINDING", "DIVERGENCE"];
for (const f of FAMILIES) process.env[`CO_NEWBIZ_GATE_INTEGRITY_${f}`] = "enforce";

let app: TestApp;
let browser: Browser;
let s: Session;
const P = BROWNFIELD.projectId;

beforeAll(async () => {
  app = await startApp("gate-snapshot-ui", { seed: ({ dbPath, analystId }) => { seedBrownfieldDeal(dbPath, analystId); } });
  browser = await launchBrowser();
  s = await loginThroughUi(browser, app);
}, 120_000);
afterAll(async () => {
  await browser?.close();
  await app?.stop();
  for (const f of FAMILIES) delete process.env[`CO_NEWBIZ_GATE_INTEGRITY_${f}`];
});

describe("gate integrity P2 - panel UI under enforce", () => {
  test("snapshot summary renders, accessible, and a GO is recorded through the acknowledgement list", async () => {
    await visit(s.page, app, `/projects/${P}/business-case?tab=decision`);
    const panel = s.page.locator('section[aria-label="의사결정"]').first();
    await panel.waitFor({ state: "visible", timeout: 30_000 });
    await panel.getByText("이 진행의 현재 상태").waitFor({ state: "visible", timeout: 20_000 });
    const scan = await axeScan(s.page, "gate panel: acknowledged GO");
    expect(scan.blocking, formatAxe([scan])).toEqual([]);

    await recordGate(s.page, app, `/projects/${P}/business-case`, null, "go", "채택 사례의 NPV/BEP가 투자 기준을 충족함");
    const row = app.readDb((d) => d.query("SELECT n.snapshot_hash h, n.acknowledgements_json a FROM gate_decision g JOIN gate_decision_snapshot n ON n.decision_id = g.id WHERE g.entity_id = ? AND g.gate = 'fs' AND g.decision = 'go'").get(P)) as { h: string; a: string } | null;
    expect(row?.h).toMatch(/^[0-9a-f]{64}$/);
  }, 180_000);
});
