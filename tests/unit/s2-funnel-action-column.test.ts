import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync("./app/web-next/app/styles.css", "utf8");
const tsx = readFileSync("./app/web-next/components/stages/OpportunityFunnelStage.tsx", "utf8");

describe("S2 funnel action column overflow", () => {
  test("actions row wraps inside its cell", () => {
    const block = css.match(/\.sizing-actions-cell > \.actions-row \{[^}]*\}/)?.[0] ?? "";
    expect(block).toContain("flex-wrap: wrap");
  });
  test("funnel table uses the modifier and stays in .table-scroll", () => {
    expect(tsx).toContain("data-table list-table list-wide table-fixed-pct tmin-56 opp-funnel-table");
    expect(tsx).toContain('className="table-scroll"');
    expect(css).toContain(".list-table.list-wide { max-width: 80rem; }");
    // bespoke rem width rules are gone: widths come from the percentage ColGroup
    expect(css).not.toContain(".list-table.opp-funnel-table");
  });
  test("columns use a percentage ColGroup (no per-th rem widths); name cell truncates with a title", () => {
    expect(tsx).toContain("FUNNEL_COL_PCT = [14, 34, 12, 16, 24] as const");
    expect(tsx).toContain("<ColGroup widths={FUNNEL_COL_PCT} />");
    expect(tsx).not.toMatch(/<th[^>]*className="w-\[/);
    expect(tsx).toContain("cell-truncate");
    expect(tsx).toContain("title={o.name}");
  });
});
