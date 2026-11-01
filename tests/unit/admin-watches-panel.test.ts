// @version 1.0.0
/**
 * /admin/notifications — watch management panel (design 2026-10-29-scheduled-jobs-design
 * §13.6, P4) — frontend source-reading tests in the admin-schedule-panel.test.ts pattern.
 *
 * Covered: the watches table standard with the DERIVED enabled state (no watch.enabled
 * column is invented), the RowMenu actions (규칙 관리 / 사용·중지 / 삭제), the §13.6
 * soft-delete ConfirmDialog copy ("모든 규칙이 비활성화됩니다"), the create dialog (project
 * named by ID per the admin-has-no-visibility precedent + active-user picker + 409
 * watch_exists inline), the rules dialog (trigger/threshold/cooldown/channel/state columns),
 * the rule form's server-authoritative validation matrix (conditional threshold with %p /
 * days unit hints, cooldown 1–720, channel set, enabled on edit only, per-field
 * error.details.fields rendering), and the zero-write preview (form draft AND per-rule
 * entry points, status trio + masked recipients + the "no data written" caption).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const SECTION = readFileSync("app/web-next/components/admin/console/WatchesSection.tsx", "utf8");
const DIALOG = readFileSync("app/web-next/components/admin/console/WatchRulesDialog.tsx", "utf8");
const FORM = readFileSync("app/web-next/components/admin/console/WatchRuleForm.tsx", "utf8");
const TYPES = readFileSync("app/web-next/components/admin/console/types.ts", "utf8");
const API_LIB = readFileSync("app/web-next/lib/api.ts", "utf8");

// ko is the master catalog (design D2) — literal contracts pin the ko value.
import ko from "../../app/web-next/locales/ko.json";
import en from "../../app/web-next/locales/en.json";

function koOf(key: string): string {
  const v = key.split(".").reduce<unknown>((acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), ko);
  if (typeof v !== "string") throw new Error(`ko catalog key not found: ${key}`);
  return v;
}

function has(key: string): boolean {
  const v = key.split(".").reduce<unknown>((acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), en);
  return typeof v === "string";
}

describe("§13.6 watches table", () => {
  test("fixed-pct table with a 7-column ColGroup preset summing to 100", () => {
    expect(SECTION).toContain('table className="data-table list-table table-fixed-pct tmin-48"');
    expect(SECTION).toContain("<ColGroup widths={WATCHES_COL_PCT} />");
    const m = SECTION.match(/const WATCHES_COL_PCT = \[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const widths = m![1].split(",").map((x) => Number(x.trim()));
    expect(widths).toHaveLength(7); // 프로젝트 / 사용자 / 규칙 / 상태 / 등록일 / 최근 확인 / 작업
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
  });

  test("enabled state is the server-DERIVED field — no enabled column invented client-side", () => {
    expect(TYPES).toMatch(/`enabled` is DERIVED \(enabled_rule_count > 0; no watch\.enabled column\)/);
    expect(SECTION).toMatch(/\{w\.enabled \? \(/);
    expect(SECTION).not.toMatch(/w\.enabled =/); // never written client-side
    expect(SECTION).toMatch(/api\.patch\(`\/api\/admin\/watches\/\$\{encodeURIComponent\(watch\.id\)\}`, \{ enabled: next \}\)/);
  });

  test("RowMenu carries 규칙 관리 / 사용·중지 / 삭제; the delete is danger-flagged", () => {
    expect(SECTION).toMatch(/<RowMenu/);
    expect(SECTION).toMatch(/\{ key: "rules", label: t\("rulesManage"\)/);
    expect(SECTION).toMatch(/\{ key: "disable", label: t\("disable"\)/);
    expect(SECTION).toMatch(/\{ key: "enable", label: t\("enable"\)/);
    expect(SECTION).toMatch(/\{ key: "delete", label: t\("deleteWatch"\), danger: true, separatorBefore: true/);
  });

  test("delete is the §13.6 soft delete with the ConfirmDialog warning copy", () => {
    expect(SECTION).toMatch(/api\.delete\(`\/api\/admin\/watches\/\$\{encodeURIComponent\(watch\.id\)\}`\)/);
    expect(koOf("admin.watches.deleteConfirmBody")).toContain("모든 규칙이 비활성화됩니다");
    expect(koOf("admin.watches.deleteConfirmBody")).toContain("소프트 삭제");
    expect(SECTION).toMatch(/useConfirm\(\)/);
    expect(SECTION).toMatch(/confirm\(t\("deleteConfirmTitle"\)/);
    expect(has("admin.watches.deleteConfirmBody")).toBe(true);
  });

  test("create dialog: project named by ID (admin visibility precedent) + active-user picker", () => {
    expect(SECTION).toMatch(/api\.post\("\/api\/admin\/watches", \{ project_id: projectId\.trim\(\), user_id: userId\.trim\(\) \}\)/);
    expect(SECTION).toMatch(/api\.get<AdminUser\[\]>\("\/api\/admin\/users"\)/);
    expect(SECTION).toMatch(/u\.status === "active"/);
    expect(koOf("admin.watches.createProjectHint")).toContain("프로젝트 ID로 지정");
  });

  test("409 watch_exists renders its own inline message", () => {
    expect(SECTION).toMatch(/err\.code === "watch_exists"/);
    expect(koOf("admin.watches.createExists")).toContain("이미");
    expect(has("admin.watches.createExists")).toBe(true);
  });
});

describe("§13.6 rules dialog", () => {
  test("rules table: trigger / threshold / cooldown / channel / state + actions column", () => {
    expect(DIALOG).toContain('table className="data-table list-table table-fixed-pct tmin-48"');
    expect(DIALOG).toContain("<ColGroup widths={RULES_COL_PCT} />");
    const m = DIALOG.match(/const RULES_COL_PCT = \[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const widths = m![1].split(",").map((x) => Number(x.trim()));
    expect(widths).toHaveLength(6);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
    expect(DIALOG).toMatch(/label\("trigger", r\.trigger_type\)/);
    expect(DIALOG).toMatch(/t\("cooldownHoursValue", \{ n: r\.cooldown_hours \}\)/);
  });

  test("threshold renders with the trigger's unit (%p for threshold_breach, days for staleness)", () => {
    expect(DIALOG).toMatch(/r\.trigger_type === "staleness" \? t\("thresholdDays", \{ n: r\.threshold \}\) : t\("thresholdPct", \{ n: r\.threshold \}\)/);
    expect(koOf("admin.watches.thresholdPct")).toBe("{n}%p");
    expect(koOf("admin.watches.thresholdDays")).toBe("{n}일");
  });

  test("rule delete is a hard DELETE of the configuration row (watch_rule is not append-only)", () => {
    expect(DIALOG).toMatch(/api\.delete\(`\/api\/admin\/watch-rules\/\$\{encodeURIComponent\(rule\.id\)\}`\)/);
    expect(koOf("admin.watches.ruleDeleteConfirmBody")).toContain("더 이상 평가되지 않습니다");
  });
});

describe("§13.6 rule form (server-authoritative validation matrix)", () => {
  test("trigger select is the watch_rule CHECK's 7-value set — not the notification table's 11", () => {
    expect(FORM).toMatch(/"rag_upgrade", "rag_downgrade", "kill_criteria", "regulation_change", "threshold_breach", "staleness", "batch_failure"/);
    expect(FORM).not.toMatch(/pipeline_paused/);
    expect(FORM).not.toMatch(/establishment_step_reopened/);
  });

  test("threshold field is conditional: shown and required only for threshold_breach | staleness, with unit hints", () => {
    expect(FORM).toMatch(/const THRESHOLD_BEARING_TRIGGERS: readonly string\[\] = \["threshold_breach", "staleness"\]/);
    expect(FORM).toMatch(/\{thresholdBearing && \(/);
    expect(FORM).toMatch(/required\n?\s*\n?\s*\/>/);
    expect(FORM).toMatch(/triggerType === "staleness" \? t\("thresholdHintDays"\) : t\("thresholdHintPct"\)/);
    expect(koOf("admin.watches.thresholdHintPct")).toContain("%p");
    expect(koOf("admin.watches.thresholdHintDays")).toContain("일");
    // non-bearing triggers never send a threshold (the server rejects it)
    expect(FORM).toMatch(/if \(thresholdBearing\) body\.threshold = thresholdValue;/);
  });

  test("cooldown defaults to 24 and the field range mirrors the server (1–720)", () => {
    expect(FORM).toMatch(/const COOLDOWN_MIN = 1;\nconst COOLDOWN_MAX = 720;\nconst DEFAULT_COOLDOWN = 24;/);
    expect(FORM).toMatch(/cooldownValue >= COOLDOWN_MIN && cooldownValue <= COOLDOWN_MAX/);
    expect(koOf("admin.watches.cooldownHint")).toContain("1–720");
  });

  test("channel options: in_app/all plus email/webhook — the server 400 remains authoritative", () => {
    expect(FORM).toMatch(/const RULE_CHANNELS = \["in_app", "all", "email", "webhook"\]/);
    expect(koOf("admin.watches.channelHint")).toContain("건너뛰어집니다");
  });

  test("enabled checkbox only renders in edit mode (create defaults true server-side)", () => {
    expect(FORM).toMatch(/\{editing && \(/);
    expect(FORM).toMatch(/if \(editing\) body\.enabled = enabled;/);
  });

  test("validation_failed renders per-field messages from error.details.fields inline", () => {
    expect(FORM).toMatch(/err\.code === "validation_failed"/);
    expect(FORM).toMatch(/err\.details\?\.fields/);
    expect(FORM).toMatch(/setFieldErrors\(fields as Record<string, string>\)/);
    expect(FORM).toMatch(/<FieldError message=\{fieldErrors\.trigger_type\} \/>/);
    expect(FORM).toMatch(/<FieldError message=\{fieldErrors\.threshold\} \/>/);
    expect(FORM).toMatch(/<FieldError message=\{fieldErrors\.cooldown_hours\} \/>/);
    expect(FORM).toMatch(/<FieldError message=\{fieldErrors\.channel\} \/>/);
  });

  test("create posts under the watch; edit PATCHes the rule row", () => {
    expect(FORM).toMatch(/api\.post\(`\/api\/admin\/watches\/\$\{encodeURIComponent\(watchId\)\}\/rules`/);
    expect(FORM).toMatch(/api\.patch\(`\/api\/admin\/watch-rules\/\$\{encodeURIComponent\(initial\.id\)\}`/);
  });
});

describe("§13.6 preview (zero-write evaluation)", () => {
  test("POST /api/admin/watch-rules/preview with the watch-scoped draft; both entry points wired", () => {
    expect(DIALOG).toMatch(/api\.post<WatchRulePreview>\("\/api\/admin\/watch-rules\/preview", \{ watch_id: watch\.id, \.\.\.draft \}\)/);
    // entry point 1: the form's 미리보기 button (unsaved draft)
    expect(FORM).toMatch(/function runPreview\(\)/);
    expect(FORM).toMatch(/onPreview\(draft\)/);
    // entry point 2: the per-rule preview RowMenu action (saved rule values)
    expect(DIALOG).toMatch(/key: "preview",\s*\n?\s*label: t\("rulePreview"\)/);
    expect(DIALOG).toMatch(/runPreview\(\{ trigger_type: r\.trigger_type, threshold: r\.threshold, cooldown_hours: r\.cooldown_hours, channel: r\.channel \}\)/);
  });

  test("results panel: evaluated / would_fire / suppressed trio + reason + expected severity", () => {
    expect(DIALOG).toMatch(/\{r\.evaluated \? t\("previewYes"\) : t\("previewNo"\)\}/);
    expect(DIALOG).toMatch(/\{r\.would_fire \? t\("previewYes"\) : t\("previewNo"\)\}/);
    expect(DIALOG).toMatch(/\{r\.suppressed_by_cooldown \? t\("previewYes"\) : t\("previewNo"\)\}/);
    expect(DIALOG).toMatch(/\{r\.reason !== "" \? r\.reason : "—"\}/);
    expect(DIALOG).toMatch(/label\("severity", r\.severity\)/);
  });

  test("recipients render masked with their channels; in-app list separate — never unmuted", () => {
    expect(DIALOG).toMatch(/rec\.email_masked !== null/);
    expect(DIALOG).toMatch(/<code className="font-mono">\{rec\.email_masked\}<\/code>/);
    expect(DIALOG).toMatch(/rec\.channels\.map\(\(c\) => label\("channel", c\)\)/);
    expect(DIALOG).toMatch(/r\.in_app_user_ids\.join\(", "\)/);
    expect(DIALOG).not.toMatch(/unmask/);
  });

  test("the explicit unsaved-preview caption is always visible on the results panel", () => {
    expect(DIALOG).toMatch(/\{t\("previewCaption"\)\}/);
    expect(koOf("admin.watches.previewCaption")).toContain("저장되지 않은 미리보기");
    expect(koOf("admin.watches.previewCaption")).toContain("데이터를 쓰지 않습니다");
    expect(has("admin.watches.previewCaption")).toBe(true);
  });

  test("preview validation failures surface in the panel, not as a dead end", () => {
    expect(DIALOG).toMatch(/err\.code === "validation_failed"/);
    expect(DIALOG).toMatch(/preview\.error \?\? t\("previewFailed"\)/);
  });
});

describe("list envelope typing (P4 QA S-1 — the {rows} runtime-crash guard)", () => {
  test("watches and rules fetches consume the {rows} envelope through lib/api RowList — bare-array typing must not return", () => {
    // Both GETs return data:{rows}; typing res.data as the bare row array compiles and
    // then crashes at runtime (watches.map over a non-array) — the defect the browser
    // pass caught. The shared RowList type makes the .rows access compiler-enforced;
    // this pin keeps a revert from passing the suite again.
    expect(API_LIB).toMatch(/export interface RowList<T> \{\n  rows: T\[\];\n\}/);
    expect(SECTION).toMatch(/api\.get<RowList<WatchListRow>>\("\/api\/admin\/watches"\)/);
    expect(SECTION).toContain("setWatches(res.data.rows);");
    expect(DIALOG).toMatch(/api\.get<RowList<WatchRuleRow>>\(`\/api\/admin\/watches/);
    expect(DIALOG).toContain("setRules(res.data.rows);");
    expect(SECTION).not.toMatch(/api\.get<WatchListRow\[\]>|api\.get<\{ rows/);
    expect(DIALOG).not.toMatch(/api\.get<WatchRuleRow\[\]>|api\.get<\{ rows/);
  });
});

describe("catalog (ko master + en parity)", () => {
  test("the §13.6 action and state vocabulary is pinned in ko and mirrored in en", () => {
    expect(koOf("admin.watches.rulesManage")).toBe("규칙 관리");
    expect(koOf("admin.watches.stateEnabled")).toBe("사용 중");
    expect(koOf("admin.watches.stateDisabled")).toBe("중지");
    expect(koOf("admin.watches.rulesCount")).toBe("{p1} / {p2}");
    for (const key of ["heading", "note", "colProject", "colUser", "colRules", "colState", "createButton", "ruleAdd", "previewButton", "previewYes", "previewNo"]) {
      expect(has(`admin.watches.${key}`)).toBe(true);
    }
  });
});
