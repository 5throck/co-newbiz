#!/usr/bin/env bun
/**
 * Variant-Specific Audit Hook (co-newbiz)
 * @version 0.1.0
 * Pluggable hook invoked by scripts/audit.ts (check #27). Core scripts stay
 * standardized across variants; variant projects add custom verification here.
 *
 * Checks:
 *   1. Multi-element graph freshness — docs/graph/graph.{json,md} must match
 *      the SSOT-derived projection (design 2026-08-24-multi-element-skill-
 *      graph-pilot-design.md §4). A stale committed graph means some SSOT
 *      edit landed without regenerating, so the contextual bundles would
 *      serve outdated relations.
 *
 * Usage: bun scripts/audit-variant.ts   (exit 0 = pass, exit 1 = fail)
 */

import { checkGraphDrift } from "./co-newbiz/graph.ts";

const failures: string[] = [];

function report(name: string, problems: string[]): void {
  if (problems.length === 0) {
    console.log(`[PASS] ${name}`);
  } else {
    for (const p of problems) console.log(`[FAIL] ${name} — ${p}`);
    failures.push(name);
  }
}

// Check 1: graph projection freshness
report("graph: committed projection matches SSOTs", checkGraphDrift());

if (failures.length > 0) {
  console.log(`\n[FAIL] audit-variant: ${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\n[PASS] audit-variant: all checks passed.");
