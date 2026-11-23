#!/usr/bin/env bun
// @version 1.13.1
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
 *   - Route audit scan (review W1 M11, FR-SEC-07): every state-changing
 *     (POST/PUT/PATCH/DELETE) Route Handler reaches an appendAudit write, or is
 *     listed with a reason in scripts/co-newbiz/route-audit-allowlist.json
 *     (scripts/co-newbiz/route-audit-scan.ts).
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
 *   - Process SSOT validators (v1.4.0, ADR-0187 P1): the eight named checks of
 *     scripts/co-newbiz/process-ssot-check.ts. Since v1.5.0 (ADR-0187 P2) the
 *     BLOCKING_CHECKS set the failure flag; since v1.6.0 (ADR-0187 P3)
 *     check-engine-spec-parity is blocking too; since v1.7.0 (ADR-0187 P4)
 *     check-review-coverage blocks as well (every check is blocking) and the
 *     review-matrix projection drift gate runs next to the registry gates.
 *   - Glossary-data drift gate (declared v1.8.0, ADR-0022 / FR-SYS-04; actually
 *     wired only in v1.10.0 — the v1.8.0 header entry was never invoked in the
 *     body, the header rot this bump fixes): glossary/*.yaml vs
 *     app/web-next/lib/glossary-data.generated.ts via generate-glossary-data.ts --check.
 *   - Governance-registry manifest drift gate (v1.9.0): policies/, procedures/,
 *     checklists/, templates/ vs docs/governance/governance-registry.generated.json
 *     via governance-sync.ts --check.
 *   - Generated projection drift gate (v1.10.0): one combined blocking check
 *     running three generators' --check as subprocesses and naming the exact
 *     refresh command on drift — sync-library-projection.ts (checklists/,
 *     procedures/, docs/ sources incl. docs/runbooks/** vs
 *     app/web-next/lib/library.generated.ts), sync-wiki-projection.ts
 *     (docs/wiki/ko/ vs app/web-next/lib/wiki.generated.ts), and
 *     generate-glossary-data.ts (glossary/*.yaml vs
 *     app/web-next/lib/glossary-data.generated.ts; its --check also fails on
 *     a glossary/_validate.ts failure — fail-closed by contract). Same drift
 *     class as the runDriftGate family, but with a recurring, late failure
 *     mode: source edits landed without re-sync and surfaced only as a RED CI
 *     coverage job after landing (PRs #913/#936/#946) — this gate blocks
 *     locally at dev-sync before push instead.
 *   - ADR-0070 server-boundary gate (v1.11.0, review F-1 / DEC-20261122-01):
 *     lint-server-boundary.ts as a blocking subprocess — Rule 1 ("use server"
 *     + data access) stays an absolute violation; Rule 2 is ALLOWLIST mode,
 *     sanctioning exactly the five carrier flat-route pages within the frozen
 *     module set {db/client.ts, lib/carrier-resolve.ts, lib/rsc-session.ts}
 *     and read-only SQL shapes. The original audit.ts 2.15.0 wiring was
 *     silently destroyed by the 2026-08-29 upgrade wave (4d6793e6); this
 *     variant-owned placement is upgrade-proof (Core Script Standardization
 *     keeps audit.ts identical to templates/common). Growing the allowlist
 *     requires a recorded DEC.
 *   - Projection-generator expansion + lint-family gates (v1.12.0, review
 *     F-3/F-4/F-16/F-18/F-20 / DEC-20261122-02): three generators join
 *     PROJECTION_GENERATORS — generate-committee-registry.ts (NEW; the
 *     committee projection previously had no generator at all, and
 *     regenerating surfaced real drift: the ADR-0202 description rewording
 *     in 05424622 never reached the projection), generate-spec-activities.ts
 *     (spec-activities.generated.ts + mcp stage-guides.generated.ts), and
 *     generate-process-flow.ts (docs/process-flow.md) — stale projections
 *     previously passed /sync locally and failed only in the CI unit job.
 *     Two new blocking lint gates: contrast-check.ts --check (WCAG AA token
 *     pairs; the SCRIPTS.md "CI-wired" claim was false — nothing invoked it)
 *     and design-lint.ts (the Onyx 3.0 mechanical scanner, previously
 *     alias-only via `bun run design:lint`). F-18's alternative mechanism —
 *     a variant.json `designLint` override naming app/web-next roots to
 *     activate audit.ts's core design-lint gate — was REJECTED on evidence:
 *     scripts/design-lint.ts --dir app/web-next/app --dir app/web-next/
 *     components exits 1 with 197 pre-existing should-be-token findings, so
 *     enabling it fail-closed would halt every audit; the variant-owned
 *     scanner (clean on the real tree) is the enforcement, and the DEC
 *     records the posture.
 *   - Generator mechanism governance (F-20): adding a generated projection
 *     REQUIRES BOTH the generators.json entry (regeneration: dev-sync 3.86)
 *     AND a PROJECTION_GENERATORS entry here (enforcement). One without the
 *     other is the exact seam the 2026-11-22 review found: a projection that
 *     regenerates but never blocks, or blocks but cannot be refreshed.
 *   - Prompt-registry projection gate + three completeness gates (v1.13.0,
 *     review F-19/F-7/F-8/F-10 residual / DEC-20261123-01):
 *     generate-prompt-registry.ts joins PROJECTION_GENERATORS (7 entries) —
 *     its --check mode is new in the script's v2.2.0; until then the
 *     deep-equality unit test was the only net and ran CI-unit-only. Three
 *     in-process completeness gates close the Action-Wiring deferred rows of
 *     the 2026-11-22 review: (F-7) every docs/adr/NNNN-*.md has an [NNNN] row
 *     in docs/adr/README.md (the index backfill closed a 23-row gap incl.
 *     amendment targets of indexed ADRs; 205/205 today); (F-8) every
 *     docs/designs/*.md is registered in docs/specs/registry.json, with an
 *     in-gate allowlist of exactly the three standing non-design documents
 *     (quality-review minutes, flow-console UX benchmark, implementation
 *     matrix) and the mockups/ directory exempt (233 registered + 3 allowlist
 *     = 236 today); (F-10) every active skill (a Workspace Skills row in
 *     skills/SKILLS.md) has a lifecycle record at docs/lifecycle/skills/<name>.md
 *     (the Wave 5.8 cohort drifted record-less; 109/109 today). Growing the
 *     F-8 allowlist requires a recorded DEC.
 *   - Comment-only pointer edit (v1.13.1, 2026-11-23): the design-lint gate's
 *     header note now cites the Wave-1 ruling of record DEC-20261123-02
 *     (category mapping, transforms, exception list; the variant.json
 *     designLint override remains the post-burn-down activation step). No
 *     behavior change — version bump applied under the bump-on-modify
 *     convention.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCoverage } from "./mcp-coverage.ts";
import { scanRouteAudit } from "./route-audit-scan.ts";
import { BLOCKING_CHECKS, CHECK_IDS, isBlocking, runAll, summarize } from "./process-ssot-check.ts";

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

const routeAudit = scanRouteAudit();
if (routeAudit.unaudited.length === 0 && routeAudit.allowlistErrors.length === 0) {
  console.log(
    `  ✓ Route audit scan: ${routeAudit.writeRoutes} state-changing routes reach an audit write (or carry a reasoned exemption)`,
  );
} else {
  failed = true;
  console.error(`  ✗ Route audit scan failed (${routeAudit.unaudited.length + routeAudit.allowlistErrors.length}):`);
  for (const u of routeAudit.unaudited)
    console.error(
      `      - ${u}: state-changing handler with no audit write (appendAudit) — add one or a reasoned entry in scripts/co-newbiz/route-audit-allowlist.json`,
    );
  for (const e of routeAudit.allowlistErrors) console.error(`      - ${e}`);
}

runDriftGate(
  "Agent-registry",
  "scripts/co-newbiz/generate-agent-registry.ts",
  "app/web-next/lib/agent-registry.generated.ts",
);
runDriftGate("PM-catalog", "scripts/co-newbiz/generate-pm-catalog.ts", "app/web-next/lib/pm-catalog.generated.ts");

runDriftGate(
  "Review-matrix",
  "scripts/co-newbiz/generate-review-matrix.ts",
  "app/web-next/lib/review/review-matrix.generated.ts",
);

// Governance registry manifest drift (v1.9.0): policies/procedures/checklists/
// templates vs docs/governance/governance-registry.generated.json. The DB
// registry is fed from that manifest (newbiz.ts governance:sync), so a stale
// manifest means a stale registry and waiver anchors.
runDriftGate(
  "Governance-registry",
  "scripts/co-newbiz/governance-sync.ts",
  "docs/governance/governance-registry.generated.json",
);

/**
 * Generated projection drift gate (v1.10.0). docs/runbooks/**, the wiki, and
 * the glossary registry are edited without re-running their sync script, so
 * their generated projections (library.generated.ts, wiki.generated.ts,
 * glossary-data.generated.ts) drift silently and the failure only surfaces as
 * a RED CI coverage job after landing — three occurrences of the same class
 * (PRs #913/#936/#946). One combined blocking check, one subprocess per
 * generator: each generator's --check (exit 0 = fresh; silent when fresh by
 * contract), any drift fails the audit and names the exact refresh command.
 * Missing generator means a non-web context — skip with a visible note, never
 * silently.
 */
interface ProjectionGenerator {
  /** Generated file the gate protects (drift target, shown in output). */
  staleTarget: string;
  /** Repo-relative sync script whose --check is the drift signal. */
  generator: string;
  /** Exact refresh command surfaced on drift. */
  refresh: string;
  /** SSOT source area, for actionable failure context. */
  sources: string;
}

const PROJECTION_GENERATORS: ProjectionGenerator[] = [
  {
    staleTarget: "app/web-next/lib/library.generated.ts",
    generator: "scripts/co-newbiz/sync-library-projection.ts",
    refresh: "bun scripts/co-newbiz/sync-library-projection.ts",
    sources: "checklists/, procedures/, docs/ (incl. docs/runbooks/**)",
  },
  {
    staleTarget: "app/web-next/lib/wiki.generated.ts",
    generator: "scripts/co-newbiz/sync-wiki-projection.ts",
    refresh: "bun scripts/co-newbiz/sync-wiki-projection.ts",
    sources: "docs/wiki/ko/",
  },
  {
    staleTarget: "app/web-next/lib/glossary-data.generated.ts",
    generator: "scripts/co-newbiz/generate-glossary-data.ts",
    refresh: "bun scripts/co-newbiz/generate-glossary-data.ts",
    sources: "glossary/*.yaml",
  },
  // v1.12.0 (F-3): the committee projection's own "regenerate" instruction was
  // unfulfillable until this generator existed; its first run also surfaced
  // real drift (the ADR-0202 description rewording had never been projected).
  {
    staleTarget: "app/web-next/lib/committee-registry.generated.ts",
    generator: "scripts/co-newbiz/generate-committee-registry.ts",
    refresh: "bun scripts/co-newbiz/generate-committee-registry.ts",
    sources: "procedures/_committees.yaml",
  },
  // v1.12.0 (F-4): these two had --check modes but no blocking caller — stale
  // projections passed /sync locally and failed only in the CI unit job (the
  // exact late-failure class v1.10.0 exists to kill).
  {
    staleTarget: "app/web-next/lib/spec-activities.generated.ts + mcp/co-newbiz/stage-guides.generated.ts",
    generator: "scripts/co-newbiz/generate-spec-activities.ts",
    refresh: "bun scripts/co-newbiz/generate-spec-activities.ts",
    sources: "process/flow.spec.yaml",
  },
  {
    staleTarget: "docs/process-flow.md",
    generator: "scripts/co-newbiz/generate-process-flow.ts",
    refresh: "bun scripts/co-newbiz/generate-process-flow.ts",
    sources: "process/flow.spec.yaml",
  },
  // v1.13.0 (F-19): the prompt registry's only net was the deep-equality unit
  // test (CI-unit only) — a prompts.json edit that skipped regeneration passed
  // /sync locally and failed late. The script's --check is new in v2.2.0;
  // equality is additionally pinned by
  // tests/unit/prompt-registry-projection.test.ts.
  {
    staleTarget: "app/web-next/lib/prompts.generated.ts",
    generator: "scripts/co-newbiz/generate-prompt-registry.ts",
    refresh: "bun scripts/co-newbiz/generate-prompt-registry.ts",
    sources: "app/web-next/prompts/prompts.json",
  },
];

function runProjectionDriftGate(): void {
  const stale: string[] = [];
  const fresh: string[] = [];
  for (const g of PROJECTION_GENERATORS) {
    if (!existsSync(join(ROOT, g.generator))) {
      console.log(
        `  – Generated projection drift: ${g.generator} not present — ${g.staleTarget} check skipped (non-web context)`,
      );
      continue;
    }
    const proc = Bun.spawnSync(["bun", g.generator, "--check"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) {
      const out = new TextDecoder().decode(proc.stdout).trim();
      const err = new TextDecoder().decode(proc.stderr).trim();
      stale.push(
        [
          `${g.staleTarget} drifted from ${g.sources}`,
          ...(out ? [out] : []),
          ...(err ? [err] : []),
          `refresh with: ${g.refresh}, review, and commit`,
        ].join("\n        "),
      );
    } else {
      fresh.push(`${g.staleTarget} matches ${g.sources}`);
    }
  }
  if (stale.length > 0) {
    failed = true;
    console.error(
      `  ✗ Generated projection drift detected (${stale.length}/${PROJECTION_GENERATORS.length} generators stale):`,
    );
    for (const s of stale) console.error(`      - ${s}`);
  } else if (fresh.length === PROJECTION_GENERATORS.length) {
    console.log(`  ✓ Generated projection drift: all ${PROJECTION_GENERATORS.length} projections fresh`);
    for (const f of fresh) console.log(`      ✓ ${f}`);
  }
}

runProjectionDriftGate();

/**
 * ADR-0070 server-boundary gate (v1.11.0, DEC-20261122-01). The lint exits
 * non-zero on any violation (Rule 1 absolute; Rule 2 allowlist mode) — same
 * subprocess pattern as the route-audit scan: missing script = non-web
 * context, skip with a visible note, never silently.
 */
function runServerBoundaryGate(): void {
  const lintPath = join(ROOT, "scripts", "co-newbiz", "lint-server-boundary.ts");
  if (!existsSync(lintPath)) {
    console.log("  – ADR-0070 server-boundary gate skipped: lint-server-boundary.ts not present (non-web context)");
    return;
  }
  const proc = Bun.spawnSync(["bun", lintPath], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    failed = true;
    console.error("  ✗ ADR-0070 server-boundary gate failed:");
    const out = new TextDecoder().decode(proc.stdout);
    const err = new TextDecoder().decode(proc.stderr);
    if (out) console.error(out);
    if (err) console.error(err);
    console.error(
      "      remediation: move the data access behind app/api/**, or record a DEC before touching the allowlist (docs/decisions/DEC-20261122-01.md)",
    );
  } else {
    const out = new TextDecoder().decode(proc.stdout).trim();
    console.log(`  ✓ ADR-0070 server-boundary gate: ${out || "0 violations"}`);
  }
}

runServerBoundaryGate();

/**
 * WCAG AA contrast gate (v1.12.0, review F-16 / DEC-20261122-02). The
 * SCRIPTS.md row claimed "CI-wired" but nothing invoked contrast-check.ts —
 * a styles.css token regression below 4.5:1 would land silently. Same
 * subprocess pattern as the server-boundary gate: the script is read-only
 * (--check is accepted for gate uniformity; default mode is already the
 * check), exits non-zero on any enforced pair below 4.5:1, and a missing
 * script means a non-web context — skip with a visible note, never silently.
 */
function runContrastGate(): void {
  const scriptPath = join(ROOT, "scripts", "co-newbiz", "contrast-check.ts");
  if (!existsSync(scriptPath)) {
    console.log("  – WCAG AA contrast gate skipped: contrast-check.ts not present (non-web context)");
    return;
  }
  const proc = Bun.spawnSync(["bun", scriptPath, "--check"], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    failed = true;
    console.error("  ✗ WCAG AA contrast gate failed:");
    const out = new TextDecoder().decode(proc.stdout);
    const err = new TextDecoder().decode(proc.stderr);
    if (out) console.error(out);
    if (err) console.error(err);
    console.error(
      "      remediation: fix the failing token pair in app/web-next/app/styles.css (ENFORCED pairs must reach 4.5:1 in both themes) — never remove a pair to go green",
    );
  } else {
    const out = new TextDecoder().decode(proc.stdout).trim();
    console.log(`  ✓ WCAG AA contrast gate: ${out.split("\n").pop() || "all enforced pairs >= 4.5:1"}`);
  }
}

runContrastGate();

/**
 * Onyx 3.0 design-lint gate (v1.12.0, review F-18 / DEC-20261122-02). The
 * variant's real design scanner (scripts/co-newbiz/design-lint.ts — hardcoded
 * colors, onInput, nested <main>, icon-only buttons, font floors, list-table
 * standard) previously had no automated caller beyond the manual
 * `bun run design:lint` alias. audit.ts's core design-lint gate was NOT
 * activated via a variant.json designLint override: its engine
 * (scripts/design-lint.ts --dir over app/web-next roots) exits 1 with 197
 * pre-existing should-be-token findings today, so enabling it fail-closed
 * would halt every audit — the posture is recorded in DEC-20261122-02 and the
 * token burn-down is a separate design-system wave (ruling of record:
 * DEC-20261123-02 — category mapping, transforms, exception list; the
 * variant.json designLint override is the post-burn-down activation step).
 * Same subprocess pattern;
 * missing script = non-web context, skip with a visible note.
 */
function runDesignLintGate(): void {
  const scriptPath = join(ROOT, "scripts", "co-newbiz", "design-lint.ts");
  if (!existsSync(scriptPath)) {
    console.log("  – Onyx design-lint gate skipped: co-newbiz/design-lint.ts not present (non-web context)");
    return;
  }
  const proc = Bun.spawnSync(["bun", scriptPath], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    failed = true;
    console.error("  ✗ Onyx design-lint gate failed:");
    const out = new TextDecoder().decode(proc.stdout);
    const err = new TextDecoder().decode(proc.stderr);
    if (out) console.error(out);
    if (err) console.error(err);
    console.error(
      "      remediation: fix the violations (CSS variables from styles.css, onChange over onInput, design classes on buttons, 14px font floor) — docs/design-system/design-guide.md",
    );
  } else {
    const out = new TextDecoder().decode(proc.stdout).trim();
    console.log(`  ✓ Onyx design-lint gate: ${out || "no violations"}`);
  }
}

runDesignLintGate();

/**
 * ADR-index completeness gate (v1.13.0, review F-7 / DEC-20261123-01). Every
 * docs/adr/NNNN-*.md must have a [NNNN] row in docs/adr/README.md. The index
 * is the ADR navigation surface, and it rotted invisibly: the 2026-11-22
 * review found 23 of 206 ADRs missing from it, including amendment targets of
 * indexed ADRs (ADR-0114←ADR-0191, ADR-0154←ADR-0203). The backfill closed
 * the gap at 205/205; this gate proves it stays true. In-process check (the
 * data is two static files — a subprocess would be ceremony). Missing dir =
 * non-web context, skip with a visible note.
 */
function runAdrIndexGate(): void {
  const adrDir = join(ROOT, "docs", "adr");
  const readmePath = join(adrDir, "README.md");
  if (!existsSync(readmePath)) {
    console.log("  – ADR-index completeness gate skipped: docs/adr/README.md not present (non-web context)");
    return;
  }
  const readme = readFileSync(readmePath, "utf8");
  const adrFiles = readdirSync(adrDir, { withFileTypes: true })
    .filter((e) => e.isFile() && /^\d{4}-.*\.md$/.test(e.name))
    .map((e) => e.name);
  const missing = adrFiles.filter((f) => !readme.includes(`[${f.slice(0, 4)}]`)).sort();
  if (missing.length > 0) {
    failed = true;
    console.error(`  ✗ ADR-index completeness gate failed (${missing.length} of ${adrFiles.length} ADRs unindexed):`);
    for (const f of missing) console.error(`      - docs/adr/${f} has no [${f.slice(0, 4)}] row in docs/adr/README.md`);
    console.error("      remediation: add the [NNNN](NNNN-….md) rows to docs/adr/README.md");
  } else {
    console.log(
      `  ✓ ADR-index completeness gate: ${adrFiles.length}/${adrFiles.length} ADR files indexed in README.md`,
    );
  }
}

runAdrIndexGate();

/**
 * Design-registry completeness gate (v1.13.0, review F-8 / DEC-20261123-01).
 * Every docs/designs/*.md must be registered in docs/specs/registry.json —
 * landing-time registration is a manual PM step (DEC-20261113-04/06) with no
 * machine check, and 25 designs had drifted out before the 2026-11-22 backfill
 * (incl. designs of record for Accepted ADRs ADR-0168…0172, ADR-0193). In-gate
 * allowlist: EXACTLY the three standing non-design documents (quality-review
 * minutes, flow-console UX benchmark, implementation matrix); the mockups/
 * directory is not a design document and is exempt by construction (only
 * top-level *.md files are scanned). Growing the allowlist requires a recorded
 * DEC; allowlist entries whose file disappeared are reported as rot.
 */
const DESIGN_REGISTRY_ALLOWLIST: ReadonlySet<string> = new Set([
  "2026-09-12-quality-review-minutes.md",
  "2026-10-24-flow-console-ux-benchmark.md",
  "2026-09-12-implementation-matrix.md",
]);

function runDesignRegistryGate(): void {
  const designsDir = join(ROOT, "docs", "designs");
  const registryPath = join(ROOT, "docs", "specs", "registry.json");
  if (!existsSync(designsDir) || !existsSync(registryPath)) {
    console.log("  – Design-registry completeness gate skipped: docs/designs/ or docs/specs/registry.json not present");
    return;
  }
  const designFiles = readdirSync(designsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name);
  const registered = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      if (node.endsWith(".md")) registered.add(node.split("/").pop() ?? node);
      return;
    }
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
      return;
    }
    if (node && typeof node === "object") {
      for (const v of Object.values(node as Record<string, unknown>)) walk(v);
    }
  };
  walk(JSON.parse(readFileSync(registryPath, "utf8")));
  const unregistered = designFiles.filter((f) => !registered.has(f) && !DESIGN_REGISTRY_ALLOWLIST.has(f)).sort();
  const staleAllowlist = [...DESIGN_REGISTRY_ALLOWLIST].filter((f) => !designFiles.includes(f)).sort();
  if (unregistered.length > 0 || staleAllowlist.length > 0) {
    failed = true;
    if (unregistered.length > 0) {
      console.error(
        `  ✗ Design-registry completeness gate failed (${unregistered.length} of ${designFiles.length} design docs unregistered):`,
      );
      for (const f of unregistered)
        console.error(`      - docs/designs/${f} is not registered in docs/specs/registry.json`);
      console.error(
        "      remediation: bun scripts/spec-register.ts --file docs/designs/<name>.md --source manual --status implemented",
      );
    }
    if (staleAllowlist.length > 0) {
      console.error(`  ✗ Design-registry allowlist rot (${staleAllowlist.length} entries point at no file):`);
      for (const f of staleAllowlist)
        console.error(`      - docs/designs/${f} no longer exists — prune the allowlist via a DEC`);
    }
  } else {
    console.log(
      `  ✓ Design-registry completeness gate: ${designFiles.length} design docs = ${designFiles.length - DESIGN_REGISTRY_ALLOWLIST.size} registered + ${DESIGN_REGISTRY_ALLOWLIST.size} allowlisted`,
    );
  }
}

runDesignRegistryGate();

/**
 * Skill-lifecycle completeness gate (v1.13.0, review F-10 / DEC-20261123-01).
 * Every active skill — a Workspace Skills row in skills/SKILLS.md — must have
 * a lifecycle record at docs/lifecycle/skills/<name>.md. The record
 * generator's own gate only hooks common/template-delivered skills, so the
 * variant-own Wave 5.8 pipeline cohort (S3-S12 spine) drifted record-less
 * until the 2026-11-22 backfill closed it at 109/109; this gate keeps it
 * closed. Variant-Exclusive rows are workspace-shared skills tracked by the
 * workspace's own lifecycle records — out of scope, matching the finding's
 * 109/109 denominator. Reuses the registry parser of the SKILLS.md parity
 * gate above.
 */
function runSkillLifecycleGate(): void {
  const recordsDir = join(ROOT, "docs", "lifecycle", "skills");
  if (!existsSync(recordsDir)) {
    console.log("  – Skill-lifecycle completeness gate skipped: docs/lifecycle/skills/ not present (non-web context)");
    return;
  }
  const content = readFileSync(join(ROOT, "skills", "SKILLS.md"), "utf8");
  const activeSkills = sectionRows(content.split("\n"), "### Workspace Skills");
  if (activeSkills.length === 0) {
    failed = true;
    console.error(
      "  ✗ Skill-lifecycle completeness gate failed: the Workspace Skills table parsed to zero rows (registry structure changed?)",
    );
    return;
  }
  const haveRecords = new Set(
    readdirSync(recordsDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name.replace(/\.md$/, "")),
  );
  const missing = activeSkills.filter((n) => !haveRecords.has(n)).sort();
  if (missing.length > 0) {
    failed = true;
    console.error(
      `  ✗ Skill-lifecycle completeness gate failed (${missing.length} of ${activeSkills.length} active skills without a lifecycle record):`,
    );
    for (const n of missing) console.error(`      - docs/lifecycle/skills/${n}.md missing`);
    console.error(
      "      remediation: bun scripts/generate-skill-lifecycle-records.ts --project . --write, review, and commit",
    );
  } else {
    console.log(
      `  ✓ Skill-lifecycle completeness gate: ${activeSkills.length}/${activeSkills.length} active skills have lifecycle records`,
    );
  }
}

runSkillLifecycleGate();

// ADR-0187 P2-P4: BLOCKING_CHECKS (all eight checks) fail the audit.
const ssot = runAll();
const ssotCounts = summarize(ssot);
const ssotBlocking = ssot.filter(isBlocking);
const fmt = (ids: readonly string[]) => ids.map((c) => `${c}=${ssotCounts[c as keyof typeof ssotCounts]}`).join(", ");
if (ssotBlocking.length > 0) {
  console.log(
    `  ❌ Process SSOT validators (blocking, ADR-0187 P2-P4): ${ssotBlocking.length} finding(s) — ${fmt([...BLOCKING_CHECKS])}; details: bun run process:ssot-check`,
  );
  failed = true;
} else console.log(`  ✓ Process SSOT validators (blocking, ADR-0187 P2-P4): 0 findings — ${fmt([...BLOCKING_CHECKS])}`);
const ssotWarn = CHECK_IDS.filter((c) => !BLOCKING_CHECKS.has(c));
if (ssot.length > ssotBlocking.length)
  console.log(
    `  ⚠ [WARN] Process SSOT validators (report-only): ${ssot.length - ssotBlocking.length} finding(s) — ${fmt(ssotWarn)}`,
  );

process.exit(failed ? 1 : 0);
