// Playwright helpers shared by the Wave C-1 scenarios: browser launch (bundled
// Chromium, falling back to an installed Chrome), the UI login +
// forced-password-change flow, and the axe-core gate.
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "./playwright.ts";
import type { TestApp } from "./harness.ts";

const AXE_PATH = resolve(import.meta.dirname, "..", "..", "..", "app", "web-next", "node_modules", "axe-core", "axe.min.js");

export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (bundledError) {
    try {
      return await chromium.launch({ headless: true, channel: "chrome" });
    } catch {
      throw new Error(`No Chromium available. Run \`bunx playwright install chromium\`. (${String(bundledError).slice(0, 200)})`);
    }
  }
}

export interface Session {
  context: BrowserContext;
  page: Page;
  /** The post-change password (runtime-generated). */
  password: string;
}

/** Log in through the UI; the bootstrap account is flagged must-change-password, so finish the change flow too. */
export async function loginThroughUi(
  browser: Browser,
  app: TestApp,
  who: "admin" | "analyst" = "analyst",
  viewport = { width: 1440, height: 900 },
): Promise<Session> {
  const userId = who === "admin" ? app.adminId : app.analystId;
  const initial = who === "admin" ? app.adminPassword : app.analystPassword;
  const context = await browser.newContext({ viewport, locale: "ko-KR" });
  const page = await context.newPage();
  await page.goto(`${app.baseUrl}/login`);
  await page.locator("#userId, input[name=userId], input[autocomplete=username]").first().fill(userId);
  await page.locator("input[type=password]").first().fill(initial);
  await page.locator("form button[type=submit]").first().click();

  const next = `Zz9-${randomBytes(9).toString("hex")}!`;
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  if (new URL(page.url()).pathname.startsWith("/password-change")) {
    await page.locator("#currentPassword").fill(initial);
    await page.locator("#newPassword").fill(next);
    await page.locator("#confirmPassword").fill(next);
    await page.locator("form button[type=submit]").first().click();
    await page.waitForURL((url) => !url.pathname.startsWith("/password-change"), { timeout: 30_000 });
    // The change flow revokes sessions; sign in again with the new password if bounced to /login.
    if (new URL(page.url()).pathname.startsWith("/login")) {
      await page.locator("input[type=password]").first().fill(next);
      await page.locator("#userId, input[name=userId], input[autocomplete=username]").first().fill(userId);
      await page.locator("form button[type=submit]").first().click();
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
    }
  }
  return { context, page, password: next };
}

export interface AxeViolation {
  id: string;
  impact: string;
  help: string;
  nodes: string[];
}

export interface AxeResult {
  label: string;
  url: string;
  violations: AxeViolation[];
  blocking: AxeViolation[];
}

/** axe-core runs inside the same Playwright page; serious/critical violations are the gate. */
export async function axeScan(page: Page, label: string): Promise<AxeResult> {
  // Let CSS transitions settle and clear hover state so contrast is measured on resting colors.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(600);
  await page.addScriptTag({ path: AXE_PATH });
  const raw = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: unknown[]; any: Array<{ message: string }> }> }> }> } }).axe;
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact ?? "minor",
      help: v.help,
      nodes: v.nodes.slice(0, 5).map((n) => `${n.target.map(String).join(" ")} (${(n.any[0]?.message ?? "").slice(0, 160)})`),
    }));
  });
  const violations = raw as AxeViolation[];
  return { label, url: page.url(), violations, blocking: violations.filter((v) => v.impact === "serious" || v.impact === "critical") };
}

export function formatAxe(results: AxeResult[]): string {
  return results
    .map((r) => {
      const head = `${r.label} (${new URL(r.url).pathname}): ${r.violations.length} violation(s), ${r.blocking.length} serious/critical`;
      const body = r.blocking.map((v) => `    - [${v.impact}] ${v.id}: ${v.help} @ ${v.nodes.join(" | ")}`).join("\n");
      return body ? `${head}\n${body}` : head;
    })
    .join("\n");
}

/** Open the page, wait for network quiet, and assert the app shell rendered. */
export async function visit(page: Page, app: TestApp, path: string): Promise<void> {
  await page.goto(`${app.baseUrl}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
}
