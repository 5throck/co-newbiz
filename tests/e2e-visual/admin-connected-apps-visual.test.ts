// @version 1.0.0
/**
 * Admin console visual smoke — /admin/connected-apps (design
 * 2026-11-27-admin-oauth-client-stop-start). The stage-visual-smoke walk is
 * stage-path-scoped (its geometry invariants assert the StageFrame segments an
 * admin page must not carry), so this file follows the same conventions with a
 * focused admin walk of its own: boot the production server against a scratch
 * SQLite, register two OAuth clients in the seed (one stamped stopped), log in
 * through the REAL login UI as the ADMIN account, visit the section, and
 * assert the P2 Report surface — h1, nav entry, the fleet table with both
 * status chips (● 운영 중 / ✕ 중단), one state-dependent action per row, and
 * the counted status filter trio. Screenshot lands in screenshots/
 * (gitignored) like the stage walk; no aHash baseline (capture-only, the
 * walk's opt-in diff contract).
 *
 * Run: bun run test:visual  (bun scripts/test-runner.ts visual — sequential;
 * this file boots its own server + browser per the suite contract).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { startApp, type TestApp } from "../scenarios/_support/harness.ts";
import { launchBrowser, loginThroughUi, visit, type Session } from "../scenarios/_support/browser.ts";
import type { Browser } from "../scenarios/_support/playwright.ts";
import { getDb } from "../../db/client.ts";
import { registerClient } from "../../db/lib/oauth.ts";

const OUT_DIR = join(import.meta.dirname, "screenshots");

let app: TestApp;
let browser: Browser;
let admin: Session;

beforeAll(async () => {
  app = await startApp("admin-connected-apps", {
    seed: ({ dbPath }) => {
      const db = getDb(dbPath);
      const now = new Date().toISOString();
      const running = registerClient(db, {
        name: "ChatGPT connector",
        redirectUris: ["http://127.0.0.1:33419/callback"],
        registeredByUserId: "admin",
        now,
      });
      if (!running.ok) throw new Error("seed: running client registration failed");
      const stopped = registerClient(db, {
        name: "OldBot",
        redirectUris: ["http://127.0.0.1:33420/callback"],
        registeredByUserId: "admin",
        now: new Date(Date.parse(now) + 1000).toISOString(),
      });
      if (!stopped.ok) throw new Error("seed: stopped client registration failed");
      // Stamp one client stopped and mark the other verified — the two chip
      // tones each state puts on screen (the stop's token-revocation semantics
      // are the admin-oauth-clients.test.ts contract, not this file's).
      db.run("UPDATE oauth_client SET stopped_at = ? WHERE client_id = ?", [now, stopped.client.client_id]);
      db.run("UPDATE oauth_client SET verified = 1 WHERE client_id = ?", [running.client.client_id]);
    },
  });
  browser = await launchBrowser();
  admin = await loginThroughUi(browser, app, "admin");
}, 900_000);

afterAll(async () => {
  await admin.context?.close();
  await browser?.close();
  await app?.stop();
});

describe("/admin/connected-apps visual smoke", () => {
  test("fleet table renders both chip states with one action per row, under the admin nav entry", async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    const page = admin.page;
    await visit(page, app, "/admin/connected-apps");
    await page.waitForSelector("main h1", { state: "visible", timeout: 30_000 });
    await page.waitForTimeout(400); // fonts settle for a fair screenshot

    // h1 via the section title key; intro line beneath (PageHeader standard).
    const h1 = (await page.locator("main h1").first().textContent()) ?? "";
    expect(h1.trim()).toBe("연결된 앱");

    // The admin sidebar carries the new entry, and only the admin session sees it.
    expect(await page.locator('a[href="/admin/connected-apps"]').count()).toBe(1);

    // Toolbar: search + counted FilterChip trio (whitespace-stripped compare —
    // the label carries a natural space in 운영 중).
    expect(await page.locator('main input[type="search"]').count()).toBe(1);
    const chips = (await page.locator("main .control-chip").allTextContents()).map((c) => c.replace(/\s+/g, ""));
    expect(chips).toContain("전체(2)");
    expect(chips).toContain("운영중(1)");
    expect(chips).toContain("중단(1)");

    // Fleet table: 2 rows; each carries exactly one of the two status labels and
    // one state-dependent action button.
    const rows = page.locator("main tbody tr");
    expect(await rows.count()).toBe(2);
    const bodyText = (await page.locator("main table").first().textContent()) ?? "";
    expect(bodyText).toContain("운영 중");
    expect(bodyText).toContain("중단");
    // Both verified chip tones: the running client was seeded verified, the stopped one not.
    expect(bodyText).toContain("검증된 앱");
    expect(bodyText).toContain("미검증 앱");
    const stopBtns = await page.locator('main tbody button:has-text("중단")').count();
    const startBtns = await page.locator('main tbody button:has-text("시작")').count();
    expect(stopBtns).toBe(1);
    expect(startBtns).toBe(1);

    // client_id renders as the mono code cell.
    expect(await page.locator("main tbody code").count()).toBe(2);

    await page.screenshot({ path: join(OUT_DIR, "admin-connected-apps.png"), fullPage: true });
  }, 60_000);

  test("중단 confirm carries the consequence copy and the 409-free happy path reloads", async () => {
    const page = admin.page;
    await visit(page, app, "/admin/connected-apps");
    await page.waitForSelector("main h1", { state: "visible", timeout: 30_000 });

    // Stop the running row: ConfirmDialog opens with the two consequence sentences.
    await page.locator('main tbody button:has-text("중단")').first().click();
    const dialog = page.locator('[role="alertdialog"]');
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    const dialogText = (await dialog.textContent()) ?? "";
    expect(dialogText).toContain("모든 사용자의 연결이 즉시 해지되고");
    expect(dialogText).toContain("기존 연결은 복구되지 않습니다");

    // Confirm → the stop command runs against the REAL route → success toast
    // (role=status) and the row flips to 중단/시작 after the reload.
    await dialog.locator('button:has-text("중단")').last().click();
    await page.waitForSelector('[role="status"].toast', { timeout: 15_000 });
    await page
      .locator("tr", { hasText: "ChatGPT connector" })
      .locator('button:has-text("시작")')
      .waitFor({ state: "visible", timeout: 15_000 });
    const stoppedChips = (await page.locator("main .control-chip").allTextContents()).map((c) =>
      c.replace(/\s+/g, ""),
    );
    expect(stoppedChips).toContain("중단(2)");

    // 시작 on one row (the table sorts created_at DESC, so the first 시작 is
    // OldBot's): the neutral-tone confirm states the reconnect duty, and the
    // started row flips back to 운영 중/중단 after the reload.
    await page.locator('main tbody button:has-text("시작")').first().click();
    const dialog2 = page.locator('[role="alertdialog"]');
    await dialog2.waitFor({ state: "visible", timeout: 10_000 });
    expect((await dialog2.textContent()) ?? "").toContain("다시 연결해야 합니다");
    await dialog2.locator('button:has-text("시작")').last().click();
    await page
      .locator("tr", { hasText: "OldBot" })
      .locator('button:has-text("중단")')
      .waitFor({ state: "visible", timeout: 15_000 });
  }, 90_000);
});
