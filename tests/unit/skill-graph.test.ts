// @version 1.0.0
/**
 * Unit + integration tests for the PR-8 skill-graph hardening passes —
 * design of record docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md
 * plan row PR-8, ADR-0053.
 *
 * Two layers:
 *   1. PURE: checkSkillMetadata / parseSkillFrontmatter against fixture
 *      frontmatter — one test per error class (unknown procedure key,
 *      unknown requires/related skill, malformed list shape, backtick
 *      scalar, happy path), no filesystem.
 *   2. INTEGRATION against the real repo trees: buildGraphMap() over the
 *      live procedures/ + skills/ — the gates the audit relies on:
 *        - 0 errors, 0 missing agents, 0 missing skills
 *        - missing.agents regression-pinned EMPTY (the entity-ic-reviewer
 *          finding stayed resolved via the registry, not by adding an agent)
 *        - exactly 2 human-authority steps, and they are the two IC
 *          decision steps (entity-ic-review 5, group-investment-review 5)
 *        - every graph-referenced skill's metadata.procedure_keys covers
 *          every procedure edge pointing at it (the bidirectional contract)
 *        - the human-role registry loads non-empty (fail-closed sanity)
 */

import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import {
  buildGraphMap,
  checkSkillMetadata,
  parseSkillFrontmatter,
  loadHumanRoles,
} from "../../scripts/co-newbiz/graph-map.ts";

const PROJECT_ROOT = join(import.meta.dirname, "../..");

// ── Layer 1: pure fixtures ──────────────────────────────────────────────────

describe("checkSkillMetadata (pure)", () => {
  const knownProcedures = new Set(["brownfield-dd", "entity-ic-review"]);
  const knownSkills = new Set(["quality-of-earnings", "technical-due-diligence"]);

  test("happy path: all four fields valid ⇒ no errors", () => {
    const errors = checkSkillMetadata(
      "some-skill",
      {
        procedure_keys: ["brownfield-dd"],
        requires_skills: ["quality-of-earnings"],
        related_skills: ["technical-due-diligence"],
        requires_tools: ["DART OpenAPI"],
      },
      knownProcedures,
      knownSkills
    );
    expect(errors).toEqual([]);
  });

  test("absent fields ⇒ no errors (all four are optional)", () => {
    expect(checkSkillMetadata("some-skill", {}, knownProcedures, knownSkills)).toEqual([]);
  });

  test("unknown procedure_keys entry ⇒ error naming the key", () => {
    const errors = checkSkillMetadata(
      "some-skill",
      { procedure_keys: ["brownfield-dd", "no-such-procedure"] },
      knownProcedures,
      knownSkills
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("procedure_keys entry 'no-such-procedure'");
    expect(errors[0]).toContain("not a shared procedure directory");
  });

  test("unknown requires_skills entry ⇒ error", () => {
    const errors = checkSkillMetadata(
      "some-skill",
      { requires_skills: ["ghost-skill"] },
      knownProcedures,
      knownSkills
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("metadata.requires_skills entry 'ghost-skill'");
  });

  test("unknown related_skills entry ⇒ error", () => {
    const errors = checkSkillMetadata(
      "some-skill",
      { related_skills: ["ghost-skill"] },
      knownProcedures,
      knownSkills
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("metadata.related_skills entry 'ghost-skill'");
  });

  test("malformed field (not a list) ⇒ one shape error, treated as empty", () => {
    const errors = checkSkillMetadata(
      "some-skill",
      { procedure_keys: "brownfield-dd" },
      knownProcedures,
      knownSkills
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("must be a list of non-empty strings");
  });

  test("empty-string entry in requires_tools ⇒ shape error", () => {
    const errors = checkSkillMetadata(
      "some-skill",
      { requires_tools: [""] },
      knownProcedures,
      knownSkills
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("metadata.requires_tools");
  });
});

describe("parseSkillFrontmatter (pure)", () => {
  test("parses a normal frontmatter block", () => {
    const fm = parseSkillFrontmatter("---\nname: x\nmetadata:\n  type: domain\n---\nbody");
    expect(fm).not.toBeNull();
    expect((fm as Record<string, unknown>)["name"]).toBe("x");
  });

  test("missing opening delimiter ⇒ null", () => {
    expect(parseSkillFrontmatter("no frontmatter here")).toBeNull();
  });

  test("missing closing delimiter ⇒ null", () => {
    expect(parseSkillFrontmatter("---\nname: x\n")).toBeNull();
  });

  test("invalid YAML (backtick scalar) ⇒ null, not a throw", () => {
    // Regression shape for the k-dart/k-law defect: a plain scalar cannot
    // start with a backtick (reserved indicator) — the parser must surface
    // it as null so the graph pass reports it, never crash.
    expect(parseSkillFrontmatter("---\nmetadata:\n  triggers:\n    - `공시검색`\n---\nbody")).toBeNull();
  });
});

// ── Layer 2: real-repo integration ──────────────────────────────────────────

describe("buildGraphMap over the live repo (PR-8 gates)", () => {
  const map = buildGraphMap();

  test("human-role registry loads non-empty (fail-closed sanity)", () => {
    expect(loadHumanRoles().has("entity-ic-reviewer")).toBe(true);
  });

  test("zero errors, zero missing agents, zero missing skills", () => {
    expect(map.errors).toEqual([]);
    expect(map.missing.agents).toEqual([]);
    expect(map.missing.skills).toEqual([]);
  });

  test("missing.agents is EMPTY because entity-ic-reviewer is a registered human role, not an agent", () => {
    // Regression pin for the standing pre-PR-8 finding. If this test fails
    // with entity-ic-reviewer listed, either the registry load broke
    // (fail-closed → no exemptions) or the key was dropped from
    // procedures/_human-roles.yaml. Do NOT fix by adding an agent file.
    expect(map.missing.agents).not.toContain("entity-ic-reviewer");
  });

  test("exactly six human-authority steps — the two IC decisions, the PMI BAU-exit certification, the venture-portfolio transition decision, the S8 target selection, and the greenfield execution-baseline confirmation (ADR-0053 / ADR-0052 §B/§E / ADR-0143 / ADR-0161)", () => {
    const marked = map.procedures.flatMap((p) =>
      p.steps.filter((s) => s.decision_authority === "human").map((s) => `${p.procedure}#${s.id}`)
    );
    expect(marked.sort()).toEqual(["brownfield-fs-comparative#2", "entity-ic-review#5", "greenfield-execution-baseline#6", "group-investment-review#5", "pmi-integration-execution#5", "portfolio-venture-monitoring#3"]);
  });

  test("bidirectional contract: every (procedure → skill) edge is in the skill's metadata.procedure_keys", () => {
    // Re-derives the edges and reads each referenced skill's frontmatter —
    // the same contract checkSkillGraph enforces, spelled out so a failure
    // names the drifted skill.
    const edges = new Set<string>();
    for (const p of map.procedures) {
      for (const s of p.steps) {
        if (typeof s.skill_key === "string" && s.skill_key.trim() !== "") {
          edges.add(`${p.procedure} ${s.skill_key}`);
        }
      }
    }
    expect(edges.size).toBeGreaterThan(30); // sanity: the graph is non-trivial
    const drifted: string[] = [];
    for (const edge of edges) {
      const [procedure, skill] = edge.split(" ");
      const content = require("node:fs").readFileSync(
        join(PROJECT_ROOT, "skills", skill, "SKILL.md"),
        "utf-8"
      );
      const fm = parseSkillFrontmatter(content);
      const meta = ((fm as Record<string, unknown> | null)?.metadata ?? {}) as Record<string, unknown>;
      const declared = Array.isArray(meta.procedure_keys) ? (meta.procedure_keys as string[]) : [];
      if (!declared.includes(procedure)) drifted.push(edge);
    }
    expect(drifted).toEqual([]);
  });

  test("group-investment-review step 5 is the recorder shape (PGM key + human marking)", () => {
    const step = map.procedures
      .find((p) => p.procedure === "group-investment-review" && p.combo === "shared")!
      .steps.find((s) => s.id === 5)!;
    expect(step.agent_key).toBe("process-governance-manager");
    expect(step.decision_authority).toBe("human");
    expect(step.output_type).toBe("group_ic_decision");
  });

  test("entity-ic-review step 5 is the human-role shape (registry key, no agent file)", () => {
    const step = map.procedures
      .find((p) => p.procedure === "entity-ic-review" && p.combo === "shared")!
      .steps.find((s) => s.id === 5)!;
    expect(step.agent_key).toBe("entity-ic-reviewer");
    expect(step.decision_authority).toBe("human");
    expect(require("node:fs").existsSync(join(PROJECT_ROOT, "agents", "entity-ic-reviewer.md"))).toBe(false);
  });
});
