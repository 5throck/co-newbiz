// @version 1.0.0
// InProcessRestPort — ADR-0154 §1, design §3.1.
//
// Runs the existing Next.js route handlers directly (no network hop) as the
// OAuth-delegated human, so the remote MCP transport executes exactly the
// same permission checks, audit writes, and MNPI exclusions as the REST API.
// The principal is passed through principal-context.ts; it is never a
// system role and never elevated beyond the token's live scopes.
//
// The route table is explicit (Next.js bundles route modules statically, so
// there is no filesystem discovery at runtime). A path the table does not
// know returns a typed not_found envelope; tests/unit/mcp-oauth.test.ts
// asserts every registry tool resolves.

import type { RestPort } from "../../../../mcp/co-newbiz/shared/rest-port.ts";
import type { Envelope } from "../../../../mcp/co-newbiz/shared/rest-client.ts";
import { runAsPrincipal, type DelegatedPrincipal } from "./principal-context.ts";

type Ctx = { params: Promise<Record<string, string>> };
interface RouteModule {
  GET?(request: Request, ctx: Ctx): Promise<Response> | Response;
  POST?(request: Request, ctx: Ctx): Promise<Response> | Response;
  DELETE?(request: Request, ctx: Ctx): Promise<Response> | Response;
}

interface RouteEntry {
  pattern: string;
  load: () => Promise<RouteModule>;
}

// Every REST route a registry tool wraps. M-2 extends this list together
// with the new tools (design §5.1: a missing route is added first).
export const ROUTE_TABLE: readonly RouteEntry[] = [
  { pattern: "/api/interpretations", load: () => import("../../app/api/interpretations/route.ts") },
  { pattern: "/api/procedures/resolve", load: () => import("../../app/api/procedures/resolve/route.ts") },
  { pattern: "/api/glossary/:term", load: () => import("../../app/api/glossary/[term]/route.ts") },
  { pattern: "/api/notifications", load: () => import("../../app/api/notifications/route.ts") },
  { pattern: "/api/series", load: () => import("../../app/api/series/route.ts") },
  { pattern: "/api/series/:id/observations", load: () => import("../../app/api/series/[id]/observations/route.ts") },
  { pattern: "/api/data-changes", load: () => import("../../app/api/data-changes/route.ts") },
  { pattern: "/api/opportunities", load: () => import("../../app/api/opportunities/route.ts") },
  { pattern: "/api/opportunities/:id/pipeline/status", load: () => import("../../app/api/opportunities/[id]/pipeline/status/route.ts") },
  { pattern: "/api/opportunities/:id/process", load: () => import("../../app/api/opportunities/[id]/process/route.ts") },
  { pattern: "/api/opportunities/:id/gate-decisions", load: () => import("../../app/api/opportunities/[id]/gate-decisions/route.ts") },
  { pattern: "/api/opportunities/:id/route-decision", load: () => import("../../app/api/opportunities/[id]/route-decision/route.ts") },
  { pattern: "/api/opportunities/:id/committee-sessions", load: () => import("../../app/api/opportunities/[id]/committee-sessions/route.ts") },
  { pattern: "/api/opportunities/:id/committee-sessions/:sessionId", load: () => import("../../app/api/opportunities/[id]/committee-sessions/[sessionId]/route.ts") },
  { pattern: "/api/projects/:id/ic-package", load: () => import("../../app/api/projects/[id]/ic-package/route.ts") },
  { pattern: "/api/projects/:id/dd", load: () => import("../../app/api/projects/[id]/dd/route.ts") },
  { pattern: "/api/projects/:id/scorecard", load: () => import("../../app/api/projects/[id]/scorecard/route.ts") },
];

export function matchRoute(pathname: string): { entry: RouteEntry; params: Record<string, string> } | null {
  const segs = pathname.split("/").filter(Boolean);
  let best: { entry: RouteEntry; params: Record<string, string>; dynamicCount: number } | null = null;
  for (const entry of ROUTE_TABLE) {
    const pat = entry.pattern.split("/").filter(Boolean);
    if (pat.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    let dynamicCount = 0;
    for (let i = 0; i < pat.length; i++) {
      if (pat[i].startsWith(":")) {
        params[pat[i].slice(1)] = decodeURIComponent(segs[i]);
        dynamicCount++;
      } else if (pat[i] !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok && (!best || dynamicCount < best.dynamicCount)) best = { entry, params, dynamicCount };
  }
  return best ? { entry: best.entry, params: best.params } : null;
}

function envelopeError<T>(code: string, message: string): Envelope<T> {
  return { data: null as T, meta: {}, error: { code, message } };
}

export class InProcessRestPort implements RestPort {
  constructor(private readonly principal: DelegatedPrincipal) {}

  get<T = unknown>(path: string): Promise<Envelope<T>> {
    return this.call<T>("GET", path);
  }
  post<T = unknown>(path: string, body?: unknown): Promise<Envelope<T>> {
    return this.call<T>("POST", path, body);
  }
  delete<T = unknown>(path: string): Promise<Envelope<T>> {
    return this.call<T>("DELETE", path);
  }

  private async call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<Envelope<T>> {
    const url = new URL(path, "http://in-process.invalid");
    const matched = matchRoute(url.pathname);
    if (!matched) return envelopeError<T>("not_found", `No in-process route for ${url.pathname}.`);
    const mod = await matched.entry.load();
    const handler = mod[method];
    if (!handler) return envelopeError<T>("method_not_allowed", `${method} is not supported on ${url.pathname}.`);
    const request = new Request(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
    });
    return runAsPrincipal(this.principal, async () => {
      const res = await handler.call(mod, request, { params: Promise.resolve(matched.params) });
      try {
        return (await res.json()) as Envelope<T>;
      } catch {
        return envelopeError<T>("invalid_response", `Route returned a non-JSON ${res.status} response.`);
      }
    });
  }
}
