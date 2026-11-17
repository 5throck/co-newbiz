// @version 1.0.0
// Review findings #2/#3 (2026-11-17): S5 투자비 manual rows must never be dropped silently when
// they carry content but no item name, and the saved/unsaved chips must track rows by a stable id
// (not by index) so deleting a row does not mislabel the rows below it.
import { describe, expect, test } from "bun:test";
import {
  manualRowDirtyByRow,
  manualRowHasContent,
  manualRowsWithoutName,
  nextManualRowId,
  stripManualRowIds,
} from "../../app/web-next/lib/greenfield-manual-rows.ts";
import type { ManualCostLine } from "../../app/web-next/lib/capability-cost-lines.ts";

const row = (over: Partial<ManualCostLine> = {}): ManualCostLine => ({
  line: "",
  amount: 0,
  currency: "KRW",
  ...over,
});

describe("manualRowsWithoutName (finding #2)", () => {
  test("a freshly added empty row is NOT incomplete (no content besides the name)", () => {
    expect(manualRowsWithoutName([row()])).toHaveLength(0);
  });
  test("a row with an amount but no name is incomplete", () => {
    expect(manualRowsWithoutName([row({ amount: 120 })])).toHaveLength(1);
  });
  test("a named row with an amount is fine", () => {
    expect(manualRowsWithoutName([row({ line: "설비", amount: 120 })])).toHaveLength(0);
  });
  test("note / category / period / sub-category each count as content; currency alone does not", () => {
    expect(manualRowHasContent(row({ note: "메모" }))).toBe(true);
    expect(manualRowHasContent(row({ category: "capex" }))).toBe(true);
    expect(manualRowHasContent(row({ period: "yearly" }))).toBe(true);
    expect(manualRowHasContent(row({ subCategory: "machinery" }))).toBe(true);
    expect(manualRowHasContent(row({ currency: "KRW" }))).toBe(false);
  });
  test("a whitespace-only name still counts as missing", () => {
    expect(manualRowsWithoutName([row({ line: "  ", amount: 5 })])).toHaveLength(1);
  });
});

describe("manualRowDirtyByRow (finding #3)", () => {
  test("a row tracks its own snapshot by id, not by index", () => {
    const id = nextManualRowId();
    const saved = [row({ rowId: id, line: "A", amount: 1 })];
    expect(manualRowDirtyByRow(row({ rowId: id, line: "A", amount: 1 }), saved)).toBe(false);
    expect(manualRowDirtyByRow(row({ rowId: id, line: "A", amount: 2 }), saved)).toBe(true);
  });
  test("deleting an earlier row does not shift another row's chip state", () => {
    const idA = nextManualRowId();
    const idB = nextManualRowId();
    const saved = [row({ rowId: idA, line: "A" }), row({ rowId: idB, line: "B", amount: 3 })];
    // after deleting A the surviving row keeps its own id → still "saved"
    expect(manualRowDirtyByRow(row({ rowId: idB, line: "B", amount: 3 }), saved)).toBe(false);
  });
  test("a row with no snapshot yet (newly added) is dirty", () => {
    expect(manualRowDirtyByRow(row({ rowId: nextManualRowId(), line: "x" }), [])).toBe(true);
    expect(manualRowDirtyByRow(row({ line: "x" }), [row({ line: "x" })])).toBe(true);
  });
});

describe("stripManualRowIds", () => {
  test("UI-only row ids never reach a POST payload; other fields survive", () => {
    const lines = [row({ rowId: nextManualRowId(), line: "A", amount: 9, note: "n" })];
    const out = stripManualRowIds(lines);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toHaveProperty("rowId");
    expect(out[0].line).toBe("A");
    expect(out[0].amount).toBe(9);
    expect(out[0].note).toBe("n");
  });
});
