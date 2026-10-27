// POST /api/projects/:id/reconfirm/clear - clear the open re-confirmation requirement (ADR-0186 O-6).
// Body { reason }. Human cookie session only, analyst-or-higher non-admin, project visible (404), insider when MNPI.
// The clearer holds an entity-ic-reviewer or group-ic-reviewer grant (403 human_role_required), is not the recorder of one
// of the project's IC decisions (403 reconfirm_clearer_is_maker), every item is satisfied (409 reconfirm_items_unmet),
// and the reason meets the ack substance profile (422). 409 reconfirm_not_open when nothing is open. Audited
// reconfirm.clear; refusals leave a reconfirm.refused audit row. No system or agent path clears a requirement.
import { getDb } from "../../../../../../../../db/client.ts";
import { requireInsiderIfMnpi } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { humanSessionDenied, rateLimited, recordRefusal } from "../../../../../../lib/gate-integrity.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { clearRequirement, ReconfirmError } from "../../../../../../lib/reconfirm.ts";
import { route } from "../../../../../../lib/route.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const early = humanSessionDenied(request, null);
  if (early) return early;
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const human = humanSessionDenied(request, ctx);
  if (human) return human;
  const denied = requireBusinessActor(ctx, "write");
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const db = getDb();
  try {
    requireInsiderIfMnpi(db, id, ctx.userId);
  } catch (e) {
    return forbidden("insider_required", (e as Error).message);
  }
  const limited = rateLimited("reconfirm_clear", ctx.userId);
  if (limited) return limited;
  const body = (await request.json().catch(() => null)) as { reason?: string } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) return badRequest("invalid_request", "reason is required - a clearance without its reasoning is not recordable.");
  try {
    const out = clearRequirement(db, { projectId: id, by: ctx.userId, reason: reason.slice(0, 2000), now: new Date().toISOString() });
    return ok({ id: out.id, project_id: id, cleared_by: ctx.userId }, 201);
  } catch (e) {
    if (e instanceof ReconfirmError) {
      if (e.failure.status >= 403) recordRefusal(db, { actor: ctx.userId, scope: "reconfirm.clear", target: id }, e.failure.code);
      return fail(e.failure.status, e.failure.code, e.failure.message, e.failure.details);
    }
    throw e;
  }
});
