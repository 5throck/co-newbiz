// @version 1.0.0
/** S5 unified investment table: manual and capability rows share one colgroup and one cell/control class set. Source-structure test, no browser. */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const src = readFileSync(join(ROOT, "app/web-next/components/stages/GreenfieldStage.tsx"), "utf8");
const css = readFileSync(join(ROOT, "app/web-next/app/styles.css"), "utf8");
const start = src.indexOf('data-testid="invest-item-list"');
const tbody = src.slice(start, src.indexOf("</tbody>", start));
const capRow = tbody.slice(tbody.indexOf("invest-cap-row-"), tbody.indexOf("invest-manual-row-"));
const manualRow = tbody.slice(tbody.indexOf("invest-manual-row-"));

test("one table, one colgroup, ten header columns", () => {
  expect(src.match(/<ColGroup widths=\{INVEST_ITEM_COL_PCT\}/g)?.length).toBe(1);
  expect(src).toContain("INVEST_ITEM_COL_PCT = [18, 10, 10, 10, 9, 7, 7, 13, 10, 6]");
  expect(src).toContain("invest-item-table");
  expect(css).toContain(".invest-item-table td");
});

test("both row kinds use the same shared control and cell classes", () => {
  for (const row of [capRow, manualRow]) {
    expect(row).toContain("invest-ctl");
    expect(row).toContain("invest-ctl-num");
    expect(row).toContain("invest-year-cell");
    expect(row).toContain("invest-year-field");
    expect(row).toContain("invest-action-cell");
    expect(row).toContain("invest-cell-chips");
    expect(row.match(/<td/g)?.length).toBe(10);
    expect(row).not.toMatch(/style=\{\{ width/);
  }
  expect(capRow).toContain("invest-ctl-ro");
  expect(manualRow).not.toContain("invest-ctl-ro");
});

test("read-only capability cells keep select and input boxes (no bare spans for unit/currency/period)", () => {
  expect(capRow.match(/<select/g)?.length).toBe(4);
  expect(manualRow.match(/<select/g)?.length).toBe(4);
  expect(css).toMatch(/\.invest-ctl \{[^}]*height: 2rem/);
  expect(css).toMatch(/\.invest-ctl-num \{[^}]*text-align: right/);
});
