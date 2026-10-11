"use client";

// 관리자 콘솔 가드 — /admin/** 전체에 관리자 진행 + 공통 헤더를 적용한다 (ADR-0091).
// admin 역할은 이 그룹의 화면만 사용하며(사이드바 분리, ADR-0091), 비관리자는 접근이 차단된다.
// 차단 시 조용히 다른 화면으로 보내지 않고 그 자리에서 안내한다
// (design 2026-10-11-ui-label-and-mobile-table-sweep §4 — 무음 /deals 리다이렉트 제거).
import type { ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "../lib/auth-client.tsx";

export function AdminGuard({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();

  if (loading || !me) return <main className="admin-console-page"><p role="status">불러오는 중...</p></main>;
  if (me.role !== "admin") {
    return (
      <main className="admin-console-page">
        <section className="status-page" role="alert">
          <h1>관리자 권한이 필요합니다.</h1>
          <p className="status-page-text">이 화면은 관리자 역할을 가진 사용자만 사용할 수 있습니다.</p>
          <p><Link className="btn-ghost" href="/deals">검토/안건 보드로 돌아가기</Link></p>
        </section>
      </main>
    );
  }
  return <>{children}</>;
}
