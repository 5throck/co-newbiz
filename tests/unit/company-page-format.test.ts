// @version 1.0.0
import { test, expect } from "bun:test";
import { mapSyncError, syncSuccessMessage, formatWaccValue, formatAsOfLabel } from "../../app/web-next/lib/company-page-format.ts";

test("code mapping wins, server message appended", () => {
  const m = mapSyncError(503, "dart_not_configured", "DART key missing");
  expect(m).toContain("DART 연동이 설정되지 않았습니다");
  expect(m).toContain("DART key missing");
});
test("message substring mapping under dart_retrieval_failed", () => {
  expect(mapSyncError(409, "unknown_error", "DART 조회 실패 — DART_HTML_BLOCKED")).toContain("일시적으로 접속을 차단");
  expect(mapSyncError(409, "unknown_error", "x DART_RATE_LIMITED")).toContain("요청 한도");
  expect(mapSyncError(409, "dart_retrieval_failed", "DART_RATE_LIMITED")).toContain("가져오지 못했습니다");
});
test("fallback and status mapping", () => {
  expect(mapSyncError(403, "x", "no")).toContain("권한");
  expect(mapSyncError(500, "x", "boom")).toContain("boom");
});
test("success distinguishes zero inserted", () => {
  expect(syncSuccessMessage({ inserted: 0, unchanged: 12, years: [2024] })).toContain("동일하여 마지막 동기화 날짜는 바뀌지 않습니다");
  expect(syncSuccessMessage({ inserted: 3, unchanged: 9, years: [] })).toBe("동기화 완료 — 신규 3건 · 변경 없음 9건");
});
test("value formatting", () => {
  expect(formatWaccValue(0.0285, "ratio")).toBe("2.85%");
  expect(formatWaccValue(0.5, "multiple")).toBe("0.50x");
  expect(formatWaccValue(null, "ratio")).toBe("N/A");
});
test("as_of label", () => {
  expect(formatAsOfLabel("2026-09")).toBe("2026년 9월 기준");
  expect(formatAsOfLabel("2025")).toBe("2025 회계연도 기준");
  expect(formatAsOfLabel(null)).toBeNull();
});
