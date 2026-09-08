"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { api } from "../lib/api.ts";
import { useChartTheme } from "../lib/echarts-theme.ts";
import { PipelineStatus } from "../components/PipelineStatus.tsx";
import { PageHeader } from "../components/layout.tsx";

const EChartsCore = dynamic(() => import("echarts-for-react"), { ssr: false });

interface OpportunityRow {
  id: string; name: string; status: string; market_scope: string | null;
  attractiveness_score: number | null; synergy_score: number | null; created_at: string;
}
interface ProjectRow {
  projectId: string; projectNo: string; track: string | null;
  currentStage: string | null; gates: Record<string, string>; blockers: string[];
}
interface GateAlert { projectId: string; gate: string; decision: string }
interface DashboardData {
  funnel: Array<{ status: string; count: number }>;
  opportunities: OpportunityRow[];
  projects: ProjectRow[];
  gateAlerts: GateAlert[];
  stageDistribution: Record<string, number>;
}

const STATUS_LABELS: Record<string, string> = { identified: "발굴", assessed: "평가", selected: "선별", dropped: "제외" };
const GATE_LABELS: Record<string, string> = { screening: "Screening", pre_fs: "Pre-FS", target_screening: "Target Screening", fs: "FS", dd: "DD", entity_ic: "Entity IC", group_ic: "Group IC" };
const GATE_CLASS: Record<string, string> = { go: "status-green", hold: "status-amber", kill: "status-red" };
const STAGE_ORDER = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12"];

export default function DashboardPage() {
  const ct = useChartTheme();
  const [opps, setOpps] = useState<OpportunityRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [gateAlerts, setGateAlerts] = useState<GateAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api.get<OpportunityRow[]>("/api/opportunities").then((r) => setOpps(r.data)).catch(() => {});
    api.get<{ projects: ProjectRow[] }>("/api/portfolio/pipeline").then((r) => {
      setProjects(r.data.projects ?? []);
    }).catch(() => {});
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // 기회 상태별 카운트
  const statusOrder = ["identified", "assessed", "selected", "dropped"] as const;
  const statusCounts = statusOrder.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    count: opps.filter((o) => o.status === status).length,
  }));

  // 프로젝트 단계 분포 (S8~S12)
  const stageCounts = STAGE_ORDER.slice(7).map((s) => ({
    stage: s,
    count: projects.filter((p) => p.currentStage === s).length,
  }));

  // 게이트 상태 집계
  const gateSummary: Record<string, { go: number; hold: number; kill: number }> = {};
  for (const p of projects) {
    for (const [g, v] of Object.entries(p.gates)) {
      if (!gateSummary[g]) gateSummary[g] = { go: 0, hold: 0, kill: 0 };
      if (v === "go") gateSummary[g].go++;
      else if (v === "hold") gateSummary[g].hold++;
      else if (v === "kill") gateSummary[g].kill++;
    }
  }

  const holdCount = Object.values(gateSummary).reduce((s, g) => s + g.hold, 0);

  // 기회 퍼널 차트
  const funnelOption = {
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
        itemStyle: { color: ct.color[0], borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 40,
      },
    ],
    grid: { left: 40, right: 20, top: 20, bottom: 40 },
  };

  // 프로젝트 단계 분포 차트
  const stageChartOption = {
    tooltip: { trigger: "axis" as const },
    xAxis: {
      type: "category" as const,
      data: stageCounts.map((s) => s.stage),
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
        data: stageCounts.map((s) => s.count),
        itemStyle: { color: ct.color[1] ?? ct.color[0], borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 40,
      },
    ],
    grid: { left: 40, right: 20, top: 20, bottom: 40 },
  };

  return (
    <main className="dashboard-page">
      <PageHeader title="대시보드" />

      {/* KPI 카드 */}
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
          <span className="summary-value mono-num">{projects.length}</span>
          <span className="text-label">프로젝트</span>
        </div>
        <div className="summary-card glass" style={holdCount > 0 ? { borderColor: "var(--amber-fg)" } : undefined}>
          <span className="summary-value mono-num">{holdCount}</span>
          <span className="text-label">HOLD 게이트</span>
        </div>
      </div>

      {/* 차트 행: 기회 퍼널 + 프로젝트 단계 분포 */}
      <div className="charts-row mt-4">
        <section className="chart-card glass" aria-label="기회 퍼널 차트">
          <h3 className="text-label mb-2">기회 퍼널 (S1~S7)</h3>
          <EChartsCore option={funnelOption} style={{ height: 260 }} />
        </section>
        <section className="chart-card glass" aria-label="프로젝트 단계 분포">
          <h3 className="text-label mb-2">프로젝트 단계 분포 (S8~S12)</h3>
          <EChartsCore option={stageChartOption} style={{ height: 260 }} />
        </section>
      </div>

      {/* 게이트 상태 요약 */}
      {Object.keys(gateSummary).length > 0 && (
        <section className="glass p-4 mt-4" aria-label="게이트 상태 요약">
          <h3 className="text-label mb-2">게이트 상태 요약</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(gateSummary).map(([gate, counts]) => (
              <div key={gate} className="flex gap-1 items-center">
                <span className="text-[0.78rem] font-semibold mr-1">{GATE_LABELS[gate] ?? gate}</span>
                {(["go", "hold", "kill"] as const).map((s) =>
                  counts[s] > 0 ? (
                    <span key={s} className={`status-chip ${GATE_CLASS[s]}`}>
                      {s}: {counts[s]}
                    </span>
                  ) : null
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 최근 등록 기회 */}
      <section className="glass p-4 mt-6" aria-label="최근 등록 기회">
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
                <Link href="/opportunities" className="list-row-link flex items-center gap-3 p-2 rounded transition-colors">
                  <span className="font-semibold">{o.name}</span>
                  <span className="text-sm text-[color:var(--muted-fg)]">{STATUS_LABELS[o.status]}</span>
                  <PipelineStatus opportunityId={o.id} />
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
