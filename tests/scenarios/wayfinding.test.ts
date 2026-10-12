// R2-A wayfinding (spec 2026-10-09-ux-r2-design): the board's "new review" reaches a
// working market-analysis form in at most 3 clicks, every deal/stage/opportunity page
// offers a breadcrumb back, the S8+ rail links resolve to the promoted project, picker
// pages obey the page contract, and redirects of retired routes are announced.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApp, type TestApp } from "./_support/harness.ts";
import { axeScan, formatAxe, launchBrowser, loginThroughUi, visit, type AxeResult, type Session } from "./_support/browser.ts";
import { BROWNFIELD, seedBrownfieldDeal } from "./_support/deals.ts";
import { getDb } from "../../db/client.ts";
import { see } from "./_support/ui.ts";
import type { Browser } from "./_support/playwright.ts";

let app: TestApp;
let browser: Browser;
let s: Session;
const O = BROWNFIELD.opportunityId;
const P = BROWNFIELD.projectId;
const FRESH = "e2e-fresh-opportunity";
const SECOND = "e2e-second-selected";

beforeAll(async () => {
  app = await startApp("wayfinding", {
    seed: ({ dbPath, analystId }) => {
      seedBrownfieldDeal(dbPath, analystId);
      const db = getDb(dbPath);
      const now = new Date().toISOString();
      // Bootstrap fixtures only: a brand-new (identified, unpromoted) opportunity and a second
      // selected one so the flat routes render their picker instead of redirecting.
      db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?, '신규 로봇 기회', 'identified', ?, ?)", [FRESH, analystId, now]);
      db.run("INSERT INTO opportunity (id, name, status, attractiveness_score, synergy_score, created_by, created_at) VALUES (?, '두 번째 선별 기회', 'selected', 70, 66, ?, ?)", [SECOND, analystId, now]);
    },
  });
  browser = await launchBrowser();
  s = await loginThroughUi(browser, app);
}, 120_000);
afterAll(async () => { await browser?.close(); await app?.stop(); });

describe("R2-A wayfinding", () => {
  test("a new market analysis starts from the board in at most 3 clicks", async () => {
    await visit(s.page, app, "/deals");
    let clicks = 0;
    await s.page.getByRole("link", { name: /새 검토 시작/ }).click(); clicks++;
    // Lands on the working form, focused, not on a deal picker.
    await s.page.waitForURL(/\/market\?new=1/);
    const input = s.page.locator("#market-new-name");
    await input.waitFor({ state: "visible", timeout: 30_000 });
    expect(await s.page.evaluate(() => document.activeElement?.id)).toBe("market-new-name");
    await input.fill("E2E 신규 로봇 산업");
    await s.page.getByRole("button", { name: /분석 범위 선택/ }).click(); clicks++;
    await s.page.getByRole("button", { name: "이 산업만 분석" }).click(); clicks++;
    expect(clicks).toBeLessThanOrEqual(3);
    const deadline = Date.now() + 30_000;
    let found = 0;
    while (Date.now() < deadline && found === 0) {
      found = (app.readDb((d) => d.query("SELECT COUNT(*) c FROM md_industry WHERE name_ko='E2E 신규 로봇 산업'").get()) as { c: number }).c;
      if (found === 0) await new Promise((r) => setTimeout(r, 500));
    }
    expect(found).toBe(1);
  }, 120_000);

  test("S1, S2, S3 and the opportunity detail each offer a breadcrumb back to the board", async () => {
    for (const path of [`/deals/${O}/s1`, `/deals/${O}/s2`, `/deals/${O}/s3`, `/opportunities/${O}`]) {
      await visit(s.page, app, path);
      const crumb = s.page.getByRole("navigation", { name: "현재 위치" });
      await crumb.waitFor({ state: "visible", timeout: 30_000 });
      await crumb.getByRole("link", { name: "검토/안건 보드" }).click();
      await s.page.waitForURL(/\/deals$/, { timeout: 30_000 });
    }
  }, 120_000);

  test("the opportunity detail goes back to the deal's S2 list, not a deal picker", async () => {
    await visit(s.page, app, `/opportunities/${O}`);
    await s.page.getByRole("link", { name: /S2 목록으로/ }).click();
    await s.page.waitForURL(new RegExp(`/deals/${O}/s2`), { timeout: 30_000 });
  }, 60_000);

  test("the S1 report has the stage rail and a next-step action to S2", async () => {
    await visit(s.page, app, `/deals/${O}/s1?industry=demo-s1-s12-industry`);
    await s.page.getByRole("navigation", { name: "Stages" }).waitFor({ state: "visible", timeout: 30_000 });
    await s.page.getByRole("button", { name: /산업 목록으로/ }).waitFor({ state: "visible" });
    await s.page.getByRole("link", { name: /다음: S2 기회 발굴/ }).click();
    await s.page.waitForURL(new RegExp(`/deals/${O}/s2`), { timeout: 30_000 });
  }, 60_000);

  test("the rail S8 link from an S7 page resolves to the promoted project, not Not found", async () => {
    await visit(s.page, app, `/deals/${O}/s7`);
    const link = s.page.locator(".stage-stepper a.stage-step", { hasText: "사업성 분석" });
    await link.waitFor({ state: "visible", timeout: 30_000 });
    await link.click();
    await s.page.waitForURL(new RegExp(`/projects/${P}/business-case`), { timeout: 30_000 });
    expect(await s.page.getByText("Not found.").count()).toBe(0);
  }, 60_000);

  test("for an unpromoted deal the S8-S12 rail items are disabled with a reason, not dead links", async () => {
    await visit(s.page, app, `/deals/${FRESH}/s2`);
    const s8 = s.page.locator(".stage-stepper .stage-step", { hasText: "사업성 분석" });
    await s8.waitFor({ state: "visible", timeout: 30_000 });
    await s.page.waitForFunction(() => document.querySelector(".stage-stepper [aria-disabled='true']"));
    expect(await s8.evaluate((el) => el.tagName)).toBe("SPAN");
    expect(await s8.getAttribute("title")).toMatch(/승격/);
  }, 60_000);

  test("a new opportunity is advanced from the S2 list by its own row action", async () => {
    await visit(s.page, app, `/deals/${O}/s2`);
    await s.page.getByRole("link", { name: /매력도 평가.*신규 로봇 기회/ }).click();
    await s.page.waitForURL(new RegExp(`/opportunities/${FRESH}`), { timeout: 30_000 });
    await s.page.locator("#opp-score-input").waitFor({ state: "visible", timeout: 30_000 });
    expect(await s.page.evaluate(() => document.activeElement?.id)).toBe("opp-score-input");
    await s.page.locator("#opp-score-input").fill("72");
    await s.page.getByRole("button", { name: "매력도 평가", exact: true }).click();
    await s.page.getByRole("link", { name: /S3 탭으로 이동/ }).click();
    await s.page.waitForURL(new RegExp(`/deals/${FRESH}/s3`), { timeout: 30_000 });
    expect(await s.page.getByText("\"회사 등록\"").count()).toBe(0);
  }, 90_000);

  test("picker pages have an h1, a breadcrumb, a create action, an active sidebar item and a back control", async () => {
    // ADR-0105 / tests/unit/navigation.test.ts: /route-decision is a flat deal-less route whose
    // top-bar back (button.back-link) replaces the in-page breadcrumb; CarrierGate pickers keep one.
    const cases: Array<[string, RegExp, RegExp, boolean]> = [
      ["/market", /S1 시장분석/, /새 시장분석 시작/, true],
      ["/opportunities", /S2 기회 발굴/, /새 기회 등록/, true],
      ["/synergy", /S3 시너지/, /그룹·계열사 프로파일 등록/, true],
      ["/route-decision", /S4 진출방식 결정/, /새 검토 시작/, false],
    ];
    for (const [path, title, create, hasBreadcrumb] of cases) {
      await visit(s.page, app, path);
      await s.page.getByRole("heading", { level: 1, name: title }).waitFor({ state: "visible", timeout: 30_000 });
      if (hasBreadcrumb) await s.page.getByRole("navigation", { name: "현재 위치" }).waitFor({ state: "visible" });
      else expect(await s.page.getByRole("navigation", { name: "현재 위치" }).count()).toBe(0);
      expect(await s.page.getByRole("link", { name: create }).count()).toBeGreaterThan(0);
      expect(await s.page.locator("aside a.side-nav-link-active", { hasText: "검토/안건 보드" }).count()).toBe(1);
      expect(await s.page.locator("button.back-link").count()).toBe(1);
    }
  }, 120_000);

  test("known-target entry lands on a focused form at the top and the guide steps are links", async () => {
    await visit(s.page, app, "/opportunities?known_target=1");
    await s.page.locator("#opp-new-name").waitFor({ state: "visible", timeout: 30_000 });
    expect(await s.page.evaluate(() => document.activeElement?.id)).toBe("opp-new-name");
    // The form is in the viewport on landing (not below the fold behind the funnel).
    expect(await s.page.evaluate(() => {
      const r = document.getElementById("opp-new-name")!.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    })).toBe(true);
    await s.page.locator("#opp-new-name").fill("E2E 알려진 대상 검토");
    await s.page.locator("#opp-known-target").fill("이베이코리아");
    await s.page.getByRole("button", { name: "등록", exact: true }).click();
    await s.page.waitForURL(/\/opportunities\/[^/?]+$/, { timeout: 30_000 });
    const guide = s.page.getByTestId("known-target-guide");
    await guide.waitFor({ state: "visible", timeout: 30_000 });
    const hrefs = await guide.locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((h) => /^\/deals\/[^/]+\/s[1-4]$/.test(h ?? ""))).toBe(true);
  }, 120_000);

  test("retired routes redirect with a visible notice", async () => {
    await visit(s.page, app, "/pipeline");
    await s.page.waitForURL(/\/deals\?moved=pipeline/, { timeout: 30_000 });
    await see(s.page, /파이프라인 현황\(\/pipeline\)은 검토\/안건 보드로 통합/);
    await visit(s.page, app, "/process/S1");
    await s.page.waitForURL(/\/deals\?moved=process/, { timeout: 30_000 });
    await see(s.page, /단계별 허브/);
  }, 60_000);

  test("orphan routes are linked from the board", async () => {
    await visit(s.page, app, "/deals");
    const shortcuts = s.page.getByRole("navigation", { name: "관련 화면 바로가기" });
    await shortcuts.waitFor({ state: "visible", timeout: 30_000 });
    const hrefs = await shortcuts.locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    for (const h of ["/projects", "/portfolio-view", "/our-company", "/companies", "/agents", "/onboarding"]) expect(hrefs).toContain(h);
  }, 60_000);

  test("the new wayfinding surfaces pass axe (WCAG 2.1 AA) with zero serious or critical violations", async () => {
    const results: AxeResult[] = [];
    for (const [label, path] of [
      ["market picker", "/market"],
      ["route-decision picker", "/route-decision"],
      ["S1 report", `/deals/${O}/s1?industry=demo-s1-s12-industry`],
      ["S2 list", `/deals/${O}/s2`],
      ["opportunity detail", `/opportunities/${O}`],
      ["known-target landing", "/opportunities?known_target=1"],
    ] as const) {
      await visit(s.page, app, path);
      await s.page.getByRole("heading", { level: 1 }).first().waitFor({ state: "visible", timeout: 30_000 });
      results.push(await axeScan(s.page, label));
    }
    const blocking = results.filter((r) => r.blocking.length > 0);
    expect(blocking.length, formatAxe(results)).toBe(0);
  }, 120_000);
});
