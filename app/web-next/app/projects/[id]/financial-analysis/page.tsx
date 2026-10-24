"use client";

// /projects/[id]/financial-analysis — thin wrapper route kept alive for
// deep-link compatibility. The actual UI now lives in
// components/FinancialAnalysisPanel.tsx and is also embedded as a tab inside
// business-case/page.tsx (?tab=financial-analysis).
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { FinancialAnalysisPanel } from "../../../../components/FinancialAnalysisPanel.tsx";

export default function FinancialAnalysisBridgePage() {
  const t = useTranslations("pages.projects.financialAnalysis");
  const { id: projectId } = useParams<{ id: string }>();
  return (
    <main className="market-page">
      <StageTabs projectId={projectId} />
      <StageFrame stageId="S8" heading={t("heading")}>
        <FinancialAnalysisPanel projectId={projectId} />
      </StageFrame>
    </main>
  );
}
