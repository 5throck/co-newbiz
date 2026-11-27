// @version 1.0.0
/**
 * /admin/connected-apps — connected OAuth client fleet panel (design
 * 2026-11-27-admin-oauth-client-stop-start) — frontend source-reading tests in
 * the admin-watches-panel.test.ts pattern: the section is a client component
 * bound to browser APIs, so the invariants below are asserted against the
 * source and pinned to the ko master catalog.
 *
 * Covered: the four registration points (Section union, SECTION_TITLE_KEY +
 * SECTION_INTRO_KEY, ADMIN_NAV entry after adr before system-mode, the
 * AppShell Cable icon), the seven-column list standard (fixed-pct + ColGroup
 * summing to 100), the §3.2 status chips (● 운영 중 green / ✕ 중단 red — icon
 * + label, never color-only) and the verified chip pair, the one-action-per-row
 * state-dependent buttons (danger 중단 / ghost 시작), the useConfirm dialogs
 * carrying the users-must-reconnect consequence, the 409 self-healing reload,
 * the client-side search + status FilterChip trio, the true-empty PageState,
 * and the design's full ko/en key table (36 keys).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";

const ROOT = "app/web-next";
const SECTION = readFileSync(`${ROOT}/components/admin/console/ConnectedAppsSection.tsx`, "utf8");
const TYPES = readFileSync(`${ROOT}/components/admin/console/types.ts`, "utf8");
const CONSTANTS = readFileSync(`${ROOT}/components/admin/console/constants.ts`, "utf8");
const CONSOLE = readFileSync(`${ROOT}/components/admin/console/AdminConsole.tsx`, "utf8");
const NAV = readFileSync(`${ROOT}/lib/navigation.ts`, "utf8");
const APP_SHELL = readFileSync(`${ROOT}/components/AppShell.tsx`, "utf8");
const CONSENT = readFileSync(`${ROOT}/app/oauth/authorize/page.tsx`, "utf8");

// ko is the master catalog (design D2) — literal contracts pin the ko value.
import ko from "../../app/web-next/locales/ko.json";
import en from "../../app/web-next/locales/en.json";

type Catalog = Record<string, unknown>;

function catOf(catalog: Catalog, key: string): unknown {
  return key.split(".").reduce<unknown>(
    (acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined),
    catalog,
  );
}

function koOf(key: string): string {
  const v = catOf(ko, key);
  if (typeof v !== "string") throw new Error(`ko catalog key not found: ${key}`);
  return v;
}

function has(key: string): boolean {
  return typeof catOf(en, key) === "string";
}

/** The design's § i18n key table, verbatim (36 dotted keys). */
const DESIGN_KEYS = [
  "nav.admin.connectedApps",
  "admin.section.connectedApps",
  "admin.pageIntro.connectedApps",
  "admin.connectedApps.colApp",
  "admin.connectedApps.colClientId",
  "admin.connectedApps.colVerified",
  "admin.connectedApps.colUsers",
  "admin.connectedApps.colStatus",
  "admin.connectedApps.colStoppedAt",
  "admin.connectedApps.statusOperating",
  "admin.connectedApps.statusStopped",
  "admin.connectedApps.verifiedChip",
  "admin.connectedApps.unverifiedChip",
  "admin.connectedApps.userCount",
  "admin.connectedApps.stopButton",
  "admin.connectedApps.startButton",
  "admin.connectedApps.stopConfirmTitle",
  "admin.connectedApps.stopConfirmBody",
  "admin.connectedApps.startConfirmTitle",
  "admin.connectedApps.startConfirmBody",
  "admin.connectedApps.stoppedToast",
  "admin.connectedApps.startedToast",
  "admin.connectedApps.errAlreadyStopped",
  "admin.connectedApps.errAlreadyRunning",
  "admin.connectedApps.errNotFound",
  "admin.connectedApps.errLoad",
  "admin.connectedApps.emptyClients",
  "admin.connectedApps.searchAria",
  "admin.connectedApps.filterAll",
  "admin.connectedApps.filterOperating",
  "admin.connectedApps.filterStopped",
  "admin.connectedApps.stopButtonAria",
  "admin.connectedApps.startButtonAria",
  "admin.connectedApps.tableCaption",
  "pages.oauthAuthorize.stoppedHeading",
  "pages.oauthAuthorize.stoppedBody",
] as const;

describe("connected-apps section registration (all four points)", () => {
  test("Section union carries connected-apps and the console renders it", () => {
    expect(TYPES).toMatch(/export type Section = [^\n]*"connected-apps"/);
    expect(CONSOLE).toContain('import { ConnectedAppsSection } from "./ConnectedAppsSection.tsx"');
    expect(CONSOLE).toContain('{section === "connected-apps" && <ConnectedAppsSection />}');
    expect(existsSync(`${ROOT}/app/admin/connected-apps/page.tsx`)).toBe(true);
    const PAGE = readFileSync(`${ROOT}/app/admin/connected-apps/page.tsx`, "utf8");
    expect(PAGE).toContain('<AdminConsole section="connected-apps" />');
  });

  test("SECTION_TITLE_KEY + SECTION_INTRO_KEY carry the connectedApps keys", () => {
    expect(CONSTANTS).toContain('"connected-apps": "admin.section.connectedApps"');
    expect(CONSTANTS).toContain('"connected-apps": "admin.pageIntro.connectedApps"');
  });

  test("ADMIN_NAV places /admin/connected-apps after adr, before system-mode, labeled nav.admin.connectedApps", () => {
    const m = NAV.match(/export const ADMIN_NAV[\s\S]*?\n\];/);
    expect(m).toBeTruthy();
    const block = m?.[0] ?? "";
    const hrefs = [...block.matchAll(/href: "([^"]+)"/g)].map((x) => x[1]);
    const adrIdx = hrefs.indexOf("/admin/adr");
    const appsIdx = hrefs.indexOf("/admin/connected-apps");
    const sysIdx = hrefs.indexOf("/admin/system-mode");
    expect(appsIdx).toBe(adrIdx + 1);
    expect(sysIdx).toBe(appsIdx + 1);
    expect(block).toContain('{ href: "/admin/connected-apps", label: "nav.admin.connectedApps" }');
  });

  test("AppShell icons the new entry with the nominated lucide Cable", () => {
    expect(APP_SHELL).toMatch(/\n {2}Cable,\n/); // named import from lucide-react
    expect(APP_SHELL).toContain('"/admin/connected-apps": <Cable size={18} />');
  });
});

describe("§ fleet table (P2 Report standard)", () => {
  test("fixed-pct table with a 7-column ColGroup preset summing to 100", () => {
    expect(SECTION).toContain('table className="data-table list-table table-fixed-pct tmin-56"');
    expect(SECTION).toContain("<ColGroup widths={CONNECTED_APPS_COL_PCT} />");
    const m = SECTION.match(/const CONNECTED_APPS_COL_PCT = \[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const widths = (m?.[1] ?? "").split(",").map((x) => Number(x.trim()));
    expect(widths).toHaveLength(7); // 이름 / client_id / 검증 / 연결 사용자 / 상태 / 중단 일시 / 작업
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
  });

  test("table semantics: sr-only caption + aria-label + th scope=col", () => {
    expect(SECTION).toContain('<caption className="sr-only">{t("tableCaption")}</caption>');
    expect(SECTION).toMatch(/aria-label=\{t\("tableCaption"\)\}/);
    expect(SECTION.match(/th scope="col"/g)?.length).toBe(7); // actions column header is sr-only
    expect(SECTION).toContain('<span className="sr-only">{tc("actions")}</span>');
    expect(koOf("admin.connectedApps.tableCaption")).toBe("등록된 외부 앱 목록");
  });

  test("client_id renders mono and truncated with the full value on title", () => {
    expect(SECTION).toMatch(/<code className="font-mono text-\[length:var\(--fs-caption\)\]">\{a\.client_id\}<\/code>/);
    expect(SECTION).toMatch(/className="cell-truncate" title=\{a\.client_id\}/);
  });

  test("status chip per state: green ● 운영 중 / red ✕ 중단 — icon + label, never color-only", () => {
    expect(SECTION).toContain('<span className="status-chip status-green">');
    expect(SECTION).toContain('<span className="status-chip status-red">');
    const squash = SECTION.replace(/\s+/g, " ");
    expect(squash).toContain('<span aria-hidden="true">●</span> {t("statusOperating")}');
    expect(squash).toContain('<span aria-hidden="true">✕</span> {t("statusStopped")}');
    // the state predicate is the server marker, never derived client-side
    expect(SECTION).toMatch(/a\.stopped_at === null \?/);
    expect(SECTION).not.toMatch(/a\.stopped_at = [^=]/); // an assignment, not the === comparisons
  });

  test("verified chip reuses the settings/consent pair: green 검증된 앱 / amber 미검증 앱", () => {
    expect(SECTION).toMatch(/className=\{`status-chip \$\{a\.verified \? "status-green" : "status-amber"\}`\}/);
    expect(SECTION).toMatch(/a\.verified \? t\("verifiedChip"\) : t\("unverifiedChip"\)/);
    expect(koOf("admin.connectedApps.verifiedChip")).toBe("검증된 앱");
    expect(koOf("admin.connectedApps.unverifiedChip")).toBe("미검증 앱");
  });

  test("연결 사용자 cell renders the server-derived count (never recomputed client-side)", () => {
    expect(SECTION).toMatch(/t\("userCount", \{ p1: a\.authorized_users \}\)/);
    expect(SECTION).toContain('className="tabular-nums"');
    expect(koOf("admin.connectedApps.userCount")).toBe("{p1}명");
  });

  test("중단 일시 cell: compact date-time, — while operating", () => {
    expect(SECTION).toMatch(/a\.stopped_at !== null \? formatDateTime\(a\.stopped_at, locale\) : "—"/);
  });
});

describe("row actions + confirm flow (the house commitment pattern)", () => {
  test("one action per row, state-dependent: danger 중단 when running, ghost 시작 when stopped", () => {
    expect(SECTION).toMatch(/<Button\n?\s*variant="danger"\n?\s*size="sm"\n?\s*aria-label=\{t\("stopButtonAria", \{ p1: a\.name \}\)\}/);
    expect(SECTION).toMatch(/<Button\n?\s*variant="ghost"\n?\s*size="sm"\n?\s*aria-label=\{t\("startButtonAria", \{ p1: a\.name \}\)\}/);
    expect(SECTION.match(/<Button/g)?.length).toBe(2); // exactly the two variants — no third action
    expect(SECTION).toMatch(/useConfirm\(\)/);
  });

  test("중단 confirm carries both consequences (immediate revocation; no silent resume after 시작)", () => {
    expect(SECTION).toMatch(/confirm\(\s*t\("stopConfirmTitle", \{ p1: app\.name \}\),/);
    expect(SECTION).toMatch(/\{ body: t\("stopConfirmBody"\), confirmLabel: t\("stopButton"\) \}/);
    expect(koOf("admin.connectedApps.stopConfirmBody")).toContain("모든 사용자의 연결이 즉시 해지되고");
    expect(koOf("admin.connectedApps.stopConfirmBody")).toContain("기존 연결은 복구되지 않습니다");
    // destructive direction keeps the ConfirmDialog danger default (no tone override)
    expect(SECTION).not.toMatch(/stopConfirmBody"\), confirmLabel: t\("stopButton"\), tone/);
  });

  test("시작 confirm is the safe-side ordinary confirmation (neutral tone) and states the reconnect duty", () => {
    expect(SECTION).toMatch(/\{ body: t\("startConfirmBody"\), confirmLabel: t\("startButton"\), tone: "neutral" \}/);
    expect(koOf("admin.connectedApps.startConfirmBody")).toContain("다시 연결해야 합니다");
  });

  test("actions PUT {action} to /api/admin/oauth-clients/[clientId]; success toasts carry the revoke count", () => {
    expect(SECTION).toMatch(
      /api\.put<\{ ok: true; status: string; revoked\?: number \}>\(\s*`\/api\/admin\/oauth-clients\/\$\{encodeURIComponent\(app\.client_id\)\}`,\s*\{ action \},?\s*\)/,
    );
    expect(SECTION).toMatch(/t\("stoppedToast", \{ p1: app\.name, p2: res\.data\.revoked \?\? 0 \}\)/);
    expect(SECTION).toMatch(/t\("startedToast", \{ p1: app\.name \}\)/);
    expect(SECTION).toContain('reload();');
  });
});

describe("409 self-healing (the acceptance item)", () => {
  test("both 409 codes toast the catalog text (alert) and reload the list", () => {
    expect(SECTION).toMatch(/err\.code === "oauth_client_already_stopped"/);
    expect(SECTION).toMatch(/err\.code === "oauth_client_already_running"/);
    const squash = SECTION.replace(/\s+/g, " ");
    expect(squash.match(/toast\(t\("errAlreadyStopped"\), "alert"\);\s*reload\(\);/g)?.length).toBe(1);
    expect(squash.match(/toast\(t\("errAlreadyRunning"\), "alert"\);\s*reload\(\);/g)?.length).toBe(1);
    expect(koOf("admin.connectedApps.errAlreadyStopped")).toContain("새로 고칩니다");
    expect(koOf("admin.connectedApps.errAlreadyRunning")).toContain("새로 고칩니다");
  });

  test("404 answers the catalog not-found text; the list load failure uses errLoad", () => {
    expect(SECTION).toMatch(/err\.code === "not_found"/);
    expect(SECTION).toMatch(/toast\(t\("errNotFound"\), "alert"\)/);
    expect(SECTION).toMatch(/setLoadError\(t\("errLoad"\)\)/);
    expect(koOf("admin.connectedApps.errNotFound")).toContain("찾을 수 없습니다");
  });
});

describe("toolbar: search + status FilterChip trio", () => {
  test("search input filters name·client_id substring with the catalog aria/placeholder", () => {
    expect(SECTION).toMatch(/type="search"\n?\s*aria-label=\{t\("searchAria"\)\}\n?\s*placeholder=\{t\("searchAria"\)\}/);
    expect(SECTION).toMatch(/`\$\{a\.name\} \$\{a\.client_id\}`\.toLowerCase\(\)\.includes\(q\)/);
    expect(koOf("admin.connectedApps.searchAria")).toBe("앱 이름 또는 client_id 검색");
  });

  test("FilterChip trio carries live counts (전체/운영 중/중단)", () => {
    expect(SECTION).toMatch(/<FilterChip selected=\{statusFilter === "all"\}/);
    expect(SECTION).toMatch(/<FilterChip selected=\{statusFilter === "operating"\}/);
    expect(SECTION).toMatch(/<FilterChip selected=\{statusFilter === "stopped"\}/);
    expect(SECTION).toMatch(/t\("filterAll", \{ p1: apps\?\.length \?\? 0 \}\)/);
    expect(SECTION).toMatch(/t\("filterOperating", \{ p1: countBy\(false\) \}\)/);
    expect(SECTION).toMatch(/t\("filterStopped", \{ p1: countBy\(true\) \}\)/);
    expect(koOf("admin.connectedApps.filterAll")).toBe("전체 ({p1})");
    expect(koOf("admin.connectedApps.filterOperating")).toBe("운영 중 ({p1})");
    expect(koOf("admin.connectedApps.filterStopped")).toBe("중단 ({p1})");
  });
});

describe("empty / loading states + data source", () => {
  test("true-empty fleet renders PageState empty with emptyClients; filter-only empty stays truthful", () => {
    expect(SECTION).toMatch(/<PageState state="empty" emptyText=\{t\("emptyClients"\)} \/>/);
    expect(SECTION).toMatch(/apps\.length === 0 \?/);
    expect(SECTION).toMatch(/visible\.length === 0 \?/);
    expect(SECTION).toMatch(/tc\("emptyState"\)/); // filtered-to-zero never claims "아직 등록된 앱이 없습니다"
    expect(koOf("admin.connectedApps.emptyClients")).toBe("아직 등록된 앱이 없습니다.");
  });

  test("self-contained fetch of GET /api/admin/oauth-clients with the clients envelope (NotificationSection precedent)", () => {
    expect(SECTION).toMatch(/api\n?\s*\.get<\{ clients: AdminConnectedAppRow\[\] \}>\("\/api\/admin\/oauth-clients"\)/);
    expect(TYPES).toMatch(/export interface AdminConnectedAppRow \{/);
    expect(TYPES).toContain("redirect_uri_count: number;");
    expect(TYPES).toContain("authorized_users: number;");
    expect(TYPES).toContain("live_tokens: number;");
    expect(TYPES).toContain("stopped_at: string | null;");
    expect(SECTION).not.toMatch(/from "\.\/useAdminData\.ts"/); // self-contained: no shared data-hook domain
  });
});

describe("consent screen stopped state (G1 reflection)", () => {
  test("GET client_stopped flips to the dedicated stopped state, never the generic invalid one", () => {
    expect(CONSENT).toMatch(/e\.code === "client_stopped"\) setStopped\(true\)/);
    expect(CONSENT).toMatch(/aria-labelledby="stopped-heading"/);
    expect(CONSENT).toMatch(/\{t\("stoppedHeading"\)\}/);
    expect(CONSENT).toMatch(/\{t\("stoppedBody"\)\}/);
    // icon + text (§3.2) and role=alert status messaging
    expect(CONSENT).toMatch(/<span aria-hidden="true">✕<\/span> \{t\("stoppedBody"\)\}/);
    // the settings page link is the state's single action
    const squash = CONSENT.replace(/\s+/g, " ");
    expect(squash).toContain(
      '<Link href="/settings/connected-apps" className="btn-primary"> {t("viewConnectedApps")} </Link>',
    );
  });

  test("the stopped state stays an error state (no consent UI) and the decision path honors it too", () => {
    expect(CONSENT).toMatch(/const failed = !!error \|\| stopped \|\|/);
    expect(CONSENT).toMatch(/\{!info && !error && !stopped && \(/);
    // a stop racing the human's decision (POST) lands in the same state
    expect(CONSENT).toMatch(/e\.code === "client_stopped"\) \{\s*setStopped\(true\);\s*\} else \{/);
  });

  test("stopped heading/body pinned in ko and mirrored in en", () => {
    expect(koOf("pages.oauthAuthorize.stoppedHeading")).toBe("연결이 중단된 앱입니다");
    expect(koOf("pages.oauthAuthorize.stoppedBody")).toContain("관리자가 이 앱의 연결을 중단했습니다");
    expect(has("pages.oauthAuthorize.stoppedHeading")).toBe(true);
    expect(has("pages.oauthAuthorize.stoppedBody")).toBe(true);
  });
});

describe("catalog (ko master + en parity, the design's key table)", () => {
  test("all 36 design keys exist in ko and en", () => {
    for (const key of DESIGN_KEYS) {
      expect(koOf(key), `ko missing: ${key}`).toBeTruthy();
      expect(has(key), `en missing: ${key}`).toBe(true);
    }
    expect(DESIGN_KEYS).toHaveLength(36);
  });

  test("the fleet vocabulary is pinned in ko", () => {
    expect(koOf("nav.admin.connectedApps")).toBe("연결된 앱");
    expect(koOf("admin.section.connectedApps")).toBe("연결된 앱");
    expect(koOf("admin.connectedApps.colApp")).toBe("앱 이름");
    expect(koOf("admin.connectedApps.colClientId")).toBe("client_id");
    expect(koOf("admin.connectedApps.colVerified")).toBe("검증");
    expect(koOf("admin.connectedApps.colUsers")).toBe("연결 사용자");
    expect(koOf("admin.connectedApps.colStatus")).toBe("상태");
    expect(koOf("admin.connectedApps.colStoppedAt")).toBe("중단 일시");
    expect(koOf("admin.connectedApps.statusOperating")).toBe("운영 중");
    expect(koOf("admin.connectedApps.statusStopped")).toBe("중단");
    expect(koOf("admin.connectedApps.stopButton")).toBe("중단");
    expect(koOf("admin.connectedApps.startButton")).toBe("시작");
  });

  test("confirm and toast copy pins the JTBD consequence sentences", () => {
    // quoted names use the curly-quote house form — ASCII '{p1}' is the forbidden
    // literal-brace param (the i18n-audit quote-discipline gate).
    expect(koOf("admin.connectedApps.stopConfirmTitle")).toBe("‘{p1}’ 앱을 중단할까요?");
    expect(koOf("admin.connectedApps.startConfirmTitle")).toBe("‘{p1}’ 앱을 시작할까요?");
    expect(koOf("admin.connectedApps.stoppedToast")).toContain("{p2}개 연결이 해지되었습니다");
    expect(koOf("admin.connectedApps.startedToast")).toContain("다시 연결해야 합니다");
    expect(koOf("admin.pageIntro.connectedApps")).toContain("즉시 해지됩니다");
  });
});
