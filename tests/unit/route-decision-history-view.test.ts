import { describe, expect, test } from "bun:test";
import { buildDecisionDetail, formatDecidedAtFull, NO_ALTERNATIVES_LABEL } from "../../app/web-next/lib/route-decision-history-view.ts";

const base = { rationale: "line1\nline2", alternatives_considered: null, decided_by: "u", decided_at: "2026-10-13T09:03:17.853Z", staging_recommended: null, total_score: 2.1 };

describe("route decision history detail", () => {
  test("keeps full multi-line text untruncated", () => {
    const long = "가".repeat(900);
    const d = buildDecisionDetail({ ...base, rationale: long + "\n끝" });
    expect(d.rationale).toBe(long + "\n끝");
  });
  test("empty or blank alternatives show an explicit label", () => {
    for (const v of [null, "", "   \n"]) {
      const d = buildDecisionDetail({ ...base, alternatives_considered: v });
      expect(d.alternatives).toBe(NO_ALTERNATIVES_LABEL);
      expect(d.alternativesRecorded).toBe(false);
    }
    const ok = buildDecisionDetail({ ...base, alternatives_considered: "A안" });
    expect(ok.alternatives).toBe("A안");
    expect(ok.alternativesRecorded).toBe(true);
  });
  test("maps scores and staging", () => {
    const d = buildDecisionDetail({ ...base, staging_recommended: " step-up ", scores: [{ criterion: "c", score: 2, evidence_note: "n" }] });
    expect(d.scores).toEqual([{ criterion: "c", score: 2, evidenceNote: "n" }]);
    expect(d.staging).toBe("step-up");
    expect(buildDecisionDetail({ ...base, scores: null }).scores).toEqual([]);
  });
  test("formats the full timestamp", () => {
    expect(formatDecidedAtFull("2026-10-13T09:03:17.853Z")).toBe("2026-10-13 09:03:17 UTC");
    expect(formatDecidedAtFull("2026-10-13 09:03")).toBe("2026-10-13 09:03");
    expect(formatDecidedAtFull("")).toBe("-");
  });
});
