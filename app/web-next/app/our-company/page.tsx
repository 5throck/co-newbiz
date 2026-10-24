"use client";

// S3 그룹/계열사 분석 (/our-company) — ADR-0120 Wave 2 Phase C: 본문은 공유
// 컴포넌트 components/stages/OurCompanyStage.tsx로 추출되었다. 이 페이지는
// 표준 페이지 셸(h1 + breadcrumb, 단계 외피 없음)을 제공하는 래퍼다 — deals 탭도
// 동일 컴포넌트를 소비한다
// (URL ?member= 선택은 페이지 모드에서만 동작한다).
import { Suspense } from "react";
import { useTranslations } from "next-intl";
import { OurCompanyStage } from "../../components/stages/OurCompanyStage.tsx";
import { OUR_COMPANY_COPY } from "../../components/stages/our-company/constants.ts";

function OurCompanyView() {
  const tr = useTranslations();
  return (
    <main>
      <h1>{tr("ourCompany.h1")}</h1>
      <p className="mt-[0.15rem] mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">{tr(OUR_COMPANY_COPY.s3Lead)}</p>
      <details className="how-used mb-3">
        <summary>{tr(OUR_COMPANY_COPY.howUsedSummary)}</summary>
        <p className="mt-2 mb-0 text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{tr(OUR_COMPANY_COPY.howUsedBody)}</p>
      </details>
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
