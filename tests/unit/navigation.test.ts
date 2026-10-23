// Navigation SSOT parity test (ADR-0105) — prevents the two drift modes that
// triggered the 2026-09-04 review finding: (1) a standard screen ships without
// a menu entry, (2) menu order drifts because order was hardcoded JSX.
// The SSOT is lib/navigation.ts; AppShell must render only from it.
import { test, expect, describe } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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
  const rel = relative(APP_DIR, file.replace(/[/\\]page\.tsx$/, "")).replaceAll("\\", "/");
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

const { NAV_SECTIONS, NON_MENU_ROUTES, menuHrefs, ADMIN_NAV, isDealFlowFlatRoute } = await import(NAV_MODULE);
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
    // 앵커 자식(href#hash — 예: /brownfield#s6s7-universe)은 해시를 떼면 실제
    // 페이지다. 해시를 벗긴 뒤 페이지 존재를 검사한다.
    const broken = menuHrefs().filter((href) => !pages.has(href.split("#")[0]));
    expect(broken).toEqual([]);
  });

  test("non-menu allowlist has no stale entries (route must exist or be dynamic)", () => {
    const pages = new Set(allPageRoutes());
    const stale = NON_MENU_ROUTES.filter((r) => !r.includes("[") && !pages.has(r));
    expect(stale).toEqual([]);
  });

  test("Wave U-1: work section leads with the inbox; legacy stage group and mockup are gone", () => {
    const work = NAV_SECTIONS.find((s: { label: string }) => s.label === "업무")!;
    expect(work.items.map((i: { href: string }) => i.href)).toEqual(["/inbox", "/deals", "/projects/archives"]);
    expect(NAV_SECTIONS.some((s: { label: string }) => s.label === "단계 화면(기존)")).toBe(false);
    const all = [...menuHrefs(), ...NON_MENU_ROUTES];
    expect(all).not.toContain("/brownfield-mockup");
    // The legacy stage routes stay reachable as routes (ADR-0120) but are not sidebar entries.
    for (const r of ["/market", "/opportunities", "/our-company", "/synergy", "/route-decision", "/greenfield", "/brownfield"]) {
      expect(menuHrefs()).not.toContain(r);
      expect(NON_MENU_ROUTES).toContain(r);
    }
  });

  // 2026-10-23 위키 인앱 뷰어 설계 D6: 이 구간 순서를 고정하는 단언이 없어
  // 추가됐다 — 문서 허브(모든 문서) 다음에 사용자용 안내서(/wiki)가 온다.
  test("분석·참조 section order is pinned: benchmarks → library → wiki → glossary → strategy", () => {
    const section = NAV_SECTIONS.find((s: { label: string }) => s.label === "분석·참조")!;
    expect(section.items.map((i: { href: string }) => i.href)).toEqual([
      "/benchmarks",
      "/library",
      "/wiki",
      "/glossary",
      "/strategy",
    ]);
    const wiki = section.items.find((i: { href: string }) => i.href === "/wiki");
    expect(wiki?.label).toBe("사용 안내서");
    // /wiki 본문 경로는 동적 세그먼트라 존재 검사를 건너뛰지만, 고아 검사를
    // 통과하려면 명시적 탈메뉴 등재가 필요하다(위 70–73행 원칙).
    expect(NON_MENU_ROUTES).toContain("/wiki/[slug]");
  });

  test("connected apps is a registered sidebar and admin entry (no longer a topbar-only link)", () => {
    expect(menuHrefs()).toContain("/settings/connected-apps");
    expect(ADMIN_NAV.map((i: { href: string }) => i.href)).toContain("/settings/connected-apps");
  });

  test("no unintended duplicate menu hrefs", () => {
    // Wave U-1: the sidebar has no submenus any more, so no repetition is allowed.
    const hrefs = menuHrefs();
    const allowedDup = new Set<string>();
    const dupes = hrefs.filter((h, i) => hrefs.indexOf(h) !== i && !allowedDup.has(h));
    expect(dupes).toEqual([]);
  });

  test("admin nav is registered and covers the admin pages", () => {
    expect(ADMIN_NAV.map((i: { href: string }) => i.href)).toEqual([
      "/admin", "/admin/users", "/admin/audit", "/admin/data-sources", "/admin/schedule",
      "/admin/database", "/admin/notifications", "/admin/glossary", "/admin/governance",
      "/admin/master-data", "/admin/business-targets", "/admin/adr", "/admin/system-mode",
      "/settings/connected-apps",
    ]);
    for (const href of ADMIN_NAV.map((i: { href: string }) => i.href)) {
      expect(allPageRoutes().some((r) => r === href || r.startsWith(href + "/"))).toBe(true);
    }
  });

  test("AppShell renders the menu only from the SSOT (no local NAV_SECTIONS copy)", () => {
    expect(appShellSource).toContain('from "../lib/navigation.ts"');
    expect(appShellSource).not.toMatch(/const NAV_SECTIONS/);
  });

  // 2026-10-11-ui-polish-back-nav-token-table-inbox-link: /projects uses the
  // same top-bar back (to the deal board) as the other deal-less list screens,
  // not an in-page breadcrumb.
  test("/projects uses the topbar back to /deals and no in-page breadcrumb", () => {
    const src = readFileSync(join(APP_DIR, "projects", "page.tsx"), "utf8");
    expect(src).not.toContain("Breadcrumb");
    expect(appShellSource).toMatch(/pathname === "\/projects"\s*\?\s*\{ href: "\/deals", label: "검토\/안건 보드" \}/);
  });

  // Flat deal-less routes: the top-bar back (to the board) replaces the in-page breadcrumb.
  test("/route-decision, /agents, /our-company have no in-page breadcrumb and back to the board", () => {
    for (const dir of ["route-decision", "agents", "our-company"]) {
      const src = readFileSync(join(APP_DIR, dir, "page.tsx"), "utf8");
      expect(src).not.toContain("Breadcrumb");
      expect(isDealFlowFlatRoute(`/${dir}`)).toBe(true);
    }
    expect(appShellSource).toMatch(/isDealFlowFlatRoute\(pathname\)\s*\?\s*\{ href: "\/deals", label: "검토\/안건 보드" \}/);
  });
});
