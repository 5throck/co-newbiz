#!/usr/bin/env bun
// @version 1.1.0
/**
 * Procedure Schema Validator — co-newbiz
 *
 * Validates every procedures/**\/schema.yaml against the contract in
 * procedures/_template/README.md, and enforces the procedure/skill authority
 * split (design v1.0 section 6.8): a skill file must not restate gate steps
 * that belong in a procedure.
 *
 * Since 1.1.0 it also runs a cross-file pass (walkAllSteps): every shared
 * procedure is resolved through proc-resolve.ts against every applicable
 * region/entity layer combination, and every merged step's
 * agent_key/skill_key is checked for referential integrity against the real
 * agents/ and skills/ trees. Warn-level only — the skills tree may
 * legitimately not have every referenced skill yet. Warnings are now ALWAYS
 * printed (meeting 2026-08-22 finding F11 — they were previously swallowed
 * unless --verbose); --verbose is still accepted as a no-op for backwards
 * compatibility. Exit code is unchanged: 1 only on errors, never on warnings.
 *
 * Usage:
 *   bun procedures/_validate.ts
 *   bun procedures/_validate.ts --verbose   (no-op; warnings always print)
 */

import * as yaml from "js-yaml";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { resolveProcedure } from "../scripts/co-newbiz/proc-resolve.ts";

const ROOT = resolve(import.meta.dirname);
const PROJECT_ROOT = resolve(ROOT, "..");
const SKILLS_DIR = join(PROJECT_ROOT, "skills");

interface Issue {
  file: string;
  message: string;
  severity: "error" | "warn";
}

async function findSchemaFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "_template") continue; // template is a reference, not a real procedure
      out.push(...(await findSchemaFiles(full)));
    } else if (entry.isFile() && entry.name === "schema.yaml") {
      out.push(full);
    }
  }
  return out;
}

function validateSchema(file: string, doc: unknown): Issue[] {
  const issues: Issue[] = [];
  if (typeof doc !== "object" || doc === null) {
    return [{ file, message: "Document is not a YAML mapping", severity: "error" }];
  }
  const p = doc as Record<string, unknown>;

  for (const field of ["procedure_id", "scope", "title", "status", "applicability", "owner_agent", "legal_basis"]) {
    if (p[field] === undefined) {
      issues.push({ file, message: `Missing required field '${field}'`, severity: "error" });
    }
  }

  const scope = p.scope as string | undefined;
  if (scope && !["shared", "entity", "region", "group"].includes(scope)) {
    issues.push({ file, message: `Invalid scope '${scope}'`, severity: "error" });
  }

  const hasSteps = Array.isArray(p.steps) && (p.steps as unknown[]).length > 0;
  const hasReferences = Array.isArray(p.references) && (p.references as unknown[]).length > 0;

  if (scope === "shared") {
    if (!hasSteps) {
      issues.push({ file, message: "scope=shared procedure must declare 'steps' directly", severity: "error" });
    }
  } else if (scope === "entity" || scope === "region") {
    if (!hasReferences && !hasSteps) {
      issues.push({
        file,
        message: "scope=entity/region procedure must declare either 'references' (preferred) or its own 'steps'",
        severity: "error",
      });
    }
    // Rule: an entity/region procedure with `overrides` must also have `references` —
    // overrides with no reference target is meaningless.
    if (p.overrides !== undefined && !hasReferences) {
      issues.push({ file, message: "'overrides' present without 'references' — nothing to override", severity: "error" });
    }
  }

  if (Array.isArray(p.legal_basis) && p.legal_basis.length === 0) {
    issues.push({ file, message: "'legal_basis' is empty — at least one real reference is required", severity: "error" });
  }

  if (Array.isArray(p.steps)) {
    for (const [i, step] of (p.steps as unknown[]).entries()) {
      if (typeof step !== "object" || step === null) continue;
      const s = step as Record<string, unknown>;
      for (const f of ["agent_key", "skill_key", "output_type"]) {
        if (typeof s[f] !== "string" || (s[f] as string).trim() === "" || s[f] === "TODO") {
          issues.push({ file, message: `steps[${i}].${f} is missing or a placeholder`, severity: "warn" });
        }
      }
    }
  }

  return issues;
}

/**
 * Lint check for the procedure/skill authority split (design section 6.8).
 * A skill file restating numbered gate steps alongside approver/gate keywords
 * is a governance violation, not a style issue.
 */
async function lintSkillsForGateSteps(): Promise<Issue[]> {
  const issues: Issue[] = [];
  let skillFiles: string[] = [];
  try {
    skillFiles = await findSkillFiles(SKILLS_DIR);
  } catch {
    return issues; // skills/ may not exist yet this early in Stage 2
  }

  const numberedStepPattern = /^\s*\d+\.\s+.+/m;
  const gateKeywordPattern = /\b(approver|gate|Entity IC|Group IC|Screening|Pre-FS)\b/i;

  for (const file of skillFiles) {
    const content = await readFile(file, "utf-8");
    if (numberedStepPattern.test(content) && gateKeywordPattern.test(content)) {
      issues.push({
        file,
        message: "Skill file contains numbered steps alongside gate/approver keywords — verify it references a procedure key rather than restating gate steps (design section 6.8)",
        severity: "warn",
      });
    }
  }
  return issues;
}

async function findSkillFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await findSkillFiles(full)));
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      out.push(full);
    }
  }
  return out;
}

/** Shared procedures = directories under procedures/_shared/ holding a schema.yaml. */
async function discoverSharedProcedures(): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(ROOT, "_shared"), { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(ROOT, "_shared", entry.name, "schema.yaml"))) {
      out.push(entry.name);
    }
  }
  return out.sort();
}

/** Region/entity layer codes, discovered dynamically — never hardcode "EU"/"ent-a". */
async function discoverLayerCodes(kind: "regions" | "entities"): Promise<string[]> {
  try {
    return (await readdir(join(ROOT, kind), { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return []; // procedures/regions/ or procedures/entities/ does not exist yet
  }
}

interface LayerCombo {
  label: string; // e.g. "shared+region:EU+entity:ent-a"
  opts: { region?: string; entity?: string };
}

/**
 * The base shared-only combo plus one combo per non-empty subset of the
 * layers that actually have an override doc for this procedure. For a
 * procedure with both an EU and an ent-a override doc that yields 4
 * resolutions: shared, shared+region:EU, shared+entity:ent-a,
 * shared+region:EU+entity:ent-a.
 */
function combosFor(name: string, regions: string[], entities: string[]): LayerCombo[] {
  const layers: { kind: "region" | "entity"; code: string }[] = [
    ...regions
      .filter((r) => existsSync(join(ROOT, "regions", r, name, "schema.yaml")))
      .map((r) => ({ kind: "region" as const, code: r })),
    ...entities
      .filter((e) => existsSync(join(ROOT, "entities", e, name, "schema.yaml")))
      .map((e) => ({ kind: "entity" as const, code: e })),
  ];
  const combos: LayerCombo[] = [{ label: "shared", opts: {} }];
  for (let mask = 1; mask < 2 ** layers.length; mask++) {
    const opts: { region?: string; entity?: string } = {};
    const parts: string[] = ["shared"];
    for (let i = 0; i < layers.length; i++) {
      if (mask & (1 << i)) {
        opts[layers[i].kind] = layers[i].code;
        parts.push(`${layers[i].kind}:${layers[i].code}`);
      }
    }
    combos.push({ label: parts.join("+"), opts });
  }
  return combos;
}

/**
 * Referential integrity for one merged (or standalone) step list. Placeholder
 * values ("TODO", empty, non-string) are skipped here — validateSchema
 * already warns about those on the raw doc, so flagging them again as
 * "file does not exist" would be a duplicate signal.
 */
function checkStepReferences(label: string, steps: unknown[]): Issue[] {
  const issues: Issue[] = [];
  for (const step of steps) {
    if (typeof step !== "object" || step === null) continue;
    const s = step as Record<string, unknown>;
    const agentKey = s.agent_key;
    if (
      typeof agentKey === "string" &&
      agentKey.trim() !== "" &&
      agentKey !== "TODO" &&
      !existsSync(join(PROJECT_ROOT, "agents", `${agentKey}.md`))
    ) {
      issues.push({
        file: label,
        message: `step ${s.id} agent_key '${agentKey}' has no agents/${agentKey}.md`,
        severity: "warn",
      });
    }
    const skillKey = s.skill_key;
    if (
      typeof skillKey === "string" &&
      skillKey.trim() !== "" &&
      skillKey !== "TODO" &&
      !existsSync(join(SKILLS_DIR, skillKey, "SKILL.md"))
    ) {
      issues.push({
        file: label,
        message: `step ${s.id} skill_key '${skillKey}' has no skills/${skillKey}/SKILL.md`,
        severity: "warn",
      });
    }
  }
  return issues;
}

/**
 * walkAllSteps — the cross-file pass (PR-0 of the 2026-08-22 RAG
 * formalization design, meeting finding F11's companion). Per-file
 * validation above checks each schema.yaml in isolation; this pass resolves
 * the MERGED step list for every shared procedure × every applicable
 * region/entity layer combination via proc-resolve.ts (which handles
 * add_steps incl. the after:0 sentinel, replace_steps, and thresholds) and
 * checks every merged step against the real agents/ and skills/ trees.
 * A resolve failure is a warn, never a crash.
 */
async function walkAllSteps(): Promise<Issue[]> {
  const issues: Issue[] = [];
  const sharedProcedures = await discoverSharedProcedures();
  const regions = await discoverLayerCodes("regions");
  const entities = await discoverLayerCodes("entities");

  for (const name of sharedProcedures) {
    for (const combo of combosFor(name, regions, entities)) {
      let steps: unknown[];
      try {
        steps = resolveProcedure(name, combo.opts).steps;
      } catch (e) {
        issues.push({
          file: `${name} @ ${combo.label}`,
          message: `resolveProcedure failed: ${(e as Error).message}`,
          severity: "warn",
        });
        continue;
      }
      issues.push(...checkStepReferences(`${name} @ ${combo.label}`, steps));
    }
  }
  return issues;
}

async function main() {
  const files = await findSchemaFiles(ROOT);
  if (files.length === 0) {
    console.error("No procedures/**/schema.yaml files found.");
    process.exit(1);
  }

  const allIssues: Issue[] = [];
  const standaloneStepDocs: { label: string; steps: unknown[] }[] = [];
  for (const file of files) {
    const raw = await readFile(file, "utf-8");
    let doc: unknown;
    try {
      doc = yaml.load(raw, { schema: yaml.JSON_SCHEMA });
    } catch (e) {
      allIssues.push({ file, message: `YAML parse error: ${(e as Error).message}`, severity: "error" });
      continue;
    }
    allIssues.push(...validateSchema(file, doc));

    // Standalone-scope docs (scope: entity/region) that declare their own
    // steps get the same referential-integrity check as merged combos.
    const p = doc as Record<string, unknown>;
    if ((p.scope === "entity" || p.scope === "region") && Array.isArray(p.steps) && p.steps.length > 0) {
      standaloneStepDocs.push({ label: `${p.procedure_id ?? file} @ standalone`, steps: p.steps });
    }
  }

  allIssues.push(...(await walkAllSteps()));
  for (const d of standaloneStepDocs) {
    allIssues.push(...checkStepReferences(d.label, d.steps));
  }

  allIssues.push(...(await lintSkillsForGateSteps()));

  const errors = allIssues.filter((i) => i.severity === "error");
  const warnings = allIssues.filter((i) => i.severity === "warn");

  // F11 fix: warnings are always printed — no VERBOSE gate, no
  // errors-present gate. Silent warnings are swallowed findings.
  for (const i of allIssues) {
    console.log(`[${i.severity === "error" ? "ERROR" : "WARN"}] ${i.file} — ${i.message}`);
  }

  console.log(`\nProcedure validation: ${files.length} procedure(s), ${errors.length} error(s), ${warnings.length} warning(s).`);
  if (errors.length > 0) {
    console.error("❌ Procedure validation failed.");
    process.exit(1);
  }
  console.log("✅ Procedure validation passed.");
}

main();
