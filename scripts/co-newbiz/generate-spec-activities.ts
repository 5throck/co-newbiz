// @version 1.0.0
// Process Flow Spec → app/web-next/lib/spec-activities.generated.ts generator.
// process/flow.spec.yaml is the SSOT; this script regenerates the static
// activity projection consumed by the Next/Turbopack server bundle (ADR-0074).
// The mirrors-spec test (tests/unit/process-flow.test.ts:179) asserts the
// projection equals the spec at test time; --check makes drift loud the same
// way scripts/co-newbiz/generate-process-flow.ts does for docs/process-flow.md.
//
// Usage: bun scripts/co-newbiz/generate-spec-activities.ts [--check]
//   --check : exit 1 if spec-activities.generated.ts would change (CI mode).
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
  activities: Activity[];
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

function normalizeForCheck(text: string): string {
  // Windows checkouts may materialize the generated file with CRLF while the
  // in-memory generator emits LF. Treat line endings as a transport detail so
  // the freshness gate only reports real spec/projection drift.
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

if (process.argv.includes("--check")) {
  const current = readFileSync(OUT_PATH, "utf8");
  if (normalizeForCheck(current) !== normalizeForCheck(generated)) {
    console.error("app/web-next/lib/spec-activities.generated.ts is stale — regenerate with: bun scripts/co-newbiz/generate-spec-activities.ts");
    process.exit(1);
  }
  console.log("app/web-next/lib/spec-activities.generated.ts is up to date.");
} else {
  writeFileSync(OUT_PATH, generated, "utf8");
  console.log(`app/web-next/lib/spec-activities.generated.ts generated (${stages.length} stages, spec ${spec.meta.version}).`);
}
