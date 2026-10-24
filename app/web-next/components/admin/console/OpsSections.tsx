"use client";

// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import { useLocale, useTranslations } from "next-intl";
import type { AdminConsoleState } from "./useAdminActions.ts";
import { ColGroup } from "../../ui.tsx";
import { formatDateTime } from "../../../lib/format.ts";

// 알림 목록 7열 — 프로젝트·트리거·발송일이 긴 텍스트라 고정 비율 유지.
const NOTIFICATIONS_COL_PCT = [22, 16, 10, 10, 10, 20, 12] as const;

export function DataSourcesPanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.ops");
  const tc = useTranslations("common");
  const { section, sources } = ctx;
  return (
    <>{section === "data-sources" &&
        (sources === null ? (
          <p>{tc("loading")}</p>
        ) : (
          <table className="data-table">
            <caption className="sr-only">{t("dsCaption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("colSource")}</th>
                <th scope="col">{t("colReliability")}</th>
                <th scope="col">{t("colEnvVar")}</th>
                <th scope="col">{t("colKeyPresent")}</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.code}>
                  <td>{s.code}</td>
                  <td>{s.reliability_grade}</td>
                  <td>
                    <code>{s.key_var}</code>
                  </td>
                  <td>{s.key_present ? t("keySet") : t("keyUnset")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}</>
  );
}

export function SchedulePanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.ops");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { section, jobs, toggleJob } = ctx;
  return (
    <>{section === "schedule" &&
        (jobs === null ? (
          <p>{tc("loading")}</p>
        ) : jobs.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">{t("emptyJobs")}</p>
        ) : (
          <table className="data-table">
            <caption className="sr-only">{t("jobsCaption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("colJobKey")}</th>
                <th scope="col">{t("colCron")}</th>
                <th scope="col">{tc("status")}</th>
                <th scope="col">{t("colLastRun")}</th>
                <th scope="col"><span className="sr-only">{tc("actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>{j.job_key}</td>
                  <td>
                    <code>{j.cron_expr}</code>
                  </td>
                  <td>
                    {j.enabled === 1 ? (
                      <span className="inline-flex items-center gap-[0.3rem] px-[0.55rem] py-[0.15rem] rounded-full text-[length:var(--fs-caption)] bg-[color:var(--green-bg)] text-[color:var(--green-fg)]">
                        <span aria-hidden="true">●</span> {t("active")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-[0.3rem] px-[0.55rem] py-[0.15rem] rounded-full text-[length:var(--fs-caption)] bg-[color:var(--muted-bg)] text-[color:var(--muted-fg)]">
                        <span aria-hidden="true">○</span> {t("inactive")}
                      </span>
                    )}
                  </td>
                  <td>
                    {j.last_run ? (
                      <>
                        {j.last_run.status}
                        {j.last_run.finished_at && ` · ${formatDateTime(j.last_run.finished_at, locale)}`}
                        {j.last_run.error && <p className="mt-[0.15rem] mb-0 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">{j.last_run.error}</p>}
                      </>
                    ) : (
                      t("noRunHistory")
                    )}
                  </td>
                  <td>
                    <button type="button" className="btn-ghost" onClick={() => toggleJob(j.job_key, j.enabled !== 1)}>
                      {j.enabled === 1 ? t("disable") : t("enable")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}</>
  );
}

export function DatabasePanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.ops");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { section, retention, tableKey, setTableKey, basis, setBasis, months, setMonths, action, setAction, retentionFormError, retentionNotice, saveRetention } = ctx;
  return (
    <>{section === "database" && (
        <div>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
            {t("migrationNote")}
          </p>
          <h2>{t("retentionHeading")}</h2>
          {retention === null ? (
            <p>{tc("loading")}</p>
          ) : retention.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic">{t("emptyRetention")}</p>
          ) : (
            <table className="data-table">
              <caption className="sr-only">{t("retentionCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("colTableKey")}</th>
                  <th scope="col">{t("colBasis")}</th>
                  <th scope="col">{t("colRetentionMonths")}</th>
                  <th scope="col">{t("colAction")}</th>
                  <th scope="col">{t("colLastApplied")}</th>
                </tr>
              </thead>
              <tbody>
                {retention.map((r) => (
                  <tr key={r.table_key}>
                    <td>{r.table_key}</td>
                    <td>{r.basis}</td>
                    <td>{r.retention_months}</td>
                    <td>{r.action === "archive" ? t("actionArchive") : tc("delete")}</td>
                    <td>{r.last_run_at ? formatDateTime(r.last_run_at, locale) : t("neverRun")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2>{t("formHeading")}</h2>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
            {t("upsertNote")}
          </p>
          <form onSubmit={saveRetention} className="run-form">
            <div className="run-form-row">
              <label htmlFor="retTableKey">{t("colTableKey")}</label>
              <input id="retTableKey" value={tableKey} onChange={(e) => setTableKey(e.target.value)} required />
            </div>
            <div className="run-form-row">
              <label htmlFor="retBasis">{t("colBasis")}</label>
              <input id="retBasis" value={basis} onChange={(e) => setBasis(e.target.value)} required />
            </div>
            <div className="run-form-row">
              <label htmlFor="retMonths">{t("colRetentionMonths")}</label>
              <input
                id="retMonths"
                inputMode="numeric"
                value={months}
                onChange={(e) => setMonths(e.target.value)}
                required
              />
            </div>
            <div className="run-form-row">
              <label htmlFor="retAction">{t("colAction")}</label>
              <select id="retAction" value={action} onChange={(e) => setAction(e.target.value === "delete" ? "delete" : "archive")}>
                <option value="archive">{t("optionArchive")}</option>
                <option value="delete">{t("optionDelete")}</option>
              </select>
            </div>
            <button type="submit" className="btn-ghost">{t("saveButton")}</button>
          </form>
          {retentionFormError && (
            <p role="alert" className="text-[color:var(--red-fg)]">
              {retentionFormError}
            </p>
          )}
          {retentionNotice && <p className="text-[color:var(--green-fg)]">{retentionNotice}</p>}
        </div>
      )}</>
  );
}

export function NotificationsPanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.ops");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { section, notifications } = ctx;
  return (
    <>{section === "notifications" &&
        (notifications === null ? (
          <p>{tc("loading")}</p>
        ) : notifications.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">{t("emptyNotifications")}</p>
        ) : (
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
<table className="data-table report-table table-fixed-pct tmin-48">
            <caption className="sr-only">{t("notificationsCaption")}</caption>
            <ColGroup widths={NOTIFICATIONS_COL_PCT} />            <thead>
              <tr>
                <th scope="col">{t("colProject")}</th>
                <th scope="col">{t("colTrigger")}</th>
                <th scope="col">{t("colSeverity")}</th>
                <th scope="col">{t("colChannel")}</th>
                <th scope="col">{t("colBundle")}</th>
                <th scope="col">{t("colSentAt")}</th>
                <th scope="col">{t("colRead")}</th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((n) => (
                <tr key={n.id}>
                  <td>{n.project_id ?? "—"}</td>
                  <td>{n.trigger_type}</td>
                  <td>{n.severity}</td>
                  <td>{n.channel}</td>
                  <td>{n.bundle}</td>
                  <td>{formatDateTime(n.sent_at, locale)}</td>
                  <td>{n.read_at ? <span className="status-chip status-green">{t("read")}</span> : <span className="status-chip status-amber">{t("unread")}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
</div>
        ))}</>
  );
}
