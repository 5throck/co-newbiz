"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { type SizingMatrix } from "../../../lib/market-sizing.ts";
import { useSizingReport } from "./useSizingReport.ts";
import { SizingOverviewTab, SizingCompetitiveTab, SizingSizeTab, SizingAllocationTab } from "./SizingMarketTabs.tsx";
import { SizingStructureTab } from "./SizingStructureTab.tsx";
import { SizingGrowthTab, SizingQualitativeTab } from "./SizingGrowthTabs.tsx";
import { SizingPipelineTab, SizingRegulationTab, SizingRiskTab, SizingValidateTab } from "./SizingAnalysisTabs.tsx";
import type { IndustryDetail } from "./types.ts";

export function SizingReport(props0: {
  detail: IndustryDetail;
  matrix: SizingMatrix;
  stepSummaries: Array<{ step: number; summary: string; source: string; pendingInputs: string[] }> | null;
  analysisId: string | null;
  onAddLinked?: () => void;
}) {
  const h0 = useSizingReport(props0);
  const ctx = { ...h0 };
  const { TABS, tab, setTab } = ctx;
  return (
    <div className="sizing-report text-[length:var(--fs-body)]">
      <div className="library-tabs" role="tablist" aria-label="리포트 섹션">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`library-tab ${tab === key ? "library-tab-active" : ""}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      <SizingOverviewTab ctx={ctx} />

      {tab !== "overview" && (
      <>
      <SizingStructureTab ctx={ctx} />

      <SizingCompetitiveTab ctx={ctx} />



      <SizingSizeTab ctx={ctx} />


      <SizingAllocationTab ctx={ctx} />


      <SizingGrowthTab ctx={ctx} />

      <SizingQualitativeTab ctx={ctx} />

      <SizingPipelineTab ctx={ctx} />

      <SizingRegulationTab ctx={ctx} />

      <SizingRiskTab ctx={ctx} />


      <SizingValidateTab ctx={ctx} />
      </>
      )}
    </div>
  );
}
