// POST /api/projects/:id/gate-decisions/:decisionId/countersign - the checker's act on an entity_ic / group_ic GO
// (ADR-0186 D6, design 3.6 and 3.14). Body: { decision: approved | conditional | rejected |
// withdrawn_pending_resubmission, reason, conditions?[] }. Cookie session ONLY (a bearer token, an OAuth-delegated
// token and the in-process MCP principal all get 403 human_only: a grant is exercised from a human web session),
// analyst-or-higher non-admin, project visible (404 otherwise), insider when MNPI. The checker differs from the
// recorder (403 checker_must_differ), holds the matching grant read inside the transaction (403 human_role_required,
// 409 grant_revoked), and a decision is countersigned once. Rate limited. An IC GO is effective only after this.
import { getDb } from "../../../../../../../../../db/client.ts";
import { requireInsiderIfMnpi } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { countersignDecision, COUNTERSIGN_DECISIONS } from "../../../../../../../lib/gate-countersign.ts";
import { parseConditionsInput } from "../../../../../../../lib/gate-conditions.ts";
import { humanSessionDenied, rateLimited, recordRefusal } from "../../../../../../../lib/gate-integrity.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";
import { route } from "../../../../../../../lib/route.ts";
import type { ApprovalDecision } from "../../../../../../../../../db/lib/approval-chain.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string; decisionId: string }> }) => {
  const early = humanSessionDenied(request, null);
  if (early) return early;
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const human = humanSessionDenied(request, ctx);
  if (human) return human;
  const denied = requireBusinessActor(ctx, "write");
  if (denied) return denied;
  const { id, decisionId } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const db = getDb();
  try {
    requireInsiderIfMnpi(db, id, ctx.userId);
  } catch (e) {
    return forbidden("insider_required", (e as Error).message);
  }
  const limited = rateLimited("countersign", ctx.userId);
  if (limited) return limited;
  const body = (await request.json().catch(() => null)) as { decision?: string; reason?: string; conditions?: unknown } | null;
  if (!body?.decision || !(COUNTERSIGN_DECISIONS as readonly string[]).includes(body.decision)) {
    return badRequest("invalid_request", `decision must be one of ${COUNTERSIGN_DECISIONS.join(" | ")}.`);
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return badRequest("invalid_request", "reason is required - a countersign without its reasoning is not recordable.");
  const row = db.query("SELECT gate FROM gate_decision WHERE id = ? AND entity_type = 'project' AND entity_id = ?").get(decisionId, id) as { gate: string } | null;
  if (!row) return notFound();
  const parsed = parseConditionsInput(body.conditions, row.gate, "countersign");
  if (!parsed.ok) return parsed.response;
  const result = countersignDecision(db, {
    projectId: id, decisionId, checkerId: ctx.userId, decision: body.decision as ApprovalDecision, reason: reason.slice(0, 2000),
    conditions: parsed.items, now: new Date().toISOString(),
  });
  // Security review B2: a refused attempt (checker_must_differ, human_role_required, grant_revoked, ...) leaves an audit row.
  if (!result.ok && result.failure.status >= 403) recordRefusal(db, { actor: ctx.userId, scope: "gate_decision.countersign", target: `${id}:${row.gate}:${decisionId}` }, result.failure.code);
  if (!result.ok) return fail(result.failure.status, result.failure.code, result.failure.message, result.failure.details);
  return ok({ id: decisionId, gate: result.gate, decision: result.decision, countersign_state: result.state, effective: result.state === "countersigned", conditions: result.conditionIds }, 201);
});
