// T6 locale smoke (design 2026-10-23-i18n-ui-adoption §5.4): the D3 negotiation
// seam end-to-end in a real browser — default ko master, the NEXT_LOCALE
// cookie switches <html lang>/<html dir>, and the AppShell sidebar renders the
// target locale's catalog label (nav.dealBoard). One scenario, both locales.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { launchBrowser, loginThroughUi, visit, type Session } from "./_support/browser.ts";
import { startApp, type TestApp } from "./_support/harness.ts";
import type { Browser } from "./_support/playwright.ts";
import ko from "../../app/web-next/locales/ko.json";
import en from "../../app/web-next/locales/en.json";

let app: TestApp;
let browser: Browser;
let session: Session;

beforeAll(async () => {
  app = await startApp("locale-smoke");
  browser = await launchBrowser();
  session = await loginThroughUi(browser, app);
}, 180_000);
afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

/** Assert the negotiated locale reached the document and the sidebar. */
async function expectLocaleUI(
  page: Session["page"],
  app: TestApp,
  lang: string,
  dealBoardLabel: string,
): Promise<void> {
  await visit(page, app, "/deals");
  expect(await page.locator("html").getAttribute("lang")).toBe(lang);
  expect(await page.locator("html").getAttribute("dir")).toBe("ltr");
  // AppShell is a client component; the sidebar label appears after hydration.
  await page
    .locator('a[href="/deals"]', { hasText: dealBoardLabel })
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
  expect(await page.locator('a[href="/deals"]', { hasText: dealBoardLabel }).first().isVisible()).toBe(true);
}

describe("locale smoke (design §5.4)", () => {
  test("default ko; NEXT_LOCALE=en cookie switches html lang/dir and the AppShell nav label", async () => {
    const { page, context } = session;

    // 1. No cookie: negotiation resolves to the ko master (defaultLocale).
    await expectLocaleUI(page, app, "ko", ko.nav.dealBoard);

    // 2. The D3 seam: cookie NEXT_LOCALE=en re-negotiates on the next request —
    //    same URL, no [locale] route segment.
    await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: app.baseUrl }]);
    await expectLocaleUI(page, app, "en", en.nav.dealBoard);
  }, 300_000);

  // Switcher form amendment 2026-10-24 (user-directed): the LocaleSwitcher is a
  // disclosure dropdown, so the end-to-end flip is driven through the real UI —
  // open the menu, click the English endonym (menuitemradio), and the cookie +
  // router.refresh() re-negotiate server-side.
  test("LocaleSwitcher dropdown: clicking the English endonym flips html lang; URL unchanged", async () => {
    const { page, context } = session;

    // Test 1 leaves NEXT_LOCALE=en behind; start this scenario from the ko master.
    await context.addCookies([{ name: "NEXT_LOCALE", value: "ko", url: app.baseUrl }]);
    await expectLocaleUI(page, app, "ko", ko.nav.dealBoard);
    const urlBefore = new URL(page.url());

    // Drive the real UI: disclosure trigger (aria-expanded) → menu → endonym item.
    const switcher = page.locator(".locale-switcher");
    const trigger = switcher.getByRole("button", { name: ko.common.languageSwitcher });
    await trigger.waitFor({ state: "visible", timeout: 15_000 });
    await trigger.click();
    const menu = switcher.getByRole("menu");
    await menu.waitFor({ state: "visible", timeout: 5_000 });
    expect(await trigger.getAttribute("aria-expanded")).toBe("true");
    await switcher.getByRole("menuitemradio", { name: "English" }).click();

    // select() wrote the NEXT_LOCALE cookie and refreshed; the server re-negotiates.
    await page.locator('html[lang="en"]').waitFor({ timeout: 15_000 });
    expect(await page.locator("html").getAttribute("lang")).toBe("en");
    // The trigger now carries the active endonym with the menu closed.
    const reopenedTrigger = switcher.getByRole("button", { name: en.common.languageSwitcher });
    await reopenedTrigger.waitFor({ state: "visible", timeout: 15_000 });
    expect(await reopenedTrigger.getAttribute("aria-expanded")).toBe("false");
    // D3: same URL, no [locale] route segment.
    const urlAfter = new URL(page.url());
    expect(urlAfter.pathname + urlAfter.search).toBe(urlBefore.pathname + urlBefore.search);
  }, 300_000);
});
