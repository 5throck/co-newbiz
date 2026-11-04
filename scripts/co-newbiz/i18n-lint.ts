#!/usr/bin/env bun
// @version 1.2.0
/**
 * i18n-lint — the re-liquefaction guard (design 2026-10-23-i18n-ui-adoption
 * §3.6). Scans app/web-next sources for Hangul occurring in CODE (line and
 * block comments are stripped first) and compares the per-file Korean-line
 * counts against a committed baseline allowlist. The baseline records every
 * file still carrying Korean at extraction start; extraction batches shrink
 * their entries via `--update`, and the allowlist only ever shrinks.
 *
 * Checks (all three gate the exit code):
 *   1. Korean-line baseline — Hangul in code vs the committed allowlist
 *      (this file's original check, v1.0.0).
 *   2. Dotted-key — translator-taking label maps whose `stages.*`/`common.*`/
 *      `pages.*` values are rendered without a translator call (v1.1.0,
 *      review W1 H2).
 *   3. Dynamic-key catalog coverage — template-literal keys like
 *      `t(`handling_${e.handling}`)` are invisible to both checks above;
 *      v1.2.0 cross-checks every member of a source type-union (e.g.
 *      `RetentionHandling` in db/lib/retention-registry.ts — the SSOT) ×
 *      locale against the nested locale catalogs and fails on a missing or
 *      empty key. An unparseable values source is itself a violation
 *      (fail-loud). Design 2026-11-04-i18n-dynamic-key-lint.
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
 * tests/unit/i18n-lint.test.ts (checks 1–2) and
 * tests/unit/i18n-dynamic-key-lint.test.ts (check 3), so the /sync unit
 * suite fails the PR that reintroduces a hard-coded string or ships an
 * enum value without catalog keys.
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

/** A raw dotted message key (`stages.*`, `common.*`, `pages.*`) that reaches the screen. */
export interface DottedKeyFinding {
  file: string;
  line: number;
  /** The label map whose catalog keys are rendered without a translator call. */
  map: string;
  /** Where the map is defined (repo-relative path). */
  definedIn: string;
}

const DOTTED_KEY_LITERAL = /(["'`])((?:stages|common|pages)\.[A-Za-z0-9_.]+)\1/;

/** Index just past the bracket group that opens at `open`; src.length when unbalanced. */
function matchGroupEnd(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return src.length;
}

const TRANSLATOR_CALL_BEFORE = /(?:^|[^\w$.])(?:tr|t|translate)$/;
const TRANSLATOR_FIRST_ARG = /^\s*(?:tr|t|translate)\s*,/;

/** True when `body` holds a dotted key literal outside any translator call (`tr(...)` or `helper(tr, ...)`). */
function hasUnresolvedKeyLiteral(body: string): boolean {
  const stack: boolean[] = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "(") {
      stack.push(TRANSLATOR_CALL_BEFORE.test(body.slice(Math.max(0, i - 12), i)) || TRANSLATOR_FIRST_ARG.test(body.slice(i + 1, i + 16)));
    } else if (c === ")") stack.pop();
    else if (c === '"' || c === "'" || c === "`") {
      const m = DOTTED_KEY_LITERAL.exec(body.slice(i, i + 200));
      if (m && m.index === 0 && !stack.some(Boolean)) return true;
    }
  }
  return false;
}

/**
 * Names of label-map functions in `src`: `NAME = (tr: TranslatorFn) => ({...})`
 * (or `function NAME(tr: TranslatorFn)`) whose body stores dotted catalog keys
 * as plain string values. Such a map yields KEYS, not text; every consumer
 * must pass the looked-up value through a translator.
 */
export function findLabelKeyMaps(src: string): string[] {
  const code = stripCommentsAndStringsKeepStructure(src);
  const names: string[] = [];
  const re = /(?:\bconst\s+|\bfunction\s+)([A-Za-z_$][\w$]*)\s*(?::[^=]*?)?(?:=\s*)?(?:async\s*)?\(\s*[A-Za-z_]\w*\s*:\s*TranslatorFn\b/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const closeParen = code.indexOf(")", m.index + m[0].length);
    if (closeParen < 0) continue;
    const rest = code.slice(closeParen);
    const arrow = rest.indexOf("=>");
    const brace = rest.indexOf("{");
    let bodyStart: number;
    if (arrow >= 0 && (brace < 0 || arrow < brace)) {
      bodyStart = closeParen + arrow + 2;
      while (/\s/.test(code[bodyStart] ?? "")) bodyStart++;
    } else if (brace >= 0) bodyStart = closeParen + brace;
    else continue;
    let bodyEnd: number;
    if ("({[".includes(code[bodyStart] ?? "")) bodyEnd = matchGroupEnd(code, bodyStart);
    else {
      const semi = code.indexOf(";", bodyStart);
      bodyEnd = semi < 0 ? code.length : semi;
    }
    if (hasUnresolvedKeyLiteral(code.slice(bodyStart, bodyEnd))) names.push(m[1]);
  }
  return names;
}

/**
 * Usage sites of `mapName` that render the looked-up value raw. A usage is
 * accepted when it sits inside a `tr(...)`/`t(...)` call, or when its line
 * resolves the value through a translator call on a bare identifier
 * (`Object.entries(MAP(tr)).map(([k, v]) => tr(v))`).
 */
export function findRawMapUsages(src: string, mapName: string): number[] {
  const code = stripCommentsAndStringsKeepStructure(src);
  const lines = code.split("\n");
  const usageRe = new RegExp(`(?<![\\w$.])${mapName.replace(/\$/g, "\\$")}\\s*\\(`, "g");
  const hits: number[] = [];
  let offset = 0;
  const lineStart: number[] = lines.map((l) => {
    const o = offset;
    offset += l.length + 1;
    return o;
  });
  for (let m = usageRe.exec(code); m; m = usageRe.exec(code)) {
    let ln = lineStart.findIndex((o, i) => o <= m.index && (i === lineStart.length - 1 || lineStart[i + 1] > m.index));
    if (ln < 0) ln = 0;
    const line = lines[ln];
    // Skip the definition itself.
    if (/(?:\bconst|\bfunction|\bexport\s+const)\s+[A-Za-z_$][\w$]*\s*(?::[^=]*)?=?\s*\(?\s*$/.test(line.slice(0, m.index - lineStart[ln]) + "")) continue;
    if (new RegExp(`(?:const|function)\\s+${mapName}\\b`).test(line)) continue;
    // Inside a translator call?
    let depth = 0;
    let wrapped = false;
    const stack: boolean[] = [];
    for (let i = Math.max(0, m.index - 400); i < m.index; i++) {
      const c = code[i];
      if (c === "(") stack.push(TRANSLATOR_CALL_BEFORE.test(code.slice(Math.max(0, i - 12), i)));
      else if (c === ")") stack.pop();
    }
    wrapped = stack.some(Boolean);
    void depth;
    if (wrapped) continue;
    if (/(?<![\w$.])(?:tr|t|translate)\(\s*[A-Za-z_$][\w$]*\s*[,)]/.test(line)) continue;
    hits.push(ln + 1);
  }
  return hits;
}

/** Scan the tree for label-key maps whose values are rendered without a translator call. */
export function scanUnresolvedDottedKeys(projectRoot: string = findProjectRoot()): DottedKeyFinding[] {
  const files = collectScannedFiles(projectRoot);
  const sources = new Map<string, string>(files.map((f) => [f, readFileSync(join(projectRoot, f), "utf8")]));
  const maps: Array<{ name: string; file: string }> = [];
  for (const [file, src] of sources) for (const name of findLabelKeyMaps(src)) maps.push({ name, file });
  const out: DottedKeyFinding[] = [];
  for (const { name, file: definedIn } of maps) {
    for (const [file, src] of sources) {
      if (file !== definedIn && !src.includes(name)) continue;
      for (const line of findRawMapUsages(src, name)) out.push({ file, line, map: name, definedIn });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Locales with committed catalogs under app/web-next/locales/. */
export const LOCALES = ["ko", "en"] as const;

/**
 * A dynamic key family: UI code interpolates an enum value into a template
 * literal (`t(`handling_${e.handling}`)`), so the effective key vocabulary is
 * the source type's union members under `namespace`. `valuesSource` is the
 * repo-relative file owning the vocabulary (the SSOT); `typeName` is the
 * `export type` union declaration parsed for the member list.
 */
export interface DynamicKeyFamily {
  prefix: string;
  namespace: string;
  valuesSource: string;
  typeName: string;
}

/** Families shipped today, all sourced from the retention registry SSOT. */
export const DYNAMIC_KEY_FAMILIES: readonly DynamicKeyFamily[] = [
  { prefix: "handling_", namespace: "admin.ops", valuesSource: "db/lib/retention-registry.ts", typeName: "RetentionHandling" },
  { prefix: "handlingHint_", namespace: "admin.ops", valuesSource: "db/lib/retention-registry.ts", typeName: "RetentionHandling" },
];

/**
 * Quoted string literals of the `export type <typeName> = ...;` declaration
 * span, comments stripped first (a quoted example in a comment cannot
 * pollute the result) and multi-line unions tolerated. Returns [] when the
 * declaration cannot be located or yields no literals — callers treat that
 * as a violation (fail-loud), never a silent pass.
 */
export function parseUnionTypeValues(src: string, typeName: string): string[] {
  const code = stripCommentsAndStringsKeepStructure(src);
  const decl = new RegExp(`\\bexport\\s+type\\s+${typeName}\\b[^=;{]*=`).exec(code);
  if (!decl) return [];
  const semi = code.indexOf(";", decl.index + decl[0].length);
  const span = semi < 0 ? code.slice(decl.index + decl[0].length) : code.slice(decl.index + decl[0].length, semi);
  const values: string[] = [];
  const literal = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;
  for (let m = literal.exec(span); m; m = literal.exec(span)) values.push(m[1] ?? m[2] ?? "");
  return values;
}

/** True when `keyPath` ("a.b.c") resolves through the nested catalog to a non-empty string leaf. */
export function resolvesKeyPath(catalog: unknown, keyPath: string): boolean {
  let node: unknown = catalog;
  for (const segment of keyPath.split(".")) {
    if (node === null || typeof node !== "object") return false;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === "string" && node.length > 0;
}

/** One missing (or empty) dynamic-key catalog entry, or one unparseable values source. */
export interface DynamicKeyCoverageViolation {
  locale: string;
  key: string;
  valuesSource: string;
  typeName: string;
}

function loadLocaleCatalog(projectRoot: string, locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(projectRoot, "app/web-next/locales", `${locale}.json`), "utf8")) as Record<string, unknown>;
}

/**
 * Check 3 — for each family, parse the source type's union members and
 * require `namespace.<prefix><value>` to resolve to a non-empty string in
 * every locale catalog. Pure and injectable: pass in-memory `catalogs`
 * (locale → nested JSON) to scan without touching disk; omit to read the
 * committed locale files. A values source that cannot be parsed is itself a
 * violation (locale "*") — a linter that stops reading its SSOT must fail,
 * not green-light.
 */
export function scanDynamicKeyCoverage(
  families: readonly DynamicKeyFamily[] = DYNAMIC_KEY_FAMILIES,
  projectRoot: string = findProjectRoot(),
  catalogs?: Record<string, unknown>,
): DynamicKeyCoverageViolation[] {
  const violations: DynamicKeyCoverageViolation[] = [];
  for (const family of families) {
    let values: string[] = [];
    try {
      values = parseUnionTypeValues(readFileSync(join(projectRoot, family.valuesSource), "utf8"), family.typeName);
    } catch {
      values = [];
    }
    if (values.length === 0) {
      violations.push({
        locale: "*",
        key: `unparseable values source: ${family.valuesSource} — 0 literals parsed for ${family.typeName}`,
        valuesSource: family.valuesSource,
        typeName: family.typeName,
      });
      continue;
    }
    for (const locale of LOCALES) {
      const catalog = catalogs?.[locale] ?? loadLocaleCatalog(projectRoot, locale);
      for (const value of values) {
        const key = `${family.namespace}.${family.prefix}${value}`;
        if (!resolvesKeyPath(catalog, key)) {
          violations.push({ locale, key, valuesSource: family.valuesSource, typeName: family.typeName });
        }
      }
    }
  }
  return violations;
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
    const dotted = scanUnresolvedDottedKeys(projectRoot);
    const dynamic = scanDynamicKeyCoverage(DYNAMIC_KEY_FAMILIES, projectRoot);
    if (args.includes("--json")) {
      console.log(JSON.stringify({ ...result, dottedKeys: dotted, dynamicKeyCoverage: dynamic }, null, 2));
    } else {
      printResult(result);
      for (const d of dotted) {
        console.log(`i18n-lint  ${d.file}:${d.line}  ${d.map}() (keys defined in ${d.definedIn}) rendered without a translator call`);
      }
      console.log(`i18n-lint dotted-keys: ${dotted.length === 0 ? "PASS" : "FAIL"} — ${dotted.length} unresolved key(s).`);
      for (const v of dynamic) {
        console.log(`i18n-lint  ${v.locale}  ${v.key}  (values: ${v.valuesSource} ${v.typeName}) missing from the locale catalog`);
      }
      console.log(`i18n-lint dynamic-keys: ${dynamic.length === 0 ? "PASS" : "FAIL"} — ${dynamic.length} missing catalog key(s).`);
    }
    process.exit(result.violations.length === 0 && dotted.length === 0 && dynamic.length === 0 ? 0 : 1);
  }
}
