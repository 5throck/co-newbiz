/**
 * Target sync failure visibility + the unverified-code chip — design
 * 2026-11-11-target-identity-resolution §7 (D6/D7, DEC-20261111-06 R6/R7).
 *
 * Three layers, mirroring house patterns:
 *  - route: the sync route audits company_financial_sync_failed on the
 *    DartSyncError path before the 4xx/5xx envelope (temp-DB fixture); the
 *    success audit row is unchanged;
 *  - render: TargetSyncBanner (fail → alert + retry; no code → informational;
 *    mismatch warning → DART registered name) and the 웹제안 card chip
 *    (`고유번호 미확인` iff dart_corp_code absent) render via
 *    renderToStaticMarkup + NextIntlClientProvider (deal-shape-panel-render
 *    pattern);
 *  - source pins: the hook no longer swallows the auto-sync error
 *    (ApiError envelope → banner state), retrySync clears it, the eval-draft
 *    note branches on the target's dart_corp_code.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";

const WEB = "../../app/web-next";
const { renderToStaticMarkup } = (await import(`${WEB}/node_modules/react-dom/server.js`)) as {
  renderToStaticMarkup: (el: unknown) => string;
};
const { createElement } = (await import(`${WEB}/node_modules/react/index.js`)) as {
  createElement: (type: unknown, props: unknown, ...c: unknown[]) => unknown;
};
const { NextIntlClientProvider } = (await import(`${WEB}/node_modules/next-intl`)) as {
  NextIntlClientProvider: unknown;
};
const ko = (await import(`${WEB}/locales/ko.json`)).default as Record<string, unknown>;
const en = (await import(`${WEB}/locales/en.json`)).default as Record<string, unknown>;
const { TargetSyncBanner } = (await import(`${WEB}/components/brownfield-target/TargetOverviewTabs.tsx`)) as {
  TargetSyncBanner: unknown;
};
const { WebDiscoveryPanel } = (await import(`${WEB}/components/stages/brownfield/DiscoveryPanels.tsx`)) as {
  WebDiscoveryPanel: unknown;
};

const HOOK = readFileSync("app/web-next/components/brownfield-target/useTargetDetail.ts", "utf8");
const SYNC_ROUTE = readFileSync("app/web-next/app/api/companies/[companyId]/sync/route.ts", "utf8");
const EVAL_DRAFT = readFileSync(
  "app/web-next/app/api/brownfield/[oppId]/targets/[targetId]/eval-draft/route.ts",
  "utf8",
);
const PANELS = readFileSync("app/web-next/components/stages/brownfield/DiscoveryPanels.tsx", "utf8");

function render(el: unknown, locale: "ko" | "en" = "ko"): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" },
      el,
    ),
  );
}

// ── D6 route: failure audit ──
const TEST_DB_PATH = "db/data/test-target-sync-visibility.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

const NOW = "2026-11-11T10:00:00Z";
const ANALYST = "sync-vis-analyst";
let analystCookie = "";
const companyId = ulid();
let savedDartKey: string | undefined;

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-syncvis-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ userId: ANALYST, password: "pw-syncvis-12345" }),
  });
  analystCookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
  db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [companyId, "동기화가시회사", NOW]);
  // dart_not_configured is a DartSyncError — the deterministic (no-network)
  // way to drive the route's failure branch.
  savedDartKey = process.env.DART_API_KEY;
  process.env.DART_API_KEY = "";
});

afterAll(() => {
  if (savedDartKey !== undefined) process.env.DART_API_KEY = savedDartKey;
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("D6 — sync route audits the DartSyncError path", () => {
  test("a failed sync writes company_financial_sync_failed before the error envelope", async () => {
    const before = (
      db.query("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'company_financial_sync_failed'").get() as {
        c: number;
      }
    ).c;
    const res = await nextRequest(`/api/companies/${companyId}/sync`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: "{}",
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("dart_not_configured");
    const after = (
      db.query("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'company_financial_sync_failed'").get() as {
        c: number;
      }
    ).c;
    expect(after).toBe(before + 1);
    const row = db
      .query(
        "SELECT actor_user_id, target FROM audit_log WHERE action = 'company_financial_sync_failed' ORDER BY created_at DESC LIMIT 1",
      )
      .get() as { actor_user_id: string; target: string };
    expect(row.actor_user_id).toBe(ANALYST);
    expect(row.target).toBe(companyId);
  });

  test("the success audit action is unchanged (pinned by source — a success needs a live DART key)", () => {
    expect(SYNC_ROUTE).toContain('action: "company_financial_sync"');
    expect(SYNC_ROUTE).toContain('action: "company_financial_sync_failed"');
    // failed audit is appended BEFORE the fail(...) envelope, inside the DartSyncError branch
    expect(SYNC_ROUTE.indexOf("company_financial_sync_failed")).toBeGreaterThan(
      SYNC_ROUTE.indexOf("instanceof DartSyncError"),
    );
  });
});

// ── D6 hook + banner ──
describe("D6 — hook surfaces sync failures; banner renders the three states", () => {
  test("the auto-sync catch no longer swallows errors — envelope code+message become banner state", () => {
    expect(HOOK).not.toMatch(/\.catch\(\(\) => \{\}\)/);
    expect(HOOK).toContain("applySyncFailure");
    expect(HOOK).toContain("instanceof ApiError");
    expect(HOOK).toContain("corp_code_unregistered"); // client-derived no-code state
    expect(HOOK).toContain("retrySync");
  });

  test("retrySync re-invokes the same POST and clears the banner state on entry", () => {
    const retry = HOOK.slice(HOOK.indexOf("const retrySync"));
    expect(retry).toContain("setSyncError(null)");
    expect(retry).toContain("/sync");
  });

  test("fail state renders role=alert with the envelope message and a retry button", () => {
    const html = render(
      createElement(TargetSyncBanner, {
        ctx: {
          syncError: { code: "corp_code_unresolved", message: "Cannot resolve the DART corp code" },
          syncWarnings: [],
          retrySync: () => {},
        },
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Cannot resolve the DART corp code");
    expect(html).toContain("재시도");
    expect(html).not.toContain("고유번호 미등록");
  });

  test("no-code state renders the informational banner pointing at the edit form (ko/en)", () => {
    const html = render(
      createElement(TargetSyncBanner, {
        ctx: { syncError: { code: "corp_code_unregistered", message: "" }, syncWarnings: [], retrySync: () => {} },
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("고유번호 미등록");
    expect(html).not.toContain("재시도");
    const htmlEn = render(
      createElement(TargetSyncBanner, {
        ctx: { syncError: { code: "corp_code_unregistered", message: "" }, syncWarnings: [], retrySync: () => {} },
      }),
      "en",
    );
    expect(htmlEn).toContain("No corp code");
  });

  test("mismatch warnings render the corp_code_name_mismatch line including DART's registered name", () => {
    const html = render(
      createElement(TargetSyncBanner, {
        ctx: {
          syncError: null,
          syncWarnings: ["corp_code_name_mismatch: DART corp_name='한국전력공사' for code 00159193"],
          retrySync: () => {},
        },
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("한국전력공사");
    expect(html).toContain("00159193");
  });

  test("clean state renders nothing", () => {
    const html = render(
      createElement(TargetSyncBanner, { ctx: { syncError: null, syncWarnings: [], retrySync: () => {} } }),
    );
    expect(html).toBe("");
  });
});

// ── D6 eval-draft note branches on the target's code ──
describe("D6 — eval-draft note conditional on the target's dart_corp_code", () => {
  test("the target row carries dart_corp_code and the empty-facts note has both variants", () => {
    expect(EVAL_DRAFT).toContain("bt.dart_corp_code,");
    expect(EVAL_DRAFT).toContain("target.dart_corp_code");
    expect(EVAL_DRAFT).toContain(
      "DART 재무 동기화가 아직 성공하지 못했습니다. 후보 상세의 재무 동기화를 다시 실행하세요",
    );
    expect(EVAL_DRAFT).toContain(
      "DART 고유번호가 없어 자동 동기화가 시도되지 않았습니다. 후보 수정에서 고유번호를 등록한 뒤 다시 시도하세요",
    );
    // the old unconditional "retry later" advice is gone
    expect(EVAL_DRAFT).not.toContain("잠시 후 다시 시도하세요");
  });
});

// ── D7 chip ──
describe("D7 — 고유번호 미확인 chip on codeless suggestion cards", () => {
  const baseCtx = {
    selected: { id: "o1" },
    discoveryPanel: "web" as const,
    webBusy: false,
    setDiscoveryPanel: () => {},
    webModalFocus: { panelRef: { current: null }, onKeyDown: () => {} },
    webNote: null,
    webSource: "llm" as const,
    acceptProposal: () => {},
    setWebProposals: () => {},
    generateWebProposals: () => Promise.resolve(),
  };
  const suggestion = (dartCorpCode?: string) => ({
    company_name: "비에이치아이(BHI)",
    rationale: "r",
    sources: [],
    reliability: "A" as const,
    ...(dartCorpCode !== undefined ? { dart_corp_code: dartCorpCode } : {}),
  });

  test("chip renders iff dart_corp_code is absent, with the tooltip; present code → no chip", () => {
    const without = render(createElement(WebDiscoveryPanel, { ctx: { ...baseCtx, webProposals: [suggestion()] } }));
    expect(without).toContain("고유번호 미확인");
    expect(without).toContain("DART 고유번호가 확인되지 않은 제안입니다");

    const withCode = render(
      createElement(WebDiscoveryPanel, { ctx: { ...baseCtx, webProposals: [suggestion("00409788")] } }),
    );
    expect(withCode).not.toContain("고유번호 미확인");

    // the chip class is the design-system token pair, and the condition is the code absence itself
    expect(PANELS).toContain("!s.dart_corp_code &&");
    expect(PANELS).toContain('status-chip status-not-started" title={t("corpCodeUnverifiedTooltip")}');
  });

  test("locale keys present in both catalogs (ko master + en)", () => {
    const dotValue = (catalog: Record<string, unknown>, path: string): unknown => {
      let v: unknown = catalog;
      for (const part of path.split(".")) v = (v as Record<string, unknown>)[part];
      return v;
    };
    for (const catalog of [ko, en] as Array<Record<string, unknown>>) {
      expect(typeof dotValue(catalog, "stages.s67.discoveryPanels.corpCodeUnverifiedChip")).toBe("string");
      expect(typeof dotValue(catalog, "stages.s67.discoveryPanels.corpCodeUnverifiedTooltip")).toBe("string");
      for (const key of ["syncNoCodeChip", "syncNoCodeBanner", "syncRetry", "syncMismatchChip", "syncMismatchBanner"]) {
        expect(typeof dotValue(catalog, `components.brownfieldTarget.overviewTabs.${key}`)).toBe("string");
      }
    }
    expect(dotValue(ko, "stages.s67.discoveryPanels.corpCodeUnverifiedChip")).toBe("고유번호 미확인");
  });
});
