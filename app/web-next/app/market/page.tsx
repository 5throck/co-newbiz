"use client";

// S1 시장분석 (/market) — ADR-0120 Wave 2 Phase C: 본문은 공유 컴포넌트
// components/stages/MarketAnalysisStage.tsx로 추출되었다. 예외적으로 StageFrame
// 안내 배너(가치사슬 관계도 버튼 등 컴포넌트 상태에 묶인 UI 포함)는 스테이지
// 컴포넌트가 직접 렌더링하므로, 이 페이지는 main 셸만 제공하는 래퍼다 —
// /deals/[id]/s1 탭도 동일 컴포넌트를 소비한다(URL ?industry= 선택은 페이지
// 모드에서만 동작한다).
import { Suspense } from "react";
import { MarketAnalysisStage } from "../../components/stages/MarketAnalysisStage.tsx";

function MarketView() {
  return (
    <main>
      <MarketAnalysisStage />
    </main>
  );
}

export default function MarketPage() {
  return (
    <Suspense fallback={null}>
      <MarketView />
    </Suspense>
  );
}
