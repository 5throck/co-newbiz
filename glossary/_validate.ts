#!/usr/bin/env bun
// @version 1.0.0
/**
 * Glossary Term Validator — co-newbiz
 *
 * Validates all glossary/*.yaml against the contract in glossary/_schema.yaml.
 *
 * Design of record: docs/designs/2026-08-19-co-newbiz-design_ko.md section 7.
 * Enforces the one rule that matters most here: a term with a definition but no
 * rationale (why_it_matters_ko) still leaves a newcomer asking "so what?" — that
 * field is mandatory, not decoration.
 *
 * Usage:
 *   bun glossary/_validate.ts
 *   bun glossary/_validate.ts --verbose
 */

import * as yaml from "js-yaml";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve, basename } from "node:path";

const GLOSSARY_DIR = resolve(import.meta.dirname);
const VERBOSE = process.argv.includes("--verbose");

const REQUIRED_FIELDS = ["ko", "en", "definition_ko", "why_it_matters_ko", "category", "owner"] as const;
const VALID_CATEGORIES = new Set(["business", "financial", "legal", "technical", "unit", "industry"]);

interface TermIssue {
  file: string;
  term: string;
  field: string;
  message: string;
  severity: "error" | "warn";
}

function validateTerm(file: string, key: string, entry: unknown): TermIssue[] {
  const issues: TermIssue[] = [];

  if (typeof entry !== "object" || entry === null) {
    issues.push({ file, term: key, field: "root", message: "Term entry is not a mapping", severity: "error" });
    return issues;
  }
  const term = entry as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    const value = term[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      issues.push({
        file,
        term: key,
        field,
        message: `Missing or empty required field '${field}'`,
        severity: "error",
      });
    }
  }

  const category = term.category;
  if (typeof category === "string" && !VALID_CATEGORIES.has(category)) {
    issues.push({
      file,
      term: key,
      field: "category",
      message: `Invalid category '${category}' — expected one of: ${[...VALID_CATEGORIES].join(", ")}`,
      severity: "error",
    });
  }

  for (const arrField of ["aliases", "related", "used_in", "exclude_phrases", "exclude_paths"]) {
    const value = term[arrField];
    if (value !== undefined && !Array.isArray(value)) {
      issues.push({
        file,
        term: key,
        field: arrField,
        message: `Field '${arrField}' must be an array when present`,
        severity: "warn",
      });
    }
  }

  return issues;
}

async function main() {
  const files = (await readdir(GLOSSARY_DIR)).filter((f) => f.endsWith(".yaml") && !f.startsWith("_"));

  if (files.length === 0) {
    console.error("No glossary/*.yaml files found (excluding _schema.yaml).");
    process.exit(1);
  }

  const allIssues: TermIssue[] = [];
  const seenTerms = new Map<string, string>(); // term key -> file it was first seen in
  let totalTerms = 0;

  for (const file of files) {
    const raw = await readFile(join(GLOSSARY_DIR, file), "utf-8");
    let doc: unknown;
    try {
      doc = yaml.load(raw, { schema: yaml.JSON_SCHEMA });
    } catch (e) {
      allIssues.push({ file, term: "(parse)", field: "root", message: `YAML parse error: ${(e as Error).message}`, severity: "error" });
      continue;
    }

    if (typeof doc !== "object" || doc === null || !("terms" in doc)) {
      allIssues.push({ file, term: "(root)", field: "terms", message: "Missing top-level 'terms' mapping", severity: "error" });
      continue;
    }

    const terms = (doc as Record<string, unknown>).terms;
    if (typeof terms !== "object" || terms === null) {
      allIssues.push({ file, term: "(root)", field: "terms", message: "'terms' must be a mapping", severity: "error" });
      continue;
    }

    for (const [key, entry] of Object.entries(terms as Record<string, unknown>)) {
      totalTerms++;
      allIssues.push(...validateTerm(file, key, entry));

      const dupSource = seenTerms.get(key);
      if (dupSource && dupSource !== file) {
        allIssues.push({
          file,
          term: key,
          field: "(key)",
          message: `Duplicate term key also defined in ${dupSource}`,
          severity: "error",
        });
      } else {
        seenTerms.set(key, file);
      }
    }
  }

  const errors = allIssues.filter((i) => i.severity === "error");
  const warnings = allIssues.filter((i) => i.severity === "warn");

  if (VERBOSE || errors.length > 0) {
    for (const i of allIssues) {
      const tag = i.severity === "error" ? "ERROR" : "WARN";
      console.log(`[${tag}] ${i.file} :: ${i.term} :: ${i.field} — ${i.message}`);
    }
  }

  console.log(`\nGlossary validation: ${files.length} file(s), ${totalTerms} term(s), ${errors.length} error(s), ${warnings.length} warning(s).`);

  if (errors.length > 0) {
    console.error("❌ Glossary validation failed.");
    process.exit(1);
  }
  console.log("✅ Glossary validation passed.");
}

main();
