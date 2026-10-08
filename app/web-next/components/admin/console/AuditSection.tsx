"use client";

// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import { SectionToolbar } from "../../layout.tsx";
import { api } from "../../../lib/api.ts";
import { EChartsCore } from "./constants.ts";
import type { AdminConsoleState } from "./useAdminActions.ts";

export function AuditPanel({ ctx }: { ctx: AdminConsoleState }) {
  const { section, error, auditStats, ct, auditLog, auditFilters, setAuditFilters, setAuditLog, setShowAuditTable, setError, showAuditTable } = ctx;
  return (
    <>{section === "audit" && (
        <div>
          {error && <p role="alert" className="text-[color:var(--red-fg)] mb-2">{error}</p>}
          {!auditStats && !error && <p>불러오는 중...</p>}
          {auditStats && (
            <>
              <div className="summary-cards mb-4">
                <div className="summary-card glass"><span className="summary-value mono-num">{auditStats.total.toLocaleString()}</span><span className="text-label">전체 감사 기록</span></div>
                <div className="summary-card glass"><span className="summary-value mono-num">{auditStats.byAction[0]?.count ?? 0}</span><span className="text-label">최다 액션 ({auditStats.byAction[0]?.action ?? "—"})</span></div>
                <div className="summary-card glass"><span className="summary-value mono-num">{auditStats.byActor[0]?.count ?? 0}</span><span className="text-label">최다 행위자 ({auditStats.byActor[0]?.actor ?? "—"})</span></div>
                <div className="summary-card glass"><span className="summary-value mono-num">{auditStats.daily.reduce((a, b) => a + b.count, 0)}</span><span className="text-label">최근 30일</span></div>
              </div>
              <div className="charts-row">
                <section className="chart-card glass">
                  <h3 className="text-label mb-2">일별 감사 기록 (30일)</h3>
                  <EChartsCore option={{
                    tooltip: { trigger: "axis" as const },
                    grid: { left: 40, right: 16, top: 16, bottom: 32 },
                    xAxis: { type: "category" as const, data: auditStats.daily.map((d) => d.day.slice(5)), axisLabel: { color: ct.muted, fontSize: 10 } },
                    yAxis: { type: "value" as const, minInterval: 1, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
                    series: [{ type: "line" as const, data: auditStats.daily.map((d) => d.count), itemStyle: { color: ct.color[0] }, areaStyle: { opacity: 0.15 }, smooth: true }],
                  }} style={{ height: 240 }} />
                </section>
                <section className="chart-card glass">
                  <h3 className="text-label mb-2">주요 액션 Top 10</h3>
                  <EChartsCore option={{
                    tooltip: { trigger: "axis" as const },
                    grid: { left: 120, right: 16, top: 16, bottom: 24 },
                    xAxis: { type: "value" as const, minInterval: 1, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
                    yAxis: { type: "category" as const, data: [...auditStats.byAction].reverse().map((a) => a.action), axisLabel: { color: ct.muted, fontSize: 10 } },
                    series: [{ type: "bar" as const, data: [...auditStats.byAction].reverse().map((a) => a.count), itemStyle: { color: ct.color[1] }, barMaxWidth: 14 }],
                  }} style={{ height: 240 }} />
                </section>
              </div>
              <SectionToolbar
                title="감사 로그 조회"
                icon="📜"
                count={auditLog?.length}
                filters={
                  <>
                    <input aria-label="행위자 필터" placeholder="행위자(user_id)" value={auditFilters.actor} onChange={(e) => setAuditFilters((f) => ({ ...f, actor: e.target.value }))} className="sizing-new-input sizing-new-input-sm" style={{ width: "10rem" }} />
                    <input aria-label="액션 필터" placeholder="액션 접두 (예: synergy)" value={auditFilters.action} onChange={(e) => setAuditFilters((f) => ({ ...f, action: e.target.value }))} className="sizing-new-input sizing-new-input-sm" style={{ width: "10rem" }} />
                  </>
                }
                actions={
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      const qs = new URLSearchParams({ limit: "200" });
                      if (auditFilters.actor) qs.set("actor", auditFilters.actor);
                      if (auditFilters.action) qs.set("action", auditFilters.action);
                      api.get<{ id: string; actor_user_id: string; action: string; target: string; created_at: string }[]>(`/api/admin/audit-log?${qs}`)
                        .then((r) => { setAuditLog(r.data); setShowAuditTable(true); })
                        .catch((e) => setError(e instanceof Error ? e.message : "로그 조회 실패"));
                    }}
                  >
                    로그 조회
                  </button>
                }
              />
              {showAuditTable && (auditLog === null ? (
                <p>불러오는 중...</p>
              ) : auditLog.length === 0 ? (
                <p className="text-[color:var(--muted-fg)] italic">조건에 맞는 감사 기록이 없습니다.</p>
              ) : (
                <div className="table-scroll">
                <table className="data-table report-table" aria-label="감사 로그">
                  <caption className="sr-only">감사 로그 (append-only — 삭제 기능 없음)</caption>
                  <thead>
                    <tr>
                      <th scope="col">시각</th>
                      <th scope="col">행위자</th>
                      <th scope="col">동작</th>
                      <th scope="col">대상</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map((row) => (
                      <tr key={row.id}>
                        <td>{new Date(row.created_at).toLocaleString("ko-KR")}</td>
                        <td>{row.actor_user_id}</td>
                        <td>{row.action}</td>
                        <td>{row.target}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              ))}
            </>
          )}
        </div>
      )}</>
  );
}
