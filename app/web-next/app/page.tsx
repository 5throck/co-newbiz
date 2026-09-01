"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { api } from "../lib/api.ts";
import { useChartTheme } from "../lib/echarts-theme.ts";

const EChartsCore = dynamic(() => import("echarts-for-react"), { ssr: false });

// 대시보드 — S1~S3(기회 발굴) 현황. 트랙 결정 이후(딜/프로젝트) 흐름은
// flow.spec v2.0.0 재설계에 따라 재구축 예정이다.
interface DashboardOpportunity {
  id: string;
  name: string;
  status: "identified" | "assessed" | "selected" | "dropped";
  attractiveness_score: number | null;
  synergy_score: number | null;
  created_at: string;
}

const STATUS_LABELS: Record<DashboardOpportunity["status"], string> = {
  identified: "발굴",
  assessed: "평가",
  selected: "선별",
  dropped: "제외",
};

export default function DashboardPage() {
  const ct = useChartTheme();
  const [opps, setOpps] = useState<DashboardOpportunity[]>([]);

  useEffect(() => {
    api.get<DashboardOpportunity[]>("/api/opportunities").then((res) => setOpps(res.data)).catch(() => {});
  }, []);

  const statusOrder: DashboardOpportunity["status"][] = ["identified", "assessed", "selected", "dropped"];
  const statusCounts = statusOrder.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    count: opps.filter((o) => o.status === status).length,
  }));

  const funnelChartOption = {
    tooltip: { trigger: "axis" as const },
    xAxis: {
      type: "category" as const,
      data: statusCounts.map((s) => s.label),
      axisLabel: { color: ct.muted, fontSize: 11 },
      axisLine: { lineStyle: { color: ct.axis } },
    },
    yAxis: {
      type: "value" as const,
      minInterval: 1,
      axisLabel: { color: ct.muted },
      splitLine: { lineStyle: { color: ct.split } },
    },
    series: [
      {
        type: "bar" as const,
        data: statusCounts.map((s) => s.count),
        itemStyle: {
          color: ct.color[0],
          borderRadius: [4, 4, 0, 0],
        },
        barMaxWidth: 40,
      },
    ],
    grid: { left: 40, right: 20, top: 20, bottom: 40 },
  };

  const scored = opps.filter((o) => o.attractiveness_score !== null || o.synergy_score !== null);
  const avgAttractiveness =
    scored.length > 0
      ? Math.round(scored.reduce((acc, o) => acc + (o.attractiveness_score ?? 0), 0) / scored.length)
      : null;

  return (
    <main className="dashboard-page">
      <h1 className="text-2xl font-bold mb-6">대시보드</h1>

      {/* KPI Cards */}
      <div className="summary-cards">
        <div className="summary-card glass">
          <span className="summary-value mono-num">{opps.length}</span>
          <span className="text-label">전체 기회</span>
        </div>
        <div className="summary-card glass">
          <span className="summary-value mono-num">{opps.filter((o) => o.status === "selected").length}</span>
          <span className="text-label">선별된 기회</span>
        </div>
        <div className="summary-card glass">
          <span className="summary-value mono-num">{opps.filter((o) => o.status === "assessed").length}</span>
          <span className="text-label">평가 중</span>
        </div>
        <div className="summary-card glass" style={{ borderColor: "var(--green-border)" }}>
          <span className="summary-value mono-num" style={{ color: "var(--green-fg)" }}>{avgAttractiveness ?? "—"}</span>
          <span className="text-label">평균 매력도</span>
        </div>
      </div>

      {/* Charts Row */}
      <div className="charts-row">
        <section className="chart-card glass">
          <h3 className="text-label mb-2">기회 퍼널 분포</h3>
          <EChartsCore option={funnelChartOption} style={{ height: 280 }} />
        </section>
      </div>

      {/* Recent Opportunities */}
      <section className="glass p-4 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-label">최근 등록 기회</h3>
          <Link href="/opportunities" className="text-sm text-[color:var(--primary)] hover:underline">전체 보기</Link>
        </div>
        {opps.length === 0 ? (
          <p className="text-[color:var(--muted-fg)]">등록된 기회가 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {opps.slice(0, 5).map((o) => (
              <li key={o.id}>
                <Link href="/opportunities" className="flex items-center gap-3 p-2 rounded hover:bg-[rgba(255,255,255,0.04)] transition-colors">
                  <span className="font-semibold">{o.name}</span>
                  <span className="text-sm text-[color:var(--muted-fg)]">{STATUS_LABELS[o.status]}</span>
                  <span className="ml-auto text-sm text-[color:var(--muted-fg)] tabular-nums">
                    매력도 {o.attractiveness_score ?? "—"} · 시너지 {o.synergy_score ?? "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
