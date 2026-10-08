#!/usr/bin/env bun
// @version 1.0.0
/**
 * co-newbiz variant audit hook — executed by scripts/audit.ts §27 (the
 * pluggable variant-specific audit checks; probed at
 * scripts/<variant>/audit-variant.ts). Runs the project-local gates that the
 * shared core audit knows nothing about. Exits non-zero when any fails.
 *
 * Checks:
 *   - MCP coverage (Wave M, ADR-0154): every flow.spec S1-S12 activity and
 *     requiredArtifact has an MCP tool, and no human-only exclusion gained one
 *     (scripts/co-newbiz/mcp-coverage.ts).
 */

import { runCoverage } from "./mcp-coverage.ts";

let failed = false;

const coverage = await runCoverage();
if (coverage.errors.length === 0) {
  console.log(
    `  ✓ MCP coverage: ${coverage.tools} tools cover ${coverage.activities} activities and ${coverage.artifacts} artifacts (${coverage.excluded} human-only exclusions enforced)`,
  );
} else {
  failed = true;
  console.error(`  ✗ MCP coverage failed (${coverage.errors.length}):`);
  for (const e of coverage.errors) console.error(`      - ${e}`);
}

process.exit(failed ? 1 : 0);
