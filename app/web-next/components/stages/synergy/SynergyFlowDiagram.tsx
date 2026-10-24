"use client";

// SynergyFlowDiagram — ADR-0182 (Phase 1): the 4-element relationship diagram
// at the top of the S3 synergy detail. 연계 시너지(후보) → 우선 시너지(선별)
// → 필요 역량(레지스터) → 시너지 점수(판정) 흐름을 한 눈에 보여 주고, 각 노트
// 클릭 시 해당 탭으로 이동한다. 데이터는 ctx에서 산출 — 신규 조회 없음.
import { useCallback } from "react";
import { useTranslations } from "next-intl";

export interface FlowDiagramData {
  linkageCount: number;
  shortlistCount: number;
  capabilityRows: number;
  capabilityJudged: number;
  capabilityCoveragePct: number | null;
  synergyScore: number | null;
  scoreConfirmed: boolean;
}

export function SynergyFlowDiagram({ data, activeTab, onJump }: {
  data: FlowDiagramData;
  activeTab: string;
  onJump: (tabKey: "linkage" | "shortlist" | "capability" | "decision") => void;
}) {const t = useTranslations("stages.s3.synergyFlowDiagram"); const tc = useTranslations("common");
  const nodes: Array<{ key: "linkage" | "shortlist" | "capability" | "decision"; title: string; value: string; tone: string }> = [
    { key: "linkage", title: t("linkedSynergy"), value: t("p1CandidateS", { p1: data.linkageCount }), tone: activeTab === "linkage" ? "diagram-node-active" : "" },
    { key: "shortlist", title: t("prioritySynergy"), value: t("p1Selected", { p1: data.shortlistCount }), tone: activeTab === "shortlist" ? "diagram-node-active" : "" },
    { key: "capability", title: tc("requiredCapability"), value: data.capabilityRows > 0 ? t("p1HoldingRateP2", { p1: data.capabilityRows, p2: data.capabilityCoveragePct != null ? data.capabilityCoveragePct + "%" : tc("unjudged") }) : t("noRegister"), tone: activeTab === "capability" ? "diagram-node-active" : "" },
    { key: "decision", title: t("synergyScore"), value: data.synergyScore != null ? t("p1PtP2", { p1: data.synergyScore, p2: data.scoreConfirmed ? tc("confirmed") : tc("recommendation") }) : t("notComputed"), tone: activeTab === "decision" ? "diagram-node-active" : "" },
  ];
  const jump = useCallback((k: "linkage" | "shortlist" | "capability" | "decision") => () => onJump(k), [onJump]);
  return (
    <div
      className="market-section diagram-flow flex flex-wrap items-stretch gap-2 mb-2"
      role="group"
      aria-label={t("synergyMapPickPrioritySynergies")}
      data-testid="synergy-flow-diagram"
    >
      {nodes.map((n, i) => (
        <div key={n.key} className="flex items-stretch gap-2 min-w-0">
          {i > 0 && <span aria-hidden="true" className="self-center text-[color:var(--muted-fg)]">→</span>}
          <button
            type="button"
            className={`diagram-node border rounded px-2 py-1 text-left text-[length:var(--fs-caption)] bg-[color:var(--card)] ${n.tone}`}
            onClick={jump(n.key)}
            data-testid={`diagram-node-${n.key}`}
          >
            <span className="block font-semibold">{n.title}</span>
            <span className="text-[color:var(--muted-fg)]">{n.value}</span>
          </button>
        </div>
      ))}
    </div>
  );
}

/** FlowDiagramData 어셈블러 — 분석 payload·레지스터·점수에서 관계도 값을 뽑는다. */
export function flowDiagramDataFrom(p: {
  synergyAreas: Array<{ area: string }>;
  shortlist: Array<{ rank: number }>;
  gapRows: Array<{ id: string; necessity: string; held: { status: string } }>;
  synergyScore: number | null;
  synergyConfirmed: boolean;
}, capabilityCoveragePct: number | null): FlowDiagramData {
  const judged = p.gapRows.filter((r) => r.held.status !== "unevaluated");
  return {
    linkageCount: p.synergyAreas.length,
    shortlistCount: p.shortlist.length,
    capabilityRows: p.gapRows.length,
    capabilityJudged: judged.length,
    capabilityCoveragePct,
    synergyScore: p.synergyScore,
    scoreConfirmed: p.synergyConfirmed,
  };
}
