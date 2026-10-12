/**
 * Spec-driven activity loading (lib/spec-activities.ts): every stage's
 * activities parse from process/flow.spec.yaml at runtime, and the refactored
 * consumers (S8 business-case-generator, S9 dd-checklist-tailor) resolve
 * their per-step/domain agents from the spec — the same values the previous
 * hardcoded tables named (behavior preserved, provenance now the SSOT).
 */

import { describe, test, expect } from "bun:test";
import { loadStageActivities, specAgentFor, specVersion } from "../../app/web-next/lib/spec-activities.ts";
import { businessCaseAgentFor, STEP_TO_SPEC_ACTIVITY, type BusinessCaseStep } from "../../app/web-next/lib/business-case-generator.ts";
import { DD_DOMAIN_AGENTS, DD_DOMAIN_TO_SPEC_ACTIVITY, type DdDomain } from "../../app/web-next/lib/dd-checklist-tailor.ts";

describe("spec-activities loader", () => {
  test("every stage S1..S12 loads with at least one activity", () => {
    const stages = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12"];
    for (const stage of stages) {
      const activities = loadStageActivities(stage);
      expect(activities.length).toBeGreaterThan(0);
      for (const a of activities) {
        expect(a.id.length).toBeGreaterThan(0);
        expect(a.agent.length).toBeGreaterThan(0);
      }
    }
  });

  test("S9 spec activities cover the four v2.7.0 DD domains (ADR-0160 addendum c)", () => {
    expect(specAgentFor("S9", "financial-dd")).toBe("financial-analyst");
    expect(specAgentFor("S9", "hr-dd")).toBe("hr-integration-agent");
    expect(specAgentFor("S9", "market-dd")).toBe("market-intelligence-agent");
    expect(specAgentFor("S9", "financing-dd")).toBe("financing-agent");
  });

  test("unknown stage / activity throws", () => {
    expect(() => loadStageActivities("S13")).toThrow(/Unknown stage/);
    expect(() => specAgentFor("S1", "no-such-activity")).toThrow(/no activity/);
  });

  test("specVersion parses the meta version (semver-ish)", () => {
    expect(specVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("S8 step agents resolve from the spec (previous hardcoded values)", () => {
    const expected: Record<BusinessCaseStep, string> = {
      growth_projection: "financial-analyst",
      valuation_model: "valuation-agent",
      distributional_valuation: "quant-methodologist",
      scenario_risk_assessment: "quant-methodologist",
    };
    for (const step of Object.keys(expected) as BusinessCaseStep[]) {
      expect(specAgentFor("S8", STEP_TO_SPEC_ACTIVITY[step])).toBe(expected[step]);
      expect(businessCaseAgentFor(step)).toBe(expected[step]);
    }
  });

  test("S9 domain agents resolve from the spec (previous hardcoded values)", () => {
    const expected: Partial<Record<DdDomain, string>> = {
      commercial: "commercial-dd-agent",
      technical: "technical-dd-agent",
      legal: "legal-counsel",
    };
    for (const domain of Object.keys(expected) as DdDomain[]) {
      expect(specAgentFor("S9", DD_DOMAIN_TO_SPEC_ACTIVITY[domain])).toBe(expected[domain]!);
      expect(DD_DOMAIN_AGENTS[domain]).toBe(expected[domain]!);
    }
  });
});
