#!/usr/bin/env bun
// @version 1.0.1
/**
 * i18n-lint — the re-liquefaction guard (design 2026-10-23-i18n-ui-adoption
 * §3.6). Scans app/web-next sources for Hangul occurring in CODE (line and
 * block comments are stripped first) and compares the per-file Korean-line
 * counts against a committed baseline allowlist. The baseline records every
 * file still carrying Korean at extraction start; extraction batches shrink
 * their entries via `--update`, and the allowlist only ever shrinks.
 *
 * Rules:
 *   violation — a file NOT in the baseline contains Korean, or a file's
 *               count EXCEEDS its baseline count (a new literal was added).
 *   shrink    — a file's count is BELOW its baseline (informational only;
 *               run `--update` after an extraction batch to tighten it).
 *
 * Known blind spots (accepted; documented 2026-10-24 review):
 *   1. Unicode escapes — Hangul written as `\uXXXX` escape sequences is
 *      invisible to the scanner (it matches raw source text, not rendered
 *      characters).
 *   2. Count baseline, not content hash — the baseline stores per-file
 *      Korean-LINE COUNTS, so replacing one Korean literal with another that
 *      keeps the count passes.
 *   3. Scan scope — only `.ts`/`.tsx` under app/components/lib/i18n;
 *      generated files (`*.generated.ts`), test files (`*.test.ts`/`.tsx`),
 *      the `locales` directory, and non-TS files are excluded.
 *   4. Commented-out literals are inert — comments are stripped before
 *      counting, so Korean in comments neither counts nor fails.
 *
 * Wired as `bun run lint:i18n` (package.json) and asserted green by
 * tests/unit/i18n-lint.test.ts, so the /sync unit suite fails the PR that
 * reintroduces a hard-coded string.
 *
 * Usage:
 *   bun scripts/co-newbiz/i18n-lint.ts            # check (exit 1 on violations)
 *   bun scripts/co-newbiz/i18n-lint.ts --update   # regenerate the baseline
 *   bun scripts/co-newbiz/i18n-lint.ts --json     # machine-readable result
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Baseline allowlist keyed by repo-root-relative path → Korean-line count. */
const BASELINE_FILE = join(import.meta.dirname, "i18n-lint.baseline.json");

/** Source roots under app/web-next, relative to the repo root. */
const SCAN_ROOTS = ["app/web-next/app", "app/web-next/components", "app/web-next/lib", "app/web-next/i18n"];

const SCANNED_EXTENSIONS = [".ts", ".tsx"];

/** Hangul syllables + jamo + compatibility jamo. */
const HANGUL = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/;

/** Files whose Korean content is out of scope for the UI-string guard. */
const EXCLUDE_BASENAME = (basename: string): boolean =>
  basename.endsWith(".generated.ts") || /\.test\.(ts|tsx)$/.test(basename);

const EXCLUDE_DIR_SEGMENT = (relPath: string): boolean => relPath.split("/").includes("locales");

/**
 * Replace comments with spaces while preserving newlines (line numbers stay
 * valid) and respecting string literals — a `//` inside "https://…" must not
 * start a comment and hide the Korean after it. Template-literal `${}`
 * interpolations are treated as plain template text: that can only
 * over-count Korean, never hide it.
 */
export function stripCommentsAndStringsKeepStructure(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  let state: "code" | "line-comment" | "block-comment" | "single" | "double" | "template" = "code";
  while (i < n) {
    const c = src[i];
    const next = i + 1 < n ? src[i + 1] : "";
    switch (state) {
      case "code":
        if (c === "/" && next === "/") {
          state = "line-comment";
          out += "  ";
          i += 2;
        } else if (c === "/" && next === "*") {
          state = "block-comment";
          out += "  ";
          i += 2;
        } else if (c === "'") {
          state = "single";
          out += c;
          i += 1;
        } else if (c === '"') {
          state = "double";
          out += c;
          i += 1;
        } else if (c === "`") {
          state = "template";
          out += c;
          i += 1;
        } else {
          out += c;
          i += 1;
        }
        break;
      case "line-comment":
        if (c === "\n") {
          state = "code";
          out += c;
        } else {
          out += " ";
        }
        i += 1;
        break;
      case "block-comment":
        if (c === "*" && next === "/") {
          state = "code";
          out += "  ";
          i += 2;
        } else {
          out += c === "\n" ? "\n" : " ";
          i += 1;
        }
        break;
      case "single":
      case "double":
      case "template":
        if (c === "\\") {
          out += src.slice(i, i + 2);
          i += 2;
        } else if (
          (state === "single" && c === "'") ||
          (state === "double" && c === '"') ||
          (state === "template" && c === "`")
        ) {
          state = "code";
          out += c;
          i += 1;
        } else {
          out += c;
          i += 1;
        }
        break;
    }
  }
  return out;
}

/** 1-based line numbers carrying Hangul after comment stripping. */
export function koreanLineNumbers(src: string): number[] {
  const stripped = stripCommentsAndStringsKeepStructure(src);
  const lines = stripped.split("\n");
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (HANGUL.test(lines[i])) hits.push(i + 1);
  }
  return hits;
}

/** Repo root = two levels up from scripts/co-newbiz/. Same walk-up fallback
 * as glossary-lint (import.meta.dirname unavailable under Turbopack). */
function findProjectRoot(): string {
  if (import.meta.dirname) return resolve(import.meta.dirname, "..", "..");
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (
      existsSync(join(dir, "app", "web-next", "locales")) &&
      existsSync(join(dir, "scripts", "co-newbiz", "i18n-lint.ts"))
    ) {
      return dir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate the project root from cwd=${process.cwd()} (import.meta.dirname was unavailable).`);
}

function displayPath(file: string, projectRoot: string): string {
  const rel = file.startsWith(projectRoot) ? file.slice(projectRoot.length + 1) : file;
  return rel.split("\\").join("/");
}

function collectScannedFiles(projectRoot: string): string[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    const absRoot = join(projectRoot, root);
    if (!existsSync(absRoot)) continue;
    const stack = [absRoot];
    while (stack.length) {
      const dir = stack.pop();
      if (dir === undefined) break;
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) stack.push(full);
        else if (SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext)) && !EXCLUDE_BASENAME(entry)) {
          const rel = displayPath(full, projectRoot);
          if (!EXCLUDE_DIR_SEGMENT(rel)) files.push(rel);
        }
      }
    }
  }
  return files.sort();
}

export interface KoreanLineScan {
  /** repo-root-relative path → 1-based Korean line numbers (empty arrays omitted). */
  byFile: Record<string, number[]>;
  scannedFiles: number;
  totalKoreanLines: number;
}

/** Scan the tree and return the Korean line numbers per file. */
export function scanKoreanLines(projectRoot: string = findProjectRoot()): KoreanLineScan {
  const byFile: Record<string, number[]> = {};
  let totalKoreanLines = 0;
  const files = collectScannedFiles(projectRoot);
  for (const rel of files) {
    const hits = koreanLineNumbers(readFileSync(join(projectRoot, rel), "utf8"));
    if (hits.length > 0) {
      byFile[rel] = hits;
      totalKoreanLines += hits.length;
    }
  }
  return { byFile, scannedFiles: files.length, totalKoreanLines };
}

export type ViolationReason = "not-in-baseline" | "exceeds-baseline";

export interface I18nLintViolation {
  file: string;
  line: number;
  reason: ViolationReason;
  baseline: number | null;
  current: number;
}

export interface I18nLintShrink {
  file: string;
  baseline: number;
  current: number;
}

export interface I18nLintResult {
  scannedFiles: number;
  baselineFiles: number;
  totalKoreanLines: number;
  violations: I18nLintViolation[];
  shrinks: I18nLintShrink[];
}

/** Read the committed baseline allowlist. */
export function loadBaseline(): Record<string, number> {
  return JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as Record<string, number>;
}

/** Check the tree against the baseline allowlist. */
export function lintI18nStrings(projectRoot: string = findProjectRoot()): I18nLintResult {
  const scan = scanKoreanLines(projectRoot);
  const baseline = loadBaseline();
  const violations: I18nLintViolation[] = [];
  const shrinks: I18nLintShrink[] = [];
  for (const [file, lines] of Object.entries(scan.byFile)) {
    const limit = baseline[file];
    if (limit === undefined) {
      violations.push({ file, line: lines[0], reason: "not-in-baseline", baseline: null, current: lines.length });
    } else if (lines.length > limit) {
      violations.push({ file, line: lines[limit], reason: "exceeds-baseline", baseline: limit, current: lines.length });
    } else if (lines.length < limit) {
      shrinks.push({ file, baseline: limit, current: lines.length });
    }
  }
  return {
    scannedFiles: scan.scannedFiles,
    baselineFiles: Object.keys(baseline).length,
    totalKoreanLines: scan.totalKoreanLines,
    violations,
    shrinks,
  };
}

/** Regenerate the baseline from the current tree (--update, post-extraction only). */
export function buildBaseline(projectRoot: string = findProjectRoot()): Record<string, number> {
  const scan = scanKoreanLines(projectRoot);
  const out: Record<string, number> = {};
  for (const [file, lines] of Object.entries(scan.byFile)) out[file] = lines.length;
  return out;
}

function printResult(result: I18nLintResult): void {
  for (const v of result.violations) {
    const detail =
      v.reason === "not-in-baseline"
        ? `no baseline entry — extract the string(s) or (extraction batches only) run --update`
        : `${v.current} Korean lines exceed the baseline of ${v.baseline} — new literal(s) added`;
    console.log(`i18n-lint  ${v.file}:${v.line}  ${detail}`);
  }
  if (result.shrinks.length > 0) {
    console.log(
      `\n[info] ${result.shrinks.length} file(s) shrank below baseline — run --update after an extraction batch to tighten:`,
    );
    for (const s of result.shrinks) console.log(`  ${s.file}  ${s.baseline} -> ${s.current}`);
  }
  const verdict = result.violations.length === 0 ? "PASS" : "FAIL";
  console.log(
    `\ni18n-lint: ${verdict} — ${result.scannedFiles} file(s) scanned, ${result.totalKoreanLines} Korean line(s) across ` +
      `${result.baselineFiles} baseline file(s), ${result.violations.length} violation(s), ${result.shrinks.length} shrink(s).`,
  );
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const projectRoot = findProjectRoot();
  if (args.includes("--update")) {
    const baseline = buildBaseline(projectRoot);
    writeFileSync(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`);
    const total = Object.values(baseline).reduce((a, b) => a + b, 0);
    console.log(`i18n-lint: baseline regenerated — ${Object.keys(baseline).length} file(s), ${total} Korean line(s).`);
    console.log("Only for post-extraction batches: the allowlist must shrink, never grow.");
  } else {
    const result = lintI18nStrings(projectRoot);
    if (args.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printResult(result);
    }
    process.exit(result.violations.length === 0 ? 0 : 1);
  }
}
