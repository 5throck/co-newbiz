import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApp, type TestApp } from "./_support/harness.ts";
import { launchBrowser, loginThroughUi, visit, axeScan, formatAxe, type AxeResult, type Session } from "./_support/browser.ts";
import { BROWNFIELD, seedBrownfieldDeal, seedRunningPipeline } from "./_support/deals.ts";
import { recordGate, closeProjectViaModal, see, openGatePanels } from "./_support/ui.ts";
import type { Browser } from "./_support/playwright.ts";

let app: TestApp;
let browser: Browser;
let s: Session;
let runId = "";
const P = BROWNFIELD.projectId;
const axe: AxeResult[] = [];

beforeAll(async () => {
  app = await startApp("kill-at-gate", {
    seed: ({ dbPath, analystId }) => {
      seedBrownfieldDeal(dbPath, analystId);
      runId = seedRunningPipeline(dbPath, P);
    },
  });
  browser = await launchBrowser();
  s = await loginThroughUi(browser, app);
}, 120_000);
afterAll(async () => { await browser?.close(); await app?.stop(); });

describe("KILL at a gate with learning capture", () => {
  test("a KILL cannot be recorded without learning capture; the panel keeps submit disabled and says why", async () => {
    await visit(s.page, app, `/projects/${P}/dd`);
    await openGatePanels(s.page);
    const form = s.page.locator('section[aria-label="의사결정"] form[aria-label="의사결정 기록"]');
    await form.waitFor({ state: "visible", timeout: 30_000 });
    await form.locator("select").last().selectOption("kill");
    await form.locator("input[required]").first().fill("실사에서 인증 이전 불가 사실이 확인되어 중단 권고");
    await form.locator("textarea[required]").waitFor({ state: "visible" });
    expect(await form.locator('button[type="submit"]').last().isDisabled()).toBe(true);
    const before = app.readDb((d) => d.query("SELECT COUNT(*) c FROM gate_decision WHERE gate='dd'").get()) as { c: number };
    expect(before.c).toBe(0);
  }, 60_000);

  test("DD gate KILL with learning capture is recorded by a person", async () => {
    await recordGate(s.page, app, `/projects/${P}/dd`, null, "kill", "실사에서 인증 이전 불가 사실이 확인되어 중단", {
      learning: "인증 이전 가능 여부는 LOI 이전에 인증기관 규정으로 확인해야 한다 (추정 금지)",
    });
    const row = app.readDb((d) => d.query("SELECT decision, decided_by, learning_capture FROM gate_decision WHERE gate='dd'").get()) as { decision: string; decided_by: string; learning_capture: string };
    expect(row.decision).toBe("kill");
    expect(row.decided_by).toBe("analyst");
    expect(row.learning_capture.length).toBeGreaterThan(10);
  }, 60_000);

  test("typed closure killed_at_gate is offered with its basis, and ends the pipeline as killed", async () => {
    await closeProjectViaModal(s.page, app, P, "게이트 KILL로 종료", "DD 게이트에서 KILL이 기록되어 종료", {
      learning: "인증 이전 가능 여부는 LOI 이전에 인증기관 규정으로 확인해야 한다",
      beforeSubmit: async (page) => {
        axe.push(await axeScan(page, "closure modal"));
      },
    });
    const closure = app.readDb((d) => d.query("SELECT closure_type, basis_table FROM closure_record WHERE entity_id=?").get(P)) as { closure_type: string; basis_table: string };
    expect(closure).toEqual({ closure_type: "killed_at_gate", basis_table: "gate_decision" });
    const run = app.readDb((d) => d.query("SELECT status FROM pipeline_run WHERE id=?").get(runId)) as { status: string };
    expect(run.status).toBe("killed");
    await visit(s.page, app, "/projects/archives");
    await see(s.page, /DEMO-S1-S12|S1-S12 데모/);
  }, 90_000);

  test("axe: closure modal has no serious or critical violations", () => {
    console.log(formatAxe(axe));
    expect(axe.flatMap((r) => r.blocking)).toEqual([]);
  });
});
