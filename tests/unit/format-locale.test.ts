// Locale-aware formatter regression (design 2026-10-23-i18n-ui-adoption §5.3):
// ko output of the central helpers is byte-identical to the pre-extraction
// `toLocaleString("ko-KR", …)` rendering; en renderings are pinned for the
// compact KRW-millions convention.
import { describe, expect, test } from "bun:test";
import {
  formatKrwMillions,
  formatKrwMillionsPlain,
  formatNumber,
  formatPercent,
  krwMillionsUnit,
  KRW_MILLIONS_UNIT,
} from "../../app/web-next/lib/format.ts";
import { fmtNpvEok, fmtNpvKrwM } from "../../app/web-next/lib/npv-format.ts";
import { bpToPercent, retentionText } from "../../app/web-next/lib/post-management-view.ts";
import { fmtMoney } from "../../app/web-next/lib/execution-baseline-view.ts";

describe("formatNumber / formatPercent (ko == legacy toLocaleString)", () => {
  test("grouping and fraction digits match", () => {
    expect(formatNumber(1234567.891, "ko", { maximumFractionDigits: 0 })).toBe("1,234,568");
    expect(formatNumber(1234567.891, "ko", { maximumFractionDigits: 2 })).toBe("1,234,567.89");
    expect(formatNumber(12.5, "en", { maximumFractionDigits: 2 })).toBe("12.5");
    expect(formatPercent(0.07, "ko", { maximumFractionDigits: 1 })).toBe("7%");
    expect(formatPercent(0.125, "ko", { maximumFractionDigits: 2 })).toBe("12.5%");
  });
});

describe("formatKrwMillions", () => {
  test("ko keeps the 조/억/백만 convention byte-identical", () => {
    expect(formatKrwMillions(150_000)).toBe("15조");
    expect(formatKrwMillions(15_000)).toBe("1.5조");
    expect(formatKrwMillions(12_500)).toBe("1.25조");
    expect(formatKrwMillions(1_250)).toBe("12.5억");
    expect(formatKrwMillions(15)).toBe("15백만");
    expect(formatKrwMillions(0)).toBe("0 백만원");
    expect(formatKrwMillions(null)).toBe("-");
  });

  test("en uses compact KRW notation", () => {
    expect(formatKrwMillions(1_200, "en")).toBe("KRW 1.2B");
    expect(formatKrwMillions(340, "en")).toBe("KRW 340M");
    expect(formatKrwMillions(5, "en")).toBe("KRW 5.0M");
    expect(formatKrwMillions(0, "en")).toBe("KRW 0M");
    expect(formatKrwMillions(null, "en")).toBe("-");
  });
});

describe("krwMillionsUnit", () => {
  test("ko value equals the legacy KRW_MILLIONS_UNIT constant", () => {
    expect(KRW_MILLIONS_UNIT).toBe("백만 원");
    expect(krwMillionsUnit("ko")).toBe(KRW_MILLIONS_UNIT);
    expect(krwMillionsUnit("en")).toBe("KRW millions");
  });
});

describe("absorbed lib formatters keep ko output", () => {
  test("npv-format", () => {
    expect(fmtNpvKrwM(1234567.891)).toBe("1,234,568");
    expect(fmtNpvKrwM(1234567.891, "ko")).toBe("1,234,568");
    expect(fmtNpvEok(239_412, "ko")).toBe("2,394억원");
  });
  test("post-management-view", () => {
    expect(bpToPercent(1250)).toBe("12.5%");
    expect(bpToPercent(1250, "ko")).toBe("12.5%");
    expect(retentionText(87.5, "ko")).toBe("87.5%");
  });
  test("execution-baseline-view fmtMoney", () => {
    expect(fmtMoney(10030.133473)).toBe("10,030.1");
    expect(fmtMoney(1234567, "KRW", "ko")).toBe("1,234,567");
    expect(fmtMoney(1234.5678, "USD", "ko")).toBe("1,234.57");
  });
  test("formatKrwMillionsPlain", () => {
    expect(formatKrwMillionsPlain(1234567.8)).toBe("1,234,568");
    expect(formatKrwMillionsPlain(1234567.8, "en")).toBe("1,234,568");
  });
});
