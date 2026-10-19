// S9 브라운필드 필요 역량 판정 (capability-dd) — 사이드카 병합·검증 규칙.
// 저장은 opportunity.capability_dd_verdicts_json (마이그레이션 0154) — 레지스터
// 자체는 불변이므로 S3 재저장이 판정을 유실할 수 없다 (설계 문서 §3.2).
import { test, expect, describe } from "bun:test";
import {
  CAPABILITY_DD_COVERAGES,
  mergeCapabilityDdVerdicts,
  parseCapabilityDdVerdicts,
  serializeCapabilityDdVerdicts,
  validateCapabilityDdInput,
  CapabilityDdValidationError,
  type CapabilityDdVerdict,
} from "../../app/web-next/lib/capability-dd.ts";

const v = (over: Partial<CapabilityDdVerdict> = {}): CapabilityDdVerdict => ({
  rowId: "gap-1", capability: "정밀 가공", coverage: "resolved", note: "대상 보유 확인", by: "u", at: "2026-10-19T00:00:00.000Z", ...over,
});

describe("capability-dd verdicts", () => {
  test("validate: unknown row / bad coverage / long note are rejected; ok passes", () => {
    const known = new Set(["gap-1", "gap-2"]);
    expect(validateCapabilityDdInput({ rowId: "gap-1", capability: "c", coverage: "partial", note: "n" }, known).coverage).toBe("partial");
    expect(() => validateCapabilityDdInput({ rowId: "gap-x", capability: "c", coverage: "partial" }, known)).toThrow(CapabilityDdValidationError);
    expect(() => validateCapabilityDdInput({ rowId: "gap-1", capability: "c", coverage: "met" }, known)).toThrow(CapabilityDdValidationError);
    expect(() => validateCapabilityDdInput({ rowId: "gap-1", capability: " ", coverage: "partial" }, known)).toThrow(CapabilityDdValidationError);
    expect(() => validateCapabilityDdInput({ rowId: "gap-1", capability: "c", coverage: "resolved", note: "x".repeat(2001) }, known)).toThrow(CapabilityDdValidationError);
  });

  test("merge: latest wins per row and the register order is restored", () => {
    const existing = [v(), v({ rowId: "gap-2", coverage: "unresolved", note: "" })];
    const merged = mergeCapabilityDdVerdicts(existing, v({ rowId: "gap-1", coverage: "partial" }), ["gap-2", "gap-1"]);
    expect(merged.map((x) => [x.rowId, x.coverage])).toEqual([["gap-2", "unresolved"], ["gap-1", "partial"]]);
    expect(merged.find((x) => x.rowId === "gap-1")!.note).toBe("대상 보유 확인");
  });

  test("sidecar round-trips and tolerates malformed JSON", () => {
    const rows = [v(), v({ rowId: "gap-2", coverage: "unresolved" })];
    const raw = serializeCapabilityDdVerdicts(rows);
    expect(parseCapabilityDdVerdicts(raw)).toEqual(rows);
    expect(parseCapabilityDdVerdicts("not json")).toEqual([]);
    expect(parseCapabilityDdVerdicts(JSON.stringify({ rows: [{ rowId: 3 }] }))).toEqual([]);
    expect(parseCapabilityDdVerdicts(null)).toEqual([]);
  });

  test("coverage vocabulary is the three-value closed set", () => {
    expect(CAPABILITY_DD_COVERAGES).toEqual(["resolved", "partial", "unresolved"]);
  });
});
