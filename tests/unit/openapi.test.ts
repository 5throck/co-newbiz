// @version 1.0.0
/**
 * OpenAPI drift gate — docs/mcp-integration.md §6, docs/api-spec.md Status.
 *
 * Extracts every (method, path) route declaration from app/server/*.ts and
 * asserts set equality with docs/openapi.yaml in BOTH directions: a route
 * without a spec entry fails (undocumented surface), and a spec entry
 * without a route fails (documented but not built — the openapi.yaml
 * mistake this gate exists to catch). Also enforces the per-operation
 * house style (operationId present) so the file stays machine-joinable
 * with the MCP tool catalog.
 */

import { test, expect, describe } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

// Route declarations look like `router.get("/api/projects/:id", ...)` where
// the receiver is always `app` (index.ts) or a `*Routes` Hono router — every
// module in app/server follows that naming. Anchoring on the receiver keeps
// handler-body calls like `c.get("auth")` out of the match set.
const ROUTE_RE = /(?:\bapp|\b[A-Za-z]+Routes)\.(get|post|put|patch|delete)\("([^"]+)"/g;

/** Hono `:param` segments become OpenAPI `{param}` segments. */
function normalizePath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function declaredRoutes(): Set<string> {
  const routes = new Set<string>();
  for (const file of readdirSync("app/server").filter((f) => f.endsWith(".ts"))) {
    const source = readFileSync(join("app/server", file), "utf8");
    for (const match of source.matchAll(ROUTE_RE)) {
      routes.add(`${match[1].toUpperCase()} ${normalizePath(match[2])}`);
    }
  }
  return routes;
}

const spec = yaml.load(readFileSync("docs/openapi.yaml", "utf8")) as {
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

describe("docs/openapi.yaml drift gate (mcp-integration.md §6)", () => {
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
