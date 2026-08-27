"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/auth-client.tsx";
import { GradeBadge } from "../components/RagCard.tsx";

const EChartsCore = dynamic(() => import("echarts-for-react"), { ssr: false });

interface DashboardProject {
  id: string;
  project_no: string;
  created_at: string;
  rag_overall: string | null;
  gate_stage: string | null;
  is_stale: boolean;
}

const GATE_STAGES = ["screening", "pre_fs", "fs", "dd", "entity_ic", "group_ic"];
const GATE_LABELS: Record<string, string> = {
  screening: "Screening",
  pre_fs: "Pre-FS",
  fs: "FS",
  dd: "DD",
  entity_ic: "Entity IC",
  group_ic: "Group IC",
};

export default function DashboardPage() {
  const { me } = useAuth();
  const [projects, setProjects] = useState<DashboardProject[]>([]);

  useEffect(() => {
    api.get<DashboardProject[]>("/api/projects").then((res) => setProjects(res.data)).catch(() => {});
  }, []);

  const stageCounts = GATE_STAGES.map((stage) => ({
    stage,
    label: GATE_LABELS[stage],
    count: projects.filter((p) => p.gate_stage === stage).length,
  }));

  const ragCounts = {
    green: projects.filter((p) => p.rag_overall === "green").length,
    amber: projects.filter((p) => p.rag_overall === "amber").length,
    red: projects.filter((p) => p.rag_overall === "red").length,
    unassessed: projects.filter((p) => !p.rag_overall).length,
  };

  const gateChartOption = {
    tooltip: { trigger: "axis" as const },
    xAxis: {
      type: "category" as const,
      data: stageCounts.map((s) => s.label),
      axisLabel: { color: "#9aa1ad", fontSize: 11 },
      axisLine: { lineStyle: { color: "#2b303b" } },
    },
    yAxis: {
      type: "value" as const,
      minInterval: 1,
      axisLabel: { color: "#9aa1ad" },
      splitLine: { lineStyle: { color: "#2b303b" } },
    },
    series: [
      {
        type: "bar" as const,
        data: stageCounts.map((s) => s.count),
        itemStyle: {
          color: "#7c9dff",
          borderRadius: [4, 4, 0, 0],
        },
        barMaxWidth: 40,
      },
    ],
    grid: { left: 40, right: 20, top: 20, bottom: 40 },
  };

  const ragPieOption = {
    tooltip: { trigger: "item" as const },
    legend: {
      bottom: 0,
      textStyle: { color: "#9aa1ad", fontSize: 12 },
    },
    series: [
      {
        type: "pie" as const,
        radius: ["40%", "70%"],
        center: ["50%", "45%"],
        avoidLabelOverlap: false,
        label: { show: false },
        data: [
          { value: ragCounts.green, name: "\u25cf Green", itemStyle: { color: "#7fe0a0" } },
          { value: ragCounts.amber, name: "\u25b2 Amber", itemStyle: { color: "#ffcf7a" } },
          { value: ragCounts.red, name: "\u25a0 Red", itemStyle: { color: "#ff9d97" } },
          { value: ragCounts.unassessed, name: "\u25cb Unassessed", itemStyle: { color: "#3a4150" } },
        ],
      },
    ],
  };

  return (
    <main className="dashboard-page">
      <h1 className="text-2xl font-bold mb-6">대시보드</h1>

      {/* KPI Cards */}
      <div className="summary-cards">
        <div className="summary-card glass">
          <span className="summary-value mono-num">{projects.length}</span>
          <span className="text-label">전체 프로젝트</span>
        </div>
        <div className="summary-card glass" style={{ borderColor: "var(--green-border)" }}>
          <span className="summary-value mono-num" style={{ color: "var(--green-fg)" }}>{ragCounts.green}</span>
          <span className="text-label">Green</span>
        </div>
        <div className="summary-card glass" style={{ borderColor: "var(--amber-border)" }}>
          <span className="summary-value mono-num" style={{ color: "var(--amber-fg)" }}>{ragCounts.amber}</span>
          <span className="text-label">Amber</span>
        </div>
        <div className="summary-card glass" style={{ borderColor: "var(--red-border)" }}>
          <span className="summary-value mono-num" style={{ color: "var(--red-fg)" }}>{ragCounts.red}</span>
          <span className="text-label">Red</span>
        </div>
      </div>

      {/* Charts Row */}
      <div className="charts-row">
        <section className="chart-card glass">
          <h3 className="text-label mb-2">게이트별 프로젝트 분포</h3>
          <EChartsCore option={gateChartOption} style={{ height: 280 }} />
        </section>
        <section className="chart-card glass">
          <h3 className="text-label mb-2">RAG 등급 분포</h3>
          <EChartsCore option={ragPieOption} style={{ height: 280 }} />
        </section>
      </div>

      {/* Recent Projects */}
      <section className="glass p-4 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-label">최근 프로젝트</h3>
          <Link href="/projects" className="text-sm text-[color:var(--primary)] hover:underline">전체 보기</Link>
        </div>
        {projects.length === 0 ? (
          <p className="text-[color:var(--muted-fg)]">프로젝트가 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {projects.slice(0, 5).map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="flex items-center gap-3 p-2 rounded hover:bg-[rgba(255,255,255,0.04)] transition-colors">
                  <span className="font-semibold">{p.project_no}</span>
                  {p.rag_overall && <GradeBadge grade={p.rag_overall} />}
                  {p.is_stale && (
                    <span className="grade-badge grade-amber">
                      <span aria-hidden="true">&#x25b2;</span> 갱신 필요
                    </span>
                  )}
                  <span className="ml-auto text-sm text-[color:var(--muted-fg)]">{p.gate_stage ? GATE_LABELS[p.gate_stage] ?? p.gate_stage : "미정"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
