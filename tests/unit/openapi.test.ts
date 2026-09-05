// @version 1.0.0
/**
 * OpenAPI drift gate — docs/architecture/mcp-integration.md §6, docs/architecture/api-spec.md Status.
 *
 * Extracts every (method, path) route declaration from
 * app/web-next/app/api/**\/route.ts (ADR-0069/0070 Phase 6 test port —
 * was app/server/*.ts's Hono `router.get(...)` calls before the cutover)
 * and asserts set equality with docs/architecture/openapi.yaml in BOTH directions: a
 * route without a spec entry fails (undocumented surface), and a spec
 * entry without a route fails (documented but not built — the
 * openapi.yaml mistake this gate exists to catch). Also enforces the
 * per-operation house style (operationId present) so the file stays
 * machine-joinable with the MCP tool catalog.
 */

import { test, expect, describe } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const API_ROOT = join("app", "web-next", "app", "api");

// A Next.js Route Handler declares its methods as exported top-level HTTP-
// verb functions (`export async function GET(...)`, etc.) — anchoring on
// `export` + line start keeps any unrelated identifier named e.g. `get`
// out of the match set (see declaredRoutes()'s per-method RegExp below).

/** Next.js `[param]` directory segments become OpenAPI `{param}` segments. */
function normalizeSegment(segment: string): string {
  return segment.startsWith("[") && segment.endsWith("]") ? `{${segment.slice(1, -1)}}` : segment;
}

function walkRouteFiles(dir: string, segments: string[], out: { urlPath: string; file: string }[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkRouteFiles(full, [...segments, normalizeSegment(entry)], out);
    } else if (entry === "route.ts") {
      out.push({ urlPath: `/api/${segments.join("/")}`, file: full });
    }
  }
}

// Memoized: this walks ~45 route files and regex-scans each. Called three
// times across this file's tests (both direction checks) — recomputing
// each time was measured to push the suite over its 5s per-test timeout
// when running alongside the other 55 test files (disk contention), even
// though it's comfortably fast in isolation.
let declaredRoutesCache: Set<string> | null = null;
function declaredRoutes(): Set<string> {
  if (declaredRoutesCache) return declaredRoutesCache;
  const routes = new Set<string>();
  const files: { urlPath: string; file: string }[] = [];
  walkRouteFiles(API_ROOT, [], files);
  for (const { urlPath, file } of files) {
    const source = readFileSync(file, "utf8");
    for (const method of METHODS) {
      const re = new RegExp(`^export\\s+(?:async\\s+)?function\\s+${method.toUpperCase()}\\b`, "m");
      if (re.test(source)) routes.add(`${method.toUpperCase()} ${urlPath}`);
    }
  }
  declaredRoutesCache = routes;
  return routes;
}

const spec = yaml.load(readFileSync("docs/architecture/openapi.yaml", "utf8")) as {
  openapi?: string;
  paths?: Record<string, Record<string, unknown>>;
};

function specRoutes(): Set<string> {
  const routes = new Set<string>();
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of METHODS) {
      if (item[method]) routes.add(`${method.toUpperCase()} ${path}`);
    }
  }
  return routes;
}

describe("docs/architecture/openapi.yaml drift gate (mcp-integration.md §6)", () => {
  test("the spec is OpenAPI 3.1", () => {
    expect(spec.openapi).toBe("3.1.0");
  });

  test("every declared route has a spec entry (no undocumented surface)", () => {
    const missing = [...declaredRoutes()].filter((route) => !specRoutes().has(route));
    expect(missing).toEqual([]);
  });

  test("every spec entry has a declared route (nothing documented-but-unbuilt)", () => {
    const missing = [...specRoutes()].filter((route) => !declaredRoutes().has(route));
    expect(missing).toEqual([]);
  });

  test("every operation carries an operationId", () => {
    const missing: string[] = [];
    for (const [path, item] of Object.entries(spec.paths ?? {})) {
      for (const method of METHODS) {
        const op = item[method] as { operationId?: string } | undefined;
        if (op && !op.operationId) missing.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
