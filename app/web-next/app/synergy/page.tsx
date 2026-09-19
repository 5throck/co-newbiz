"use client";

// S3 시너지·전략적 적합성 (/synergy) — ADR-0120 Wave 2 Phase B: 본문은 공유
// 컴포넌트 components/stages/SynergyStage.tsx로 추출되었다. 이 페이지는
// StageFrame과 main 셸만 제공하는 래퍼다 — /deals/[id]/s3 탭도 동일 컴포넌트를
// 소비한다(URL ?company= 선택은 페이지 모드에서만 동작한다).
import { Suspense } from "react";
import { StageFrame } from "../../components/StageFrame.tsx";
import { SynergyStage } from "../../components/stages/SynergyStage.tsx";

function SynergyView() {
  return (
    <main>
      <StageFrame stageId="S3">
        그룹/계열사 분석에서 만든 자사 프로파일(특정 계열사 또는 그룹 전체)을 S1 시장분석·S2 기회발굴
        결과와 연결해 시너지 영역 후보를 도출하고 우선 시너지 영역으로 좁힙니다. 기회를 연결하면 완료 시 해당 기회에
        synergy_score 권고가 기록됩니다.
      </StageFrame>
      <SynergyStage />
    </main>
  );
}

export default function SynergyPage() {
  return (
    <Suspense fallback={null}>
      <SynergyView />
    </Suspense>
  );
}
