"use client";

// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition); behavior unchanged.
import { type ReactNode } from "react";

// ── 외부 검색 근거의 [n] 인용 마커를 출처 링크로 바꿔 렌더링한다 ──
// 프로파일 파이프라인(Step 3·4)이 웹 리서치 근거에 붙이는 출처 번호(예:
// "…소재 양산 개시 [3]")를 개요·SWOT 화면에서 바로 열 수 있게 연결한다
// (사용자 요청, 2026-09-16). 번호가 리서치 범위 밖이면 원문 그대로 둔다.
export function renderWithCitations(text: string, sources: Array<{ title: string; url: string }>, titlePrefix = "\uc678\ubd80 \ub9ac\uc11c\uce58 \ucd9c\ucc98 \u2014"): ReactNode {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = /^\[(\d+)\]$/.exec(part);
    const src = m ? sources[Number(m[1]) - 1] : undefined;
    if (!m || !src) return <span key={i}>{part}</span>;
    return (
      <a key={i} href={src.url} target="_blank" rel="noreferrer" title={`${titlePrefix} ${src.title}`} className="text-[color:var(--accent)] underline text-[0.75em] align-super">
        {part}
      </a>
    );
  });
}