// @version 1.1.0
// Process Flow Spec → app/web-next/lib/spec-activities.generated.ts generator.
// process/flow.spec.yaml is the SSOT; this script regenerates the static
// activity projection consumed by the Next/Turbopack server bundle (ADR-0074).
// The mirrors-spec test (tests/unit/process-flow.test.ts:179) asserts the
// projection equals the spec at test time; --check makes drift loud the same
// way scripts/co-newbiz/generate-process-flow.ts does for docs/process-flow.md.
//
// v1.1.0 (Wave M M-3, ADR-0154): also emits mcp/co-newbiz/stage-guides.generated.ts,
// the static S1-S12 slice behind the MCP stage_guide_s* prompts and flowspec://
// resources (the stdio server and the Next bundle cannot read the YAML at runtime).
//
// Usage: bun scripts/co-newbiz/generate-spec-activities.ts [--check]
//   --check : exit 1 if either generated file would change (CI mode).
import { readFileSync, writeFileSync } from "node:fs";
import * as yaml from "js-yaml";

const SPEC_PATH = "process/flow.spec.yaml";
const OUT_PATH = "app/web-next/lib/spec-activities.generated.ts";

interface Activity {
  id: string;
  agent: string;
  skills: string[];
  procedure: string[];
}
interface Stage {
  id: string;
  name: string;
  objective: string;
  activities: Activity[];
  requiredArtifacts?: string[];
  completionCriteria?: string[];
  applicableTracks?: string[];
  gates?: string[];
}
interface FlowSpec {
  meta: { version: string };
  stages: Stage[];
}

const spec = yaml.load(readFileSync(SPEC_PATH, "utf8")) as FlowSpec;

const stages = spec.stages.map((s) => ({
  id: s.id,
  activities: s.activities.map((a) => ({
    id: a.id,
    agent: a.agent,
    skills: a.skills,
    procedure: a.procedure,
  })),
}));

const HEADER = `// Generated from process/flow.spec.yaml for Next/Turbopack static server bundling.
// Do not edit by hand; update process/flow.spec.yaml and regenerate this
// projection with: bun scripts/co-newbiz/generate-spec-activities.ts
// (--check mode exits 1 on drift; tests/unit/process-flow.test.ts asserts
// this projection mirrors the spec.)
`;

const generated = `${HEADER}import type { SpecStage } from "./spec-activities.ts";

export const SPEC_VERSION = ${JSON.stringify(spec.meta.version)};
export const SPEC_STAGES: SpecStage[] = ${JSON.stringify(stages, null, 2)};
`;

const GUIDES_OUT_PATH = "mcp/co-newbiz/stage-guides.generated.ts";

// The MCP slice: what a stage is for and which spec keys it names. Procedure
// STEPS are deliberately absent (boundary #3) — agents call get_procedure.
const guideStages = spec.stages.map((s) => ({
  id: s.id,
  name: s.name,
  objective: s.objective,
  applicableTracks: s.applicableTracks ?? [],
  gates: s.gates ?? [],
  activities: s.activities.map((a) => ({ id: a.id, agent: a.agent, procedure: a.procedure })),
  requiredArtifacts: s.requiredArtifacts ?? [],
  completionCriteria: s.completionCriteria ?? [],
}));

const guidesGenerated = `// Generated from process/flow.spec.yaml. Do not edit by hand; regenerate with:
// bun scripts/co-newbiz/generate-spec-activities.ts (--check exits 1 on drift;
// tests/unit/mcp-prompts.test.ts runs it). Source of the MCP stage_guide_s*
// prompts and flowspec:// resources (ADR-0154, Wave M M-3).
import type { StageGuideSpec } from "./stage-guides.ts";

export const GUIDE_SPEC_VERSION = ${JSON.stringify(spec.meta.version)};
export const GUIDE_STAGES: StageGuideSpec[] = ${JSON.stringify(guideStages, null, 2)};
`;

function normalizeForCheck(text: string): string {
  // Windows checkouts may materialize the generated file with CRLF while the
  // in-memory generator emits LF. Treat line endings as a transport detail so
  // the freshness gate only reports real spec/projection drift.
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

if (process.argv.includes("--check")) {
  const stale: string[] = [];
  for (const [path, text] of [[OUT_PATH, generated], [GUIDES_OUT_PATH, guidesGenerated]] as const) {
    if (normalizeForCheck(readFileSync(path, "utf8")) !== normalizeForCheck(text)) stale.push(path);
  }
  if (stale.length > 0) {
    console.error(`${stale.join(", ")} stale — regenerate with: bun scripts/co-newbiz/generate-spec-activities.ts`);
    process.exit(1);
  }
  console.log("spec-activities.generated.ts and stage-guides.generated.ts are up to date.");
} else {
  writeFileSync(OUT_PATH, generated, "utf8");
  writeFileSync(GUIDES_OUT_PATH, guidesGenerated, "utf8");
  console.log(`${OUT_PATH} and ${GUIDES_OUT_PATH} generated (${stages.length} stages, spec ${spec.meta.version}).`);
}
