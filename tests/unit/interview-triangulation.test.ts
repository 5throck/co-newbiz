// interview-triangulation (2026-10-21 S9 depth) — cdd-07 "주장당 독립 출처 2~3개"
// summary over dd_interview rows: independence = distinct interviewee; claims
// are matched case/space-insensitively; unclaimed interviews count nowhere.
import { describe, expect, test } from "bun:test";
import { MIN_INDEPENDENT_SOURCES, summarizeTriangulation } from "../../app/web-next/lib/interview-triangulation.ts";

describe("summarizeTriangulation", () => {
  test("two distinct interviewees on the same claim triangulate; one interviewee twice does not", () => {
    const s = summarizeTriangulation([
      { claim: "상위 고객 이탈 위험 낮음", interviewee: "A 전문가", evidence_ref: "log#1" },
      { claim: "상위 고객 이탈 위험  낮음", interviewee: "b 채널", evidence_ref: "log#2" },
      { claim: "가격 결정력 유지", interviewee: "A 전문가", evidence_ref: "log#3" },
      { claim: "가격 결정력 유지", interviewee: "a 전문가", evidence_ref: "log#4" },
    ]);
    expect(MIN_INDEPENDENT_SOURCES).toBe(2);
    expect(s.claims).toHaveLength(2);
    const [pending, done] = s.claims; // pending first, then alphabetical
    expect(pending).toMatchObject({ claim: "가격 결정력 유지", interview_count: 2, independent_sources: 1, triangulated: false });
    expect(done).toMatchObject({ claim: "상위 고객 이탈 위험 낮음", interview_count: 2, independent_sources: 2, triangulated: true });
    expect(done.evidence_refs).toEqual(["log#1", "log#2"]);
    expect(s.triangulated_count).toBe(1);
    expect(s.pending_count).toBe(1);
  });

  test("interviews without a claim are counted as unclaimed and never triangulate anything", () => {
    const s = summarizeTriangulation([
      { claim: null, interviewee: "A", evidence_ref: "x" },
      { claim: "  ", interviewee: "B", evidence_ref: "y" },
    ]);
    expect(s.claims).toEqual([]);
    expect(s.unclaimed).toBe(2);
  });
});
