"use client";

// S12 프로젝트 단계 (/projects/[id]/portfolio) — ADR-0120 Wave 3: 본문은 공유
// 컴포넌트 components/stages/PortfolioStage.tsx로 추출되었다. 이 페이지는 main 셸만
// 제공하는 래퍼다 — /deals/[id]/s12 탭도 동일 컴포넌트를 소비한다.
import { useParams } from "next/navigation";
import { PortfolioStage } from "../../../../components/stages/PortfolioStage.tsx";

export default function PortfolioPage() {
  const params = useParams<{ id: string }>();
  return (
    <main>
      <PortfolioStage projectId={params.id} />
    </main>
  );
}
