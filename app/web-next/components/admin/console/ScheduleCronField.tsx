"use client";

// Shared cron field for the schedule-job dialogs (design 2026-10-29-scheduled-jobs-design
// §4.2 create/edit drawer, §4.3 edit dialog, §4.4 structured cron picker): ONE validation path
// (lib/schedule/cron.ts plus the advisory 5-minute interval floor with the §13.2 delivery-worker
// exemptions) and ONE preview path (cronstrue i18n + nextFireTimes) feeding both the edit and
// the create dialog, so the preview can never disagree between them. The server PATCH/POST stays
// authoritative — a 400 renders in the calling dialog (serverCronError).
//
// §4.4 dual mode: a 빠른 설정/직접 입력 radio group sits above the field. Both modes feed the same
// validation+preview path below the mode section (aria-live on the slot); the single source of
// truth stays the dialog's `cron: string` state — the structured controls only call onCronChange
// with a composed expression, and toggling modes alone never rewrites the expression. `jobKey`
// gates the 매분·매분 option through the §13.2 floor-exemption set (keyed by job).
import cronstrue from "cronstrue/i18n";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { minIntervalMinutes, nextFireTimes, validateCron } from "../../../lib/schedule/cron.ts";
import { formatDateTime } from "../../../lib/format.ts";
import { ScheduleCronQuickPicker } from "./ScheduleCronQuickPicker.tsx";

// Advisory mirror of the PATCH/POST routes' interval floor (the cron must not fire more often
// than every 5 minutes, except the delivery-worker keys). The server stays authoritative —
// its 400 (`cron_too_frequent`) renders in the dialog even if this mirror ever drifts.
export const INTERVAL_FLOOR_MINUTES = 5;
export const INTERVAL_FLOOR_EXEMPT_KEYS = new Set(["watch.evaluate", "notify.deliver"]);

export interface CronFieldCheck {
  /** Localized client-side error (invalid cron or sub-5-minute interval), or null when the expr passes. */
  cronError: string | null;
  /** cronstrue human preview; null when structurally valid but not humanizable. */
  humanPreview: string | null;
  /** Next 5 fire instants (empty when the expr fails validation). */
  fires: Date[];
  /** true when the expr passes both the shared parser and the interval floor. */
  ok: boolean;
}

/** The one validation+preview path for the edit and create dialogs. `openedAt` anchors the preview so it does not churn per keystroke. */
export function useCronFieldCheck(expr: string, jobKey: string | null, openedAt: Date): CronFieldCheck {
  const t = useTranslations("admin.ops");
  const locale = useLocale();
  return useMemo(() => {
    const check = validateCron(expr);
    if (!check.ok) {
      return { ok: false, cronError: t("cronInvalid", { p1: check.error }), humanPreview: null, fires: [] };
    }
    const tooFrequent =
      jobKey !== null &&
      !INTERVAL_FLOOR_EXEMPT_KEYS.has(jobKey) &&
      (() => {
        const min = minIntervalMinutes(expr, openedAt);
        return min !== null && min < INTERVAL_FLOOR_MINUTES;
      })();
    if (tooFrequent) {
      return { ok: false, cronError: t("cronTooFrequent"), humanPreview: null, fires: [] };
    }
    // cronstrue may decline structurally valid expressions — the preview is best-effort and
    // never blocks saving (the shared parser decides that).
    let humanPreview: string | null = null;
    try {
      humanPreview = cronstrue.toString(expr, { locale: locale === "en" ? "en" : "ko" });
    } catch {
      humanPreview = null;
    }
    return { ok: true, cronError: null, humanPreview, fires: nextFireTimes(expr, openedAt, 5) };
  }, [expr, jobKey, openedAt, t, locale]);
}

/**
 * The dual-mode cron field (§4.4): 빠른 설정 (structured presets) | 직접 입력 (today's mono
 * input), one shared preview/error slot (aria-live) and the 다음 5회 실행 시각 list below the
 * mode section. `serverCronError` (a 400 from the PATCH/POST route, localized via errors.codes)
 * takes the error slot when present — the client check stays advisory, the server verdict wins.
 * The weekly-zero-days state swaps the parser error for the 요일-required hint in quick mode
 * (the intentionally invalid composed expression already disables save through the check).
 * `idPrefix` keeps the two dialogs' element ids (and their aria wiring) apart.
 */
export function ScheduleCronField({
  idPrefix,
  jobKey,
  cron,
  onCronChange,
  check,
  serverCronError = null,
}: {
  idPrefix: string;
  /** The §13.2 floor exemption set is keyed by job — it gates the 매분·매분 option. */
  jobKey: string | null;
  cron: string;
  onCronChange: (v: string) => void;
  check: CronFieldCheck;
  serverCronError?: string | null;
}) {
  const t = useTranslations("admin.ops");
  const locale = useLocale();
  // Quick mode is the opening mode for every expression: representable ones pre-populate the
  // controls, unrepresentable ones open in the neutral state with the unavailable hint.
  const [mode, setMode] = useState<"quick" | "text">("quick");
  const [dowEmpty, setDowEmpty] = useState(false);
  const baseError = serverCronError ?? check.cronError;
  const error = mode === "quick" && dowEmpty ? t("cronDowRequired") : baseError;
  return (
    <>
      <fieldset className="stack-form-row" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="mb-1 text-[length:var(--fs-caption)] font-semibold">{t("cronModeLegend")}</legend>
        {/* Native radiogroup per the ClosureModal pattern; toggling modes only switches
            rendering — neither branch writes the expression. Both branches stay mounted
            (hidden), so quick-setup selections survive a peek at 직접 입력. */}
        <div role="radiogroup" className="flex gap-x-4">
          <label className="flex items-center gap-1 text-[length:var(--fs-body)]">
            <input
              type="radio"
              name={`${idPrefix}CronMode`}
              value="quick"
              checked={mode === "quick"}
              onChange={() => setMode("quick")}
            />
            {t("cronModeQuick")}
          </label>
          <label className="flex items-center gap-1 text-[length:var(--fs-body)]">
            <input
              type="radio"
              name={`${idPrefix}CronMode`}
              value="text"
              checked={mode === "text"}
              onChange={() => setMode("text")}
            />
            {t("cronModeText")}
          </label>
        </div>
      </fieldset>
      <div hidden={mode !== "quick"}>
        <ScheduleCronQuickPicker
          idPrefix={idPrefix}
          everyMinuteAllowed={jobKey !== null && INTERVAL_FLOOR_EXEMPT_KEYS.has(jobKey)}
          cron={cron}
          onCronChange={onCronChange}
          dowEmpty={dowEmpty}
          onDowEmpty={setDowEmpty}
        />
      </div>
      <div className="stack-form-row" hidden={mode !== "text"}>
        <label htmlFor={`${idPrefix}CronInput`}>{t("cronLabel")}</label>
        <input
          id={`${idPrefix}CronInput`}
          className="sizing-new-input font-mono"
          value={cron}
          onChange={(e) => onCronChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error !== null}
          aria-describedby={error !== null ? `${idPrefix}CronError` : `${idPrefix}CronPreview`}
        />
      </div>
      {/* The one shared preview/error slot — fed by the same check in both modes. */}
      <div aria-live="polite">
        {error !== null ? (
          <p id={`${idPrefix}CronError`} className="m-0 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">
            {error}
          </p>
        ) : (
          <p id={`${idPrefix}CronPreview`} className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {t("cronPreviewLabel")}
            {check.humanPreview ? `: ${check.humanPreview}` : ""}
          </p>
        )}
      </div>
      <div className="stack-form-row">
        <span className="text-[length:var(--fs-body)] font-semibold">{t("nextFireTimesHeading")}</span>
        {check.fires.length > 0 ? (
          <ol className="m-0 pl-5 text-[length:var(--fs-body)]">
            {check.fires.map((d) => (
              <li key={d.toISOString()}>{formatDateTime(d, locale)}</li>
            ))}
          </ol>
        ) : (
          <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("nextFireTimesEmpty")}</p>
        )}
      </div>
    </>
  );
}
