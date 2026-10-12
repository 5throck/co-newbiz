// Pure helpers for the WACC beta panel's collection-status block, plus
// source-reading wiring checks (no DOM).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  formatSeriesStat, parseBetaSeriesResponse, BETA_SERIES_LOAD_ERROR, shouldFillRows, showsRunbook, statusMessage, statusTone, type BetaCollectionStatus,
} from "../../app/web-next/lib/beta-collection-view.ts";

const W = "./app/web-next";
const stat = (count: number) => ({ count, first_date: count ? "2026-01-01" : null, last_date: count ? "2026-04-01" : null });

describe("status helpers", () => {
  test("only ready/insufficient fill the textarea", () => {
    const fills = (["ready", "insufficient", "no_index", "no_stock", "none"] as BetaCollectionStatus[]).map(shouldFillRows);
    expect(fills).toEqual([true, true, false, false, false]);
  });
  test("runbook shown for none and no_* only", () => {
    expect(showsRunbook("none")).toBe(true);
    expect(showsRunbook("no_stock")).toBe(true);
    expect(showsRunbook("no_index")).toBe(true);
    expect(showsRunbook("ready")).toBe(false);
    expect(showsRunbook("insufficient")).toBe(false);
  });
  test("tone", () => {
    expect(statusTone("ready")).toBe("ok");
    expect(statusTone("insufficient")).toBe("warn");
    expect(statusTone("none")).toBe("danger");
  });
  test("messages", () => {
    expect(statusMessage({ status: "none", aligned: stat(0), min_rows: 63 })).toContain("수집된 시계열이 없습니다");
    expect(statusMessage({ status: "no_stock", aligned: stat(0), min_rows: 63 })).toContain("--ticker");
    expect(statusMessage({ status: "no_index", aligned: stat(0), min_rows: 63 })).toContain("KOSPI");
    expect(statusMessage({ status: "insufficient", aligned: stat(12), min_rows: 63 })).toContain("12일");
    expect(statusMessage({ status: "insufficient", aligned: stat(12), min_rows: 63 })).toContain("63일");
    expect(statusMessage({ status: "ready", aligned: stat(80), min_rows: 63 })).toBe("80일 사용 가능");
  });
  test("formatSeriesStat", () => {
    expect(formatSeriesStat("종목", stat(0))).toBe("종목: 0일");
    expect(formatSeriesStat("종목", stat(5))).toBe("종목: 5일 (2026-01-01 ~ 2026-04-01)");
  });
});

describe("panel wiring", () => {
  const panel = readFileSync(`${W}/components/wacc/BetaPanel.tsx`, "utf8");
  test("status block is aria-live and the command is read-only text", () => {
    expect(panel).toContain('aria-live="polite"');
    expect(panel).toContain("runbook_command");
    expect(panel).not.toContain("child_process");
  });
  test("textarea fill is gated by shouldFillRows", () => {
    expect(panel).toContain("shouldFillRows(c.status)");
  });
  test("probes status on mount without filling", () => {
    expect(panel).toContain("fetchCollected(false)");
  });
});

describe("parseBetaSeriesResponse (real envelope shape, no `ok` field)", () => {
  const row = { date: "2026-01-02", price: 100, index: 2500 };
  test("200 envelope with rows -> rows", () => {
    const r = parseBetaSeriesResponse(true, { data: { collection: null, rows: [row] }, meta: {}, error: null });
    expect(r).toEqual({ ok: true, collection: null, rows: [row] });
  });
  test("200 envelope with empty rows -> ok with no rows (status text decides)", () => {
    const r = parseBetaSeriesResponse(true, { data: { collection: null, rows: [] }, meta: {}, error: null });
    expect(r.ok && r.rows.length).toBe(0);
  });
  test("400 envelope -> error.message", () => {
    const r = parseBetaSeriesResponse(false, { data: null, meta: {}, error: { code: "x", message: "잘못된 요청" } });
    expect(r).toEqual({ ok: false, message: "잘못된 요청" });
  });
  test("non-JSON -> generic message", () => {
    expect(parseBetaSeriesResponse(true, null)).toEqual({ ok: false, message: BETA_SERIES_LOAD_ERROR });
    expect(parseBetaSeriesResponse(false, null)).toEqual({ ok: false, message: BETA_SERIES_LOAD_ERROR });
  });
});
