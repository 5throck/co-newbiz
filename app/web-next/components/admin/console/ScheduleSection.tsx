"use client";

// /admin/schedule list-and-edit screen (design 2026-10-29-scheduled-jobs-design §4.3 — the
// pulled-forward P7 subset). Split from OpsSections.tsx to hold the Wave U-3 400-line cap.
import cronstrue from "cronstrue/i18n";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import type { AdminConsoleState, ScheduleJobUpdate } from "./useAdminActions.ts";
import { ColGroup } from "../../ui.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { minIntervalMinutes, nextFireTimes, validateCron } from "../../../lib/schedule/cron.ts";
import type { ScheduleJobRow } from "../../../lib/api.ts";
import { useModalFocus } from "../../../lib/use-modal-focus.ts";
import { ListSearch, Pager, matchesQuery, usePaged, useAdminLabel } from "./admin-ui.tsx";

// 스케줄 작업 6열 — 작업(이름·키·설명 3줄)과 스케줄(미리보기+raw cron)이 긴 텍스트라 고정 비율 유지.
const SCHEDULE_COL_PCT = [24, 20, 10, 15, 21, 10] as const;
const SCHEDULE_PAGE_SIZE = 15;
// Advisory mirror of the PATCH route's interval floor (cron must not fire more
// often than every 5 minutes, except the delivery worker keys). The server
// stays authoritative — its 400 renders in the dialog even if this mirror and
// the route ever drift apart.
const INTERVAL_FLOOR_MINUTES = 5;
const INTERVAL_FLOOR_EXEMPT_KEYS = new Set(["watch.evaluate", "notify.deliver"]);

/** Edit-dialog state; `openedAt` anchors the next-fire preview so it does not churn per keystroke. */
interface JobEditState {
  job: ScheduleJobRow;
  cron: string;
  timeoutMin: string;
  retries: string;
  openedAt: Date;
}

// ── 스케줄 작업 패널 (design 2026-10-29-scheduled-jobs-design §4.3) ──
export function SchedulePanel({ ctx }: { ctx: AdminConsoleState }) {
  const t = useTranslations("admin.ops");
  const tc = useTranslations("common");
  const tl = useTranslations("admin.list");
  const locale = useLocale();
  const label = useAdminLabel();
  const { section, jobs, toggleJob, seedJobs, saveJob } = ctx;
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState<JobEditState | null>(null);

  const filtered = useMemo(
    () => (jobs ?? []).filter((j) => matchesQuery(query, j.job_key, j.display_name, j.description, label("jobName", j.job_key), label("jobDesc", j.job_key))),
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
    setEdit({ job, cron: job.cron_expr, timeoutMin: String(Math.round(job.timeout_sec / 60)), retries: String(job.max_retries), openedAt: new Date() });
  }

  return (
    <>{section === "schedule" &&
        (jobs === null ? (
          <p>{tc("loading")}</p>
        ) : jobs.length === 0 ? (
          <>
            <p className="text-[color:var(--muted-fg)] italic">{t("emptyJobs")}</p>
            <button type="button" className="btn-ghost" onClick={seedJobs}>{t("seedButton")}</button>
          </>
        ) : (
          <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <ListSearch value={query} onChange={setQuery} ariaLabel={t("searchJobsAria")} />
          </div>
          {filtered.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic">{tl("noMatch")}</p>
          ) : (
          <>
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}><table className="data-table list-table table-fixed-pct tmin-56">
            <caption className="sr-only">{t("jobsCaption")}</caption>
            <ColGroup widths={SCHEDULE_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">{t("colName")}</th>
                <th scope="col">{t("colCron")}</th>
                <th scope="col">{tc("status")}</th>
                <th scope="col">{t("colNextRun")}</th>
                <th scope="col">{t("colLastRun")}</th>
                <th scope="col"><span className="sr-only">{tc("actions")}</span></th>
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
                      <br /><span className="font-mono text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{j.job_key}</span>
                      {desc && <><br /><span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{desc}</span></>}
                    </td>
                    <td className="cell-truncate">
                      {preview ?? "—"}
                      <br /><code className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{j.cron_expr}</code>
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
                        <button type="button" className="btn-ghost" onClick={() => toggleJob(j.job_key, j.enabled !== 1)}>
                          {j.enabled === 1 ? t("disable") : t("enable")}
                        </button>
                      </div>
                    </td>
                    <td className="col-date cell-truncate">
                      {j.next_run_at ? (
                        <>
                          {formatDateTime(j.next_run_at, locale)}
                          {rel && <><br /><span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{rel}</span></>}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="cell-truncate">
                      {j.last_run ? (
                        <>{label("jobStatus", j.last_run.status)} · {formatDateTime(j.last_run.started_at, locale)}</>
                      ) : (
                        t("noRunHistory")
                      )}
                    </td>
                    <td className="sizing-actions-cell"><span className="actions-row">
                      <button type="button" className="btn-ghost btn-sm" aria-label={t("editJobAria", { p1: name })} onClick={() => openEdit(j)}>
                        {t("editJob")}
                      </button>
                    </span></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          {paged.pages > 1 && <Pager page={paged.page} pages={paged.pages} total={paged.total} onPage={paged.setPage} />}
          </>
          )}
          </>
        ))}
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
    </>
  );
}

// Edit dialog (§4.3): the §4.2 "drawer" realized as the established modal-panel +
// useModalFocus dialog — no drawer component exists in the codebase. Cron
// validation is client-advisory (validateCron + the 5-minute floor, both from
// the shared parser); the server PATCH stays authoritative. Saving never
// touches `enabled` — editing a disabled job is allowed, enabling is the
// separate toggle in the 상태 column.
function ScheduleJobEditDialog({
  state, onClose, nameFallback, descFallback, onSave,
}: {
  state: JobEditState;
  onClose: () => void;
  /** Name/description shown read-only when the row has no catalog entry. */
  nameFallback: string;
  descFallback: string | null;
  onSave: (jobKey: string, payload: ScheduleJobUpdate) => Promise<{ ok: boolean; error?: string }>;
}) {
  const t = useTranslations("admin.ops");
  const tc = useTranslations("common");
  const locale = useLocale();
  const label = useAdminLabel();
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  const [cron, setCron] = useState(state.cron);
  const [timeoutMin, setTimeoutMin] = useState(state.timeoutMin);
  const [retries, setRetries] = useState(state.retries);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const name = label("jobName", state.job.job_key) !== state.job.job_key ? label("jobName", state.job.job_key) : nameFallback;
  const desc = label("jobDesc", state.job.job_key) !== state.job.job_key ? label("jobDesc", state.job.job_key) : descFallback;

  const expr = cron.trim();
  const check = validateCron(expr);
  // Advisory interval floor — the delivery-worker keys are exempt exactly as on the server.
  const tooFrequent =
    check.ok &&
    !INTERVAL_FLOOR_EXEMPT_KEYS.has(state.job.job_key) &&
    (() => {
      const min = minIntervalMinutes(expr, state.openedAt);
      return min !== null && min < INTERVAL_FLOOR_MINUTES;
    })();
  const cronError = !check.ok ? t("cronInvalid", { p1: check.error }) : tooFrequent ? t("cronTooFrequent") : null;
  // cronstrue may decline structurally valid expressions — the preview is
  // best-effort and never blocks saving (the shared parser decides that).
  let humanPreview: string | null = null;
  if (check.ok) {
    try {
      humanPreview = cronstrue.toString(expr, { locale: locale === "en" ? "en" : "ko" });
    } catch {
      humanPreview = null;
    }
  }
  const fires = check.ok ? nextFireTimes(expr, state.openedAt, 5) : [];
  const timeoutValue = Number(timeoutMin);
  const timeoutOk = Number.isInteger(timeoutValue) && timeoutValue >= 1 && timeoutValue <= 120;
  const retriesValue = Number(retries);
  const retriesOk = Number.isInteger(retriesValue) && retriesValue >= 0 && retriesValue <= 5;
  const canSave = check.ok && !tooFrequent && timeoutOk && retriesOk && !saving;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    // PATCH only the changed fields (server-side audit shows per-field before/after).
    const payload: ScheduleJobUpdate = {};
    if (expr !== state.job.cron_expr) payload.cron_expr = expr;
    if (timeoutValue * 60 !== state.job.timeout_sec) payload.timeout_sec = timeoutValue * 60;
    if (retriesValue !== state.job.max_retries) payload.max_retries = retriesValue;
    if (Object.keys(payload).length === 0) {
      onClose(); // nothing changed — close without a request or a success toast
      return;
    }
    setSaving(true);
    setServerError(null);
    const res = await onSave(state.job.job_key, payload);
    setSaving(false);
    if (res.ok) onClose();
    else setServerError(res.error ?? null); // dialog stays open so the field can be fixed
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("editJobAria", { p1: name })} onKeyDown={onKeyDown}>
      <div ref={panelRef} className="modal-panel">
        <div className="modal-head"><h2>{t("editJobAria", { p1: name })}</h2></div>
        <p className="mt-1 mb-2"><code className="font-mono text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{state.job.job_key}</code></p>
        {desc && <p className="mt-0 mb-3 text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{desc}</p>}
        <form onSubmit={(e) => { void submit(e); }} aria-label={t("editJobFormAria")} className="stack-form">
          <div className="stack-form-row">
            <label htmlFor="jobCronInput">{t("cronLabel")}</label>
            <input
              id="jobCronInput"
              className="sizing-new-input font-mono"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={cronError !== null}
              aria-describedby={cronError !== null ? "jobCronError" : "jobCronPreview"}
            />
            {cronError !== null ? (
              <p id="jobCronError" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">{cronError}</p>
            ) : (
              <p id="jobCronPreview" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                {t("cronPreviewLabel")}{humanPreview ? `: ${humanPreview}` : ""}
              </p>
            )}
          </div>
          <div className="stack-form-row">
            <span className="text-[length:var(--fs-body)] font-semibold">{t("nextFireTimesHeading")}</span>
            {fires.length > 0 ? (
              <ol className="m-0 pl-5 text-[length:var(--fs-body)]">
                {fires.map((d) => <li key={d.toISOString()}>{formatDateTime(d, locale)}</li>)}
              </ol>
            ) : (
              <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("nextFireTimesEmpty")}</p>
            )}
          </div>
          <div className="stack-form-row">
            <label htmlFor="jobTimeoutInput">{t("timeoutLabel")}</label>
            <input
              id="jobTimeoutInput"
              inputMode="numeric"
              className="sizing-new-input"
              value={timeoutMin}
              onChange={(e) => setTimeoutMin(e.target.value)}
              aria-invalid={!timeoutOk}
              aria-describedby={!timeoutOk ? "jobTimeoutError" : undefined}
            />
            {!timeoutOk && <p id="jobTimeoutError" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">{t("errTimeoutRange")}</p>}
          </div>
          <div className="stack-form-row">
            <label htmlFor="jobRetriesInput">{t("retriesLabel")}</label>
            <input
              id="jobRetriesInput"
              inputMode="numeric"
              className="sizing-new-input"
              value={retries}
              onChange={(e) => setRetries(e.target.value)}
              aria-invalid={!retriesOk}
              aria-describedby={!retriesOk ? "jobRetriesError" : undefined}
            />
            {!retriesOk && <p id="jobRetriesError" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">{t("errRetriesRange")}</p>}
          </div>
          {serverError && <p role="alert" className="mt-2 mb-0 text-[length:var(--fs-body)] text-[color:var(--red-fg)]">{serverError}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>{tc("cancel")}</button>
            <button type="submit" className="btn-primary" disabled={!canSave}>{saving ? tc("saving") : tc("save")}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
