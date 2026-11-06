import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApp, type TestApp } from "./_support/harness.ts";
import {
  launchBrowser,
  loginThroughUi,
  visit,
  axeScan,
  formatAxe,
  type AxeResult,
  type Session,
} from "./_support/browser.ts";
import { GREENFIELD, seedGreenfieldDeal } from "./_support/deals.ts";
import { see, revealTab, recordGate, recordTransition, closeProjectViaModal, confirmSynergy } from "./_support/ui.ts";
import type { Browser } from "./_support/playwright.ts";

let app: TestApp;
let browser: Browser;
let s: Session;
const P = GREENFIELD.projectId;
const O = GREENFIELD.opportunityId;
const axe: AxeResult[] = [];

beforeAll(async () => {
  app = await startApp("greenfield", {
    seed: async ({ dbPath, analystId }) => {
      await seedGreenfieldDeal(dbPath, analystId);
    },
  });
  browser = await launchBrowser();
  s = await loginThroughUi(browser, app);
  // ADR-0192: the fixture opportunity is created post-ADR_0192_PREDICATE_DATE,
  // so the S5 pre_fs GO below needs the S3 fit judgement — confirm the synergy
  // recommendation with a rationale, the way a person does (endpoint, not DB).
  await confirmSynergy(app, s, O);
}, 120_000);
afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

describe("greenfield S1 to S12", () => {
  test("S1-S5 and S8-S10 evidence is complete; S6/S7 do not apply to greenfield; S11 is current", async () => {
    await visit(s.page, app, `/projects/${P}/process`);
    await see(s.page, "트랙: 그린필드");
    await see(s.page, /현재 S11/);
    // The not-applicable marker exists twice: in the collapsed compact list (hidden) and in the visible stage rail
    // (PR #533 TrackGate). Target the visible rail marker instead of the first text match.
    await s.page
      .locator(".stage-stepper .stage-step-state")
      .filter({ hasText: "미적용" })
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });
    axe.push(await axeScan(s.page, "process (stage rail)"));
  }, 60_000);

  test("S5 Pre-FS gate GO", async () => {
    await visit(s.page, app, `/deals/${O}/s5`);
    await revealTab(s.page, s.page.locator('section[aria-label="의사결정"]'));
    await s.page.locator('section[aria-label="의사결정"]').first().waitFor({ state: "visible" });
    axe.push(await axeScan(s.page, "gate panel: S5 Pre-FS"));
    await recordGate(s.page, app, `/deals/${O}/s5`, null, "go", "자체 진출전략과 역량 격차 해소안이 타당함");
  }, 60_000);

  test("S8 FS gate and S9 DD gate GO", async () => {
    await recordGate(s.page, app, `/projects/${P}/business-case`, null, "go", "신설 법인 사업성(NPV/BEP)이 기준 충족");
    await recordGate(s.page, app, `/projects/${P}/dd`, null, "go", "실현가능성 DD 전 항목 충족");
  }, 90_000);

  test("S10 shows the recorded establishment mode with the change action (ADR-0167)", async () => {
    await visit(s.page, app, `/projects/${P}/deal-structure`);
    const panel = s.page.locator('section[aria-label="설립 방식"]');
    await panel.waitFor({ state: "visible", timeout: 30_000 });
    await panel.getByText("● 신규 법인 설립").waitFor({ state: "visible", timeout: 20_000 });
    await panel.getByRole("button", { name: "방식 변경" }).waitFor({ state: "visible", timeout: 20_000 });
  }, 60_000);

  test("S11 establishment 5 steps are recorded, then Entity IC and Group IC GO", async () => {
    await visit(s.page, app, `/projects/${P}/ic-review`);
    // ADR-0167: the seeded project carries a human-chosen mode (new_entity, as the S10 choice would record it),
    // so the S11 table is titled by that mode and offers the step actions.
    await see(s.page, "설립 실행 — 5단계 (신규 법인 설립)");
    // ADR-0165: each step has its own "상태 변경" action; the status form records `done` with evidence.
    for (let step = 1; step <= 5; step++) {
      // The UI clears its busy flag before the post-PUT reload lands, so wait for the previous
      // step to show "완료됨" (state, not a sleep), then target this step's own button.
      if (step > 1) {
        await s.page
          .locator(`button[aria-controls="est-step-${step - 1}"]`)
          .filter({ hasText: "완료 취소(재개)" })
          .waitFor({ state: "visible", timeout: 30_000 });
      }
      const action = s.page.locator(`button[aria-controls="est-step-${step}"]`).filter({ hasText: "상태 변경" });
      await action.waitFor({ state: "visible", timeout: 30_000 });
      await action.click();
      const form = s.page.locator(`form[aria-label="설립 실행 ${step}단계 상태 변경"]`);
      await form.locator("select").selectOption("done");
      await form.locator('input[placeholder="data room 링크"]').fill(`https://dataroom.example/e2e/step-${step}`);
      await form.locator('button[type="submit"]').click();
      const put = s.page.waitForResponse(
        (r) => /establishment$/.test(new URL(r.url()).pathname) && r.request().method() === "PUT",
      );
      await s.page.getByRole("alertdialog").getByRole("button", { name: "기록", exact: true }).click();
      const res = await put;
      if (res.status() >= 300) throw new Error(`establishment PUT ${res.status()}: ${await res.text()}`);
      await form.waitFor({ state: "detached", timeout: 15_000 });
    }
    // ADR-0161: the greenfield execution baseline must be confirmed by a person before S11 can complete.
    // Review fix: the confirm POST refuses with 409 baseline_empty until the KPI targets, the
    // hiring plan and at least one permit (or certification) milestone are recorded, so the
    // scenario records one entry per required section through its own add-form first.
    const postBaseline = () =>
      s.page.waitForResponse(
        (r) => /execution-baseline$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
      );
    const addEntry = async (formLabel: string, fields: Array<[string, string]>) => {
      const f = s.page.locator(`form[aria-label="${formLabel}"]`);
      await revealTab(s.page, f);
      for (const [name, value] of fields) await f.getByLabel(name, { exact: true }).fill(value);
      const save = postBaseline();
      await f.locator('button[type="submit"]').click();
      const res = await save;
      if (res.status() >= 300) throw new Error(`${formLabel} POST ${res.status()}: ${await res.text()}`);
    };
    await addEntry("KPI 목표 추가", [
      ["지표 키 (필수)", "utilisation_pct"],
      ["목표값 (필수)", "70"],
      ["기한 (YYYY-Qn 또는 YYYY-MM-DD) (필수)", "2027-Q2"],
    ]);
    await addEntry("채용 계획 추가", [
      ["직군 (필수)", "생산"],
      ["분기 (YYYY-Qn) (필수)", "2027-Q1"],
      ["인원 (명) (필수)", "12"],
    ]);
    await addEntry("인허가 마일스톤 추가", [
      ["인허가 이름 (필수)", "사업장 인허가"],
      ["발급 기관 (필수)", "지방자치단체"],
      ["목표일 (필수)", "2027-06-30"],
    ]);
    await revealTab(s.page, s.page.locator('form[aria-label="실행 기준선 확인"]'));
    await s.page
      .locator('form[aria-label="실행 기준선 확인"] textarea')
      .fill("실행 기준선: 트랜치와 케이스 차이를 검토했고 사람이 확인함");
    await s.page.locator('form[aria-label="실행 기준선 확인"] button[type="submit"]').click();
    // Review fix: the confirm dialog now carries a REQUIRED per-finding acknowledgement
    // textarea for each open finding. Fill every textarea the dialog shows (0 in the clean
    // path) before "확인 기록" is enabled.
    const dialog = s.page.getByRole("alertdialog");
    const acks = dialog.locator("textarea");
    if ((await acks.count()) > 0) {
      for (let i = 0; i < (await acks.count()); i++)
        await acks.nth(i).fill("확인 필요 항목 근거: 검토했고 사람이 확인함");
    }
    const confirmPost = s.page.waitForResponse(
      (r) => /execution-baseline$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "확인 기록", exact: true }).click();
    const confirmRes = await confirmPost;
    if (confirmRes.status() >= 300)
      throw new Error(`execution-baseline POST ${confirmRes.status()}: ${await confirmRes.text()}`);
    await see(s.page, "● 확정됨");
    // ADR-0165: one sequenced decision panel; the form targets the current committee turn (entity_ic, then group_ic).
    await recordGate(s.page, app, `/projects/${P}/ic-review`, null, "go", "Entity IC: 설립 실행과 투자 구조를 승인");
    await recordGate(s.page, app, `/projects/${P}/ic-review`, null, "go", "Group IC: 그룹 자본배분에 부합");
    await visit(s.page, app, `/projects/${P}/process`);
    await see(s.page, /현재 S12/);
  }, 150_000);

  test("S12 graduate_to_core with its hand-off record, then typed closure: graduated_to_core", async () => {
    await recordTransition(s.page, app, P, "graduate_to_core", "분기 심의: 목표 매출 달성, 사업부 운영으로 이관", {
      record: "사업부 운영 이관: 조직·설비·고객 계약 인계 완료",
    });
    await closeProjectViaModal(s.page, app, P, "핵심사업 편입", "핵심사업 운영 체계로 편입하며 별도 트랜치 투자 종료");
    const closure = app.readDb((d) =>
      d.query("SELECT closure_type, basis_table FROM closure_record WHERE entity_id=?").get(P),
    ) as { closure_type: string; basis_table: string };
    expect(closure).toEqual({ closure_type: "graduated_to_core", basis_table: "venture_transition_decision" });
    const project = app.readDb((d) => d.query("SELECT status, closure_type FROM md_project WHERE id=?").get(P)) as {
      status: string;
      closure_type: string;
    };
    expect(project).toEqual({ status: "closed", closure_type: "graduated_to_core" });
  }, 120_000);

  test("axe: process rail and Pre-FS gate panel have no serious or critical violations", () => {
    console.log(formatAxe(axe));
    expect(axe.flatMap((r) => r.blocking)).toEqual([]);
  });
});
