/**
 * Pure grouping rule for /api/portfolio/overlap (design
 * 2026-10-11-portfolio-view-overlap §3) — no DB, direct lib import.
 */

import { describe, test, expect } from "bun:test";
import {
  buildPortfolioOverlap,
  type OverlapInput,
  type OverlapOpportunityInput,
  type OverlapProjectInput,
} from "../../app/web-next/lib/portfolio-overlap.ts";

const INDUSTRIES = new Map(
  [
    { id: "ind-marine", name_ko: "조선", name_en: "Shipbuilding", ksic_code: "30111" },
    { id: "ind-crank", name_ko: "크랭크샤프트", name_en: "Crankshaft", ksic_code: null },
  ].map((i) => [i.id, i]),
);

function opp(over: Partial<OverlapOpportunityInput> & { id: string }): OverlapOpportunityInput {
  return {
    name: `opp-${over.id}`,
    market_scope: null,
    industry_id: null,
    status: "assessed",
    project_id: null,
    deleted_at: null,
    ...over,
  };
}

function proj(over: Partial<OverlapProjectInput> & { id: string }): OverlapProjectInput {
  return {
    project_no: `PRJ-${over.id}`,
    name: `prj-${over.id}`,
    track: "greenfield",
    industry_ids: [],
    ...over,
  };
}

function run(opportunities: OverlapOpportunityInput[], projects: OverlapProjectInput[]) {
  const input: OverlapInput = { opportunities, projects, industries: INDUSTRIES };
  return buildPortfolioOverlap(input);
}

describe("portfolio overlap grouping", () => {
  test("exact tier groups an opportunity and a project sharing an industry_id", () => {
    const r = run(
      [opp({ id: "o1", industry_id: "ind-marine" })],
      [proj({ id: "p1", industry_ids: ["ind-marine"] })],
    );
    expect(r.counts.exact_groups).toBe(1);
    expect(r.counts.name_prefix_groups).toBe(0);
    const g = r.groups[0];
    expect(g.tier).toBe("exact");
    expect(g.industry).toEqual({ id: "ind-marine", name_ko: "조선", name_en: "Shipbuilding", ksic_code: "30111" });
    expect(g.key_label).toBeUndefined();
    expect(g.members.map((m) => m.kind)).toEqual(["opportunity", "project"]);
    expect(g.members[0]).toMatchObject({
      href: "/opportunities?opportunity=o1",
      status: "assessed",
      industry_pinned: true,
    });
    expect(g.members[1]).toMatchObject({
      href: "/projects/p1/process",
      project_no: "PRJ-p1",
      track: "greenfield",
      industry_pinned: true,
    });
  });

  test("ksic_code null stays null and never becomes a grouping key", () => {
    const r = run(
      [opp({ id: "o1", industry_id: "ind-crank" }), opp({ id: "o2", industry_id: "ind-crank" })],
      [],
    );
    expect(r.groups[0].industry?.ksic_code).toBeNull();
    expect(r.counts.exact_groups).toBe(1);
  });

  test("fallback separation: identical market_scope with NULL industry lands in name_prefix, never merged into exact", () => {
    const r = run(
      [
        opp({ id: "o1", industry_id: "ind-marine", market_scope: "조선" }),
        opp({ id: "o2", market_scope: "조선" }),
        opp({ id: "o3", market_scope: "조선" }),
      ],
      // A project bound to ind-marine makes the exact tier a real 2-member
      // group — proving the fallback tier is never merged into it.
      [proj({ id: "p1", industry_ids: ["ind-marine"] })],
    );
    expect(r.counts.exact_groups).toBe(1);
    expect(r.counts.name_prefix_groups).toBe(1);
    const prefix = r.groups.find((g) => g.tier === "name_prefix");
    expect(prefix?.industry).toBeNull();
    expect(prefix?.key_label).toBe("조선");
    expect(prefix?.members.map((m) => m.id)).toEqual(["o2", "o3"]);
    expect(prefix?.members.every((m) => m.industry_pinned === false)).toBe(true);
    // The exact group contains only the FK-keyed members — no scope-text
    // coincidence leaks in.
    expect(r.groups.find((g) => g.tier === "exact")?.members.map((m) => m.id)).toEqual(["o1", "p1"]);
  });

  test("case- and whitespace-insensitive prefix match", () => {
    const r = run(
      [opp({ id: "o1", market_scope: "  Smart Farming " }), opp({ id: "o2", market_scope: "smart   farming" })],
      [],
    );
    expect(r.counts.name_prefix_groups).toBe(1);
    expect(r.groups[0].key_label).toBe("smart farming");
  });

  test("promotion dedup: opportunity with project_id counts on the project side only", () => {
    const r = run(
      [opp({ id: "o1", industry_id: "ind-marine", project_id: "p1" })],
      [proj({ id: "p1", industry_ids: ["ind-marine"] })],
    );
    expect(r.groups).toHaveLength(0); // single project member is not a group
    expect(r.counts.active_opportunities).toBe(0);
    expect(r.counts.projects).toBe(1);
  });

  test("promotion dedup keeps the promoted case reachable once via its project's bindings", () => {
    const r = run(
      [
        opp({ id: "o1", industry_id: "ind-marine", project_id: "p1" }),
        opp({ id: "o2", industry_id: "ind-marine" }),
      ],
      [proj({ id: "p1", industry_ids: ["ind-marine"] })],
    );
    expect(r.counts.exact_groups).toBe(1);
    const members = r.groups[0].members;
    expect(members).toHaveLength(2);
    expect(members.filter((m) => m.id === "o1")).toHaveLength(0); // not double-counted
    expect(members.map((m) => m.kind)).toEqual(["opportunity", "project"]);
  });

  test("na bucket: NULL-industry opportunity with non-matching scope, project with no live binding", () => {
    const r = run(
      [opp({ id: "o1", market_scope: "전혀 다른 시장" }), opp({ id: "o2", market_scope: "   " })],
      [proj({ id: "p1" })],
    );
    expect(r.groups).toHaveLength(0);
    expect(r.na.opportunities_without_industry).toEqual([
      { id: "o1", name: "opp-o1", reason: "no_pinned_industry" },
      { id: "o2", name: "opp-o2", reason: "no_pinned_industry" },
    ]);
    expect(r.na.projects_without_industry).toEqual([{ id: "p1", project_no: "PRJ-p1", reason: "no_live_binding" }]);
    expect(r.counts).toEqual({
      active_opportunities: 2,
      projects: 1,
      exact_groups: 0,
      name_prefix_groups: 0,
      na_opportunities: 2,
      na_projects: 1,
      na_total: 3,
      hidden_promoted_opportunities: 0,
    });
  });

  test("dropped and deleted opportunities excluded; single-member keys surface neither as group nor na", () => {
    const r = run(
      [
        opp({ id: "o1", industry_id: "ind-marine", status: "dropped" }),
        opp({ id: "o2", industry_id: "ind-marine", deleted_at: "2026-10-01T00:00:00Z" }),
        opp({ id: "o3", industry_id: "ind-crank" }), // alone in its industry
      ],
      [],
    );
    expect(r.groups).toHaveLength(0);
    expect(r.na.opportunities_without_industry).toHaveLength(0);
    expect(r.counts.active_opportunities).toBe(1);
  });

  test("superseded bindings never reach the rule — caller passes live rows only (contract check)", () => {
    // The route filters superseded_by IS NULL; the rule itself just consumes
    // the given industry_ids, so a stale history row must never arrive. This
    // test pins the rule's input contract: a project with a live binding and
    // nothing else produces no phantom industries.
    const r = run([], [proj({ id: "p1", industry_ids: ["ind-marine", "ind-crank"] })]);
    expect(r.counts.projects).toBe(1);
    expect(r.groups).toHaveLength(0);
  });

  test("empty input yields empty groups and zero counts", () => {
    const r = run([], []);
    expect(r.groups).toEqual([]);
    expect(r.na.opportunities_without_industry).toEqual([]);
    expect(r.na.projects_without_industry).toEqual([]);
    expect(r.counts).toEqual({
      active_opportunities: 0,
      projects: 0,
      exact_groups: 0,
      name_prefix_groups: 0,
      na_opportunities: 0,
      na_projects: 0,
      na_total: 0,
      hidden_promoted_opportunities: 0,
    });
  });

  test("exact tier sorts before name_prefix tier", () => {
    const r = run(
      [
        opp({ id: "o1", industry_id: "ind-marine" }),
        opp({ id: "o2", industry_id: "ind-marine" }),
        opp({ id: "o3", market_scope: "공통 스코프" }),
        opp({ id: "o4", market_scope: "공통 스코프" }),
      ],
      [],
    );
    expect(r.groups.map((g) => g.tier)).toEqual(["exact", "name_prefix"]);
  });
});

describe("hidden promoted + unresolved industry", () => {
  const base = { opportunities: [], projects: [], industries: INDUSTRIES } as OverlapInput;

  test("hidden count surfaces in counts and na, defaults to 0, keeps grouping unchanged", () => {
    const withHidden = buildPortfolioOverlap({ ...base, hiddenPromotedOpportunities: 3 });
    expect(withHidden.counts.hidden_promoted_opportunities).toBe(3);
    expect(withHidden.na.hidden_promoted).toEqual({ count: 3 });
    expect(buildPortfolioOverlap(base).counts.hidden_promoted_opportunities).toBe(0);
    const input: OverlapInput = {
      ...base,
      opportunities: [opp({ id: "a", industry_id: "ind-marine" })],
      projects: [proj({ id: "p", industry_ids: ["ind-marine"] })],
    };
    const a = buildPortfolioOverlap(input);
    const b = buildPortfolioOverlap({ ...input, hiddenPromotedOpportunities: 5 });
    expect(b.groups).toEqual(a.groups);
    expect(b.counts.na_total).toBe(a.counts.na_total);
  });

  test("na_total sums na opportunities and projects", () => {
    const r = buildPortfolioOverlap({
      ...base,
      opportunities: [opp({ id: "x" })],
      projects: [proj({ id: "p" })],
    });
    expect(r.counts.na_total).toBe(2);
  });

  test("unknown industry id degrades to na instead of throwing", () => {
    const r = buildPortfolioOverlap({
      ...base,
      opportunities: [opp({ id: "o1", industry_id: "ind-missing" })],
      projects: [proj({ id: "p1", industry_ids: ["ind-missing"] })],
    });
    expect(r.groups).toEqual([]);
    expect(r.na.opportunities_without_industry[0].reason).toBe("industry_unresolved");
    expect(r.na.projects_without_industry[0].reason).toBe("industry_unresolved");
  });
});
