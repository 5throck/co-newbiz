"use client";

// S8 프로젝트 단계 (/projects/[id]/business-case) — ADR-0120 Wave 3: 본문은 공유
// 컴포넌트 components/stages/BusinessCaseStage.tsx로 추출되었다. 이 페이지는 main 셸만
// 제공하는 래퍼다 — /deals/[id]/s8 탭도 동일 컴포넌트를 소비한다
// (URL ?tab= 동기는 페이지 모드에서만 동작한다).
import { Suspense } from "react";
import { useParams } from "next/navigation";
import { BusinessCaseStage } from "../../../../components/stages/BusinessCaseStage.tsx";

function BusinessCasePageInner() {
  const params = useParams<{ id: string }>();
  return (
    <main>
      <BusinessCaseStage projectId={params.id} />
    </main>
  );
}

export default function BusinessCasePageRoute() {
  return (
    <Suspense fallback={null}>
      <BusinessCasePageInner />
    </Suspense>
  );
}
