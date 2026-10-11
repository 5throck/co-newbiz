"use client";

// S3 그룹/계열사 분석 (/our-company) — ADR-0120 Wave 2 Phase C: 본문은 공유
// 컴포넌트 components/stages/OurCompanyStage.tsx로 추출되었다. 이 페이지는
// 표준 페이지 셸(h1 + breadcrumb, 단계 외피 없음)을 제공하는 래퍼다 — deals 탭도
// 동일 컴포넌트를 소비한다
// (URL ?member= 선택은 페이지 모드에서만 동작한다).
import { Suspense } from "react";
import { Breadcrumb } from "../../components/Breadcrumb.tsx";
import { OurCompanyStage } from "../../components/stages/OurCompanyStage.tsx";

function OurCompanyView() {
  return (
    <main>
      <Breadcrumb items={[{ label: "홈", href: "/" }, { label: "그룹/계열사 분석" }]} />
      <h1>그룹/계열사 분석</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[0.9rem]">
        그룹과 계열사를 등록해 자사 강점/약점을 분석합니다. 이 프로파일은 단계 S3 시너지·적합성 평가의 입력(자사 역량·포트폴리오 정보)으로 사용됩니다.
        상장 계열사는 DART 재무제표, 전체는 애널리스트 리포트·산업 동향 리서치로 분석합니다.
      </p>
      <OurCompanyStage />
    </main>
  );
}

export default function OurCompanyPage() {
  return (
    <Suspense fallback={null}>
      <OurCompanyView />
    </Suspense>
  );
}
