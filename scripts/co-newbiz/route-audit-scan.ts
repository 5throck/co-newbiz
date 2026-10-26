#!/usr/bin/env bun
// @version 1.0.0
/**
 * route-audit-scan — audit-token scan for state-changing Route Handlers
 * (project review 2026-10-26 M11, FR-SEC-07). Every app/web-next/app/api
 * route.ts exporting POST/PUT/PATCH/DELETE must reach an audit write: an
 * audit write token (appendAudit(, audit(, INTO audit_log) in the route file or in a local
 * module it imports (followed up to MAX_DEPTH levels). Routes that are
 * intentionally unaudited (public/auth/read-like) are listed with a reason in
 * route-audit-allowlist.json ({ "<route path>": "<reason>" }).
 *
 * Token presence is a tripwire, not proof that every branch audits — the
 * sibling write-route tests carry the behavioral assertions.
 *
 * Usage: bun scripts/co-newbiz/route-audit-scan.ts [--json]
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const API_DIR = join(ROOT, "app", "web-next", "app", "api");
const ALLOWLIST_FILE = join(import.meta.dirname, "route-audit-allowlist.json");
const MAX_DEPTH = 3;

const WRITE_HANDLER = /export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b|export\s+const\s+(POST|PUT|PATCH|DELETE)\b/g;
/** Real audit writes only: appendAudit(), a local audit() helper that wraps it, auditTokenUse(), or a raw audit_log insert. */
const AUDIT_TOKEN = /(?<!function\s)\b(?:appendAudit|audit|auditTokenUse)\s*\(|INTO\s+audit_log\b/;
const IMPORT_RE = /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;

export function writeMethods(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(WRITE_HANDLER)) out.add(m[1] ?? m[2]);
  return [...out];
}

/** Shared infrastructure modules: their audit tokens (login failures, helper definitions) must not count as route-level audit. */
const SHARED_INFRA = new Set(["auth.ts", "envelope.ts", "client.ts", "access-control.ts"]);

function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(cand) && /\.(ts|tsx)$/.test(cand) && !SHARED_INFRA.has(cand.split("/").pop() ?? "")) return cand;
  }
  return null;
}

/** True when the file, or a local module reachable within `depth`, mentions an audit token. */
export function reachesAudit(file: string, depth = MAX_DEPTH, seen = new Set<string>()): boolean {
  if (seen.has(file) || !existsSync(file)) return false;
  seen.add(file);
  const src = readFileSync(file, "utf8");
  if (AUDIT_TOKEN.test(src)) return true;
  if (depth <= 0) return false;
  for (const m of src.matchAll(IMPORT_RE)) {
    const next = resolveLocal(file, m[1]);
    if (next && reachesAudit(next, depth - 1, seen)) return true;
  }
  return false;
}

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...routeFiles(p));
    else if (e.name === "route.ts") out.push(p);
  }
  return out.sort();
}

export function loadRouteAllowlist(file: string = ALLOWLIST_FILE): Record<string, string> {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, string>) : {};
}

export interface RouteAuditReport {
  writeRoutes: number;
  unaudited: string[];
  allowlistErrors: string[];
}

export function scanRouteAudit(
  apiDir: string = API_DIR,
  allowlist: Record<string, string> = loadRouteAllowlist(),
): RouteAuditReport {
  const rel = (f: string) => f.slice(apiDir.length + 1);
  const writeRoutes = routeFiles(apiDir).filter((f) => writeMethods(readFileSync(f, "utf8")).length > 0);
  const writeRel = new Set(writeRoutes.map(rel));
  const allowlistErrors: string[] = [];
  for (const [route, reason] of Object.entries(allowlist)) {
    if (route.includes("*")) allowlistErrors.push(`wildcard allowlist entry not allowed: ${route}`);
    if (!reason || reason.trim().length < 10) allowlistErrors.push(`allowlist entry needs a reason: ${route}`);
    if (!writeRel.has(route)) allowlistErrors.push(`allowlist entry is not a write route (stale?): ${route}`);
  }
  const unaudited = writeRoutes.filter((f) => !allowlist[rel(f)] && !reachesAudit(f)).map(rel);
  return { writeRoutes: writeRoutes.length, unaudited, allowlistErrors };
}

if (import.meta.main) {
  const r = scanRouteAudit();
  if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    for (const u of r.unaudited) console.log(`route-audit  ${u}  state-changing handler with no audit token`);
    for (const e of r.allowlistErrors) console.log(`route-audit  ${e}`);
    console.log(`route-audit-scan: ${r.unaudited.length + r.allowlistErrors.length === 0 ? "PASS" : "FAIL"} — ${r.writeRoutes} write route(s), ${r.unaudited.length} unaudited, ${r.allowlistErrors.length} allowlist error(s).`);
  }
  process.exit(r.unaudited.length + r.allowlistErrors.length === 0 ? 0 : 1);
}
