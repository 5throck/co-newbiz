#!/usr/bin/env bun
// @version 1.0.0
/**
 * generate-committee-registry.ts — procedures/_committees.yaml →
 * app/web-next/lib/committee-registry.generated.ts generator (review F-3).
 *
 * The committee projection (the static CommitteeDef registry behind the
 * committee-session engine and the Next/Turbopack server bundle) previously
 * had no generator: its own header said "update procedures/_committees.yaml
 * and regenerate this projection", but nothing could regenerate it, so the
 * ADR-0202 description rewording (05424622) landed in the YAML only and the
 * projection silently kept the pre-amendment wording. This script is the
 * missing generator: it emits the projection from the YAML SSOT and its
 * --check mode (wired into the audit-variant PROJECTION_GENERATORS gate,
 * v1.12.0) fails on drift. Committee composition equality is additionally
 * pinned by tests/unit/committee-registry-projection.test.ts (generated-vs-
 * YAML equality) on top of the structural validator in
 * tests/unit/committee-registry.test.ts.
 *
 * Byte-stability: the serializer is deterministic — YAML document order is
 * preserved (object insertion order), strings are JSON-quoted, and only
 * present optional member fields (seat / applies_when / veto_dissent) are
 * emitted. Output is stable across runs and platforms (LF, no trailing
 * whitespace).
 *
 * Usage: bun scripts/co-newbiz/generate-committee-registry.ts [--check]
 *   --check : exit 1 if the generated file would change (audit-gate mode).
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as yaml from "js-yaml";

const YAML_PATH = "procedures/_committees.yaml";
const OUT_PATH = "app/web-next/lib/committee-registry.generated.ts";

const HEADER = `// Generated from procedures/_committees.yaml for Next/Turbopack static server bundling.
// Do not edit by hand; update procedures/_committees.yaml and regenerate this
// projection with: bun scripts/co-newbiz/generate-committee-registry.ts
// (--check exits 1 on drift; the drift gate lives in the audit-variant
// PROJECTION_GENERATORS family; tests/unit/committee-registry-projection.test.ts
// pins generated-vs-YAML equality.)
`;

/**
 * Deterministic TypeScript-object-literal serializer matching the shipped
 * projection's style: 2-space indent steps, one array item / object entry per
 * line, comma between entries, object keys quoted only when they are not
 * valid identifiers, strings JSON-escaped (Korean governance wording passes
 * through unchanged).
 */
function emitValue(value: unknown, indent: string): string[] {
  if (typeof value === "string") return [JSON.stringify(value)];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (value === null || value === undefined) return ["null"];
  if (Array.isArray(value)) {
    if (value.length === 0) return ["[]"];
    const inner = `${indent}  `;
    const lines: string[] = ["["];
    value.forEach((item, i) => {
      // emitValue contract: line 0 is bare (the caller indents it); the rest
      // already carry absolute indentation.
      const itemLines = emitValue(item, inner);
      itemLines[itemLines.length - 1] += i < value.length - 1 ? "," : "";
      lines.push(inner + itemLines[0]);
      for (let j = 1; j < itemLines.length; j++) lines.push(itemLines[j]);
    });
    lines.push(`${indent}]`);
    return lines;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return ["{}"];
  const inner = `${indent}  `;
  const lines: string[] = ["{"];
  entries.forEach(([key, v], i) => {
    const keyText = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
    const valLines = emitValue(v, inner);
    valLines[valLines.length - 1] += i < entries.length - 1 ? "," : "";
    lines.push(`${inner}${keyText}: ${valLines[0]}`);
    for (const l of valLines.slice(1)) lines.push(l);
  });
  lines.push(`${indent}}`);
  return lines;
}

/** Build the full generated-file text from raw YAML text (exported for the unit pin). */
export function buildCommitteeRegistrySource(yamlText: string): string {
  const doc = yaml.load(yamlText) as { committees: Record<string, unknown> };
  if (!doc?.committees || typeof doc.committees !== "object") {
    throw new Error(`${YAML_PATH}: expected a top-level "committees" mapping`);
  }
  const lines = emitValue(doc.committees, "");
  // lines[0] is the bare "{" and lines[last] the bare "}" of the registry
  // object — both are inlined into the export statement below.
  return `${HEADER}import type { CommitteeDef } from "./committee-session.ts";

export const COMMITTEE_REGISTRY: Record<string, CommitteeDef> = {
${lines.slice(1, -1).join("\n")}
};
`;
}

function normalizeForCheck(text: string): string {
  // Windows checkouts may materialize the generated file with CRLF while the
  // in-memory generator emits LF. Treat line endings as a transport detail so
  // the freshness gate only reports real YAML/projection drift.
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

if (import.meta.main) {
  const generated = buildCommitteeRegistrySource(readFileSync(YAML_PATH, "utf8"));
  if (process.argv.includes("--check")) {
    if (normalizeForCheck(readFileSync(OUT_PATH, "utf8")) !== normalizeForCheck(generated)) {
      console.error(`${OUT_PATH} stale — regenerate with: bun scripts/co-newbiz/generate-committee-registry.ts`);
      process.exit(1);
    }
    console.log("committee-registry.generated.ts is up to date.");
  } else {
    writeFileSync(OUT_PATH, generated, "utf8");
    const count = Object.keys(
      (yaml.load(readFileSync(YAML_PATH, "utf8")) as { committees: Record<string, unknown> }).committees,
    ).length;
    console.log(`${OUT_PATH} generated (${count} committees).`);
  }
}
