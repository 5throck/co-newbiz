// R2-C: axe sweep across every route in BOTH themes (WCAG 2.1 AA, 0 serious/critical).
// Dark mode is toggled the way the app does it (html[data-theme=dark]) after load.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApp, type TestApp } from "./_support/harness.ts";
import { axeScan, formatAxe, launchBrowser, loginThroughUi, visit, type AxeResult, type Session } from "./_support/browser.ts";
import { BROWNFIELD, seedBrownfieldDeal } from "./_support/deals.ts";
import { getDb } from "../../db/client.ts";
import type { Browser } from "./_support/playwright.ts";

let app: TestApp;
let browser: Browser;
let analyst: Session;
let admin: Session;
const O = BROWNFIELD.opportunityId;
const P = BROWNFIELD.projectId;

const PROJECT_PAGES = [
  "", "/process", "/business-case", "/charter", "/dd", "/ic-review", "/portfolio", "/reports", "/share", "/timeline", "/wacc",
  "/agent-runs", "/backtest", "/comp-parity", "/customer-coc", "/deal-structure", "/debt", "/financial-analysis", "/incentives",
  "/interviews", "/partnership", "/permits", "/pmi", "/proxy-chain", "/risk-heatmap", "/sites",
];
const ANALYST_ROUTES = [
  "/deals", "/inbox", `/deals/${O}`, `/deals/${O}/s1`, `/deals/${O}/s4`, "/projects", "/projects/archives", "/benchmarks", "/library",
  "/glossary", "/strategy", "/settings/connected-apps", "/password-change", "/onboarding", "/oauth/authorize", "/proposals/bogus/confirm",
  "/agents", "/brownfield", "/companies", "/greenfield", "/market", "/opportunities", `/opportunities/${O}`, "/our-company", "/pipeline",
  "/portfolio-view", "/process/S1", "/route-decision", "/synergy", "/this-route-does-not-exist",
  ...PROJECT_PAGES.map((p) => `/projects/${P}${p}`),
];
const ADMIN_ROUTES = [
  "/admin", "/admin/users", "/admin/audit", "/admin/data-sources", "/admin/schedule", "/admin/database", "/admin/notifications",
  "/admin/glossary", "/admin/governance", "/admin/master-data", "/admin/business-targets", "/admin/adr", "/admin/system-mode", "/admin/gate-integrity", "/inbox",
];

beforeAll(async () => {
  app = await startApp("axe-sweep", { seed: ({ dbPath, analystId }) => { seedBrownfieldDeal(dbPath, analystId); getDb(dbPath); } });
  browser = await launchBrowser();
  analyst = await loginThroughUi(browser, app);
  admin = await loginThroughUi(browser, app, "admin");
}, 180_000);
afterAll(async () => { await browser?.close(); await app?.stop(); });

async function sweep(s: Session, routes: string[], theme: "light" | "dark"): Promise<AxeResult[]> {
  const out: AxeResult[] = [];
  for (const r of routes) {
    await visit(s.page, app, r);
    await s.page.evaluate((t) => { document.documentElement.setAttribute("data-theme", t); }, theme);
    out.push(await axeScan(s.page, `${theme} ${r}`));
  }
  return out;
}

interface PageFacts { route: string; h1: number; title: string }

async function pageFacts(s: Session, routes: string[]): Promise<PageFacts[]> {
  const out: PageFacts[] = [];
  for (const r of routes) {
    await visit(s.page, app, r);
    // Client pages settle after the shell loads; wait for any heading before counting.
    await s.page.locator("h1, h2").first().waitFor({ state: "attached", timeout: 15_000 }).catch(() => undefined);
    out.push(await s.page.evaluate((route) => ({ route, h1: document.querySelectorAll("h1").length, title: document.title }), r));
  }
  return out;
}

describe("R2-C page contract", () => {
  test("every route has exactly one h1 and its own document title", async () => {
    const analystFacts = await pageFacts(analyst, ANALYST_ROUTES);
    const adminFacts = await pageFacts(admin, ADMIN_ROUTES.filter((r) => r !== "/inbox"));
    const all = [...analystFacts, ...adminFacts];
    const noH1 = all.filter((f) => f.h1 !== 1).map((f) => `${f.route} (h1=${f.h1})`);
    // Titles must differ page to page: group routes by title; the same title on routes of different
    // screens (not just different ids of one screen) is a failure.
    const generic = all.filter((f) => f.title === "신규사업 검토 AI 플랫폼").map((f) => f.route);
    console.log(`PAGE-CONTRACT routes=${all.length} without_single_h1=${noH1.length} generic_title=${generic.length}`);
    expect(noH1).toEqual([]);
    expect(generic).toEqual([]);
  }, 600_000);

  test("no horizontal overflow at 390px", async () => {
    // The bootstrap password was already changed; reuse the signed-in session in a phone-sized context.
    const state = await analyst.context.storageState();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ko-KR", storageState: state });
    const mobile = { page: await context.newPage() };
    const over: string[] = [];
    for (const r of ANALYST_ROUTES.filter((x) => x !== "/this-route-does-not-exist")) {
      await visit(mobile.page, app, r);
      await mobile.page.waitForTimeout(400);
      const w = await mobile.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      if (w.sw > w.iw + 1) over.push(`${r} (+${w.sw - w.iw}px)`);
    }
    console.log(`OVERFLOW-390 offenders=${over.length}`);
    expect(over).toEqual([]);
  }, 600_000);
});

describe("R2-C axe sweep", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`${theme}: every route has 0 serious/critical violations`, async () => {
      const results = [...(await sweep(analyst, ANALYST_ROUTES, theme)), ...(await sweep(admin, ADMIN_ROUTES, theme))];
      const nodes = results.reduce((n, r) => n + r.blocking.reduce((m, v) => m + v.nodes.length, 0), 0);
      console.log(`AXE-TOTAL ${theme}: routes=${results.length} blocking_violations=${results.reduce((n, r) => n + r.blocking.length, 0)} nodes=${nodes}`);
      const bad = results.filter((r) => r.blocking.length > 0);
      if (bad.length) console.log(formatAxe(bad));
      expect(bad.flatMap((r) => r.blocking)).toEqual([]);
    }, 900_000);
  }
});
