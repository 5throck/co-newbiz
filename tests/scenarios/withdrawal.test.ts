import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApp, type TestApp } from "./_support/harness.ts";
import { launchBrowser, loginThroughUi, visit, type Session } from "./_support/browser.ts";
import { BROWNFIELD, seedBrownfieldDeal, seedRunningPipeline } from "./_support/deals.ts";
import { closeProjectViaModal, see } from "./_support/ui.ts";
import type { Browser } from "./_support/playwright.ts";

let app: TestApp;
let browser: Browser;
let s: Session;
let runId = "";
const P = BROWNFIELD.projectId;

beforeAll(async () => {
  app = await startApp("withdrawal", {
    seed: ({ dbPath, analystId }) => {
      // Mid-process: DD (S9) still has the M&A sub-track items unjudged.
      seedBrownfieldDeal(dbPath, analystId, { subTrackDd: false });
      runId = seedRunningPipeline(dbPath, P, "running");
    },
  });
  browser = await launchBrowser();
  s = await loginThroughUi(browser, app);
}, 120_000);
afterAll(async () => { await browser?.close(); await app?.stop(); });

describe("mid-process withdrawal", () => {
  test("the deal is mid-process at S9 (not at S12)", async () => {
    await visit(s.page, app, `/projects/${P}/process`);
    await see(s.page, /현재 S9/);
  }, 60_000);

  test("withdrawal needs a reason of at least 20 characters and learning capture; submit stays disabled and says why", async () => {
    await visit(s.page, app, `/projects/${P}/portfolio`);
    await s.page.getByRole("button", { name: /프로젝트 종료…/ }).first().click();
    const dialog = s.page.getByRole("dialog");
    await dialog.getByRole("radio", { name: /철회/ }).check();
    await dialog.locator("textarea").nth(0).fill("너무 짧음");
    const submit = dialog.getByRole("button", { name: "프로젝트 종료", exact: true });
    expect(await submit.isDisabled()).toBe(true);
    await see(s.page, /사유를 20자 이상 입력하세요/);
    await see(s.page, /학습 포착을 입력하세요/);
    await dialog.getByRole("button", { name: "취소" }).click();
  }, 60_000);

  test("withdrawn closure ends the pipeline as withdrawn, never completed, and closes the project", async () => {
    await closeProjectViaModal(s.page, app, P, "철회", "전략 우선순위 변경으로 실사 중간에 거래 추진을 철회함", {
      learning: "M&A 6대 검증을 DD 초기에 실행했다면 철회 시점을 앞당길 수 있었다",
    });
    const closure = app.readDb((d) => d.query("SELECT closure_type, basis_table, learning_capture FROM closure_record WHERE entity_id=?").get(P)) as { closure_type: string; basis_table: string; learning_capture: string };
    expect(closure.closure_type).toBe("withdrawn");
    expect(closure.basis_table).toBe("none");
    expect(closure.learning_capture.length).toBeGreaterThan(10);
    const run = app.readDb((d) => d.query("SELECT status FROM pipeline_run WHERE id=?").get(runId)) as { status: string };
    expect(run.status).toBe("withdrawn");
    expect(run.status).not.toBe("completed");
    const project = app.readDb((d) => d.query("SELECT status, closure_type FROM md_project WHERE id=?").get(P)) as { status: string; closure_type: string };
    expect(project).toEqual({ status: "closed", closure_type: "withdrawn" });
    // S12 was never reached: no transition decision exists.
    const transitions = app.readDb((d) => d.query("SELECT COUNT(*) c FROM venture_transition_decision WHERE project_id=?").get(P)) as { c: number };
    expect(transitions.c).toBe(0);
  }, 90_000);
});
