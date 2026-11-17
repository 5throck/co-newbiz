// Candidate discovery reads the S6 direction (design 2026-11-17-s6-universe-direction-review): prioritised types steer the
// queries and the prompts, excluded directions are told as "do not propose"; a record without a direction changes nothing.
import { describe, expect, test } from "bun:test";

const WEB = `${import.meta.dir}/../../app/web-next`;
const { directionHints, directionPromptLines, directionQueries } = await import(
  `${WEB}/lib/universe-direction-discovery.ts`
);
const route = await import(`${WEB}/app/api/brownfield/[oppId]/target-proposals/web-search/route.ts`);

const direction = {
  value_chain: { text: "midstream suppliers", refs: [], unverified: false },
  prioritise: [
    { type: "valve makers", why: "certified", refs: [], unverified: false },
    { type: "forging shops", why: "", refs: [], unverified: false },
    { type: "third", why: "", refs: [], unverified: false },
  ],
  exclude: [{ type: "trading companies", why: "no manufacturing", refs: [], unverified: false }],
};
const opp = { name: "Plant parts", market_scope: "nuclear" };

describe("directionHints", () => {
  test("keeps non-empty lines, caps at three, and is empty without a direction", () => {
    const h = directionHints({ direction });
    expect(h.priorities.map((p: { type: string }) => p.type)).toEqual(["valve makers", "forging shops", "third"]);
    expect(h.excludes.length).toBe(1);
    expect(directionHints({})).toEqual({ priorities: [], excludes: [], valueChain: "" });
    expect(directionHints({ direction: { prioritise: [{ type: "  " }] } as never }).priorities).toEqual([]);
  });
});

describe("queries and prompts", () => {
  test("the first two prioritised types become queries right after the anchor query", () => {
    const q = route.buildQueries(opp, { direction }, []);
    expect(q[1]).toContain("valve makers");
    expect(q[2]).toContain("forging shops");
    expect(q.length).toBeLessThanOrEqual(5);
    expect(directionQueries("x", directionHints({ direction })).length).toBe(2);
  });
  test("without a direction the queries and prompt lines are unchanged", () => {
    expect(route.buildQueries(opp, {}, [])).toEqual(route.buildQueries(opp, { direction: null }, []));
    expect(directionPromptLines(directionHints({}))).toEqual([]);
  });
  test("both prompts carry the priorities, the excludes and the usage rule", () => {
    const k = route.buildKnowledgePrompt(opp, { direction }, [], []);
    const w = route.buildPrompt(opp, { direction }, [], [], []);
    for (const p of [k, w]) {
      expect(p).toContain("valve makers (certified)");
      expect(p).toContain("trading companies (no manufacturing)");
      expect(p).toContain("midstream suppliers");
    }
  });
});
