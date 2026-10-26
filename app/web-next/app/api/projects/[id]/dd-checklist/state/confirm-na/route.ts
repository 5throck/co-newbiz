// POST /api/projects/[id]/dd-checklist/state/confirm-na - the second person's
// confirmation of a `na` on a MANDATORY DD checklist item (ADR-0186 D5 / design 3.5).
// Human cookie session only; deny-by-default grant (entity-ic-reviewer or
// group-ic-reviewer); na_confirmed_by must differ from assessed_by. Re-assessing the
// row clears the confirmation (upsertChecklistState), so a changed judgement never
// inherits an earlier confirmer.
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";
import { badRequest, fail, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { humanSessionDenied, rateLimited, requireHumanRoleGrant } from "../../../../../../../lib/gate-integrity.ts";
import { isMandatoryChecklistItem } from "../../../../../../../lib/dd-checklist-tailor.ts";
import { scopeOrResponse } from "../../../../../../../lib/dd-target-http.ts";
import { route } from "../../../../../../../lib/route.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const early = humanSessionDenied(request, null);
  if (early) return early;
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const human = humanSessionDenied(request, ctx);
  if (human) return human;
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const denied = requireHumanRoleGrant(ctx, ["entity-ic-reviewer", "group-ic-reviewer"]);
  if (denied) return denied;
  const limited = rateLimited("na_confirm", ctx.userId);
  if (limited) return limited;
  const body = (await request.json().catch(() => null)) as { checklist_id?: string; item_id?: string; target_id?: string } | null;
  const checklistId = body?.checklist_id?.trim();
  const itemId = body?.item_id?.trim();
  if (!checklistId || !itemId) return badRequest("invalid_request", "Both checklist_id and item_id are required.");
  const scope = scopeOrResponse(id, body?.target_id);
  if ("response" in scope) return scope.response;
  const db = getDb();
  const row = db
    .query("SELECT id, status, assessed_by, na_confirmed_by FROM project_checklist_item_state WHERE project_id = ? AND target_id IS ? AND checklist_id = ? AND item_id = ?")
    .get(id, scope.targetId, checklistId, itemId) as { id: string; status: string; assessed_by: string; na_confirmed_by: string | null } | undefined;
  if (!row) return notFound();
  if (row.status !== "na") return fail(409, "not_na", "Only an item currently marked 'na' can be confirmed.");
  if (!isMandatoryChecklistItem(checklistId, itemId)) return fail(409, "confirmation_not_required", "Only a mandatory item's 'na' needs a second-person confirmation.");
  if (row.assessed_by === ctx.userId) {
    return fail(403, "confirmer_must_differ", "The confirmer of a 'na' must differ from the person who marked it.");
  }
  if (row.na_confirmed_by) return fail(409, "already_confirmed", "This 'na' is already confirmed.");
  const now = new Date().toISOString();
  db.run("UPDATE project_checklist_item_state SET na_confirmed_by = ?, na_confirmed_at = ? WHERE id = ?", [ctx.userId, now, row.id]);
  appendAudit(db, { actor: ctx.userId, action: "dd_checklist.na_confirm", target: `${id}:${checklistId}:${itemId}`, now });
  return ok({ id: row.id, na_confirmed_by: ctx.userId, na_confirmed_at: now });
});
