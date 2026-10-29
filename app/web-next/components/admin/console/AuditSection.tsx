"use client";

// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import { useLocale, useTranslations } from "next-intl";
import { SectionToolbar } from "../../layout.tsx";
import { api } from "../../../lib/api.ts";
import { EChartsCore } from "./constants.ts";
import type { AdminConsoleState } from "./useAdminActions.ts";
import { formatDateTime } from "../../../lib/format.ts";
import { Pager, useAdminLabel, usePaged } from "./admin-ui.tsx";

const AUDIT_PAGE_SIZE = 20;

export function AuditPanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.audit");
  const tc = useTranslations("common");
  const locale = useLocale();
  const label = useAdminLabel();
  const paged = usePaged(ctx.auditLog ?? [], AUDIT_PAGE_SIZE);
  const { section, error, auditStats, ct, auditLog, auditFilters, setAuditFilters, setAuditLog, setShowAuditTable, setError, showAuditTable } = ctx;
  return (
    <>{section === "audit" && (
        <div>
          {error && <p role="alert" className="text-[color:var(--red-fg)] mb-2">{error}</p>}
          {!auditStats && !error && <p>{tc("loading")}</p>}
          {auditStats && (
            <>
              <div className="summary-cards mb-4">
                <div className="summary-card glass"><span className="summary-value mono-num">{auditStats.total.toLocaleString()}</span><span className="text-label">{t("totalRecords")}</span></div>
                <div className="summary-card glass"><span className="summary-value mono-num">{auditStats.byAction[0]?.count ?? 0}</span><span className="text-label">{t("topAction")}</span><span className="normal-case text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{label("action", auditStats.byAction[0]?.action)}</span></div>
                <div className="summary-card glass"><span className="summary-value mono-num">{auditStats.byActor[0]?.count ?? 0}</span><span className="text-label">{t("topActor")}</span><span className="normal-case text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{auditStats.byActor[0]?.actor ?? "—"}</span></div>
                <div className="summary-card glass"><span className="summary-value mono-num">{auditStats.daily.reduce((a, b) => a + b.count, 0)}</span><span className="text-label">{t("last30Days")}</span></div>
              </div>
              <div className="charts-row">
                <section className="chart-card glass">
                  <h2 className="text-label mb-2">{t("dailyChartHeading")}</h2>
                  <EChartsCore option={{
                    tooltip: { trigger: "axis" as const },
                    grid: { left: 40, right: 16, top: 16, bottom: 32 },
                    xAxis: { type: "category" as const, data: auditStats.daily.map((d) => d.day.slice(5)), axisLabel: { color: ct.muted, fontSize: 10 } },
                    yAxis: { type: "value" as const, minInterval: 1, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
                    series: [{ type: "line" as const, data: auditStats.daily.map((d) => d.count), itemStyle: { color: ct.color[0] }, areaStyle: { opacity: 0.15 }, smooth: true }],
                  }} style={{ height: 240 }} />
                </section>
                <section className="chart-card glass">
                  <h2 className="text-label mb-2">{t("topActionsHeading")}</h2>
                  <EChartsCore option={{
                    tooltip: { trigger: "axis" as const },
                    grid: { left: 160, right: 16, top: 16, bottom: 24 },
                    xAxis: { type: "value" as const, minInterval: 1, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
                    yAxis: { type: "category" as const, data: [...auditStats.byAction].reverse().map((a) => label("action", a.action)), axisLabel: { color: ct.muted, fontSize: 11, width: 150, overflow: "truncate" as const } },
                    series: [{ type: "bar" as const, data: [...auditStats.byAction].reverse().map((a) => a.count), itemStyle: { color: ct.color[1] }, barMaxWidth: 14 }],
                  }} style={{ height: 240 }} />
                </section>
              </div>
              <SectionToolbar
                title={t("logToolbarTitle")}
                icon="📜"
                count={auditLog?.length}
                filters={
                  <>
                    <input aria-label={t("actorFilterAria")} placeholder={t("actorFilterPlaceholder")} value={auditFilters.actor} onChange={(e) => setAuditFilters((f) => ({ ...f, actor: e.target.value }))} className="sizing-new-input sizing-new-input-sm" style={{ width: "10rem" }} />
                    <input aria-label={t("actionFilterAria")} placeholder={t("actionFilterPlaceholder")} value={auditFilters.action} onChange={(e) => setAuditFilters((f) => ({ ...f, action: e.target.value }))} className="sizing-new-input sizing-new-input-sm" style={{ width: "10rem" }} />
                  </>
                }
                actions={
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      const qs = new URLSearchParams({ limit: "200" });
                      if (auditFilters.actor) qs.set("actor", auditFilters.actor);
                      if (auditFilters.action) qs.set("action", auditFilters.action);
                      api.get<{ id: string; actor_user_id: string; action: string; target: string; created_at: string }[]>(`/api/admin/audit-log?${qs}`)
                        .then((r) => { setAuditLog(r.data); setShowAuditTable(true); })
                        .catch((e) => setError(e instanceof Error ? e.message : t("queryFailed")));
                    }}
                  >
                    {t("queryButton")}
                  </button>
                }
              />
              {showAuditTable && (auditLog === null ? (
                <p>{tc("loading")}</p>
              ) : auditLog.length === 0 ? (
                <p className="text-[color:var(--muted-fg)] italic">{t("emptyLog")}</p>
              ) : (
                <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
                <table className="data-table report-table" aria-label={t("logTableAria")}>
                  <caption className="sr-only">{t("logCaption")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("colTime")}</th>
                      <th scope="col">{t("colActor")}</th>
                      <th scope="col">{t("colAction")}</th>
                      <th scope="col">{t("colTarget")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.slice.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDateTime(row.created_at, locale)}</td>
                        <td>{row.actor_user_id}</td>
                        <td>{label("action", row.action)}</td>
                        <td>{row.target}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              ))}
              {showAuditTable && auditLog && auditLog.length > 0 && (
                <Pager page={paged.page} pages={paged.pages} total={paged.total} onPage={paged.setPage} ariaLabel={t("pageAria")} />
              )}
            </>
          )}
        </div>
      )}</>
  );
}
