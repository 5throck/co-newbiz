// @version 1.0.0
// User-manual screenshot capture. Boots the E2E harness (isolated production
// build, throwaway SQLite DB, free port; never 7748/7749), seeds BOTH S1-S12
// demo chains (Brown Field M&A + Green Field) into that one DB, logs in through
// the UI as the harness-generated analyst (and admin for admin screens), then
// walks docs/wiki/ko/capture-manifest.json and writes PNGs to
// docs/wiki/ko/images/<id>.png.
//
// Read-only by construction: after login every non-GET /api request is aborted
// at the browser, and click steps refuse labels that look like writes unless the
// manifest marks the step `openOnly` (open a dialog, never submit it).
// Personal data: topbar user id is hidden and e-mail-looking text is masked by
// injected CSS/JS before each shot. Credentials are generated per run, never printed.
//
// Usage:
//   bun run manual:capture                  all feasible captures
//   bun run manual:capture -- --list        print the manifest (id, status, url)
//   bun run manual:capture -- --only s4     only ids starting with the prefix (repeatable, comma ok)
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { REPO_ROOT, startApp } from "../../tests/scenarios/_support/harness.ts";
import { grantProjectLead } from "../../tests/scenarios/_support/deals.ts";
import { launchBrowser } from "../../tests/scenarios/_support/browser.ts";
import type { BrowserContext, Page } from "../../tests/scenarios/_support/playwright.ts";
import { seedGreenfieldS1ToS12Demo, seedS1ToS12Demo } from "./seed-s1-s12-demo.ts";

const WIKI_DIR = join(REPO_ROOT, "docs", "wiki", "ko");
const IMAGES_DIR = join(WIKI_DIR, "images");
const MANIFEST_PATH = join(WIKI_DIR, "capture-manifest.json");
const VIEWPORT = { width: 1440, height: 900 };
const MAX_BYTES = 250 * 1024;

type Actor = "analyst" | "admin" | "anon" | "password-change";

interface Step {
  /** Playwright selector (text=..., role=..., css) to click. */
  click?: string;
  /** Click is allowed to hit a write-looking label because it only opens a dialog. */
  openOnly?: boolean;
  /** Wait for this selector to be visible after the step. */
  waitFor?: string;
  /** Scroll this selector into view. */
  scrollTo?: string;
}

interface Capture {
  id: string;
  /** Output file name inside images/ (always `${id}.png`). */
  file: string;
  /** URL pattern; tokens: {bfOpp} {bfProj} {bfTarget} {bfCompany} {gfOpp} {gfProj}. */
  url: string;
  as: Actor;
  state: string;
  waitFor?: string;
  steps?: Step[];
  /** Crop to this element's box (with 16px padding) instead of the viewport. */
  crop?: string;
  /** Draw a 3px outline on this element before the shot (manual annotation stays separate). */
  highlight?: string;
  fullPage?: boolean;
  /** Selectors whose text is blurred before the shot (personal identifiers). */
  blur?: string[];
  page: string;
  caption: string;
  skip?: string;
}

interface Manifest {
  generated_for: string;
  viewport: { width: number; height: number };
  captures: Capture[];
}

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
}

function parseArgs(argv: string[]): { list: boolean; only: string[] } {
  const only: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--only" && argv[i + 1]) only.push(...argv[++i]!.split(",").map((s) => s.trim()).filter(Boolean));
  }
  return { list: argv.includes("--list"), only };
}

const WRITE_LABEL = /(저장|기록|확정|삭제|제출|승인|재분석|생성|등록|전송|적용|취소|종료)/;
const ERROR_TEXT = /Application error|This page could not be found|Internal Server Error|문제가 발생했습니다|오류가 발생했습니다|권한이 없습니다/;

/** Injected before each shot: no personal identifiers, no animations. */
const REDACT_CSS = `
.topbar-user{visibility:hidden !important}
*,*::before,*::after{animation:none !important;transition:none !important;caret-color:transparent !important}
nextjs-portal{display:none !important}
`;

async function redact(page: Page): Promise<void> {
  await page.addStyleTag({ content: REDACT_CSS });
  await page.evaluate(() => {
    const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.nodeValue ?? "";
      if (email.test(t)) n.nodeValue = t.replace(email, "user@example.com");
      email.lastIndex = 0;
    }
    for (const el of Array.from(document.querySelectorAll<HTMLInputElement>('input[type="email"], input[autocomplete="username"]'))) {
      if (el.value) el.value = "user@example.com";
    }
  });
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  // Skeletons / loading text must be gone.
  await page
    .waitForFunction(() => !document.querySelector(".skeleton, [aria-busy='true']") && !/불러오는 중|로딩 중/.test(document.body.innerText), undefined, {
      timeout: 20_000,
    })
    .catch(() => undefined);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
}

/** Fail loudly on login redirects and error pages. */
async function assertHealthy(page: Page, c: Capture, expectLogin: boolean): Promise<void> {
  const path = new URL(page.url()).pathname;
  if (!expectLogin && path.startsWith("/login")) throw new Error(`${c.id}: redirected to /login (session lost)`);
  const text = await page.evaluate(() => document.body.innerText.slice(0, 4000));
  const bad = text.match(ERROR_TEXT);
  if (bad) throw new Error(`${c.id}: error page detected ("${bad[0]}") at ${path}`);
}

async function optimise(file: string): Promise<number> {
  const req = createRequire(join(REPO_ROOT, "app", "web-next", "package.json"));
  type PngOpts = { compressionLevel?: number; effort?: number; palette?: boolean; quality?: number; colours?: number };
  const sharp = req("sharp") as (input: Buffer) => { png(o: PngOpts): { toBuffer(): Promise<Buffer> } };
  const input = readFileSync(file);
  let best = await sharp(input).png({ compressionLevel: 9, effort: 10 }).toBuffer();
  if (best.length > MAX_BYTES) best = await sharp(input).png({ palette: true, quality: 90, compressionLevel: 9, effort: 10, colours: 256 }).toBuffer();
  if (best.length > MAX_BYTES) best = await sharp(input).png({ palette: true, quality: 70, compressionLevel: 9, effort: 10, colours: 128 }).toBuffer();
  writeFileSync(file, best);
  return best.length;
}

function resolveUrl(pattern: string, ids: Record<string, string>): string {
  return pattern.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = ids[k];
    if (!v) throw new Error(`unknown token {${k}} in ${pattern}`);
    return v;
  });
}

async function runStep(page: Page, step: Step, c: Capture): Promise<void> {
  if (step.click) {
    const loc = page.locator(step.click).first();
    await loc.waitFor({ state: "visible", timeout: 15_000 });
    const label = ((await loc.innerText().catch(() => "")) || (await loc.getAttribute("aria-label")) || "").trim();
    if (!step.openOnly && WRITE_LABEL.test(label)) throw new Error(`${c.id}: refusing to click write-looking label "${label}"`);
    await loc.click();
    await settle(page);
  }
  if (step.waitFor) await page.locator(step.waitFor).first().waitFor({ state: "visible", timeout: 20_000 });
  if (step.scrollTo) await page.locator(step.scrollTo).first().scrollIntoViewIfNeeded();
}

async function newSession(browser: Awaited<ReturnType<typeof launchBrowser>>): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: "ko-KR", colorScheme: "light" });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("cn-theme", "light");
    } catch {
      /* ignore */
    }
  });
  return context;
}

/** Log in through the UI. Optionally capture the forced password-change page on the way. */
async function login(
  context: BrowserContext,
  baseUrl: string,
  userId: string,
  initial: string,
  onChangePage?: (page: Page) => Promise<void>,
): Promise<Page> {
  const page = await context.newPage();
  const idField = "#userId, input[name=userId], input[autocomplete=username]";
  await page.goto(`${baseUrl}/login`);
  await page.locator(idField).first().fill(userId);
  await page.locator("input[type=password]").first().fill(initial);
  await page.locator("form button[type=submit]").first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  if (new URL(page.url()).pathname.startsWith("/password-change")) {
    if (onChangePage) await onChangePage(page);
    // Runtime-generated replacement; never printed.
    const next = `Zz9-${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}!`;
    await page.locator("#currentPassword").fill(initial);
    await page.locator("#newPassword").fill(next);
    await page.locator("#confirmPassword").fill(next);
    await page.locator("form button[type=submit]").first().click();
    await page.waitForURL((u) => !u.pathname.startsWith("/password-change"), { timeout: 30_000 });
    if (new URL(page.url()).pathname.startsWith("/login")) {
      await page.locator(idField).first().fill(userId);
      await page.locator("input[type=password]").first().fill(next);
      await page.locator("form button[type=submit]").first().click();
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
    }
  }
  return page;
}

/** After login: abort every non-GET API call so a stray click can never write. */
async function lockReadOnly(context: BrowserContext): Promise<void> {
  await context.route("**/api/**", (route) => {
    const req = route.request();
    const method = req.method();
    if (method === "GET" || method === "HEAD") return route.continue();
    // Opening a stage materialises the deterministic AI 1st review (POST .../reviews); it only writes the throwaway DB.
    if (method === "POST" && /\/api\/(projects|opportunities)\/[^/]+\/reviews$/.test(new URL(req.url()).pathname)) return route.continue();
    return route.abort("blockedbyclient");
  });
}

async function shoot(page: Page, c: Capture): Promise<number> {
  await redact(page);
  for (const sel of c.blur ?? []) {
    await page.addStyleTag({ content: `${sel}{filter:blur(6px) !important}` });
  }
  if (c.highlight) {
    await page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) el.style.outline = "3px solid #d92d20";
    }, c.highlight);
  }
  const file = join(IMAGES_DIR, c.file);
  if (c.crop) {
    const box = await page.locator(c.crop).first().boundingBox();
    if (!box) throw new Error(`${c.id}: crop selector "${c.crop}" has no box`);
    const pad = 16;
    const x = Math.max(0, box.x - pad);
    const y = Math.max(0, box.y - pad);
    await page.screenshot({
      path: file,
      clip: { x, y, width: Math.min(VIEWPORT.width - x, box.width + 2 * pad), height: Math.min(box.height + 2 * pad, 4000) },
      fullPage: true,
    });
  } else {
    await page.screenshot({ path: file, fullPage: c.fullPage === true });
  }
  return optimise(file);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifest = loadManifest();
  const selected = manifest.captures.filter((c) => args.only.length === 0 || args.only.some((p) => c.id.startsWith(p)));

  if (args.list) {
    for (const c of selected) console.log(`${c.skip ? "SKIP" : "    "} ${c.id.padEnd(26)} ${c.as.padEnd(8)} ${c.url}${c.skip ? `  -- ${c.skip}` : ""}`);
    console.log(`${selected.length} captures, ${selected.filter((c) => c.skip).length} skipped`);
    return;
  }
  const todo = selected.filter((c) => !c.skip);
  if (todo.length === 0) throw new Error("nothing to capture (check --only)");
  mkdirSync(IMAGES_DIR, { recursive: true });

  const ids: Record<string, string> = {};
  const app = await startApp("manual-capture", {
    seed: async ({ dbPath, analystId }) => {
      const bf = seedS1ToS12Demo(dbPath, { humanDecisions: true, subTrackDd: true });
      grantProjectLead(dbPath, bf.projectId, analystId);
      const gf = await seedGreenfieldS1ToS12Demo(dbPath, { humanDecisions: true });
      grantProjectLead(dbPath, gf.projectId, analystId);
      Object.assign(ids, {
        bfOpp: bf.opportunityId,
        bfProj: bf.projectId,
        bfTarget: "demo-s1-s12-target-1",
        bfCompany: "demo-s1-s12-company",
        gfOpp: gf.opportunityId,
        gfProj: gf.projectId,
      });
    },
  });
  const browser = await launchBrowser();
  const made: Array<{ id: string; bytes: number }> = [];
  const failed: string[] = [];
  const record = (id: string, bytes: number): void => {
    made.push({ id, bytes });
    console.log(`ok   ${id} (${(bytes / 1024).toFixed(0)} KB)`);
  };
  const fail = (id: string, err: unknown): void => {
    failed.push(id);
    console.error(`FAIL ${id}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  };
  try {
    const anonCtx = await newSession(browser);
    const analystCtx = await newSession(browser);

    const guarded = async (page: Page, c: Capture, expectLogin = false): Promise<void> => {
      try {
        await page.goto(`${app.baseUrl}${resolveUrl(c.url, ids)}`, { waitUntil: "domcontentloaded" });
        await settle(page);
        await assertHealthy(page, c, expectLogin);
        if (c.waitFor) await page.locator(c.waitFor).first().waitFor({ state: "visible", timeout: 20_000 });
        for (const s of c.steps ?? []) await runStep(page, s, c);
        await settle(page);
        record(c.id, await shoot(page, c));
      } catch (err) {
        fail(c.id, err);
      }
    };

    // 1) anonymous: login page
    const anonPage = await anonCtx.newPage();
    for (const c of todo.filter((x) => x.as === "anon")) await guarded(anonPage, c, true);

    // 2) analyst login; the forced password-change page is captured on the way.
    const pwCaptures = todo.filter((x) => x.as === "password-change");
    const analystPage = await login(analystCtx, app.baseUrl, app.analystId, app.analystPassword, async (page) => {
      await settle(page);
      for (const c of pwCaptures) {
        try {
          await assertHealthy(page, c, false);
          record(c.id, await shoot(page, c));
        } catch (err) {
          fail(c.id, err);
        }
      }
    });
    await lockReadOnly(analystCtx);
    for (const c of todo.filter((x) => x.as === "analyst")) await guarded(analystPage, c);

    // 3) admin screens
    if (todo.some((x) => x.as === "admin")) {
      const adminCtx = await newSession(browser);
      const adminPage = await login(adminCtx, app.baseUrl, app.adminId, app.adminPassword);
      await lockReadOnly(adminCtx);
      for (const c of todo.filter((x) => x.as === "admin")) await guarded(adminPage, c);
    }
  } finally {
    await browser.close();
    await app.stop();
  }

  const total = made.reduce((a, m) => a + m.bytes, 0);
  const over = made.filter((m) => m.bytes > MAX_BYTES);
  console.log(`\nmade ${made.length}, failed ${failed.length}, skipped ${selected.length - todo.length}; total ${(total / 1024).toFixed(0)} KB`);
  if (over.length) console.log(`over ${MAX_BYTES / 1024} KB: ${over.map((m) => `${m.id}=${(m.bytes / 1024).toFixed(0)}KB`).join(", ")}`);
  if (failed.length) {
    console.error(`failed: ${failed.join(", ")}`);
    process.exit(1);
  }
  for (const m of made) {
    const f = join(IMAGES_DIR, `${m.id}.png`);
    if (!existsSync(f) || statSync(f).size === 0) throw new Error(`missing output for ${m.id}`);
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
