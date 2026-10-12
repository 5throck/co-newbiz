// @version 1.0.0
/**
 * Connected-apps personal API tokens UI — frontend Row 2 source-reading tests
 * (docs/designs/2026-10-11-self-service-api-tokens-design.md §4.2, §7).
 *
 * The page is a client component bound to browser APIs, so these tests read
 * the source and assert the security-relevant invariants statically: the
 * list renders display_id (never the raw token id as an identifier), the
 * one-time reveal modal exists with focus trap + copy feedback + Korean
 * "shown once" warning, and the cnb_pat_ prefix is shown masked.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const PAGE = readFileSync(
  "app/web-next/app/settings/connected-apps/page.tsx",
  "utf8",
);

describe("connected-apps personal API tokens UI", () => {
  test("list identifier uses display_id, not the raw token id", () => {
    expect(PAGE).toContain("display_id");
    // masked display: prefix + bullets + last 6 — the raw id never renders
    expect(PAGE).toContain("cnb_pat_••••");
    expect(PAGE).toMatch(/maskedId\(t\.display_id\)/);
    expect(PAGE).not.toMatch(/<td>\s*\{t\.id\}/);
  });

  test("one-time reveal modal exists with dialog semantics and focus trap", () => {
    expect(PAGE).toContain("TokenRevealModal");
    expect(PAGE).toContain('role="dialog"');
    expect(PAGE).toContain("aria-modal");
    expect(PAGE).toContain("useModalFocus");
  });

  test("modal warns the token is shown only once and is cleared on close", () => {
    expect(PAGE).toContain("다시는 보여주지 않습니다");
    expect(PAGE).toContain("저장했습니다");
    // secret lives in state only and is dropped by the close handler
    expect(PAGE).toMatch(/setRevealed\(null\)/);
    expect(PAGE).not.toMatch(/localStorage|sessionStorage/);
  });

  test("copy feedback is announced via role=status", () => {
    expect(PAGE).toContain('role="status"');
    expect(PAGE).toContain("복사되었습니다");
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
    expect(PAGE).toMatch(/라벨을 입력해 주세요/);
    expect(PAGE).toMatch(/if \(!label\.trim\(\)\)/);
    expect(PAGE).toMatch(/e\.preventDefault\(\)/);
  });

  test("backend error codes map to actionable Korean text under role=alert", () => {
    for (const code of ["session_required", "token_limit_reached", "rate_limited", "invalid_request"]) {
      expect(PAGE).toContain(`"${code}"`);
    }
    expect(PAGE).toContain('role="alert"');
  });

  test("viewer accounts get a read-only explanation instead of the issue form", () => {
    expect(PAGE).toContain("canWriteBusiness");
    expect(PAGE).toContain("읽기 전용 토큰");
  });

  test("revoke confirms irreversibility before api.delete", () => {
    expect(PAGE).toMatch(/되돌릴 수 없으며/);
    expect(PAGE).toMatch(/window\.confirm\([\s\S]*?api\.delete\(`\/api\/tokens/);
  });

  test("status chips pair icon + text, never color alone", () => {
    expect(PAGE).toContain("TOKEN_STATUS");
    expect(PAGE).toMatch(/aria-hidden="true">\{s\.icon\}/);
    for (const label of ["활성", "만료됨", "해지됨"]) expect(PAGE).toContain(label);
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
    expect(PAGE).toMatch(/<td className="cell-nowrap">\{fmtShort\(t\.created_at\)\}<\/td>/);
    expect(PAGE).toMatch(/<td className="cell-nowrap">\{t\.expires_at/);
    expect(PAGE).toMatch(/<td className="cell-nowrap">\{fmtShort\(t\.last_used_at\)\}<\/td>/);
  });

  test("token table uses explicit column sizing: shared system (table-fixed-pct + ColGroup), ellipsis label, scroll wrapper", () => {
    // 2026-10-12 table-sizing batch 2: the bespoke .pat-col-* CSS was replaced
    // by the shared system (ColGroup + table-fixed-pct + tmin + cell-truncate),
    // so the old auto-layout/min-width CSS assertions no longer apply.
    expect(PAGE).toContain("pat-token-table");
    expect(PAGE).toMatch(/<div className="table-scroll"[\s\S]*pat-token-table/);
    expect(PAGE).toMatch(/title=\{t\.label\}/);
    expect(PAGE).toContain("table-fixed-pct tmin-64");
    expect(PAGE).toContain("ColGroup widths={TOKEN_COL_PCT}");
    expect(PAGE).toMatch(/const TOKEN_COL_PCT = \[22, 16, 12, 14, 10, 10, 10, 6\] as const/);
    expect(PAGE).toMatch(/<td className="cell-truncate" title=\{t\.label\}>/);
    expect(PAGE).toContain('dateStyle: "short"');
  });
});
