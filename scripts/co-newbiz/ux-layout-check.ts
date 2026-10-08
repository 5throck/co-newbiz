// @version 1.0.0
// Wave U-1 runtime layout check (design §7/§10): at 1024, 1280 and 390px no
// position:fixed element's rect may intersect the sidebar (drawer closed on
// mobile), and no horizontal scroll may appear. Also saves evidence shots.
//
// Usage (server must already run against a seeded DB):
//   bun scripts/co-newbiz/ux-layout-check.ts --base http://localhost:7759 \
//     --user <userId> --password-file <json {userId,password}> [--shots <dir>]
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "../../app/web-next/node_modules/playwright-core/index.js";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(name);
  const v = i >= 0 ? process.argv[i + 1] : fallback;
  if (v === undefined) throw new Error(`missing ${name}`);
  return v;
}

const base = arg("--base");
const cred = JSON.parse(readFileSync(arg("--password-file"), "utf8")) as { userId: string; password: string };
const shots = arg("--shots", "");
if (shots) mkdirSync(shots, { recursive: true });

const PAGES: Array<{ name: string; path: string }> = [
  { name: "shell", path: "/deals" },
  { name: "stage", path: "/projects/demo-s1-s12-project/dd" },
  { name: "inbox", path: "/inbox" },
];

const browser = await chromium.launch();
let failures = 0;
for (const width of [1024, 1280, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await ctx.newPage();
  const r = await page.request.post(`${base}/api/auth/login`, { data: cred });
  if (!r.ok()) throw new Error(`login failed ${r.status()}`);
  for (const p of PAGES) {
    await page.goto(base + p.path);
    await page.waitForTimeout(1500);
    const res = await page.evaluate(() => {
      const side = document.querySelector(".app-sidebar") as HTMLElement | null;
      const sr = side?.getBoundingClientRect();
      const sideVisible = !!side && getComputedStyle(side).visibility !== "hidden" && !!sr && sr.right > 0 && sr.width > 0;
      const hits: string[] = [];
      if (sideVisible && sr) {
        for (const el of document.querySelectorAll<HTMLElement>("body *")) {
          const cs = getComputedStyle(el);
          if (cs.position !== "fixed" || el === side || side!.contains(el) || el.contains(side)) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.left < sr.right && r.right > sr.left && r.top < sr.bottom && r.bottom > sr.top) hits.push(`${el.tagName}.${el.className}`);
        }
      }
      return { hits, hscroll: document.documentElement.scrollWidth > window.innerWidth + 1, sideVisible };
    });
    const bad = res.hits.length > 0 || res.hscroll;
    if (bad) failures++;
    console.log(`${width}px ${p.name}: sidebarVisible=${res.sideVisible} fixedOverlaps=${res.hits.length} hscroll=${res.hscroll} ${bad ? "FAIL" : "ok"}`);
    if (shots && (width === 1280 || width === 390)) await page.screenshot({ path: `${shots}/u1-${p.name}-${width}.png` });
  }
  await ctx.close();
}
await browser.close();
process.exit(failures === 0 ? 0 : 1);
