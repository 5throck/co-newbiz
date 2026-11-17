// S7 deal-shape AI recommendation (ADR-0118, boundary #2; ADR-0201 §7): the server clamps LLM output into
// {overall, shapes} (overall verdict first, shapes only when viable) and the panel only fills the form. Pure parse tests.
import { describe, expect, test } from "bun:test";

const WEB = `${import.meta.dir}/../../app/web-next`;
const { parseDealShapeRecommendation, DEAL_SHAPE_RECOMMEND_PROMPT_VERSION } = await import(
  `${WEB}/app/api/opportunities/[id]/deal-shapes/recommend/route.ts`
);
const { readFileSync } = await import("node:fs");

const viable = (shapes: unknown, over: Record<string, unknown> = {}) => ({
  overall: { viable: true, intent: "integration", rationale: " 전체 근거 ", ...over },
  shapes,
});

describe("parseDealShapeRecommendation", () => {
  test("rule 1: a missing overall or a blank overall rationale is null (parse_failed)", () => {
    expect(parseDealShapeRecommendation(null)).toBeNull();
    expect(parseDealShapeRecommendation({})).toBeNull();
    expect(parseDealShapeRecommendation({ shapes: [] })).toBeNull();
    expect(parseDealShapeRecommendation({ overall: "x" })).toBeNull();
    expect(parseDealShapeRecommendation({ overall: { viable: true, rationale: "  " }, shapes: [] })).toBeNull();
    expect(parseDealShapeRecommendation({ recommendations: [{ shape: "spv" }] })).toBeNull(); // the @1 contract is gone
  });
  test("rule 2: a non-boolean overall.viable becomes null", () => {
    const out = parseDealShapeRecommendation({ overall: { viable: "maybe", rationale: "데이터 부족" }, shapes: [] });
    expect(out).toEqual({ overall_viable: null, intent: "", rationale: "데이터 부족", shapes: [] });
  });
  test("rule 3: not viable or undecided forces shapes to [] and the intent to empty", () => {
    const shapes = [{ shape: "spv", rationale: "x" }];
    expect(
      parseDealShapeRecommendation({ overall: { viable: false, intent: "integration", rationale: "막힘" }, shapes }),
    ).toEqual({ overall_viable: false, intent: "", rationale: "막힘", shapes: [] });
    expect(
      parseDealShapeRecommendation({ overall: { viable: null, intent: "integration", rationale: "부족" }, shapes }),
    ).toEqual({ overall_viable: null, intent: "", rationale: "부족", shapes: [] });
  });
  test("rule 4: viable keeps valid shapes, drops unknown, duplicate and rationale-less ones", () => {
    const out = parseDealShapeRecommendation(
      viable([
        { shape: "spv", rationale: " 이유 " },
        { shape: "spv", rationale: "dup" },
        { shape: "made_up", rationale: "x" },
        { shape: "license_in", rationale: "" },
        { shape: "joint_venture", rationale: "합작" },
        "garbage",
      ]),
    );
    expect(out).toEqual({
      overall_viable: true,
      intent: "integration",
      rationale: "전체 근거",
      shapes: [
        { shape: "spv", rationale: "이유" },
        { shape: "joint_venture", rationale: "합작" },
      ],
    });
  });
  test("rule 4: an invalid intent becomes empty so the person chooses one", () => {
    const out = parseDealShapeRecommendation(viable([{ shape: "spv", rationale: "r" }], { intent: "nonsense" }));
    expect(out).toMatchObject({ overall_viable: true, intent: "" });
  });
  test("rule 5: viable with no valid shape becomes undecided and keeps the rationale", () => {
    expect(parseDealShapeRecommendation(viable([{ shape: "made_up", rationale: "x" }]))).toEqual({
      overall_viable: null,
      intent: "",
      rationale: "전체 근거",
      shapes: [],
    });
    expect(parseDealShapeRecommendation(viable("nope"))).toMatchObject({ overall_viable: null, shapes: [] });
  });
  test("rule 6: rationales are trimmed to 500 characters", () => {
    const out = parseDealShapeRecommendation(
      viable([{ shape: "spv", rationale: `${"가".repeat(600)}` }], { rationale: "나".repeat(700) }),
    );
    expect(out.rationale.length).toBe(500);
    expect(out.shapes[0].rationale.length).toBe(500);
  });
});

describe("route and panel contract (source pins)", () => {
  const src = (rel: string) => readFileSync(`${WEB}/${rel}`, "utf8");
  const route = src("app/api/opportunities/[id]/deal-shapes/recommend/route.ts");
  test("prompt version is @2 and the route never writes a verdict row", () => {
    expect(DEAL_SHAPE_RECOMMEND_PROMPT_VERSION).toBe("s7.deal_shape_recommend@2");
    expect(route).not.toContain("recordViableShapes");
    expect(route).not.toContain("recordOverallNotViable");
    expect(route).not.toMatch(/INSERT INTO opportunity_deal_shape_evaluation/);
  });
  test("no shortlist makes no LLM call and answers recommendation null", () => {
    const at = route.indexOf("shortlist.length === 0");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(route.indexOf("completeOrFallback("));
    expect(route.slice(at, route.indexOf("completeOrFallback(")).replace(/\s+/g, " ")).toContain(
      'note: "no_shortlist"',
    );
    expect(route).toContain("recommendation: null");
  });
  test("the recorded-verdict lines include the overall row", () => {
    expect(route).toContain("const { live, overall } = listDealShapeEvaluations");
  });
  test("the registry prompt is overall-first and no longer asks per shape", () => {
    const registry = src("lib/prompts.generated.ts");
    expect(registry).toContain("Decide overall viability first");
    expect(registry).not.toContain("For each deal shape listed in the input");
  });
  test("the card only fills the form; the stale 409 reloads and keeps the form", () => {
    const card = src("components/stages/DealShapeRecommendCard.tsx");
    expect(card).not.toContain("api.post");
    const panel = src("components/stages/DealShapePanel.tsx");
    expect(panel).toContain("formFromRecommendation(r)");
    expect(panel).toContain('=== "stale"');
    expect(panel).toMatch(/stale"\) await load\(\)/);
  });
});
