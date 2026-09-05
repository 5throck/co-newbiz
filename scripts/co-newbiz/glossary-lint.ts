#!/usr/bin/env bun
// @version 1.1.1
/**
 * glossary:lint — undefined-jargon report over the documented target
 * surfaces (ADR-0022 / glossary/_schema.yaml tooling_integrations:
 * "Skill/doc/UI strings are scanned for undefined jargon and
 * abbreviations"). v1 scans the prose surfaces — the markdown under
 * skills/ and docs/; UI-string scanning lands when the web UI stabilizes.
 *
 * This is the weekly undefined-term report that backs the
 * glossary-curator's cadence (docs/governance/ops-cadence.md Weekly row). It is
 * REPORT-ONLY in v1: exit code is 0 regardless of findings, so it can run
 * in any pipeline without becoming a gate — turning findings into glossary
 * entries (or allowlist additions) is the curator's judgement, not a
 * machine decision.
 *
 * Two report classes:
 *   info    — registered glossary terms (keys + aliases) actually used; the
 *             forcing function ADR-0022 exists for: every term has a consumer.
 *   warning — acronym-like tokens (2+ uppercase/digit chars, word-boundary,
 *             fences and inline code stripped) that are neither in
 *             glossary/*.yaml nor allowlisted, with file:line.
 *
 * Usage:
 *   bun scripts/co-newbiz/glossary-lint.ts [--root <dir>]... [--quiet-known]
 *
 * Also wired as the `glossary:lint` case of newbiz.ts. Distinct from
 * `glossary/_validate.ts` (which validates term entries against
 * glossary/_schema.yaml — package.json alias `glossary:validate`).
 */

import * as yaml from "js-yaml";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Universal tooling acronyms that are vocabulary of the MEDIUM (editors,
 * protocols, repo mechanics), not of this domain — flagging them would
 * bury domain signal. Deliberately tight: domain abbreviations (CGT, DSCR,
 * Pre-FS's FS...) do NOT belong here — they belong in glossary/*.yaml.
 */
export const GLOSSARY_LINT_ALLOWLIST = new Set([
  "API", "CI", "DB", "HTTP", "HTTPS", "JSON", "MCP", "PR", "REST", "SSR", "UI", "URL", "YAML",
]);

export interface GlossaryLintOptions {
  /** Directories to scan recursively for *.md. Defaults to skills/ and docs/. */
  roots?: string[];
}

export interface KnownTermUsage {
  term: string;
  files: number;
  mentions: number;
}

export interface UndefinedTokenFinding {
  token: string;
  file: string;
  line: number;
  count: number;
}

export interface GlossaryLintResult {
  scannedFiles: number;
  known: KnownTermUsage[];
  undefined: UndefinedTokenFinding[];
}

/** Load registered term keys + aliases from glossary/*.yaml (not _*.yaml). */
function loadRegisteredTerms(glossaryDir: string): Set<string> {
  const registered = new Set<string>();
  for (const file of readdirSync(glossaryDir).filter((f) => f.endsWith(".yaml") && !f.startsWith("_"))) {
    const doc = yaml.load(readFileSync(join(glossaryDir, file), "utf8"), { schema: yaml.JSON_SCHEMA }) as
      | { terms?: Record<string, { aliases?: string[] }> }
      | undefined;
    for (const [key, entry] of Object.entries(doc?.terms ?? {})) {
      registered.add(key.toUpperCase());
      for (const alias of entry?.aliases ?? []) registered.add(alias.toUpperCase());
    }
  }
  return registered;
}

function markdownFiles(root: string): string[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(root, f));
}

/**
 * Acronym-like tokens per line: 2+ uppercase/digit chars starting with a
 * letter, at word boundaries. Fenced code blocks (``` toggles) and inline
 * code spans (`...`) are stripped first — code identifiers are not prose
 * jargon. Returns [token, line] pairs for matches outside the allowlist
 * plus the set of all matched (registered) tokens for the info report.
 */
export function scanLine(
  line: string,
  registered: Set<string>,
): { known: string[]; undefined: string[] } {
  const known: string[] = [];
  const undefinedTokens: string[] = [];
  const prose = line.replace(/`[^`]*`/g, " ");
  for (const match of prose.matchAll(/\b[A-Z][A-Z0-9]{1,}\b/g)) {
    const token = match[0];
    if (registered.has(token)) known.push(token);
    else if (!GLOSSARY_LINT_ALLOWLIST.has(token)) undefinedTokens.push(token);
  }
  return { known, undefined: undefinedTokens };
}

/** Project root = two levels up from scripts/co-newbiz/. import.meta.dirname
 * is unavailable under Turbopack's server bundle (same edge case proc-resolve.ts
 * fixed for ADR-0071), so fall back to a cwd walk-up keyed on the glossary/ +
 * scripts/co-newbiz markers. */
function findProjectRoot(): string {
  if (import.meta.dirname) return resolve(import.meta.dirname, "..", "..");
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "glossary")) && existsSync(join(dir, "scripts", "co-newbiz", "glossary-lint.ts"))) {
      return dir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate the project root from cwd=${process.cwd()} (import.meta.dirname was unavailable).`);
}

/** Report paths relative to the project root when inside it (shorter lines), with / separators. */
function displayPath(file: string): string {
  const PROJECT_ROOT = findProjectRoot();
  const rel = file.startsWith(PROJECT_ROOT + "\\") || file.startsWith(PROJECT_ROOT + "/")
    ? file.slice(PROJECT_ROOT.length + 1)
    : file;
  return rel.split("\\").join("/");
}

export function lintGlossaryUsage(options: GlossaryLintOptions = {}): GlossaryLintResult {
  const PROJECT_ROOT = findProjectRoot();
  const registered = loadRegisteredTerms(join(PROJECT_ROOT, "glossary"));
  const roots = options.roots ?? [join(PROJECT_ROOT, "skills"), join(PROJECT_ROOT, "docs")];
  const files = roots.flatMap(markdownFiles);

  const knownByTerm = new Map<string, { files: Set<string>; mentions: number }>();
  const undefinedByToken = new Map<string, Map<string, { line: number; count: number }>>();
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trimStart().startsWith("```")) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const { known, undefined: lineUndefined } = scanLine(raw, registered);
      for (const term of known) {
        const entry = knownByTerm.get(term) ?? { files: new Set<string>(), mentions: 0 };
        entry.files.add(file);
        entry.mentions++;
        knownByTerm.set(term, entry);
      }
      for (const token of lineUndefined) {
        const byFile = undefinedByToken.get(token) ?? new Map<string, { line: number; count: number }>();
        const entry = byFile.get(file) ?? { line: i + 1, count: 0 };
        entry.count++;
        byFile.set(file, entry);
        undefinedByToken.set(token, byFile);
      }
    }
  }

  const known = [...knownByTerm.entries()]
    .map(([term, e]) => ({ term, files: e.files.size, mentions: e.mentions }))
    .sort((a, b) => b.mentions - a.mentions || a.term.localeCompare(b.term));
  const undef: UndefinedTokenFinding[] = [];
  // Frequency-first ordering: the curator triages the loudest token first.
  const byToken = [...undefinedByToken.entries()].sort(
    (a, b) =>
      [...b[1].values()].reduce((sum, e) => sum + e.count, 0) - [...a[1].values()].reduce((sum, e) => sum + e.count, 0) ||
      a[0].localeCompare(b[0]),
  );
  for (const [token, files] of byToken) {
    for (const [file, e] of [...files.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      undef.push({ token, file: displayPath(file), line: e.line, count: e.count });
    }
  }
  return { scannedFiles: files.length, known, undefined: undef };
}

/** Shared by this script's main and the newbiz.ts `glossary:lint` case. */
export function printGlossaryLintReport(result: GlossaryLintResult, options: { quietKnown?: boolean } = {}): void {
  if (!options.quietKnown && result.known.length > 0) {
    console.log(`[info] registered glossary terms in use (${result.known.length}):`);
    for (const k of result.known) console.log(`  ${k.term} — ${k.mentions} mention(s) across ${k.files} file(s)`);
  }
  if (result.undefined.length > 0) {
    console.log(`\n[warn] acronym-like tokens not in glossary/*.yaml (${result.undefined.length} finding(s)) — candidates for the glossary, not for the allowlist:`);
    for (const u of result.undefined) console.log(`  ${u.token} — ${u.file}:${u.line} (${u.count} occurrence(s))`);
  }
  console.log(
    `\nGlossary lint: ${result.scannedFiles} file(s) scanned, ${result.known.length} registered term(s) in use, ${result.undefined.length} undefined-token finding(s).`,
  );
  console.log("(report-only — exit 0 regardless; glossary-curator triages weekly per docs/governance/ops-cadence.md)");
}

if (import.meta.main) {
  const roots: string[] = [];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root" && args[i + 1]) roots.push(resolve(args[i + 1]));
  }
  printGlossaryLintReport(lintGlossaryUsage(roots.length > 0 ? { roots } : {}), {
    quietKnown: args.includes("--quiet-known"),
  });
}
