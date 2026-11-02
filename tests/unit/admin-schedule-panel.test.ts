// @version 2.2.0
/**
 * /admin/schedule screen (docs/designs/2026-10-29-scheduled-jobs-design §4.3 list-and-edit +
 * the P7 remainder §4.2/§4.1) — frontend source-reading tests in the connected-apps-page.test.ts
 * pattern: the panel and its dialogs are client components bound to browser APIs, so the
 * invariants below are asserted against the source and pinned to the ko master catalog
 * (navigation.test.ts precedent).
 *
 * v1.0.0 covered the §4.3 subset: the six-column list standard, the empty-state seed button,
 * the modal-panel edit dialog, the PATCH migration of toggleJob, and the ko/en catalog entries
 * for the seeded jobs.
 * v2.0.0 covers the P7 remainder: the tick-health banner + per-job health chips (§4.2),
 * the runs detail dialog with the run-now confirm→POST→poll flow (§4.2 detail, 90 s deadline),
 * job creation against the registered-handler boundary (§4.1 POST + §5 RCE guard), the runs
 * table's migration-0183 columns (trigger/actor/env/counts/attempt/duration), and the shared
 * cron field the edit and create dialogs now validate through (one parser, one preview).
 * v2.1.0 (QA iteration 2): the edit dialog moved to ScheduleJobEditDialog.tsx (Wave U-3
 * 400-line cap) so the dialog pins read the EDIT source; the style pins were re-anchored to
 * the biome-formatted tree — the ones that span formatted line breaks match a whitespace-
 * squashed copy (squash()) instead of pinning one formatter's arbitrary wrapping; and the
 * edit payload diff gained the form-unit-dirty contract (computeJobEditPayload, unit-tested
 * below) so a sub-minute registry timeout (notify.deliver's §13.2 50 s) survives an
 * untouched save instead of being silently rewritten to 60 s.
 * v2.2.0 (§4.4 structured cron picker): the shared-field pin gains the jobKey prop both
 * dialogs now pass (the 매분·매분 option is floor-exempt per job). The §4.4 picker invariants
 * themselves live in schedule-cron-picker.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { computeJobEditPayload } from "../../app/web-next/lib/schedule/job-form.ts";

const PANEL = readFileSync("app/web-next/components/admin/console/ScheduleSection.tsx", "utf8");
const ACTIONS = readFileSync("app/web-next/components/admin/console/useAdminActions.ts", "utf8");
const LABELS = readFileSync("app/web-next/components/admin/console/admin-ui.tsx", "utf8");
const API_TYPES = readFileSync("app/web-next/lib/api.ts", "utf8");
const FORM_LIB = readFileSync("app/web-next/lib/schedule/job-form.ts", "utf8");
const CRON_FIELD = readFileSync("app/web-next/components/admin/console/ScheduleCronField.tsx", "utf8");
const HEALTH = readFileSync("app/web-next/components/admin/console/ScheduleHealth.tsx", "utf8");
const CREATE = readFileSync("app/web-next/components/admin/console/ScheduleCreateDialog.tsx", "utf8");
const RUNS = readFileSync("app/web-next/components/admin/console/ScheduleRunsDialog.tsx", "utf8");
const EDIT = readFileSync("app/web-next/components/admin/console/ScheduleJobEditDialog.tsx", "utf8");

/**
 * Whitespace-squashed copy for pins that span biome's formatted line breaks (wrapped JSX
 * attributes, wrapped call arguments). Re-pinning those to one formatter's exact wrapping is
 * what rotted them in QA iteration 1 — matching the squashed source keeps the semantic pin
 * (attribute sequence, call shape) while ignoring where the formatter breaks lines.
 */
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

function has(key: string, cat: Record<string, unknown> = en as unknown as Record<string, unknown>): boolean {
  const v = key
    .split(".")
    .reduce<unknown>(
      (acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined),
      cat,
    );
  return typeof v === "string";
}

/** The four registry jobs seeded on dev (design §4.3 live data shape) → snake_case catalog keys. */
const REGISTERED_JOBS = ["watch.evaluate", "gate_integrity.shadow_report", "notify.deliver", "notify.digest"] as const;

/** All handler keys registered in scripts/co-newbiz/jobs (extracted from the JobHandler literals). */
function registryKeysFromSources(): string[] {
  const root = "scripts/co-newbiz/jobs";
  const keys: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts")) {
        const src = readFileSync(full, "utf8");
        // Only the JobHandler constant declarations carry the registry keys
        // (`export const x: JobHandler = { key: "..."`) — every other `key:` is a different shape.
        for (const m of src.matchAll(/export const \w+: JobHandler = \{\s*\n\s*key: "([^"]+)"/g)) keys.push(m[1]);
      }
    }
  };
  walk(root);
  return keys.sort();
}

describe("schedule list columns (§4.3)", () => {
  test("the list is the list-table standard: fixed-pct + ColGroup preset + scroll wrapper", () => {
    expect(PANEL).toContain('table className="data-table list-table table-fixed-pct tmin-56"');
    expect(PANEL).toContain("<ColGroup widths={SCHEDULE_COL_PCT} />");
    const m = PANEL.match(/const SCHEDULE_COL_PCT = \[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const widths = m![1].split(",").map((x) => Number(x.trim()));
    expect(widths).toHaveLength(6); // 작업 / 스케줄 / 상태 / 다음 실행 / 최근 실행 / 작업
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
  });

  test("작업 column: catalog jobName first, DB display_name fallback, raw key in mono, description line", () => {
    expect(PANEL).toMatch(/label\("jobName", j\.job_key\)/);
    expect(PANEL).toMatch(/j\.display_name \?\? j\.job_key/); // §4.3: DB display_name is the fallback
    expect(PANEL).toMatch(/font-mono text-\[length:var\(--fs-caption\)\][^>]*>\s*\{j\.job_key\}/);
    expect(PANEL).toMatch(/label\("jobDesc", j\.job_key\)/);
    expect(koOf("admin.ops.colName")).toBe("작업");
  });

  test("스케줄 column: human cronstrue preview in the active locale + raw expr in mono", () => {
    // NOTE from the backend: the /ko subpath does not resolve — the i18n entry is "cronstrue/i18n".
    expect(PANEL).toContain('import cronstrue from "cronstrue/i18n"');
    expect(PANEL).toMatch(/cronstrue\.toString\([^)]*\{ locale: locale === "en" \? "en" : "ko" \}/);
    expect(PANEL).toMatch(/\{j\.cron_expr\}\s*<\/code>/); // formatted JSX wraps the child onto its own line
    expect(koOf("admin.ops.colCron")).toBe("스케줄");
    expect(has("admin.ops.colCron", en as unknown as Record<string, unknown>)).toBe(true);
  });

  test("상태 column keeps the existing chip and the btn-ghost two-state toggle (no switch component)", () => {
    expect(PANEL).toContain("rounded-full text-[length:var(--fs-caption)] bg-[color:var(--green-bg)]");
    expect(squash(PANEL)).toContain('className="btn-ghost" onClick={() => toggleJob(j.job_key, j.enabled !== 1)}');
    expect(PANEL).not.toMatch(/switch|Switch/);
    // toggle and chip live in the 상태 cell; the actions column is 이력 + 편집 only
    const statusCell = PANEL.slice(PANEL.indexOf('<div className="flex flex-col items-start gap-1">'));
    expect(statusCell).toContain("toggleJob");
  });

  test("다음 실행 column: next_run_at absolute + relative, em dash when disabled", () => {
    expect(PANEL).toMatch(/j\.next_run_at \? \(/);
    expect(PANEL).toMatch(/relIn\(j\.next_run_at\)/);
    expect(koOf("admin.ops.colNextRun")).toBe("다음 실행");
    expect(koOf("admin.ops.relInMinutes")).toContain("분 후");
  });

  test("최근 실행 column renders the new last_run shape (started_at, no finished_at/error)", () => {
    expect(PANEL).toMatch(/j\.last_run\.started_at/);
    expect(PANEL).not.toContain("finished_at");
    expect(PANEL).not.toContain("last_run.error");
    // the row type carries the A1 backend contract
    expect(API_TYPES).toMatch(
      /last_run: \{ started_at: string; status: string; duration_ms: number \| null \} \| null/,
    );
  });

  test("작업 column: 이력 (run history) + 편집 buttons open their dialogs with the §4.3 aria-labels", () => {
    expect(koOf("admin.ops.editJob")).toBe("편집");
    expect(koOf("admin.ops.editJobAria")).toBe("{p1} 작업 편집");
    expect(squash(PANEL)).toContain('aria-label={t("editJobAria", { p1: name })} onClick={() => openEdit(j)}');
    expect(koOf("admin.ops.runsButton")).toBe("이력");
    expect(koOf("admin.ops.runsButtonAria")).toBe("{p1} 실행 이력");
    expect(squash(PANEL)).toContain('aria-label={t("runsButtonAria", { p1: name })} onClick={() => setRunsJob(j)}');
  });

  test("console search/paging conventions: ListSearch above the table, Pager only when pages > 1", () => {
    expect(PANEL).toMatch(/<ListSearch value=\{query\} onChange=\{setQuery\} ariaLabel=\{t\("searchJobsAria"\)\}/);
    expect(squash(PANEL)).toContain("{paged.pages > 1 && ( <Pager page={paged.page}");
    expect(squash(PANEL)).toContain(
      'matchesQuery( query, j.job_key, j.display_name, j.description, label("jobName", j.job_key), label("jobDesc", j.job_key), )',
    );
  });
});

describe("empty state and seed (§4.3) + the §4.2 New job primary action", () => {
  test("keeps emptyJobs and adds the 기본 작업 등록 ghost button with a confirm dialog", () => {
    expect(koOf("admin.ops.emptyJobs")).toContain("등록된 스케줄 작업이 없습니다");
    expect(koOf("admin.ops.seedButton")).toBe("기본 작업 등록");
    expect(PANEL).toMatch(/className="btn-ghost" onClick=\{seedJobs\}/);
    expect(ACTIONS).toContain('api.post("/api/admin/schedule-jobs/seed")');
    expect(squash(ACTIONS)).toContain('confirm( t("jobSeedTitle")');
    expect(ACTIONS).toMatch(/setJobs\(null\)/); // refresh after the seed
    expect(koOf("admin.actions.jobSeedBody")).toContain("비활성 상태로 등록됩니다");
  });

  test("New job is the primary action of the populated list (§4.2: seed only when the table is empty)", () => {
    expect(koOf("admin.ops.newJob")).toBe("새 작업");
    expect(PANEL).toMatch(/className="btn-primary btn-sm" onClick=\{\(\) => setCreateOpen\(true\)\}/);
    // the seed button stays only in the jobs.length === 0 branch; New job in the toolbar row
    const emptyBranch = PANEL.slice(PANEL.indexOf("jobs.length === 0"), PANEL.indexOf("btn-primary btn-sm"));
    expect(emptyBranch).toContain("seedJobs");
    expect(emptyBranch).not.toContain("setCreateOpen");
    const created = koOf("admin.actions.jobCreatedNotice");
    expect(created).toContain("비활성 상태로 시작");
  });
});

describe("shared cron field (§4.2/§4.3: one validation+preview path for the edit and create dialogs)", () => {
  test("both dialogs validate through ScheduleCronField — the preview can never disagree between them", () => {
    // the list imports the edit dialog; the dialogs (not the list) own the shared field
    expect(PANEL).toMatch(
      /import \{ ScheduleJobEditDialog, type JobEditState \} from "\.\/ScheduleJobEditDialog\.tsx"/,
    );
    expect(EDIT).toMatch(/import \{ ScheduleCronField, useCronFieldCheck \} from "\.\/ScheduleCronField\.tsx"/);
    // §4.4: both dialogs pass jobKey — the dual-mode field gates the 매분·매분 option by job
    expect(squash(EDIT)).toContain(
      '<ScheduleCronField idPrefix="job" jobKey={state.job.job_key} cron={cron} onCronChange={setCron} check={check} />',
    );
    expect(squash(CREATE)).toContain('<ScheduleCronField idPrefix="createJob"');
    expect(CREATE).toMatch(/useCronFieldCheck\(cron\.trim\(\), jobKey \|\| null, openedAt\)/);
    expect(EDIT).toMatch(/useCronFieldCheck\(expr, state\.job\.job_key, state\.openedAt\)/);
  });

  test("cron field: advisory validateCron from the shared parser, error bound by aria-describedby", () => {
    expect(CRON_FIELD).toMatch(
      /import \{ minIntervalMinutes, nextFireTimes, validateCron \} from "\.\.\/\.\.\/\.\.\/lib\/schedule\/cron\.ts"/,
    );
    expect(CRON_FIELD).toMatch(/const check = validateCron\(expr\)/);
    expect(CRON_FIELD).toMatch(/aria-invalid=\{error !== null\}/);
    expect(CRON_FIELD).toMatch(
      /aria-describedby=\{error !== null \? `\$\{idPrefix\}CronError` : `\$\{idPrefix\}CronPreview`\}/,
    );
    expect(koOf("admin.ops.cronInvalid")).toContain("cron 식이 올바르지 않습니다");
    expect(koOf("admin.ops.cronTooFrequent")).toContain("5분 이상");
  });

  test("5-minute floor mirrors the PATCH/POST routes incl. the exempt keys, server stays authoritative", () => {
    expect(CRON_FIELD).toContain('const INTERVAL_FLOOR_EXEMPT_KEYS = new Set(["watch.evaluate", "notify.deliver"])');
    expect(CRON_FIELD).toMatch(/minIntervalMinutes\(expr, openedAt\)/);
    // the server 400 (`invalid_cron` / `cron_too_frequent`) takes the error slot when present
    expect(CRON_FIELD).toMatch(/serverCronError \?\? check\.cronError/);
    expect(CREATE).toMatch(/serverCronError=\{serverCronError\}/);
  });

  test("live human preview comes from the same cronstrue i18n entry as the list", () => {
    expect(PANEL.match(/cronstrue\.toString/g)?.length).toBeGreaterThanOrEqual(1); // list preview
    expect(CRON_FIELD.match(/cronstrue\.toString/g)?.length).toBeGreaterThanOrEqual(1); // dialog preview
    expect(koOf("admin.ops.cronPreviewLabel")).toBe("실행 주기");
  });

  test("다음 5회 실행 시각 computed client-side via the shared nextFireTimes", () => {
    expect(CRON_FIELD).toMatch(/nextFireTimes\(expr, openedAt, 5\)/);
    expect(koOf("admin.ops.nextFireTimesHeading")).toBe("다음 5회 실행 시각");
    expect(CRON_FIELD).toMatch(/formatDateTime\(d, locale\)/);
  });

  test("timeout input is minutes (1–120) stored ×60 as timeout_sec; retries 0–5", () => {
    expect(koOf("admin.ops.timeoutLabel")).toBe("실행 제한(분)");
    expect(koOf("admin.ops.retriesLabel")).toBe("실패 시 재시도 횟수");
    // the parsers live in the pure lib/schedule/job-form.ts (moved out of the field component
    // in QA iteration 2 so the payload diff and the unit tests share one module)
    expect(FORM_LIB).toMatch(/export function parseTimeoutMin/);
    expect(FORM_LIB).toMatch(/v >= 1 && v <= 120/);
    expect(FORM_LIB).toMatch(/export function parseRetries/);
    expect(FORM_LIB).toMatch(/v >= 0 && v <= 5/);
    // the edit dialog seeds its inputs from the row (minutes back from timeout_sec) and
    // parses them in ScheduleJobEditDialog.tsx
    expect(PANEL).toMatch(/Math\.round\(job\.timeout_sec \/ 60\)/);
    expect(EDIT).toMatch(/const timeoutValue = parseTimeoutMin\(timeoutMin\)/);
    expect(EDIT).toMatch(/const retriesValue = parseRetries\(retries\)/);
  });

  test("open/save flow: one primary 저장, submit disabled while invalid or saving, changed fields only", () => {
    expect(EDIT).toMatch(/const canSave = check\.ok && timeoutOk && retriesOk && !saving/);
    expect(EDIT).toMatch(/className="btn-primary" disabled=\{!canSave\}/);
    // the diff lives in the pure computeJobEditPayload helper (lib/schedule/job-form.ts,
    // unit-tested below); its payload type carries no `enabled` — saving never enables
    expect(FORM_LIB).toMatch(
      /const payload: \{ cron_expr\?: string; timeout_sec\?: number; max_retries\?: number \} = \{\}/,
    );
    expect(FORM_LIB).toMatch(/if \(expr !== job\.cron_expr\) payload\.cron_expr = expr/);
    expect(FORM_LIB).toMatch(/timeoutValue !== Math\.round\(job\.timeout_sec \/ 60\)/); // form-unit-dirty (F-3)
    expect(FORM_LIB).toMatch(/payload\.timeout_sec = timeoutValue \* 60/);
    expect(FORM_LIB).toMatch(
      /if \(retriesValue !== null && retriesValue !== job\.max_retries\) payload\.max_retries = retriesValue/,
    );
    expect(EDIT).not.toMatch(/payload\.enabled/); // saving never enables; the toggle is the separate action
    expect(EDIT).toMatch(/const payload = computeJobEditPayload\(state\.job/);
    expect(EDIT).toMatch(/void submit\(e\)/);
    // dialog closes on success, stays open with the server message on 400
    expect(EDIT).toMatch(/if \(res\.ok\) onClose\(\);\s*else setServerError\(res\.error/);
  });

  test("a disabled job stays editable — the dialog never touches enabled", () => {
    // openEdit carries no enabled flag; saveJob's payload type omits `enabled`
    expect(ACTIONS).toMatch(
      /export interface ScheduleJobUpdate \{\n {2}cron_expr\?: string;\n {2}timeout_sec\?: number;\n {2}max_retries\?: number;\n\}/,
    );
    expect(PANEL).toMatch(/onSave=\{saveJob\}/);
  });

  test("edit payload diff is form-unit-dirty: notify.deliver untouched-save sends NO timeout field (§13.2 50 s preserved)", () => {
    // notify.deliver's registry timeout is 50 s — below the 60 s input floor. The pre-2.1
    // seconds-level comparison (timeoutValue * 60 !== job.timeout_sec) turned every untouched
    // save into a silent 50→60 rewrite: Math.round(50/60)=1 min prefilled, 1*60 !== 50.
    // computeJobEditPayload compares minutes against the row's own minutes prefill instead.
    const job = { cron_expr: "* * * * *", timeout_sec: 50, max_retries: 0 };
    const untouched = {
      cron: job.cron_expr,
      timeoutMin: String(Math.round(job.timeout_sec / 60)),
      retries: String(job.max_retries),
    };
    // saving WITHOUT touching any input sends nothing at all — no timeout_sec key, so the
    // stored value stays 50 (verified against the live PATCH route in schedule-jobs-api.test.ts)
    expect(computeJobEditPayload(job, untouched)).toEqual({});
    // retyping the same prefill value is still "not edited" (compared in the form's unit)
    expect(computeJobEditPayload(job, { ...untouched, timeoutMin: "1" })).toEqual({});
    // an explicit minute edit round-trips honestly (the user chose 2 min → 120 s)
    expect(computeJobEditPayload(job, { ...untouched, timeoutMin: "2" })).toEqual({ timeout_sec: 120 });
    // cron/retries keep their exact comparisons
    expect(computeJobEditPayload(job, { ...untouched, cron: "*/2 * * * *" })).toEqual({ cron_expr: "*/2 * * * *" });
    expect(computeJobEditPayload(job, { ...untouched, retries: "3" })).toEqual({ max_retries: 3 });
    // an invalid input contributes nothing (the dialog's canSave gate blocks submit anyway)
    expect(computeJobEditPayload(job, { ...untouched, timeoutMin: "", retries: "" })).toEqual({});
    // the broken seconds-level comparison stays dead in the sources
    expect(EDIT).not.toMatch(/timeoutValue \* 60 !== /);
    expect(FORM_LIB).not.toMatch(/timeoutValue \* 60 !== /);
  });
});

describe("edit dialog container (§4.3: the §4.2 drawer realized as modal-panel + useModalFocus)", () => {
  test("dialog is the modal-panel pattern with focus management, not a drawer", () => {
    expect(EDIT).toContain("modal-backdrop");
    expect(EDIT).toMatch(/<div ref=\{panelRef\} className="modal-panel">/);
    expect(EDIT).toMatch(/useModalFocus\(onClose\)/);
    expect(EDIT).toContain('role="dialog"');
    expect(EDIT).toContain("aria-modal");
    // no drawer element exists in the codebase — assert no drawer markup was invented
    expect(EDIT).not.toMatch(/className="[^"]*drawer|<aside/);
    expect(EDIT).not.toContain("createPortal"); // AdminConsole's in-place modal precedent
  });
});

describe("PATCH migration (A1 contract)", () => {
  test("saveJob issues PATCH to [jobKey]; the UI no longer calls the legacy PUT", () => {
    expect(ACTIONS).toMatch(
      /api\.patch<ScheduleJobRow>\(`\/api\/admin\/schedule-jobs\/\$\{encodeURIComponent\(jobKey\)\}`, payload\)/,
    );
    expect(ACTIONS).not.toMatch(/api\.put\(`\/api\/admin\/schedule-jobs/); // legacy PUT toggle kept server-side only
    expect(ACTIONS).toMatch(
      /api\.patch\(`\/api\/admin\/schedule-jobs\/\$\{encodeURIComponent\(jobKey\)\}`, \{ enabled: next \}\)/,
    );
  });

  test("success toasts (ADR-0121) and refreshes the rows through the section effect", () => {
    expect(ACTIONS).toMatch(/toast\(t\("jobSavedNotice", \{ p1: jobKey \}\)\)/);
    expect(ACTIONS).toMatch(/toast\(message, "alert"\)/);
    expect(ACTIONS).toMatch(/setJobs\(null\); \/\/ re-fetch through the section effect/);
    expect(koOf("admin.actions.jobSavedNotice")).toContain("저장했습니다");
  });
});

describe("health banner and per-job chips (§4.2 banner, §6 SRE rules b+c)", () => {
  test("the health payload is polled on mount + every 60 s, scoped to the schedule section", () => {
    expect(HEALTH).toMatch(/\.get<ScheduleHealth>\("\/api\/admin\/schedule-jobs\/health"\)/);
    expect(HEALTH).toMatch(/const HEALTH_POLL_MS = 60_000/);
    expect(HEALTH).toMatch(/setInterval\(load, HEALTH_POLL_MS\)/);
    // the screen (and its poll) mounts only when section === "schedule"
    expect(PANEL).toMatch(/section === "schedule" \? <ScheduleScreen ctx=\{ctx\} \/> : null/);
    expect(PANEL).toMatch(/const health = useScheduleHealth\(true\)/);
    // a failed poll keeps the last state — the banner is advisory
    expect(HEALTH).toMatch(/\.catch\(\(\) => undefined\)/);
  });

  test("the banner renders only when the tick is unhealthy, with the runbook path in plain text", () => {
    expect(HEALTH).toMatch(/if \(tick\.healthy\) return null;/);
    expect(HEALTH).toContain('role="alert"');
    expect(koOf("admin.ops.healthBannerTitle")).toBe("스케줄러가 발화하지 않습니다");
    expect(koOf("admin.ops.healthBannerBody")).toContain("launchd 등록을 확인하세요");
    expect(HEALTH).toContain("docs/runbooks/scheduler.md");
    expect(has("admin.ops.healthBannerTitle")).toBe(true);
    expect(has("admin.ops.healthBannerBody")).toBe(true);
  });

  test("per-job chips: overdue → warning, consecutive_failures >= 3 → danger; glyph + text, not colour alone", () => {
    expect(HEALTH).toMatch(/h\.overdue &&/);
    expect(HEALTH).toMatch(/status-chip status-amber/);
    expect(HEALTH).toMatch(/h\.consecutive_failures >= 3 &&/);
    expect(HEALTH).toMatch(/status-chip status-red/);
    expect(HEALTH.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(koOf("admin.ops.chipOverdue")).toBe("예정보다 지연");
    expect(koOf("admin.ops.chipConsecutiveFailures")).toBe("{n}회 연속 실패");
    // the list merges the chips by job_key from the health payload
    expect(PANEL).toMatch(/healthMap\.get\(j\.job_key\)/);
    expect(PANEL).toContain("<ScheduleJobHealthChips");
  });

  test("the client types mirror the health endpoint shape", () => {
    expect(API_TYPES).toMatch(/export interface ScheduleHealthJob \{/);
    expect(API_TYPES).toMatch(/overdue: boolean;/);
    expect(API_TYPES).toMatch(/consecutive_failures: number;/);
    expect(API_TYPES).toMatch(
      /tick: \{ env: string; last_tick_at: string \| null; age_seconds: number \| null; healthy: boolean \};/,
    );
  });
});

describe("run-now (§4.2 detail action: confirm → POST → poll until the run lands)", () => {
  test("지금 실행 is the runs dialog's secondary action with a confirm stating pickup and disabled-run semantics", () => {
    expect(koOf("admin.ops.runNow")).toBe("지금 실행");
    expect(RUNS).toMatch(/confirm\(\s*t\("runNowTitle", \{ p1: name \}\),\s*\(\) => \{\s*void postRun\(\);\s*\},\s*\{/);
    expect(RUNS).toMatch(/body: t\("runNowBody"\)/);
    expect(koOf("admin.ops.runNowBody")).toContain("60초 이내");
    expect(koOf("admin.ops.runNowBody")).toContain("비활성화된 작업도 수동 실행");
    expect(koOf("admin.ops.runNowConfirmLabel")).toBe("실행 요청");
    // the confirm is an ordinary confirmation, not a destructive one
    expect(RUNS).toMatch(/tone: "neutral"/);
  });

  test("POST enqueues only (ADR-0019) — 202 body, then the poll flow", () => {
    expect(RUNS).toMatch(
      /api\.post<ScheduleJobRunRequest>\(`\/api\/admin\/schedule-jobs\/\$\{encodeURIComponent\(job\.job_key\)\}\/run`\)/,
    );
    expect(RUNS).toMatch(/const POLL_INTERVAL_MS = 5_000/);
    expect(RUNS).toMatch(/const POLL_DEADLINE_MS = 90_000/);
  });

  test("the poll matches a manual run newer than the request (60 s clock-skew tolerance), 90 s deadline", () => {
    expect(RUNS).toMatch(/x\.trigger === "manual" && Date\.parse\(x\.started_at\) >= runNow\.requestAtMs/);
    expect(RUNS).toMatch(/const CLOCK_SKEW_TOLERANCE_MS = 60_000/);
    expect(RUNS).toMatch(/Date\.now\(\) >= runNow\.deadlineMs/);
  });

  test("landing toasts and refreshes the list; the timeout shows the not-yet notice with a runs refresh", () => {
    expect(RUNS).toMatch(/toast\(t\("runNowLanded", \{ p1: formatDateTime\(landed\.started_at, locale\) \}\)\)/);
    expect(RUNS).toMatch(/onRan\(\)/);
    expect(koOf("admin.ops.runNowLanded")).toContain("실행이 기록되었습니다");
    expect(RUNS).toMatch(/\{runNow\?\.phase === "timeout" && \(/);
    expect(RUNS).toMatch(/role="alert"/);
    expect(koOf("admin.ops.runNowTimeout")).toContain("아직 실행되지 않았습니다");
    expect(RUNS).toMatch(/onClick=\{\(\) => setReloadKey\(\(k\) => k \+ 1\)\}\s*>\s*\{t\("runsRefresh"\)\}/);
    expect(koOf("admin.ops.runsRefresh")).toBe("실행 이력 새로고침");
    // while waiting, an explicit polite status line
    expect(RUNS).toMatch(/runNow\?\.phase === "polling" && \(\s*<p role="status"/);
    expect(koOf("admin.ops.runNowWaiting")).toContain("기다리는 중");
  });

  test("the action stays available for disabled jobs — the tooltip says manual runs work on them", () => {
    expect(RUNS).toMatch(/title=\{job\.enabled === 1 \? undefined : t\("runNowHint"\)\}/);
    expect(koOf("admin.ops.runNowHint")).toContain("비활성 작업도 수동 실행");
    expect(RUNS).toMatch(/disabled=\{busy\}/); // busy == posting/polling only, never the enabled flag
  });

  test("a failed POST surfaces the envelope error instead of entering the poll", () => {
    expect(RUNS).toMatch(/setActionError\(err instanceof Error \? err\.message : t\("runNowRequestFailed"\)\)/);
    expect(koOf("admin.ops.runNowRequestFailed")).toContain("접수되지 않았습니다");
  });
});

describe("runs detail dialog (§4.2 detail: the migration-0183 columns)", () => {
  test("the runs table is the list-table standard with nine fixed-pct columns in a scroll region", () => {
    expect(RUNS).toContain('table className="data-table list-table table-fixed-pct tmin-56"');
    expect(RUNS).toContain("<ColGroup widths={RUN_COL_PCT} />");
    const m = RUNS.match(/const RUN_COL_PCT = \[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const widths = m![1].split(",").map((x) => Number(x.trim()));
    expect(widths).toHaveLength(9); // 시각/상태/트리거/행위자/환경/처리 행/시도/소요/오류
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
    expect(RUNS).toMatch(/<div className="table-scroll" role="region"/);
    expect(RUNS).toMatch(/<th scope="col">\{t\("colRunActor"\)\}<\/th>/);
    expect(RUNS).toMatch(/<th scope="col">\{t\("colRunEnv"\)\}<\/th>/);
    expect(RUNS).toMatch(/<th scope="col">\{t\("colRunCounts"\)\}<\/th>/);
    expect(RUNS).toMatch(/<th scope="col">\{t\("colRunDuration"\)\}<\/th>/);
  });

  test("trigger renders the catalog labels (schedule/manual/catchup) or — for legacy rows", () => {
    expect(RUNS).toMatch(/r\.trigger \? label\("trigger", r\.trigger\) : "—"/);
    expect(koOf("admin.labels.trigger.schedule")).toBe("예약");
    expect(koOf("admin.labels.trigger.manual")).toBe("수동");
    expect(koOf("admin.labels.trigger.catchup")).toBe("밀린 실행");
    expect(has("admin.labels.trigger.schedule")).toBe(true);
    expect(has("admin.labels.trigger.manual")).toBe(true);
    expect(has("admin.labels.trigger.catchup")).toBe(true);
  });

  test("actor is the raw requesting-user id or — (schedule triggers carry actor NULL)", () => {
    expect(RUNS).toMatch(/r\.actor \? <code className="font-mono[^>]*>\{r\.actor\}<\/code> : "—"/);
  });

  test("env renders as a localized chip (prod/dev) or —", () => {
    expect(RUNS).toMatch(
      /r\.env \? <span className="status-chip status-gray">\{label\("env", r\.env\)\}<\/span> : "—"/,
    );
    expect(koOf("admin.labels.env.prod")).toBe("운영");
    expect(koOf("admin.labels.env.dev")).toBe("개발");
    expect(has("admin.labels.env.prod")).toBe(true);
    // the group is a registered AdminLabelGroup member
    expect(LABELS).toMatch(/"env"/);
  });

  test("counts render rows read/written/changed; attempt and duration carry their columns", () => {
    expect(RUNS).toMatch(/counts\(r\.rows_read\)\} \/ \{counts\(r\.rows_written\)\} \/ \{counts\(r\.rows_changed\)\}/);
    expect(RUNS).toMatch(/r\.attempt \?\? "—"/);
    expect(koOf("admin.ops.colRunCounts")).toContain("읽기");
    expect(koOf("admin.ops.runDurationSeconds")).toBe("{n}초");
    expect(koOf("admin.ops.runDurationMinutes")).toBe("{n}분");
    expect(RUNS).toMatch(/r\.duration < 60_000\s*\?\s*t\("runDurationSeconds"/); // formatted ternary wraps the branch
  });

  test("status chips map the migration status set incl. timeout (text + glyph, never colour alone)", () => {
    expect(RUNS).toMatch(/function runStatusChipCls\(status: string\)/);
    expect(RUNS).toMatch(/status === "failed" \|\| status === "timeout"\) return "status-red"/);
    expect(koOf("admin.labels.jobStatus.timeout")).toBe("시간 초과");
    expect(has("admin.labels.jobStatus.timeout")).toBe(true);
    expect(RUNS.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(1);
  });

  test("the scrubbed error stays expandable per row (the details/summary pattern)", () => {
    expect(RUNS).toMatch(
      /<details>\n {12}<summary className="cursor-pointer text-\[length:var\(--fs-caption\)\]">\{t\("errorToggle"\)\}<\/summary>/,
    );
    expect(RUNS).toMatch(/\{r\.error \?/);
  });

  test("paging follows the backend contract (?page=&limit=, Pager only when pages > 1)", () => {
    expect(RUNS).toMatch(/const RUNS_PAGE_SIZE = 20/);
    expect(RUNS).toMatch(/\/runs\?page=\$\{page\}&limit=\$\{RUNS_PAGE_SIZE\}/);
    expect(RUNS).toMatch(/Math\.max\(1, Math\.ceil\(data\.total \/ RUNS_PAGE_SIZE\)\)/);
    expect(RUNS).toMatch(
      /\{pages > 1 && <Pager page=\{page\} pages=\{pages\} total=\{data\.total\} onPage=\{setPage\} \/>\}/,
    );
    expect(API_TYPES).toMatch(/export interface ScheduleJobRunsPage \{/);
    expect(API_TYPES).toMatch(/total: number;/);
  });

  test("the client run-row type mirrors the endpoint columns incl. duration", () => {
    expect(API_TYPES).toMatch(/export interface ScheduleJobRun \{/);
    expect(API_TYPES).toMatch(/trigger: "schedule" \| "manual" \| "catchup" \| null;/);
    expect(API_TYPES).toMatch(/rows_changed: number \| null;/);
    expect(API_TYPES).toMatch(/duration: number \| null;/);
  });
});

describe("job creation (§4.1 POST + §5 RCE guard + §4.2 New job dialog)", () => {
  test("the dialog's key select offers ONLY registered handler keys — no free-text command field", () => {
    expect(CREATE).toMatch(/<select\s*\n\s*id="createJobKeySelect"/);
    expect(CREATE).not.toMatch(/jobKeyInput/); // no text input for the key — the §5 RCE boundary
    expect(koOf("admin.ops.createDialogAria")).toBe("새 스케줄 작업 등록");
  });

  test("the static KNOWN_HANDLERS list mirrors the registry (anti-drift pin over the JobHandler sources)", () => {
    const registryKeys = registryKeysFromSources();
    expect(registryKeys.length).toBeGreaterThanOrEqual(10); // ADR-0189 P1/P3/P5/P6 handlers
    for (const key of registryKeys) {
      expect(CREATE.includes(`key: "${key}"`), `KNOWN_HANDLERS misses registry key ${key}`).toBe(true);
    }
  });

  test("the payload is changed-fields-only against the registry defaults and never sends enabled", () => {
    expect(CREATE).toMatch(/const payload: ScheduleJobCreate = \{ job_key: handler\.key \}/);
    expect(CREATE).toMatch(/if \(cron\.trim\(\) !== handler\.defaultCron\) payload\.cron_expr = cron\.trim\(\)/);
    expect(CREATE).toMatch(
      /if \(timeoutValue \* 60 !== handler\.timeoutSec\) payload\.timeout_sec = timeoutValue \* 60/,
    );
    expect(CREATE).toMatch(/if \(retriesValue !== handler\.maxRetries\) payload\.max_retries = retriesValue/);
    expect(CREATE).not.toMatch(/enabled:/); // created rows start disabled (D3 posture)
    expect(CREATE).not.toMatch(/"enabled"/);
  });

  test("keys already registered are disabled options; the all-registered edge shows a read-only note", () => {
    expect(CREATE).toMatch(/disabled=\{existingKeys\.has\(h\.key\)\}/);
    expect(CREATE).toMatch(/createKeyRegistered/);
    expect(koOf("admin.ops.createKeyRegistered")).toBe("이미 등록됨");
    expect(CREATE).toMatch(/available\.length === 0 \?/);
    expect(koOf("admin.ops.createNoKeysAvailable")).toContain("이미 등록되어 있습니다");
  });

  test("the created-starts-disabled note is in the dialog", () => {
    expect(CREATE).toMatch(/\{t\("createDisabledNote"\)\}/);
    expect(koOf("admin.ops.createDisabledNote")).toContain("비활성 상태로 등록됩니다");
    expect(has("admin.ops.createDisabledNote")).toBe(true);
  });

  test("400/409 map onto their fields inline: handler/409 → the key field, cron codes → the cron field", () => {
    expect(CREATE).toMatch(/res\.code === "unregistered_handler" \|\| res\.code === "job_key_exists"/);
    expect(CREATE).toMatch(/setKeyError\(res\.error \?\? null\)/);
    expect(CREATE).toMatch(/res\.code === "invalid_cron" \|\| res\.code === "cron_too_frequent"/);
    expect(CREATE).toMatch(/setServerCronError\(res\.error \?\? null\)/);
    // the error messages are localized through errors.codes at the ApiError choke point
    expect(koOf("errors.codes.unregistered_handler")).toContain("등록된");
    expect(koOf("errors.codes.job_key_exists")).toContain("이미");
    expect(koOf("errors.codes.invalid_cron")).toContain("cron");
    expect(koOf("errors.codes.cron_too_frequent")).toContain("5분");
    expect(has("errors.codes.unregistered_handler")).toBe(true);
    expect(has("errors.codes.job_key_exists")).toBe(true);
    expect(has("errors.codes.invalid_cron")).toBe(true);
    expect(has("errors.codes.cron_too_frequent")).toBe(true);
  });

  test("createJob POSTs the shared endpoint, toasts, and refreshes the rows", () => {
    expect(ACTIONS).toMatch(/api\.post<ScheduleJobRow>\("\/api\/admin\/schedule-jobs", payload\)/);
    expect(ACTIONS).toMatch(/toast\(t\("jobCreatedNotice", \{ p1: payload\.job_key \}\)\)/);
    expect(ACTIONS).toMatch(/code: err instanceof ApiError \? err\.code : "unknown_error"/);
    expect(koOf("admin.actions.jobCreatedNotice")).toContain("등록했습니다");
  });

  test("the create dialog reuses the shared cron field with a distinct id prefix", () => {
    expect(CREATE).toMatch(/import \{ ScheduleCronField, useCronFieldCheck \} from "\.\/ScheduleCronField\.tsx"/);
    expect(CREATE).toMatch(
      /import \{ parseRetries, parseTimeoutMin \} from "\.\.\/\.\.\/\.\.\/lib\/schedule\/job-form\.ts"/,
    );
    expect(CREATE).toMatch(/const \[openedAt\] = useState\(\(\) => new Date\(\)\)/);
    expect(koOf("admin.ops.createSubmit")).toBe("등록");
  });
});

describe("catalog entries for the registered jobs (§4.3 ko drafts)", () => {
  test("jobName/jobDesc groups carry all four keys in ko and en, under labelKeyOf normalization", () => {
    const m = LABELS.match(/export function labelKeyOf\(code: string\): string \{\n {2}return ([^;]+);/);
    expect(m).toBeTruthy(); // snake_case normalization is what maps dotted keys to catalog keys
    for (const job of REGISTERED_JOBS) {
      const key = job.trim().replace(/[^A-Za-z0-9_]+/g, "_");
      expect(has(`admin.labels.jobName.${key}`), `ko jobName.${key}`).toBe(true);
      expect(has(`admin.labels.jobDesc.${key}`), `ko jobDesc.${key}`).toBe(true);
      expect(has(`admin.labels.jobName.${key}`, en as unknown as Record<string, unknown>), `en jobName.${key}`).toBe(
        true,
      );
      expect(has(`admin.labels.jobDesc.${key}`, en as unknown as Record<string, unknown>), `en jobDesc.${key}`).toBe(
        true,
      );
    }
  });

  test("the §4.3 drafted ko strings are pinned verbatim", () => {
    expect(koOf("admin.labels.jobName.watch_evaluate")).toBe("감시 규칙 평가");
    expect(koOf("admin.labels.jobName.notify_deliver")).toBe("알림 발송");
    expect(koOf("admin.labels.jobName.notify_digest")).toBe("알림 일일 요약");
    expect(koOf("admin.labels.jobName.gate_integrity_shadow_report")).toBe("게이트 무결성 주간 점검");
    expect(koOf("admin.labels.jobDesc.watch_evaluate")).toBe(
      "새 데이터에 감시 규칙을 평가하고 악화·기회 알림을 기록하며 일시중지된 파이프라인을 재개합니다.",
    );
    expect(koOf("admin.labels.jobDesc.notify_deliver")).toBe(
      "새 알림을 수신자·채널별 발송 행으로 확장하고 예정된 이메일·웹훅 발송을 처리합니다.",
    );
    expect(koOf("admin.labels.jobDesc.notify_digest")).toBe(
      "지난 24시간의 일일 요약 대상 알림을 한 이메일로 묶어 발송합니다.",
    );
    expect(koOf("admin.labels.jobDesc.gate_integrity_shadow_report")).toBe(
      "게이트 무결성 셰도우 감사 로그의 주간 요약 리포트를 만듭니다.",
    );
  });

  test("the jobName/jobDesc groups are registered AdminLabelGroup members", () => {
    expect(LABELS).toMatch(/"jobName"\s*\|\s*"jobDesc"/); // formatted union puts each member on its own line
  });
});
