// @version 1.0.0
/**
 * /admin/notifications — history panel + detail drawer + test send (design
 * 2026-10-29-scheduled-jobs-design §13.5/§13.7, P4) — frontend source-reading tests in the
 * admin-schedule-panel.test.ts pattern: the section is a client component bound to browser
 * APIs, so the invariants below are asserted against the source and pinned to the ko master
 * catalog.
 *
 * Covered: the server-side filter bar (period presets + custom from/to, trigger, severity,
 * channel, read, delivery_status, project selector with the admin-has-no-visibility custom-ID
 * fallback, debounced q), the seven-column list standard (fixed-pct + ColGroup), severity
 * chip (text + icon, FR-SYS-05), per-channel delivery STATUS COUNT badges with {} → in-app
 * only, the project deep link, server-side paging through the page meta (the old
 * count/unread_count meta contract is gone from the data hook), the modal-panel detail
 * drawer (read-only payload viewer + delivery attempts with masked values and expandable
 * last_error), and the §13.7 test-send dialog (channel/target, success id + next-tick note,
 * localized 429 rate-limit message).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const SECTION = readFileSync("app/web-next/components/admin/console/NotificationSection.tsx", "utf8");
const DRAWER = readFileSync("app/web-next/components/admin/console/NotificationDetailDrawer.tsx", "utf8");
const TEST_DIALOG = readFileSync("app/web-next/components/admin/console/TestSendDialog.tsx", "utf8");
const DATA = readFileSync("app/web-next/components/admin/console/useAdminData.ts", "utf8");
const CONSOLE = readFileSync("app/web-next/components/admin/console/AdminConsole.tsx", "utf8");
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

describe("§13.5 filter bar (server-side filters)", () => {
  test("period presets + custom from/to date inputs bound the sent_at window", () => {
    expect(SECTION).toMatch(/const PERIODS = \["24h", "7d", "30d", "90d", "all", "custom"\]/);
    expect(SECTION).toContain('<input type="date"');
    expect(SECTION).toMatch(/params\.set\("from", bounds\.from\)/);
    expect(SECTION).toMatch(/params\.set\("to", bounds\.to\)/);
    expect(koOf("admin.ops.period_24h")).toBe("최근 24시간");
    expect(koOf("admin.ops.period_90d")).toContain("90일");
    expect(has("admin.ops.period_all")).toBe(true);
  });

  test("trigger/severity/channel/read/delivery_status selects cover the full option sets", () => {
    expect(SECTION).toMatch(/"rag_upgrade", "rag_downgrade", "kill_criteria", "regulation_change", "threshold_breach",/);
    expect(SECTION).toMatch(/const SEVERITIES = \["opportunity", "warning", "urgent", "info", "ops"\]/);
    expect(SECTION).toMatch(/const CHANNELS = \["in_app", "email", "webhook"\]/);
    expect(SECTION).toMatch(/const READ_STATES = \["read", "unread"\]/);
    expect(SECTION).toMatch(/const DELIVERY_STATUSES = \["pending", "retry", "sent", "failed", "skipped", "deferred"\]/);
    expect(SECTION).toMatch(/label\("trigger", v\)/);
    expect(SECTION).toMatch(/label\("deliveryStatus", v\)/);
  });

  test("q search is a debounced server query, not client filtering", () => {
    expect(SECTION).toMatch(/params\.set\("q", q\.trim\(\)\)/);
    expect(SECTION).toMatch(/setTimeout\(\(\) => setQ\(qInput\), Q_DEBOUNCE_MS\)/);
    expect(SECTION).toMatch(/const Q_DEBOUNCE_MS = 300/);
    expect(SECTION).toMatch(/type="search"/);
    expect(koOf("admin.ops.filterQPlaceholder")).toContain("검색");
  });

  test("project selector names observed projects and falls back to the admin-ID custom input (FR-SEC-02)", () => {
    expect(SECTION).toContain('"__custom__"');
    expect(SECTION).toMatch(/title=\{t\("filterProjectHint"\)\}/);
    expect(koOf("admin.ops.filterProjectHint")).toContain("프로젝트 ID로만 필터링");
    expect(SECTION).toMatch(/aria-label=\{t\("filterProjectAria"\)\}/);
    expect(koOf("admin.pageIntro.notifications")).toContain("관리"); // intro covers watches too
  });

  test("any filter change resets paging to page 1; the query is debounced and stale responses drop", () => {
    expect(SECTION).toMatch(/setFilters\(\(f\) => \(\{ \.\.\.f, \.\.\.patch \}\)\);\n    setPage\(1\)/);
    expect(SECTION).toMatch(/let cancelled = false;/);
    expect(SECTION).toMatch(/if \(cancelled\) return;/);
  });
});

describe("§13.5 list (the seven-column list standard)", () => {
  test("fixed-pct table with a 7-column ColGroup preset summing to 100", () => {
    expect(SECTION).toContain('table className="data-table list-table table-fixed-pct tmin-56"');
    expect(SECTION).toContain("<ColGroup widths={NOTIFICATIONS_COL_PCT} />");
    const m = SECTION.match(/const NOTIFICATIONS_COL_PCT = \[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const widths = m![1].split(",").map((x) => Number(x.trim()));
    expect(widths).toHaveLength(7); // 시각 / 심각도 / 트리거 / 프로젝트 / 제목 / 전송 / 작업
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
  });

  test("severity chip renders text + icon glyph, never color alone (FR-SYS-05)", () => {
    expect(SECTION).toMatch(/<span aria-hidden="true">\{glyph\}<\/span> \{label\("severity", severity\)\}/);
    expect(SECTION).toMatch(/severity === "opportunity" \? "↗"/);
    expect(SECTION).toMatch(/severity === "urgent" \? "!"/);
  });

  test("delivery badges: per-channel status counts as compact chips; {} renders in-app only", () => {
    expect(SECTION).toMatch(/Object\.entries\(delivery\)\.flatMap/);
    expect(SECTION).toMatch(/label\("channel", c\.channel\)\} · \{label\("deliveryStatus", c\.status\)\} ×\{c\.count\}/);
    expect(SECTION).toMatch(/chips\.length === 0/);
    expect(SECTION).toMatch(/\{t\("deliveryInAppOnly"\)\}/);
    expect(SECTION).toMatch(/status === "sent"\) return "status-chip status-green"/);
    expect(SECTION).toMatch(/status === "failed"\) return "status-chip status-red"/);
    expect(koOf("admin.ops.deliveryInAppOnly")).toBe("인앱 전용");
  });

  test("project cell deep-links to /projects/{id} without triggering the row click", () => {
    expect(SECTION).toMatch(/href=\{`\/projects\/\$\{n\.project\.id\}`\}/);
    expect(SECTION).toMatch(/onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  });

  test("rows open the detail drawer; keyboard users get the 상세 action button", () => {
    expect(SECTION).toMatch(/<tr key=\{n\.id\} className="cursor-pointer" onClick=\{\(\) => setDetailId\(n\.id\)\}>/);
    expect(SECTION).toMatch(/onClick=\{\(e\) => \{ e\.stopPropagation\(\); setDetailId\(n\.id\); \}\}/);
    expect(SECTION).toMatch(/aria-label=\{`\$\{t\("drawerAria"\)\}/);
    expect(koOf("admin.ops.detailAction")).toBe("상세");
  });

  test("paging is server-side through the page meta (the old array contract is gone from the data hook)", () => {
    expect(SECTION).toMatch(/<Pager page=\{meta\?\.page \?\? page\}/);
    expect(SECTION).toMatch(/params\.set\("page_size", String\(PAGE_SIZE\)\)/);
    expect(DATA).not.toMatch(/api\s*\n?\s*\.get<AdminNotificationRow\[\]>\("\/api\/admin\/notifications"\)/);
    expect(DATA).not.toContain("AdminNotificationRow");
    expect(TYPES).toMatch(/export interface PageMeta/);
    expect(TYPES).toMatch(/total_pages: number/);
  });

  test("both new sections render under the notifications section in AdminConsole", () => {
    expect(CONSOLE).toContain('import { NotificationSection } from "./NotificationSection.tsx";');
    expect(CONSOLE).toContain('import { WatchesSection } from "./WatchesSection.tsx";');
    expect(CONSOLE).toContain('{section === "notifications" && <NotificationSection />}');
    expect(CONSOLE).toContain('{section === "notifications" && <WatchesSection />}');
    expect(CONSOLE).not.toContain("NotificationsPanel");
  });
});

describe("§13.5 detail drawer (modal-panel precedent, not a drawer element)", () => {
  test("modal-panel + useModalFocus; no drawer markup invented", () => {
    expect(DRAWER).toContain("modal-backdrop");
    expect(DRAWER).toMatch(/<div ref=\{panelRef\} className="modal-panel"/);
    expect(DRAWER).toMatch(/useModalFocus\(onClose\)/);
    expect(DRAWER).toContain('role="dialog"');
    expect(DRAWER).not.toMatch(/<aside/);
  });

  test("payload is a read-only collapsible JSON viewer (pre + code, never an input)", () => {
    expect(DRAWER).toMatch(/<details className="mt-3">/);
    expect(DRAWER).toMatch(/<pre className="[^"]*overflow-auto/);
    expect(DRAWER).toMatch(/JSON\.stringify\(detail\.payload, null, 2\)/);
    expect(DRAWER).not.toMatch(/<textarea|contentEditable/);
    expect(koOf("admin.ops.payloadSummary")).toContain("JSON");
  });

  test("delivery attempts table: channel, masked recipient, attempt, status, next_attempt_at, expandable last_error", () => {
    expect(DRAWER).toContain("<ColGroup widths={DELIVERY_COL_PCT} />");
    const m = DRAWER.match(/const DELIVERY_COL_PCT = \[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const widths = m![1].split(",").map((x) => Number(x.trim()));
    expect(widths).toHaveLength(6);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
    expect(DRAWER).toMatch(/d\.recipient_address_masked \?\? d\.target_key \?\? d\.recipient_user_id/);
    expect(DRAWER).toMatch(/\{d\.attempt\}/);
    expect(DRAWER).toMatch(/d\.next_attempt_at \? formatDateTime\(d\.next_attempt_at, locale\) : "—"/);
    expect(DRAWER).toMatch(/<summary className="cursor-pointer[^"]*">\{t\("errorToggle"\)\}<\/summary>/);
    expect(DRAWER).toMatch(/\{d\.last_error\}/);
  });

  test("masked values render as-is — no unmasking logic anywhere", () => {
    // no string rewriting of the masked fields — they are rendered verbatim from the API
    expect(DRAWER).not.toMatch(/\.replace\(/);
    expect(koOf("admin.ops.colRecipient")).toBe("수신자");
  });
});

describe("§13.7 test send dialog", () => {
  test("channel select covers in_app/email/webhook; target is a user select or a webhook channel key", () => {
    expect(TEST_DIALOG).toMatch(/const TEST_CHANNELS = \["in_app", "email", "webhook"\]/);
    expect(TEST_DIALOG).toMatch(/channel === "webhook" \? \(/);
    expect(TEST_DIALOG).toMatch(/api\.get<AdminUser\[\]>\("\/api\/admin\/users"\)/);
    expect(TEST_DIALOG).toMatch(/u\.status === "active"/);
    expect(TEST_DIALOG).toMatch(/t\("testTargetWebhookHint"\)/);
  });

  test("posts {channel, target} and renders the notification id + next-tick note on success", () => {
    expect(TEST_DIALOG).toMatch(/api\.post<\{ notification_id: string; channel: string; target_masked: string \}>\("\/api\/admin\/notifications\/test"/);
    expect(TEST_DIALOG).toMatch(/t\("testSuccessId"\)/);
    expect(TEST_DIALOG).toMatch(/\{queued\.notification_id\}/);
    expect(koOf("admin.ops.testSuccessNote")).toContain("60초 이내");
  });

  test("429 rate_limited renders the localized limit message, not the raw server text", () => {
    expect(TEST_DIALOG).toMatch(/err\.code === "rate_limited"/);
    expect(TEST_DIALOG).toMatch(/setError\(t\("testRateLimited"\)\)/);
    expect(koOf("admin.ops.testRateLimited")).toContain("5건");
    expect(has("admin.ops.testRateLimited")).toBe(true);
  });

  test("the panel header hosts the 테스트 발송 control", () => {
    expect(SECTION).toMatch(/onClick=\{\(\) => setTestOpen\(true\)\}>\{t\("testSend"\)\}/);
    expect(koOf("admin.ops.testSend")).toBe("테스트 발송");
  });
});

describe("list envelope typing (P4 QA S-1 — the {rows} runtime-crash guard)", () => {
  test("the history fetch consumes the {rows} envelope through lib/api RowList — bare-array typing must not return", () => {
    // GET /api/admin/notifications returns data:{rows} (paging meta on the envelope);
    // typing res.data as the bare row array compiles and then crashes at runtime —
    // the exact defect the browser pass caught and this pin keeps out of the suite.
    expect(API_LIB).toMatch(/export interface RowList<T> \{\n  rows: T\[\];\n\}/);
    expect(SECTION).toMatch(/api\.get<RowList<AdminNotificationListRow>>\(`\/api\/admin\/notifications/);
    expect(SECTION).toContain("setRows(res.data.rows);");
    expect(SECTION).toMatch(/res\.data\.rows\.map\(\(r\) => r\.project\)/);
    expect(SECTION).not.toMatch(/api\.get<AdminNotificationListRow\[\]>/);
    expect(SECTION).not.toMatch(/api\.get<\{ rows/); // inline shape → must go through the shared type
  });
});

describe("catalog (ko master + en parity)", () => {
  test("trigger labels cover all 11 notification trigger values in ko and en", () => {
    const triggers = [
      "rag_upgrade", "rag_downgrade", "kill_criteria", "regulation_change", "threshold_breach",
      "staleness", "batch_failure", "pipeline_paused", "establishment_step_reopened",
      "establishment_step_assigned", "test",
    ];
    for (const trg of triggers) {
      expect(koOf(`admin.labels.trigger.${trg}`)).not.toBe(trg); // translated, not the fallback
      expect(has(`admin.labels.trigger.${trg}`)).toBe(true);
    }
    expect(koOf("admin.labels.trigger.kill_criteria")).toBe("중단 기준 발동");
  });

  test("deliveryStatus labels cover the six ledger statuses", () => {
    for (const s of ["pending", "retry", "sent", "failed", "skipped", "deferred"]) {
      expect(koOf(`admin.labels.deliveryStatus.${s}`)).not.toBe(s);
      expect(has(`admin.labels.deliveryStatus.${s}`)).toBe(true);
    }
  });

  test("severity catalog gained the notification severities; channel gained webhook/all", () => {
    expect(koOf("admin.labels.severity.opportunity")).toBe("기회");
    expect(koOf("admin.labels.severity.urgent")).toBe("긴급");
    expect(koOf("admin.labels.severity.ops")).toBe("운영");
    expect(koOf("admin.labels.channel.webhook")).toBe("웹훅");
    expect(koOf("admin.labels.channel.all")).toBe("전체 채널");
    expect(has("admin.labels.severity.opportunity")).toBe(true);
  });
});
