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
      { href: "/deals", label: "검토/안건 보드" },
    ],
  },
  {
    // 단계 화면(기존) — Wave 2에서 /deals/{id}/s1..s12 워크스페이스 탭으로
    // 통합된다 (ADR-0120). 통합 전까지 기존 화면이 내비에서 사라지지 않는다.
    label: "단계 화면(기존)",
    items: [
      { href: "/market", label: "S1 시장분석" },
      { href: "/opportunities", label: "S2 기회 발굴" },
      { href: "/our-company", label: "S3 그룹/계열사 분석" },
      { href: "/synergy", label: "S3 시너지·전략적 적합성" },
      {
        // S4 진출방식 결정 — S4 라우트 결정으로 그린필드/브라운필드가 갈리는
        // 구간 (S4 → S5 그린필드 / S6·S7 브라운필드). 부모 링크 자체가 S4
        // 화면(/route-decision)이므로 같은 대상의 자식 항목은 두지 않는다 —
        // 부모·자식 라벨이 완전히 같은 중복 행을 만들지 않기 위함.
        href: "/route-decision",
        label: "S4 진출방식 결정",
        children: [
          { href: "/greenfield", label: "S5 자체 진출" },
          { href: "/brownfield", label: "S6/S7 대상발굴·선정" },
        ],
      },
      // S8~S12 — 프로젝트(project id)로 승격된 뒤에만 실제로 열리는 화면이라
      // 정적 자식 링크는 /projects(선택 목록)로 보낸다. 프로젝트를 이미 열어
      // 둔 상태라면 이 하위 메뉴가 그 프로젝트 id로 바로 열리는 S8~S12
      // 링크로 동적 전환된다 (AppShell.tsx Sidebar 참고) — 그래서 여기서는
      // 프로젝트 미지정 상태의 항목만 정의한다("진행 프로젝트"/"아카이브").
      {
        href: "/projects",
        label: "프로젝트",
        children: [
          { href: "/projects", label: "진행 프로젝트" },
          { href: "/projects/archives", label: "아카이브" },
        ],
      },
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
  "/agents",
  "/opportunities/[id]",
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
];

export function adminNavHrefs(): string[] {
  return ADMIN_NAV.map((i) => i.href);
}
