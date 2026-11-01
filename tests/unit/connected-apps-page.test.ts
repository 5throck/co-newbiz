// @version 1.1.0
/**
 * Connected-apps personal API tokens UI — frontend Row 2 source-reading tests
 * (docs/designs/2026-10-11-self-service-api-tokens-design.md §4.2, §7).
 *
 * The page is a client component bound to browser APIs, so these tests read
 * the source and assert the security-relevant invariants statically: the
 * list renders display_id (never the raw token id as an identifier), the
 * one-time reveal modal exists with focus trap + copy feedback + the
 * "shown once" warning, and the cnb_pat_ prefix is shown masked.
 *
 * i18n (design 2026-10-23-i18n-ui-adoption, T3-3 batch): page text moved into
 * the pages.connectedApps catalog namespace, so literal pins below resolve as
 * key call site in the page + ko master catalog value (navigation.test.ts
 * precedent).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const PAGE = readFileSync(
  "app/web-next/app/settings/connected-apps/page.tsx",
  "utf8",
);

// ko is the master catalog (design D2) — literal contracts pin the ko value.
const koCatalog = await import("../../app/web-next/locales/ko.json");
const ko = (key: string): string =>
  key.split(".").reduce<unknown>((acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), koCatalog) as string;

describe("connected-apps personal API tokens UI", () => {
  test("list identifier uses display_id, not the raw token id", () => {
    expect(PAGE).toContain("display_id");
    // masked display: prefix + bullets + last 6 — the raw id never renders
    expect(PAGE).toContain("cnb_pat_••••");
    expect(PAGE).toMatch(/maskedId\(tok\.display_id\)/);
    expect(PAGE).not.toMatch(/<td>\s*\{tok\.id\}/);
  });

  test("one-time reveal modal exists with dialog semantics and focus trap", () => {
    expect(PAGE).toContain("TokenRevealModal");
    expect(PAGE).toContain('role="dialog"');
    expect(PAGE).toContain("aria-modal");
    expect(PAGE).toContain("useModalFocus");
  });

  test("modal warns the token is shown only once and is cleared on close", () => {
    expect(ko("pages.connectedApps.revealBodyTail")).toContain("다시는 보여주지 않습니다");
    expect(PAGE).toContain('t("revealBodyTail")');
    expect(ko("pages.connectedApps.revealSavedButton")).toBe("저장했습니다");
    expect(PAGE).toContain('t("revealSavedButton")');
    // secret lives in state only and is dropped by the close handler
    expect(PAGE).toMatch(/setRevealed\(null\)/);
    expect(PAGE).not.toMatch(/localStorage|sessionStorage/);
  });

  test("copy feedback is announced via role=status", () => {
    expect(PAGE).toContain('role="status"');
    expect(ko("pages.connectedApps.copiedOk")).toBe("복사되었습니다");
    expect(PAGE).toContain('t("copiedOk")');
    expect(PAGE).toContain("navigator.clipboard.writeText");
  });

  test("issue form posts scopes and expiresInDays through the api client", () => {
    expect(PAGE).toMatch(/api\.post<[^>]*>\("\/api\/tokens"/);
    expect(PAGE).toContain('["read", "write"]');
    expect(PAGE).toContain("expiresInDays");
    // no raw fetch, and mutations never bypass the CSRF-carrying api client
    expect(PAGE).not.toContain("fetch(");
  });

  test("client-side label validation blocks an empty submit before the network", () => {
    expect(ko("pages.connectedApps.errLabelRequired")).toMatch(/라벨을 입력해 주세요/);
    expect(PAGE).toContain('t("errLabelRequired")');
    expect(PAGE).toMatch(/if \(!label\.trim\(\)\)/);
    expect(PAGE).toMatch(/e\.preventDefault\(\)/);
  });

  test("backend error codes map to actionable localized text under role=alert", () => {
    for (const code of ["session_required", "token_limit_reached", "rate_limited", "invalid_request"]) {
      expect(PAGE).toContain(`"${code}"`);
    }
    expect(PAGE).toContain('role="alert"');
  });

  test("every role gets the issue form; viewer/admin are read-only with role notes", () => {
    // Replaces the old viewer-only explanation: access rules live in lib/token-issue-access.ts.
    expect(PAGE).toContain("canIssueToken(me?.role)");
    expect(PAGE).toContain("canIssueWriteToken(me?.role)");
    expect(PAGE).toContain("writeScopeNoteKey(me?.role)");
    expect(PAGE).toContain("{t(writeNoteKey)}");
    expect(ko("pages.connectedApps.writeNoteViewer")).toContain("읽기 전용 토큰");
    expect(ko("pages.connectedApps.writeNoteAdmin")).toContain("읽기 전용 토큰");
  });

  test("revoke confirms irreversibility before api.delete", () => {
    expect(ko("pages.connectedApps.tokenRevokeBody")).toMatch(/되돌릴 수 없으며/);
    expect(PAGE).toContain('t("tokenRevokeBody")');
    expect(PAGE).not.toMatch(/window\.confirm/);
    expect(PAGE).toMatch(/confirm\([\s\S]*?doRevoke\(tok\)[\s\S]*?api\.delete\(`\/api\/tokens/);
  });

  test("status chips pair icon + text, never color alone", () => {
    expect(PAGE).toContain("TOKEN_STATUS");
    expect(PAGE).toMatch(/aria-hidden="true">\{s\.icon\}/);
    expect(ko("pages.connectedApps.statusActive")).toBe("활성");
    expect(ko("pages.connectedApps.statusExpired")).toBe("만료됨");
    expect(ko("pages.connectedApps.statusRevoked")).toBe("해지됨");
    expect(PAGE).toMatch(/\{t\(s\.key\)\}/);
  });

  // Post-merge follow-up (2026-10-11-ui-label-and-mobile-table-sweep): the
  // issue form uses the responsive .pat-form-grid (labels above controls,
  // single column below 640px via styles.css) and date cells keep nowrap so
  // localized timestamps do not break mid-line inside .table-scroll.
  test("issue form uses the shared grid layout, not ad-hoc flex rows", () => {
    expect(PAGE).toContain("pat-form-grid");
    expect(PAGE).not.toMatch(/alignItems: "flex-end"/);
    for (const cls of ["pat-field", "pat-field-label", "pat-scope-field"]) {
      expect(PAGE).toContain(cls);
    }
    const css = readFileSync("app/web-next/app/styles.css", "utf8");
    expect(css).toMatch(/\.pat-form-grid/);
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*\.pat-form-grid \{ grid-template-columns: minmax\(0, 1fr\)/);
  });

  test("token list date cells keep nowrap so timestamps do not break mid-line", () => {
    expect(PAGE).toMatch(/<td className="cell-nowrap">\{fmtShort\(tok\.created_at, locale\)\}<\/td>/);
    expect(PAGE).toMatch(/<td className="cell-nowrap">\{tok\.expires_at/);
    // last used is relative ("5분 전") with the exact time in title
    expect(PAGE).toMatch(/relativeAgo\(tok\.last_used_at, locale, t\("justNow"\)\)/);
    expect(PAGE).toMatch(/title=\{tok\.last_used_at \? fmtShort\(tok\.last_used_at, locale\)/);
  });

  test("token table uses explicit column sizing: shared system (table-fixed-pct + ColGroup), ellipsis label, scroll wrapper", () => {
    // 2026-10-12 table-sizing batch 2: the bespoke .pat-col-* CSS was replaced
    // by the shared system (ColGroup + table-fixed-pct + tmin + cell-truncate).
    // §2.4 amendment (C7, 2026-10-31): the row collapsed 8 → 5 columns, so the
    // pin moves to the retuned tmin-48 (no horizontal scroll at 1280px).
    expect(PAGE).toContain("pat-token-table");
    expect(PAGE).toMatch(/<div className="table-scroll"[\s\S]*pat-token-table/);
    expect(PAGE).toContain("table-fixed-pct tmin-48");
    expect(PAGE).toContain("ColGroup widths={TOKEN_COL_PCT}");
    expect(PAGE).toMatch(/const TOKEN_COL_PCT = \[34, 24, 16, 16, 10\] as const/);
    expect(PAGE).toContain('dateStyle: "short"');
  });

  test("§2.4 C7: token cell is a hierarchy — label + status chip inline, scope/identifier caption line", () => {
    expect(ko("pages.connectedApps.colToken")).toBe("토큰");
    expect(PAGE).toContain('t("colToken")');
    // primary line: ellipsised label with title + the icon+text chip inline
    expect(PAGE).toMatch(/<span className="cell-truncate" title=\{tok\.label\}>\{tok\.label\}<\/span>/);
    expect(PAGE).toMatch(/aria-hidden="true">\{s\.icon\}/);
    // secondary caption line is text (never colour-only): scope label · masked identifier in mono
    expect(PAGE).toMatch(/text-\[length:var\(--fs-caption\)\] text-\[color:var\(--muted-fg\)\]"/);
    expect(PAGE).toMatch(/\{tok\.scopes\.split\(","\)\.includes\("write"\) \? t\("scopeReadWrite"\) : t\("scopeRead"\)\}/);
    expect(PAGE).toMatch(/<code>\{maskedId\(tok\.display_id\)\}<\/code>/);
    // the identifier/scope/status columns are gone from the header row
    const head = PAGE.slice(PAGE.indexOf('id="pat-token-table"'), PAGE.indexOf("<tbody>"));
    for (const gone of ['t("colIdentifier")', 't("colScopes")', "colLabel"]) {
      expect(head).not.toContain(gone);
    }
    expect(PAGE).toMatch(/<th scope="col">\{t\("colExpires"\)\}<\/th>/);
    expect(PAGE).toMatch(/<th scope="col">\{t\("colLastUsed"\)\}<\/th>/);
    expect(PAGE).toMatch(/<th scope="col">\{t\("colCreated"\)\}<\/th>/);
  });

  test("§2.4 C8: row actions live in the RowMenu; the row itself stays neutral", () => {
    // the established overflow menu (components/crud.tsx) with the §2.4 trigger label
    expect(PAGE).toMatch(/import \{ RowMenu, useConfirm, type RowMenuItem \} from "\.\.\/\.\.\/\.\.\/components\/crud\.tsx"/);
    expect(ko("pages.connectedApps.rowMenuAria")).toBe("{p1} 작업 메뉴");
    expect(PAGE).toMatch(/<RowMenu label=\{t\("rowMenuAria", \{ p1: tok\.label \}\)\} items=\{menuItems\(tok\)\} \/>/);
    // revoked/expired rows render an em dash instead of a menu
    expect(PAGE).toMatch(/\) : \(\n                                "—"\n                              \)\}/);
    // the 해지 item is danger-flagged; identifier copy rides in the same menu
    expect(PAGE).toMatch(/danger: true, separatorBefore: true, onSelect: \(\) => revoke\(tok\)/);
    expect(ko("pages.connectedApps.menuCopyId")).toBe("식별자 복사");
    expect(PAGE).toMatch(/writeText\(maskedId\(tok\.display_id\)\)/);
    // no danger-styled button on the row anymore; danger lives at the commitment point
    expect(PAGE.slice(PAGE.indexOf("<tbody>"))).not.toMatch(/variant="danger"[\s\S]*revoke\(tok\)/);
    // revocation still requires the confirm dialog (default danger tone) before api.delete
    expect(ko("pages.connectedApps.tokenRevokeBody")).toMatch(/되돌릴 수 없으며/);
    expect(PAGE).toMatch(/confirm\([\s\S]*?doRevoke\(tok\)[\s\S]*?api\.delete\(`\/api\/tokens/);
  });

  test("§2.4 C9: reveal modal fits short viewports and copies the config snippet", () => {
    // height cap + internal scroll + pinned footer (footer is a flex sibling of the scroll area)
    expect(PAGE).toMatch(/maxHeight: "min\(85dvh, 48rem\)", display: "flex", flexDirection: "column"/);
    expect(PAGE).toMatch(/overflowY: "auto", minHeight: 0/);
    const footer = PAGE.slice(PAGE.indexOf('overflowY: "auto", minHeight: 0'));
    expect(footer).toMatch(/flexShrink: 0,[\s\S]*revealSavedButton/);
    // the pinned footer stays inside the focus order: it is inside the modal-panel focus trap
    expect(footer.indexOf("revealSavedButton")).toBeLessThan(footer.indexOf("</div>\n    </div>"));
    // snippet copy beside the token copy, both announced via the single aria-live status
    expect(ko("pages.connectedApps.revealSnippetCopy")).toBe("설정 예시 복사");
    expect(ko("pages.connectedApps.revealSnippetCopiedOk")).toBe("설정 예시를 복사했습니다.");
    expect(PAGE).toMatch(/<Button variant="ghost" onClick=\{\(\) => void copySnippet\(\)\}>/);
    expect(PAGE).toMatch(/writeText\(snippet\)/);
    expect(PAGE).toMatch(/role="status" aria-live="polite"/);
    expect(PAGE).toMatch(/t\("revealSnippetCopiedOk"\)/);
    expect(PAGE).toMatch(/t\("revealSnippetCopyFail"\)/);
    // one-time warning and focused read-only input untouched
    expect(PAGE).toMatch(/onFocus=\{\(e\) => e\.currentTarget\.select\(\)\}/);
    expect(ko("pages.connectedApps.revealBodyTail")).toContain("다시는 보여주지 않습니다");
    expect(PAGE).not.toMatch(/localStorage|sessionStorage/);
  });

  test("page is split into hosted-app and personal-token sections with a copyable connector URL", async () => {
    expect(PAGE).toContain('aria-labelledby="hosted-heading"');
    expect(PAGE).toContain('aria-labelledby="pat-heading"');
    expect(PAGE).toContain("navigator.clipboard.writeText(connectorUrl)");
    expect(PAGE).toContain('htmlFor="connector-url"');
    expect(ko("pages.connectedApps.expiry180")).toBe("6개월 (180일)");
    const en = (await import("../../app/web-next/locales/en.json")).default;
    expect(en.pages.connectedApps.expiry180).toBe("180 days (6 months)");
  });

  test("expiry column shows D-n, expired badge and an icon+text expiring-soon chip", () => {
    expect(PAGE).toContain("expiryLabel(tok.status");
    expect(PAGE).toContain("isExpiringSoon(tok.status");
    expect(PAGE).toMatch(/aria-hidden="true">⚠<\/span> \{t\("expiringSoon"\)\}/);
    expect(ko("pages.connectedApps.expiryDaysLeft")).toBe("D-{p1}");
    expect(ko("pages.connectedApps.expiryExpiredBadge")).toBe("만료됨");
  });

  test("token list has a status filter and a collapsible revoked/expired tail", () => {
    expect(PAGE).toContain("filterTokensByStatus");
    expect(PAGE).toContain("aria-expanded");
    expect(PAGE).toContain('useState<TokenStatusFilter>("active")');
    expect(ko("pages.connectedApps.filterExpiring")).toContain("곧 만료");
  });
});
