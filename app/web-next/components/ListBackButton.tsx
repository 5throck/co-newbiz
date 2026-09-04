"use client";

// 목록 복귀 버튼 — 단일 패턴 (ADR-0105 보완 규약, 2026-09-04 프로젝트 리뷰).
// 상태 기반 상세 화면은 onClick, URL 기반 상세는 href를 사용한다.
// 스타일·위치(SectionToolbar 좌측)·라벨("← 목록으로")은 이 컴포넌트로 통일한다.
import Link from "next/link";

export function ListBackButton({
  href,
  onClick,
  label = "목록으로",
}: {
  href?: string;
  onClick?: () => void;
  label?: string;
}) {
  const cls = "btn-ghost btn-sm";
  if (href) {
    return (
      <Link href={href} className={cls}>
        ← {label}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick}>
      ← {label}
    </button>
  );
}
