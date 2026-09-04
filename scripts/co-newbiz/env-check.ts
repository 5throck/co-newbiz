#!/usr/bin/env bun
// @version 1.1.0
/**
 * env-check.ts — ADR-0075 pre-flight gate for pipeline API stages.
 *
 * The 2026-08-31 S1–S7 pipeline run misdiagnosed "API key missing" when the
 * real causes were (a) each tool shell starting with an empty environment and
 * (b) CRLF line endings in .env corrupting every sourced value with a trailing
 * \r. This script makes both failure modes checkable before any stage runs:
 *
 *   bun scripts/co-newbiz/env-check.ts           # verify keys + CRLF state
 *   bun scripts/co-newbiz/env-check.ts --exports # print CRLF-safe export lines
 *
 * Values are never printed in check mode. The --exports output is meant for
 * shells without process substitution:
 *   eval "$(bun scripts/co-newbiz/env-check.ts --exports)"
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { die } from "../lib/error-handling.ts";

const REQUIRED_KEYS = [
  "DART_API_KEY",
  "LAW_API_OC",
  "KOSIS_API_KEY",
  "CO_NEWBIZ_API_TOKEN",
] as const;

const repoRoot = join(import.meta.dir, "..", "..");
const envPath = join(repoRoot, ".env");

const exportsMode = process.argv.includes("--exports");

if (!existsSync(envPath)) {
  die(`.env not found at ${envPath}. Create it with the required keys: ${REQUIRED_KEYS.join(", ")}`);
}

const raw = readFileSync(envPath, "utf8");
const hasCRLF = raw.includes("\r");
const parsed = new Map<string, string>();
for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const eq = trimmed.indexOf("=");
  parsed.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, ""));
}

if (exportsMode) {
  const lines: string[] = [];
  for (const key of REQUIRED_KEYS) {
    const value = parsed.get(key);
    if (value === undefined) die(`Cannot emit exports: required key ${key} is missing from .env`);
    // Single-quoted, with existing single quotes escaped; \r already stripped by parsing.
    lines.push(`export ${key}='${value.replaceAll("'", `'\\''`)}'`);
  }
  console.log(lines.join("\n"));
  process.exit(0);
}

const problems: string[] = [];
const missing = REQUIRED_KEYS.filter((k) => !parsed.has(k) || parsed.get(k) === "");
if (missing.length > 0) {
  problems.push(`missing or empty keys: ${missing.join(", ")}`);
}
if (hasCRLF) {
  // Not fatal by itself — the canonical preamble strips \r at load time — but
  // any workflow that sourced .env directly is already contaminated.
  problems.push(
    ".env uses CRLF line endings; sourcing it directly corrupts every value with a trailing \\r. Load via: set -a; source <(tr -d '\\r' < .env); set +a"
  );
}

if (problems.length > 0) {
  console.error("env-check: FAILED");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

// ── Live validity probes (--probe, or default when stdout is a TTY run) ──
// Key PRESENCE was never the whole story: the 2026-09-03 run had all keys
// present yet the LLM key returned HTTP 401, and every LLM pipeline step
// silently degraded to synthesis. A cheap 1-request probe per service turns
// that into explicit evidence (ADR-0075: never conclude without one).
if (process.argv.includes("--probe")) {
  const probe = async (label: string, url: string, init: RequestInit): Promise<void> => {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
      const verdict = res.ok ? "valid" : `INVALID (HTTP ${res.status})`;
      console.log(`  ${label}: ${verdict}`);
      if (!res.ok) problems.push(`${label} credential rejected — ${verdict}`);
    } catch (err) {
      console.log(`  ${label}: UNREACHABLE (${err instanceof Error ? err.message : err})`);
      problems.push(`${label} probe failed (network)`);
    }
  };
  console.log("probing live credentials:");
  const llmKey = parsed.get("CO_NEWBIZ_LLM_API_KEY");
  if (llmKey) {
    await probe("LLM", `${(parsed.get("CO_NEWBIZ_LLM_BASE_URL") ?? "").replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": llmKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: parsed.get("CO_NEWBIZ_LLM_MODEL") ?? "", max_tokens: 8, messages: [{ role: "user", content: "ping" }] }),
    });
  } else problems.push("CO_NEWBIZ_LLM_API_KEY missing — LLM pipeline stages will degrade");
  const dartKey = parsed.get("DART_API_KEY");
  if (dartKey) await probe("DART", `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${dartKey}`, {});
  const tavilyKey = parsed.get("TAVILY_API_KEY");
  if (tavilyKey) {
    await probe("TAVILY", "https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: tavilyKey, query: "probe", max_results: 1 }),
    });
  } else problems.push("TAVILY_API_KEY missing — web research stages will degrade");
}

if (problems.length > 0) {
  console.error("env-check: FAILED");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`env-check: OK — ${REQUIRED_KEYS.length}/${REQUIRED_KEYS.length} required keys present${hasCRLF ? " (CRLF detected; use the tr -d '\\r' load preamble)" : ""}`);
