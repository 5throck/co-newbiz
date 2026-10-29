"use client";

// Split from components/admin/AdminConsole.tsx (Wave U-3 decomposition); behavior unchanged.
import { useLocale, useTranslations } from "next-intl";
import type { AdminConsoleState } from "./useAdminActions.ts";
import { ColGroup } from "../../ui.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { useAdminLabel } from "./admin-ui.tsx";

// 알림 목록 7열 — 프로젝트·트리거·발송일이 긴 텍스트라 고정 비율 유지.
const NOTIFICATIONS_COL_PCT = [22, 16, 10, 10, 10, 20, 12] as const;

export function DataSourcesPanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.ops");
  const tc = useTranslations("common");
  const label = useAdminLabel();
  const { section, sources } = ctx;
  return (
    <>{section === "data-sources" &&
        (sources === null ? (
          <p>{tc("loading")}</p>
        ) : (
          <>
          <p className="text-[color:var(--muted-fg)]">{t("dsNote")}</p>
          <table className="data-table">
            <caption className="sr-only">{t("dsCaption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("colSource")}</th>
                <th scope="col" title={t("gradeNote")}>{t("colReliability")}</th>
                <th scope="col">{t("colEnvVar")}</th>
                <th scope="col">{t("colKeyPresent")}</th>
                <th scope="col">{t("colKeySource")}</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.code}>
                  <td>{label("source", s.code)}</td>
                  <td>{s.reliability_grade ?? t("keyNone")}</td>
                  <td>
                    <code>{s.key_var}</code>
                  </td>
                  <td>{s.key_present ? t("keySet") : t("keyUnset")}</td>
                  <td>{s.key_source === "root_env" ? t("keySourceRoot") : s.key_source === "process_env" ? t("keySourceProcess") : t("keyNone")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("gradeNote")}</p>
          </>
        ))}</>
  );
}

export function SchedulePanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.ops");
  const tc = useTranslations("common");
  const locale = useLocale();
  const label = useAdminLabel();
  const { section, jobs, toggleJob } = ctx;
  return (
    <>{section === "schedule" &&
        (jobs === null ? (
          <p>{tc("loading")}</p>
        ) : jobs.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">{t("emptyJobs")}</p>
        ) : (
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}><table className="data-table">
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
                        {label("jobStatus", j.last_run.status)}
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
          </table></div>
        ))}</>
  );
}

export function DatabasePanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.ops");
  const tc = useTranslations("common");
  const locale = useLocale();
  const lang: "ko" | "en" = locale === "en" ? "en" : "ko";
  const { section, retention, dbOverview, preview, tableKey, setTableKey, basis, setBasis, months, setMonths, action, setAction, retentionFormError, retentionNotice, saveRetention, removeRetentionPolicy } = ctx;
  const eligible = dbOverview?.tables ?? [];
  const selected = eligible.find((e) => e.table === tableKey) ?? null;
  const eligibleByKey = new Map(eligible.map((e) => [e.table, e]));
  const editingKey = retention?.some((r) => r.table_key === tableKey) ? tableKey : null;
  const columnLabel = (table: string, column: string) =>
    eligibleByKey.get(table)?.date_columns.find((c) => c.column === column)?.label[lang] ?? column;

  function pickTable(key: string) {
    setTableKey(key);
    const entry = eligibleByKey.get(key);
    setBasis(entry?.date_columns[0]?.column ?? "");
    setAction(entry?.actions.includes("archive") ? "archive" : "delete");
  }

  return (
    <>{section === "database" && (
        <div>
          <h2 className="mt-2 mb-2">{t("migrationHeading")}</h2>
          {dbOverview === null ? (
            <p>{tc("loading")}</p>
          ) : (
            <p className="mb-1 text-[length:var(--fs-body)]">
              {t("migrationSummary", { p1: dbOverview.migrations.applied_count })}
              {dbOverview.migrations.latest && ` · ${t("migrationLatest", { p1: dbOverview.migrations.latest.filename, p2: formatDateTime(dbOverview.migrations.latest.applied_at, locale) })}`}
            </p>
          )}
          <p className="mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">{t("backupNote")}</p>

          <h2 className="mt-6 mb-2">{t("overviewHeading")}</h2>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">{t("overviewNote")}</p>
          {dbOverview === null ? (
            <p>{tc("loading")}</p>
          ) : (
            <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}><table className="data-table list-table">
              <caption className="sr-only">{t("overviewCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("colDataTable")}</th>
                  <th scope="col">{t("colDescription")}</th>
                  <th scope="col">{t("colRows")}</th>
                  <th scope="col">{t("colOldest")}</th>
                  <th scope="col">{t("colCurrentPolicy")}</th>
                </tr>
              </thead>
              <tbody>
                {eligible.map((e) => {
                  const oldest = e.date_columns.map((c) => c.oldest).filter((d): d is string => !!d).sort()[0] ?? null;
                  return (
                    <tr key={e.table}>
                      <td>{e.label[lang]}<br /><span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{e.table}</span></td>
                      <td>{e.description[lang]}</td>
                      <td>{e.row_count.toLocaleString(locale)}</td>
                      <td>{oldest ? formatDateTime(oldest, locale) : "—"}</td>
                      <td>
                        {e.policy
                          ? t("policySummary", { p1: columnLabel(e.table, e.policy.basis), p2: e.policy.retention_months, p3: e.policy.action === "delete" ? tc("delete") : t("actionArchive") })
                          : t("noPolicy")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}

          <h2 className="mt-6 mb-2">{t("retentionHeading")}</h2>
          {retention === null ? (
            <p>{tc("loading")}</p>
          ) : retention.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic">{t("emptyRetention")}</p>
          ) : (
            <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}><table className="data-table list-table">
              <caption className="sr-only">{t("retentionCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("colTableKey")}</th>
                  <th scope="col">{t("colBasis")}</th>
                  <th scope="col">{t("colRetentionMonths")}</th>
                  <th scope="col">{t("colAction")}</th>
                  <th scope="col">{t("colLastApplied")}</th>
                  <th scope="col"><span className="sr-only">{tc("actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {retention.map((r) => {
                  const entry = eligibleByKey.get(r.table_key);
                  const name = entry ? entry.label[lang] : r.table_key;
                  return (
                    <tr key={r.table_key}>
                      <td>{name}{!entry && dbOverview && <><br /><span className="text-[color:var(--amber-fg)] text-[length:var(--fs-caption)]">{t("notEligibleBadge")}</span></>}</td>
                      <td>{entry ? columnLabel(r.table_key, r.basis) : r.basis}</td>
                      <td>{r.retention_months}</td>
                      <td>{r.action === "archive" ? t("actionArchive") : tc("delete")}</td>
                      <td>{r.last_run_at ? formatDateTime(r.last_run_at, locale) : t("neverRun")}</td>
                      <td className="sizing-actions-cell"><span className="actions-row">
                        {entry && (
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            aria-label={t("editRowAria", { p1: name })}
                            onClick={() => { setTableKey(r.table_key); setBasis(r.basis); setMonths(String(r.retention_months)); setAction(r.action === "delete" ? "delete" : "archive"); }}
                          >
                            {t("editRow")}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-danger btn-sm"
                          aria-label={t("removeRowAria", { p1: name })}
                          onClick={() => removeRetentionPolicy(r.table_key)}
                        >
                          {tc("delete")}
                        </button>
                      </span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}

          <h2 className="mt-6 mb-2">{t("formHeading")}</h2>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
            {t("upsertNote")}
          </p>
          <form onSubmit={saveRetention} className="run-form stack-form" aria-label={t("formHeading")}>
            <div className="stack-form-row">
              <label htmlFor="retTableKey">{t("colTableKey")}</label>
              <select id="retTableKey" value={tableKey} onChange={(e) => pickTable(e.target.value)} aria-describedby="retTableKeyHint" required>
                <option value="" disabled>{t("selectTablePlaceholder")}</option>
                {eligible.map((e) => <option key={e.table} value={e.table}>{e.label[lang]}</option>)}
              </select>
              <p id="retTableKeyHint" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{selected ? selected.description[lang] : t("hintTableKey")}</p>
            </div>
            <div className="stack-form-row">
              <label htmlFor="retBasis">{t("colBasis")}</label>
              <select id="retBasis" value={basis} onChange={(e) => setBasis(e.target.value)} aria-describedby="retBasisHint" disabled={!selected} required>
                {!selected && <option value="">{t("selectTableFirst")}</option>}
                {selected?.date_columns.map((c) => <option key={c.column} value={c.column}>{c.label[lang]}</option>)}
              </select>
              <p id="retBasisHint" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("hintBasis")}</p>
            </div>
            <div className="stack-form-row">
              <label htmlFor="retMonths">{t("colRetentionMonths")}</label>
              <input
                id="retMonths"
                inputMode="numeric"
                value={months}
                onChange={(e) => setMonths(e.target.value)}
                aria-describedby="retMonthsHint"
                required
              />
              <p id="retMonthsHint" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("hintMonths")}</p>
            </div>
            <div className="stack-form-row">
              <label htmlFor="retAction">{t("colAction")}</label>
              <select id="retAction" value={action} onChange={(e) => setAction(e.target.value === "delete" ? "delete" : "archive")} aria-describedby="retActionHint" disabled={!selected}>
                {(selected?.actions ?? ["archive", "delete"]).map((a) => (
                  <option key={a} value={a}>{a === "delete" ? t("optionDelete") : t("optionArchive")}</option>
                ))}
              </select>
              <p id="retActionHint" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("hintAction")}</p>
            </div>
            <p role="status" aria-live="polite" className="m-0 text-[length:var(--fs-body)]">
              {preview.state === "ready" && preview.count !== null && t("impactPreview", { p1: preview.count.toLocaleString(locale) })}
              {preview.state === "loading" && t("impactLoading")}
              {preview.state === "error" && t("impactError")}
              {preview.state === "idle" && <span className="text-[color:var(--muted-fg)]">{t("impactIdle")}</span>}
            </p>
            {editingKey && <p role="status" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("editingNotice", { p1: eligibleByKey.get(editingKey)?.label[lang] ?? editingKey })}</p>}
            <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("executionNote")}</p>
            <button type="submit" className="btn-primary">{t("saveButton")}</button>
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
  const label = useAdminLabel();
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
                  <td>{label("severity", n.severity)}</td>
                  <td>{label("channel", n.channel)}</td>
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
