"use client";

// SynergyFlowDiagram — ADR-0182 (Phase 1): the 4-element relationship diagram
// at the top of the S3 synergy detail. 연계 시너지(후보) → 우선 시너지(선별)
// → 필요 역량(레지스터) → 시너지 점수(판정) 흐름을 한 눈에 보여 주고, 각 노트
// 클릭 시 해당 탭으로 이동한다. 데이터는 ctx에서 산출 — 신규 조회 없음.
import { useCallback } from "react";

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
}) {
  const nodes: Array<{ key: "linkage" | "shortlist" | "capability" | "decision"; title: string; value: string; tone: string }> = [
    { key: "linkage", title: "연계 시너지", value: `후보 ${data.linkageCount}건`, tone: activeTab === "linkage" ? "diagram-node-active" : "" },
    { key: "shortlist", title: "우선 시너지", value: `선별 ${data.shortlistCount}건`, tone: activeTab === "shortlist" ? "diagram-node-active" : "" },
    { key: "capability", title: "필요 역량", value: data.capabilityRows > 0 ? `${data.capabilityRows}건 · 보유율 ${data.capabilityCoveragePct != null ? data.capabilityCoveragePct + "%" : "미판정"}` : "레지스터 없음", tone: activeTab === "capability" ? "diagram-node-active" : "" },
    { key: "decision", title: "시너지 점수", value: data.synergyScore != null ? `${data.synergyScore}점 · ${data.scoreConfirmed ? "확정" : "권고"}` : "미산출", tone: activeTab === "decision" ? "diagram-node-active" : "" },
  ];
  const jump = useCallback((k: "linkage" | "shortlist" | "capability" | "decision") => () => onJump(k), [onJump]);
  return (
    <div
      className="market-section diagram-flow flex flex-wrap items-stretch gap-2 mb-2"
      role="group"
      aria-label="시너지 4요소 관계도 — 연계 시너지에서 우선 시너지를 선별하고, 필요 역량을 충족해 시너지 점수로 판정합니다"
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
