"use client";

// 404 / 오류 화면 공통 골격 (R2-C 2). 테마 토큰만 사용하고, 항상 돌아갈 길(보드·이전 화면)을 제공한다.
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

export function StatusPage({ title, children, onRetry, detail }: { title: string; children: ReactNode; onRetry?: () => void; detail?: string }) {
  const tc = useTranslations("common");
  const sp = useTranslations("components.statusPage");
  const router = useRouter();
  return (
    <main className="status-page">
      <h1>{title}</h1>
      <p className="status-page-text">{children}</p>
      <div className="page-header-actions">
        {onRetry && (
          <button type="button" className="btn-primary" onClick={onRetry}>{tc("retry")}</button>
        )}
        <Link href="/deals" className={onRetry ? "btn-ghost" : "btn-primary"}>{tc("goToDealBoard")}</Link>
        <button type="button" className="btn-ghost" onClick={() => router.back()}>{tc("backToPrevious")}</button>
      </div>
      {detail && (
        <details className="status-page-detail">
          <summary>{sp("devDetail")}</summary>
          <p>{detail}</p>
        </details>
      )}
    </main>
  );
}
