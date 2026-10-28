import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { PROMPTS } from "../../app/web-next/lib/prompts.generated.ts";

// ADR-0185 W3 — prompt key renames, activity mappings, red-team independence rebinds.
// `activity` lives in the prompts.json SSOT (the PM catalog generator joins it); PROMPTS carries the rest.
const SSOT = JSON.parse(readFileSync("app/web-next/prompts/prompts.json", "utf8")).prompts as { key: string; activity?: string }[];
const activityOf = (k: string) => SSOT.find((e) => e.key === k)?.activity ?? null;
const P = PROMPTS as Record<string, { agent: string | null; system: string } | undefined>;

describe("ADR-0185 W3 prompt placement", () => {
  test("renamed keys exist; old stage-prefixed keys are gone", () => {
    for (const k of ["s2.opportunity_factors", "s3.synergy_fa", "s3.synergy_synergy", "s3.synergy_ic", "s10.deal_structure_recommendation", "s12.monitoring_brief"]) {
      expect(P[k]).toBeDefined();
    }
    for (const k of ["s3.opportunity_factors", "s4.synergy_fa", "s4.synergy_synergy", "s4.synergy_ic", "s8.deal_structure_recommendation", "s11.monitoring_brief"]) {
      expect(P[k]).toBeUndefined();
    }
  });

  test("red-team independence rebinds", () => {
    expect(P["s3.synergy_fa"]!.agent).toBe("financial-analyst");
    // ADR-0187 D5: track-lead owned capability-register activities (greenfield-agent default, brownfield-agent once the route is brownfield).
    expect(P["s3.capability_gap_draft"]!.agent).toBe("greenfield-agent");
    // ADR-0187 D6: the synergy author is financial-analyst; risk-officer red-teams only.
    expect(P["s3.synergy_synergy"]!.agent).toBe("financial-analyst");
    expect(P["s3.synergy_ic"]!.agent).toBe("risk-officer");
    expect(activityOf("s3.synergy_synergy")).toBe("S3.synergy-analysis");
    expect(activityOf("s3.synergy_ic")).toBe("S3.synergy-red-team");
  });

  test("activity mappings", () => {
    const expected: Record<string, string> = {
      "s3.capability_gap_draft": "S3.capability-register-greenfield",
      "s3.attractiveness_recommendation": "S3.strategic-fit-screening",
      "s8.business_case_prose": "S8.business-case-modeling",
      "s8.business_case_adoption": "S8.valuation",
      "company_profile.competitor_web_search": "S3.our-company-profile",
      "s12.milestone_suggest": "S12.portfolio-monitoring",
    };
    for (const [k, a] of Object.entries(expected)) expect(activityOf(k)).toBe(a);
    expect(activityOf("s10.site_regulatory_draft")).toBeNull(); // D-6: stays unmapped
    expect(P["s8.business_case_prose"]!.agent).toBeNull();
  });

  test("s12.milestone_suggest no longer defines the tracks in its system instruction", () => {
    expect(P["s12.milestone_suggest"]!.system).not.toMatch(/greenfield is|brownfield is/);
  });
});
