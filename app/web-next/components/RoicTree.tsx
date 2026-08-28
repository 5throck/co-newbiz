"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api.ts";
import { RoicWaterfallChart } from "./RoicWaterfallChart.tsx";

interface TreeRow {
  level: number;
  label: string;
  value: number;
  parent: string | null;
  pct?: boolean;
}

interface WaterfallRow {
  step: string;
  value: number;
  kind: "total" | "delta" | "subtotal" | "pct";
}

interface HistoricalRoicPoint {
  fiscal_year: number;
  roic: number;
}

interface ProjectionYear {
  fiscal_year: number;
  projected_roic: number;
  base_rate_warning: boolean;
}

interface Projection {
  computable: boolean;
  reason?: string;
  anchor_ref?: string;
  cagr?: number;
  years?: ProjectionYear[];
}

interface RoicResponse {
  computable: boolean;
  reason?: string;
  industry_id?: string;
  fiscal_year?: number;
  roic?: number;
  nopat_margin?: number;
  tree?: TreeRow[];
  waterfall?: WaterfallRow[];
  historical_roic?: HistoricalRoicPoint[];
  projection?: Projection;
}

function fmt(v: number, pct?: boolean) {
  if (pct) return `${(v * 100).toFixed(2)}%`;
  return v.toLocaleString("ko-KR");
}

export function RoicTree({ projectId }: { projectId: string }) {
  const [data, setData] = useState<RoicResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    api
      .get<RoicResponse>(`/api/projects/${projectId}/roic-tree`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "ROIC 트리를 불러오지 못했습니다."));
  }, [projectId]);

  if (error) return <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>;
  if (data === null) return <p>불러오는 중...</p>;

  if (!data.computable) {
    return (
      <div className="glass p-5 text-sm text-[color:var(--muted-fg)]">
        ROIC driver-tree를 계산할 수 없습니다: {data.reason}. fact_industry에 revenue / NOPAT(또는 영업이익) / invested capital(또는 총자산) 지표가 존재해야 합니다.
      </div>
    );
  }

  const tree = data.tree ?? [];
  const waterfall = data.waterfall ?? [];

  return (
    <>
      <section aria-label="ROIC 드라이버 트리" className="mt-6">
      <h3 className="font-bold text-lg mb-2">ROIC 드라이버 트리</h3>
      <div className="flex gap-6 mb-4 flex-wrap">
        <div className="glass p-4 flex-1 min-w-[160px]">
          <div className="text-xs text-[color:var(--muted-fg)]">ROIC ({data.fiscal_year})</div>
          <div className="text-2xl font-black text-[color:var(--primary)]">{fmt(data.roic ?? 0, true)}</div>
        </div>
        <div className="glass p-4 flex-1 min-w-[160px]">
          <div className="text-xs text-[color:var(--muted-fg)]">NOPAT Margin</div>
          <div className="text-2xl font-black">{fmt(data.nopat_margin ?? 0, true)}</div>
        </div>
      </div>

      <h4 className="font-semibold mb-2">드라이버 트리</h4>
      <ul className="space-y-1">
        {tree.map((row, i) => (
          <li
            key={i}
            className="text-sm"
            style={{ paddingLeft: `${(row.level - 1) * 1.25}rem` }}
          >
            <span className="text-[color:var(--muted-fg)]">{row.label}:</span>{" "}
            <span className="font-mono">{fmt(row.value, row.pct)}</span>
          </li>
        ))}
      </ul>

      <h4 className="font-semibold mt-4 mb-2">마진 브리지 (Waterfall)</h4>
      <RoicWaterfallChart steps={waterfall} />
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">마진 브리지 상세</caption>
          <thead>
            <tr className="text-left">
              <th className="p-2 border-b border-[color:var(--border)]">단계</th>
              <th className="p-2 border-b border-[color:var(--border)] text-right">값</th>
            </tr>
          </thead>
          <tbody>
            {waterfall.map((w, i) => (
              <tr key={i}>
                <td className="p-2 border-b border-[color:var(--border-subtle)]">{w.step}</td>
                <td className="p-2 border-b border-[color:var(--border-subtle)] text-right font-mono">
                  {w.kind === "pct" ? `${w.value.toFixed(2)}%` : fmt(w.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
    <ProjectionSection projection={data.projection} />
    </>
  );
}

function ProjectionSection({ projection }: { projection?: Projection }) {
  return (
    <section aria-label="ROIC 프로젝션" className="mt-6">
      <h4 className="font-semibold mb-2">프로젝션 (ADR-0018 anchor)</h4>
      {!projection || !projection.computable ? (
        <div className="glass p-4 text-sm text-[color:var(--muted-fg)]">
          프로젝션을 계산할 수 없습니다{projection?.reason ? `: ${projection.reason}` : ""}.
        </div>
      ) : (
        <>
          <p className="text-xs text-[color:var(--muted-fg)] mb-2">
            anchor_ref: <span className="font-mono">{projection.anchor_ref}</span> · CAGR:{" "}
            <span className="font-mono">{fmt(projection.cagr ?? 0, true)}</span>
          </p>
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">ROIC 프로젝션 상세</caption>
            <thead>
              <tr className="text-left">
                <th className="p-2 border-b border-[color:var(--border)]">연도</th>
                <th className="p-2 border-b border-[color:var(--border)] text-right">예상 ROIC</th>
                <th className="p-2 border-b border-[color:var(--border)]">base-rate</th>
              </tr>
            </thead>
            <tbody>
              {(projection.years ?? []).map((y) => (
                <tr key={y.fiscal_year}>
                  <td className="p-2 border-b border-[color:var(--border-subtle)]">{y.fiscal_year}</td>
                  <td className="p-2 border-b border-[color:var(--border-subtle)] text-right font-mono">
                    {fmt(y.projected_roic, true)}
                  </td>
                  <td className="p-2 border-b border-[color:var(--border-subtle)]">
                    {y.base_rate_warning ? (
                      <span className="critical-badge">
                        <span aria-hidden="true">⚠</span> 역사적 분포 상위 10% 초과
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
