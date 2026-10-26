// POST /api/projects/:id/waivers/:waiverId/approve - the authenticated approval act
// (ADR-0186 D5 / design 3.5 and 3.14). The approver is the authenticated cookie
// session user, never a body field. Always enforced (new route, nothing depends on
// it yet): approver differs from requester, holds the waiver's approver_role grant
// (deny-by-default), the term from approval is <= 90 days, approved_at is set.
// Bearer tokens and the in-process MCP principal are rejected (403 human_only):
// a grant is exercised from a human web session only.
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { decideWaiver } from "../../../../../../../../../db/lib/compliance.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";
import { badRequest, fail, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { rateLimited, requireHumanRoleGrant, humanSessionDenied } from "../../../../../../../lib/gate-integrity.ts";
import { waiverApproveFailure } from "../../../../../../../lib/waiver-guard.ts";
import { route } from "../../../../../../../lib/route.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string; waiverId: string }> }) => {
  const early = humanSessionDenied(request, null);
  if (early) return early;
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const human = humanSessionDenied(request, ctx);
  if (human) return human;
  const { id, waiverId } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const limited = rateLimited("waiver_approve", ctx.userId);
  if (limited) return limited;
  const db = getDb();
  const waiver = db.query("SELECT * FROM waiver WHERE id = ?").get(waiverId) as
    | { id: string; project_id: string; requested_by: string; approver_role: string; expires_at: string; status: string }
    | undefined;
  if (!waiver || waiver.project_id !== id) return notFound();
  const now = new Date().toISOString();
  // Grant check first so a non-holder learns nothing about the waiver's state or requester.
  const denied = requireHumanRoleGrant(ctx, [waiver.approver_role]);
  if (denied) return denied;
  const failure = waiverApproveFailure(db, waiver, ctx.userId, now);
  if (failure) return fail(failure.status, failure.code, failure.message, failure.details);
  try {
    const row = decideWaiver(db, { id: waiverId, decision: "approve", decidedBy: ctx.userId, now });
    appendAudit(db, { actor: ctx.userId, action: "waiver.approve", target: `${id}:${waiverId}`, now });
    return ok({ id: row.id, status: row.status, approved_by: row.approved_by, approved_at: row.approved_at });
  } catch (err) {
    return badRequest("invalid_transition", err instanceof Error ? err.message : String(err));
  }
});
