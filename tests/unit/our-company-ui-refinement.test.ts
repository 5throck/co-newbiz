import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { groupAnalysisMeta, isStaleAnalysis } from "../../app/web-next/components/stages/our-company/member-stats.ts";
import { PROFILE_STALE_DAYS, MEMBER_COL_PCT, COMPETITOR_COL_PCT } from "../../app/web-next/components/stages/our-company/constants.ts";

const dir = "./app/web-next/components/stages/our-company/";
const members = readFileSync(`${dir}MembersPanel.tsx`, "utf8");
const groups = readFileSync(`${dir}GroupPanels.tsx`, "utf8");
const constants = readFileSync(`${dir}constants.ts`, "utf8");
const section = readFileSync(`${dir}ProfileSection.tsx`, "utf8");
const competitive = readFileSync(`${dir}ProfileCompetitiveTab.tsx`, "utf8");
const page = readFileSync("./app/web-next/app/our-company/page.tsx", "utf8");
const crud = readFileSync("./app/web-next/components/crud.tsx", "utf8");
const css = readFileSync("./app/web-next/app/styles.css", "utf8");

const NOW = new Date("2026-10-11T00:00:00Z");

describe("stale computation", () => {
  test("threshold is 90 days", () => expect(PROFILE_STALE_DAYS).toBe(90));
  test("no date is not stale", () => expect(isStaleAnalysis(null, NOW)).toBe(false));
  test("24 days old is fresh", () => expect(isStaleAnalysis("2026-09-17T00:00:00Z", NOW)).toBe(false));
  test("exactly 90 days is fresh, 91 is stale", () => {
    expect(isStaleAnalysis("2026-07-13T00:00:00Z", NOW)).toBe(false);
    expect(isStaleAnalysis("2026-07-12T00:00:00Z", NOW)).toBe(true);
  });
  test("invalid date is not stale", () => expect(isStaleAnalysis("nope", NOW)).toBe(false));
});

describe("group analysis meta", () => {
  test("counts analyzed and picks newest date", () => {
    const m = groupAnalysisMeta([
      { latest_version: 1, analyzed_at: "2026-09-01T10:00:00Z" },
      { latest_version: 2, analyzed_at: "2026-09-17T10:00:00Z" },
      { latest_version: null, analyzed_at: null },
    ], NOW);
    expect(m).toEqual({ analyzed: 2, total: 3, lastDate: "2026-09-17", stale: false });
  });
  test("none analyzed", () => {
    expect(groupAnalysisMeta([{ latest_version: null, analyzed_at: null }], NOW)).toEqual({ analyzed: 0, total: 1, lastDate: null, stale: false });
  });
  test("stale when newest is older than threshold", () => {
    expect(groupAnalysisMeta([{ latest_version: 1, analyzed_at: "2026-01-01T00:00:00Z" }], NOW).stale).toBe(true);
  });
});

describe("our-company layout source", () => {
  test("header is one line plus closed details, no emoji headings", () => {
    expect(page).toContain('<details className="how-used');
    expect(page).not.toMatch(/<details[^>]*\bopen\b/);
    for (const src of [groups, members, section]) expect(src).not.toMatch(/[🏢🏭🔗]/u);
  });
  test("group cards keep aria-pressed and show a check icon", () => {
    expect(groups).toContain("aria-pressed={active}");
    expect(groups).toContain("CheckIcon");
    // 2026-10-22 토큰 수선: 44px 리터럴이 --touch-target 토큰으로 치환되었다 (동일 산출값).
    expect(css).toMatch(/\.group-card \{[^}]*min-width: 10rem;[^}]*min-height: (?:44px|var\(--touch-target\))/s);
  });
  test("member table is scrollable, fixed-width, with a read-only viewer chip", () => {
    expect(members).toContain('className="table-scroll"');
    expect(members).toContain("data-table list-table members-list-table");
    expect(members).toContain("member-role-select");
    expect(css).toContain(".list-table.members-list-table");
    expect(css).toMatch(/\.member-role-select \{[^}]*box-sizing: border-box/);
    expect(members).toContain("canAct ? (");
  });
  test("tables use percentage colgroups summing to 100 and no auto column", () => {
    expect(MEMBER_COL_PCT.reduce((a, b) => a + b, 0)).toBe(100);
    expect(COMPETITOR_COL_PCT.reduce((a, b) => a + b, 0)).toBe(100);
    expect(members).toContain("<ColGroup");
    expect(members).toContain("<ColGroup widths={MEMBER_COL_PCT} />");
    expect(competitive).toContain("<ColGroup widths={COMPETITOR_COL_PCT} />");
    expect(members).toContain("table-fixed-pct");
    expect(competitive).toContain("table-fixed-pct");
    // header cells carry no fixed widths that would fight the colgroup
    expect(members).not.toMatch(/<th[^>]*className="w-\[/);
    expect(css).toMatch(/\.member-name-btn \{[^}]*text-overflow: ellipsis/s);
    expect(css).toMatch(/\.member-name-btn \{[^}]*white-space: nowrap/s);
    expect(css).toMatch(/\.competitor-table \.competitor-name \{[^}]*text-overflow: ellipsis/s);
    expect(members).toContain("title={m.company_name}");
  });
  test("destructive actions live only in menus", () => {
    expect(members).not.toMatch(/btn-danger/);
    expect(members).toContain("danger: true");
    expect(members).toContain("removeMember(m.id)");
    expect(members).toContain("removeGroup(");
    expect(competitive).toContain('key: "exclude"');
  });
  test("stale constant and INTERIM-WORDING markers", () => {
    expect(constants).toContain("PROFILE_STALE_DAYS = 90");
    expect((constants.match(/INTERIM-WORDING/g) ?? []).length).toBeGreaterThanOrEqual(8);
  });
  test("RowMenu follows the menu keyboard contract", () => {
    for (const needle of ['role="menu"', 'role="menuitem"', 'aria-haspopup="menu"', '"Escape"', '"ArrowDown"', '"Home"', '"Tab"']) expect(crud).toContain(needle);
  });
});
