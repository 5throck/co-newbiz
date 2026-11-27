// GET /api/admin/oauth-clients — the connected-app fleet inventory for the
// admin console (design 2026-11-27-admin-oauth-client-stop-start). Every
// registered client, stopped ones included, with server-derived per-client
// stats. Metadata and counts only: no token values, no redirect_uri contents,
// no user deal data (ADR-0091; FR-SEC-02).
import { getDb } from "../../../../../../db/client.ts";
import { listAdminOAuthClients } from "../../../../../../db/lib/oauth.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const db = getDb();
  return ok({ clients: listAdminOAuthClients(db, new Date().toISOString()) });
}
