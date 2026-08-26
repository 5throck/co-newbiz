// Port of app/server/admin.ts PUT /api/admin/users/:userId
import { getDb } from "../../../../../../../db/client.ts";
import { approveUser } from "../../../../../../../db/lib/accounts.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";

const ACCOUNT_ROLES = new Set(["admin", "analyst", "viewer"]);

export async function PUT(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const ctx = auth.auth;
  const { userId } = await params;
  const body = (await request.json().catch(() => null)) as { action?: string; role?: string } | null;
  const db = getDb();
  const now = new Date().toISOString();

  if (body?.action === "approve") {
    try {
      approveUser(db, { userId, approvedBy: ctx.userId, now });
    } catch (err) {
      return badRequest("approve_failed", err instanceof Error ? err.message : "Approval failed.");
    }
    return ok({ ok: true, status: "active" });
  }

  if (body?.action === "set_role") {
    if (!body.role || !ACCOUNT_ROLES.has(body.role)) {
      return badRequest("invalid_request", `role must be one of ${[...ACCOUNT_ROLES].join("|")}.`);
    }
    if (userId === ctx.userId && body.role !== "admin") {
      return badRequest("self_demotion_blocked", "An admin cannot demote their own account via this endpoint.");
    }
    const res = db.run("UPDATE app_user SET role = ? WHERE user_id = ?", [body.role, userId]);
    if (res.changes === 0) return notFound();
    appendAudit(db, { actor: ctx.userId, action: "account_set_role", target: `${userId}:${body.role}`, now });
    return ok({ ok: true, role: body.role });
  }

  if (body?.action === "disable") {
    const res = db.run("UPDATE app_user SET status = 'disabled' WHERE user_id = ? AND status != 'disabled'", [userId]);
    if (res.changes === 0) return notFound();
    db.run("UPDATE session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", [now, userId]);
    db.run("UPDATE api_token SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", [now, userId]);
    appendAudit(db, { actor: ctx.userId, action: "account_disable", target: userId, now });
    return ok({ ok: true, status: "disabled" });
  }

  if (body?.action === "enable") {
    const res = db.run("UPDATE app_user SET status = 'active', locked_until = NULL, failed_attempts = 0 WHERE user_id = ?", [userId]);
    if (res.changes === 0) return notFound();
    appendAudit(db, { actor: ctx.userId, action: "account_enable", target: userId, now });
    return ok({ ok: true, status: "active" });
  }

  return badRequest("invalid_request", "action must be approve|set_role|disable|enable.");
}
