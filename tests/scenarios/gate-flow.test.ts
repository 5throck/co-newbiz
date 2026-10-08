// R2-B decision surfaces (spec 2026-10-09-ux-r2-design): one gate-recording flow on every gate
// panel (confirm -> toast -> recorded summary with no resubmission -> next-stage prompt), the
// decision form reachable from the top, an IC GO with missing artifacts that asks for a typed
// rationale without blocking, and the S9 inline waiver action with Korean checklist text.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApp, type TestApp } from "./_support/harness.ts";
import { axeScan, formatAxe, launchBrowser, loginThroughUi, visit, type AxeResult, type Session } from "./_support/browser.ts";
import { BROWNFIELD, seedBrownfieldDeal } from "./_support/deals.ts";
import { recordGate, see } from "./_support/ui.ts";
import type { Browser } from "./_support/playwright.ts";

let app: TestApp;
let browser: Browser;
let s: Session;
const P = BROWNFIELD.projectId;
const axe: AxeResult[] = [];
const gateCount = (gate: string): number =>
  (app.readDb((d) => d.query("SELECT COUNT(*) c FROM gate_decision WHERE entity_id=? AND gate=?").get(P, gate)) as { c: number }).c;

beforeAll(async () => {
  app = await startApp("gate-flow", { seed: ({ dbPath, analystId }) => { seedBrownfieldDeal(dbPath, analystId); } });
  browser = await launchBrowser();
  s = await loginThroughUi(browser, app);
}, 120_000);
afterAll(async () => { await browser?.close(); await app?.stop(); });

describe("R2-B shared gate-recording flow (S8)", () => {
  test("the stage primary jumps to the decision tab and focuses the form; the form is not under every tab", async () => {
    await visit(s.page, app, `/projects/${P}/business-case`);
    await s.page.locator('main').first().waitFor({ state: "visible" });
    expect(await s.page.locator('section[aria-label="의사결정"]').count()).toBe(0);
    await s.page.getByRole("button", { name: "결정 기록 (사람)" }).click();
    await s.page.locator('section[aria-label="의사결정"]').waitFor({ state: "visible", timeout: 20_000 });
    await s.page.waitForFunction(() => !!document.activeElement?.closest('[data-gate-form="fs"] form'), undefined, { timeout: 10_000 });
    // One tab row: WACC and 재무분석 live in the stage row only, not repeated in the in-page tabs.
    expect(await s.page.getByRole("tab", { name: "WACC" }).count()).toBe(1);
    expect(await s.page.getByRole("tab", { name: "재무분석" }).count()).toBe(1);
  }, 60_000);

  test("confirm -> toast -> recorded summary -> no resubmission -> next-stage link", async () => {
    await visit(s.page, app, `/projects/${P}/business-case?tab=decision`);
    const panel = s.page.locator('section[aria-label="의사결정"]');
    const form = panel.locator('form[aria-label="의사결정 기록"]');
    await form.waitFor({ state: "visible", timeout: 30_000 });
    await form.locator("select").last().selectOption("go");
    await form.locator("input[required]").first().fill("채택 사례의 NPV/BEP가 투자 기준을 충족함");
    await form.locator('button[type="submit"]').last().click();
    // Step 1 - confirm dialog; nothing is recorded before it is accepted.
    const dialog = s.page.getByRole("alertdialog");
    await dialog.waitFor({ state: "visible", timeout: 20_000 });
    expect(gateCount("fs")).toBe(0);
    await dialog.getByRole("button", { name: "취소" }).click();
    expect(gateCount("fs")).toBe(0);
    await form.locator('button[type="submit"]').last().click();
    const posted = s.page.waitForResponse((r) => /gate-decisions$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
    await s.page.getByRole("alertdialog").getByRole("button", { name: "기록", exact: true }).click();
    expect((await posted).status()).toBe(201);
    // Step 2-4 - toast, summary instead of the form, next-stage prompt.
    await s.page.locator(".toast").filter({ hasText: "GO 결정을 기록했습니다" }).waitFor({ state: "visible", timeout: 10_000 });
    const summary = panel.locator('[aria-label="기록된 결정"]');
    await summary.waitFor({ state: "visible", timeout: 10_000 });
    expect(await summary.innerText()).toContain("GO 기록됨");
    expect(await panel.locator('form[aria-label="의사결정 기록"]').count()).toBe(0); // no resubmission
    await summary.getByRole("link", { name: /다음: S9/ }).waitFor({ state: "visible" });
    expect(gateCount("fs")).toBe(1);
    axe.push(await axeScan(s.page, "gate recorded summary (S8 decision tab)"));
  }, 90_000);
});

describe("R2-B S9 inline waiver and Korean checklist", () => {
  test("a waivable row opens the request dialog prefilled with the item; a non-waivable row says why on the row", async () => {
    await visit(s.page, app, `/projects/${P}/dd`);
    await s.page.locator("button", { hasText: "M&A 6대 검증" }).first().click();
    await see(s.page, /M&A 필수 검증 6종/); // Korean display text for bf-01
    await see(s.page, /면제 불가 - 6종 검증의 완비/); // visible on the row, not only a tooltip
    expect(await s.page.getByRole("button", { name: /면제 요청·연결/ }).count()).toBeGreaterThan(0);
    // Existing judgements are shown as stored (grandfathered), with who and when.
    await see(s.page, /판정: /);
    const row = s.page.locator("tr", { hasText: "bf-04" });
    await row.getByRole("button", { name: /면제 요청·연결/ }).click();
    const dialog = s.page.getByRole("dialog", { name: "면제 요청·연결" });
    await dialog.waitFor({ state: "visible", timeout: 20_000 });
    expect(await dialog.locator('input[placeholder="예: §4-2.1"]').inputValue()).toContain("bf-04");
    // The disabled submit shows its reason as text.
    expect(await dialog.getByRole("button", { name: "요청", exact: true }).isDisabled()).toBe(true);
    await dialog.getByText(/요청하려면 .*입력하세요/).waitFor({ state: "visible" });
    axe.push(await axeScan(s.page, "S9 waiver dialog"));
    await dialog.locator("select").first().selectOption({ index: 1 });
    await dialog.locator("textarea").fill("대상 기업의 임원 보상 자료가 데이터룸에 없어 면제를 요청함");
    await dialog.locator('input[type="date"]').fill("2030-12-31");
    const posted = s.page.waitForResponse((r) => /\/waivers$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
    await dialog.getByRole("button", { name: "요청", exact: true }).click();
    expect((await posted).status()).toBe(201);
    await s.page.locator(".toast").filter({ hasText: "면제 요청을 등록했습니다" }).waitFor({ state: "visible", timeout: 10_000 });
    const w = app.readDb((d) => d.query("SELECT clause_ref, status FROM waiver WHERE project_id=?").get(P)) as { clause_ref: string; status: string } | null;
    expect(w?.clause_ref).toContain("bf-04");
  }, 90_000);
});

describe("R2-B IC GO with missing artifacts", () => {
  test("the warning dialog lists the gaps, requires a typed rationale, never blocks, and the rationale shows in the IC package", async () => {
    await recordGate(s.page, app, `/projects/${P}/dd`, null, "go", "M&A 6대 검증 포함 전 DD 항목 충족");
    await visit(s.page, app, `/projects/${P}/ic-review`);
    // One review block for both IC gates (the panels do not repeat it).
    await s.page.locator('section[aria-label="의사결정"]').first().waitFor({ state: "visible", timeout: 30_000 });
    expect(await s.page.locator('section[aria-label="3단계 검토"]').count()).toBe(1);
    const gaps = await s.page.evaluate(async (pid) => {
      const r = await fetch(`/api/projects/${pid}/ic-package`);
      return ((await r.json()).data.gates.go_gaps as string[]);
    }, P);
    expect(gaps.length).toBeGreaterThan(0); // the demo deal has no graded RAG
    // The stage primary reaches the form from the top.
    await s.page.getByRole("button", { name: "결정 기록 (사람)" }).click();
    await s.page.waitForFunction(() => !!document.activeElement?.closest('[data-gate-form="entity_ic"] form'), undefined, { timeout: 10_000 });
    const panel = s.page.locator('section[aria-label="의사결정"]').first();
    const form = panel.locator('form[aria-label="의사결정 기록"]');
    await form.locator("select").last().selectOption("go");
    await form.locator("input[required]").first().fill("Entity IC: 투자 구조와 DD 결과를 검토하고 승인함");
    await form.locator('button[type="submit"]').last().click();
    const dialog = s.page.getByRole("alertdialog", { name: "누락 산출물 경고" });
    await dialog.waitFor({ state: "visible", timeout: 20_000 });
    expect(await dialog.getByRole("list", { name: "누락 항목" }).locator("li").count()).toBe(gaps.length);
    expect(gateCount("entity_ic")).toBe(0);
    const go = dialog.getByRole("button", { name: "그래도 GO 기록" });
    expect(await go.isDisabled()).toBe(true); // typed rationale is required
    await dialog.getByText("예외 근거를 입력하면 GO를 기록할 수 있습니다.").waitFor({ state: "visible" });
    axe.push(await axeScan(s.page, "IC warning dialog"));
    await dialog.locator("textarea").fill("RAG 산정 전이지만 위원회가 정성 판단으로 진행하기로 함");
    expect(await go.isDisabled()).toBe(false);
    const posted = s.page.waitForResponse((r) => /gate-decisions$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
    await go.click();
    expect((await posted).status()).toBe(201); // the human is not blocked
    const stored = app.readDb((d) => d.query("SELECT rationale FROM gate_decision WHERE entity_id=? AND gate='entity_ic'").get(P)) as { rationale: string };
    expect(stored.rationale).toContain("RAG 산정 전이지만 위원회가 정성 판단으로 진행하기로 함");
    await panel.locator('[aria-label="기록된 결정"]').waitFor({ state: "visible", timeout: 10_000 });
    // The next-stage prompt of the Entity IC points at the Group IC form.
    await panel.getByRole("link", { name: /다음: Group IC/ }).waitFor({ state: "visible" });
    // Shown in the IC package after a reload.
    await visit(s.page, app, `/projects/${P}/ic-review`);
    await see(s.page, "누락 산출물 예외 근거 (GO 기록 시 작성)");
    await see(s.page, "RAG 산정 전이지만 위원회가 정성 판단으로 진행하기로 함");
  }, 120_000);

  test("axe: the new gate surfaces have no serious or critical violations", () => {
    console.log(formatAxe(axe));
    expect(axe.flatMap((r) => r.blocking)).toEqual([]);
  });
});
