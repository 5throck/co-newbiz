"use client";

// 관리자 콘솔 가드 — /admin/** 전체에 관리자 진행 + 공통 헤더를 적용한다 (ADR-0091).
// admin 역할은 이 그룹의 화면만 사용하며(사이드바 분리, ADR-0091), 비관리자는 접근이 차단된다.
// 차단 시 조용히 이동하지 않고 `?moved=admin` 으로 이유를 알린다 (R2-C 9).
import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth-client.tsx";

export function AdminGuard({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && me && me.role !== "admin") router.replace("/deals?moved=admin");
  }, [loading, me, router]);

  if (loading || !me) return <main className="admin-console-page"><p role="status">불러오는 중...</p></main>;
  if (me.role !== "admin") {
    return <main className="admin-console-page"><p role="alert" className="text-[color:var(--red-fg)]">관리자 전용 화면입니다.</p></main>;
  }
  return <>{children}</>;
}
