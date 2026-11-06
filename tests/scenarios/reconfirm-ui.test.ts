// ADR-0186 P5 UI on the production bundle: (1) the admin "Gate integrity" KPI screen renders all twelve indicators —
// as cards with state in icon + text or, since the bdaf2657 screen redesign, collapsed into their group's empty
// summary when they have nothing to show for the period — plus the shadow-report copy; (2) an administrator opens a re-confirmation requirement on a project,
// a person sees the notice on the stage screen with its items and a disabled clear action, and a GO recorded through the
// decision form is refused inline (409 reconfirmation_required) with the unmet items named; nothing is recorded.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApp, type TestApp } from "./_support/harness.ts";
import {
  axeScan,
  formatAxe,
  launchBrowser,
  loginThroughUi,
  visit,
  type AxeResult,
  type Session,
} from "./_support/browser.ts";
import { GREENFIELD, seedGreenfieldDeal } from "./_support/deals.ts";
import { confirmSynergy } from "./_support/ui.ts";
import type { Browser } from "./_support/playwright.ts";

let app: TestApp;
let browser: Browser;
let analyst: Session;
let admin: Session;
const P = GREENFIELD.projectId;
const REASON = "이전 규칙으로 기록된 프로젝트라 새로 쓰기 전에 확정 값과 두 번째 확인을 다시 받기로 함";
const axe: AxeResult[] = [];

beforeAll(async () => {
  app = await startApp("reconfirm-ui", {
    seed: async ({ dbPath, analystId }) => {
      await seedGreenfieldDeal(dbPath, analystId);
    },
  });
  browser = await launchBrowser();
  analyst = await loginThroughUi(browser, app);
  // ADR-0192: the fs GO this scenario re-confirms must fail ONLY on the
  // reconfirmation family, so the S3 fit judgement has to be legitimately
  // complete — confirm the synergy recommendation through the endpoint first.
  await confirmSynergy(app, analyst, GREENFIELD.opportunityId);
  admin = await loginThroughUi(browser, app, "admin");
}, 180_000);
afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

const fsRows = () =>
  app.readDb(
    (d) =>
      (d.query("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ? AND gate = 'fs'").get(P) as { c: number }).c,
  );

describe("admin gate integrity KPI screen", () => {
  test("renders G1-G12 (cards or collapsed empty summaries), each rendered card with a state in text, and no axe violations in both themes", async () => {
    await visit(admin.page, app, "/admin/gate-integrity");
    await admin.page.locator('[data-testid="kpi-summary"]').waitFor({ state: "visible", timeout: 30_000 });
    // bdaf2657 (feat(admin): admin console and screen improvements) redesigned this
    // screen: a KPI that computes fine but has nothing to show for the period
    // (isEmptyKpi) collapses into its group's "empty" summary (`kpi-empty-<group>`)
    // instead of rendering a `kpi-G*` card, so the card count is data-dependent —
    // under the greenfield seed only G7 (breached), G11 and G12 (never empty by
    // contract) render as cards. The twelve-indicator contract is now: every G id
    // appears either as a card or inside its group's empty summary.
    const cardTestids = await admin.page
      .locator('[data-testid^="kpi-G"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid") ?? ""));
    const emptyText = (await admin.page.locator('[data-testid^="kpi-empty-"] li').allTextContents()).join("\n");
    const emptyIds = [...emptyText.matchAll(/G\d+/g)].map((m) => m[0]);
    const missing = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"].filter(
      (id) => !cardTestids.includes(`kpi-${id}`) && !emptyIds.includes(id),
    );
    expect(missing).toEqual([]);
    for (const testid of cardTestids) {
      const text = await admin.page.locator(`[data-testid="${testid}"]`).innerText();
      expect(/한도 이내|한도 초과|데이터베이스 변경 대기|계산 불가/.test(text), `${testid}: ${text.slice(0, 80)}`).toBe(
        true,
      );
    }
    // G6's unreviewed note ("검토 전") renders only when G6 has data for the period;
    // a collapsed G6 shows the readiness group's empty summary instead.
    const g6Card = admin.page.locator('[data-testid="kpi-G6"]');
    if ((await g6Card.count()) > 0) {
      expect(await g6Card.innerText()).toContain("검토 전");
    } else {
      expect(emptyText).toContain("G6");
    }
    expect(await admin.page.locator("h1").count()).toBe(1);
    axe.push(await axeScan(admin.page, "light /admin/gate-integrity"));
    await admin.page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    axe.push(await axeScan(admin.page, "dark /admin/gate-integrity"));
    // bdaf2657 renamed the filter label (게이트 → 관문) and the summary now renders the
    // gate through useAdminLabel("kpiKey") ("fs" → "타당성") instead of the raw key.
    const gate = admin.page.getByLabel("관문");
    await gate.selectOption("fs");
    await admin.page.getByRole("button", { name: "지표 보기" }).click();
    await admin.page
      .locator('[data-testid="kpi-summary"]')
      .filter({ hasText: "타당성" })
      .waitFor({ state: "visible", timeout: 20_000 });
  }, 120_000);
});

describe("re-confirmation notice and the inline 409", () => {
  test("an administrator opens the requirement; the person sees the notice; a GO through the form is refused inline", async () => {
    // An administrator opens it from the admin console (no project visibility); the CLI uses the same function.
    await visit(admin.page, app, "/admin/gate-integrity");
    const create = admin.page.locator('[data-testid="reconfirm-create"]');
    await create.waitFor({ state: "visible", timeout: 30_000 });
    await create.locator("summary").click();
    await create.getByLabel("프로젝트 id").fill(P);
    await create.locator("textarea").fill(REASON);
    await create.getByRole("button", { name: "요건 열기" }).click();
    await admin.page
      .locator(".toast")
      .filter({ hasText: "요건을 열었습니다" })
      .waitFor({ state: "visible", timeout: 20_000 });
    expect(
      app.readDb(
        (d) =>
          (
            d
              .query("SELECT COUNT(*) c FROM project_reconfirm_requirement WHERE project_id = ? AND cleared_at IS NULL")
              .get(P) as { c: number }
          ).c,
      ),
    ).toBe(1);

    await visit(analyst.page, app, `/projects/${P}/business-case?tab=decision`);
    const notice = analyst.page.locator('[data-testid="reconfirm-notice"]');
    await notice.waitFor({ state: "visible", timeout: 30_000 });
    const text = await notice.innerText();
    expect(text).toContain("새로 쓰기 전에 다시 확인해야 합니다");
    expect(text).toContain("투자위원회 GO를 두 번째 사람이 확인");
    expect(text).toContain("미충족");
    expect(await notice.getByRole("button", { name: "요건 해제" }).isDisabled()).toBe(true);
    axe.push(await axeScan(analyst.page, "light business-case with notice"));

    const panel = analyst.page.locator('section[aria-label="의사결정"]');
    const form = panel.locator('form[aria-label="의사결정 기록"]');
    await form.waitFor({ state: "visible", timeout: 30_000 });
    await form.locator("select").last().selectOption("go");
    await form.locator("input[required]").first().fill("채택 사례의 NPV/BEP가 투자 기준을 충족함");
    await form.locator('button[type="submit"]').last().click();
    const posted = analyst.page.waitForResponse(
      (r) => /gate-decisions$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
    );
    await analyst.page.getByRole("alertdialog").getByRole("button", { name: "기록", exact: true }).click();
    const res = await posted;
    expect(res.status()).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("reconfirmation_required");
    const alert = panel.getByRole("alert").filter({ hasText: "투자위원회 GO를 두 번째 사람이 확인" });
    await alert.waitFor({ state: "visible", timeout: 10_000 });
    expect(fsRows()).toBe(0);
  }, 180_000);

  test("axe has no serious or critical violations", () => {
    console.log(formatAxe(axe));
    expect(axe.flatMap((r) => r.blocking)).toEqual([]);
  });
});
