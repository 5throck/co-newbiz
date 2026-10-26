// POST /api/admin/human-roles/:grantId/revoke - revoke a human-role grant (ADR-0186 D6).
// Admin-only, cookie-session-only, audited (grant.revoke). The row is kept with revoked_at/by.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { HumanRoleError, revokeHumanRoleGrant } from "../../../../../../../../db/lib/human-roles.ts";
import { authenticate, requireAdmin } from "../../../../../../lib/auth.ts";
import { fail, notFound, ok } from "../../../../../../lib/envelope.ts";
import { humanSessionDenied, rateLimited } from "../../../../../../lib/gate-integrity.ts";
import { route } from "../../../../../../lib/route.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ grantId: string }> }) => {
  const early = humanSessionDenied(request, null);
  if (early) return early;
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const human = humanSessionDenied(request, ctx);
  if (human) return human;
  const adminCheck = requireAdmin(ctx);
  if (adminCheck) return adminCheck;
  const limited = rateLimited("grant_revoke", ctx.userId);
  if (limited) return limited;
  const { grantId } = await params;
  const db = getDb();
  const now = new Date().toISOString();
  try {
    const row = revokeHumanRoleGrant(db, { id: grantId, revokedBy: ctx.userId, now });
    appendAudit(db, { actor: ctx.userId, action: "grant.revoke", target: `${row.user_id}:${row.role_key}:${row.id}`, now });
    return ok(row);
  } catch (err) {
    if (err instanceof HumanRoleError) {
      if (err.code === "not_found") return notFound();
      return fail(409, err.code, err.message);
    }
    throw err;
  }
});
