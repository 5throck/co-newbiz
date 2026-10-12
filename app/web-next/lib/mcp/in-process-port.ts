// @version 1.1.0
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
  PUT?(request: Request, ctx: Ctx): Promise<Response> | Response;
  PATCH?(request: Request, ctx: Ctx): Promise<Response> | Response;
  DELETE?(request: Request, ctx: Ctx): Promise<Response> | Response;
}

interface RouteEntry {
  pattern: string;
  load: () => Promise<RouteModule>;
}

// Every REST route a registry tool wraps (generated from the registry's
// `routes` metadata; tests/unit/mcp-stage-tools.test.ts fails when a tool route
// does not resolve here). Closure, PMI kickoff, and the decision/approval
// execution routes are deliberately NOT listed or are refused below.
export const ROUTE_TABLE: readonly RouteEntry[] = [
  { pattern: "/api/brownfield/:oppId/eval-criteria", load: () => import("../../app/api/brownfield/[oppId]/eval-criteria/route.ts") },
  { pattern: "/api/brownfield/:oppId/target-proposals/web-search", load: () => import("../../app/api/brownfield/[oppId]/target-proposals/web-search/route.ts") },
  { pattern: "/api/brownfield/:oppId/targets", load: () => import("../../app/api/brownfield/[oppId]/targets/route.ts") },
  { pattern: "/api/brownfield/:oppId/targets/:targetId/eval-state", load: () => import("../../app/api/brownfield/[oppId]/targets/[targetId]/eval-state/route.ts") },
  { pattern: "/api/brownfield/:oppId/targets/:targetId/eval-state/:criterionId", load: () => import("../../app/api/brownfield/[oppId]/targets/[targetId]/eval-state/[criterionId]/route.ts") },
  { pattern: "/api/brownfield/:oppId/targets/:targetId/exclude", load: () => import("../../app/api/brownfield/[oppId]/targets/[targetId]/exclude/route.ts") },
  { pattern: "/api/brownfield/:oppId/targets/:targetId/screening-draft", load: () => import("../../app/api/brownfield/[oppId]/targets/[targetId]/screening-draft/route.ts") },
  { pattern: "/api/brownfield/:oppId/targets/:targetId/shortlist", load: () => import("../../app/api/brownfield/[oppId]/targets/[targetId]/shortlist/route.ts") },
  { pattern: "/api/brownfield/:oppId/universe-criteria-draft", load: () => import("../../app/api/brownfield/[oppId]/universe-criteria-draft/route.ts") },
  { pattern: "/api/data-changes", load: () => import("../../app/api/data-changes/route.ts") },
  { pattern: "/api/glossary", load: () => import("../../app/api/glossary/route.ts") },
  { pattern: "/api/glossary/:term", load: () => import("../../app/api/glossary/[term]/route.ts") },
  { pattern: "/api/greenfield/:oppId", load: () => import("../../app/api/greenfield/[oppId]/route.ts") },
  { pattern: "/api/greenfield/:oppId/recommendation", load: () => import("../../app/api/greenfield/[oppId]/recommendation/route.ts") },
  { pattern: "/api/interpretations", load: () => import("../../app/api/interpretations/route.ts") },
  { pattern: "/api/market-overview/analyses", load: () => import("../../app/api/market-overview/analyses/route.ts") },
  { pattern: "/api/market-overview/analyses/:id", load: () => import("../../app/api/market-overview/analyses/[id]/route.ts") },
  { pattern: "/api/market-overview/analyses/:id/rerun", load: () => import("../../app/api/market-overview/analyses/[id]/rerun/route.ts") },
  { pattern: "/api/market-overview/analyses/:id/seed", load: () => import("../../app/api/market-overview/analyses/[id]/seed/route.ts") },
  { pattern: "/api/market-overview/industry/:industryId/chain-links", load: () => import("../../app/api/market-overview/industry/[industryId]/chain-links/route.ts") },
  { pattern: "/api/market-overview/value-chain-graph", load: () => import("../../app/api/market-overview/value-chain-graph/route.ts") },
  { pattern: "/api/notifications", load: () => import("../../app/api/notifications/route.ts") },
  { pattern: "/api/opportunities", load: () => import("../../app/api/opportunities/route.ts") },
  { pattern: "/api/opportunities/:id", load: () => import("../../app/api/opportunities/[id]/route.ts") },
  { pattern: "/api/opportunities/:id/attractiveness-recommendation", load: () => import("../../app/api/opportunities/[id]/attractiveness-recommendation/route.ts") },
  { pattern: "/api/opportunities/:id/capability-gap", load: () => import("../../app/api/opportunities/[id]/capability-gap/route.ts") },
  { pattern: "/api/opportunities/:id/capability-gap/llm-draft", load: () => import("../../app/api/opportunities/[id]/capability-gap/llm-draft/route.ts") },
  { pattern: "/api/opportunities/:id/committee-sessions", load: () => import("../../app/api/opportunities/[id]/committee-sessions/route.ts") },
  { pattern: "/api/opportunities/:id/committee-sessions/:sessionId", load: () => import("../../app/api/opportunities/[id]/committee-sessions/[sessionId]/route.ts") },
  { pattern: "/api/opportunities/:id/factors", load: () => import("../../app/api/opportunities/[id]/factors/route.ts") },
  { pattern: "/api/opportunities/:id/gate-decisions", load: () => import("../../app/api/opportunities/[id]/gate-decisions/route.ts") },
  { pattern: "/api/opportunities/:id/pipeline/status", load: () => import("../../app/api/opportunities/[id]/pipeline/status/route.ts") },
  { pattern: "/api/opportunities/:id/process", load: () => import("../../app/api/opportunities/[id]/process/route.ts") },
  { pattern: "/api/opportunities/:id/reviews", load: () => import("../../app/api/opportunities/[id]/reviews/route.ts") },
  { pattern: "/api/opportunities/:id/reviews/ai-2nd", load: () => import("../../app/api/opportunities/[id]/reviews/ai-2nd/route.ts") },
  { pattern: "/api/opportunities/:id/route-advisory", load: () => import("../../app/api/opportunities/[id]/route-advisory/route.ts") },
  { pattern: "/api/opportunities/:id/route-decision", load: () => import("../../app/api/opportunities/[id]/route-decision/route.ts") },
  { pattern: "/api/opportunities/:id/route-decision/draft", load: () => import("../../app/api/opportunities/[id]/route-decision/draft/route.ts") },
  { pattern: "/api/opportunities/:id/route-recommendation", load: () => import("../../app/api/opportunities/[id]/route-recommendation/route.ts") },
  { pattern: "/api/opportunities/:id/screening", load: () => import("../../app/api/opportunities/[id]/screening/route.ts") },
  { pattern: "/api/opportunities/:id/sketch", load: () => import("../../app/api/opportunities/[id]/sketch/route.ts") },
  { pattern: "/api/opportunities/discover", load: () => import("../../app/api/opportunities/discover/route.ts") },
  { pattern: "/api/our-company/members/:memberId/analyze", load: () => import("../../app/api/our-company/members/[memberId]/analyze/route.ts") },
  { pattern: "/api/our-company/members/:memberId/competitor-proposals/web-search", load: () => import("../../app/api/our-company/members/[memberId]/competitor-proposals/web-search/route.ts") },
  { pattern: "/api/our-company/members/:memberId/competitors", load: () => import("../../app/api/our-company/members/[memberId]/competitors/route.ts") },
  { pattern: "/api/our-company/members/:memberId/profile", load: () => import("../../app/api/our-company/members/[memberId]/profile/route.ts") },
  { pattern: "/api/procedures/resolve", load: () => import("../../app/api/procedures/resolve/route.ts") },
  { pattern: "/api/projects/:id/antitrust", load: () => import("../../app/api/projects/[id]/antitrust/route.ts") },
  { pattern: "/api/projects/:id/business-case", load: () => import("../../app/api/projects/[id]/business-case/route.ts") },
  { pattern: "/api/projects/:id/business-case/adoption-recommendation", load: () => import("../../app/api/projects/[id]/business-case/adoption-recommendation/route.ts") },
  { pattern: "/api/projects/:id/business-case/generate", load: () => import("../../app/api/projects/[id]/business-case/generate/route.ts") },
  { pattern: "/api/projects/:id/business-case/generate/:runId", load: () => import("../../app/api/projects/[id]/business-case/generate/[runId]/route.ts") },
  { pattern: "/api/projects/:id/business-case/params", load: () => import("../../app/api/projects/[id]/business-case/params/route.ts") },
  { pattern: "/api/projects/:id/charter", load: () => import("../../app/api/projects/[id]/charter/route.ts") },
  { pattern: "/api/projects/:id/customer-coc", load: () => import("../../app/api/projects/[id]/customer-coc/route.ts") },
  { pattern: "/api/projects/:id/dd", load: () => import("../../app/api/projects/[id]/dd/route.ts") },
  { pattern: "/api/projects/:id/dd-checklist/tailor", load: () => import("../../app/api/projects/[id]/dd-checklist/tailor/route.ts") },
  { pattern: "/api/projects/:id/deal-structure", load: () => import("../../app/api/projects/[id]/deal-structure/route.ts") },
  { pattern: "/api/projects/:id/deal-structure-recommendation", load: () => import("../../app/api/projects/[id]/deal-structure-recommendation/route.ts") },
  { pattern: "/api/projects/:id/establishment", load: () => import("../../app/api/projects/[id]/establishment/route.ts") },
  { pattern: "/api/projects/:id/gate-brief", load: () => import("../../app/api/projects/[id]/gate-brief/route.ts") },
  { pattern: "/api/projects/:id/gate-decisions", load: () => import("../../app/api/projects/[id]/gate-decisions/route.ts") },
  { pattern: "/api/projects/:id/ic-package", load: () => import("../../app/api/projects/[id]/ic-package/route.ts") },
  { pattern: "/api/projects/:id/incentives", load: () => import("../../app/api/projects/[id]/incentives/route.ts") },
  { pattern: "/api/projects/:id/interviews", load: () => import("../../app/api/projects/[id]/interviews/route.ts") },
  { pattern: "/api/projects/:id/jv-terms", load: () => import("../../app/api/projects/[id]/jv-terms/route.ts") },
  { pattern: "/api/projects/:id/monitoring-brief", load: () => import("../../app/api/projects/[id]/monitoring-brief/route.ts") },
  { pattern: "/api/projects/:id/partners/:partnerId/findings", load: () => import("../../app/api/projects/[id]/partners/[partnerId]/findings/route.ts") },
  { pattern: "/api/projects/:id/permits", load: () => import("../../app/api/projects/[id]/permits/route.ts") },
  { pattern: "/api/projects/:id/pmi/key-talent", load: () => import("../../app/api/projects/[id]/pmi/key-talent/route.ts") },
  { pattern: "/api/projects/:id/pmi/synergy-certifications", load: () => import("../../app/api/projects/[id]/pmi/synergy-certifications/route.ts") },
  { pattern: "/api/projects/:id/process", load: () => import("../../app/api/projects/[id]/process/route.ts") },
  { pattern: "/api/projects/:id/proxy-chain/calibrate", load: () => import("../../app/api/projects/[id]/proxy-chain/calibrate/route.ts") },
  { pattern: "/api/projects/:id/rag/recompute", load: () => import("../../app/api/projects/[id]/rag/recompute/route.ts") },
  { pattern: "/api/projects/:id/reviews", load: () => import("../../app/api/projects/[id]/reviews/route.ts") },
  { pattern: "/api/projects/:id/reviews/ai-2nd", load: () => import("../../app/api/projects/[id]/reviews/ai-2nd/route.ts") },
  { pattern: "/api/projects/:id/scorecard", load: () => import("../../app/api/projects/[id]/scorecard/route.ts") },
  { pattern: "/api/projects/:id/sites", load: () => import("../../app/api/projects/[id]/sites/route.ts") },
  { pattern: "/api/projects/:id/target-check", load: () => import("../../app/api/projects/[id]/target-check/route.ts") },
  { pattern: "/api/projects/:id/target-costing", load: () => import("../../app/api/projects/[id]/target-costing/route.ts") },
  { pattern: "/api/projects/:id/wacc", load: () => import("../../app/api/projects/[id]/wacc/route.ts") },
  { pattern: "/api/projects/:id/waivers", load: () => import("../../app/api/projects/[id]/waivers/route.ts") },
  { pattern: "/api/proposals", load: () => import("../../app/api/proposals/route.ts") },
  { pattern: "/api/proposals/:id", load: () => import("../../app/api/proposals/[id]/route.ts") },
  { pattern: "/api/series", load: () => import("../../app/api/series/route.ts") },
  { pattern: "/api/series/:id/observations", load: () => import("../../app/api/series/[id]/observations/route.ts") },
  { pattern: "/api/synergy/analyses", load: () => import("../../app/api/synergy/analyses/route.ts") },
  { pattern: "/api/synergy/analyses/:id/rerun", load: () => import("../../app/api/synergy/analyses/[id]/rerun/route.ts") },
];

// Human-only mutations (ADR-0154 §5, boundary #2). Even if a tool were ever
// pointed at one of these, the in-process port refuses it: an OAuth-delegated
// agent proposes, the human's own web session executes. Kept in step with
// mcp-coverage.exclusions.yaml by tests/unit/mcp-stage-tools.test.ts.
interface HumanOnlyRule {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  pattern: string;
  bodyField?: { field: string; value: string };
}
export const HUMAN_ONLY_ROUTES: readonly HumanOnlyRule[] = [
  { method: "POST", pattern: "/api/opportunities/:id/gate-decisions" },
  { method: "POST", pattern: "/api/projects/:id/gate-decisions" },
  { method: "POST", pattern: "/api/opportunities/:id/route-decision" },
  { method: "POST", pattern: "/api/projects/:id/business-case/adopt" },
  { method: "POST", pattern: "/api/projects/:id/business-case/legacy-cleanup" },
  { method: "POST", pattern: "/api/projects/:id/business-case/ev-band" },
  { method: "POST", pattern: "/api/projects/:id/business-goals" },
  { method: "POST", pattern: "/api/projects/:id/greenfield-scope" },
  { method: "POST", pattern: "/api/projects/:id/greenfield-scope/workspace-opt-in" },
  { method: "POST", pattern: "/api/projects/:id/brownfield-scope/workspace-opt-in" },
  { method: "POST", pattern: "/api/projects/:id/capex-tranches" },
  { method: "POST", pattern: "/api/projects/:id/target-selection" },
  { method: "POST", pattern: "/api/projects/:id/transition-decision" },
  { method: "POST", pattern: "/api/projects/:id/charter/confirm" },
  { method: "PUT", pattern: "/api/projects/:id/dd-checklist/state" },
  { method: "POST", pattern: "/api/projects/:id/dd-checklist/custom" },
  { method: "POST", pattern: "/api/projects/:id/dd/targets" },
  { method: "POST", pattern: "/api/projects/:id/deal-structure", bodyField: { field: "action", value: "complete_four_axis" } },
  { method: "POST", pattern: "/api/projects/:id/close" },
  { method: "PATCH", pattern: "/api/projects/:id/close" },
  { method: "POST", pattern: "/api/opportunities/:id/close" },
  { method: "POST", pattern: "/api/projects/:id/pmi/kickoff" },
  { method: "POST", pattern: "/api/opportunities/:id/synergy-confirm" },
  { method: "DELETE", pattern: "/api/opportunities/:id/synergy-confirm" },
  { method: "POST", pattern: "/api/brownfield/:oppId/targets/:targetId/rerank" },
  { method: "PATCH", pattern: "/api/projects/:id/waivers/:waiverId" },
  { method: "PUT", pattern: "/api/projects/:id/dd-checklist/tailor/:itemId/review" },
  { method: "POST", pattern: "/api/opportunities/:id/promote" },
];

export function isHumanOnly(method: string, pathname: string, body: unknown): boolean {
  const segs = pathname.split("/").filter(Boolean);
  return HUMAN_ONLY_ROUTES.some((r) => {
    if (r.method !== method) return false;
    const pat = r.pattern.split("/").filter(Boolean);
    if (pat.length !== segs.length || !pat.every((seg, i) => seg.startsWith(":") || seg === segs[i])) return false;
    return !r.bodyField || (body as Record<string, unknown> | null)?.[r.bodyField.field] === r.bodyField.value;
  });
}

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
  put<T = unknown>(path: string, body?: unknown): Promise<Envelope<T>> {
    return this.call<T>("PUT", path, body);
  }
  patch<T = unknown>(path: string, body?: unknown): Promise<Envelope<T>> {
    return this.call<T>("PATCH", path, body);
  }
  delete<T = unknown>(path: string): Promise<Envelope<T>> {
    return this.call<T>("DELETE", path);
  }

  private async call<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<Envelope<T>> {
    const url = new URL(path, "http://in-process.invalid");
    if (isHumanOnly(method, url.pathname, body)) {
      return envelopeError<T>("human_only", "This action is human-only (boundary #2): propose it with a propose_* tool and a person confirms it in the web app.");
    }
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
