"use client";

// /projects/[id]/financial-analysis — thin wrapper route kept alive for
// deep-link compatibility. The actual UI now lives in
// components/FinancialAnalysisPanel.tsx and is also embedded as a tab inside
// business-case/page.tsx (?tab=financial-analysis).
import { useParams } from "next/navigation";
import { ProjectSubNav } from "../../../../components/ProjectSubNav.tsx";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { FinancialAnalysisPanel } from "../../../../components/FinancialAnalysisPanel.tsx";

export default function FinancialAnalysisBridgePage() {
  const { id: projectId } = useParams<{ id: string }>();
  return (
    <main className="market-page">
      <ProjectSubNav projectId={projectId} />
      <StageFrame stageId="S8" heading="재무분석 — 대상 회사 연결">
        <FinancialAnalysisPanel projectId={projectId} />
      </StageFrame>
    </main>
  );
}
