"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  FolderKanban,
  LayoutDashboard,
  BookOpen,
  Shield,
  LogOut,
  Target,
  FileText,
  LibraryBig,
  TrendingUp,
  Landmark,
  Lightbulb,
  LineChart,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "../lib/auth-client.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
}

// 좌측 패널 — 프로세스 스테이지(S1~S7) 흐름 순으로 구성하며 각 항목은 해당
// 스테이지를 실행하는 화면에 연결된다(docs/process-flow.md §3). S4·S6는
// 개별 딜 컨텍스트(워크플로우 탭 기본)에서 수행되므로 딜 목록으로 진입한다.
const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: "S1 시장분석",
    items: [{ href: "/process/S1", label: "시장 데이터·체인", icon: <LineChart size={18} /> }],
  },
  {
    label: "S2 기회발굴",
    items: [{ href: "/process/S2", label: "기회 퍼널", icon: <Lightbulb size={18} /> }],
  },
  {
    label: "S3 시너지·적합성",
    items: [{ href: "/process/S3", label: "적합성 평가", icon: <Target size={18} /> }],
  },
  {
    label: "S4 진출방식 결정",
    items: [{ href: "/process/S4", label: "딜 워크플로우", icon: <FolderKanban size={18} /> }],
  },
  {
    label: "S5 사업성 분석",
    items: [{ href: "/process/S5", label: "수익성 분석", icon: <TrendingUp size={18} /> }],
  },
  {
    label: "S6 실사·검증",
    items: [{ href: "/process/S6", label: "딜 실사 (C/T/L)", icon: <ShieldCheck size={18} /> }],
  },
  {
    label: "S7 투자심사·실행",
    items: [{ href: "/process/S7", label: "IC 패키지·보고서", icon: <FileText size={18} /> }],
  },
  {
    label: "관리·참조",
    items: [
      { href: "/portfolio-scorecard", label: "스코어카드", icon: <LayoutDashboard size={18} /> },
      { href: "/benchmarks", label: "벤치마킹 사례", icon: <Landmark size={18} /> },
      { href: "/glossary", label: "용어집", icon: <BookOpen size={18} /> },
      { href: "/library", label: "규정·체크리스트", icon: <LibraryBig size={18} /> },
      { href: "/strategy", label: "R&BD 전략", icon: <Target size={18} /> },
    ],
  },
  {
    label: "운영",
    items: [
      {
        href: "/admin",
        label: "관리자",
        icon: <Shield size={18} />,
        adminOnly: true,
      },
    ],
  },
];

// 우측 상단 바 — 테마 전환·로그아웃·사용자 표시를 좌측 패널이 아닌 화면
// 우측 상단에 모은다.
function Topbar({ pathname }: { pathname: string }) {
  const { me, logout } = useAuth();
  if (!me) return null;
  const label =
    NAV_SECTIONS.flatMap((sec) => sec.items).find((i) => pathname === i.href || pathname.startsWith(i.href + "/"))?.label ??
    (pathname === "/" ? "홈" : (pathname.split("/")[1] ?? ""));
  return (
    <header className="topbar">
      <span className="topbar-crumbs" aria-label="현재 위치">
        {label}
      </span>
      <div className="topbar-actions">
        <ThemeToggle compact />
        <span className="topbar-user">{me.userId}</span>
        <button type="button" onClick={() => logout()} className="topbar-logout" aria-label="로그아웃">
          <LogOut size={16} />
          <span>로그아웃</span>
        </button>
      </div>
    </header>
  );
}

function Sidebar() {
  const { me } = useAuth();
  const pathname = usePathname();
  if (!me) return null;

  return (
    <aside className="app-sidebar">
      <Link href="/projects" className="sidebar-brand">
        <span className="sidebar-brand-icon">CN</span>
        <span>co-newbiz</span>
      </Link>
      {NAV_SECTIONS.map((section) => {
        // 관리자 역할 분리: S1~S7 딜 프로세스 그룹은 관리자에게 숨긴다 —
        // 관리자는 운영 콘솔(사용자·마스터데이터·시스템)만 사용한다.
        if (me.role === "admin" && section.label.startsWith("S")) return null;
        const items = section.items.filter(
          (item) => !item.adminOnly || me.role === "admin",
        );
        if (items.length === 0) return null;
        return (
          <div key={section.label}>
            <div className="sidebar-group-label">{section.label}</div>
            <nav className="sidebar-nav" aria-label={section.label}>
              {items.map((item) => {
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
        <Topbar pathname={pathname} />
        <div className="app-content">{children}</div>
      </div>
    </div>
  );
}
