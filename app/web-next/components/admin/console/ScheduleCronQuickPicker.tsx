"use client";

// Quick-setup controls of the §4.4 structured cron picker (design
// 2026-10-29-scheduled-jobs-design §4.4): five frequency presets whose parameters compose
// exactly the shapes the 10 registry default crons use. The dialog's `cron: string` state
// stays the single source of truth — touching any control composes the canonical form via
// composeStructured and calls onCronChange; nothing else writes.
//
// Parse-back: the controls are seeded from quickModeStructured(cron); an expression that
// fails parse-back (multi-time, offset-step, month/dual-dom-dow restriction) shows the
// neutral 매일 07:00 defaults with the unavailable hint, and the stored string is untouched
// until a control is actually changed. Toggling modes never rewrites the expression — the
// picker stays mounted (hidden), so selections survive a peek at 직접 입력.
//
// Floor by construction: the only composed form that can violate the 5-minute interval floor
// is 매분 · 매분 — that option is disabled (with the policy annotation) unless the job key is
// floor-exempt; `N분 간격` offers only 5/10/15/20/30 (45 is excluded: `*\/45` fires :00/:45,
// a 15-minute gap). The controls make the violation unreachable; the shared check decides.
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  composeStructured,
  HOUR_INTERVALS,
  MINUTE_INTERVALS,
  NEUTRAL_STRUCTURED,
  quickModeStructured,
  type CronPreset,
  type StructuredCron,
} from "../../../lib/schedule/cron-structured.ts";

const PRESETS: readonly CronPreset[] = ["every-minute", "hourly", "daily", "weekly", "monthly"];

const PRESET_LABEL_KEY = {
  "every-minute": "cronFreqEveryMinute",
  hourly: "cronFreqHourly",
  daily: "cronFreqDaily",
  weekly: "cronFreqWeekly",
  monthly: "cronFreqMonthly",
} as const;

const DOW_VALUES = [0, 1, 2, 3, 4, 5, 6] as const;
const DOW_LABEL_KEY = ["cronDow0", "cronDow1", "cronDow2", "cronDow3", "cronDow4", "cronDow5", "cronDow6"] as const;
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => h);
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => i * 5); // 0–55 step 5
const DOM_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);

const STANDARD_MINUTE_INTERVALS = new Set<number>([1, ...MINUTE_INTERVALS]);
const STANDARD_HOUR_INTERVALS = new Set<number>([1, ...HOUR_INTERVALS]);

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * The 빠른 설정 branch of ScheduleCronField. `everyMinuteAllowed` (computed in the field from
 * the exported INTERVAL_FLOOR_EXEMPT_KEYS) gates the 매분 · 매분 option; `dowEmpty` mirrors the
 * weekly-zero-days state up so the shared status slot can swap the parser error for the
 * 요일-required hint while save stays disabled through the failed check.
 */
export function ScheduleCronQuickPicker({
  idPrefix,
  everyMinuteAllowed,
  cron,
  onCronChange,
  dowEmpty,
  onDowEmpty,
}: {
  idPrefix: string;
  /** true when the job key is in INTERVAL_FLOOR_EXEMPT_KEYS — enables the 매분 · 매분 option. */
  everyMinuteAllowed: boolean;
  cron: string;
  onCronChange: (expr: string) => void;
  dowEmpty: boolean;
  /** Stable setState from the field — called on every compose and external re-seed. */
  onDowEmpty: (empty: boolean) => void;
}) {
  const t = useTranslations("admin.ops");
  // Control values are state, seeded from parse-back of the dialog's cron; a cron written by
  // someone else (key re-pick in the create dialog) re-seeds them, a cron written here does
  // not (lastComposed ref). An unrepresentable cron seeds the neutral 매일 07:00 defaults.
  const [ctrl, setCtrl] = useState<StructuredCron>(() => quickModeStructured(cron) ?? NEUTRAL_STRUCTURED);
  const lastComposed = useRef<string | null>(null);
  useEffect(() => {
    if (cron === lastComposed.current) return; // our own write — the controls already reflect it
    setCtrl(quickModeStructured(cron) ?? NEUTRAL_STRUCTURED);
    onDowEmpty(false);
  }, [cron, onDowEmpty]);

  const representable = useMemo(() => quickModeStructured(cron) !== null, [cron]);

  /** The ONE write path for valid composes: canonical form into the dialog's cron state. */
  function compose(next: StructuredCron) {
    const expr = composeStructured(next);
    lastComposed.current = expr;
    onDowEmpty(false);
    onCronChange(expr);
  }

  // 매주 requires ≥ 1 day (design §4.4): deselecting the last day composes an intentionally
  // invalid expression — the shared parser rejects it, which disables save — and the field
  // swaps the parser error for the cronDowRequired hint while dowEmpty is set.
  function changeDays(values: number[]) {
    if (ctrl.preset !== "weekly") return;
    if (values.length === 0) {
      const expr = `${ctrl.minute} ${ctrl.hour} * * `;
      lastComposed.current = expr;
      setCtrl({ ...ctrl, days: [] });
      onDowEmpty(true);
      onCronChange(expr);
      return;
    }
    compose({ ...ctrl, days: [...values].sort((a, b) => a - b) });
  }

  function switchPreset(preset: CronPreset) {
    const time = "hour" in ctrl ? { hour: ctrl.hour, minute: ctrl.minute } : { hour: 7, minute: 0 };
    if (preset === "every-minute") compose({ preset, interval: 5 });
    else if (preset === "hourly") compose({ preset, interval: 1 });
    else if (preset === "daily") compose({ preset, ...time });
    else if (preset === "weekly") compose({ preset, ...time, days: "days" in ctrl ? ctrl.days : [1] });
    else compose({ preset, ...time, day: "day" in ctrl ? ctrl.day : 1 });
  }

  function changeTime(hour: number, minute: number) {
    if (ctrl.preset === "daily") compose({ preset: "daily", hour, minute });
    else if (ctrl.preset === "weekly") compose({ ...ctrl, hour, minute });
    else if (ctrl.preset === "monthly") compose({ ...ctrl, hour, minute });
  }

  const timeSelects = "hour" in ctrl && (
    <>
      <label className="flex items-center gap-1 text-[length:var(--fs-caption)]">
        {t("cronHourLabel")}
        <select
          id={`${idPrefix}CronHour`}
          className="sizing-new-input"
          aria-label={t("cronHourLabel")}
          value={String(ctrl.hour)}
          onChange={(e) => changeTime(Number(e.target.value), ctrl.minute)}
        >
          {HOUR_OPTIONS.map((h) => (
            <option key={h} value={String(h)}>
              {pad2(h)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1 text-[length:var(--fs-caption)]">
        {t("cronMinuteLabel")}
        <select
          id={`${idPrefix}CronMinute`}
          className="sizing-new-input"
          aria-label={t("cronMinuteLabel")}
          value={String(ctrl.minute)}
          onChange={(e) => changeTime(ctrl.hour, Number(e.target.value))}
        >
          {MINUTE_OPTIONS.map((m) => (
            <option key={m} value={String(m)}>
              {pad2(m)}
            </option>
          ))}
        </select>
      </label>
      <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("cronTzNote")}</span>
    </>
  );

  return (
    <fieldset className="stack-form-row" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="mb-1 text-[length:var(--fs-caption)] font-semibold">{t("cronFreqLegend")}</legend>
      <div role="radiogroup" className="flex flex-wrap gap-x-4 gap-y-1">
        {PRESETS.map((p) => (
          <label key={p} className="flex items-center gap-1 text-[length:var(--fs-body)]">
            <input
              type="radio"
              name={`${idPrefix}CronPreset`}
              value={p}
              checked={ctrl.preset === p}
              onChange={() => switchPreset(p)}
            />
            {t(PRESET_LABEL_KEY[p])}
          </label>
        ))}
      </div>
      {ctrl.preset === "every-minute" && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${idPrefix}CronMinuteStep`} className="text-[length:var(--fs-caption)] font-semibold">
            {t("cronStepBaseMinute")}
          </label>
          <select
            id={`${idPrefix}CronMinuteStep`}
            className="sizing-new-input"
            value={String(ctrl.interval)}
            onChange={(e) => compose({ preset: "every-minute", interval: Number(e.target.value) })}
          >
            <option value="1" disabled={!everyMinuteAllowed}>
              {t("cronStepBaseMinute")}
              {everyMinuteAllowed ? "" : ` — ${t("cronFloorOptionNote")}`}
            </option>
            {MINUTE_INTERVALS.map((n) => (
              <option key={n} value={String(n)}>
                {t("cronIntervalMinutes", { p1: n })}
              </option>
            ))}
            {!STANDARD_MINUTE_INTERVALS.has(ctrl.interval) && (
              <option value={String(ctrl.interval)}>{t("cronIntervalMinutes", { p1: ctrl.interval })}</option>
            )}
          </select>
        </div>
      )}
      {ctrl.preset === "hourly" && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${idPrefix}CronHourStep`} className="text-[length:var(--fs-caption)] font-semibold">
            {t("cronStepBaseHour")}
          </label>
          <select
            id={`${idPrefix}CronHourStep`}
            className="sizing-new-input"
            value={String(ctrl.interval)}
            onChange={(e) => compose({ preset: "hourly", interval: Number(e.target.value) })}
          >
            <option value="1">{t("cronStepBaseHour")}</option>
            {HOUR_INTERVALS.map((n) => (
              <option key={n} value={String(n)}>
                {t("cronIntervalHours", { p1: n })}
              </option>
            ))}
            {!STANDARD_HOUR_INTERVALS.has(ctrl.interval) && (
              <option value={String(ctrl.interval)}>{t("cronIntervalHours", { p1: ctrl.interval })}</option>
            )}
          </select>
        </div>
      )}
      {ctrl.preset === "daily" && <div className="flex flex-wrap items-center gap-2">{timeSelects}</div>}
      {ctrl.preset === "weekly" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${idPrefix}CronDow`} className="text-[length:var(--fs-caption)] font-semibold">
              {t("cronDowLegend")}
            </label>
            <select
              id={`${idPrefix}CronDow`}
              multiple
              size={7}
              className="sizing-new-input"
              value={ctrl.days.map(String)}
              onChange={(e) => changeDays([...e.target.selectedOptions].map((o) => Number(o.value)))}
              aria-describedby={dowEmpty ? `${idPrefix}CronError` : undefined}
            >
              {DOW_VALUES.map((d) => (
                <option key={d} value={String(d)}>
                  {t(DOW_LABEL_KEY[d])}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">{timeSelects}</div>
        </>
      )}
      {ctrl.preset === "monthly" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${idPrefix}CronDom`} className="text-[length:var(--fs-caption)] font-semibold">
              {t("cronDomLabel")}
            </label>
            <select
              id={`${idPrefix}CronDom`}
              className="sizing-new-input"
              value={String(ctrl.day)}
              onChange={(e) => compose({ ...ctrl, day: Number(e.target.value) })}
            >
              {DOM_OPTIONS.map((d) => (
                <option key={d} value={String(d)}>
                  {d}
                </option>
              ))}
            </select>
            {timeSelects}
          </div>
          <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("cronDomHint")}</p>
        </>
      )}
      {!representable && !dowEmpty && (
        <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("cronQuickUnavailable")}</p>
      )}
      {representable && (
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[length:var(--fs-caption)] font-semibold">{t("cronComposedLabel")}</span>
          <code className="font-mono text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{cron}</code>
        </div>
      )}
    </fieldset>
  );
}
