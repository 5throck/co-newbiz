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

// ── readLiveCapabilityCoverage (design 2026-10-18-synergy-4element-design,
//    Amendment 2026-11-12) — blend-parity with the pre-extraction
//    synergy-rescore.ts values (the rescore suite's existing expectations must
//    not move) and the null rule. The helper takes a Database; a :memory:
//    stub of the one column it reads keeps these tests pure-fast.
import { Database } from "bun:sqlite";
import { readLiveCapabilityCoverage } from "../../app/web-next/lib/capability-gap.ts";

describe("readLiveCapabilityCoverage (live blend + null rule)", () => {
  function stubDb(gapJson: string | null): Database {
    const d = new Database(":memory:");
    d.run("CREATE TABLE opportunity (id TEXT PRIMARY KEY, capability_gap_json TEXT)");
    d.run("INSERT INTO opportunity (id, capability_gap_json) VALUES (?, ?)", ["opp-1", gapJson]);
    return d;
  }

  const JUDGED = JSON.stringify({
    rows: [
      {
        id: "gap-1",
        capability: "정밀 감속기 설계",
        source: "manual",
        necessity: "essential",
        held: { status: "leading", holders: ["계열사 A"], evidence: "프로필" },
      },
      {
        id: "gap-2",
        capability: "해외 유통망",
        source: "manual",
        necessity: "optional",
        held: { status: "partial", holders: ["계열사 B"], evidence: "프로필" },
      },
    ],
  });

  test("blend math parity with the pre-extraction synergy-rescore.ts expression", () => {
    const d = stubDb(JUDGED);
    // The pre-extraction expression (synergy-rescore.ts:140, unchanged):
    const s = summarizeGap(parseGapRegister(JUDGED).rows);
    const essential = s.essentialCoveragePct;
    const expected =
      essential !== null && s.coveragePct !== null ? Math.round(s.coveragePct * 0.5 + essential * 0.5) : s.coveragePct;
    expect(expected).toBe(88); // 75% 보유율 / 100% 필수 충족율 → round(37.5 + 50)
    const live = readLiveCapabilityCoverage(d, "opp-1");
    expect(live.value).toBe(expected);
    // Note-string parity with the pre-extraction strings (:141).
    expect(live.note).toBe(
      `필요 역량 ${s.total}건 중 판정 ${s.evaluated}건 — 보유율 ${s.coveragePct !== null ? `${s.coveragePct}%` : "—"}, 필수 충족율 ${essential !== null ? `${essential}%` : "—"}`,
    );
    d.close();
  });

  test("empty register → { value: null, note: null } (pipeline producer's null rule)", () => {
    const d = stubDb(null);
    expect(readLiveCapabilityCoverage(d, "opp-1")).toEqual({ value: null, note: null });
    d.close();
  });

  test("all-unjudged register → null value with the 모두 미판정 note", () => {
    const d = stubDb(
      JSON.stringify({
        rows: [
          {
            id: "gap-1",
            capability: "A",
            source: "manual",
            necessity: "essential",
            held: { status: "unevaluated", holders: [], evidence: "" },
          },
        ],
      }),
    );
    const live = readLiveCapabilityCoverage(d, "opp-1");
    expect(live.value).toBeNull();
    expect(live.note).toBe("필요 역량 1건 모두 미판정 — 충족도 팩터 미반영");
    d.close();
  });

  test("unknown opportunity id → { value: null, note: null }", () => {
    const d = stubDb(JUDGED);
    expect(readLiveCapabilityCoverage(d, "no-such-opp")).toEqual({ value: null, note: null });
    d.close();
  });
});
