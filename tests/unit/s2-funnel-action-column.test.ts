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
    expect(tsx).toContain("data-table list-table opp-funnel-table");
    expect(tsx).toContain('className="table-scroll"');
    expect(css).toContain(".list-table.opp-funnel-table");
  });
  test("widened synergy and actions columns", () => {
    expect(tsx).toContain('className="w-[10rem]">시너지');
    expect(tsx).toContain('className="w-[20rem]"');
  });
});
