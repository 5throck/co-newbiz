"use client";

// 기회 발굴 (/opportunities) — S2 기회 퍼널. ADR-0120 Wave 2 Phase A: 본문은
// 공유 컴포넌트 components/stages/OpportunityFunnelStage.tsx로 추출되었다. 이
// 페이지는 StageFrame과 main 셸만 제공하는 래퍼다 — /deals/[id]/s2 탭도 동일
// 컴포넌트를 소비한다(캐리어 기회 행 표시).
import { Suspense } from "react";
import { StageFrame } from "../../components/StageFrame.tsx";
import { OpportunityFunnelStage } from "../../components/stages/OpportunityFunnelStage.tsx";

function OpportunitiesView() {
  return (
    <main>
      <StageFrame stageId="S2">
        시장분석(S1) 산출물에서 기회를 발굴하고, 기회·위험 요인을 근거로 매력도를 평가합니다.
      </StageFrame>
      <OpportunityFunnelStage />
    </main>
  );
}

export default function OpportunitiesPage() {
  return (
    <Suspense fallback={null}>
      <OpportunitiesView />
    </Suspense>
  );
}
