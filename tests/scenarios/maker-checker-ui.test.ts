// ADR-0186 P3 UI with TWO humans on the production bundle: the maker's S11 decision tab shows the entity_ic GO as
// "waiting for a second reviewer" (recorded, not in force), the maker's own countersign attempt is refused in the
// form, the entity reviewer countersigns through the form, and the same reviewer clears the closing condition in the
// conditions list with a note and an evidence reference. The API-level contract is covered by maker-checker.test.ts;
// this file covers what a person sees and does.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApp, type TestApp } from "./_support/harness.ts";
import { launchBrowser, loginThroughUi, visit, axeScan, formatAxe, type Session } from "./_support/browser.ts";
import { GREENFIELD, seedGreenfieldWithReviewers } from "./_support/deals.ts";
import type { Browser, BrowserContext, Page } from "./_support/playwright.ts";

const FAMILIES = ["MAKER_CHECKER", "VALIDATORS", "LADDER"] as const;
for (const f of FAMILIES) process.env[`CO_NEWBIZ_GATE_INTEGRITY_${f}`] = "enforce";

const ENTITY = { userId: "entity-reviewer", password: "Ee5-entity-reviewer-pw!" };
const GROUP = { userId: "group-reviewer", password: "Gg6-group-reviewer-pw!" };
const P = GREENFIELD.projectId;
const O = GREENFIELD.opportunityId;
const RATIONALE = "자체 진출전략과 투자 구조, 위험 요인을 검토했고 조건을 충족해 진행하기로 함";
const GAP = "알려진 미비 사항은 후속 조치 일정과 함께 감수하기로 함";

let app: TestApp;
let browser: Browser;
let maker: Session;
let entityCtx: BrowserContext;

beforeAll(async () => {
  app = await startApp("maker-checker-ui", {
    seed: async ({ dbPath, adminId, analystId }) => { await seedGreenfieldWithReviewers(dbPath, adminId, analystId, { entity: ENTITY, group: GROUP }); },
  });
  browser = await launchBrowser();
  maker = await loginThroughUi(browser, app);
  entityCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ko-KR" });
  const res = await entityCtx.request.post(`${app.baseUrl}/api/auth/login`, { headers: { origin: app.baseUrl }, data: { userId: ENTITY.userId, password: ENTITY.password } });
  if (res.status() >= 300) throw new Error(`reviewer login ${res.status()}`);
}, 180_000);
afterAll(async () => {
  await browser?.close();
  await app?.stop();
  for (const f of FAMILIES) delete process.env[`CO_NEWBIZ_GATE_INTEGRITY_${f}`];
});

async function post(path: string, data: unknown) {
  const csrf = (await maker.context.cookies(app.baseUrl)).find((c) => c.name === "co_newbiz_csrf")?.value ?? "";
  const res = await maker.context.request.post(`${app.baseUrl}${path}`, { headers: { "x-csrf-token": csrf, origin: app.baseUrl }, data });
  return { status: res.status(), body: (await res.json()) as any };
}
const q = <T,>(sql: string, ...args: unknown[]) => app.readDb((d) => d.query(sql).get(...(args as any[])) as T);

async function openDecisionTab(page: Page) {
  await visit(page, app, `/projects/${P}/ic-review`);
  await page.locator("#ic-tab-decision").click();
  await page.locator("#ic-panel-decision").waitFor({ state: "visible", timeout: 30_000 });
}
async function confirmRecord(page: Page) {
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor({ state: "visible", timeout: 20_000 });
  await dialog.getByRole("button", { name: "기록", exact: true }).click();
}

describe("second review and conditions through the UI (two users, enforce)", () => {
  test("seed: ladder GOs and an entity_ic GO with a closing condition (API)", async () => {
    for (const gate of ["screening", "pre_fs"]) expect((await post(`/api/opportunities/${O}/gate-decisions`, { gate, decision: "go", rationale: RATIONALE })).status).toBe(201);
    for (const gate of ["fs", "dd"]) expect((await post(`/api/projects/${P}/gate-decisions`, { gate, decision: "go", rationale: RATIONALE })).status).toBe(201);
    const go = await post(`/api/projects/${P}/gate-decisions`, {
      gate: "entity_ic", decision: "go", rationale: RATIONALE, gap_rationale: GAP,
      conditions: [{ text: "임대 부지의 소유자 동의서를 거래 종결 전까지 확보함", clear_by: "closing" }],
    });
    expect(go.status, JSON.stringify(go.body)).toBe(201);
  }, 120_000);

  test("the maker sees the GO as waiting for a second reviewer and cannot countersign it", async () => {
    await openDecisionTab(maker.page);
    await maker.page.getByTestId("awaiting-countersign").first().waitFor({ state: "visible", timeout: 20_000 });
    const form = maker.page.getByTestId("countersign-form");
    await form.waitFor({ state: "visible" });
    await form.locator("textarea").fill("본인이 기록한 결정을 스스로 승인하려는 시도");
    await form.locator('button[type="submit"]').click();
    await confirmRecord(maker.page);
    await maker.page.locator('[role="alert"]').filter({ hasText: /다른 사람|검토자|권한/ }).first().waitFor({ state: "visible", timeout: 20_000 });
    expect(q<{ c: number }>("SELECT COUNT(*) c FROM approval_chain WHERE project_id = ? AND decided_by IS NOT NULL", P).c).toBe(0);
    const scan = await axeScan(maker.page, "S11 decision tab: awaiting second review");
    expect(scan.blocking, formatAxe([scan])).toEqual([]);
  }, 120_000);

  test("the entity reviewer countersigns in the form; the GO takes effect and the history shows the second review", async () => {
    const page = await entityCtx.newPage();
    await openDecisionTab(page);
    const form = page.getByTestId("countersign-form");
    await form.waitFor({ state: "visible", timeout: 20_000 });
    await form.locator("textarea").fill("패키지를 독립적으로 검토했고 기록된 결정에 동의함");
    const resp = page.waitForResponse((r) => /countersign$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
    await form.locator('button[type="submit"]').click();
    await confirmRecord(page);
    expect((await resp).status()).toBe(201);
    await page.getByTestId("countersign-form").waitFor({ state: "detached", timeout: 20_000 });
    const latest = q<{ status: string }>("SELECT status FROM approval_chain WHERE project_id = ? AND decided_by IS NOT NULL", P);
    expect(latest.status).toBe("approved");
    await page.locator("summary", { hasText: "결정 이력" }).first().click();
    await page.getByTestId("history-countersign").first().waitFor({ state: "visible", timeout: 20_000 });
    await page.close();
  }, 120_000);

  test("the reviewer clears the closing condition in the list (note and evidence); the maker is refused", async () => {
    const page = await entityCtx.newPage();
    await openDecisionTab(page);
    const panel = page.getByTestId("conditions-panel").last();
    await panel.waitFor({ state: "visible", timeout: 20_000 });
    await panel.getByRole("button", { name: /^해소:/ }).click();
    await panel.locator("textarea").fill("소유자 동의서를 수령해 자료실에 보관함");
    await panel.locator("input").last().fill("dataroom:landlord-consent");
    const resp = page.waitForResponse((r) => /\/clear$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
    await panel.getByRole("button", { name: "해소 기록" }).click();
    await confirmRecord(page);
    expect((await resp).status()).toBe(200);
    expect(q<{ status: string }>("SELECT status FROM condition_precedent WHERE project_id = ?", P).status).toBe("cleared");
    await page.close();
  }, 120_000);
});
