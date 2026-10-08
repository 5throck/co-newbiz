import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApp, type TestApp } from "./_support/harness.ts";
import { launchBrowser, loginThroughUi, visit, axeScan, formatAxe, type AxeResult, type Session } from "./_support/browser.ts";
import { GREENFIELD, seedGreenfieldDeal } from "./_support/deals.ts";
import { see, recordGate, recordTransition, closeProjectViaModal } from "./_support/ui.ts";
import type { Browser } from "./_support/playwright.ts";

let app: TestApp;
let browser: Browser;
let s: Session;
const P = GREENFIELD.projectId;
const O = GREENFIELD.opportunityId;
const axe: AxeResult[] = [];

beforeAll(async () => {
  app = await startApp("greenfield", { seed: async ({ dbPath, analystId }) => { await seedGreenfieldDeal(dbPath, analystId); } });
  browser = await launchBrowser();
  s = await loginThroughUi(browser, app);
}, 120_000);
afterAll(async () => { await browser?.close(); await app?.stop(); });

describe("greenfield S1 to S12", () => {
  test("S1-S5 and S8-S10 evidence is complete; S6/S7 do not apply to greenfield; S11 is current", async () => {
    await visit(s.page, app, `/projects/${P}/process`);
    await see(s.page, "트랙: greenfield");
    await see(s.page, /현재 S11/);
    await see(s.page, "미적용");
    axe.push(await axeScan(s.page, "process (stage rail)"));
  }, 60_000);

  test("S5 Pre-FS gate GO", async () => {
    await visit(s.page, app, `/deals/${O}/s5`);
    await s.page.locator('section[aria-label="의사결정"]').first().waitFor({ state: "visible" });
    axe.push(await axeScan(s.page, "gate panel: S5 Pre-FS"));
    await recordGate(s.page, app, `/deals/${O}/s5`, null, "go", "자체 진출전략과 역량 격차 해소안이 타당함");
  }, 60_000);

  test("S8 FS gate and S9 DD gate GO", async () => {
    await recordGate(s.page, app, `/projects/${P}/business-case`, null, "go", "신설 법인 사업성(NPV/BEP)이 기준 충족");
    await recordGate(s.page, app, `/projects/${P}/dd`, null, "go", "실현가능성 DD 전 항목 충족");
  }, 90_000);

  test("S11 establishment 5 steps are recorded, then Entity IC and Group IC GO", async () => {
    await visit(s.page, app, `/projects/${P}/ic-review`);
    // R2-B: each step has its own "증적과 함께 완료" action (owner = the person who records it).
    for (let step = 1; step <= 5; step++) {
      // Completed steps switch to "완료됨", so the first remaining action is always the next step.
      const action = s.page.getByRole("button", { name: "증적과 함께 완료" }).first();
      await action.waitFor({ state: "visible", timeout: 30_000 });
      await action.click();
      const form = s.page.locator(`form[aria-label="설립 실행 ${step}단계 기록"]`);
      await form.locator('input[placeholder="data room 링크"]').fill(`https://dataroom.example/e2e/step-${step}`);
      await form.locator('button[type="submit"]').click();
      const put = s.page.waitForResponse((r) => /establishment$/.test(new URL(r.url()).pathname) && r.request().method() === "PUT");
      await s.page.getByRole("alertdialog").getByRole("button", { name: "기록", exact: true }).click();
      const res = await put;
      if (res.status() >= 300) throw new Error(`establishment PUT ${res.status()}: ${await res.text()}`);
      await form.waitFor({ state: "detached", timeout: 15_000 });
    }
    await recordGate(s.page, app, `/projects/${P}/ic-review`, null, "go", "Entity IC: 설립 실행과 투자 구조를 승인", { panelIndex: 0 });
    await recordGate(s.page, app, `/projects/${P}/ic-review`, null, "go", "Group IC: 그룹 자본배분에 부합", { panelIndex: 1 });
    await visit(s.page, app, `/projects/${P}/process`);
    await see(s.page, /현재 S12/);
  }, 150_000);

  test("S12 graduate_to_core with its hand-off record, then typed closure: graduated_to_core", async () => {
    await recordTransition(s.page, app, P, "graduate_to_core", "분기 심의: 목표 매출 달성, 사업부 운영으로 이관", { record: "사업부 운영 이관: 조직·설비·고객 계약 인계 완료" });
    await closeProjectViaModal(s.page, app, P, "핵심사업 편입", "핵심사업 운영 체계로 편입하며 별도 트랜치 투자 종료");
    const closure = app.readDb((d) => d.query("SELECT closure_type, basis_table FROM closure_record WHERE entity_id=?").get(P)) as { closure_type: string; basis_table: string };
    expect(closure).toEqual({ closure_type: "graduated_to_core", basis_table: "venture_transition_decision" });
    const project = app.readDb((d) => d.query("SELECT status, closure_type FROM md_project WHERE id=?").get(P)) as { status: string; closure_type: string };
    expect(project).toEqual({ status: "closed", closure_type: "graduated_to_core" });
  }, 120_000);

  test("axe: process rail and Pre-FS gate panel have no serious or critical violations", () => {
    console.log(formatAxe(axe));
    expect(axe.flatMap((r) => r.blocking)).toEqual([]);
  });
});
