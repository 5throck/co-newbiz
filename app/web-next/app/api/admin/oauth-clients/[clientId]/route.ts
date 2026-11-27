// PUT /api/admin/oauth-clients/[clientId] — stop|start one connected app
// (design 2026-11-27-admin-oauth-client-stop-start). The action-style PUT
// mirrors /api/admin/users/[userId]. stop = stamp stopped_at + revoke every
// user's live oauth tokens in one transaction; start = clear stopped_at only
// (tokens are NOT restored — users must reconnect). The command functions in
// db/lib/oauth.ts own the audit rows (oauth_app_stop / oauth_app_start), one
// per accepted command — the 404/409 refusals here write nothing.
import { getDb } from "../../../../../../../db/client.ts";
import { startClient, stopClient } from "../../../../../../../db/lib/oauth.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { badRequest, fail, notFound, ok } from "../../../../../lib/envelope.ts";

export async function PUT(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const { clientId } = await params;
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "stop" && body?.action !== "start") {
    return badRequest("invalid_request", 'action must be "stop" or "start".');
  }
  const db = getDb();
  const now = new Date().toISOString();

  if (body.action === "stop") {
    const r = stopClient(db, { clientId, actorId: auth.auth.userId, now });
    if (!r.ok) {
      if (r.reason === "unknown") return notFound();
      // Concurrent-admin race: truthful 409 with the current stamp; the UI
      // reloads the list on 409 (self-healing).
      return fail(409, "oauth_client_already_stopped", "The client is already stopped.", { stopped_at: r.stoppedAt });
    }
    return ok({ ok: true, client_id: clientId, status: "stopped", stopped_at: r.stoppedAt, revoked: r.revoked });
  }

  const r = startClient(db, { clientId, actorId: auth.auth.userId, now });
  if (!r.ok) {
    if (r.reason === "unknown") return notFound();
    return fail(409, "oauth_client_already_running", "The client is already operating.");
  }
  return ok({ ok: true, client_id: clientId, status: "operating", users_must_reconnect: true });
}
