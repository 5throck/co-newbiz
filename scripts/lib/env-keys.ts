// @version 1.1.0
/**
 * env-keys.ts — credential loading for the CLI side of the pipeline.
 *
 * Walks up from cwd looking for a `.env` and imports only whitelisted
 * pipeline keys that are not already in the environment (never overriding
 * explicitly-set values). Same discipline as app/web-next/lib/root-env.ts's
 * loadRootEnvPipelineKeys, generalized: the k-* source adapters'
 * credentials (DART_API_KEY / KOSIS_API_KEY / LAW_API_OC /
 * DATA_GO_KR_API_KEY) join the LLM/Tavily keys on one whitelist. Scripts that need a key call
 * loadPipelineKeys() first, then read process.env directly — this module
 * never returns secret values, it only populates process.env.
 *
 * The whitelist is NOT a second copy: admission is derived from the shared
 * SSOT inventory in app/web-next/lib/root-env.ts (isSsotEnvKey — design
 * 2026-11-13-env-single-source §3.2: one inventory, two consumers; the CLI
 * twin keeps its own walk). The import is cycle-safe: source-adapters.ts
 * imports this module and root-env.ts imports source-adapters.ts, but every
 * cross-module call happens inside functions, never at module evaluation.
 */

import { isSsotEnvKey } from "../../app/web-next/lib/root-env.ts";
import { parseEnvValue } from "./env-value.ts";

let loaded = false;

export function loadPipelineKeys(): void {
  if (loaded) return;
  loaded = true;
  try {
    const { existsSync, readFileSync } = require("node:fs") as typeof import("node:fs");
    const { dirname, join } = require("node:path") as typeof import("node:path");
    let dir = process.cwd();
    for (let i = 0; i < 6; i++) {
      const envPath = join(dir, ".env");
      if (existsSync(envPath)) {
        for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
          const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
          if (m && isSsotEnvKey(m[1]) && process.env[m[1]] === undefined) {
            process.env[m[1]] = parseEnvValue(m[2], m[1]);
          }
        }
      }
      const parent = dirname(dir);
      if (parent === dir) return;
      dir = parent;
    }
  } catch {
    // env discovery is best-effort — adapters report their own disabled state
  }
}

/** Test seam: forget load state so the next loadPipelineKeys() re-reads the walk. */
export function resetPipelineKeysForTests(): void {
  loaded = false;
}

/** True when every named key is present in the environment (after loading). */
export function hasKeys(...names: string[]): boolean {
  loadPipelineKeys();
  return names.every((n) => Boolean(process.env[n]));
}
