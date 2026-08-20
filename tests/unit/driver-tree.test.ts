// @version 1.0.0
/**
 * Unit tests for fin:driver-tree (scripts/co-newbiz/driver-tree.ts), which
 * shells out to python/driver_tree.py (reused from co-consult, design v1.0
 * §4-4). Runs the real subprocess against the same canonical-model fixture
 * used by fin-analyze.test.ts.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { computeDriverTree } from "../../scripts/co-newbiz/driver-tree.ts";

const FIXTURE = resolve(import.meta.dirname, "..", "fixtures", "canonical-model-sample.json");

function findNode(tree: any, nodeId: string): any {
  if (tree.id === nodeId) return tree;
  for (const child of tree.children ?? []) {
    const found = findNode(child, nodeId);
    if (found) return found;
  }
  return null;
}

test("root ROIC = NOPAT / Invested Capital, matching an independent calculation", async () => {
  const { tree } = (await computeDriverTree(FIXTURE)) as any;
  expect(tree.id).toBe("roic");
  // 95 / 900 = 10.555...% -> 10.6
  expect(tree.values["2025"]).toBe(10.6);
});

test("NOPAT subtree carries the raw NOPAT series", async () => {
  const { tree } = (await computeDriverTree(FIXTURE)) as any;
  const nopat = findNode(tree, "roic.nopat");
  expect(nopat.values).toEqual({ "2023": 60, "2024": 75, "2025": 95 });
});

test("revenue YoY growth matches an independent calculation", async () => {
  const { tree } = (await computeDriverTree(FIXTURE)) as any;
  const growth = findNode(tree, "roic.nopat.revenue.growth.yoy");
  // 1000 -> 1100 = +10%, 1100 -> 1250 = +13.6%
  expect(growth.values["2024"]).toBe(10.0);
  expect(growth.values["2025"]).toBe(13.6);
});

test("gross margin matches an independent calculation", async () => {
  const { tree } = (await computeDriverTree(FIXTURE)) as any;
  const gm = findNode(tree, "roic.nopat.op_margin.gross_margin");
  // 430 / 1250 = 34.4%
  expect(gm.values["2025"]).toBe(34.4);
});

test("receivables and inventory days are computed from the balance sheet", async () => {
  const { tree } = (await computeDriverTree(FIXTURE)) as any;
  const recvDays = findNode(tree, "roic.ic.wc.recv_days");
  const invDays = findNode(tree, "roic.ic.wc.inv_days");
  // receivables 140 / revenue 1250 * 365 = 40.88 -> 41
  expect(recvDays.values["2025"]).toBe(41);
  // inventory 115 / cogs 820 * 365 = 51.19 -> 51
  expect(invDays.values["2025"]).toBe(51);
});

test("D/E ratio in the cash & debt subtree matches an independent calculation", async () => {
  const { tree } = (await computeDriverTree(FIXTURE)) as any;
  const de = findNode(tree, "roic.ic.cash_debt.de_ratio");
  // (st_debt 115 + lt_debt 320) / equity 600 = 0.7250 -> 0.72
  expect(de.values["2025"]).toBe(0.72);
});

test("throws a clear error for a missing file", async () => {
  await expect(computeDriverTree("tests/fixtures/does-not-exist.json")).rejects.toThrow(/not found/);
});
