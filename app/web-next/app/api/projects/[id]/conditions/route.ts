// GET /api/projects/:id/conditions - the condition precedents of the project's IC decisions (ADR-0186 D4,
// migration 0175). Read-only, same visibility as the gate decisions (404 for non-members). ?status=open|cleared|withdrawn
// filters. Conditions are created with an IC GO (POST gate-decisions { conditions[] }) or a conditional countersign and
// are closed through POST .../conditions/:conditionId/clear | withdraw (human session, IC reviewer grant, a different
// person than the creator).
import { getDb } from "../../../../../../../db/client.ts";
import { logDataAccess, requireInsiderIfMnpi } from "../../../../../../../db/lib/access-control.ts";
import { listConditions, type ConditionStatus } from "../../../../../../../db/repositories/condition-precedent.repository.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { route } from "../../../../../lib/route.ts";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  // Security review J6: reads match the writes - MNPI insider check and a read access-log row.
  try {
    requireInsiderIfMnpi(getDb(), id, auth.auth.userId);
  } catch (e) {
    return forbidden("insider_required", (e as Error).message);
  }
  logDataAccess(getDb(), { userId: auth.auth.userId, tableKey: "condition_precedent", recordRef: id, projectId: id, action: "read", at: new Date().toISOString() });
  const status = new URL(request.url).searchParams.get("status");
  if (status !== null && !["open", "cleared", "withdrawn"].includes(status)) return badRequest("invalid_request", "status must be open | cleared | withdrawn.");
  const conditions = listConditions(id, { status: (status as ConditionStatus | null) ?? undefined, db: getDb() });
  return ok({ conditions }, 200, { count: conditions.length });
});
