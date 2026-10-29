// Navigation SSOT (ADR-0105) — the single source of truth for the web menu:
// every registered screen (href + label + order) lives HERE, and AppShell
// renders only from this file. Root cause this fixes: the menu was hardcoded
// JSX, so new standard screens shipped without a menu entry and section order
// drifted with no way to detect it. tests/unit/navigation.test.ts enforces
// page↔menu parity and the canonical order against this file.
//
// i18n (design 2026-10-23-i18n-ui-adoption): `label` holds a catalog KEY
// ("nav.inbox"), not display text — AppShell resolves it through next-intl at
// render time. tests/unit/navigation.test.ts pins the keys and checks each
// one resolves in the ko master catalog.

export interface NavChild {
  href: string;
  label: string;
}

export interface NavItem {
  href: string;
  label: string;
  children?: NavChild[];
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    // Wave U-1 (design §3.2): layer 1 of the two-layer IA. The legacy
    // stage group is gone — stage routes stay as routes (ADR-0120
    // compatibility, see NON_MENU_ROUTES) but are reached through the deal
    // stage stepper, not the sidebar. The deal-scoped "Overview" entry is
    // rendered dynamically by AppShell (it needs the current deal id).
    label: "nav.section.work",
    items: [
      { href: "/inbox", label: "nav.inbox" },
      { href: "/deals", label: "nav.dealBoard" },
      { href: "/projects/archives", label: "nav.archives" },
    ],
  },
  {
    label: "nav.section.reference",
    items: [
      { href: "/benchmarks", label: "nav.benchmarks" },
      { href: "/library", label: "nav.library" },
      // 모든 문서(문서 허브) 다음에 사용자용 안내서가 온다(2026-10-23 위키 인앱 뷰어 설계 D6).
      { href: "/wiki", label: "nav.wiki" },
      { href: "/glossary", label: "nav.glossary" },
      { href: "/strategy", label: "nav.strategy" },
      // 플로우 콘솔(2026-10-24-flow-console-screen-design §2.3) — 참조 성격이라
      // R&BD 전략 뒤에 배치. 드라이런 세션 경로(/flows/dry-run*)는 NON_MENU_ROUTES.
      { href: "/flows", label: "nav.flows" },
    ],
  },
  {
    // Connected apps (ADR-0154) lives with the account/settings entries, not
    // in the topbar.
    label: "nav.section.settings",
    items: [
      { href: "/settings/connected-apps", label: "nav.connectedApps" },
    ],
  },
];

/** All registered menu hrefs (flattened, parents + children), in order. */
export function menuHrefs(): string[] {
  const out: string[] = [];
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      out.push(item.href);
      if (item.children) for (const c of item.children) out.push(c.href);
    }
  }
  return out;
}

/**
 * Routes that intentionally have NO menu entry. Anything under app/** that
 * renders a page.tsx and is not in menuHrefs() or this allowlist fails the
 * navigation parity test — the escape hatch must be explicit.
 *   /login, /register, /password-change : auth surfaces (topbar flow)
 *   /process/[stage]                    : reached via StageRail
 *   /projects/[id]/**                   : project detail sub-flows, entered
 *                                         from /projects and the project
 *                                         sub-navigation
 */
export const NON_MENU_ROUTES: string[] = [
  // Legacy stage routes (ADR-0120 compatibility): off the sidebar since
  // Wave U-1, reached through the deal stage stepper (StageFrame).
  "/market",
  "/opportunities",
  "/our-company",
  "/synergy",
  "/route-decision",
  "/greenfield",
  "/brownfield",
  "/projects",
  "/login",
  "/register",
  "/password-change",
  "/settings", // redirect-only index → /settings/connected-apps (2026-10-11 sweep)
  "/oauth/authorize", // ADR-0154: OAuth consent for MCP connectors
  "/proposals/[id]/confirm", // ADR-0154: human confirmation of an agent's decision proposal (deep link)
  "/agents",
  "/opportunities/[id]",
  "/brownfield/targets/[targetId]",
  "/companies",
  "/companies/[companyId]",
  "/wiki/[slug]", // 2026-10-23: 위키 본문 — /wiki(메뉴 등록)에서 여정 목차로 진입
  "/process/[stage]",
  "/projects/[id]",
  "/projects/[id]/business-case",
  "/projects/[id]/wacc",
  "/projects/[id]/charter",
  "/projects/[id]/milestones",
  "/projects/[id]/dd",
  "/projects/[id]/deal-structure",
  "/projects/[id]/financial-analysis",
  "/projects/[id]/ic-review",
  "/projects/[id]/pipeline",
  "/projects/[id]/portfolio",
  "/projects/[id]/partnership",
  "/projects/[id]/proxy-chain",
  "/projects/[id]/pmi",
  "/projects/[id]/process",
  "/projects/[id]/reports",
  "/pipeline", // Wave 4: redirect stub → /deals
  "/", // 2026-09-14: redirect stub → /deals (구 대시보드 정리)
  "/deals/[id]",
  "/deals/[id]/[stage]",
  "/projects/[id]/incentives",
  "/projects/[id]/sites",
  "/projects/[id]/permits",
  "/projects/[id]/debt",
  "/projects/[id]/interviews",
  "/projects/[id]/customer-coc",
  "/projects/[id]/comp-parity",
  "/projects/[id]/agent-runs",
  "/projects/[id]/backtest",
  "/projects/[id]/share",
  "/projects/[id]/timeline",
  "/projects/[id]/risk-heatmap",
  "/portfolio-view",
  "/onboarding",
  "/admin/business-targets", // redirect-only → /our-company (ADR-0191)
  // 플로우 콘솔 드라이런 세션(2026-10-24-flow-console-screen-design §2.1/§2.3) —
  // 별도 여정이라 사이드바 밖. /flows/dry-run(세션 목록)은 /flows 탭 행의 텍스트
  // 링크와 블루프린트 "드라이런 시작"으로, [sessionId]는 세션 목록·런 레저 칩의
  // 딥링크로 진입한다(A3-5 URL 공유). [sessionId]는 동적 세그먼트라 패리티 검사에서
  // 존재 검사를 건너뛴다.
  "/flows/dry-run",
  "/flows/dry-run/[sessionId]",
];

/**
 * Flat (deal-less) routes that belong to the deal board's family (R2-A, page
 * contract). They have no sidebar entry of their own, so the sidebar marks
 * "검토/안건 보드" active on them and the topbar offers a contextual back to the
 * board. Longest prefixes first is not required: matching is prefix-based.
 */
export const DEAL_FLOW_FLAT_ROUTES: string[] = [
  "/market",
  "/opportunities",
  "/synergy",
  "/route-decision",
  "/greenfield",
  "/brownfield",
  "/our-company",
  "/companies",
  "/portfolio-view",
  "/agents",
  "/onboarding",
];

export function isDealFlowFlatRoute(pathname: string): boolean {
  return DEAL_FLOW_FLAT_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** 관리자 전용 내비 (ADR-0091 역할-화면 분리) — 역시 본 파일이 SSOT다.
 * `label` holds a catalog key (see the header note); AppShell resolves it. */
export const ADMIN_NAV: Array<{ href: string; label: string }> = [
  { href: "/admin", label: "nav.admin.dashboard" },
  { href: "/admin/users", label: "nav.admin.users" },
  { href: "/admin/audit", label: "nav.admin.audit" },
  { href: "/admin/data-sources", label: "nav.admin.dataSources" },
  { href: "/admin/schedule", label: "nav.admin.schedule" },
  { href: "/admin/database", label: "nav.admin.database" },
  { href: "/admin/notifications", label: "nav.admin.notifications" },
  { href: "/admin/glossary", label: "nav.admin.glossary" },
  { href: "/admin/governance", label: "nav.admin.governance" },
  { href: "/admin/gate-integrity", label: "nav.admin.gateIntegrity" },
  { href: "/admin/master-data", label: "nav.admin.masterData" },
  { href: "/admin/adr", label: "nav.admin.adr" },
  { href: "/admin/system-mode", label: "nav.admin.systemMode" },
  { href: "/settings/connected-apps", label: "nav.connectedApps" },
];

export function adminNavHrefs(): string[] {
  return ADMIN_NAV.map((i) => i.href);
}
