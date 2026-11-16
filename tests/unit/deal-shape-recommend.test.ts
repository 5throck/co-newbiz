// S7 deal-shape AI recommendation (ADR-0118, boundary #2): the server clamps LLM output and the panel renders proposals that
// only fill the form. Pure parse tests + render of the proposal list.
import { describe, expect, test } from "bun:test";

const WEB = `${import.meta.dir}/../../app/web-next`;
const { parseShapeRecommendations } = await import(`${WEB}/app/api/opportunities/[id]/deal-shapes/recommend/route.ts`);

describe("parseShapeRecommendations", () => {
  test("keeps valid entries, drops unknown shapes, duplicates and entries without a rationale", () => {
    const out = parseShapeRecommendations({
      recommendations: [
        { shape: "spv", viable: true, intent: "integration", rationale: " 이유 " },
        { shape: "spv", viable: false, intent: "integration", rationale: "dup" },
        { shape: "made_up", viable: true, intent: "integration", rationale: "x" },
        { shape: "license_in", viable: false, intent: "capability_access", rationale: "" },
      ],
    });
    expect(out).toEqual([{ shape: "spv", viable: true, intent: "integration", rationale: "이유" }]);
  });
  test("a non-boolean verdict becomes null and clears the intent; an unknown intent is emptied", () => {
    const out = parseShapeRecommendations({
      recommendations: [
        { shape: "joint_venture", viable: "maybe", intent: "integration", rationale: "데이터 부족" },
        { shape: "minority_stake", viable: true, intent: "nonsense", rationale: "근거" },
      ],
    });
    expect(out[0]).toMatchObject({ viable: null, intent: "" });
    expect(out[1]).toMatchObject({ viable: true, intent: "" });
  });
  test("garbage input yields no recommendations", () => {
    expect(parseShapeRecommendations(null)).toEqual([]);
    expect(parseShapeRecommendations({ recommendations: "x" })).toEqual([]);
  });
});
