// @version 1.0.0
/**
 * Structured classification and canonical composition of the quick-setup cron presets
 * (design 2026-10-29-scheduled-jobs-design §4.4). Pure and dependency free except parseCron —
 * lib/schedule/cron.ts stays the ONLY cron parser (the one-parser rule): everything here
 * classifies expressions or renders strings the shared parser already accepts, it adds no
 * grammar, and every composed result still goes through the unchanged useCronFieldCheck.
 *
 * The five quick-setup presets and their canonical shapes:
 *   every-minute  interval 1 → `* * * * *`      interval N → `*\/N * * * *`
 *   hourly        interval 1 → `0 * * * *`      interval N → `0 *\/N * * *`
 *   daily         M H * * *
 *   weekly        M H * * <dow>   (dow: `a-b` for a run of ≥ 3 consecutive days, else a
 *                                  sorted comma list; a single day is a bare number)
 *   monthly       M H D * *
 *
 * Multi-time or offset-step schedules (`0 8,12 * * *`, `5,35 * * * *`), month restriction,
 * and dual day-of-month + day-of-week restriction stay quick-mode-unrepresentable and are
 * edited in 직접 입력 (design §4.4 known limitation; no registry cron uses them).
 */

import { CronError, parseCron, type CronSpec } from "./cron.ts";

export type CronPreset = "every-minute" | "hourly" | "daily" | "weekly" | "monthly";

export type StructuredCron =
  | { preset: "every-minute" /** 1 = `* * * * *`, N = `*\/N * * * *` */; interval: number }
  | { preset: "hourly" /** 1 = `0 * * * *`, N = `0 *\/N * * *` */; interval: number }
  | { preset: "daily"; hour: number; minute: number }
  | {
      preset: "weekly";
      /** day-of-week values 0 (Sunday) – 6 (Saturday), sorted ascending; ≥ 1 entry */
      days: number[];
      hour: number;
      minute: number;
    }
  | { preset: "monthly" /** day-of-month 1–31 */; day: number; hour: number; minute: number };

/** Neutral quick-setup defaults for expressions that fail parse-back (design §4.4): 매일 07:00. */
export const NEUTRAL_STRUCTURED: StructuredCron = { preset: "daily", hour: 7, minute: 0 };

/**
 * 매분 · `N분 간격` offer list (design §4.4): divisors of 60 that are ≥ 5. 45 is excluded even
 * though it is ≥ 5: `*\/45` fires :00/:45 — a 15-minute gap. The 매분 base option (`* * * * *`,
 * interval 1) is rendered separately, disabled unless the job key is floor-exempt.
 */
export const MINUTE_INTERVALS = [5, 10, 15, 20, 30] as const;

/** 매시간 · `N시간 간격` offer list (design §4.4) — every form fires ≥ 1 hour apart by construction. */
export const HOUR_INTERVALS = [2, 3, 4, 6, 12] as const;

function isFull(set: ReadonlySet<number>, lo: number, hi: number): boolean {
  if (set.size !== hi - lo + 1) return false;
  for (let v = lo; v <= hi; v++) if (!set.has(v)) return false;
  return true;
}

function singleValue(set: ReadonlySet<number>): number | null {
  return set.size === 1 ? [...set][0] : null;
}

/** n when the set is exactly `{0, n, 2n, ...}` (an arithmetic `*\/n` field), else null. */
function stepFromZero(set: ReadonlySet<number>, max: number): number | null {
  if (set.size < 2 || !set.has(0)) return null;
  const values = [...set].sort((a, b) => a - b);
  const n = values[1];
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== i * n) return null;
  }
  return n <= max ? n : null;
}

function setsEqual(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * Matching under parseCron depends on the five field sets plus the day-of-month/day-of-week
 * restriction flags (both restricted = OR logic). A canonical recomposition must preserve all
 * of them — that is why `0 7 1-31 * *` (dom restricted to the full range) stays neutral
 * instead of collapsing to `0 7 * * *`.
 */
function specsEquivalent(a: CronSpec, b: CronSpec): boolean {
  return (
    setsEqual(a.minute, b.minute) &&
    setsEqual(a.hour, b.hour) &&
    setsEqual(a.dayOfMonth, b.dayOfMonth) &&
    setsEqual(a.month, b.month) &&
    setsEqual(a.dayOfWeek, b.dayOfWeek) &&
    a.domRestricted === b.domRestricted &&
    a.dowRestricted === b.dowRestricted
  );
}

function classify(spec: CronSpec): StructuredCron | null {
  if (!isFull(spec.month, 1, 12)) return null; // month restriction is unrepresentable
  const minuteSingle = singleValue(spec.minute);
  const hourSingle = singleValue(spec.hour);

  if (spec.domRestricted !== spec.dowRestricted) {
    // weekly (dow restricted only) / monthly (dom restricted only) still need one fire time
    if (minuteSingle === null || hourSingle === null) return null;
    if (spec.dowRestricted) {
      return {
        preset: "weekly",
        days: [...spec.dayOfWeek].sort((a, b) => a - b),
        hour: hourSingle,
        minute: minuteSingle,
      };
    }
    const day = singleValue(spec.dayOfMonth);
    if (day === null) return null; // dom ranges/lists have no single-날짜 select
    return { preset: "monthly", day, hour: hourSingle, minute: minuteSingle };
  }
  if (spec.domRestricted && spec.dowRestricted) return null; // dual dom+dow restriction
  // both day fields unrestricted
  const minuteStep = stepFromZero(spec.minute, 59);
  if (minuteStep !== null) {
    if (!isFull(spec.hour, 0, 23)) return null;
    return { preset: "every-minute", interval: minuteStep };
  }
  if (setsEqual(spec.minute, new Set([0]))) {
    const hourStep = stepFromZero(spec.hour, 23);
    if (isFull(spec.hour, 0, 23)) return { preset: "hourly", interval: 1 };
    if (hourStep !== null) return { preset: "hourly", interval: hourStep };
    if (hourSingle !== null) return { preset: "daily", hour: hourSingle, minute: 0 };
    return null;
  }
  if (minuteSingle !== null && hourSingle !== null) {
    return { preset: "daily", hour: hourSingle, minute: minuteSingle };
  }
  return null;
}

/** Classify an expression into one of the five presets, or null when it matches none. */
export function parseToStructured(expr: string): StructuredCron | null {
  let spec: CronSpec;
  try {
    spec = parseCron(expr);
  } catch (e) {
    if (e instanceof CronError) return null;
    throw e;
  }
  return classify(spec);
}

/** Canonical 5-field rendering of a structured value (forms listed in the module docblock). */
export function composeStructured(s: StructuredCron): string {
  switch (s.preset) {
    case "every-minute":
      return s.interval === 1 ? "* * * * *" : `*/${s.interval} * * * *`;
    case "hourly":
      return s.interval === 1 ? "0 * * * *" : `0 */${s.interval} * * *`;
    case "daily":
      return `${s.minute} ${s.hour} * * *`;
    case "monthly":
      return `${s.minute} ${s.hour} ${s.day} * *`;
    case "weekly":
      return `${s.minute} ${s.hour} * * ${renderDayOfWeek(s.days)}`;
  }
}

/** `a-b` for a run of ≥ 3 consecutive days (matches the registry's `1-5`), else a sorted comma list. */
function renderDayOfWeek(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j - i + 1 >= 3) {
      parts.push(`${sorted[i]}-${sorted[j]}`);
    } else {
      for (let k = i; k <= j; k++) parts.push(String(sorted[k]));
    }
    i = j + 1;
  }
  return parts.join(",");
}

/**
 * The §4.4 parse-back gate: an expression opens in quick mode iff parseToStructured classifies
 * it AND the canonical recomposition is semantically identical (same five field sets plus the
 * dom/dow restriction flags under parseCron — NOT byte equality).
 */
export function quickModeStructured(expr: string): StructuredCron | null {
  let original: CronSpec;
  try {
    original = parseCron(expr);
  } catch (e) {
    if (e instanceof CronError) return null;
    throw e;
  }
  const structured = parseToStructured(expr);
  if (structured === null) return null;
  let recomposed: CronSpec;
  try {
    recomposed = parseCron(composeStructured(structured));
  } catch (e) {
    if (e instanceof CronError) return null;
    throw e;
  }
  return specsEquivalent(original, recomposed) ? structured : null;
}
