// Navigation SSOT parity test (ADR-0105) — prevents the two drift modes that
// triggered the 2026-09-04 review finding: (1) a standard screen ships without
// a menu entry, (2) menu order drifts because order was hardcoded JSX.
// The SSOT is lib/navigation.ts; AppShell must render only from it.
import { test, expect, describe } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");

const APP_DIR = join(PROJECT_ROOT, "app/web-next/app");
const NAV_MODULE = "../../app/web-next/lib/navigation.ts";

function* walkPages(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walkPages(full);
    } else if (entry === "page.tsx") {
      yield full;
    }
  }
}

/** File path under app/ → route path ("/", "/market", "/projects/[id]/dd"). */
function pageToRoute(file: string): string {
  const rel = file.slice(`${APP_DIR}/`.length, -"/page.tsx".length);
  return rel.length === 0 ? "/" : `/${rel}`;
}

function allPageRoutes(): string[] {
  const out: string[] = [];
  const root = join(APP_DIR);
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) stack.push(full);
      else if (entry === "page.tsx") out.push(pageToRoute(full));
    }
  }
  return out.sort();
}

const { NAV_SECTIONS, NON_MENU_ROUTES, menuHrefs, ADMIN_NAV } = await import(NAV_MODULE);
// AppShell must be the only renderer — assert it consumes the SSOT.
const appShellSource = readFileSync(join(PROJECT_ROOT, "app/web-next/components/AppShell.tsx"), "utf8");

describe("navigation SSOT (ADR-0105)", () => {
  test("every rendered page is either in the menu or explicitly non-menu", () => {
    const registered = new Set([...menuHrefs(), ...ADMIN_NAV.map((i: { href: string }) => i.href)]);
    const nonMenu = new Set(NON_MENU_ROUTES);
    const orphans = allPageRoutes().filter((r) => !registered.has(r) && !nonMenu.has(r));
    expect(orphans).toEqual([]);
  });

  test("every menu href resolves to a real page", () => {
    // ADR-0108: the knowledge-hub static portal is retired — /library is the
    // single documentation surface now, so no static-public-asset exemption
    // is needed here any more.
    const pages = new Set(allPageRoutes());
    const broken = menuHrefs().filter((href) => !pages.has(href));
    expect(broken).toEqual([]);
  });

  test("non-menu allowlist has no stale entries (route must exist or be dynamic)", () => {
    const pages = new Set(allPageRoutes());
    const stale = NON_MENU_ROUTES.filter((r) => !r.includes("[") && !pages.has(r));
    expect(stale).toEqual([]);
  });

  test("탐색 section order follows the flow.spec stage sequence", () => {
    // S1 market → S2 opportunities → S3 our-company/synergy → S4 route-decision
    // → S5 greenfield → S6/S7 brownfield → S8+ projects(+pipeline)
    const explore = NAV_SECTIONS.find((s) => s.label === "탐색")!;
    const hrefs = explore.items.map((i) => i.href);
    // 추진 전략(부모) 아래 진출방식 결정/그린필드/브라운필드 자식 — ADR-0105 개정
    const expected = ["/", "/market", "/opportunities", "/our-company", "/route-decision", "/projects", "/pipeline"];
    expect(hrefs).toEqual(expected);
    // stage ordering sanity (sub-menu children): greenfield(S5) → brownfield(S6/S7)
    const gf = hrefs.indexOf("/greenfield");
    const bf = hrefs.indexOf("/brownfield");
    if (gf !== -1 && bf !== -1) expect(bf).toBeGreaterThan(gf);
  });

  test("no unintended duplicate menu hrefs", () => {
    // /our-company is both a submenu parent and a child by design — that is
    // the ONLY allowed repetition; anything else is a copy-paste drift.
    const hrefs = menuHrefs();
    const allowedDup = new Set(["/our-company", "/route-decision"]);
    const dupes = hrefs.filter((h, i) => hrefs.indexOf(h) !== i && !allowedDup.has(h));
    expect(dupes).toEqual([]);
  });

  test("admin nav is registered and covers the admin pages", () => {
    expect(ADMIN_NAV.map((i: { href: string }) => i.href)).toEqual([
      "/admin", "/admin/users", "/admin/audit", "/admin/data-sources", "/admin/schedule",
      "/admin/database", "/admin/notifications", "/admin/glossary", "/admin/governance",
      "/admin/master-data", "/admin/adr",
    ]);
    for (const href of ADMIN_NAV.map((i: { href: string }) => i.href)) {
      expect(allPageRoutes().some((r) => r === href || r.startsWith(href + "/"))).toBe(true);
    }
  });

  test("AppShell renders the menu only from the SSOT (no local NAV_SECTIONS copy)", () => {
    expect(appShellSource).toContain('from "../lib/navigation.ts"');
    expect(appShellSource).not.toMatch(/const NAV_SECTIONS/);
  });
});
