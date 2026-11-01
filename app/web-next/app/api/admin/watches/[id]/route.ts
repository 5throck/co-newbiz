// Admin watch PATCH / DELETE (design 2026-10-29-scheduled-jobs-design §13.6, P4).
//
// Schema honesty (the actual watch shape: id, project_id, user_id, last_checked_at,
// created_at — 0007, rebuilt verbatim in 0033; no name, no enabled column):
//   - "rename" is NOT implementable without a schema change — a `name` field is
//     rejected with that exact explanation (reported as drift, not improvised).
//   - enable/disable is implemented at RULE level (§13.6: "a disabled rule or watch
//     is skipped at evaluation time" — the engine queries filter wr.enabled only), so
//     PATCH {enabled: false} disables ALL the watch's rules and {enabled: true}
//     re-enables them. DELETE is the §13.6 soft delete: the same disable-all-rules
//     write, audited as watch_delete; the watch row itself stays (append-only spirit,
//     and evaluation of a zero-enabled-rule watch is a natural no-op).
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";

function loadWatch(db: ReturnType<typeof getDb>, id: string): { id: string; project_id: string; user_id: string } | undefined {
  return db.query("SELECT id, project_id, user_id FROM watch WHERE id = ?").get(id) as
    | { id: string; project_id: string; user_id: string }
    | undefined;
}

function setAllRules(db: ReturnType<typeof getDb>, watchId: string, enabled: number): number {
  return db.run("UPDATE watch_rule SET enabled = ? WHERE watch_id = ?", [enabled, watchId]).changes;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("invalid_request", "request body must be a JSON object.");
  }
  if ("name" in body) {
    // Drift note (§13.6 says "rename"): the watch table has no name column — see module docstring.
    return badRequest("invalid_request", "rename is not supported: the watch table has no name column (schema 0007/0033).");
  }
  const unknownFields = Object.keys(body).filter((k) => k !== "enabled");
  if (unknownFields.length > 0) {
    return badRequest("invalid_request", `unknown field(s): ${unknownFields.join(", ")} (only enabled is supported).`);
  }
  if (typeof body.enabled !== "boolean") {
    return badRequest("invalid_request", "enabled (boolean) is required — watch-level enable/disable maps to all of the watch's rules.");
  }

  const db = getDb();
  const watch = loadWatch(db, id);
  if (!watch) return notFound();

  const changed = setAllRules(db, id, body.enabled ? 1 : 0);
  appendAudit(db, {
    actor: auth.auth.userId,
    action: "watch_update",
    target: `${id}: enabled=${body.enabled ? 1 : 0} (${changed} rule(s) of project ${watch.project_id})`,
    now: new Date().toISOString(),
  });
  return ok({ id, enabled: body.enabled, rules_updated: changed });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;
  const { id } = await params;

  const db = getDb();
  const watch = loadWatch(db, id);
  if (!watch) return notFound();

  // Soft delete per §13.6: disable the watch AND all its rules — the watch-level
  // "disable" IS disable-all-rules (no watch.enabled column), and the row stays.
  const disabled = setAllRules(db, id, 0);
  appendAudit(db, {
    actor: auth.auth.userId,
    action: "watch_delete",
    target: `${id} (soft: ${disabled} rule(s) disabled, project ${watch.project_id})`,
    now: new Date().toISOString(),
  });
  return ok({ id, mode: "soft", rules_disabled: disabled });
}
