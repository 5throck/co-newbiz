// @version 1.0.0
/**
 * Five-field cron parser and next-fire calculator (ADR-0189, scheduled-jobs design 4.1/section 3).
 *
 * ONE module for both execution (scripts/co-newbiz/schedule-tick.ts) and the future admin preview: a preview that
 * disagrees with execution is a bug, so nothing else may parse cron. Pure and dependency free.
 *
 * Fields: minute hour day-of-month month day-of-week. Supported per field: `*`, `*\/n`, `a`, `a-b`, `a-b/n`, `a/n`,
 * and comma lists of those. Day-of-week is 0-7 (0 and 7 are Sunday). When BOTH day-of-month and day-of-week are
 * restricted a time matches if EITHER matches (standard cron). Names (MON, JAN) and `@` macros are not supported.
 *
 * Time zone: Asia/Seoul (UTC+9, no DST). All matching is done on the KST wall clock; inputs and outputs are UTC
 * instants (`Date` / ISO strings).
 */

export const SCHEDULE_TZ = "Asia/Seoul";
const KST_OFFSET_MS = 9 * 3_600_000;
const MINUTE_MS = 60_000;

export interface CronSpec {
  minute: ReadonlySet<number>;
  hour: ReadonlySet<number>;
  dayOfMonth: ReadonlySet<number>;
  month: ReadonlySet<number>;
  dayOfWeek: ReadonlySet<number>;
  /** day-of-month field was not `*` */
  domRestricted: boolean;
  /** day-of-week field was not `*` */
  dowRestricted: boolean;
}

export class CronError extends Error {}

const RANGES = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 7],
} as const;

function parseField(raw: string, name: keyof typeof RANGES): { set: Set<number>; restricted: boolean } {
  const [lo, hi] = RANGES[name];
  const out = new Set<number>();
  if (raw.length === 0) throw new CronError(`empty ${name} field`);
  for (const part of raw.split(",")) {
    const m = /^(\*|\d+|\d+-\d+|\d+\/\d+|\d+-\d+\/\d+|\*\/\d+)$/.exec(part);
    if (!m) throw new CronError(`invalid ${name} field: ${part}`);
    const [base, stepRaw] = part.split("/");
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) throw new CronError(`invalid step in ${name} field: ${part}`);
    let from: number;
    let to: number;
    if (base === "*") {
      from = lo;
      to = name === "dayOfWeek" ? 6 : hi;
    } else if (base.includes("-")) {
      [from, to] = base.split("-").map(Number);
    } else {
      from = Number(base);
      to = stepRaw === undefined ? from : hi; // `a/n` means a through the maximum
    }
    if (from < lo || to > hi || from > to) throw new CronError(`${name} value out of range ${lo}-${hi}: ${part}`);
    for (let v = from; v <= to; v += step) out.add(name === "dayOfWeek" && v === 7 ? 0 : v);
  }
  return { set: out, restricted: raw !== "*" };
}

export function parseCron(expr: string): CronSpec {
  if (typeof expr !== "string") throw new CronError("cron expression must be a string");
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new CronError(`expected 5 fields, got ${parts.length}`);
  const [mi, ho, dom, mo, dow] = parts;
  const minute = parseField(mi, "minute");
  const hour = parseField(ho, "hour");
  const dayOfMonth = parseField(dom, "dayOfMonth");
  const month = parseField(mo, "month");
  const dayOfWeek = parseField(dow, "dayOfWeek");
  return {
    minute: minute.set,
    hour: hour.set,
    dayOfMonth: dayOfMonth.set,
    month: month.set,
    dayOfWeek: dayOfWeek.set,
    domRestricted: dayOfMonth.restricted,
    dowRestricted: dayOfWeek.restricted,
  };
}

export function validateCron(expr: string): { ok: true } | { ok: false; error: string } {
  try {
    parseCron(expr);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Truncate an instant to its minute boundary. */
export function floorToMinute(d: Date): Date {
  return new Date(Math.floor(d.getTime() / MINUTE_MS) * MINUTE_MS);
}

function dayMatches(spec: CronSpec, kst: Date): boolean {
  const domOk = spec.dayOfMonth.has(kst.getUTCDate());
  const dowOk = spec.dayOfWeek.has(kst.getUTCDay());
  if (spec.domRestricted && spec.dowRestricted) return domOk || dowOk;
  if (spec.domRestricted) return domOk;
  if (spec.dowRestricted) return dowOk;
  return true;
}

/** Does the given minute (an instant) fire the spec on the KST wall clock? */
export function cronMatches(spec: CronSpec, at: Date): boolean {
  const kst = new Date(floorToMinute(at).getTime() + KST_OFFSET_MS);
  return (
    spec.minute.has(kst.getUTCMinutes()) &&
    spec.hour.has(kst.getUTCHours()) &&
    spec.month.has(kst.getUTCMonth() + 1) &&
    dayMatches(spec, kst)
  );
}

/** First fire instant strictly AFTER `after`, or null when none exists within ~5 years (e.g. `0 0 31 2 *`). */
export function nextFire(spec: CronSpec, after: Date): Date | null {
  let t = floorToMinute(after).getTime() + MINUTE_MS;
  const limit = t + 5 * 366 * 86_400_000;
  while (t <= limit) {
    const kst = new Date(t + KST_OFFSET_MS);
    if (!spec.month.has(kst.getUTCMonth() + 1)) {
      // jump to the first minute of the next KST month
      t = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + 1, 1) - KST_OFFSET_MS;
      continue;
    }
    if (!dayMatches(spec, kst)) {
      t = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1) - KST_OFFSET_MS;
      continue;
    }
    if (!spec.hour.has(kst.getUTCHours())) {
      t += (60 - kst.getUTCMinutes()) * MINUTE_MS;
      continue;
    }
    if (!spec.minute.has(kst.getUTCMinutes())) {
      t += MINUTE_MS;
      continue;
    }
    return new Date(t);
  }
  return null;
}

/** The next `count` fire instants strictly after `after`. */
export function nextFireTimes(expr: string, after: Date, count: number): Date[] {
  const spec = parseCron(expr);
  const out: Date[] = [];
  let cursor = after;
  for (let i = 0; i < count; i++) {
    const n = nextFire(spec, cursor);
    if (!n) break;
    out.push(n);
    cursor = n;
  }
  return out;
}

/** Smallest gap, in minutes, between consecutive fires over the next 400 fires (for the admin interval floor). */
export function minIntervalMinutes(expr: string, from: Date): number | null {
  const times = nextFireTimes(expr, from, 400);
  if (times.length < 2) return null;
  let min = Infinity;
  for (let i = 1; i < times.length; i++) min = Math.min(min, (times[i].getTime() - times[i - 1].getTime()) / MINUTE_MS);
  return min;
}
