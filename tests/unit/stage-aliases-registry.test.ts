/**
 * Stage-aliases registry validation (procedures/_validate.ts stage-aliases pass) —
 * ADR-0083, tests for SA-1 through SA-4 checks.
 */

import { test, expect, describe } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");

const { validateStageAliases } = await import("../../procedures/_validate.ts");

// ── Stage aliases validation (procedures/_validate.ts stage-aliases pass) ────

describe("stage-aliases registry validation", () => {
  test("SA-2: every gate value used in procedures has a matching alias entry", () => {
    const declaredGates = new Map([
      ["Screening", "procedures/_shared/brownfield-screening/schema.yaml"],
      ["FS", "procedures/_shared/brownfield-fs/schema.yaml"],
    ]);
    const aliases = new Map([
      ["Screening", { stage: "S1" }],
      ["FS", { stage: "S4" }],
    ]);
    const stages = new Set(["S1", "S4"]);

    const issues = validateStageAliases(declaredGates, aliases, stages);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  test("SA-2: unaliased gate value is an ERROR", () => {
    const declaredGates = new Map([
      ["Screening", "procedures/_shared/brownfield-screening/schema.yaml"],
      ["UnknownGate", "procedures/_shared/some-procedure/schema.yaml"],
    ]);
    const aliases = new Map([["Screening", { stage: "S1" }]]);
    const stages = new Set(["S1"]);

    const issues = validateStageAliases(declaredGates, aliases, stages);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => e.message.includes("UnknownGate"))).toBe(true);
  });

  test("SA-2: template sentinel TODO gate is skipped", () => {
    const declaredGates = new Map([
      ["Screening", "procedures/_shared/brownfield-screening/schema.yaml"],
      ["TODO", "procedures/_template/schema.yaml"],
    ]);
    const aliases = new Map([["Screening", { stage: "S1" }]]);
    const stages = new Set(["S1"]);

    const issues = validateStageAliases(declaredGates, aliases, stages);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  test("SA-3: alias stage ID must match ^S[0-9]+$ pattern", () => {
    const declaredGates = new Map([["Screening", "procedures/_shared/brownfield-screening/schema.yaml"]]);
    const aliases = new Map([
      ["Screening", { stage: "INVALID" }],
    ]);
    const stages = new Set(["INVALID"]);

    const issues = validateStageAliases(declaredGates, aliases, stages);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => e.message.includes("does not match pattern"))).toBe(true);
  });

  test("SA-3: alias stage ID must be declared in process/stages.yaml", () => {
    const declaredGates = new Map([["Screening", "procedures/_shared/brownfield-screening/schema.yaml"]]);
    const aliases = new Map([["Screening", { stage: "S99" }]]);
    const stages = new Set(["S1", "S2"]);

    const issues = validateStageAliases(declaredGates, aliases, stages);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => e.message.includes("not declared"))).toBe(true);
  });

  test("SA-4: unused alias entry is a WARNING, not an error", () => {
    const declaredGates = new Map([["Screening", "procedures/_shared/brownfield-screening/schema.yaml"]]);
    const aliases = new Map([
      ["Screening", { stage: "S1" }],
      ["PreReserved", { stage: "S2" }], // Used to pre-register a gate before its procedure lands
    ]);
    const stages = new Set(["S1", "S2"]);

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
      ["Screening", { stage: "S1" }],
      ["Target Screening", { stage: "S2" }],
      ["Pre-FS", { stage: "S3" }],
      ["FS", { stage: "S4" }],
      ["DD", { stage: "S5" }],
      ["Entity IC", { stage: "S6" }],
      ["Group IC", { stage: "S7" }],
      ["post_close", { stage: "S8" }],
    ]);
    const stages = new Set(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]);

    const issues = validateStageAliases(declaredGates, aliases, stages);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });
});
