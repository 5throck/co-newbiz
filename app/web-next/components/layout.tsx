"use client";

// 통합 시각 레이아웃 프리미티브 (ADR-0083).
// 페이지 헤더/섹션 헤더/행 액션은 이 모듈의 구조만 사용한다 —
// 등록 버튼의 위치, 버튼 크기(툴바=기본, 행=btn-sm), 간격(8px, design-token-exempt: prose)은
// 컴포넌트 안에서 고정되므로 페이지별 편차가 생기지 않는다.

import type { ReactNode } from "react";

export function PageHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <>
      <h1>{title}</h1>
      {description && (
        <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[0.9rem]">{description}</p>
      )}
    </>
  );
}

export function SectionToolbar({
  title,
  icon,
  count,
  filters,
  summary,
  actions,
}: {
  title?: string;
  icon?: string;
  count?: number | string;
  filters?: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="section-toolbar">
      <span className="section-title">
        {(title || icon) && (
          <h2>
            {icon ? `${icon} ` : ""}
            {title}
          </h2>
        )}
        {count !== undefined && <span className="section-meta">{count}건</span>}
      </span>
      {filters && <span className="toolbar-filters">{filters}</span>}
      {summary && (
        <span className="toolbar-filters" style={{ marginLeft: "auto" }}>
          {summary}
        </span>
      )}
      {actions && (
        <span className="toolbar-actions" style={summary ? { marginLeft: 0 } : undefined}>
          {actions}
        </span>
      )}
    </div>
  );
}

// 행 액션 셀 — 셀 안의 버튼은 항상 btn-sm 크기로 강제한다.
// td는 table-cell을 유지하고, flex 정렬은 내부 .actions-row가 담당한다.
export function RowActions({ children, ariaLabel }: { children: ReactNode; ariaLabel?: string }) {
  return (
    <td className="sizing-actions-cell" aria-label={ariaLabel}>
      <span className="actions-row">{children}</span>
    </td>
  );
}
