"use client";

// S10 프로젝트 단계 (/projects/[id]/deal-structure) — ADR-0120 Wave 3: 본문은 공유
// 컴포넌트 components/stages/DealStructureStage.tsx로 추출되었다. 이 페이지는 main 셸만
// 제공하는 래퍼다 — /deals/[id]/s10 탭도 동일 컴포넌트를 소비한다
// (URL ?tab= 동기는 페이지 모드에서만 동작한다).
import { Suspense } from "react";
import { useParams } from "next/navigation";
import { DealStructureStage } from "../../../../components/stages/DealStructureStage.tsx";

function DealStructurePageInner() {
  const params = useParams<{ id: string }>();
  return (
    <main>
      <DealStructureStage projectId={params.id} />
    </main>
  );
}

export default function DealStructurePageRoute() {
  return (
    <Suspense fallback={null}>
      <DealStructurePageInner />
    </Suspense>
  );
}
