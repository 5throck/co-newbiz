"use client";

// 개발자 상세 공개 (design 2026-10-11-ui-label-and-mobile-table-sweep §1.1/§7):
// 라벨 맵에 없는 원본 키(raw key)는 본문에 절대 노출하지 않고, 기본 접힌
// <details> 공개 안에서만 <code lang="en">으로 보여준다. 매핑된 키는
// 공개를 만들지 않는다(소음 방지).
import type { LabelResult } from "../lib/labels.ts";

export function RawKey({ parts }: { parts: LabelResult | LabelResult[] }) {
  const list = (Array.isArray(parts) ? parts : [parts]).filter((p) => p.isFallback && p.raw);
  if (list.length === 0) return null;
  return (
    <details className="raw-key-details">
      <summary>개발자 상세</summary>
      <span className="raw-key-list">
        {list.map((p) => (
          <code key={p.raw} lang="en">{p.raw}</code>
        ))}
      </span>
    </details>
  );
}
