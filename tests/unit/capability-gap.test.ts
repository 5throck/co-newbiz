// Unit tests for the S3 capability-gap register normalizer (ADR-0136 extends
// it with requiredLevel/currentLevel so Greenfield S5 can share the same
// register instead of maintaining its own). Pure function — no DB.
import { test, expect, describe } from "bun:test";
import { normalizeGapRows, parseGapRegister, summarizeGap } from "../../app/web-next/lib/capability-gap.ts";

describe("normalizeGapRows", () => {
  test("parses requiredLevel/currentLevel alongside existing fields", () => {
    const rows = normalizeGapRows([
      {
        id: "gap-1",
        capability: "관절 감속기 설계",
        source: "s1_factors",
        requiredNote: "S1 근거",
        held: { status: "partial", holders: ["레인보우로보틱스"], evidence: "프로필 인용" },
        resolution: "partner",
        note: "S5 비고",
        requiredLevel: "5",
        currentLevel: "2",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].requiredLevel).toBe("5");
    expect(rows[0].currentLevel).toBe("2");
    expect(rows[0].resolution).toBe("partner");
  });

  test("missing requiredLevel/currentLevel default to empty string, not undefined", () => {
    const rows = normalizeGapRows([{ capability: "돌봄 규제 컴플라이언스" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].requiredLevel).toBe("");
    expect(rows[0].currentLevel).toBe("");
  });

  test("round-trips through parseGapRegister unchanged", () => {
    const json = JSON.stringify({
      rows: [{ capability: "A", requiredLevel: "3", currentLevel: "1", held: { status: "met" } }],
      updatedAt: "2026-09-15T00:00:00.000Z",
    });
    const { rows } = parseGapRegister(json);
    expect(rows[0].requiredLevel).toBe("3");
    expect(rows[0].currentLevel).toBe("1");
  });

  test("non-string requiredLevel/currentLevel are dropped, not coerced", () => {
    const rows = normalizeGapRows([{ capability: "A", requiredLevel: 5, currentLevel: null }]);
    expect(rows[0].requiredLevel).toBe("");
    expect(rows[0].currentLevel).toBe("");
  });
});

describe("summarizeGap (unaffected by the new fields)", () => {
  test("still computes coverage from held.status only", () => {
    const rows = normalizeGapRows([
      { capability: "A", held: { status: "met" }, requiredLevel: "5", currentLevel: "5" },
      { capability: "B", held: { status: "unmet" }, requiredLevel: "5", currentLevel: "1" },
    ]);
    const summary = summarizeGap(rows);
    expect(summary.total).toBe(2);
    expect(summary.evaluated).toBe(2);
    expect(summary.coveragePct).toBe(50);
  });
});
