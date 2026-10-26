#!/usr/bin/env bun
// @version 1.0.0
/**
 * locale-jargon-lint — keeps internal references out of user-facing copy
 * (project review 2026-10-26 H4). Scans every leaf string of
 * app/web-next/locales/*.json for: numbered boundary references ("경계 #3",
 * "boundary #3"), ADR numbers, flow.spec versions, roster agent keys,
 * checklist ids (ma-NN / bf-NN / cdd-NN), and developer-facing words
 * ("개발자", "슬라이스"/"slice").
 *
 * Exemptions live in scripts/co-newbiz/locale-jargon-allowlist.json: an array
 * of { locale, path, reason } entries. One exact key path per entry, a
 * non-empty reason is mandatory, and wildcard entries are rejected.
 *
 * Wired into `bun run lint:i18n` (package.json) and tests/unit.
 *
 * Usage:
 *   bun scripts/co-newbiz/locale-jargon-lint.ts          # check (exit 1 on findings)
 *   bun scripts/co-newbiz/locale-jargon-lint.ts --json   # machine-readable result
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const LOCALES_DIR = join(ROOT, "app", "web-next", "locales");
const AGENTS_DIR = join(ROOT, "agents");
const ALLOWLIST_FILE = join(import.meta.dirname, "locale-jargon-allowlist.json");

export interface AllowlistEntry {
  locale: string;
  path: string;
  reason: string;
}

export interface JargonFinding {
  locale: string;
  path: string;
  pattern: string;
  match: string;
}

export interface JargonRule {
  name: string;
  re: RegExp;
}

/** Roster agent keys that are distinctive enough to match as words (hyphenated file names). */
export function loadAgentKeys(agentsDir: string = AGENTS_DIR): string[] {
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir)
    .filter((f) => f.endsWith(".md") && !/^README/i.test(f))
    .map((f) => f.slice(0, -3))
    .filter((k) => k.includes("-"));
}

export function buildRules(agentKeys: string[] = loadAgentKeys()): JargonRule[] {
  const rules: JargonRule[] = [
    { name: "boundary-reference", re: /경계\s?#\s?\d+|boundary\s?#\s?\d+/i },
    { name: "adr-number", re: /\bADR-\d+/i },
    { name: "flow-spec-version", re: /flow\.spec\s+v\d/i },
    { name: "checklist-id", re: /\b(?:ma|bf|cdd)-\d+\b/ },
    { name: "developer-wording", re: /개발자|슬라이스|\bslices?\b/i },
  ];
  if (agentKeys.length > 0) {
    const alt = agentKeys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    rules.push({ name: "agent-key", re: new RegExp(`(?<![\\w-])(?:${alt})(?![\\w-])`) });
  }
  return rules;
}

/** Leaf strings of a JSON document with dotted key paths (array indexes as [n]). */
export function flattenLeaves(node: unknown, prefix = ""): Array<{ path: string; value: string }> {
  if (typeof node === "string") return [{ path: prefix, value: node }];
  if (Array.isArray(node)) return node.flatMap((v, i) => flattenLeaves(v, `${prefix}[${i}]`));
  if (node && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      flattenLeaves(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [];
}

/** Validate allowlist shape: exact paths only, a reason on every entry. */
export function validateAllowlist(entries: AllowlistEntry[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  entries.forEach((e, i) => {
    const id = `allowlist[${i}]`;
    if (!e.locale || !e.path) errors.push(`${id}: locale and path are required`);
    if (e.path?.includes("*")) errors.push(`${id}: wildcard paths are not allowed (${e.path})`);
    if (!e.reason || e.reason.trim().length < 10) errors.push(`${id}: a reason (>= 10 chars) is required for ${e.locale}:${e.path}`);
    const key = `${e.locale}:${e.path}`;
    if (seen.has(key)) errors.push(`${id}: duplicate entry ${key}`);
    seen.add(key);
  });
  return errors;
}

export function scanLocaleDocument(
  locale: string,
  doc: unknown,
  rules: JargonRule[],
  allowlist: AllowlistEntry[],
): JargonFinding[] {
  const allowed = new Set(allowlist.filter((e) => e.locale === locale).map((e) => e.path));
  const out: JargonFinding[] = [];
  for (const { path, value } of flattenLeaves(doc)) {
    if (allowed.has(path)) continue;
    for (const rule of rules) {
      const m = rule.re.exec(value);
      if (m) out.push({ locale, path, pattern: rule.name, match: m[0] });
    }
  }
  return out;
}

export function loadAllowlist(file: string = ALLOWLIST_FILE): AllowlistEntry[] {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as AllowlistEntry[]) : [];
}

export interface JargonLintResult {
  findings: JargonFinding[];
  allowlistErrors: string[];
  scannedLocales: string[];
}

export function lintLocaleJargon(): JargonLintResult {
  const allowlist = loadAllowlist();
  const rules = buildRules();
  const findings: JargonFinding[] = [];
  const scannedLocales: string[] = [];
  for (const f of readdirSync(LOCALES_DIR).filter((n) => n.endsWith(".json")).sort()) {
    const locale = f.slice(0, -5);
    scannedLocales.push(locale);
    findings.push(...scanLocaleDocument(locale, JSON.parse(readFileSync(join(LOCALES_DIR, f), "utf8")), rules, allowlist));
  }
  return { findings, allowlistErrors: validateAllowlist(allowlist), scannedLocales };
}

if (import.meta.main) {
  const result = lintLocaleJargon();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const e of result.allowlistErrors) console.log(`locale-jargon  ${e}`);
    for (const f of result.findings) {
      console.log(`locale-jargon  ${f.locale}.json  ${f.path}  [${f.pattern}] "${f.match}"`);
    }
    const byPattern = new Map<string, number>();
    for (const f of result.findings) byPattern.set(f.pattern, (byPattern.get(f.pattern) ?? 0) + 1);
    const ok = result.findings.length === 0 && result.allowlistErrors.length === 0;
    console.log(
      `\nlocale-jargon-lint: ${ok ? "PASS" : "FAIL"} — ${result.scannedLocales.length} locale(s), ${result.findings.length} finding(s)` +
        (byPattern.size ? ` (${[...byPattern].map(([k, v]) => `${k}=${v}`).join(", ")})` : "") +
        `, ${result.allowlistErrors.length} allowlist error(s).`,
    );
  }
  process.exit(result.findings.length === 0 && result.allowlistErrors.length === 0 ? 0 : 1);
}
