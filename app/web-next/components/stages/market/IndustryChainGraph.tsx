"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useChartTheme } from "../../../lib/echarts-theme.ts";
import type { ChainGraphNode, ChainGraphEdge } from "./types.ts";

export function IndustryChainGraph({ nodes, edges }: { nodes: ChainGraphNode[]; edges: ChainGraphEdge[] }) {
  const ct = useChartTheme();
  if (nodes.length === 0) return null;

  const COL_W = 200;
  const ROW_H = 56;
  const NODE_W = 168;
  const NODE_H = 36;
  const PAD = 20;

  const byLayer = new Map<number, ChainGraphNode[]>();
  for (const n of nodes) {
    if (!byLayer.has(n.layer)) byLayer.set(n.layer, []);
    byLayer.get(n.layer)!.push(n);
  }
  for (const list of byLayer.values()) list.sort((a, b) => a.name_ko.localeCompare(b.name_ko));

  const pos = new Map<string, { x: number; y: number }>();
  const layerKeys = [...byLayer.keys()].sort((a, b) => a - b);
  let maxRows = 1;
  for (const layer of layerKeys) {
    const list = byLayer.get(layer)!;
    maxRows = Math.max(maxRows, list.length);
    list.forEach((n, i) => {
      pos.set(n.id, { x: PAD + layer * COL_W, y: PAD + i * ROW_H });
    });
  }
  const width = PAD * 2 + (layerKeys.length - 1) * COL_W + NODE_W;
  const height = PAD * 2 + maxRows * ROW_H;

  return (
    <div className="table-scroll" style={{ overflowX: "auto" }}>
      <svg width={width} height={height} role="img" aria-label="산업 간 가치사슬 관계도" style={{ minWidth: "100%" }}>
        <defs>
          <marker id="chain-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={ct.muted} />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = b.x;
          const y2 = b.y + NODE_H / 2;
          const midX = (x1 + x2) / 2;
          return (
            <path
              key={i}
              d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={ct.muted}
              strokeWidth={1.2}
              markerEnd="url(#chain-arrow)"
              opacity={0.6}
            >
              <title>{`${e.relation}${e.hopDistance ? ` (hop ${e.hopDistance})` : ""}`}</title>
            </path>
          );
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id)!;
          return (
            <g key={n.id} transform={`translate(${p.x}, ${p.y})`}>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill={n.analyzed ? ct.color[0] : ct.split}
                fillOpacity={n.analyzed ? 0.16 : 1}
                stroke={n.analyzed ? ct.color[0] : ct.muted}
                strokeWidth={1}
              >
                <title>{n.name_ko}{n.analyzed ? " — 분석 완료" : " — 미분석"}</title>
              </rect>
              <text x={NODE_W / 2} y={NODE_H / 2 + 4} textAnchor="middle" fontSize={11} fill={ct.text ?? ct.muted}>
                {n.name_ko.length > 14 ? `${n.name_ko.slice(0, 13)}…` : n.name_ko}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}