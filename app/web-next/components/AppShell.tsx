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
} from "lucide-react";
import { useAuth } from "../lib/auth-client.tsx";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
}

const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: "워크스페이스",
    items: [
      { href: "/projects", label: "프로젝트", icon: <FolderKanban size={18} /> },
      {
        href: "/portfolio-scorecard",
        label: "스코어카드",
        icon: <LayoutDashboard size={18} />,
      },
      {
        href: "/reports",
        label: "보고서",
        icon: <FileText size={18} />,
      },
    ],
  },
  {
    label: "참조",
    items: [
      { href: "/glossary", label: "용어집", icon: <BookOpen size={18} /> },
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

function Sidebar() {
  const { me, logout } = useAuth();
  const pathname = usePathname();
  if (!me) return null;

  return (
    <aside className="app-sidebar">
      <Link href="/projects" className="sidebar-brand">
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
      <div className="sidebar-user">
        <span className="text-sm text-[color:var(--muted-fg)]">{me.userId}</span>
        <button type="button" onClick={() => logout()} className="side-nav-link w-full">
          <LogOut size={18} />
          <span>로그아웃</span>
        </button>
      </div>
    </aside>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!me && pathname !== "/login") {
      router.replace("/login");
      return;
    }
    if (me?.mustChangePassword && pathname !== "/password-change") {
      router.replace("/password-change");
    }
  }, [me, loading, pathname, router]);

  if (pathname === "/login") return <>{children}</>;
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
      <main className="app-content">{children}</main>
    </div>
  );
}
