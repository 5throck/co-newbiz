"use client";

import { Suspense, useEffect, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  GitBranch,
  Sprout,
  LineChart,
  LayoutDashboard,
  BookOpen,
  Shield,
  LogOut,
  KeyRound,
  ListChecks,
  Target,
  FileText,
  LibraryBig,
  Landmark,
  Lightbulb,
  Handshake,
  GitMerge,
  FolderKanban,
} from "lucide-react";
import { useAuth } from "../lib/auth-client.tsx";
import { ADMIN_NAV, NAV_SECTIONS, type NavItem } from "../lib/navigation.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

interface AdminNavItem {
  href: string;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
}

// 좌측 패널 — 플랫 전역 내비. 메뉴 구성·순서의 SSOT는 lib/navigation.ts
// (ADR-0105)다: 새 표준 화면은 반드시 이 레지스트리에 등록하고, 등록 누락·
// 순서 드리프트는 tests/unit/navigation.test.ts가 잡는다. 이 파일은 아이콘만
// 입힌다.
const ICON_BY_HREF: Record<string, ReactNode> = {
  "/": <LayoutDashboard size={18} />,
  "/market": <LineChart size={18} />,
  "/opportunities": <Lightbulb size={18} />,
  "/our-company": <Handshake size={18} />,
  "/synergy": <GitMerge size={18} />,
  "/route-decision": <GitBranch size={18} />,
  "/greenfield": <Sprout size={18} />,
  "/brownfield": <Target size={18} />,
  "/projects": <FolderKanban size={18} />,
  "/pipeline": <ListChecks size={18} />,
  "/benchmarks": <Landmark size={18} />,
  "/library": <LibraryBig size={18} />,
  "/glossary": <BookOpen size={18} />,
  "/strategy": <Target size={18} />,
};
const CHILD_ICON: ReactNode = <Landmark size={14} />;

// 우측 상단 바 — 맨 왼쪽에 상세 화면용 뒤로 가기, 오른쪽에 테마 전환·로그아웃·
// 사용자 표시. 위치 표시는 페이지 제목(h1)과 중복되지 않도록 목록 페이지에서는
// 숨기고, 하위 상세 경로에서만 뒤로 가기 필로 제공한다.
function Topbar({ pathname }: { pathname: string }) {
  const { me, logout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  if (!me) return null;
  // 활성 내비 항목 해석 — 최상위뿐 아니라 서브메뉴 자식(/synergy 등)도 찾는다.
  // 자식이 활성이면 parent를 함께 기록해 목록(부모/자식 href)로 돌아갈 수 있게 한다.
  const flat: Array<{ item: NavItem; parent?: NavItem }> = NAV_SECTIONS.flatMap((sec) =>
    sec.items.flatMap((i) => [
      { item: i, parent: undefined as NavItem | undefined },
      ...(i.children ?? []).map((c) => ({ item: { ...c }, parent: i })),
    ]),
  );
  const found = flat.find((e) => pathname === e.item.href || pathname.startsWith(e.item.href + "/"));
  const item = found?.item;
  const listHref = found?.parent?.href ?? item?.href;
  // 상세 표현 판정 — 조회 파라미터 기반 상세(company·opportunity·industry)와
  // 경로 기반 상세(하위 경로)를 모두 커버한다. 버튼은 topbar 좌측(top)에 위치한다.
  const hasDetailParam =
    (pathname === "/market" && !!searchParams.get("industry")) ||
    (pathname === "/synergy" && !!searchParams.get("company")) ||
    (pathname === "/route-decision" && !!searchParams.get("opportunity")) ||
    (pathname === "/brownfield" && !!searchParams.get("opportunity")) ||
    (pathname === "/greenfield" && !!searchParams.get("opportunity"));
  const isNested = (!!item && (pathname !== item.href || hasDetailParam)) || hasDetailParam;
  const backHref = found?.parent ? found.item.href : item?.href ?? "/";
  const backLabel = found?.parent ? found.parent.label : item?.label ?? "목록";
  return (
    <header className="topbar">
      {isNested && item && (
        <button
          type="button"
          className="back-link"
          onClick={() => router.push(backHref)}
          aria-label={`${backLabel} 목록으로 돌아가기`}
        >
          <ChevronLeft size={14} />
          {item.label}
        </button>
      )}
      <div className="topbar-actions">
        <ThemeToggle compact />
        <span className="topbar-user">{me.userId}</span>
        {/* 임의 비밀번호 변경 — must_change_password 플로우와 같은 화면을 재사용한다. */}
        <button type="button" onClick={() => router.push("/password-change")} className="topbar-logout" aria-label="비밀번호 변경">
          <KeyRound size={16} />
          <span>비밀번호 변경</span>
        </button>
        <button type="button" onClick={() => logout()} className="topbar-logout" aria-label="로그아웃">
          <LogOut size={16} />
          <span>로그아웃</span>
        </button>
      </div>
    </header>
  );
}

// 관리자 전용 내비 — admin 역할은 이 그룹만 사용한다 (ADR-0091: 역할-화면 분리).
function Sidebar() {
  const { me } = useAuth();
  const pathname = usePathname();
  if (!me) return null;

  // ADR-0091 — 역할-화면 분리: admin은 관리 화면만, 비관리자는 비즈니스 화면만 본다.
  if (me.role === "admin") {
    return (
      <aside className="app-sidebar">
        <Link href="/admin" className="sidebar-brand">
          <span className="sidebar-brand-icon">CN</span>
          <span>co-newbiz 관리</span>
        </Link>
        <div>
          <div className="sidebar-group-label">관리</div>
          <nav className="sidebar-nav" aria-label="관리">
            {ADMIN_NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`side-nav-link ${active ? "side-nav-link-active" : ""}`}
                >
                  {ICON_BY_HREF[item.href] ?? CHILD_ICON}
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>
    );
  }

  return (
    <aside className="app-sidebar">
      <Link href="/" className="sidebar-brand">
        <span className="sidebar-brand-icon">CN</span>
        <span>co-newbiz</span>
      </Link>
      {NAV_SECTIONS.map((section) => {
        const items = section.items;
        if (items.length === 0) return null;
        return (
          <div key={section.label}>
            <div className="sidebar-group-label">{section.label}</div>
            <nav className="sidebar-nav" aria-label={section.label}>
              {items.map((item) => {
                if (item.children) {
                  const childActive = item.children.some(
                    (c) => pathname === c.href || pathname.startsWith(c.href + "/"),
                  );
                  return (
                    <div key={item.href} className="side-nav-submenu">
                      <div className={`side-nav-link side-nav-parent ${childActive ? "side-nav-link-active" : ""}`}>
                        {ICON_BY_HREF[item.href] ?? CHILD_ICON}
                        <span>{item.label}</span>
                      </div>
                      <div className="side-nav-children">
                        {item.children.map((c) => {
                          const active = pathname === c.href || pathname.startsWith(c.href + "/");
                          return (
                            <Link
                              key={c.href}
                              href={c.href}
                              className={`side-nav-link side-nav-child ${active ? "side-nav-link-active" : ""}`}
                            >
                              <span className="side-nav-child-dot" aria-hidden />
                              <span>{c.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
                const active =
                  pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`side-nav-link ${active ? "side-nav-link-active" : ""}`}
                  >
                    {ICON_BY_HREF[item.href] ?? CHILD_ICON}
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        );
      })}
    </aside>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!me && pathname !== "/login" && pathname !== "/register") {
      router.replace("/login");
      return;
    }
    if (me?.mustChangePassword && pathname !== "/password-change") {
      router.replace("/password-change");
    }
  }, [me, loading, pathname, router]);

  // /register는 로그인 전 접근 가능해야 한다(계정 신청 → 관리자 승인 플로우).
  if (pathname === "/login" || pathname === "/register") return <>{children}</>;
  if (loading)
    return (
      <div className="flex items-center justify-center h-screen text-[color:var(--muted-fg)]">
        불러오는 중...
      </div>
    );
  if (!me) return null;
  if (me.mustChangePassword && pathname !== "/password-change") return null;

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main-col">
        <Suspense fallback={null}>
          <Topbar pathname={pathname} />
        </Suspense>
        <div className="app-content">{children}</div>
      </div>
    </div>
  );
}
