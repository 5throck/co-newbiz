/**
 * Committee registry validation (procedures/_validate.ts committee pass) —
 * moved verbatim from committee-boundary.test.ts (2026-09-18) so the
 * deliberation-boundary tests are not blocked by these environment-dependent
 * checks: the validator resolves agents/<key>.md on disk, and checkouts that
 * track only part of the 41-agent roster (4 files) cannot satisfy it. These
 * are not CI unit-suite targets (CI runs the integration suite).
 */

import { test, expect, describe } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");

// The real-registry validation resolves agents/<key>.md on disk. This repo
// tracks only part of the 41-agent roster, so in partial checkouts the
// real-registry tests cannot pass — skip them with an explicit note instead
// of failing (the synthetic-registry validator tests below always run).
const REAL_REGISTRY_SKIPPED = !existsSync(join(PROJECT_ROOT, "agents", "ip-agent.md"));
const testReal = REAL_REGISTRY_SKIPPED ? test.skip : test;

const { validateCommitteeRegistry } = await import("../../procedures/_validate.ts");
const yaml = await import("js-yaml");
const { readFileSync } = await import("node:fs");

// ── Registry validation (procedures/_validate.ts committee pass) ────────────

describe("_committees.yaml validation", () => {
  testReal("the shipped registry passes with all four committees", () => {
    const doc = yaml.load(readFileSync(join(PROJECT_ROOT, "procedures/_committees.yaml"), "utf-8"), {
      schema: yaml.JSON_SCHEMA,
    });
    const result = validateCommitteeRegistry(doc, new Set<string>());
    // ADR-0196 Phase E: the two IC committees join the two deliberation ones.
    expect(result.committeeCount).toBe(4);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  test("a committee without the risk-officer seat is an ERROR", () => {
    const result = validateCommitteeRegistry(
      {
        committees: {
          "broken-committee": {
            applies_to: "route_decision",
            chair: "process-governance-manager",
            rounds: 2,
            decision_modes_allowed: ["agent_team"],
            members: [{ type: "agent", key: "industry-lead" }],
          },
        },
      },
      new Set<string>(),
    );
    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => e.message.includes("risk-officer"))).toBe(true);
  });

  testReal("risk-officer without veto_dissent is an ERROR", () => {
    const result = validateCommitteeRegistry(
      {
        committees: {
          "no-veto-committee": {
            applies_to: "route_decision",
            chair: "process-governance-manager",
            rounds: 2,
            decision_modes_allowed: ["agent_team"],
            members: [{ type: "agent", key: "risk-officer" }],
          },
        },
      },
      new Set<string>(),
    );
    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => e.message.includes("veto_dissent"))).toBe(true);
  });

  test("decision mode outside the closed enum is an ERROR", () => {
    const result = validateCommitteeRegistry(
      {
        committees: {
          "bad-mode-committee": {
            applies_to: "route_decision",
            chair: "process-governance-manager",
            rounds: 2,
            decision_modes_allowed: ["autonomous"],
            members: [{ type: "agent", key: "risk-officer", veto_dissent: true }],
          },
        },
      },
      new Set<string>(),
    );
    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => e.message.includes("closed enum"))).toBe(true);
  });
});

// ── Standing functional-expert seats (ADR-0097 Amendment 2026-09-04) ────────

describe("_committees.yaml functional-expert composition", () => {
  const FUNCTIONAL_SEATS = [
    "financing-agent",
    "site-facility-agent",
    "legal-counsel",
    "hr-integration-agent",
    "ir-agent",
    "ip-agent",
  ];

  function loadCommittees(): Record<string, { members: Array<{ type: string; key: string; veto_dissent?: boolean }> }> {
    return (
      yaml.load(readFileSync(join(PROJECT_ROOT, "procedures/_committees.yaml"), "utf-8"), {
        schema: yaml.JSON_SCHEMA,
      }) as {
        committees: Record<string, { members: Array<{ type: string; key: string; veto_dissent?: boolean }> }>;
      }
    ).committees;
  }

  test("both committees list the six standing functional seats over their core 5/4 skeleton", () => {
    const committees = loadCommittees();
    // route-steering: 5 core seats + 6 functional + risk-officer = 12
    // (the two conditional track seats both appear in the registry).
    // target-longlist: brownfield-only, so 4 core seats + 6 functional +
    // risk-officer = 11.
    const expected = {
      "route-steering-committee": 12,
      "target-longlist-shortlist-committee": 11,
    } as Record<string, number>;
    for (const [key, count] of Object.entries(expected)) {
      const members = committees[key].members;
      expect(members).toHaveLength(count);
      const keys = members.map((m) => m.key);
      for (const seat of FUNCTIONAL_SEATS) {
        expect(keys).toContain(seat);
        expect(members.find((m) => m.key === seat)?.type).toBe("agent");
      }
    }
  });

  test("risk-officer is still the ONLY member carrying veto_dissent", () => {
    const committees = loadCommittees();
    for (const committee of Object.values(committees)) {
      const withVeto = committee.members.filter((m) => m.veto_dissent === true);
      expect(withVeto.map((m) => m.key)).toEqual(["risk-officer"]);
    }
  });

  testReal("the validator passes with the expanded membership (agent files exist)", () => {
    const doc = yaml.load(readFileSync(join(PROJECT_ROOT, "procedures/_committees.yaml"), "utf-8"), {
      schema: yaml.JSON_SCHEMA,
    });
    const result = validateCommitteeRegistry(doc, new Set<string>());
    // ADR-0196 Phase E: four committees (two deliberation + two IC).
    expect(result.committeeCount).toBe(4);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  test("the deterministic executor has a template for every member key (no default fallthrough)", async () => {
    // Owner decision 10: the deterministic emitter is injection-only now —
    // getCommitteeCallAgent() would throw llm_required without a provider.
    const { deterministicCallAgent } = await import("../../app/web-next/lib/committee-agents.ts");
    const callAgent = deterministicCallAgent();
    const committees = loadCommittees();
    const keys = new Set<string>();
    for (const committee of Object.values(committees)) {
      for (const m of committee.members) if (m.type === "agent") keys.add(m.key);
    }
    for (const key of keys) {
      const out = await callAgent(key, `${key} 심의 안건`);
      // No crash and a real position; the default template (member: hold,
      // confidence 60) is the ad-hoc fallback — a committee member without a
      // dedicated role template would be a silent missing voice.
      expect(out.recommendation).not.toBeUndefined();
      expect(out.positionMd).toContain(key);
      if (key === "risk-officer") {
        expect(out.vetoDissent).toBe(true);
      } else {
        expect(out.vetoDissent).not.toBe(true);
        expect(out.confidence).not.toBe(60); // not the ad-hoc default template
      }
    }
  });
});
