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
import { ThemeToggle } from "./ThemeToggle.tsx";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
  /** 하위 메뉴 — 부모는 링크가 아니라 그룹 라벨로 렌더링된다 */
  children?: NavItem[];
}

// 좌측 패널 — 플랫 전역 내비. 트랙 결정 이후 흐름(S4~S7)은 flow.spec v2.0.0
// 재설계에 따라 opportunities 화면에 흡수되었고, 프로젝트 승격 이후(S8~S11)는
// /projects 목록에서 사업성 분석·실사·투심·포트폴리오 화면으로 진입한다.
// 이 패널은 탐색·참조·운영 바로가기를 제공한다.
const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: "탐색",
    items: [
      { href: "/", label: "대시보드", icon: <LayoutDashboard size={18} /> },
      { href: "/market", label: "시장분석", icon: <LineChart size={18} /> },
      { href: "/opportunities", label: "기회 발굴", icon: <Lightbulb size={18} /> },
      {
        href: "/our-company",
        label: "시너지 정합성",
        icon: <Handshake size={18} />,
        children: [
          { href: "/our-company", label: "그룹/계열사 분석", icon: <Landmark size={18} /> },
          { href: "/synergy", label: "시너지·전략적 적합성", icon: <GitMerge size={18} /> },
        ],
      },
      { href: "/route-decision", label: "진출방식 결정", icon: <GitBranch size={18} /> },
      { href: "/greenfield", label: "역량 평가·진출전략", icon: <Sprout size={18} /> },
      { href: "/brownfield", label: "대상 후보 발굴", icon: <Target size={18} /> },
    ],
  },
  {
    label: "분석·참조",
    items: [
      { href: "/benchmarks", label: "벤치마킹 사례", icon: <Landmark size={18} /> },
      { href: "/library", label: "규정·체크리스트", icon: <LibraryBig size={18} /> },
      { href: "/glossary", label: "용어집", icon: <BookOpen size={18} /> },
      { href: "/strategy", label: "R&BD 전략", icon: <Target size={18} /> },
    ],
  },
  {
    label: "운영",
    items: [
      { href: "/projects", label: "프로젝트", icon: <FolderKanban size={18} /> },
    ],
  },
];

// 우측 상단 바 — 맨 왼쪽에 상세 화면용 뒤로 가기, 오른쪽에 테마 전환·로그아웃·
// 사용자 표시. 위치 표시는 페이지 제목(h1)과 중복되지 않도록 목록 페이지에서는
// 숨기고, 하위 상세 경로에서만 뒤로 가기 필로 제공한다.
function Topbar({ pathname }: { pathname: string }) {
  const { me, logout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  if (!me) return null;
  const item = NAV_SECTIONS.flatMap((sec) => sec.items).find(
    (i) => pathname === i.href || pathname.startsWith(i.href + "/"),
  );
  const isNested =
    (!!item && pathname !== item.href && pathname.length > item.href.length) ||
    // 목록의 상세 표현(?industry=·?company= 등) — 필터 파라미터(status 등)는 제외
    (pathname === "/market" && !!searchParams.get("industry")) ||
    (pathname === "/synergy" && !!searchParams.get("company")) ||
    (pathname === "/route-decision" && !!searchParams.get("opportunity")) ||
    (pathname === "/brownfield" && !!searchParams.get("opportunity")) ||
    (pathname === "/greenfield" && !!searchParams.get("opportunity"));
  return (
    <header className="topbar">
      {isNested && item && (
        <button
          type="button"
          className="back-link"
          onClick={() => router.push(item.href)}
          aria-label={`${item.label} 목록으로 돌아가기`}
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
const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "시스템 대시보드", icon: <Shield size={18} /> },
  { href: "/admin/users", label: "사용자·토큰", icon: <Landmark size={18} /> },
  { href: "/admin/audit", label: "로그 관리", icon: <LibraryBig size={18} /> },
  { href: "/admin/data-sources", label: "데이터 소스", icon: <Lightbulb size={18} /> },
  { href: "/admin/schedule", label: "배치·스케줄", icon: <GitMerge size={18} /> },
  { href: "/admin/database", label: "데이터베이스", icon: <BookOpen size={18} /> },
  { href: "/admin/notifications", label: "알림", icon: <Target size={18} /> },
  { href: "/admin/glossary", label: "용어집 관리", icon: <BookOpen size={18} /> },
  { href: "/admin/governance", label: "거버넌스 문서", icon: <Landmark size={18} /> },
  { href: "/admin/master-data", label: "마스터 데이터", icon: <LibraryBig size={18} /> },
  { href: "/admin/adr", label: "ADR 인덱스", icon: <BookOpen size={18} /> },
];

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
                  {item.icon}
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
        const items = section.items.filter(
          (item) => !item.adminOnly || me.role === "admin",
        );
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
                        {item.icon}
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
                              {c.icon}
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
                    {item.icon}
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
