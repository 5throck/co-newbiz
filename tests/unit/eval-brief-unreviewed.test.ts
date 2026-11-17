// TA16 (ADR-0200 §6): the committee brief never presents an AI-filled score as a human one.
import { describe, expect, test } from "bun:test";
import { buildEvalBriefMd } from "../../app/web-next/components/stages/brownfield/evalBrief.ts";

const t = ((key: string, vars?: Record<string, unknown>) =>
  key === "stages.s67.evalBrief.unreviewedSuffix" ? `(AI 미검토 ${vars?.n})` : key) as never;
const checklist = [{ id: "t-01", text: "x", mandatory: true, waiver_eligible: false }] as never;
const target = (id: string, unreviewed?: number) =>
  ({
    id,
    company_name: id,
    status: "pending",
    rank: null,
    screening_json: null,
    eval_summary: { financial: { score: 50 }, technical: { score: 50 }, combined: 57, unreviewed_total: unreviewed },
  }) as never;

describe("TA16 committee brief unreviewed suffix", () => {
  test("adds `(AI 미검토 n)` after the score only when unreviewed_total > 0", () => {
    const md = buildEvalBriefMd([target("가", 3), target("나", 0), target("다")], checklist, undefined, t) as string;
    const rows = md.split("\n").filter((l) => l.startsWith("| 가 ") || l.startsWith("| 나 ") || l.startsWith("| 다 "));
    expect(rows[0]).toContain("57 (AI 미검토 3) |");
    expect(rows[1]).not.toContain("미검토");
    expect(rows[2]).not.toContain("미검토");
  });
});
