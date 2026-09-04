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
    label: "탐색",
    items: [
      { href: "/", label: "대시보드" },
      { href: "/market", label: "시장분석" },
      { href: "/opportunities", label: "기회 발굴" },
      {
        href: "/our-company",
        label: "시너지 정합성",
        children: [
          { href: "/our-company", label: "그룹/계열사 분석" },
          { href: "/synergy", label: "시너지·전략적 적합성" },
        ],
      },
      {
        // 추진 전략 — S4 라우트 결정으로 그린필드/브라운필드가 갈리는 구간
        // (S4 → S5 그린필드 / S6·S7 브라운필드). 부모 href는 첫 자식과 동일한
        // /our-company 패턴을 따른다.
        href: "/route-decision",
        label: "추진 전략",
        children: [
          { href: "/route-decision", label: "진출방식 결정" },
          { href: "/greenfield", label: "그린필드 — 자체 신설 진출" },
          { href: "/brownfield", label: "브라운필드 — 결합·투자" },
        ],
      },
      { href: "/projects", label: "프로젝트" },
      { href: "/pipeline", label: "프로젝트 파이프라인" },
    ],
  },
  {
    label: "분석·참조",
    items: [
      { href: "/benchmarks", label: "벤치마킹 사례" },
      { href: "/library", label: "규정·체크리스트" },
      { href: "/glossary", label: "용어집" },
      { href: "/strategy", label: "R&BD 전략" },
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
  "/login",
  "/register",
  "/password-change",
  "/process/[stage]",
  "/projects/[id]",
  "/projects/[id]/business-case",
  "/projects/[id]/charter",
  "/projects/[id]/dd",
  "/projects/[id]/ic-review",
  "/projects/[id]/pipeline",
  "/projects/[id]/portfolio",
  "/projects/[id]/process",
];

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
  { href: "/admin/adr", label: "ADR" },
];

export function adminNavHrefs(): string[] {
  return ADMIN_NAV.map((i) => i.href);
}
