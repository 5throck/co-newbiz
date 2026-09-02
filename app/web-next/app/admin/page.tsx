"use client";

// 시스템 대시보드 — 관리 그룹 첫 화면 (ADR-0091). 감사 추이·기회 퍼널·역할 분포 그래프 + KPI.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { api } from "../../lib/api.ts";
import { useChartTheme } from "../../lib/echarts-theme.ts";
import { SectionToolbar } from "../../components/layout.tsx";

const EChartsCore = dynamic(() => import("echarts-for-react"), { ssr: false });

interface SystemStats {
  auditDaily: Array<{ day: string; count: number }>;
  usersByRole: Array<{ role: string; count: number }>;
  usersByStatus: Array<{ status: string; count: number }>;
  tokens: { active: number; revoked: number };
  jobRuns: Array<{ job_key: string; success: number; failed: number }>;
  opportunityFunnel: Array<{ status: string; count: number }>;
}

const FUNNEL_LABEL: Record<string, string> = { identified: "발굴", assessed: "평가", selected: "선별", dropped: "제외" };

export default function AdminDashboardPage() {
  const ct = useChartTheme();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<SystemStats>("/api/admin/system-stats")
      .then((r) => setStats(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "통계 조회 실패"));
  }, []);

  return (
    <main className="admin-console-page">
      <h1>시스템 대시보드</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[0.9rem]">시스템 운영 현황 요약 — 감사 로그·사용자·스케줄·기오퍼널 지표입니다.</p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      {!stats && !error && <p>불러오는 중...</p>}
      {stats && (
        <>
          <div className="summary-cards mb-4">
            <div className="summary-card glass"><span className="summary-value mono-num">{stats.usersByRole.reduce((a, b) => a + b.count, 0)}</span><span className="text-label">사용자</span></div>
            <div className="summary-card glass"><span className="summary-value mono-num">{stats.tokens.active}</span><span className="text-label">활성 API 토큰</span></div>
            <div className="summary-card glass"><span className="summary-value mono-num">{stats.jobRuns.reduce((a, b) => a + b.success + b.failed, 0)}</span><span className="text-label">스케줄 실행 누계</span></div>
            <div className="summary-card glass" style={{ borderColor: "var(--green-border)" }}><span className="summary-value mono-num">{stats.opportunityFunnel.reduce((a, b) => a + b.count, 0)}</span><span className="text-label">기회 총수</span></div>
          </div>
          <div className="charts-row">
            <section className="chart-card glass">
              <h3 className="text-label mb-2">감사 로그 추이 (30일)</h3>
              <EChartsCore option={{
                tooltip: { trigger: "axis" as const },
                grid: { left: 40, right: 16, top: 16, bottom: 32 },
                xAxis: { type: "category" as const, data: stats.auditDaily.map((d) => d.day.slice(5)), axisLabel: { color: ct.muted, fontSize: 11 } },
                yAxis: { type: "value" as const, minInterval: 1, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
                series: [{ type: "line" as const, data: stats.auditDaily.map((d) => d.count), itemStyle: { color: ct.color[0] }, areaStyle: { opacity: 0.15 }, smooth: true }],
              }} style={{ height: 260 }} />
            </section>
            <section className="chart-card glass">
              <h3 className="text-label mb-2">사용자 역할 분포</h3>
              <EChartsCore option={{
                tooltip: { trigger: "item" as const },
                series: [{ type: "pie" as const, radius: ["45%", "70%"], data: stats.usersByRole.map((r, i) => ({ name: r.role, value: r.count, itemStyle: { color: ct.color[i % ct.color.length] } })) }],
              }} style={{ height: 260 }} />
            </section>
          </div>
          <div className="charts-row">
            <section className="chart-card glass">
              <h3 className="text-label mb-2">기회 퍼널 분포</h3>
              <EChartsCore option={{
                tooltip: { trigger: "axis" as const },
                grid: { left: 40, right: 16, top: 16, bottom: 32 },
                xAxis: { type: "category" as const, data: stats.opportunityFunnel.map((f) => FUNNEL_LABEL[f.status] ?? f.status), axisLabel: { color: ct.muted, fontSize: 11 } },
                yAxis: { type: "value" as const, minInterval: 1, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
                series: [{ type: "bar" as const, data: stats.opportunityFunnel.map((f) => f.count), itemStyle: { color: ct.color[1], borderRadius: [4, 4, 0, 0] }, barMaxWidth: 40 }],
              }} style={{ height: 260 }} />
            </section>
            <section className="chart-card glass">
              <h3 className="text-label mb-2">스케줄 실행 결과</h3>
              <EChartsCore option={{
                tooltip: { trigger: "axis" as const },
                legend: { top: 0, textStyle: { color: ct.muted, fontSize: 11 } },
                grid: { left: 40, right: 16, top: 32, bottom: 48 },
                xAxis: { type: "category" as const, data: stats.jobRuns.map((j) => j.job_key), axisLabel: { color: ct.muted, fontSize: 10, rotate: 30 } },
                yAxis: { type: "value" as const, minInterval: 1, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
                series: [
                  { name: "성공", type: "bar" as const, data: stats.jobRuns.map((j) => j.success), itemStyle: { color: ct.color[1] } },
                  { name: "실패", type: "bar" as const, data: stats.jobRuns.map((j) => j.failed), itemStyle: { color: ct.color[3] } },
                ],
              }} style={{ height: 260 }} />
            </section>
          </div>
        </>
      )}
    </main>
  );
}
