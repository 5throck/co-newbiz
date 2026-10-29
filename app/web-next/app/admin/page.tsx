"use client";

// 시스템 대시보드 — 관리 그룹 첫 화면 (ADR-0091). 감사 추이·기회 퍼널·역할 분포 그래프 + KPI.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { api } from "../../lib/api.ts";
import { useChartTheme } from "../../lib/echarts-theme.ts";
import { useAdminLabel } from "../../components/admin/console/admin-ui.tsx";
import { PageHeader } from "../../components/layout.tsx";

const EChartsCore = dynamic(() => import("echarts-for-react"), { ssr: false });

interface SystemStats {
  auditDaily: Array<{ day: string; count: number }>;
  usersByRole: Array<{ role: string; count: number }>;
  usersByStatus: Array<{ status: string; count: number }>;
  tokens: { active: number; revoked: number };
  jobRuns: Array<{ job_key: string; success: number; failed: number }>;
  opportunityFunnel: Array<{ status: string; count: number }>;
}

// Funnel statuses resolve through admin.dashboard.funnel.* keys; an unknown
// status falls back to the raw value.
const FUNNEL_KEY: Record<string, string> = {
  identified: "funnel.identified",
  assessed: "funnel.assessed",
  selected: "funnel.selected",
  dropped: "funnel.dropped",
};

export default function AdminDashboardPage() {
  const t = useTranslations("admin.dashboard");
  const tc = useTranslations("common");
  const ct = useChartTheme();
  const label = useAdminLabel();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<SystemStats>("/api/admin/system-stats")
      .then((r) => setStats(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : t("errors.statsLoadFailed")));
  }, [t]);

  return (
    <main className="admin-console-page">
      <PageHeader title={t("title")} description={t("subtitle")} />
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      {!stats && !error && <p>{tc("loading")}</p>}
      {stats && (
        <>
          <div className="summary-cards mb-4">
            <div className="summary-card glass"><span className="summary-value mono-num">{stats.usersByRole.reduce((a, b) => a + b.count, 0)}</span><span className="text-label">{t("stats.users")}</span></div>
            <div className="summary-card glass"><span className="summary-value mono-num">{stats.tokens.active}</span><span className="text-label">{t("stats.activeApiTokens")}</span></div>
            <div className="summary-card glass"><span className="summary-value mono-num">{stats.jobRuns.reduce((a, b) => a + b.success + b.failed, 0)}</span><span className="text-label">{t("stats.scheduleRunTotal")}</span></div>
            <div className="summary-card glass" style={{ borderColor: "var(--green-border)" }}><span className="summary-value mono-num">{stats.opportunityFunnel.reduce((a, b) => a + b.count, 0)}</span><span className="text-label">{t("stats.totalOpportunities")}</span></div>
          </div>
          <div className="charts-row">
            <section className="chart-card glass">
              <h2 className="text-label mb-2">{t("charts.auditTrend")}</h2>
              <EChartsCore option={{
                tooltip: { trigger: "axis" as const },
                grid: { left: 40, right: 16, top: 16, bottom: 32 },
                xAxis: { type: "category" as const, data: stats.auditDaily.map((d) => d.day.slice(5)), axisLabel: { color: ct.muted, fontSize: 11 } },
                yAxis: { type: "value" as const, minInterval: 1, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
                series: [{ type: "line" as const, data: stats.auditDaily.map((d) => d.count), itemStyle: { color: ct.color[0] }, areaStyle: { opacity: 0.15 }, smooth: true }],
              }} style={{ height: 260 }} />
            </section>
            <section className="chart-card glass">
              <h2 className="text-label mb-2">{t("charts.roleDistribution")}</h2>
              {/* Labels stay off the ring (they skewed and overlapped at this size); names and counts live in the legend + tooltip. */}
              <EChartsCore option={{
                tooltip: { trigger: "item" as const, formatter: (p: { name: string; value: number; percent: number }) => `${p.name}: ${p.value} (${p.percent}%)` },
                legend: {
                  bottom: 0,
                  icon: "circle",
                  textStyle: { color: ct.muted, fontSize: 12 },
                  formatter: (name: string) => {
                    const row = stats.usersByRole.find((r) => label("role", r.role) === name);
                    return row ? t("charts.roleCount", { name, value: row.count }) : name;
                  },
                },
                series: [{
                  type: "pie" as const,
                  radius: ["42%", "66%"],
                  center: ["50%", "42%"],
                  avoidLabelOverlap: true,
                  label: { show: false },
                  labelLine: { show: false },
                  itemStyle: { borderColor: ct.tooltipBg, borderWidth: 2 },
                  data: stats.usersByRole.map((r, i) => ({ name: label("role", r.role), value: r.count, itemStyle: { color: ct.color[i % ct.color.length] } })),
                }],
              }} style={{ height: 260 }} />
            </section>
          </div>
          <div className="charts-row">
            <section className="chart-card glass">
              <h2 className="text-label mb-2">{t("charts.opportunityFunnel")}</h2>
              <EChartsCore option={{
                tooltip: { trigger: "axis" as const },
                grid: { left: 40, right: 16, top: 16, bottom: 32 },
                xAxis: { type: "category" as const, data: stats.opportunityFunnel.map((f) => (FUNNEL_KEY[f.status] ? t(FUNNEL_KEY[f.status]) : f.status)), axisLabel: { color: ct.muted, fontSize: 11 } },
                yAxis: { type: "value" as const, minInterval: 1, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
                series: [{ type: "bar" as const, data: stats.opportunityFunnel.map((f) => f.count), itemStyle: { color: ct.color[1], borderRadius: [4, 4, 0, 0] }, barMaxWidth: 40 }],
              }} style={{ height: 260 }} />
            </section>
            <section className="chart-card glass">
              <h2 className="text-label mb-2">{t("charts.scheduleResults")}</h2>
              {stats.jobRuns.length === 0 || stats.jobRuns.every((j) => j.success + j.failed === 0) ? (
                <p role="status" className="text-[color:var(--muted-fg)] italic" style={{ minHeight: 260 }}>{t("charts.emptyScheduleResults")}</p>
              ) : (
              <EChartsCore option={{
                tooltip: { trigger: "axis" as const },
                legend: { top: 0, textStyle: { color: ct.muted, fontSize: 11 } },
                grid: { left: 40, right: 16, top: 32, bottom: 48 },
                xAxis: { type: "category" as const, data: stats.jobRuns.map((j) => j.job_key), axisLabel: { color: ct.muted, fontSize: 10, rotate: 30 } },
                yAxis: { type: "value" as const, minInterval: 1, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
                series: [
                  { name: t("series.success"), type: "bar" as const, data: stats.jobRuns.map((j) => j.success), itemStyle: { color: ct.color[1] } },
                  { name: t("series.failure"), type: "bar" as const, data: stats.jobRuns.map((j) => j.failed), itemStyle: { color: ct.color[3] } },
                ],
              }} style={{ height: 260 }} />
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
