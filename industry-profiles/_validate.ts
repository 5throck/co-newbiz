#!/usr/bin/env bun
// @version 1.1.0
/**
 * Industry Profile Validator — co-newbiz
 *
 * Validates every industry-profiles/<KSIC-or-key>.yaml against
 * _schema.yaml (design v1.0 section 1-7, agents/industry-lead.md).
 * Enforces the same provenance rule as region-profiles/_validate.ts:
 * source/verified_on/maintainer are mandatory on every section, and an
 * unsourced field is rejected rather than silently accepted — an
 * unsourced placeholder looks authoritative, which is worse than a
 * missing file.
 *
 * Usage:
 *   bun industry-profiles/_validate.ts
 *   bun industry-profiles/_validate.ts --verbose
 */

import * as yaml from "js-yaml";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);
const VERBOSE = process.argv.includes("--verbose");

const REQUIRED_TOP_LEVEL = [
  "code",
  "name_ko",
  "value_chain_structure",
  "cycle_position_indicators",
  "regulatory_landscape",
  "technology_transitions",
];

const REQUIRED_SOURCED_SECTIONS = REQUIRED_TOP_LEVEL.filter(
  (k) => !["code", "name_ko"].includes(k)
);

// Optional sections are skipped when absent and held to the same provenance
// rules when present (see optional_top_level in _schema.yaml).
const OPTIONAL_SOURCED_SECTIONS = ["revenue_quality_norms"];

const SOURCED_SECTIONS = [...REQUIRED_SOURCED_SECTIONS, ...OPTIONAL_SOURCED_SECTIONS];

interface Issue {
  file: string;
  message: string;
  severity: "error" | "warn";
}

async function findProfileFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".yaml") && !e.name.startsWith("_"))
    .map((e) => join(dir, e.name));
}

function validateProfile(file: string, doc: unknown): Issue[] {
  const issues: Issue[] = [];
  if (typeof doc !== "object" || doc === null) {
    return [{ file, message: "Document is not a YAML mapping", severity: "error" }];
  }
  const p = doc as Record<string, unknown>;

  for (const field of REQUIRED_TOP_LEVEL) {
    if (p[field] === undefined) {
      issues.push({ file, message: `Missing required top-level key '${field}'`, severity: "error" });
    }
  }

  for (const section of SOURCED_SECTIONS) {
    const val = p[section];
    if (val === undefined) continue; // already reported above
    if (typeof val !== "object" || val === null || Array.isArray(val)) {
      issues.push({ file, message: `Section '${section}' must be a mapping with source/verified_on/maintainer/data`, severity: "error" });
      continue;
    }
    const s = val as Record<string, unknown>;
    for (const f of ["source", "verified_on", "maintainer"]) {
      if (typeof s[f] !== "string" || (s[f] as string).trim() === "") {
        issues.push({ file, message: `Section '${section}' is missing required provenance field '${f}'`, severity: "error" });
      }
    }
    if (typeof s.data !== "object" || s.data === null || Object.keys(s.data as object).length === 0) {
      issues.push({ file, message: `Section '${section}'.data is missing or empty — an unsourced placeholder is not allowed`, severity: "error" });
    }
    if (typeof s.verified_on === "string") {
      const d = new Date(s.verified_on);
      if (Number.isNaN(d.getTime())) {
        issues.push({ file, message: `Section '${section}'.verified_on is not a valid ISO-8601 date`, severity: "error" });
      } else if (d.getTime() > Date.now()) {
        issues.push({ file, message: `Section '${section}'.verified_on is in the future`, severity: "error" });
      }
    }
  }

  return issues;
}

async function main() {
  const files = await findProfileFiles(ROOT);
  if (files.length === 0) {
    console.error("No industry-profiles/*.yaml files found.");
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
    allIssues.push(...validateProfile(file, doc));
  }

  const errors = allIssues.filter((i) => i.severity === "error");
  const warnings = allIssues.filter((i) => i.severity === "warn");

  if (VERBOSE || errors.length > 0) {
    for (const i of allIssues) {
      console.log(`[${i.severity === "error" ? "ERROR" : "WARN"}] ${i.file} — ${i.message}`);
    }
  }

  console.log(`\nIndustry profile validation: ${files.length} profile(s), ${errors.length} error(s), ${warnings.length} warning(s).`);
  if (errors.length > 0) {
    console.error("❌ Industry profile validation failed.");
    process.exit(1);
  }
  console.log("✅ Industry profile validation passed.");
}

main();
