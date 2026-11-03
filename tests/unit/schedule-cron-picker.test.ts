// @version 1.0.0
/**
 * §4.4 structured cron picker (design 2026-10-29-scheduled-jobs-design §4.4):
 * - cron-structured unit tests: parseToStructured / composeStructured / quickModeStructured,
 *   including the dual day-of-month + day-of-week and `0 8,12 * * *` → null cases;
 * - the 10 registry-cron round-trip cases pinned against the scripts/co-newbiz/jobs/**
 *   sources (same anti-drift pattern as the KNOWN_HANDLERS pin in admin-schedule-panel.test.ts);
 * - the 45-minute exclusion and the offer-list policy, asserted on the pure offer lists;
 * - the picker/field source pins (client components, so invariants read the sources, per the
 *   admin-schedule-panel.test.ts pattern): 매분·매분 disabled for non-exempt keys,
 *   no-rewrite-on-toggle, unrepresentable-expr neutral state, one preview path, jobKey wiring,
 *   and the §4.4 ko drafts pinned verbatim with the en mirror.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  composeStructured,
  HOUR_INTERVALS,
  MINUTE_INTERVALS,
  NEUTRAL_STRUCTURED,
  parseToStructured,
  quickModeStructured,
  type StructuredCron,
} from "../../app/web-next/lib/schedule/cron-structured.ts";

const FIELD = readFileSync("app/web-next/components/admin/console/ScheduleCronField.tsx", "utf8");
const PICKER = readFileSync("app/web-next/components/admin/console/ScheduleCronQuickPicker.tsx", "utf8");
const EDIT = readFileSync("app/web-next/components/admin/console/ScheduleJobEditDialog.tsx", "utf8");
const CREATE = readFileSync("app/web-next/components/admin/console/ScheduleCreateDialog.tsx", "utf8");

/** Whitespace-squashed pinning (admin-schedule-panel.test.ts pattern): semantic shape, not formatter wrapping. */
const squash = (s: string) => s.replace(/\s+/g, " ");

// ko is the master catalog (design D2) — literal contracts pin the ko value.
import ko from "../../app/web-next/locales/ko.json";
import en from "../../app/web-next/locales/en.json";

function koOf(key: string): string {
  const v = key
    .split(".")
    .reduce<unknown>(
      (acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined),
      ko,
    );
  if (typeof v !== "string") throw new Error(`ko catalog key not found: ${key}`);
  return v;
}

function has(key: string, cat: Record<string, unknown>): boolean {
  const v = key
    .split(".")
    .reduce<unknown>(
      (acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined),
      cat,
    );
  return typeof v === "string";
}

describe("cron-structured: parseToStructured (§4.4 classification)", () => {
  test("the five presets classify their composed shapes", () => {
    expect(parseToStructured("* * * * *")).toEqual({ preset: "every-minute", interval: 1 });
    expect(parseToStructured("*/30 * * * *")).toEqual({ preset: "every-minute", interval: 30 });
    expect(parseToStructured("0-59 * * * *")).toEqual({ preset: "every-minute", interval: 1 }); // set-based, not byte-based
    expect(parseToStructured("0 * * * *")).toEqual({ preset: "hourly", interval: 1 });
    expect(parseToStructured("0 */6 * * *")).toEqual({ preset: "hourly", interval: 6 });
    expect(parseToStructured("0 8 * * *")).toEqual({ preset: "daily", hour: 8, minute: 0 });
    expect(parseToStructured("30 8 * * *")).toEqual({ preset: "daily", hour: 8, minute: 30 });
    expect(parseToStructured("0 7 * * 1-5")).toEqual({
      preset: "weekly",
      days: [1, 2, 3, 4, 5],
      hour: 7,
      minute: 0,
    });
    expect(parseToStructured("0 9 * * 1")).toEqual({ preset: "weekly", days: [1], hour: 9, minute: 0 });
    expect(parseToStructured("0 7 * * 7")).toEqual({ preset: "weekly", days: [0], hour: 7, minute: 0 }); // 7 → Sunday
    expect(parseToStructured("0 3 15 * *")).toEqual({ preset: "monthly", day: 15, hour: 3, minute: 0 });
  });

  test("unrepresentable shapes → null (multi-time, offset-step, month, dual dom+dow)", () => {
    expect(parseToStructured("0 8,12 * * *")).toBeNull(); // multi-time
    expect(parseToStructured("5,35 * * * *")).toBeNull(); // offset steps
    expect(parseToStructured("0 0 31 2 *")).toBeNull(); // month restriction + dual dom+dow
    expect(parseToStructured("0 7 1 * 1")).toBeNull(); // dual dom + dow restriction
    expect(parseToStructured("*/15 8 * * *")).toBeNull(); // step minute + single hour
    expect(parseToStructured("0 7 1-15 * *")).toBeNull(); // dom range has no single-날짜 select
  });

  test("weekly accepts any non-empty day set (multi-select), not just runs", () => {
    // correction to the case above: `1,3` is a legal multi-select state
    expect(parseToStructured("0 7 * * 1,3")).toEqual({ preset: "weekly", days: [1, 3], hour: 7, minute: 0 });
    expect(parseToStructured("30 18 * * 0-6")).toEqual({
      preset: "weekly",
      days: [0, 1, 2, 3, 4, 5, 6],
      hour: 18,
      minute: 30,
    });
  });

  test("malformed expressions → null (the shared parser decides)", () => {
    expect(parseToStructured("garbage")).toBeNull();
    expect(parseToStructured("0 7 * *")).toBeNull(); // 4 fields
    expect(parseToStructured("60 7 * * *")).toBeNull(); // out of range
  });
});

describe("cron-structured: composeStructured (canonical rendering)", () => {
  test("day-of-week: `a-b` for a run of ≥ 3 consecutive days, else sorted comma list", () => {
    expect(composeStructured({ preset: "weekly", days: [1, 2, 3, 4, 5], hour: 7, minute: 0 })).toBe("0 7 * * 1-5");
    expect(composeStructured({ preset: "weekly", days: [0, 6], hour: 7, minute: 0 })).toBe("0 7 * * 0,6");
    expect(composeStructured({ preset: "weekly", days: [3], hour: 7, minute: 0 })).toBe("0 7 * * 3");
    expect(composeStructured({ preset: "weekly", days: [0, 1, 2, 5], hour: 7, minute: 0 })).toBe("0 7 * * 0-2,5");
    expect(composeStructured({ preset: "weekly", days: [5, 6, 0], hour: 7, minute: 0 })).toBe("0 7 * * 0,5,6"); // runs of 2 stay a comma list
  });

  test("interval/daily/monthly canonical forms", () => {
    expect(composeStructured({ preset: "every-minute", interval: 1 })).toBe("* * * * *");
    expect(composeStructured({ preset: "every-minute", interval: 30 })).toBe("*/30 * * * *");
    expect(composeStructured({ preset: "hourly", interval: 1 })).toBe("0 * * * *");
    expect(composeStructured({ preset: "hourly", interval: 12 })).toBe("0 */12 * * *");
    expect(composeStructured({ preset: "daily", hour: 7, minute: 5 })).toBe("5 7 * * *");
    expect(composeStructured({ preset: "monthly", day: 1, hour: 3, minute: 0 })).toBe("0 3 1 * *");
  });
});

describe("cron-structured: quickModeStructured (the parse-back gate)", () => {
  test("representable expressions pass with a semantically identical canonical recomposition", () => {
    expect(quickModeStructured("0 7 * * 1-5")).toEqual({
      preset: "weekly",
      days: [1, 2, 3, 4, 5],
      hour: 7,
      minute: 0,
    });
    expect(quickModeStructured("0 7 * * 7")).toEqual({ preset: "weekly", days: [0], hour: 7, minute: 0 }); // 7 → 0, sets equal
    expect(quickModeStructured("*/1 * * * *")).toEqual({ preset: "every-minute", interval: 1 }); // → `* * * * *`, sets equal
  });

  test("expressions failing parse-back → null/neutral (design §4.4 examples)", () => {
    expect(quickModeStructured("0 8,12 * * *")).toBeNull();
    expect(quickModeStructured("0 0 31 2 *")).toBeNull();
  });

  test("dom-restricted-to-full-range stays neutral (restriction flags are part of the identity)", () => {
    expect(quickModeStructured("0 7 1-31 * *")).toBeNull();
  });

  test("`*/45 * * * *` still parses back (parse-back must not lose it; the OFFER list excludes 45)", () => {
    expect(quickModeStructured("*/45 * * * *")).toEqual({ preset: "every-minute", interval: 45 });
  });

  test("neutral defaults are 매일 07:00", () => {
    expect(NEUTRAL_STRUCTURED).toEqual({ preset: "daily", hour: 7, minute: 0 });
  });
});

describe("interval offer lists (45-minute exclusion, floor by construction)", () => {
  test("N분 간격 offers exactly 5/10/15/20/30 — divisors of 60 that are ≥ 5, never 45", () => {
    expect([...MINUTE_INTERVALS]).toEqual([5, 10, 15, 20, 30]);
    for (const n of MINUTE_INTERVALS) {
      expect(n >= 5, `interval ${n} must be ≥ the 5-minute floor`).toBe(true);
      expect(60 % n, `interval ${n} must divide 60`).toBe(0);
    }
    expect(MINUTE_INTERVALS.includes(45 as (typeof MINUTE_INTERVALS)[number])).toBe(false); // */45: :00/:45 = 15-minute gap
  });

  test("N시간 간격 offers exactly 2/3/4/6/12 — fires ≥ 1 hour apart by construction", () => {
    expect([...HOUR_INTERVALS]).toEqual([2, 3, 4, 6, 12]);
    for (const n of HOUR_INTERVALS) expect(n >= 1).toBe(true);
  });

  test("the picker renders the offer lists from the pure lib (no local copy to drift)", () => {
    expect(PICKER).toMatch(
      /import \{[\s\S]*?MINUTE_INTERVALS[\s\S]*?from "\.\.\/\.\.\/\.\.\/lib\/schedule\/cron-structured\.ts"/,
    );
    expect(PICKER).toMatch(/MINUTE_INTERVALS\.map/);
    expect(PICKER).toMatch(/HOUR_INTERVALS\.map/);
  });
});

/** The §4.4 round-trip table: registry key → pinned cron, quick rendering, canonical regeneration. */
const EXPECTED_ROUND_TRIP: Record<string, { cron: string; structured: StructuredCron; regenerated: string }> = {
  "collect.dart": {
    cron: "0 7 * * 1-5",
    structured: { preset: "weekly", days: [1, 2, 3, 4, 5], hour: 7, minute: 0 },
    regenerated: "0 7 * * 1-5",
  },
  "collect.ecos": { cron: "0 8 * * *", structured: { preset: "daily", hour: 8, minute: 0 }, regenerated: "0 8 * * *" },
  "collect.krx": {
    cron: "30 18 * * 1-5",
    structured: { preset: "weekly", days: [1, 2, 3, 4, 5], hour: 18, minute: 30 },
    regenerated: "30 18 * * 1-5",
  },
  "collect.kosis": {
    cron: "0 9 * * 1",
    structured: { preset: "weekly", days: [1], hour: 9, minute: 0 },
    regenerated: "0 9 * * 1",
  },
  "collect.law": { cron: "0 6 * * *", structured: { preset: "daily", hour: 6, minute: 0 }, regenerated: "0 6 * * *" },
  "gate_integrity.shadow_report": {
    cron: "0 8 * * 1",
    structured: { preset: "weekly", days: [1], hour: 8, minute: 0 },
    regenerated: "0 8 * * 1",
  },
  "notify.deliver": {
    cron: "* * * * *",
    structured: { preset: "every-minute", interval: 1 },
    regenerated: "* * * * *",
  },
  "notify.digest": {
    cron: "30 8 * * *",
    structured: { preset: "daily", hour: 8, minute: 30 },
    regenerated: "30 8 * * *",
  },
  "retention.cleanup": {
    cron: "0 3 * * *",
    structured: { preset: "daily", hour: 3, minute: 0 },
    regenerated: "0 3 * * *",
  },
  "watch.evaluate": {
    cron: "*/30 * * * *",
    structured: { preset: "every-minute", interval: 30 },
    regenerated: "*/30 * * * *",
  },
};

/** Registry (key, defaultCron) pairs read straight from the JobHandler sources (panel-test walk). */
function registryCronsFromSources(): Array<{ key: string; cron: string }> {
  const root = "scripts/co-newbiz/jobs";
  const out: Array<{ key: string; cron: string }> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (full.endsWith(".ts")) {
        const src = readFileSync(full, "utf8");
        if (!/export const \w+: JobHandler = \{/.test(src)) continue;
        const key = /export const \w+: JobHandler = \{\s*\n\s*key: "([^"]+)"/.exec(src)?.[1];
        const cron = /defaultCron: "([^"]+)"/.exec(src)?.[1];
        if (key && cron) out.push({ key, cron });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

describe("registry round-trip pin (§4.4 table vs scripts/co-newbiz/jobs sources)", () => {
  test("every registered handler has a pinned expectation and vice versa (anti-drift both ways)", () => {
    const registry = registryCronsFromSources();
    expect(registry.length).toBeGreaterThanOrEqual(10); // ADR-0189 P1/P3/P5/P6 handlers
    const registryKeys = registry.map((r) => r.key).sort();
    expect(registryKeys).toEqual(Object.keys(EXPECTED_ROUND_TRIP).sort());
  });

  test("all 10 registry default crons open quick mode and regenerate canonically", () => {
    for (const { key, cron } of registryCronsFromSources()) {
      const expected = EXPECTED_ROUND_TRIP[key];
      expect(expected, `no §4.4 expectation pinned for ${key}`).toBeTruthy();
      // the registry's default cron has not drifted from the design table
      expect(cron, `${key} registry cron drifted`).toBe(expected.cron);
      // quick rendering: parse-back classifies it
      expect(quickModeStructured(cron), `${key} must open in quick mode`).toEqual(expected.structured);
      // regeneration check: the canonical recomposition reproduces the table's regenerated form
      expect(composeStructured(expected.structured), `${key} regeneration drifted`).toBe(expected.regenerated);
      // and the composed form round-trips through the shared parser's semantics (quick gate)
      expect(
        quickModeStructured(composeStructured(expected.structured)) ?? null,
        `${key} composed form must parse back`,
      ).toEqual(expected.structured);
    }
  });
});

describe("dual-mode field source pins (§4.4 invariants over the client sources)", () => {
  test("quick mode is the opening mode; the mode radios only switch rendering (no-rewrite-on-toggle)", () => {
    expect(FIELD).toContain('useState<"quick" | "text">("quick")');
    expect(squash(FIELD)).toContain('value="quick" checked={mode === "quick"} onChange={() => setMode("quick")}');
    expect(squash(FIELD)).toContain('value="text" checked={mode === "text"} onChange={() => setMode("text")}');
    // the radio handlers reference setMode only — no onCronChange anywhere in the mode fieldset
    const modeFieldset = FIELD.slice(
      FIELD.search(/name=\{`\$\{idPrefix\}CronMode`\}/),
      FIELD.indexOf("</fieldset>") + 11,
    );
    expect(modeFieldset).not.toContain("onCronChange");
    expect(modeFieldset).toContain("setMode");
  });

  test("매분·매분 option: disabled with the policy annotation unless the key is floor-exempt", () => {
    // the gate is the exported INTERVAL_FLOOR_EXEMPT_KEYS (content pinned in admin-schedule-panel.test.ts)
    expect(FIELD).toContain("everyMinuteAllowed={jobKey !== null && INTERVAL_FLOOR_EXEMPT_KEYS.has(jobKey)}");
    expect(squash(PICKER)).toContain("disabled={!everyMinuteAllowed}");
    expect(PICKER).toContain("cronFloorOptionNote"); // the annotation rides on the disabled option text
  });

  test("every compose flows through composeStructured — the picker never invents expressions", () => {
    expect(PICKER).toMatch(/const expr = composeStructured\(next\);/);
    expect(PICKER.match(/onCronChange\(/g)?.length).toBe(2); // compose() + the weekly zero-days path
  });

  test("weekly zero-days composes intentionally-invalid and flips the field to the 요일 hint", () => {
    expect(squash(PICKER)).toMatch(/const expr = `\$\{ctrl\.minute\} \$\{ctrl\.hour\} \* \* `/);
    expect(PICKER).toContain("onDowEmpty(true)");
    // the shared slot swaps the parser error for the hint text in quick mode
    expect(FIELD).toMatch(/mode === "quick" && dowEmpty \? t\("cronDowRequired"\)/);
    // the server verdict still wins over the swap
    expect(FIELD).toMatch(/serverCronError \?\? check\.cronError/);
  });

  test("unrepresentable expressions open quick mode in the neutral state, stored string untouched", () => {
    expect(PICKER).toMatch(/quickModeStructured\(cron\) \?\? NEUTRAL_STRUCTURED/);
    expect(PICKER).toContain('t("cronQuickUnavailable")');
    // the composed-cron mono line renders only when the expression is representable
    expect(PICKER).toMatch(/representable && \(/);
    expect(PICKER).toContain('t("cronComposedLabel")');
    expect(PICKER).toMatch(/<code className="font-mono/);
  });

  test("one preview path: the shared slot is aria-live and both modes feed the same check", () => {
    expect(FIELD).toContain('<div aria-live="polite">');
    expect(squash(FIELD)).toMatch(
      /aria-describedby=\{error !== null \? `\$\{idPrefix\}CronError` : `\$\{idPrefix\}CronPreview`\}/,
    );
  });

  test("both dialogs pass jobKey — floor exemptions react to the key choice in the create dialog", () => {
    expect(squash(EDIT)).toContain(
      '<ScheduleCronField idPrefix="job" jobKey={state.job.job_key} cron={cron} onCronChange={setCron} check={check} />',
    );
    expect(CREATE).toContain("jobKey={jobKey || null}");
  });

  test("accessibility: fieldset+legend+radiogroup pattern, labelled selects, KST note, dow required hint", () => {
    expect(FIELD).toMatch(/<fieldset[^>]*>/);
    expect(FIELD).toMatch(
      /<legend className="mb-1 text-\[length:var\(--fs-caption\)\] font-semibold">\{t\("cronModeLegend"\)\}<\/legend>/,
    );
    expect(FIELD).toContain('role="radiogroup"');
    expect(PICKER).toContain('role="radiogroup"');
    // every parameter is a native <select>; the dow is a checkbox chip group (§4.4 a11y update)
    expect(PICKER.match(/<select/g)?.length).toBeGreaterThanOrEqual(5);
    expect(PICKER).toContain('t("cronTzNote")');
    expect(PICKER).toContain('t("cronDomHint")');
    // the dow chip group is labelled via aria-labelledby + sr-only checkboxes (replaces the multiple select)
    expect(PICKER).toContain('aria-labelledby={`${idPrefix}CronDow`}');
    expect(PICKER).toContain('className="sr-only"');
    expect(PICKER).toContain('type="checkbox"'); // one literal inside the DOW map — 7 chips at runtime
    // frequency + mode radio labels render on one line (owner-reported squish fix)
    expect(PICKER).toContain("whitespace-nowrap");
    expect(FIELD).toContain("whitespace-nowrap");
  });
});

/** The 31 §4.4 admin.ops.cron* keys (design ko drafts — count per the design block). */
const CRON_KEYS = [
  "cronModeLegend",
  "cronModeQuick",
  "cronModeText",
  "cronQuickUnavailable",
  "cronFreqLegend",
  "cronFreqEveryMinute",
  "cronFreqHourly",
  "cronFreqDaily",
  "cronFreqWeekly",
  "cronFreqMonthly",
  "cronStepBaseMinute",
  "cronStepBaseHour",
  "cronIntervalMinutes",
  "cronIntervalHours",
  "cronTimeLabel",
  "cronHourLabel",
  "cronMinuteLabel",
  "cronTzNote",
  "cronDowLegend",
  "cronDow0",
  "cronDow1",
  "cronDow2",
  "cronDow3",
  "cronDow4",
  "cronDow5",
  "cronDow6",
  "cronDowRequired",
  "cronDomLabel",
  "cronDomHint",
  "cronComposedLabel",
  "cronFloorOptionNote",
] as const;

describe("i18n: the §4.4 admin.ops.cron* keys (ko source pinned, en mirrored)", () => {
  test("every key exists in ko and en with parity", () => {
    for (const key of CRON_KEYS) {
      expect(has(`admin.ops.${key}`, en as unknown as Record<string, unknown>), `en missing admin.ops.${key}`).toBe(
        true,
      );
    }
    expect(CRON_KEYS).toHaveLength(31);
  });

  test("the §4.4 drafted ko strings are pinned verbatim (ko master catalog)", () => {
    expect(koOf("admin.ops.cronModeLegend")).toBe("입력 방식");
    expect(koOf("admin.ops.cronModeQuick")).toBe("빠른 설정");
    expect(koOf("admin.ops.cronModeText")).toBe("직접 입력");
    expect(koOf("admin.ops.cronQuickUnavailable")).toBe(
      "현재 cron 식은 빠른 설정으로 편집할 수 없습니다. 직접 입력을 사용하거나 값을 다시 구성하세요.",
    );
    expect(koOf("admin.ops.cronFreqLegend")).toBe("빈도");
    expect(koOf("admin.ops.cronFreqEveryMinute")).toBe("매분");
    expect(koOf("admin.ops.cronFreqHourly")).toBe("매시간");
    expect(koOf("admin.ops.cronFreqDaily")).toBe("매일");
    expect(koOf("admin.ops.cronFreqWeekly")).toBe("매주");
    expect(koOf("admin.ops.cronFreqMonthly")).toBe("매월");
    expect(koOf("admin.ops.cronStepBaseMinute")).toBe("매분");
    expect(koOf("admin.ops.cronStepBaseHour")).toBe("매시간");
    expect(koOf("admin.ops.cronIntervalMinutes")).toBe("{p1}분 간격");
    expect(koOf("admin.ops.cronIntervalHours")).toBe("{p1}시간 간격");
    expect(koOf("admin.ops.cronTimeLabel")).toBe("시각");
    expect(koOf("admin.ops.cronHourLabel")).toBe("시");
    expect(koOf("admin.ops.cronMinuteLabel")).toBe("분");
    expect(koOf("admin.ops.cronTzNote")).toBe("한국시간(KST) 기준");
    expect(koOf("admin.ops.cronDowLegend")).toBe("요일");
    expect(koOf("admin.ops.cronDow0")).toBe("일요일");
    expect(koOf("admin.ops.cronDow1")).toBe("월요일");
    expect(koOf("admin.ops.cronDow2")).toBe("화요일");
    expect(koOf("admin.ops.cronDow3")).toBe("수요일");
    expect(koOf("admin.ops.cronDow4")).toBe("목요일");
    expect(koOf("admin.ops.cronDow5")).toBe("금요일");
    expect(koOf("admin.ops.cronDow6")).toBe("토요일");
    expect(koOf("admin.ops.cronDowRequired")).toBe("요일을 한 개 이상 선택하세요.");
    expect(koOf("admin.ops.cronDomLabel")).toBe("날짜");
    expect(koOf("admin.ops.cronDomHint")).toBe("29일~31일은 해당 날짜가 없는 달에는 실행되지 않습니다.");
    expect(koOf("admin.ops.cronComposedLabel")).toBe("생성되는 cron 식");
    expect(koOf("admin.ops.cronFloorOptionNote")).toBe("정책: 최소 5분 간격");
  });
});
