"use client";

// Port of app/web/src/App.tsx's RequireAuth/RequireAdmin/TopNav, adapted
// from react-router-dom's <Routes>/<Navigate> to Next.js App Router: each
// page.tsx is now its own route (no central <Routes> tree), so the
// auth/must-change-password gate that used to wrap each <Route> element
// individually now lives once, here, wrapping every page via the root
// layout. Admin-only gating stays per-page (see app/admin/page.tsx) since
// only one route needs it — a single extra check there is simpler than a
// second shell layer.

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../lib/auth-client.tsx";

function TopNav() {
  const { me, logout } = useAuth();
  if (!me) return null;
  return (
    <header className="top-nav">
      <Link href="/projects" className="brand">
        co-newbiz
      </Link>
      <nav aria-label="주 메뉴">
        <Link href="/projects">프로젝트</Link>
        <Link href="/portfolio-scorecard">포트폴리오 스코어카드</Link>
        <Link href="/glossary">용어집</Link>
        {me.role === "admin" && <Link href="/admin">관리자 콘솔</Link>}
      </nav>
      <div className="top-nav-user">
        <span>
          {me.userId} ({me.role})
        </span>
        <button type="button" onClick={() => logout()}>
          로그아웃
        </button>
      </div>
    </header>
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
  if (loading) return <p className="loading-splash">불러오는 중...</p>;
  if (!me) return null; // redirect effect above is in flight
  if (me.mustChangePassword && pathname !== "/password-change") return null;

  return (
    <>
      <TopNav />
      {children}
    </>
  );
}
