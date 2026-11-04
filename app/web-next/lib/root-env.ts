// Repo-root `.env` loader for the Next.js server.
//
// `next dev/start` runs with cwd app/web-next, so Next only auto-loads .env
// files from there — yet operators keep pipeline credentials in the repo-root
// `.env` (production gets `.env.prod` via the compose env_file instead, which
// lands in process.env directly). This module walks up from cwd and imports
// ONLY allowlisted keys that are not already set, never overriding explicit
// values and never logging or returning values.
//
// The allowlist is derived from SOURCE_ADAPTERS[*].credentialEnv so it cannot
// drift from the adapters, plus the LLM and web-search provider keys and the
// scheduler notification-transport keys (NOTIFY_*, ADR-0189/0190).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SOURCE_ADAPTERS } from "../../../scripts/co-newbiz/source-adapters.ts";
import { parseEnvValue } from "../../../scripts/lib/env-value.ts";

const EXTRA_KEYS = ["TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY", "SERPER_API_KEY"] as const;
const LLM_KEY = /^CO_NEWBIZ_LLM_[A-Z_0-9]+$/;
// Scheduler notification transport (ADR-0189/0190, design 2026-10-29-scheduled-jobs-design section 13.1):
// SMTP credentials and webhook target URLs for notify.deliver/notify.digest. Prefix rule on purpose —
// NOTIFY_WEBHOOK_URL_<CHANNEL> grows with new channel keys. Secret values are still scrubbed centrally
// by db/lib/secret-scrubber.ts; this allowlist only decides what the root-env loader may lift into process.env.
const NOTIFY_KEY = /^NOTIFY_[A-Z_0-9]+$/;

/** Exact-name allowlist for non-LLM keys (adapter credentials + search providers). */
export function pipelineEnvKeys(): Set<string> {
  const keys = new Set<string>(EXTRA_KEYS);
  for (const a of Object.values(SOURCE_ADAPTERS)) if (a.credentialEnv) keys.add(a.credentialEnv);
  return keys;
}

export function isPipelineEnvKey(name: string): boolean {
  return LLM_KEY.test(name) || NOTIFY_KEY.test(name) || pipelineEnvKeys().has(name);
}

let loaded = false;
let startDirOverride: string | null = null;
const fromRootEnv = new Set<string>();

export function loadRootEnvPipelineKeys(): void {
  if (loaded) return;
  loaded = true;
  try {
    // cwd is the anchor (import.meta.dir is unreliable in bundled server chunks).
    let dir = startDirOverride ?? /*turbopackIgnore: true*/ process.cwd();
    for (let i = 0; i < 6; i++) {
      const envPath = join(dir, ".env");
      if (existsSync(envPath)) {
        for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
          const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
          if (m && isPipelineEnvKey(m[1]) && process.env[m[1]] === undefined) {
            process.env[m[1]] = parseEnvValue(m[2], m[1]);
            fromRootEnv.add(m[1]);
          }
        }
      }
      const parent = dirname(dir);
      if (parent === dir) return;
      dir = parent;
    }
  } catch {
    // env discovery is best-effort — callers fall back to deterministic paths
  }
}

/** Where a key's value came from; never the value itself. */
export function envKeySource(name: string): "process_env" | "root_env" | null {
  if (!process.env[name]?.trim()) return null;
  return fromRootEnv.has(name) ? "root_env" : "process_env";
}

/** Test seam: forget load state and optionally anchor the walk at `startDir`. */
export function resetRootEnvForTests(startDir: string | null = null): void {
  loaded = false;
  startDirOverride = startDir;
  fromRootEnv.clear();
}
