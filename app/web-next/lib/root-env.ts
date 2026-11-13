// Repo-root `.env` loader for the Next.js server.
//
// `next dev/start` runs with cwd app/web-next, so Next only auto-loads .env
// files from there — yet operators keep pipeline credentials in the repo-root
// `.env` (production gets `.env.prod` via the compose env_file instead, which
// lands in process.env directly). This module walks up from cwd and imports
// ONLY allowlisted keys that are not already set, never overriding explicit
// values and never logging or returning values.
//
// The allowlist is the SSOT inventory (ssotEnvKeys()/isSsotEnvKey): the source
// adapters' credentials (derived from SOURCE_ADAPTERS[*].credentialEnv so it
// cannot drift), the LLM and scheduler NOTIFY families, the executor agent-mode
// family (*_AGENTS), and the exact-name keys the root .env owns — see design
// docs/designs/2026-11-13-env-single-source-design.md §3.2. env-keys.ts and
// scripts/lib/env-drift.ts derive their admission from this same inventory.
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
// Executor agent modes (ADR-0098/0099 seams: CO_NEWBIZ_BUSINESS_CASE_AGENTS,
// CO_NEWBIZ_DD_TAILOR_AGENTS). Family regex on purpose, matching the LLM/NOTIFY
// prefix-wildcard style (DEC-20261104-04) so a future executor seam needs no loader edit.
const AGENTS_KEY = /^CO_NEWBIZ_[A-Z_0-9]+_AGENTS$/;
// Exact-name SSOT keys the root .env owns (design 2026-11-13-env-single-source §3.2).
// Explicitly NOT here: CO_NEWBIZ_ALLOWED_DEV_ORIGINS (its own reader at next.config eval),
// CO_NEWBIZ_DIST_DIR (read before instrumentation — spawn env / app file only),
// CO_NEWBIZ_API_BASE_URL / CO_NEWBIZ_API_TOKEN (MCP client contract, not server process.env),
// DATABASE_URL (Prisma-CLI tooling remnant in app/web-next/.env).
const SSOT_EXTRA_KEYS = [
  "CO_NEWBIZ_DB_PATH",
  "WEB_SEARCH_DDG_ENABLED",
  "WEB_SEARCH_PLAYWRIGHT_ENABLED",
  "CHROME_PATH",
  "CO_NEWBIZ_BOOTSTRAP_MIGRATIONS",
  "CO_NEWBIZ_ALLOW_REGISTER",
] as const;

/** Exact-name allowlist for non-LLM keys (adapter credentials + search providers). */
export function pipelineEnvKeys(): Set<string> {
  const keys = new Set<string>(EXTRA_KEYS);
  for (const a of Object.values(SOURCE_ADAPTERS)) if (a.credentialEnv) keys.add(a.credentialEnv);
  return keys;
}

/**
 * Exact-name SSOT inventory (design 2026-11-13-env-single-source §3.2) — the one
 * key list shared by the loader walk, the CLI twin (env-keys.ts) and the drift
 * guard (env-drift.ts). Prefix-wildcard families (LLM/NOTIFY/agent modes) cannot
 * be enumerated; match them through isSsotEnvKey().
 */
export function ssotEnvKeys(): Set<string> {
  const keys = pipelineEnvKeys();
  for (const k of SSOT_EXTRA_KEYS) keys.add(k);
  return keys;
}

/** SSOT admission: exact inventory names plus the wildcard families. */
export function isSsotEnvKey(name: string): boolean {
  return LLM_KEY.test(name) || NOTIFY_KEY.test(name) || AGENTS_KEY.test(name) || ssotEnvKeys().has(name);
}

/** Back-compat alias — the predicate predates the SSOT inventory naming. */
export const isPipelineEnvKey = isSsotEnvKey;

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
          if (!m || !isPipelineEnvKey(m[1])) continue;
          const value = parseEnvValue(m[2], m[1]);
          if (process.env[m[1]] === undefined) {
            process.env[m[1]] = value;
            fromRootEnv.add(m[1]);
          } else if (value !== process.env[m[1]]) {
            // Boot-time drift warn (design 2026-11-13-env-single-source §3.4B):
            // the Next auto-load of app/web-next/.env or a spawn-env value shadows
            // a DIFFERENT root .env value. Warn-only — a dev server must not refuse
            // to boot on config hygiene; the CLI env-check gate is the hard stop.
            // Equal shadows stay silent; values are never printed.
            console.warn(
              `[root-env] ${m[1]}: a value provided by the environment (app/web-next/.env auto-load or spawn env) shadows a different value in the repo-root .env — root .env is the SSOT; align or remove the shadowing copy`,
            );
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
