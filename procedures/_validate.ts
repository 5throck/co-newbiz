#!/usr/bin/env bun
// @version 1.0.0
/**
 * Procedure Schema Validator — co-newbiz
 *
 * Validates every procedures/**\/schema.yaml against the contract in
 * procedures/_template/README.md, and enforces the procedure/skill authority
 * split (design v1.0 section 6.8): a skill file must not restate gate steps
 * that belong in a procedure.
 *
 * Usage:
 *   bun procedures/_validate.ts
 *   bun procedures/_validate.ts --verbose
 */

import * as yaml from "js-yaml";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";

const ROOT = resolve(import.meta.dirname);
const PROJECT_ROOT = resolve(ROOT, "..");
const SKILLS_DIR = join(PROJECT_ROOT, "skills");
const VERBOSE = process.argv.includes("--verbose");

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

async function main() {
  const files = await findSchemaFiles(ROOT);
  if (files.length === 0) {
    console.error("No procedures/**/schema.yaml files found.");
    process.exit(1);
  }

  const allIssues: Issue[] = [];
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
  }

  allIssues.push(...(await lintSkillsForGateSteps()));

  const errors = allIssues.filter((i) => i.severity === "error");
  const warnings = allIssues.filter((i) => i.severity === "warn");

  if (VERBOSE || errors.length > 0) {
    for (const i of allIssues) {
      console.log(`[${i.severity === "error" ? "ERROR" : "WARN"}] ${i.file} — ${i.message}`);
    }
  }

  console.log(`\nProcedure validation: ${files.length} procedure(s), ${errors.length} error(s), ${warnings.length} warning(s).`);
  if (errors.length > 0) {
    console.error("❌ Procedure validation failed.");
    process.exit(1);
  }
  console.log("✅ Procedure validation passed.");
}

main();
