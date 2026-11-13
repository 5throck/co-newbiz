// @version 1.0.0
/**
 * env-drift.ts — pure drift classifier for the env SSOT split (ADR-0075 gate side).
 *
 * The repo-root .env is the SSOT for every co-newbiz runtime key; the only
 * legitimate app/web-next/.env remnant is the Prisma-CLI DATABASE_URL (design
 * docs/designs/2026-11-13-env-single-source-design.md §3.4A). This module
 * parses the two files and classifies SSOT-key overlap:
 *
 *   - divergent  : key defined in BOTH files with different normalized values
 *                  — the exact failure class that produced two divergent LLM
 *                  blocks; env-check turns these into hard failures (exit 1).
 *   - duplicate  : same key, same normalized value — redundancy, not
 *                  divergence; env-check warns and keeps exit 0.
 *   - whitespace : an SSOT key whose active UNQUOTED value carries
 *                  leading/trailing whitespace on disk (the trailing-space
 *                  hygiene found during the 2026-11-13 migration); env-check
 *                  warns.
 *
 * Non-SSOT keys are ignored entirely so the guard cannot false-positive on
 * tooling keys an operator adds (DATABASE_URL in both files, for instance).
 * Values are never returned or printed — key names and file labels only.
 *
 * Normalization uses the shared parser (scripts/lib/env-value.ts), so values
 * compare exactly as every reader would see them; SSOT membership comes from
 * the shared inventory in app/web-next/lib/root-env.ts (isSsotEnvKey) — one
 * inventory, three consumers, no second hardcoded key list.
 */

import { isSsotEnvKey } from "../../app/web-next/lib/root-env.ts";
import { parseEnvValue } from "./env-value.ts";

export type EnvFileLabel = "root" | "app";

export interface EnvWhitespaceHit {
  /** Which file carries the dirty line. */
  file: EnvFileLabel;
  /** The offending key's name (never its value). */
  key: string;
}

export interface EnvDriftReport {
  /** SSOT keys in both files with different normalized values — FAIL. */
  divergent: string[];
  /** SSOT keys in both files with the same normalized value — WARN. */
  duplicate: string[];
  /** SSOT keys with unquoted leading/trailing whitespace on disk — WARN. */
  whitespace: EnvWhitespaceHit[];
}

const ENV_LINE = /^([A-Z_0-9]+)=(.*)$/;
const QUOTE_CHARS = new Set(['"', "'", "`"]);

interface ParsedEnvFile {
  /** key -> normalized value (parseEnvValue semantics). */
  keys: Map<string, string>;
  /** SSOT keys whose active unquoted value has leading/trailing whitespace. */
  whitespace: string[];
}

/**
 * Parse a `.env` text into key/value pairs plus whitespace-hygiene hits.
 * Mirrors the loader walkers: comment lines, blank lines and anything without
 * a `KEY=` prefix are invisible; quoted values are exempt from the whitespace
 * check (whitespace inside quotes is literal), as are unquoted values with an
 * inline `#` comment (dotenv separates the comment with whitespace by design).
 */
function parseEnvFile(text: string): ParsedEnvFile {
  const keys = new Map<string, string>();
  const whitespace: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(ENV_LINE);
    if (!m) continue;
    keys.set(m[1], parseEnvValue(m[2], m[1]));
    const raw = m[2];
    const first = raw.trim()[0];
    const quoted = first !== undefined && QUOTE_CHARS.has(first);
    // An inline `#` comment justifies trailing whitespace ("K=v  # note");
    // bare trailing/leading whitespace is the corruption class to flag.
    if (!quoted && !raw.includes("#") && raw.trim() !== raw) whitespace.push(m[1]);
  }
  return { keys, whitespace };
}

/**
 * Classify drift between the repo-root `.env` and `app/web-next/.env` texts.
 * Pure: no filesystem access, no console output, no values in the report.
 */
export function collectEnvDrift(rootText: string, appText: string): EnvDriftReport {
  const root = parseEnvFile(rootText);
  const app = parseEnvFile(appText);

  const divergent: string[] = [];
  const duplicate: string[] = [];
  for (const [key, rootValue] of root.keys) {
    if (!isSsotEnvKey(key)) continue;
    const appValue = app.keys.get(key);
    if (appValue === undefined) continue;
    if (appValue === rootValue) duplicate.push(key);
    else divergent.push(key);
  }

  const whitespace: EnvWhitespaceHit[] = [
    ...root.whitespace.filter((k) => isSsotEnvKey(k)).map((key) => ({ file: "root" as const, key })),
    ...app.whitespace.filter((k) => isSsotEnvKey(k)).map((key) => ({ file: "app" as const, key })),
  ];

  return { divergent, duplicate, whitespace };
}
