#!/usr/bin/env bun
// @version 1.0.0
/**
 * Checklist Validator — co-newbiz
 *
 * Validates all checklists/*.yaml structure at authoring time. procedures/ has
 * _validate.ts and glossary/ has _validate.ts; until now the checklist layer
 * — the layer that carries the no-waiver Brown Field core — had no authoring
 * gate at all, relying only on runtime flags in db/lib/compliance.ts.
 *
 * What is an ERROR:
 *   - missing/empty id, text, or mandatory on any item
 *   - non-boolean mandatory / waiver_eligible
 *   - duplicate item ids within one file
 *   - item ids not matching the <prefix>-<number> convention
 *   - waiver_eligible: false on a RECOMMENDED item (a recommended item never
 *     blocks, so a no-waiver flag on it is a contradiction)
 *
 * What is a WARN (deliberately not an error yet):
 *   - missing waiver_eligible: the engine defaults undeclared mandatory items
 *     to waivable (db/lib/compliance.ts), so every gap here is silent policy.
 *     Closing each gap needs an explicit per-item judgment, so this validator
 *     surfaces them without failing the build. Once all items declare the
 *     field, flip this severity to "error".
 *   - legal_basis entries pointing at repo paths that do not exist
 *
 * Usage:
 *   bun checklists/_validate.ts
 *   bun checklists/_validate.ts --verbose
 */

import * as yaml from "js-yaml";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const CHECKLIST_DIR = resolve(import.meta.dirname);
const REPO_ROOT = resolve(CHECKLIST_DIR, "..");
const VERBOSE = process.argv.includes("--verbose");

const REQUIRED_META = ["governance_doc_id", "layer", "title", "owner_agent", "version"] as const;

interface Issue {
  file: string;
  item: string;
  message: string;
  severity: "error" | "warn";
}

interface ItemShape {
  id?: unknown;
  text?: unknown;
  mandatory?: unknown;
  waiver_eligible?: unknown;
}

/** Repo-relative doc references in legal_basis are checked for existence; free-text citations ("Meeting M5") are not. */
function looksLikeRepoPath(entry: string): boolean {
  return /[\\/]/.test(entry) && /\.(md|yaml|yml)$/i.test(entry.trim());
}

function validateItem(file: string, item: ItemShape, seenIds: Set<string>): Issue[] {
  const issues: Issue[] = [];
  const label = typeof item.id === "string" ? item.id : "(missing id)";

  if (typeof item.id !== "string" || item.id.trim().length === 0) {
    issues.push({ file, item: label, message: "Missing or empty required field 'id'", severity: "error" });
  } else {
    if (!/^[a-z][a-z0-9_]*-\d+$/.test(item.id)) {
      issues.push({ file, item: label, message: `Id '${item.id}' does not match the <prefix>-<number> convention`, severity: "error" });
    }
    if (seenIds.has(item.id)) {
      issues.push({ file, item: label, message: "Duplicate item id within this checklist", severity: "error" });
    }
    seenIds.add(item.id);
  }

  if (typeof item.text !== "string" || item.text.trim().length === 0) {
    issues.push({ file, item: label, message: "Missing or empty required field 'text'", severity: "error" });
  }

  if (typeof item.mandatory !== "boolean") {
    issues.push({ file, item: label, message: "'mandatory' must be a boolean — the enforceability layer depends on it", severity: "error" });
  }

  if (item.waiver_eligible === undefined) {
    issues.push({
      file,
      item: label,
      message: "Missing 'waiver_eligible' — undeclared mandatory items default to WAIVABLE at runtime (db/lib/compliance.ts); declare it explicitly",
      severity: "warn",
    });
  } else if (typeof item.waiver_eligible !== "boolean") {
    issues.push({ file, item: label, message: "'waiver_eligible' must be a boolean when present", severity: "error" });
  } else if (item.waiver_eligible === false && item.mandatory === false) {
    issues.push({
      file,
      item: label,
      message: "waiver_eligible=false on a recommended item is a contradiction — recommended items never block, so there is nothing to waive",
      severity: "error",
    });
  }

  return issues;
}

async function main() {
  const files = (await readdir(CHECKLIST_DIR)).filter((f) => f.endsWith(".yaml") && !f.startsWith("_"));

  if (files.length === 0) {
    console.error("No checklists/*.yaml files found.");
    process.exit(1);
  }

  const allIssues: Issue[] = [];
  let totalItems = 0;

  for (const file of files) {
    const raw = await readFile(join(CHECKLIST_DIR, file), "utf-8");
    let doc: unknown;
    try {
      doc = yaml.load(raw, { schema: yaml.JSON_SCHEMA });
    } catch (e) {
      allIssues.push({ file, item: "(parse)", message: `YAML parse error: ${(e as Error).message}`, severity: "error" });
      continue;
    }

    if (typeof doc !== "object" || doc === null) {
      allIssues.push({ file, item: "(root)", message: "Checklist root is not a mapping", severity: "error" });
      continue;
    }
    const root = doc as Record<string, unknown>;

    for (const field of REQUIRED_META) {
      const value = root[field];
      if (typeof value !== "string" || value.trim().length === 0) {
        allIssues.push({ file, item: "(meta)", message: `Missing or empty required field '${field}'`, severity: "error" });
      }
    }

    if (!Array.isArray(root.items)) {
      allIssues.push({ file, item: "(items)", message: "Missing or non-array top-level 'items'", severity: "error" });
      continue;
    }

    const seenIds = new Set<string>();
    for (const entry of root.items) {
      totalItems++;
      if (typeof entry !== "object" || entry === null) {
        allIssues.push({ file, item: `(item #${totalItems})`, message: "Item is not a mapping", severity: "error" });
        continue;
      }
      allIssues.push(...validateItem(file, entry as ItemShape, seenIds));
    }

    const basis = root.legal_basis;
    if (basis !== undefined && !Array.isArray(basis)) {
      allIssues.push({ file, item: "(legal_basis)", message: "'legal_basis' must be an array when present", severity: "error" });
    } else if (Array.isArray(basis)) {
      for (const entry of basis) {
        if (typeof entry === "string" && looksLikeRepoPath(entry)) {
          const target = resolve(REPO_ROOT, entry.trim());
          if (!existsSync(target)) {
            allIssues.push({
              file,
              item: "(legal_basis)",
              message: `Referenced path '${entry.trim()}' does not exist in the repo (forward reference? keep, but track it)`,
              severity: "warn",
            });
          }
        }
      }
    }
  }

  const errors = allIssues.filter((i) => i.severity === "error");
  const warnings = allIssues.filter((i) => i.severity === "warn");

  if (VERBOSE || errors.length > 0) {
    for (const i of allIssues) {
      const tag = i.severity === "error" ? "ERROR" : "WARN";
      console.log(`[${tag}] ${i.file} :: ${i.item} — ${i.message}`);
    }
  } else if (warnings.length > 0) {
    console.log(`[WARN] ${warnings.length} checklist item(s) do not declare 'waiver_eligible' — run with --verbose to list them.`);
  }

  console.log(`\nChecklist validation: ${files.length} file(s), ${totalItems} item(s), ${errors.length} error(s), ${warnings.length} warning(s).`);

  if (errors.length > 0) {
    console.error("❌ Checklist validation failed.");
    process.exit(1);
  }
  console.log("✅ Checklist validation passed.");
}

main();
