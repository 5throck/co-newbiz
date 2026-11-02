"use client";

// /admin/schedule screen (design 2026-10-29-scheduled-jobs-design §4.2/§4.3): the §4.3
// list-and-edit subset plus the P7 remainder — the tick-health banner and per-job health
// chips (§4.2), the runs detail dialog with run-now, and job creation. The dialogs live in
// ScheduleCreateDialog.tsx / ScheduleRunsDialog.tsx / ScheduleJobEditDialog.tsx and the
// shared cron field in ScheduleCronField.tsx — the Wave U-3 400-line cap holds per file.
import cronstrue from "cronstrue/i18n";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { AdminConsoleState } from "./useAdminActions.ts";
import type { ScheduleJobRow } from "../../../lib/api.ts";
import { ColGroup } from "../../ui.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { ScheduleCreateDialog } from "./ScheduleCreateDialog.tsx";
import { ScheduleJobEditDialog, type JobEditState } from "./ScheduleJobEditDialog.tsx";
import {
  ScheduleHealthBanner,
  ScheduleJobHealthChips,
  useScheduleHealth,
  useScheduleHealthMap,
} from "./ScheduleHealth.tsx";
import { ScheduleRunsDialog } from "./ScheduleRunsDialog.tsx";
import { ListSearch, Pager, matchesQuery, useAdminLabel, usePaged } from "./admin-ui.tsx";

// 스케줄 작업 6열 — 작업(이름·키·설명 3줄)과 스케줄(미리보기+raw cron)이 긴 텍스트라 고정 비율 유지.
const SCHEDULE_COL_PCT = [24, 20, 10, 15, 21, 10] as const;
const SCHEDULE_PAGE_SIZE = 15;

export function SchedulePanel({ ctx }: { ctx: AdminConsoleState }) {
  const { section } = ctx;
  // Only the schedule section mounts the screen — the health poll (mount + every 60 s) is
  // section-scoped and must not run for the other admin sections.
  return <>{section === "schedule" ? <ScheduleScreen ctx={ctx} /> : null}</>;
}

// ── 스케줄 작업 패널 (design 2026-10-29-scheduled-jobs-design §4.3 list + §4.2 P7 remainder) ──
function ScheduleScreen({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.ops");
  const tc = useTranslations("common");
  const tl = useTranslations("admin.list");
  const locale = useLocale();
  const label = useAdminLabel();
  const { jobs, toggleJob, seedJobs, saveJob, createJob, setJobs } = ctx;
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState<JobEditState | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [runsJob, setRunsJob] = useState<ScheduleJobRow | null>(null);
  const health = useScheduleHealth(true);
  const healthMap = useScheduleHealthMap(health);

  const filtered = useMemo(
    () =>
      (jobs ?? []).filter((j) =>
        matchesQuery(
          query,
          j.job_key,
          j.display_name,
          j.description,
          label("jobName", j.job_key),
          label("jobDesc", j.job_key),
        ),
      ),
    [jobs, query, label],
  );
  const paged = usePaged(filtered, SCHEDULE_PAGE_SIZE);

  // §4.3 name resolution: catalog `jobName.<job_key>` first; the DB display_name
  // is the fallback for keys without a catalog entry (raw key is the last resort).
  const jobName = (j: ScheduleJobRow) => {
    const catalog = label("jobName", j.job_key);
    return catalog !== j.job_key ? catalog : (j.display_name ?? j.job_key);
  };
  // Same for the description line; a job with neither catalog nor DB text shows no line.
  const jobDesc = (j: ScheduleJobRow) => {
    const catalog = label("jobDesc", j.job_key);
    return catalog !== j.job_key ? catalog : (j.description ?? null);
  };
  // Human cron preview in the active locale (cronstrue is preview-only — the
  // shared parser in lib/schedule/cron.ts stays the execution authority), with
  // the raw expression kept visible in mono underneath.
  const cronPreview = (expr: string) => {
    try {
      return cronstrue.toString(expr, { locale: locale === "en" ? "en" : "ko" });
    } catch {
      return null; // structurally parseable but not humanizable — show the raw expr only
    }
  };
  // Absolute + relative next-run rendering ("3분 후" / "in 3 min").
  const relIn = (iso: string) => {
    const diffMin = Math.round((Date.parse(iso) - Date.now()) / 60000);
    if (!Number.isFinite(diffMin)) return null;
    if (diffMin < 60) return t("relInMinutes", { n: Math.max(diffMin, 1) });
    if (diffMin < 24 * 60) return t("relInHours", { n: Math.round(diffMin / 60) });
    return t("relInDays", { n: Math.round(diffMin / (24 * 60)) });
  };

  function openEdit(job: ScheduleJobRow) {
    setEdit({
      job,
      cron: job.cron_expr,
      timeoutMin: String(Math.round(job.timeout_sec / 60)),
      retries: String(job.max_retries),
      openedAt: new Date(),
    });
  }

  return (
    <>
      {health !== null && <ScheduleHealthBanner tick={health.tick} />}
      {jobs === null ? (
        <p>{tc("loading")}</p>
      ) : jobs.length === 0 ? (
        <>
          <p className="text-[color:var(--muted-fg)] italic">{t("emptyJobs")}</p>
          <button type="button" className="btn-ghost" onClick={seedJobs}>
            {t("seedButton")}
          </button>
        </>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <ListSearch value={query} onChange={setQuery} ariaLabel={t("searchJobsAria")} />
            <span className="flex-1" />
            {/* §4.2 primary action "New job" — the seed button stays the empty-state-only affordance. */}
            <button type="button" className="btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
              {t("newJob")}
            </button>
          </div>
          {filtered.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic">{tl("noMatch")}</p>
          ) : (
            <>
              {/* biome-ignore lint/a11y/useSemanticElements: house table-scroll pattern shared with the other console sections (keyboard-scrollable region, WCAG 2.1) */}
              {/* biome-ignore lint/a11y/noNoninteractiveTabindex: tabIndex 0 is what makes the scroll region keyboard-operable */}
              <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
                <table className="data-table list-table table-fixed-pct tmin-56">
                  <caption className="sr-only">{t("jobsCaption")}</caption>
                  <ColGroup widths={SCHEDULE_COL_PCT} />
                  <thead>
                    <tr>
                      <th scope="col">{t("colName")}</th>
                      <th scope="col">{t("colCron")}</th>
                      <th scope="col">{tc("status")}</th>
                      <th scope="col">{t("colNextRun")}</th>
                      <th scope="col">{t("colLastRun")}</th>
                      <th scope="col">
                        <span className="sr-only">{tc("actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.slice.map((j) => {
                      const name = jobName(j);
                      const desc = jobDesc(j);
                      const preview = cronPreview(j.cron_expr);
                      const rel = j.next_run_at ? relIn(j.next_run_at) : null;
                      return (
                        <tr key={j.id}>
                          <td className="cell-truncate">
                            {name}
                            <br />
                            <span className="font-mono text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                              {j.job_key}
                            </span>
                            {desc && (
                              <>
                                <br />
                                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                                  {desc}
                                </span>
                              </>
                            )}
                          </td>
                          <td className="cell-truncate">
                            {preview ?? "—"}
                            <br />
                            <code className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                              {j.cron_expr}
                            </code>
                          </td>
                          <td>
                            <div className="flex flex-col items-start gap-1">
                              {j.enabled === 1 ? (
                                <span className="inline-flex items-center gap-[0.3rem] px-[0.55rem] py-[0.15rem] rounded-full text-[length:var(--fs-caption)] bg-[color:var(--green-bg)] text-[color:var(--green-fg)]">
                                  <span aria-hidden="true">●</span> {t("active")}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-[0.3rem] px-[0.55rem] py-[0.15rem] rounded-full text-[length:var(--fs-caption)] bg-[color:var(--muted-bg)] text-[color:var(--muted-fg)]">
                                  <span aria-hidden="true">○</span> {t("inactive")}
                                </span>
                              )}
                              {/* Per-job health chips from the health payload (§4.2 list merge): overdue →
                          warning, 3+ consecutive failures → danger. Text + glyph, not colour alone. */}
                              <ScheduleJobHealthChips h={healthMap.get(j.job_key)} />
                              <button
                                type="button"
                                className="btn-ghost"
                                onClick={() => toggleJob(j.job_key, j.enabled !== 1)}
                              >
                                {j.enabled === 1 ? t("disable") : t("enable")}
                              </button>
                            </div>
                          </td>
                          <td className="col-date cell-truncate">
                            {j.next_run_at ? (
                              <>
                                {formatDateTime(j.next_run_at, locale)}
                                {rel && (
                                  <>
                                    <br />
                                    <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                                      {rel}
                                    </span>
                                  </>
                                )}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="cell-truncate">
                            {j.last_run ? (
                              <>
                                {label("jobStatus", j.last_run.status)} ·{" "}
                                {formatDateTime(j.last_run.started_at, locale)}
                              </>
                            ) : (
                              t("noRunHistory")
                            )}
                          </td>
                          <td className="sizing-actions-cell">
                            <span className="actions-row">
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                aria-label={t("runsButtonAria", { p1: name })}
                                onClick={() => setRunsJob(j)}
                              >
                                {t("runsButton")}
                              </button>
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                aria-label={t("editJobAria", { p1: name })}
                                onClick={() => openEdit(j)}
                              >
                                {t("editJob")}
                              </button>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {paged.pages > 1 && (
                <Pager page={paged.page} pages={paged.pages} total={paged.total} onPage={paged.setPage} />
              )}
            </>
          )}
        </>
      )}
      {edit && (
        <ScheduleJobEditDialog
          key={edit.job.job_key}
          state={edit}
          onClose={() => setEdit(null)}
          nameFallback={edit.job.display_name ?? edit.job.job_key}
          descFallback={edit.job.description}
          onSave={saveJob}
        />
      )}
      {runsJob && (
        <ScheduleRunsDialog
          key={runsJob.job_key}
          job={runsJob}
          name={jobName(runsJob)}
          desc={jobDesc(runsJob)}
          onClose={() => setRunsJob(null)}
          onRan={() => setJobs(null)}
        />
      )}
      {createOpen && (
        <ScheduleCreateDialog
          existingKeys={new Set((jobs ?? []).map((j) => j.job_key))}
          onClose={() => setCreateOpen(false)}
          onCreate={createJob}
        />
      )}
    </>
  );
}
