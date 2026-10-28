// @version 1.0.0
// process/cross-validation-matrix.yaml -> app/web-next/lib/review/review-matrix.generated.ts
// (ADR-0187 P4, M7/M8, decision D3). The YAML is the SSOT; the Next/Turbopack
// server bundle cannot read it at runtime, so this emits a static projection
// (the pattern of generate-spec-activities.ts). --check exits 1 on drift.
//
// Usage: bun scripts/co-newbiz/generate-review-matrix.ts [--check]
import { readFileSync, writeFileSync } from "node:fs";
import * as yaml from "js-yaml";

const SRC = "process/cross-validation-matrix.yaml";
const OUT = "app/web-next/lib/review/review-matrix.generated.ts";

interface Raw {
  version: string;
  fallback: Record<string, string>;
  reviewer_domains: Record<string, string>;
  agent_exemptions: Array<{ agent: string; reason: string }>;
  gate_exceptions: Array<{ gate: string; reason: string; policy_ref: string }>;
  artifact_types: Record<string, { reviewers: Record<string, string>; rationale: string }>;
  stages: Record<
    string,
    {
      default_type: string;
      required?: Array<{ match: string; artifact_type: string }>;
      outputs?: Array<{ match: string; artifact_type: string; review: string; covered_by?: string; reason?: string }>;
    }
  >;
}

const raw = yaml.load(readFileSync(SRC, "utf8")) as Raw;

const projection = {
  version: raw.version,
  fallback: raw.fallback,
  reviewerDomains: raw.reviewer_domains,
  agentExemptions: raw.agent_exemptions.map((e) => e.agent),
  gateExceptions: raw.gate_exceptions.map((g) => g.gate),
  artifactTypes: Object.fromEntries(
    Object.entries(raw.artifact_types).map(([k, v]) => [k, { reviewers: v.reviewers, rationale: v.rationale.trim() }]),
  ),
  stages: Object.fromEntries(
    Object.entries(raw.stages).map(([id, s]) => [
      id,
      {
        defaultType: s.default_type,
        required: (s.required ?? []).map((r) => ({ match: r.match, artifactType: r.artifact_type })),
      },
    ]),
  ),
};

const generated = `// Generated from process/cross-validation-matrix.yaml. Do not edit by hand;
// regenerate with: bun scripts/co-newbiz/generate-review-matrix.ts
// (--check exits 1 on drift; tests/unit/review-matrix.test.ts runs it).
import type { ReviewMatrix } from "./domains.ts";

export const REVIEW_MATRIX: ReviewMatrix = ${JSON.stringify(projection, null, 2)};
`;

const norm = (t: string) => t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    /* missing = stale */
  }
  if (norm(current) !== norm(generated)) {
    console.error(`${OUT} stale - regenerate with: bun scripts/co-newbiz/generate-review-matrix.ts`);
    process.exit(1);
  }
  console.log("review-matrix.generated.ts is up to date.");
} else {
  writeFileSync(OUT, generated, "utf8");
  console.log(`${OUT} generated (matrix ${raw.version}, ${Object.keys(raw.artifact_types).length} artifact types).`);
}
