// @version 1.0.0
/**
 * Next.js Route Handler dispatcher for tests — the app/web-next equivalent
 * of Hono's `app.request(path, init)`, built so tests/unit/api.test.ts's
 * single `req(path, init)` wrapper (ADR-0069/0070 Phase 6 test port) can
 * be repointed here with zero changes to any of its 117 test bodies below.
 *
 * File-system route discovery: walks app/web-next/app/api recursively,
 * treats a `[segment]` directory as a dynamic param, and matches the
 * longest/most-specific pattern first (static segments outrank dynamic
 * ones at the same position) — the same precedence Next.js itself uses,
 * so a route table does not need to be hand-maintained here and drift
 * from the real file layout.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const API_ROOT = join(import.meta.dirname, "..", "..", "..", "app", "web-next", "app", "api");

type Handler = (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

interface RouteEntry {
  segments: string[]; // e.g. ["projects", ":id", "runs"]
  modulePath: string;
}

function walk(dir: string, segments: string[], out: RouteEntry[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const seg = entry.startsWith("[") && entry.endsWith("]") ? `:${entry.slice(1, -1)}` : entry;
      walk(full, [...segments, seg], out);
    } else if (entry === "route.ts") {
      out.push({ segments, modulePath: full });
    }
  }
}

let routeTable: RouteEntry[] | null = null;
function getRouteTable(): RouteEntry[] {
  if (!routeTable) {
    routeTable = [];
    walk(API_ROOT, [], routeTable);
    // Static segments before dynamic ones at the same depth, so e.g.
    // /api/projects/foo (a hypothetical static route) would win over
    // /api/projects/:id — mirrors Next.js's own route-matching precedence.
    routeTable.sort((a, b) => {
      for (let i = 0; i < Math.max(a.segments.length, b.segments.length); i++) {
        const as = a.segments[i] ?? "";
        const bs = b.segments[i] ?? "";
        const aDyn = as.startsWith(":");
        const bDyn = bs.startsWith(":");
        if (aDyn !== bDyn) return aDyn ? 1 : -1;
      }
      return 0;
    });
  }
  return routeTable;
}

function matchPath(pathname: string): { entry: RouteEntry; params: Record<string, string> } | null {
  const pathSegments = pathname.replace(/^\/api\//, "").split("/").filter(Boolean);
  for (const entry of getRouteTable()) {
    if (entry.segments.length !== pathSegments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < entry.segments.length; i++) {
      const routeSeg = entry.segments[i];
      if (routeSeg.startsWith(":")) {
        params[routeSeg.slice(1)] = decodeURIComponent(pathSegments[i]);
      } else if (routeSeg !== pathSegments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { entry, params };
  }
  return null;
}

const moduleCache = new Map<string, Record<string, Handler>>();

/**
 * The `app.request(path, init)` replacement. `path` may be relative
 * (e.g. "/api/projects/:id/runs" resolved form "/api/projects/<id>/runs")
 * or include a query string — both handled the same way `fetch` does.
 */
export async function nextRequest(path: string, init?: RequestInit): Promise<Response> {
  const url = new URL(path, "http://localhost");
  const method = (init?.method ?? "GET").toUpperCase();
  const match = matchPath(url.pathname);
  if (!match) {
    return new Response(JSON.stringify({ data: null, meta: {}, error: { code: "not_found", message: `No route for ${method} ${url.pathname}` } }), { status: 404 });
  }
  let mod = moduleCache.get(match.entry.modulePath);
  if (!mod) {
    mod = (await import(match.entry.modulePath)) as Record<string, Handler>;
    moduleCache.set(match.entry.modulePath, mod);
  }
  const handler = mod[method];
  if (!handler) {
    return new Response(JSON.stringify({ data: null, meta: {}, error: { code: "method_not_allowed", message: `${method} not supported on ${url.pathname}` } }), { status: 405 });
  }
  const request = new Request(url, init);
  return handler(request, { params: Promise.resolve(match.params) });
}

/**
 * `Bun.serve({ fetch })`-compatible entry point — used by
 * tests/unit/mcp.test.ts, which needs a real HTTP server (the MCP layer
 * relays over real fetch() calls to CO_NEWBIZ_API_BASE_URL, not an
 * in-process handler call) rather than the path-string form above.
 */
export async function nextFetch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const match = matchPath(url.pathname);
  if (!match) {
    return new Response(JSON.stringify({ data: null, meta: {}, error: { code: "not_found", message: `No route for ${method} ${url.pathname}` } }), { status: 404 });
  }
  let mod = moduleCache.get(match.entry.modulePath);
  if (!mod) {
    mod = (await import(match.entry.modulePath)) as Record<string, Handler>;
    moduleCache.set(match.entry.modulePath, mod);
  }
  const handler = mod[method];
  if (!handler) {
    return new Response(JSON.stringify({ data: null, meta: {}, error: { code: "method_not_allowed", message: `${method} not supported on ${url.pathname}` } }), { status: 405 });
  }
  return handler(request, { params: Promise.resolve(match.params) });
}
