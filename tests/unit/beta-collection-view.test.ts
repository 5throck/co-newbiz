// Pure helpers for the WACC beta panel's collection-status block, plus
// source-reading wiring checks (no DOM).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  betaSeriesUrl, indexOptionLabel, indexPairingNote, formatSeriesStat, parseBetaSeriesResponse, defaultSourceMode, runDisabledReason, seriesRange, BETA_SERIES_LOAD_ERROR, shouldFillRows, showsRunbook, statusMessage, statusTone, type BetaCollectionStatus,
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
    expect(r).toEqual({ ok: true, collection: null, rows: [row], indexOptions: [], defaultIndex: null });
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

describe("index choice helpers", () => {
  test("option labels mark the listing market", () => {
    expect(indexOptionLabel("KOSDAQ", "KOSDAQ")).toBe("코스닥 지수(상장시장 기준)");
    expect(indexOptionLabel("KOSPI", "KOSDAQ")).toBe("코스피 지수");
    expect(indexOptionLabel("KOSPI", "unknown")).toBe("코스피 지수");
  });
  test("pairing note explains why", () => {
    expect(indexPairingNote({ index_market: "KOSDAQ", listing_market: "KOSDAQ", index_fallback: false }, false)).toContain("상장시장(KOSDAQ) 기준");
    expect(indexPairingNote({ index_market: "KOSPI", listing_market: "KOSDAQ", index_fallback: true }, false)).toContain("대체");
    expect(indexPairingNote({ index_market: "KOSPI", listing_market: "KOSDAQ", index_fallback: false }, true)).toContain("직접 선택");
    expect(indexPairingNote({ index_market: "KOSPI", listing_market: "unknown", index_fallback: false }, false)).toContain("기본값(코스피)");
    expect(indexPairingNote({}, false)).toContain("코스피 지수");
  });
  test("url carries ?index only when chosen", () => {
    expect(betaSeriesUrl("p 1", null)).toBe("/api/projects/p%201/wacc/beta-series");
    expect(betaSeriesUrl("p1", "KOSDAQ")).toBe("/api/projects/p1/wacc/beta-series?index=KOSDAQ");
  });
  test("parse exposes index options and default", () => {
    const opts = [{ series_id: "krx:index:KOSDAQ:close", label: "KOSDAQ" as const, count: 5, selected: true }];
    const r = parseBetaSeriesResponse(true, { data: { collection: null, rows: [], index_options: opts, default_index: "KOSDAQ" }, meta: {}, error: null });
    expect(r.ok && r.indexOptions).toEqual(opts);
    expect(r.ok && r.defaultIndex).toBe("KOSDAQ");
  });
  test("panel passes the index on load and shows the pairing note", () => {
    const panel = readFileSync(`${W}/components/wacc/BetaPanel.tsx`, "utf8");
    expect(panel).toContain("betaSeriesUrl(projectId, index)");
    expect(panel).toContain("indexPairingNote(collection");
  });
  test("no_index message names the selected index", () => {
    expect(statusMessage({ status: "no_index", aligned: stat(0), min_rows: 63, index_market: "KOSDAQ" })).toContain("KOSDAQ");
  });
});

describe("beta step-1 helpers", () => {
  test("default source follows collection status", () => {
    expect(defaultSourceMode("ready")).toBe("collected");
    expect(defaultSourceMode("insufficient")).toBe("collected");
    expect(defaultSourceMode("none")).toBe("paste");
    expect(defaultSourceMode("no_stock")).toBe("paste");
    expect(defaultSourceMode("no_index")).toBe("paste");
    expect(defaultSourceMode(undefined)).toBe("paste");
  });
  test("disabled reason: load hint when collected data is ready but not loaded", () => {
    expect(runDisabledReason(0, "ready")).toBe("먼저 수집 데이터를 불러오세요");
    expect(runDisabledReason(0, "none")).toContain("입력 데이터가 없습니다");
    expect(runDisabledReason(1, undefined)).toContain("붙여넣으세요");
  });
  test("seriesRange", () => {
    expect(seriesRange(stat(0))).toBe("0일");
    expect(seriesRange(stat(5))).toContain("2026-01-01 ~ 2026-04-01");
  });
});

describe("BetaPanel regression step cards", () => {
  const panel = readFileSync(`${W}/components/wacc/BetaPanel.tsx`, "utf8");
  test("no undefined ghost-button class remains", () => {
    expect(panel).not.toContain("ghost-button");
  });
  test("segmented source control with both options", () => {
    expect(panel).toContain("<TabNav");
    // i18n: labels moved to the catalog — pin the keys (stages.s8.wacc.betaPanel.*).
    expect(panel).toContain('t("useCollectedData")');
    expect(panel).toContain('t("pasteDirectly")');
    expect(panel).toContain("defaultSourceMode(collection?.status)");
  });
  test("placeholder is a single line with no sample rows", () => {
    expect(panel).toContain('placeholder={t("pasteAsDatePriceIndex")}');
    expect(panel).not.toContain("2026-09-10,68400");
  });
  test("status block lives inside step 1, before step 2", () => {
    const step1 = panel.indexOf('id="beta-step1-title"');
    const status = panel.indexOf("statusMessage(collection)");
    const step2 = panel.indexOf('id="beta-step2-title"');
    expect(step1).toBeLessThan(status);
    expect(status).toBeLessThan(step2);
  });
  test("raw rows are inspectable in a collapsed details; load precedes run", () => {
    expect(panel).toContain("<details");
    expect(panel).toContain('t("viewImportedRawRows")');
    expect(panel.indexOf('t("loadCollectedData2")')).toBeLessThan(panel.indexOf('t("runRegression")'));
  });
  test("run button disabled below 2 rows with visible reason; busy state kept", () => {
    expect(panel).toContain("disabled={!canRunRegression}");
    expect(panel).toContain("runDisabledReason(collectedRowCount, collection?.status)");
    expect(panel).toContain("aria-busy={loading}");
    expect(panel).toContain('t("daysLoaded")');
  });
});
