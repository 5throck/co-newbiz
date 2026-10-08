// Navigation SSOT (ADR-0105) — the single source of truth for the web menu:
// every registered screen (href + label + order) lives HERE, and AppShell
// renders only from this file. Root cause this fixes: the menu was hardcoded
// JSX, so new standard screens shipped without a menu entry and section order
// drifted with no way to detect it. tests/unit/navigation.test.ts enforces
// page↔menu parity and the canonical order against this file.
import type { ReactNode } from "react";

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
    // "단계 화면(기존)" group is gone — stage routes stay as routes (ADR-0120
    // compatibility, see NON_MENU_ROUTES) but are reached through the deal
    // stage stepper, not the sidebar. The deal-scoped "Overview" entry is
    // rendered dynamically by AppShell (it needs the current deal id).
    label: "업무",
    items: [
      { href: "/inbox", label: "결정 대기함" },
      { href: "/deals", label: "검토/안건 보드" },
      { href: "/projects/archives", label: "아카이브" },
    ],
  },
  {
    label: "분석·참조",
    items: [
      { href: "/benchmarks", label: "벤치마킹 사례" },
      { href: "/library", label: "문서 허브" },
      { href: "/glossary", label: "용어집" },
      { href: "/strategy", label: "R&BD 전략" },
    ],
  },
  {
    // Connected apps (ADR-0154) lives with the account/settings entries, not
    // in the topbar.
    label: "설정",
    items: [
      { href: "/settings/connected-apps", label: "연결된 앱" },
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
  "/oauth/authorize", // ADR-0154: OAuth consent for MCP connectors
  "/proposals/[id]/confirm", // ADR-0154: human confirmation of an agent's decision proposal (deep link)
  "/agents",
  "/opportunities/[id]",
  "/brownfield/targets/[targetId]",
  "/companies",
  "/companies/[companyId]",
  "/process/[stage]",
  "/projects/[id]",
  "/projects/[id]/business-case",
  "/projects/[id]/wacc",
  "/projects/[id]/charter",
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
  "/admin/business-targets",
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

/** 관리자 전용 내비 (ADR-0091 역할-화면 분리) — 역시 본 파일이 SSOT다. */
export const ADMIN_NAV: Array<{ href: string; label: string }> = [
  { href: "/admin", label: "시스템 대시보드" },
  { href: "/admin/users", label: "사용자·토큰 관리" },
  { href: "/admin/audit", label: "감사 로그" },
  { href: "/admin/data-sources", label: "데이터 소스" },
  { href: "/admin/schedule", label: "스케줄" },
  { href: "/admin/database", label: "데이터베이스" },
  { href: "/admin/notifications", label: "알림" },
  { href: "/admin/glossary", label: "용어집 관리" },
  { href: "/admin/governance", label: "거버넌스" },
  { href: "/admin/master-data", label: "마스터 데이터" },
  { href: "/admin/business-targets", label: "사업목표 기준" },
  { href: "/admin/adr", label: "ADR" },
  { href: "/admin/system-mode", label: "시스템 모드" },
  { href: "/settings/connected-apps", label: "연결된 앱" },
];

export function adminNavHrefs(): string[] {
  return ADMIN_NAV.map((i) => i.href);
}
