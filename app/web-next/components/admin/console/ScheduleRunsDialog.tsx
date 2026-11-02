"use client";

// Schedule-job runs detail dialog (ADR-0189 P7; design 2026-10-29-scheduled-jobs-design §4.2
// detail bullet): the paged run-history table — trigger, actor, env, rows read/written/changed,
// attempt, duration, expandable (server-scrubbed) error — plus the §4.2 "Run now" secondary
// action: confirm → POST /[jobKey]/run (202, enqueue only, ADR-0019) → poll GET /[jobKey]/runs
// until a manual run newer than the request lands, 90 s deadline, then the not-yet notice.
// The action works on disabled jobs too (the tick dispatches manual requests without an
// enabled check; run-job's manual path) — the tooltip says so.
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  api,
  type ScheduleJobRun,
  type ScheduleJobRunRequest,
  type ScheduleJobRunsPage,
  type ScheduleJobRow,
} from "../../../lib/api.ts";
import { formatDateTime, formatInteger } from "../../../lib/format.ts";
import { useModalFocus } from "../../../lib/use-modal-focus.ts";
import { ColGroup, useToast } from "../../ui.tsx";
import { useConfirm } from "../../crud.tsx";
import { Pager, useAdminLabel } from "./admin-ui.tsx";

const RUNS_PAGE_SIZE = 20;
const RUN_COL_PCT = [15, 10, 10, 13, 8, 16, 6, 10, 12] as const; // 시각/상태/트리거/행위자/환경/처리 행/시도/소요/오류

// §4.2 confirm-then-poll constants: the run is picked up by the next tick (≤ 60 s); the poll
// runs every 5 s and gives up at 90 s with the not-yet notice + refresh affordance.
const POLL_INTERVAL_MS = 5_000;
const POLL_DEADLINE_MS = 90_000;
// The run matches when its started_at is at/after the request time — but the browser clock may
// sit slightly ahead of the server clock, so the anchor is loosened by 60 s. Over-matching is
// safe in practice: another admin's manual run inside that window is rare and already visible
// in the history before the confirm.
const CLOCK_SKEW_TOLERANCE_MS = 60_000;

type RunNowState =
  | { phase: "posting" }
  | { phase: "polling"; requestAtMs: number; deadlineMs: number }
  | { phase: "landed" }
  | { phase: "timeout" };

// ── 실행 이력 다이얼로그 (design §4.2 detail) ──
export function ScheduleRunsDialog({
  job,
  name,
  desc,
  onClose,
  onRan,
}: {
  job: ScheduleJobRow;
  /** Readable name resolved by the list (catalog jobName → DB display_name → raw key). */
  name: string;
  desc: string | null;
  /** Called when the manual run lands — the list refreshes so 최근 실행 catches up. */
  onRan: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("admin.ops");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { toast } = useToast();
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  const { confirm, confirmDialog } = useConfirm();

  const [page, setPage] = useState(1);
  const [data, setData] = useState<ScheduleJobRunsPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runNow, setRunNow] = useState<RunNowState | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Run history: paged per the backend contract (?page=&limit=), refetched on page change or a
  // manual reload — the poll writes its fresh page-1 fetch straight into `data` when the run
  // lands, so no double fetch there. (t is a stable next-intl translator; not a dep.)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is the manual-reload trigger — deliberately unreferenced inside the effect body
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    api
      .get<ScheduleJobRunsPage>(
        `/api/admin/schedule-jobs/${encodeURIComponent(job.job_key)}/runs?page=${page}&limit=${RUNS_PAGE_SIZE}`,
      )
      .then((r) => {
        if (!cancelled) setData(r.data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : t("runsLoadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [job.job_key, page, reloadKey, t]);

  // §4.2 confirm-then-poll: after the 202, poll page 1 every 5 s until a manual run newer than
  // the request appears (trigger='manual', started_at >= request−tolerance) or the 90 s
  // deadline fires the not-yet notice. The effect lifecycle is driven by the runNow state
  // identity — it re-arms only on the posting→polling transition and tears down on landing.
  useEffect(() => {
    if (runNow?.phase !== "polling") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const r = await api.get<ScheduleJobRunsPage>(
          `/api/admin/schedule-jobs/${encodeURIComponent(job.job_key)}/runs?page=1&limit=${RUNS_PAGE_SIZE}`,
        );
        if (cancelled) return;
        const landed = r.data.runs.find(
          (x) => x.trigger === "manual" && Date.parse(x.started_at) >= runNow.requestAtMs,
        );
        if (landed) {
          setRunNow({ phase: "landed" });
          setData(r.data);
          onRan();
          toast(t("runNowLanded", { p1: formatDateTime(landed.started_at, locale) }));
          return;
        }
        if (Date.now() >= runNow.deadlineMs) {
          setRunNow({ phase: "timeout" });
          setData(r.data); // the notice points at the freshest history below it
          return;
        }
      } catch {
        // a transient poll error is not a verdict — keep polling until the deadline
      }
      if (!cancelled)
        timer = setTimeout(() => {
          void poll();
        }, POLL_INTERVAL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [runNow, job.job_key, onRan, toast, t, locale]);

  const busy = runNow?.phase === "posting" || runNow?.phase === "polling";

  function requestRun() {
    setActionError(null);
    confirm(
      t("runNowTitle", { p1: name }),
      () => {
        void postRun();
      },
      {
        body: t("runNowBody"),
        confirmLabel: t("runNowConfirmLabel"),
        tone: "neutral",
      },
    );
  }

  async function postRun() {
    setRunNow({ phase: "posting" });
    try {
      await api.post<ScheduleJobRunRequest>(`/api/admin/schedule-jobs/${encodeURIComponent(job.job_key)}/run`);
      setRunNow({
        phase: "polling",
        requestAtMs: Date.now() - CLOCK_SKEW_TOLERANCE_MS,
        deadlineMs: Date.now() + POLL_DEADLINE_MS,
      });
    } catch (err) {
      setRunNow(null);
      setActionError(err instanceof Error ? err.message : t("runNowRequestFailed"));
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / RUNS_PAGE_SIZE)) : 1;

  return (
    <>
      <div
        className="modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label={t("runsDialogAria", { p1: name })}
        onKeyDown={onKeyDown}
      >
        <div ref={panelRef} className="modal-panel">
          <div className="modal-head">
            <h2>{t("runsDialogAria", { p1: name })}</h2>
          </div>
          <p className="mt-1 mb-2">
            <code className="font-mono text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {job.job_key}
            </code>
          </p>
          {desc && <p className="mt-0 mb-3 text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{desc}</p>}

          {runNow?.phase === "polling" && (
            <p role="status" className="mt-0 mb-2 text-[length:var(--fs-body)]">
              {t("runNowWaiting")}
            </p>
          )}
          {runNow?.phase === "timeout" && (
            <p role="alert" className="mt-0 mb-2 text-[length:var(--fs-body)] text-[color:var(--amber-fg)]">
              {t("runNowTimeout")}{" "}
              <button type="button" className="btn-ghost btn-sm" onClick={() => setReloadKey((k) => k + 1)}>
                {t("runsRefresh")}
              </button>
            </p>
          )}
          {actionError && (
            <p role="alert" className="mt-0 mb-2 text-[length:var(--fs-body)] text-[color:var(--red-fg)]">
              {actionError}
            </p>
          )}

          {data === null ? (
            <p>{loadError ?? tc("loading")}</p>
          ) : data.runs.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic">{t("runsEmpty")}</p>
          ) : (
            <>
              {/* biome-ignore lint/a11y/useSemanticElements: house table-scroll pattern shared with the other console sections (keyboard-scrollable region, WCAG 2.1) */}
              {/* biome-ignore lint/a11y/noNoninteractiveTabindex: tabIndex 0 is what makes the scroll region keyboard-operable */}
              <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
                <table className="data-table list-table table-fixed-pct tmin-56">
                  <caption className="sr-only">{t("runsDialogAria", { p1: name })}</caption>
                  <ColGroup widths={RUN_COL_PCT} />
                  <thead>
                    <tr>
                      <th scope="col">{t("colTime")}</th>
                      <th scope="col">{tc("status")}</th>
                      <th scope="col">{t("colTrigger")}</th>
                      <th scope="col">{t("colRunActor")}</th>
                      <th scope="col">{t("colRunEnv")}</th>
                      <th scope="col">{t("colRunCounts")}</th>
                      <th scope="col">{t("colAttempt")}</th>
                      <th scope="col">{t("colRunDuration")}</th>
                      <th scope="col">{t("errorToggle")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.runs.map((r) => (
                      <RunRow key={`${r.started_at}:${r.attempt ?? 0}`} r={r} />
                    ))}
                  </tbody>
                </table>
              </div>
              {pages > 1 && <Pager page={page} pages={pages} total={data.total} onPage={setPage} />}
            </>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto" title={job.enabled === 1 ? undefined : t("runNowHint")}>
              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={requestRun}>
                {t("runNow")}
              </button>
            </span>
            <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
              {tc("close")}
            </button>
          </div>
        </div>
      </div>
      {confirmDialog}
    </>
  );
}

/** One run row: the migration-0183 columns; the scrubbed error is expandable per row (default hidden). */
function RunRow({ r }: { r: ScheduleJobRun }) {
  const t = useTranslations("admin.ops");
  const locale = useLocale();
  const label = useAdminLabel();
  const counts = (v: number | null) => (v === null ? "—" : formatInteger(v));
  // Duration: seconds (1 decimal) below a minute, minutes above; null while running.
  const duration =
    r.duration === null
      ? "—"
      : r.duration < 60_000
        ? t("runDurationSeconds", { n: Math.round(r.duration / 100) / 10 })
        : t("runDurationMinutes", { n: Math.round(r.duration / 6_000) / 10 });
  return (
    <tr>
      <td className="col-date cell-truncate">
        {formatDateTime(r.started_at, locale)}
        <br />
        <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          {r.finished_at ? formatDateTime(r.finished_at, locale) : "—"}
        </span>
      </td>
      <td>
        <span className={`status-chip ${runStatusChipCls(r.status)}`}>
          <span aria-hidden="true">{r.status === "success" ? "●" : r.status === "running" ? "○" : "!"}</span>{" "}
          {label("jobStatus", r.status)}
        </span>
      </td>
      <td>{r.trigger ? label("trigger", r.trigger) : "—"}</td>
      <td className="cell-truncate">
        {r.actor ? <code className="font-mono text-[length:var(--fs-caption)]">{r.actor}</code> : "—"}
      </td>
      <td>{r.env ? <span className="status-chip status-gray">{label("env", r.env)}</span> : "—"}</td>
      <td className="cell-truncate">
        {counts(r.rows_read)} / {counts(r.rows_written)} / {counts(r.rows_changed)}
      </td>
      <td>{r.attempt ?? "—"}</td>
      <td>{duration}</td>
      <td>
        {r.error ? (
          <details>
            <summary className="cursor-pointer text-[length:var(--fs-caption)]">{t("errorToggle")}</summary>
            <p className="m-0 mt-1 text-[length:var(--fs-caption)]" style={{ wordBreak: "break-all" }}>
              {r.error}
            </p>
          </details>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

function runStatusChipCls(status: string): string {
  if (status === "success") return "status-green";
  if (status === "failed" || status === "timeout") return "status-red";
  if (status === "running") return "status-amber";
  return "status-gray";
}
