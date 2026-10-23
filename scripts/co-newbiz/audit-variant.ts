#!/usr/bin/env bun
// @version 1.2.0
/**
 * co-newbiz variant audit hook — executed by scripts/audit.ts §27 (the
 * pluggable variant-specific audit checks; declared in variant.json
 * script_manifest.local as scripts/co-newbiz/audit-variant.ts). Runs the
 * project-local gates that the shared core audit knows nothing about. Exits
 * non-zero when any fails (audit.ts §27 maps that to a Fail).
 *
 * Checks:
 *   - MCP coverage (Wave M, ADR-0154): every flow.spec S1-S12 activity and
 *     requiredArtifact has an MCP tool, and no human-only exclusion gained one
 *     (scripts/co-newbiz/mcp-coverage.ts).
 *   - SKILLS.md registry parity (T-20261022-037): skills/SKILLS.md structural
 *     section headers appear at most once and carry no duplicate rows, the
 *     Workspace Skills table's skill-name set equals the set of skills/<name>/
 *     directories (both directions reported), and no "Retired / Tracked
 *     Elsewhere" row has a directory (repaired skills must graduate back into
 *     the Workspace Skills table).
 *   - Runtime agent-registry drift gate (ADR-0183 D3, design
 *     2026-09-15-runtime-pm-agent-orchestration §6.4): v1.2.0 moved this gate
 *     here from a direct scripts/audit.ts wiring — audit.ts is a core script
 *     that must stay identical to templates/common (Core Script
 *     Standardization), so variant-specific audit checks belong in this
 *     pluggable hook. Skips with a visible note when the generator is absent
 *     (non-web contexts).
 *   - Runtime PM-catalog drift gate (ADR-0183 D1/D3, design §6.2/§6.4): same
 *     relocation rationale; unit-level enforcement also exists in
 *     tests/unit/pm-catalog.test.ts — this keeps a stale catalog from passing
 *     an audit run that skips unit tests.
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCoverage } from "./mcp-coverage.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface RegistryReport {
  errors: string[];
  workspaceRows: number;
  directories: number;
  retiredRows: number;
}

/** Structural section headers of skills/SKILLS.md — each must appear at most once. */
const STRUCTURAL_HEADERS = [
  "# SKILLS.md — Skill Lifecycle Registry",
  "## Registry",
  "### Workspace Skills",
  "### Variant-Exclusive Skills",
  "### Retired / Tracked Elsewhere",
];

/** Table data row: backticked skill name in the first cell (header/separator rows don't match). */
const ROW_RE = /^\|\s*`([a-z0-9-]+)`\s*\|/;

/** Skill names of one registry section's table: from its header to the next header. */
function sectionRows(lines: string[], header: string): string[] {
  const names: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (line.trimEnd() === header) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (line.startsWith("#")) break;
    const m = line.match(ROW_RE);
    if (m) names.push(m[1]);
  }
  return names;
}

/**
 * SKILLS.md registry parity (T-20261022-037). The registry rotted invisibly
 * because audit.ts only checks VERSION_MANIFEST.md ↔ skills/ parity — this gate
 * makes the registry's own structure machine-checked: (a) each structural
 * header at most once and no duplicated rows inside a section, (b) the
 * Workspace Skills table's skill-name set equals the skills/ directory set
 * (rows-without-dir and dirs-without-row both reported), (c) no Retired row
 * has a directory (graduation ratchet).
 */
async function runRegistryParity(): Promise<RegistryReport> {
  const report: RegistryReport = { errors: [], workspaceRows: 0, directories: 0, retiredRows: 0 };
  try {
    const content = await Bun.file(join(ROOT, "skills", "SKILLS.md")).text();
    const lines = content.split("\n");

    // (a) structural headers at most once
    for (const header of STRUCTURAL_HEADERS) {
      const count = lines.filter((l) => l.trimEnd() === header).length;
      if (count > 1) {
        report.errors.push(`structural header appears ${count}x (must be 1): "${header}"`);
      }
    }

    const workspaceNames = sectionRows(lines, "### Workspace Skills");
    const retiredNames = sectionRows(lines, "### Retired / Tracked Elsewhere");
    const dirs = readdirSync(join(ROOT, "skills"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const dirSet = new Set(dirs);
    const nameSet = new Set(workspaceNames);

    // (a, cont.) duplicated rows inside a section are the same rot class
    for (const [label, names] of [
      ["Workspace Skills", workspaceNames],
      ["Retired / Tracked Elsewhere", retiredNames],
    ] as const) {
      const seen = new Map<string, number>();
      for (const n of names) seen.set(n, (seen.get(n) ?? 0) + 1);
      const dupes = [...seen.entries()].filter(([, c]) => c > 1).map(([n, c]) => `${n} (${c}x)`);
      if (dupes.length > 0) {
        report.errors.push(`duplicate rows in the ${label} table: ${dupes.join(", ")}`);
      }
    }

    // (b) Workspace Skills table ↔ skills/ directories, both directions
    const rowsWithoutDir = [...nameSet].filter((n) => !dirSet.has(n)).sort();
    const dirsWithoutRow = dirs.filter((d) => !nameSet.has(d));
    if (rowsWithoutDir.length > 0) {
      report.errors.push(
        `Workspace Skills rows with no skills/<name>/ directory (${rowsWithoutDir.length}): ${rowsWithoutDir.join(", ")}`,
      );
    }
    if (dirsWithoutRow.length > 0) {
      report.errors.push(
        `skills/<name>/ directories with no Workspace Skills row (${dirsWithoutRow.length}): ${dirsWithoutRow.join(", ")}`,
      );
    }

    // (c) graduation ratchet: a Retired row must not have a directory
    const graduated = retiredNames.filter((n) => dirSet.has(n)).sort();
    if (graduated.length > 0) {
      report.errors.push(
        `Retired / Tracked Elsewhere rows that now have a skills/<name>/ directory — move them into the Workspace Skills table (${graduated.length}): ${graduated.join(", ")}`,
      );
    }

    report.workspaceRows = workspaceNames.length;
    report.directories = dirs.length;
    report.retiredRows = retiredNames.length;
  } catch (e) {
    report.errors.push(`skills/SKILLS.md unreadable or unparseable: ${e instanceof Error ? e.message : e}`);
  }
  return report;
}

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

const registry = await runRegistryParity();
if (registry.errors.length === 0) {
  console.log(
    `  ✓ SKILLS.md registry parity: ${registry.workspaceRows} workspace rows == ${registry.directories} skill directories; ${registry.retiredRows} retired entries tracked`,
  );
} else {
  failed = true;
  console.error(`  ✗ SKILLS.md registry parity failed (${registry.errors.length}):`);
  for (const e of registry.errors) console.error(`      - ${e}`);
}

/**
 * Runtime projection drift gates (ADR-0183 D1/D3). Each gate runs its
 * generator's --check via Bun spawn: exit 0 = projection matches its SSOTs
 * (Pass); non-zero = drift (Fail with the regeneration remediation hint).
 * A missing generator script means a non-web context — skip with a visible
 * note, never silently.
 */
function runDriftGate(label: string, generator: string, staleTarget: string): void {
  const generatorPath = join(ROOT, generator);
  if (!existsSync(generatorPath)) {
    console.log(`  – ${label} drift gate skipped: ${generator} not present (non-web context)`);
    return;
  }
  const proc = Bun.spawnSync(["bun", generator, "--check"], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    failed = true;
    console.error(`  ✗ ${label} drift detected: ${staleTarget} is stale —`);
    const out = new TextDecoder().decode(proc.stdout);
    const err = new TextDecoder().decode(proc.stderr);
    if (out) console.error(out);
    if (err) console.error(err);
    console.error(`      remediation: bun ${generator}, review, and commit`);
  } else {
    console.log(`  ✓ ${label} drift gate: runtime projection matches its SSOTs`);
  }
}

runDriftGate(
  "Agent-registry",
  "scripts/co-newbiz/generate-agent-registry.ts",
  "app/web-next/lib/agent-registry.generated.ts",
);
runDriftGate(
  "PM-catalog",
  "scripts/co-newbiz/generate-pm-catalog.ts",
  "app/web-next/lib/pm-catalog.generated.ts",
);

process.exit(failed ? 1 : 0);
