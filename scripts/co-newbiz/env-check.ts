#!/usr/bin/env bun
// @version 1.2.0
/**
 * env-check.ts — ADR-0075 pre-flight gate for pipeline API stages.
 *
 * The 2026-08-31 S1–S7 pipeline run misdiagnosed "API key missing" when the
 * real causes were (a) each tool shell starting with an empty environment and
 * (b) CRLF line endings in .env corrupting every sourced value with a trailing
 * \r. This script makes both failure modes checkable before any stage runs:
 *
 *   bun scripts/co-newbiz/env-check.ts           # verify keys + CRLF + env-drift state
 *   bun scripts/co-newbiz/env-check.ts --exports # print CRLF-safe export lines
 *
 * Since the env SSOT unification (design 2026-11-13-env-single-source §3.4A)
 * the default check mode also classifies root-.env vs app/web-next/.env drift
 * through scripts/lib/env-drift.ts: an SSOT key defined in BOTH files with
 * different values FAILS (exit 1); identical duplication and whitespace
 * hygiene only WARN (exit stays 0). Values are never printed in check mode.
 * The --exports output is meant for shells without process substitution:
 *   eval "$(bun scripts/co-newbiz/env-check.ts --exports)"
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { collectEnvDrift } from "../lib/env-drift.ts";
import { die } from "../lib/error-handling.ts";

const REQUIRED_KEYS = ["DART_API_KEY", "LAW_API_OC", "KOSIS_API_KEY", "CO_NEWBIZ_API_TOKEN"] as const;

const repoRoot = join(import.meta.dir, "..", "..");
const envPath = join(repoRoot, ".env");
const appEnvPath = join(repoRoot, "app", "web-next", ".env");

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
  parsed.set(
    trimmed.slice(0, eq).trim(),
    trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, ""),
  );
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
    ".env uses CRLF line endings; sourcing it directly corrupts every value with a trailing \\r. Load via: set -a; source <(tr -d '\\r' < .env); set +a",
  );
}

// ── Env SSOT drift (design 2026-11-13-env-single-source §3.4A) ──
// The repo-root .env is the SSOT; app/web-next/.env may hold only the
// Prisma-CLI DATABASE_URL. A divergent SSOT duplicate is the exact failure
// class that produced two divergent LLM blocks, so it is a hard failure; an
// identical duplicate is redundancy (warning), whitespace is hygiene (warning).
// No app file (fresh clone) means nothing to compare — skip silently.
const driftWarnings: string[] = [];
if (existsSync(appEnvPath)) {
  const drift = collectEnvDrift(raw, readFileSync(appEnvPath, "utf8"));
  for (const key of drift.divergent) {
    problems.push(
      `env drift: ${key} differs between repo-root .env and app/web-next/.env — root .env is the SSOT; keep the value in root and delete the app copy`,
    );
  }
  for (const key of drift.duplicate) {
    driftWarnings.push(
      `env drift: ${key} is defined identically in repo-root .env and app/web-next/.env — root .env is the SSOT; delete the app copy`,
    );
  }
  for (const w of drift.whitespace) {
    const where = w.file === "root" ? "repo-root .env" : "app/web-next/.env";
    driftWarnings.push(
      `env drift: ${w.key} in the ${where} has an unquoted value with leading/trailing whitespace — normalize the line`,
    );
  }
}
// LLM token-parameter knob hygiene (design 2026-11-13-llm-max-completion-tokens §3.1):
// at runtime an unrecognized value is treated as "auto" with a one-shot warning —
// surface the same problem here, at pre-flight time, as a warning (never a failure).
const tokenParamKnob = parsed.get("CO_NEWBIZ_LLM_MAX_TOKENS_PARAM");
if (tokenParamKnob !== undefined) {
  const v = tokenParamKnob.trim().toLowerCase();
  if (v !== "max_tokens" && v !== "max_completion_tokens" && v !== "auto") {
    driftWarnings.push(
      `CO_NEWBIZ_LLM_MAX_TOKENS_PARAM has an unrecognized value (valid: max_tokens, max_completion_tokens, auto) — it will behave as "auto"`,
    );
  }
}

if (driftWarnings.length > 0) {
  console.warn("env-check: warnings");
  for (const w of driftWarnings) console.warn(`  - ${w}`);
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
  const probe = async (
    label: string,
    url: string,
    init: RequestInit,
    validate?: (res: Response) => Promise<string | null>,
  ): Promise<void> => {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
      const validationError = res.ok && validate ? await validate(res) : null;
      const verdict =
        res.ok && !validationError
          ? "valid"
          : `INVALID (HTTP ${res.status}${validationError ? `, ${validationError}` : ""})`;
      console.log(`  ${label}: ${verdict}`);
      if (!res.ok || validationError) problems.push(`${label} credential rejected — ${verdict}`);
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
      body: JSON.stringify({
        model: parsed.get("CO_NEWBIZ_LLM_MODEL") ?? "",
        max_tokens: 8,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
  } else problems.push("CO_NEWBIZ_LLM_API_KEY missing — LLM pipeline stages will degrade");
  const dartKey = parsed.get("DART_API_KEY");
  if (dartKey) {
    await probe(
      "DART",
      `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${dartKey}`,
      { redirect: "manual" },
      async (res) => {
        const contentType = res.headers.get("content-type") ?? "";
        if (res.status >= 300 && res.status < 400) return "redirected instead of returning corpCode ZIP";
        if (
          !contentType.includes("zip") &&
          !contentType.includes("octet-stream") &&
          !contentType.includes("x-msdownload")
        ) {
          return `unexpected content-type ${contentType || "(none)"}`;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        return bytes[0] === 0x50 && bytes[1] === 0x4b ? null : "response is not a ZIP payload";
      },
    );
  }
  const kosisKey = parsed.get("KOSIS_API_KEY");
  if (kosisKey) {
    await probe(
      "KOSIS",
      `https://kosis.kr/openapi/Param/statisticsParameterData.do?method=getList&apiKey=${encodeURIComponent(kosisKey)}&orgId=101&tblId=DT_1JH20201&itmId=T1&objL1=0&prdSe=M&startPrdDe=202601&endPrdDe=202601&format=json&jsonVD=Y`,
      {},
      async (res) => {
        const payload = await res.json().catch(() => null);
        return Array.isArray(payload) && payload.length > 0 ? null : "unexpected statistics response";
      },
    );
  }
  const lawOc = parsed.get("LAW_API_OC");
  if (lawOc) {
    await probe(
      "LAW",
      `https://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(lawOc)}&target=law&type=JSON&query=${encodeURIComponent("상법")}`,
      {},
      async (res) => {
        const payload = (await res.json().catch(() => null)) as { LawSearch?: { law?: unknown[] } | unknown[] } | null;
        const lawSearch = payload?.LawSearch;
        const rows = Array.isArray(lawSearch) ? lawSearch : lawSearch?.law;
        return Array.isArray(rows) && rows.length > 0 ? null : "unexpected law-search response";
      },
    );
  }
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

console.log(
  `env-check: OK — ${REQUIRED_KEYS.length}/${REQUIRED_KEYS.length} required keys present${hasCRLF ? " (CRLF detected; use the tr -d '\\r' load preamble)" : ""}`,
);
