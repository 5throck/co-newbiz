"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
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
  Building2,
  Compass,
  Bell,
  CalendarClock,
  Scale,
  Layers,
  HardDrive,
  Database,
  Users,
  ScrollText,
  FolderKanban,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useAuth } from "../lib/auth-client.tsx";
import { api, type NotificationRow } from "../lib/api.ts";
import { ADMIN_NAV, NAV_SECTIONS, type NavItem } from "../lib/navigation.ts";
import { useModalFocus } from "../lib/use-modal-focus.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

// 사이드 메뉴 상태 — docked(펼침, 데스크톱 전용) / closed(접힘: 데스크톱은
// 폭 0 수축 push, 모바일은 화면 밖 대기) / open(모바일 오버레이 드로어).
// 데스크톱에는 오버레이가 없다 — 표준 push 전환(폭 수축에 콘텐츠 동기 확장).
// CSS는 .app-shell의 data-sidebar-state 속성만 본다.
type SidebarState = "docked" | "open" | "closed";

// 접힘 선호 저장 키. 테마("cn-theme")와 다르게 사전 페인트 인라인 스크립트가
// 필요 없다 — 사이드바는 인증 확인 후에야 렌더되므로 첫 페인트에 깜빡일
// 대상이 없고, 마운트 후 동기화로 충분하다.
const SIDEBAR_KEY = "cn-sidebar";

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
  "/deals": <LayoutDashboard size={18} />,
  "/market": <LineChart size={18} />,
  "/opportunities": <Lightbulb size={18} />,
  "/our-company": <Landmark size={18} />,
  "/synergy": <Handshake size={18} />,
  "/route-decision": <GitBranch size={18} />,
  "/greenfield": <Sprout size={18} />,
  "/brownfield": <Target size={18} />,
  "/projects": <FolderKanban size={18} />,
  "/pipeline": <ListChecks size={18} />,
  "/benchmarks": <Building2 size={18} />,
  "/library": <LibraryBig size={18} />,
  "/glossary": <BookOpen size={18} />,
  "/strategy": <Compass size={18} />,
};

// 관리 콘솔 내비 — 어휘표 원칙(도메인 개념당 1개)에 따라 각 화면에 개별 아이콘을
// 부여한다. generic 폴백(CHILD_ICON)은 비메뉴 하위 경로에만 쓴다.
const ADMIN_ICON_BY_HREF: Record<string, ReactNode> = {
  "/admin": <LayoutDashboard size={18} />,
  "/admin/users": <Users size={18} />,
  "/admin/audit": <ScrollText size={18} />,
  "/admin/data-sources": <Database size={18} />,
  "/admin/schedule": <CalendarClock size={18} />,
  "/admin/database": <HardDrive size={18} />,
  "/admin/notifications": <Bell size={18} />,
  "/admin/glossary": <BookOpen size={18} />,
  "/admin/governance": <Scale size={18} />,
  "/admin/master-data": <Layers size={18} />,
  "/admin/adr": <FileText size={18} />,
};
const CHILD_ICON: ReactNode = <Landmark size={14} />;

// 우측 상단 바 — 맨 왼쪽에 상세 화면용 뒤로 가기, 오른쪽에 테마 전환·로그아웃·
// 사용자 표시. 위치 표시는 페이지 제목(h1)과 중복되지 않도록 목록 페이지에서는
// 숨기고, 하위 상세 경로에서만 뒤로 가기 필로 제공한다.
function Topbar({ pathname, hasAppHistory, sidebarState, sidebarDocked, onToggleSidebar }: {
  pathname: string;
  hasAppHistory: boolean;
  sidebarState: SidebarState;
  sidebarDocked: boolean;
  onToggleSidebar: () => void;
}) {
  const { me, logout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!me || me.role === "admin") return;
    let alive = true;
    api.get<NotificationRow[]>("/api/notifications")
      .then((r) => { if (alive) setUnreadCount(typeof r.meta.unread_count === "number" ? r.meta.unread_count : r.data.filter((n) => n.read_at === null).length); })
      .catch(() => { if (alive) setUnreadCount(0); });
    return () => { alive = false; };
  }, [me]);

  async function markAllRead() {
    await api.post<{ marked: number }>("/api/notifications/read-all", {});
    setUnreadCount(0);
  }

  if (!me) return null;
  // /deals/{id}/{stage} 와 /deals/{id} — 동적 id 경로라 NAV_SECTIONS의
  // 정적 href("/deals")로는 표현할 수 없다. prefix 매칭에 맡기면 이 둘 다
  // "/deals"(검토/안건 보드)의 하위로 잘못 묶여, 스테이지 화면에서 뒤로가기를
  // 눌러도 보드까지 튕겨나간다 — 딜 개요 한 단계로만 돌아가도록 먼저 처리한다.
  const dealStageMatch = pathname.match(/^\/deals\/([^/]+)\/([^/]+)$/);
  const dealOverviewMatch = !dealStageMatch && pathname.match(/^\/deals\/([^/]+)$/);

  // 활성 내비 항목 해석 — 최상위뿐 아니라 서브메뉴 자식(/synergy 등)도 찾는다.
  // 자식이 활성이면 parent를 함께 기록해 목록(부모/자식 href)로 돌아갈 수 있게 한다.
  const flat: Array<{ item: NavItem; parent?: NavItem }> = NAV_SECTIONS.flatMap((sec) =>
    sec.items.flatMap((i) => [
      { item: i, parent: undefined as NavItem | undefined },
      ...(i.children ?? []).map((c) => ({ item: { ...c }, parent: i })),
    ]),
  );
  const found = (dealStageMatch || dealOverviewMatch)
    ? undefined
    : flat.find((e) => pathname === e.item.href || pathname.startsWith(e.item.href + "/"));
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
  const isNested = dealStageMatch || dealOverviewMatch
    ? true
    : (!!item && (pathname !== item.href || hasDetailParam)) || hasDetailParam;
  const backHref = dealStageMatch
    ? `/deals/${dealStageMatch[1]}`
    : dealOverviewMatch
      ? "/deals"
      : found?.parent ? found.item.href : item?.href ?? "/";
  // 스테이지 탭(/deals/{id}/s4 등)은 딜 개요·검토/안건 목록·알림 등 여러
  // 경로에서 진입할 수 있어, 고정된 상위 경로("검토/안건 개요")보다 실제로
  // 온 화면으로 돌아가는 게 더 정확하다 — 앱 내에서 이동해 온 경우(
  // hasAppHistory)에는 브라우저 히스토리로 돌아가고, 새로고침·직접 URL
  // 진입처럼 되돌아갈 앱 내 이력이 없을 때만 기존 고정 경로로 폴백한다.
  const stageBackToHistory = !!dealStageMatch && hasAppHistory;
  const backLabel = dealStageMatch
    ? (stageBackToHistory ? "이전" : "검토/안건 개요")
    : dealOverviewMatch
      ? "검토/안건 보드"
      : found?.parent ? found.parent.label : item?.label ?? "목록";
  return (
    <header className="topbar">
      {/* 사이드 메뉴 토글(topbar) — 사이드바가 화면에 없을 때(접힘/모바일)
          만 렌더된다(듀얼홈 패턴). 펼침 상태에서는 사이드바 헤더의 접기
          버튼이 그 역할을 하며, 같은 동작이 두 곳에 동시에 보이면 안 된다.
          icon-only 버튼이므로 aria-label 필수(design-lint). */}
      {!sidebarDocked && (
        <button
          type="button"
          className="topbar-icon-btn"
          onClick={onToggleSidebar}
          aria-label={sidebarState === "open" ? "사이드 메뉴 닫기" : "사이드 메뉴 열기"}
          aria-expanded={sidebarState === "open"}
          title={sidebarState === "open" ? "사이드 메뉴 닫기" : "사이드 메뉴 열기"}
        >
          {sidebarState === "closed" ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
        </button>
      )}
      {isNested && (item || dealStageMatch || dealOverviewMatch) && (
        <button
          type="button"
          className="back-link"
          onClick={() => {
            // 같은 경로(pathname)에서 조회 파라미터만 비우는 전환(예: /market?industry=X
            // → /market)은 Next App Router의 라우터 캐시 재조정이 router.push/replace
            // 직후 자체적으로 history.replaceState를 다시 호출해 이전 전체 URL(쿼리
            // 포함)로 되돌리는 내부 동작이 있다 — 클릭이 "먹통"으로 보이는 원인.
            // pathname이 그대로이고 조회 파라미터가 있던 경우에만 하드 네비게이션으로
            // 우회한다(소프트 내비게이션이 Next 내부에서 되돌려지는 걸 원천 차단).
            if (pathname === backHref && searchParams.toString()) {
              window.location.assign(backHref);
              return;
            }
            if (stageBackToHistory) {
              router.back();
              return;
            }
            router.push(backHref);
          }}
          aria-label={dealStageMatch || dealOverviewMatch ? `${backLabel}로 돌아가기` : `${backLabel} 목록으로 돌아가기`}
        >
          <ChevronLeft size={14} />
          {dealStageMatch || dealOverviewMatch ? backLabel : item!.label}
        </button>
      )}
      <div className="topbar-actions">
        <ThemeToggle compact />
        {me.role !== "admin" && (
          <button type="button" className="topbar-logout" onClick={() => void markAllRead()} aria-label="알림 모두 읽음 처리" title="알림 모두 읽음 처리">
            <Bell size={16} />
            <span>알림 {unreadCount > 0 ? unreadCount : "0"}</span>
          </button>
        )}
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
// panelRef/inert는 드로어 모드용: open일 때는 오버레이 포커스 관리 패널로,
// closed일 때는 탭·포커스 불가 상태(inert)로 렌더된다. onToggleSidebar는
// 듀얼홈용 — 데스크톱 docked 상태에서만 전달되며, 그때 헤더에 접기 버튼이
// 렌더된다(사이드바가 숨으면 topbar 토글로 역할을 넘긴다).
function Sidebar({ panelRef, inert: inertAttr, onToggleSidebar }: {
  panelRef?: RefObject<HTMLElement | null>;
  inert?: boolean;
  onToggleSidebar?: () => void;
}) {
  const { me } = useAuth();
  const pathname = usePathname();
  if (!me) return null;

  // ADR-0091 — 역할-화면 분리: admin은 관리 화면만, 비관리자는 비즈니스 화면만 본다.
  if (me.role === "admin") {
    return (
      <aside ref={panelRef} className="app-sidebar" inert={inertAttr}>
        <div className="sidebar-head">
          <Link href="/admin" className="sidebar-brand">
            <span className="sidebar-brand-icon">CN</span>
            <span>co-newbiz 관리</span>
          </Link>
          {onToggleSidebar && (
            <button
              type="button"
              className="sidebar-collapse-btn"
              onClick={onToggleSidebar}
              aria-label="사이드 메뉴 접기"
              title="사이드 메뉴 접기"
            >
              <PanelLeftClose size={20} />
            </button>
          )}
        </div>
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
                  {ADMIN_ICON_BY_HREF[item.href] ?? CHILD_ICON}
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>
    );
  }

  // S8~S12는 프로젝트(project id) 없이는 열 수 없는 화면이라 정적 SSOT에는
  // 넣을 수 없다 — 현재 /projects/{id}/** 안에 있을 때만, 그 id로 실제 열리는
  // 링크를 사이드바 "프로젝트" 하위 메뉴에 동적으로 끼워 넣는다. 프로젝트
  // 상세 화면 내부에서만 쓰이던 탭들을 사이드 메뉴에서도 쓸 수 있게 하는
  // 조치 — 프로젝트 컨텍스트 밖에서는 기존 목록/아카이브 하위 메뉴 그대로.
  const currentProjectId = pathname.match(/^\/projects\/([^/]+)/)?.[1];
  // 아카이브는 항상 마지막 — 프로젝트가 열려 있어 S8~S12 링크가 끼어들 때도
  // 순서 규칙은 동일하게 유지한다.
  const projectStageChildren = currentProjectId
    ? [
        { href: "/projects", label: "진행 프로젝트" },
        { href: `/projects/${currentProjectId}/business-case`, label: "S8 사업성 분석" },
        { href: `/projects/${currentProjectId}/dd`, label: "S9 실사·검증" },
        { href: `/projects/${currentProjectId}/deal-structure`, label: "S10 투자구조 설계" },
        { href: `/projects/${currentProjectId}/ic-review`, label: "S11 투자심사·실행" },
        { href: `/projects/${currentProjectId}/portfolio`, label: "S12 사후 관리" },
        { href: `/projects/${currentProjectId}/timeline`, label: "타임라인·SLA" },
        { href: `/projects/${currentProjectId}/risk-heatmap`, label: "리스크 히트맵" },
        { href: "/projects/archives", label: "아카이브" },
      ]
    : null;

  return (
    <aside ref={panelRef} className="app-sidebar" inert={inertAttr}>
      <div className="sidebar-head">
        <Link href="/deals" className="sidebar-brand">
          <span className="sidebar-brand-icon">CN</span>
          <span>co-newbiz</span>
        </Link>
        {onToggleSidebar && (
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={onToggleSidebar}
            aria-label="사이드 메뉴 접기"
            title="사이드 메뉴 접기"
          >
            <PanelLeftClose size={20} />
          </button>
        )}
      </div>
      {NAV_SECTIONS.map((section) => {
        const items = section.items;
        if (items.length === 0) return null;
        return (
          <div key={section.label}>
            <div className="sidebar-group-label">{section.label}</div>
            <nav className="sidebar-nav" aria-label={section.label}>
              {items.map((item) => {
                const children = item.href === "/projects" && item.children && projectStageChildren ? projectStageChildren : item.children;
                if (children) {
                  // 앵커 자식(/x#hash)은 pathname과 같아질 수 없으므로 부모 href와의
                  // 비교를 기준으로 활성 판정한다(자식 base = 부모 href).
                  const childActive =
                    pathname === item.href ||
                    pathname.startsWith(item.href + "/") ||
                    children.some((c) => {
                      const base = c.href.split("#")[0];
                      return pathname === base || pathname.startsWith(base + "/");
                    });
                  return (
                    <div key={item.href} className="side-nav-submenu">
                      <Link
                        href={item.href}
                        className={`side-nav-link side-nav-parent ${childActive ? "side-nav-link-active" : ""}`}
                      >
                        {ICON_BY_HREF[item.href] ?? CHILD_ICON}
                        <span>{item.label}</span>
                      </Link>
                      <div className="side-nav-children">
                        {children.map((c) => {
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

// 모바일 드로어 오버레이 — isMobile인 동안(닫힘 포함) 마운트돼 스크림이
// 상태 전환으로 페이드 인/아웃된다. useModalFocus의 active 게이트 덕분에
// 열렸을 때만 초기 포커스·포커스 트랩이 적용되고 닫히면 포커스가 복원된다
// (ADR-0082 dialog 관례의 modal-backdrop + focus trap 재사용).
function SidebarDrawer({ open, onClose, children }: {
  open: boolean;
  onClose: () => void;
  children: (panelRef: RefObject<HTMLElement | null>) => ReactNode;
}) {
  const { panelRef, onKeyDown } = useModalFocus<HTMLElement>(onClose, open);
  return (
    <div
      className="modal-backdrop drawer-backdrop"
      onClick={(e) => { if (open && e.target === e.currentTarget) onClose(); }}
      onKeyDown={onKeyDown}
      aria-hidden={!open}
    >
      {children(panelRef)}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // 스테이지 탭 뒤로가기 버튼(Topbar)이 "실제로 온 화면으로" 돌아갈 수
  // 있는지 판단하기 위한 앱 내 이동 이력 — AppShell은 로그인 후 리마운트
  // 없이 유지되므로, 이 탭에서 처음 본 경로 이후로 경로가 바뀐 적이
  // 있으면 브라우저 히스토리로 되돌아가도 안전하다.
  const navMetaRef = useRef<{ lastPathname: string | null; hasTransitioned: boolean }>({
    lastPathname: null,
    hasTransitioned: false,
  });
  if (navMetaRef.current.lastPathname !== pathname) {
    if (navMetaRef.current.lastPathname !== null) navMetaRef.current.hasTransitioned = true;
    navMetaRef.current.lastPathname = pathname;
  }
  const hasAppHistory = navMetaRef.current.hasTransitioned;

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

  // 사이드 메뉴 드로어 — 접힘 선호(영속) + 드로어 열림(일시) + 모바일 판정.
  // 접힘 복원은 마운트 후 한 번: 인증 확인이 끝나야 사이드바가 렌더되므로
  // 이 동기화가 항상 렌더에 먼저 끝난다(사전 페인트 스크립트 불필요).
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(SIDEBAR_KEY) === "collapsed") setCollapsed(true);
    } catch {
      // localStorage 불가 환경(비공개 모드 등) — 기본값(펼침) 유지.
    }
    const mq = window.matchMedia("(max-width: 880px)");
    const syncMobile = () => setIsMobile(mq.matches);
    syncMobile();
    mq.addEventListener("change", syncMobile);
    return () => mq.removeEventListener("change", syncMobile);
  }, []);

  // 경로 이동 시 드로어를 닫는다 — 메뉴 항목 클릭 후 오버레이가 남지 않게.
  // pathname에는 조회 파라미터가 없으므로 상세 뷰 전환(/market?industry=…)엔
  // 반응하지 않는다.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const sidebarState: SidebarState = isMobile
    ? (drawerOpen ? "open" : "closed")
    : (collapsed ? "closed" : "docked");

  const setCollapsedPersisted = useCallback((v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem(SIDEBAR_KEY, v ? "collapsed" : "expanded");
    } catch {
      // localStorage 불가 환경 — 이 페이지에서만 접힘 유지.
    }
  }, []);

  // 표준 2상태 직접 토글 — 데스크톱은 접기/펼치기(오버레이 없음, 폭 수축
  // push 전환), 모바일은 드로어 열기/닫기(오버레이 + 스크림).
  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setDrawerOpen((v) => !v);
      return;
    }
    setCollapsedPersisted(!collapsed);
  }, [isMobile, collapsed, setCollapsedPersisted]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

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
    <div className="app-shell" data-sidebar-state={sidebarState}>
      {isMobile ? (
        <SidebarDrawer open={drawerOpen} onClose={closeDrawer}>
          {(drawerPanelRef) => <Sidebar panelRef={drawerPanelRef} inert={!drawerOpen} />}
        </SidebarDrawer>
      ) : (
        <Sidebar inert={collapsed} onToggleSidebar={toggleSidebar} />
      )}
      <div className="app-main-col">
        <Suspense fallback={null}>
          <Topbar
            pathname={pathname}
            hasAppHistory={hasAppHistory}
            sidebarState={sidebarState}
            sidebarDocked={!isMobile && !collapsed}
            onToggleSidebar={toggleSidebar}
          />
        </Suspense>
        <div className="app-content">{children}</div>
      </div>
    </div>
  );
}
