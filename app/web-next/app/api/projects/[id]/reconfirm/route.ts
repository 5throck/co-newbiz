// /api/projects/:id/reconfirm - the legacy-record re-confirmation requirement (ADR-0186 owner decision O-6, migration 0179).
// GET (member of the project): the open requirement with its derived item states, or { open: false }. Read-only.
// POST (administrator, human cookie session only): open a requirement { reason, items? } - items default to all of
// wacc_confirmed | ic_countersign | na_review. No project id is hard-coded anywhere; the script
// scripts/co-newbiz/reconfirm-requirement.ts calls the same function. Audited reconfirm.create. Clearing is a
// separate route (reconfirm/clear) that only an IC reviewer grant holder can use. See lib/reconfirm.ts.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireAdmin, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, fail, notFound, ok } from "../../../../../lib/envelope.ts";
import { humanSessionDenied } from "../../../../../lib/gate-integrity.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { createRequirement, reconfirmStatus, RECONFIRM_ITEMS, ReconfirmError } from "../../../../../lib/reconfirm.ts";
import { route } from "../../../../../lib/route.ts";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true })) return notFound();
  const status = reconfirmStatus(getDb(), id);
  return ok(status ?? { open: false }, 200);
});

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const early = humanSessionDenied(request, null);
  if (early) return early;
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const human = humanSessionDenied(request, auth.auth);
  if (human) return human;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { reason?: string; items?: unknown } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) return badRequest("invalid_request", "reason is required.");
  const items = body?.items === undefined ? [...RECONFIRM_ITEMS] : Array.isArray(body.items) ? (body.items as unknown[]).map(String) : null;
  if (!items) return badRequest("invalid_request", "items must be an array.");
  try {
    const row = createRequirement(getDb(), { projectId: id, items, reason: reason.slice(0, 2000), by: auth.auth.userId, now: new Date().toISOString() });
    return ok({ id: row.id, project_id: id, items: JSON.parse(row.items_json), created_by: row.created_by, created_at: row.created_at }, 201);
  } catch (e) {
    if (e instanceof ReconfirmError) return e.failure.status === 404 ? notFound() : fail(e.failure.status, e.failure.code, e.failure.message, e.failure.details);
    throw e;
  }
});
