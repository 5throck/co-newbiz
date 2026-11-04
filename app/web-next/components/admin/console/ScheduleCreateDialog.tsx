"use client";

// Schedule-job create dialog (ADR-0189 P7; design 2026-10-29-scheduled-jobs-design §4.1
// POST row, §4.2 "primary action New job", §5 last bullet). §5 RCE guard realized client-side:
// the select offers ONLY registered scheduler handler keys — there is no free-text command
// field, which would be remote code execution from the admin console.
//
// The registry itself lives server-side (scripts/co-newbiz/jobs/index.ts) and no endpoint
// exposes it (health lists schedule_job rows, not handlers), so the offer list below mirrors
// the registry statically, including each entry's default cron/timeout/retries for the form
// prefill and the changed-fields-only payload. The server 400 `unregistered_handler` stays
// authoritative: a handler added to the registry without an entry here still creates fine via
// the API and reports its own inline error — the list going stale is a UI gap, not a bypass.
// tests/unit/admin-schedule-panel.test.ts pins this list against the registry sources.
//
// Created rows start disabled (server default enabled=false, the D3 seed posture) — the note
// in the dialog says so, and the payload never sends `enabled`: enabling is the separate,
// deliberate toggle in the list (one action per dialog, matching the edit dialog's rule).
import cronstrue from "cronstrue/i18n";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type { ScheduleJobCreate } from "../../../lib/api.ts";
import { useModalFocus } from "../../../lib/use-modal-focus.ts";
import { parseRetries, parseTimeoutMin } from "../../../lib/schedule/job-form.ts";
import { useAdminLabel } from "./admin-ui.tsx";
import { ScheduleCronField, useCronFieldCheck } from "./ScheduleCronField.tsx";

/** Mirror of scripts/co-newbiz/jobs/index.ts (ADR-0189 P1/P3/P5/P6) — keys + registry defaults. */
const KNOWN_HANDLERS: ReadonlyArray<{ key: string; defaultCron: string; timeoutSec: number; maxRetries: number }> = [
  { key: "collect.dart", defaultCron: "0 7 * * 1-5", timeoutSec: 1800, maxRetries: 2 },
  { key: "collect.ecos", defaultCron: "0 8 * * *", timeoutSec: 1200, maxRetries: 2 },
  { key: "collect.krx", defaultCron: "30 18 * * 1-5", timeoutSec: 1200, maxRetries: 2 },
  { key: "collect.kosis", defaultCron: "0 9 * * 1", timeoutSec: 1800, maxRetries: 2 },
  { key: "collect.law", defaultCron: "0 6 * * *", timeoutSec: 1800, maxRetries: 2 },
  { key: "gate_integrity.shadow_report", defaultCron: "0 8 * * 1", timeoutSec: 900, maxRetries: 1 },
  { key: "notify.deliver", defaultCron: "* * * * *", timeoutSec: 50, maxRetries: 0 },
  { key: "notify.digest", defaultCron: "30 8 * * *", timeoutSec: 600, maxRetries: 0 },
  { key: "retention.cleanup", defaultCron: "0 3 * * *", timeoutSec: 1800, maxRetries: 0 },
  { key: "watch.evaluate", defaultCron: "*/30 * * * *", timeoutSec: 600, maxRetries: 0 },
];

export function ScheduleCreateDialog({
  existingKeys,
  onClose,
  onCreate,
}: {
  /** schedule_job keys already present — those options are disabled (409 job_key_exists otherwise). */
  existingKeys: ReadonlySet<string>;
  onClose: () => void;
  /** useAdminActions.createJob — POST + toast + list refresh; resolves inline error info. */
  onCreate: (payload: ScheduleJobCreate) => Promise<{ ok: boolean; error?: string; code?: string }>;
}) {
  const t = useTranslations("admin.ops");
  const tc = useTranslations("common");
  const locale = useLocale();
  const label = useAdminLabel();
  const { panelRef, onKeyDown } = useModalFocus(onClose);

  // Prefill from the selected handler's registry defaults; untouched fields stay out of the
  // payload so the server default (e.g. notify.deliver's 50 s timeout, below the 60 s input
  // floor) stays out of the payload when untouched — exact preservation holds under the seeded-flow invariant, since
  // notify.deliver is always seeded and has no DELETE endpoint.
  const available = KNOWN_HANDLERS.filter((h) => !existingKeys.has(h.key));
  const [jobKey, setJobKey] = useState(available[0]?.key ?? "");
  const [cron, setCron] = useState(available[0]?.defaultCron ?? "");
  const [timeoutMin, setTimeoutMin] = useState(available[0] ? String(Math.ceil(available[0].timeoutSec / 60)) : "");
  const [retries, setRetries] = useState(available[0] ? String(available[0].maxRetries) : "");
  const [saving, setSaving] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [serverCronError, setServerCronError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const handler = KNOWN_HANDLERS.find((h) => h.key === jobKey) ?? null;
  // openedAt anchors the next-fire preview so it does not churn per keystroke.
  const [openedAt] = useState(() => new Date());
  const check = useCronFieldCheck(cron.trim(), jobKey || null, openedAt);
  const timeoutValue = parseTimeoutMin(timeoutMin);
  const retriesValue = parseRetries(retries);
  const timeoutOk = timeoutValue !== null;
  const retriesOk = retriesValue !== null;
  const canSave = handler !== null && check.ok && timeoutOk && retriesOk && !saving;

  function pickKey(key: string) {
    setJobKey(key);
    setKeyError(null);
    setServerCronError(null);
    setServerError(null);
    const h = KNOWN_HANDLERS.find((x) => x.key === key);
    if (h) {
      setCron(h.defaultCron);
      setTimeoutMin(String(Math.ceil(h.timeoutSec / 60)));
      setRetries(String(h.maxRetries));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSave || handler === null || timeoutValue === null || retriesValue === null) return;
    // Changed-fields-only against the registry defaults (the server fills the omitted ones).
    const payload: ScheduleJobCreate = { job_key: handler.key };
    if (cron.trim() !== handler.defaultCron) payload.cron_expr = cron.trim();
    if (timeoutValue * 60 !== handler.timeoutSec) payload.timeout_sec = timeoutValue * 60;
    if (retriesValue !== handler.maxRetries) payload.max_retries = retriesValue;
    setSaving(true);
    setKeyError(null);
    setServerCronError(null);
    setServerError(null);
    const res = await onCreate(payload);
    setSaving(false);
    if (res.ok) {
      onClose();
      return;
    }
    // Map the envelope error onto its field; errors.codes localization happened at the
    // ApiError choke point, so the message is already in the active locale when the code is known.
    if (res.code === "unregistered_handler" || res.code === "job_key_exists") setKeyError(res.error ?? null);
    else if (res.code === "invalid_cron" || res.code === "cron_too_frequent") setServerCronError(res.error ?? null);
    else setServerError(res.error ?? null);
  }

  // Unused-locale guard: none needed — cronstrue renders the selected handler's default-cron
  // preview in the key hint line below (validation runs through the shared check only).

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("createDialogAria")}
      onKeyDown={onKeyDown}
    >
      <div ref={panelRef} className="modal-panel">
        <div className="modal-head">
          <h2>{t("createDialogAria")}</h2>
        </div>
        <form
          onSubmit={(e) => {
            void submit(e);
          }}
          aria-label={t("createJobFormAria")}
          className="flex flex-col gap-4"
        >
          <div className="stack-form-row">
            <label htmlFor="createJobKeySelect">{t("colJobKey")}</label>
            {available.length === 0 ? (
              <p className="m-0 text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">
                {t("createNoKeysAvailable")}
              </p>
            ) : (
              <>
                <select
                  id="createJobKeySelect"
                  className="sizing-new-input"
                  value={jobKey}
                  onChange={(e) => pickKey(e.target.value)}
                  aria-invalid={keyError !== null}
                  aria-describedby={keyError !== null ? "createJobKeyError" : "createJobKeyHint"}
                >
                  {KNOWN_HANDLERS.map((h) => (
                    <option key={h.key} value={h.key} disabled={existingKeys.has(h.key)}>
                      {label("jobName", h.key)} ({h.key})
                      {existingKeys.has(h.key) ? ` — ${t("createKeyRegistered")}` : ""}
                    </option>
                  ))}
                </select>
                {keyError !== null ? (
                  <p id="createJobKeyError" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">
                    {keyError}
                  </p>
                ) : (
                  <p id="createJobKeyHint" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                    {t("createKeyHint")}:{" "}
                    {handler ? cronstrue.toString(handler.defaultCron, { locale: locale === "en" ? "en" : "ko" }) : "—"}
                  </p>
                )}
              </>
            )}
          </div>
          <ScheduleCronField
            idPrefix="createJob"
            jobKey={jobKey || null}
            cron={cron}
            onCronChange={(v) => {
              setCron(v);
              setServerCronError(null);
            }}
            check={check}
            serverCronError={serverCronError}
          />
          <div className="stack-form-row">
            <label htmlFor="createJobTimeoutInput">{t("timeoutLabel")}</label>
            <input
              id="createJobTimeoutInput"
              inputMode="numeric"
              className="sizing-new-input"
              value={timeoutMin}
              onChange={(e) => setTimeoutMin(e.target.value)}
              aria-invalid={!timeoutOk}
              aria-describedby={!timeoutOk ? "createJobTimeoutError" : undefined}
            />
            {!timeoutOk && (
              <p id="createJobTimeoutError" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">
                {t("errTimeoutRange")}
              </p>
            )}
          </div>
          <div className="stack-form-row">
            <label htmlFor="createJobRetriesInput">{t("retriesLabel")}</label>
            <input
              id="createJobRetriesInput"
              inputMode="numeric"
              className="sizing-new-input"
              value={retries}
              onChange={(e) => setRetries(e.target.value)}
              aria-invalid={!retriesOk}
              aria-describedby={!retriesOk ? "createJobRetriesError" : undefined}
            />
            {!retriesOk && (
              <p id="createJobRetriesError" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">
                {t("errRetriesRange")}
              </p>
            )}
          </div>
          <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("createDisabledNote")}</p>
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
              {saving ? tc("saving") : t("createSubmit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
