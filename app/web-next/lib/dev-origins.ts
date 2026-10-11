// Pure, dependency-free helpers for CO_NEWBIZ_ALLOWED_DEV_ORIGINS. Imported by
// next.config.ts, so it must stay free of app imports and path aliases.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const DEV_ORIGINS_ENV_KEY = "CO_NEWBIZ_ALLOWED_DEV_ORIGINS";

export const BUILTIN_DEV_ORIGINS: readonly string[] = [
  "100.104.16.127",
  "100.87.220.26",
  "macmini.tail03efbe.ts.net",
  "192.168.0.44",
  "co-newbiz.bizknights.org",
  "newbiz.bizknights.org",
  "dev-newbiz.bizknights.org",
];

const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

export interface ParsedDevOrigins {
  origins: string[];
  warnings: string[];
}

/** Parse a comma/whitespace separated list of bare hostnames or IPs. */
export function parseDevOrigins(raw: string | undefined | null): ParsedDevOrigins {
  const origins: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const token of (raw ?? "").split(/[\s,]+/)) {
    let host = token.trim().replace(/^["']|["']$/g, "");
    if (!host) continue;
    const original = host;
    host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").toLowerCase();
    if (!host || !HOST_RE.test(host)) {
      warnings.push(`ignored invalid ${DEV_ORIGINS_ENV_KEY} entry "${original}"`);
      continue;
    }
    if (host !== original.toLowerCase()) {
      warnings.push(`normalized ${DEV_ORIGINS_ENV_KEY} entry "${original}" to "${host}" (use bare hostnames)`);
    }
    if (!seen.has(host)) {
      seen.add(host);
      origins.push(host);
    }
  }
  return { origins, warnings };
}

/** Read only this one key from a dotenv file. Never throws, never exposes other keys. */
export function readKeyFromEnvFile(envPath: string, key: string = DEV_ORIGINS_ENV_KEY): string | undefined {
  try {
    if (!existsSync(envPath)) return undefined;
    let found: string | undefined;
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
      if (!m || m[1] !== key) continue;
      let value = m[2].trim();
      const quoted = value.match(/^(["'])(.*?)\1/);
      value = quoted ? quoted[2] : value.replace(/\s+#.*$/, "");
      found = value;
    }
    return found;
  } catch {
    return undefined;
  }
}

export function mergeDevOrigins(defaults: readonly string[], extra: readonly string[]): string[] {
  return [...new Set([...defaults, ...extra])];
}

/** Defaults + (process.env, else repo-root .env) extras. Warnings go to console.warn. */
export function resolveAllowedDevOrigins(
  repoRoot: string,
  env: Record<string, string | undefined> = process.env,
  warn: (msg: string) => void = (m) => console.warn(`[next.config] ${m}`),
): string[] {
  const fromProcess = env[DEV_ORIGINS_ENV_KEY];
  const raw = fromProcess !== undefined ? fromProcess : readKeyFromEnvFile(join(repoRoot, ".env"));
  const { origins, warnings } = parseDevOrigins(raw);
  for (const w of warnings) warn(w);
  return mergeDevOrigins(BUILTIN_DEV_ORIGINS, origins);
}
