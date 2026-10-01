/**
 * Stage-aliases registry validation (procedures/_validate.ts stage-aliases pass) —
 * tests for SA-1 through SA-5 checks (ADR-0083; no-collision criterion per ADR-0149).
 *
 * ADR-0149: gate-axis ids are G1-G8; the validator checks alias targets against
 * the declared process/stages.yaml id set — no hard-coded prefix pattern.
 */

import { test, expect, describe } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";

const PROJECT_ROOT = join(import.meta.dirname, "../..");

const { validateStageAliases } = await import("../../procedures/_validate.ts");

describe("stage-aliases registry validation", () => {
  test("SA-2: every gate value used in procedures has a matching alias entry", () => {
    const declaredGates = new Map([
      ["Screening", "procedures/_shared/brownfield-screening/schema.yaml"],
      ["FS", "procedures/_shared/brownfield-fs/schema.yaml"],
    ]);
    const aliases = new Map([
      ["Screening", { stage: "G1" }],
      ["FS", { stage: "G4" }],
    ]);
    const stages = new Set(["G1", "G4"]);

    const issues = validateStageAliases(declaredGates, aliases, stages);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  test("SA-2: unaliased gate value is an ERROR", () => {
    const declaredGates = new Map([
      ["Screening", "procedures/_shared/brownfield-screening/schema.yaml"],
      ["UnknownGate", "procedures/_shared/some-procedure/schema.yaml"],
    ]);
    const aliases = new Map([["Screening", { stage: "G1" }]]);
    const stages = new Set(["G1"]);
    const issues = validateStageAliases(declaredGates, aliases, stages);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => e.message.includes("UnknownGate"))).toBe(true);
  });

  test("SA-2: template sentinel TODO gate is skipped", () => {
    const declaredGates = new Map([
      ["Screening", "procedures/_shared/brownfield-screening/schema.yaml"],
      ["TODO", "procedures/_template/schema.yaml"],
    ]);
    const aliases = new Map([["Screening", { stage: "G1" }]]);
    const stages = new Set(["G1"]);
    const issues = validateStageAliases(declaredGates, aliases, stages);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  test("SA-3: alias stage ID must be declared in process/stages.yaml", () => {
    const declaredGates = new Map([["Screening", "procedures/_shared/brownfield-screening/schema.yaml"]]);
    const aliases = new Map([["Screening", { stage: "G99" }]]);
    const stages = new Set(["G1", "G2"]);
    const issues = validateStageAliases(declaredGates, aliases, stages);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => e.message.includes("not declared"))).toBe(true);
  });

  test("SA-3: accepts declared ids regardless of prefix (ADR-0149)", () => {
    // Any id declared in stages.yaml is accepted, whatever its prefix.
    const declaredGates = new Map([["Screening", "procedures/_shared/brownfield-screening/schema.yaml"]]);
    const aliases = new Map([["Screening", { stage: "G1" }]]);
    const stages = new Set(["G1"]);
    const issues = validateStageAliases(declaredGates, aliases, stages);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  test("SA-5: declared stage id referenced by no alias is an ERROR", () => {
    const declaredGates = new Map([["Screening", "procedures/_shared/brownfield-screening/schema.yaml"]]);
    const aliases = new Map([["Screening", { stage: "G1" }]]);
    const stages = new Set(["G1", "G2"]);
    const issues = validateStageAliases(declaredGates, aliases, stages);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => e.message.includes("referenced by no alias"))).toBe(true);
  });

  test("SA-4: unused alias entry is a WARNING, not an error", () => {
    const declaredGates = new Map([["Screening", "procedures/_shared/brownfield-screening/schema.yaml"]]);
    const aliases = new Map([
      ["Screening", { stage: "G1" }],
      ["PreReserved", { stage: "G2" }], // Used to pre-register a gate before its procedure lands
    ]);
    const stages = new Set(["G1", "G2"]);
    const issues = validateStageAliases(declaredGates, aliases, stages);
    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warn");
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.message.includes("PreReserved"))).toBe(true);
  });

  test("all 8 standard stages pass validation", () => {
    const declaredGates = new Map([
      ["Screening", "procedures/_shared/brownfield-screening/schema.yaml"],
      ["Target Screening", "procedures/_shared/brownfield-target-screening/schema.yaml"],
      ["Pre-FS", "procedures/_shared/brownfield-pre-fs/schema.yaml"],
      ["FS", "procedures/_shared/brownfield-fs/schema.yaml"],
      ["DD", "procedures/_shared/brownfield-dd/schema.yaml"],
      ["Entity IC", "procedures/_shared/entity-ic-review/schema.yaml"],
      ["Group IC", "procedures/_shared/group-investment-review/schema.yaml"],
      ["post_close", "procedures/_shared/pmi-integration-execution/schema.yaml"],
    ]);
    const aliases = new Map([
      ["Screening", { stage: "G1" }],
      ["Target Screening", { stage: "G2" }],
      ["Pre-FS", { stage: "G3" }],
      ["FS", { stage: "G4" }],
      ["DD", { stage: "G5" }],
      ["Entity IC", { stage: "G6" }],
      ["Group IC", { stage: "G7" }],
      ["post_close", { stage: "G8" }],
    ]);
    const stages = new Set(["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"]);

    const issues = validateStageAliases(declaredGates, aliases, stages);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });
});

// ── ADR-0149 no-collision criterion ─────────────────────────────────────────

describe("ADR-0149 no-collision (real process files)", () => {
  test("no id appears in both process/stages.yaml and process/flow.spec.yaml", () => {
    const stagesPath = join(PROJECT_ROOT, "process", "stages.yaml");
    const flowSpecPath = join(PROJECT_ROOT, "process", "flow.spec.yaml");
    expect(existsSync(stagesPath)).toBe(true);
    expect(existsSync(flowSpecPath)).toBe(true);

    const stagesDoc = yaml.load(readFileSync(stagesPath, "utf-8"), {
      schema: yaml.JSON_SCHEMA,
    }) as { stages?: Array<{ id?: unknown }> } | null;
    const flowDoc = yaml.load(readFileSync(flowSpecPath, "utf-8"), {
      schema: yaml.JSON_SCHEMA,
    }) as { stages?: Array<{ id?: unknown }> } | null;

    const gateIds = (stagesDoc?.stages ?? [])
      .map((s) => (typeof s?.id === "string" ? s.id : null))
      .filter((id): id is string => id !== null);
    const businessIds = (flowDoc?.stages ?? [])
      .map((s) => (typeof s?.id === "string" ? s.id : null))
      .filter((id): id is string => id !== null);

    expect(gateIds.length).toBeGreaterThan(0);
    expect(businessIds.length).toBeGreaterThan(0);

    const collision = gateIds.filter((id) => businessIds.includes(id));
    expect(collision).toEqual([]);
  });
});
