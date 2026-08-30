"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  FolderKanban,
  LineChart,
  Gauge,
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
} from "lucide-react";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/auth-client.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import { WorkflowSidebar } from "./WorkflowSidebar.tsx";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
}

// 좌측 패널 — 플랫 전역 내비. 딜 진행 흐름(S1~S7)은 개별 딜 상세의
// 워크플로우 내비에서 관리되며, 이 패널은 도구·참조·운영 바로가기를 제공한다.
const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: "딜",
    items: [
      { href: "/", label: "대시보드", icon: <LayoutDashboard size={18} /> },
      { href: "/market", label: "시장분석", icon: <LineChart size={18} /> },
      { href: "/opportunities", label: "기회 발굴", icon: <Lightbulb size={18} /> },
      { href: "/projects", label: "딜 목록", icon: <FolderKanban size={18} /> },
    ],
  },
  {
    label: "분석·참조",
    items: [
      { href: "/profitability", label: "수익성 분석", icon: <TrendingUp size={18} /> },
      { href: "/portfolio-scorecard", label: "스코어카드", icon: <Gauge size={18} /> },
      { href: "/benchmarks", label: "벤치마킹 사례", icon: <Landmark size={18} /> },
      { href: "/library", label: "규정·체크리스트", icon: <LibraryBig size={18} /> },
      { href: "/glossary", label: "용어집", icon: <BookOpen size={18} /> },
      { href: "/strategy", label: "R&BD 전략", icon: <Target size={18} /> },
    ],
  },
  {
    label: "운영",
    items: [
      { href: "/admin", label: "관리자", icon: <Shield size={18} />, adminOnly: true },
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

  // 딜 상세 경로(/projects/:id) 진입 시 좌측 패널이 워크플로우 내비로 전환됨
  const dealMatch = pathname.match(/^\/projects\/([^/]+)/);
  const isDealDetail = !!dealMatch && pathname !== "/projects";

  return (
    <div className="app-shell">
      {isDealDetail && dealMatch ? (
        <DealWorkflowSidebar projectId={dealMatch[1]} />
      ) : (
        <Sidebar />
      )}
      <div className="app-main-col">
        <Topbar pathname={pathname} />
        <div className="app-content">{children}</div>
      </div>
    </div>
  );
}

function DealWorkflowSidebar({ projectId }: { projectId: string }) {
  const [projectNo, setProjectNo] = useState("...");
  const router = useRouter();
  const searchParams = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : "",
  );
  const activeStage = searchParams.get("stage") ?? "";
  const handleStageSelect = (stage: string) => {
    // 스테이지 클릭 시 현재 경로를 유지하면서 stage 파라미터만 업데이트
    const url = new URL(window.location.href);
    url.searchParams.set("stage", stage);
    window.history.replaceState(null, "", url.toString());
    // React에 URL 변경을 알리기 위해 커스텀 이벤트 발생
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  useEffect(() => {
    api.get<{ project_no: string }>(`/api/projects/${projectId}`)
      .then((r) => setProjectNo(r.data?.project_no ?? "..."))
      .catch(() => setProjectNo("..."));
  }, [projectId]);
  return <WorkflowSidebar projectId={projectId} projectNo={projectNo} activeStage={activeStage} onStageSelect={handleStageSelect} />;
}
