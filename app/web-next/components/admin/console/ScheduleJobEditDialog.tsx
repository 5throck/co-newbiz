"use client";

// Schedule-job edit dialog (design 2026-10-29-scheduled-jobs-design §4.3): the §4.2 "drawer"
// realized as the established modal-panel + useModalFocus dialog — no drawer component exists
// in the codebase. Split from ScheduleSection.tsx (QA iteration 2, Wave U-3 400-line cap).
// Cron validation is client-advisory through the shared ScheduleCronField (the same
// validation/preview path the create dialog uses); the server PATCH stays authoritative.
// Saving never touches `enabled` — editing a disabled job is allowed, enabling is the separate
// toggle in the list's status column.
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type { ScheduleJobRow } from "../../../lib/api.ts";
import { useModalFocus } from "../../../lib/use-modal-focus.ts";
import { computeJobEditPayload, parseRetries, parseTimeoutMin } from "../../../lib/schedule/job-form.ts";
import { useAdminLabel } from "./admin-ui.tsx";
import { ScheduleCronField, useCronFieldCheck } from "./ScheduleCronField.tsx";
import type { ScheduleJobUpdate } from "./useAdminActions.ts";

/** Edit-dialog state; `openedAt` anchors the next-fire preview so it does not churn per keystroke. */
export interface JobEditState {
  job: ScheduleJobRow;
  cron: string;
  timeoutMin: string;
  retries: string;
  openedAt: Date;
}

export function ScheduleJobEditDialog({
  state,
  onClose,
  nameFallback,
  descFallback,
  onSave,
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
  const label = useAdminLabel();
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  const [cron, setCron] = useState(state.cron);
  const [timeoutMin, setTimeoutMin] = useState(state.timeoutMin);
  const [retries, setRetries] = useState(state.retries);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const name =
    label("jobName", state.job.job_key) !== state.job.job_key ? label("jobName", state.job.job_key) : nameFallback;
  const desc =
    label("jobDesc", state.job.job_key) !== state.job.job_key ? label("jobDesc", state.job.job_key) : descFallback;

  const expr = cron.trim();
  const check = useCronFieldCheck(expr, state.job.job_key, state.openedAt);
  const timeoutValue = parseTimeoutMin(timeoutMin);
  const retriesValue = parseRetries(retries);
  const timeoutOk = timeoutValue !== null;
  const retriesOk = retriesValue !== null;
  const canSave = check.ok && timeoutOk && retriesOk && !saving;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    // PATCH only the changed fields (server-side audit shows per-field before/after) —
    // computed form-unit-dirty so a sub-minute stored timeout survives an untouched save.
    const payload = computeJobEditPayload(state.job, { cron, timeoutMin, retries });
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
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("editJobAria", { p1: name })}
      onKeyDown={onKeyDown}
    >
      <div ref={panelRef} className="modal-panel">
        <div className="modal-head">
          <h2>{t("editJobAria", { p1: name })}</h2>
        </div>
        <p className="mt-1 mb-2">
          <code className="font-mono text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {state.job.job_key}
          </code>
        </p>
        {desc && <p className="mt-0 mb-3 text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{desc}</p>}
        <form
          onSubmit={(e) => {
            void submit(e);
          }}
          aria-label={t("editJobFormAria")}
          className="flex flex-col gap-4"
        >
          <ScheduleCronField
            idPrefix="job"
            jobKey={state.job.job_key}
            cron={cron}
            onCronChange={setCron}
            check={check}
          />
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
            {!timeoutOk && (
              <p id="jobTimeoutError" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">
                {t("errTimeoutRange")}
              </p>
            )}
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
            {!retriesOk && (
              <p id="jobRetriesError" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">
                {t("errRetriesRange")}
              </p>
            )}
          </div>
          {serverError && (
            <p role="alert" className="mt-2 mb-0 text-[length:var(--fs-body)] text-[color:var(--red-fg)]">
              {serverError}
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              {tc("cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={!canSave}>
              {saving ? tc("saving") : tc("save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
