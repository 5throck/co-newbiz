// @version 1.0.0
/**
 * /admin/schedule list-and-edit screen (docs/designs/2026-10-29-scheduled-jobs-design §4.3,
 * the pulled-forward P7 subset) — frontend source-reading tests in the connected-apps-page.test.ts
 * pattern: the panel is a client component bound to browser APIs, so the invariants below are
 * asserted against the source and pinned to the ko master catalog (navigation.test.ts precedent).
 *
 * Covered: the six-column list standard (readable job name + raw key + description, cronstrue
 * human preview + raw cron, status chip + ghost toggle, next-run absolute + relative, last run,
 * edit action), the empty-state seed button, the modal-panel edit dialog (advisory cron
 * validation bound by aria-describedby, next-5 fire times, timeout in minutes stored as seconds,
 * retries, changed-fields-only PATCH, disabled submit), the PATCH migration of toggleJob, and
 * the ko/en catalog entries for the four registered jobs.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const PANEL = readFileSync("app/web-next/components/admin/console/ScheduleSection.tsx", "utf8");
const ACTIONS = readFileSync("app/web-next/components/admin/console/useAdminActions.ts", "utf8");
const LABELS = readFileSync("app/web-next/components/admin/console/admin-ui.tsx", "utf8");
const API_TYPES = readFileSync("app/web-next/lib/api.ts", "utf8");

// ko is the master catalog (design D2) — literal contracts pin the ko value.
import ko from "../../app/web-next/locales/ko.json";
import en from "../../app/web-next/locales/en.json";

function koOf(key: string): string {
  const v = key.split(".").reduce<unknown>((acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), ko);
  if (typeof v !== "string") throw new Error(`ko catalog key not found: ${key}`);
  return v;
}

function has(key: string, cat: Record<string, unknown> = en as unknown as Record<string, unknown>): boolean {
  const v = key.split(".").reduce<unknown>((acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), cat);
  return typeof v === "string";
}

/** The four registry jobs seeded on dev (design §4.3 live data shape) → snake_case catalog keys. */
const REGISTERED_JOBS = ["watch.evaluate", "gate_integrity.shadow_report", "notify.deliver", "notify.digest"] as const;

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
    expect(PANEL).toMatch(/font-mono text-\[length:var\(--fs-caption\)\][^>]*>\{j\.job_key\}/);
    expect(PANEL).toMatch(/label\("jobDesc", j\.job_key\)/);
    expect(koOf("admin.ops.colName")).toBe("작업");
  });

  test("스케줄 column: human cronstrue preview in the active locale + raw expr in mono", () => {
    // NOTE from the backend: the /ko subpath does not resolve — the i18n entry is "cronstrue/i18n".
    expect(PANEL).toContain('import cronstrue from "cronstrue/i18n"');
    expect(PANEL).toMatch(/cronstrue\.toString\([^)]*\{ locale: locale === "en" \? "en" : "ko" \}/);
    expect(PANEL).toMatch(/\{j\.cron_expr\}<\/code>/);
    expect(koOf("admin.ops.colCron")).toBe("스케줄");
    expect(has("admin.ops.colCron", en as unknown as Record<string, unknown>)).toBe(true);
  });

  test("상태 column keeps the existing chip and the btn-ghost two-state toggle (no switch component)", () => {
    expect(PANEL).toContain("rounded-full text-[length:var(--fs-caption)] bg-[color:var(--green-bg)]");
    expect(PANEL).toMatch(/className="btn-ghost" onClick=\{\(\) => toggleJob\(j\.job_key, j\.enabled !== 1\)\}/);
    expect(PANEL).not.toMatch(/switch|Switch/);
    // toggle and chip live in the 상태 cell; the actions column is the edit button only
    const statusCell = PANEL.slice(PANEL.indexOf("<td>\n                      <div className=\"flex flex-col items-start gap-1\">"));
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
    expect(API_TYPES).toMatch(/last_run: \{ started_at: string; status: string; duration_ms: number \| null \} \| null/);
  });

  test("작업 column: 편집 button opens the dialog with the §4.3 aria-label", () => {
    expect(koOf("admin.ops.editJob")).toBe("편집");
    expect(koOf("admin.ops.editJobAria")).toBe("{p1} 작업 편집");
    expect(PANEL).toMatch(/aria-label=\{t\("editJobAria", \{ p1: name \}\)\} onClick=\{\(\) => openEdit\(j\)\}/);
  });

  test("console search/paging conventions: ListSearch above the table, Pager only when pages > 1", () => {
    expect(PANEL).toMatch(/<ListSearch value=\{query\} onChange=\{setQuery\} ariaLabel=\{t\("searchJobsAria"\)\}/);
    expect(PANEL).toMatch(/\{paged\.pages > 1 && <Pager page=\{paged\.page\}/);
    expect(PANEL).toMatch(/matchesQuery\(query, j\.job_key, j\.display_name, j\.description, label\("jobName", j\.job_key\), label\("jobDesc", j\.job_key\)\)/);
  });
});

describe("empty state and seed (§4.3)", () => {
  test("keeps emptyJobs and adds the 기본 작업 등록 ghost button with a confirm dialog", () => {
    expect(koOf("admin.ops.emptyJobs")).toContain("등록된 스케줄 작업이 없습니다");
    expect(koOf("admin.ops.seedButton")).toBe("기본 작업 등록");
    expect(PANEL).toMatch(/className="btn-ghost" onClick=\{seedJobs\}/);
    expect(ACTIONS).toContain('api.post("/api/admin/schedule-jobs/seed")');
    expect(ACTIONS).toMatch(/confirm\(t\("jobSeedTitle"\)/);
    expect(ACTIONS).toMatch(/setJobs\(null\)/); // refresh after the seed
    expect(koOf("admin.actions.jobSeedBody")).toContain("비활성 상태로 등록됩니다");
  });
});

describe("edit dialog (§4.3: the §4.2 drawer realized as modal-panel + useModalFocus)", () => {
  test("dialog is the modal-panel pattern with focus management, not a drawer", () => {
    expect(PANEL).toContain("modal-backdrop");
    expect(PANEL).toMatch(/<div ref=\{panelRef\} className="modal-panel">/);
    expect(PANEL).toMatch(/useModalFocus\(onClose\)/);
    expect(PANEL).toContain('role="dialog"');
    expect(PANEL).toContain("aria-modal");
    // no drawer element exists in the codebase — assert no drawer markup was invented
    expect(PANEL).not.toMatch(/className="[^"]*drawer|<aside/);
    expect(PANEL).not.toContain("createPortal"); // AdminConsole's in-place modal precedent
  });

  test("cron field: advisory validateCron from the shared parser, error bound by aria-describedby", () => {
    expect(PANEL).toMatch(/import \{ minIntervalMinutes, nextFireTimes, validateCron \} from "\.\.\/\.\.\/\.\.\/lib\/schedule\/cron\.ts"/);
    expect(PANEL).toMatch(/const check = validateCron\(expr\)/);
    expect(PANEL).toMatch(/aria-invalid=\{cronError !== null\}/);
    expect(PANEL).toMatch(/aria-describedby=\{cronError !== null \? "jobCronError" : "jobCronPreview"\}/);
    expect(koOf("admin.ops.cronInvalid")).toContain("cron 식이 올바르지 않습니다");
    expect(koOf("admin.ops.cronTooFrequent")).toContain("5분 이상");
  });

  test("5-minute floor mirrors the PATCH route incl. the exempt keys, server stays authoritative", () => {
    expect(PANEL).toContain('const INTERVAL_FLOOR_EXEMPT_KEYS = new Set(["watch.evaluate", "notify.deliver"])');
    expect(PANEL).toMatch(/minIntervalMinutes\(expr, state\.openedAt\)/);
    // the dialog renders the server 400 message inline instead of trusting the mirror
    expect(PANEL).toMatch(/serverError/);
  });

  test("live human preview updates from the same cronstrue i18n entry as the list", () => {
    expect(PANEL.match(/cronstrue\.toString/g)?.length).toBeGreaterThanOrEqual(2); // list + dialog
    expect(koOf("admin.ops.cronPreviewLabel")).toBe("실행 주기");
  });

  test("다음 5회 실행 시각 computed client-side via the shared nextFireTimes", () => {
    expect(PANEL).toMatch(/nextFireTimes\(expr, state\.openedAt, 5\)/);
    expect(koOf("admin.ops.nextFireTimesHeading")).toBe("다음 5회 실행 시각");
    expect(PANEL).toMatch(/formatDateTime\(d, locale\)/);
  });

  test("timeout input is minutes (1–120) stored ×60 as timeout_sec; retries 0–5", () => {
    expect(koOf("admin.ops.timeoutLabel")).toBe("실행 제한(분)");
    expect(koOf("admin.ops.retriesLabel")).toBe("실패 시 재시도 횟수");
    expect(PANEL).toMatch(/timeoutValue >= 1 && timeoutValue <= 120/);
    expect(PANEL).toMatch(/payload\.timeout_sec = timeoutValue \* 60/);
    expect(PANEL).toMatch(/retriesValue >= 0 && retriesValue <= 5/);
    // the dialog seeds its inputs from the row (minutes back from timeout_sec)
    expect(PANEL).toMatch(/Math\.round\(job\.timeout_sec \/ 60\)/);
  });

  test("open/save flow: one primary 저장, submit disabled while invalid or saving, changed fields only", () => {
    expect(PANEL).toMatch(/const canSave = check\.ok && !tooFrequent && timeoutOk && retriesOk && !saving/);
    expect(PANEL).toMatch(/className="btn-primary" disabled=\{!canSave\}/);
    expect(PANEL).toMatch(/const payload: ScheduleJobUpdate = \{\}/);
    expect(PANEL).toMatch(/if \(expr !== state\.job\.cron_expr\) payload\.cron_expr = expr/);
    expect(PANEL).not.toMatch(/payload\.enabled/); // saving never enables; the toggle is the separate action
    expect(PANEL).toMatch(/void submit\(e\)/);
    // dialog closes on success, stays open with the server message on 400
    expect(PANEL).toMatch(/if \(res\.ok\) onClose\(\);\n    else setServerError\(res\.error/);
  });

  test("a disabled job stays editable — the dialog never touches enabled", () => {
    // openEdit carries no enabled flag; saveJob's payload type omits `enabled`
    expect(ACTIONS).toMatch(/export interface ScheduleJobUpdate \{\n  cron_expr\?: string;\n  timeout_sec\?: number;\n  max_retries\?: number;\n\}/);
    expect(PANEL).toMatch(/onSave=\{saveJob\}/);
  });
});

describe("PATCH migration (A1 contract)", () => {
  test("saveJob issues PATCH to [jobKey]; the UI no longer calls the legacy PUT", () => {
    expect(ACTIONS).toMatch(/api\.patch<ScheduleJobRow>\(`\/api\/admin\/schedule-jobs\/\$\{encodeURIComponent\(jobKey\)\}`, payload\)/);
    expect(ACTIONS).not.toMatch(/api\.put\(`\/api\/admin\/schedule-jobs/); // legacy PUT toggle kept server-side only
    expect(ACTIONS).toMatch(/api\.patch\(`\/api\/admin\/schedule-jobs\/\$\{encodeURIComponent\(jobKey\)\}`, \{ enabled: next \}\)/);
  });

  test("success toasts (ADR-0121) and refreshes the rows through the section effect", () => {
    expect(ACTIONS).toMatch(/toast\(t\("jobSavedNotice", \{ p1: jobKey \}\)\)/);
    expect(ACTIONS).toMatch(/toast\(message, "alert"\)/);
    expect(ACTIONS).toMatch(/setJobs\(null\); \/\/ re-fetch through the section effect/);
    expect(koOf("admin.actions.jobSavedNotice")).toContain("저장했습니다");
  });
});

describe("catalog entries for the registered jobs (§4.3 ko drafts)", () => {
  test("jobName/jobDesc groups carry all four keys in ko and en, under labelKeyOf normalization", () => {
    const m = LABELS.match(/export function labelKeyOf\(code: string\): string \{\n  return ([^;]+);/);
    expect(m).toBeTruthy(); // snake_case normalization is what maps dotted keys to catalog keys
    for (const job of REGISTERED_JOBS) {
      const key = job.trim().replace(/[^A-Za-z0-9_]+/g, "_");
      expect(has(`admin.labels.jobName.${key}`), `ko jobName.${key}`).toBe(true);
      expect(has(`admin.labels.jobDesc.${key}`), `ko jobDesc.${key}`).toBe(true);
      expect(has(`admin.labels.jobName.${key}`, en as unknown as Record<string, unknown>), `en jobName.${key}`).toBe(true);
      expect(has(`admin.labels.jobDesc.${key}`, en as unknown as Record<string, unknown>), `en jobDesc.${key}`).toBe(true);
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
    expect(koOf("admin.labels.jobDesc.notify_digest")).toBe("지난 24시간의 일일 요약 대상 알림을 한 이메일로 묶어 발송합니다.");
    expect(koOf("admin.labels.jobDesc.gate_integrity_shadow_report")).toBe("게이트 무결성 셰도우 감사 로그의 주간 요약 리포트를 만듭니다.");
  });

  test("the jobName/jobDesc groups are registered AdminLabelGroup members", () => {
    expect(LABELS).toMatch(/"jobName" \| "jobDesc"/);
  });
});
