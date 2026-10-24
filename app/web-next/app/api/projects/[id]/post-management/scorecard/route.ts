// S12 greenfield scorecard cycle (ADR-0161 Row 2, procedure
// portfolio-venture-monitoring v1.2.0). POST — HUMAN-ONLY (boundary #2):
// cookie session + CSRF (authenticate()), no MCP principal, non-agent,
// analyst+, project visibility, MNPI insider check; bearer / OAuth-delegated /
// agent callers get 403 human_only and the in-process MCP port refuses the
// route via HUMAN_ONLY_ROUTES. Greenfield only (track resolver; 409
// not_applicable_track / needs_classification). Body:
//   { review_cycle: "YYYY-Qn", venture_class?: driving|enabling|emergent,
//     note?: string (<= 2000; required when venture_class differs from the
//     sub-track default), measures: [{ measure_key, value, target_value,
//     status, evidence_ref, observed_at? }] }
// measure_key must be a documented greenfield ramp-up key (or goal:<metric>,
// reference evidence only). Writes only through the venture_scorecard
// repository; the override and every cycle are audited.
import { getDb } from "../../../../../../../../db/client.ts";
import { requireInsiderIfMnpi } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { AGENT_KEYS } from "../../../../../../lib/agent-registry.generated.ts";
import { currentPrincipal } from "../../../../../../lib/mcp/principal-context.ts";
import { recordGreenfieldScorecardFromRequest } from "../../../../../../lib/greenfield-execution.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.via !== "cookie" || currentPrincipal() || AGENT_KEYS.has(ctx.userId)) {
    return forbidden("human_only", "Only a human can record an S12 scorecard cycle (boundary #2) — agents may only draft.");
  }
  if (ctx.role === "viewer") return forbidden("role_required", "Requires the analyst role or higher.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  try {
    requireInsiderIfMnpi(getDb(), id, ctx.userId);
  } catch (e) {
    return forbidden("insider_required", (e as Error).message);
  }
  const body = await request.json().catch(() => null);
  let r;
  try {
    r = recordGreenfieldScorecardFromRequest({ projectId: id, body, actor: ctx.userId });
  } catch (e) {
    const msg = (e as Error).message;
    if (/membership|member|insider/i.test(msg) && !msg.startsWith("venture_scorecard_rejected")) return forbidden("forbidden", msg);
    return badRequest("invalid_request", msg);
  }
  if (r.ok) return ok({ review_cycle: r.review_cycle, venture_class: r.venture_class, row_ids: r.row_ids, measures: r.measures }, 201);
  if (r.code === "invalid_request") return badRequest("invalid_request", r.message);
  if (r.code === "agent_forbidden") return forbidden("human_only", r.message);
  return fail(409, r.code, r.message);
}
