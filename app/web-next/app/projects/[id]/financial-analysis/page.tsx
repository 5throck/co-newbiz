"use client";

// /projects/[id]/financial-analysis — thin wrapper route kept alive for
// deep-link compatibility. The actual UI now lives in
// components/FinancialAnalysisPanel.tsx and is also embedded as a tab inside
// business-case/page.tsx (?tab=financial-analysis).
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { StageFrame, useCarrierTrack } from "../../../../components/StageFrame.tsx";
import { S8PartHeader } from "../../../../components/stages/S8PartHeader.tsx";
import { FinancialAnalysisPanel } from "../../../../components/FinancialAnalysisPanel.tsx";

export default function FinancialAnalysisBridgePage() {
  const ts = useTranslations("stages.s8.stage");
  const { id: projectId } = useParams<{ id: string }>();
  // Same head as /business-case: StageFrame first (h1, subtitle, handoff strip), StageTabs in
  // railSlot, then the 재무적 타당성 part header in the body. The subtitle is the S8 stage
  // subtitle (greenfield = no target axis -> market-basis valuation), not the sub-screen title.
  const greenfield = useCarrierTrack(true) === "greenfield";
  return (
    <main className="market-page">
      <StageFrame
        stageId="S8"
        subtitle={greenfield ? ts("s8BusinessCaseValuation") : ts("s8BusinessCaseValuationComparison")}
        railSlot={<StageTabs projectId={projectId} />}
      >
        <S8PartHeader part="financial" />
        <FinancialAnalysisPanel projectId={projectId} />
      </StageFrame>
    </main>
  );
}
