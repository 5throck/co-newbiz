"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api.ts";

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

interface RoicResponse {
  computable: boolean;
  reason?: string;
  industry_id?: string;
  fiscal_year?: number;
  roic?: number;
  nopat_margin?: number;
  tree?: TreeRow[];
  waterfall?: WaterfallRow[];
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
  const maxAbs = Math.max(...waterfall.map((w) => Math.abs(w.value)), 1);

  return (
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
      <div className="space-y-2">
        {waterfall.map((w, i) => {
          const widthPct = (Math.abs(w.value) / maxAbs) * 100;
          const color =
            w.kind === "delta"
              ? w.value < 0
                ? "bg-rose-500/30"
                : "bg-emerald-500/30"
              : w.kind === "pct"
                ? "bg-[color:var(--primary)]/40"
                : "bg-[color:var(--primary)]/20";
          return (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="w-32 shrink-0 text-[color:var(--muted-fg)]">{w.step}</span>
              <div className="flex-1 h-5 bg-[color:var(--border-subtle)] rounded">
                <div className={`h-5 rounded ${color}`} style={{ width: `${widthPct}%` }} />
              </div>
              <span className="w-28 text-right font-mono">{w.kind === "pct" ? `${w.value.toFixed(2)}%` : fmt(w.value)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
