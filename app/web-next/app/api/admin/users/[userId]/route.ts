// Port of app/server/admin.ts PUT /api/admin/users/:userId
import { getDb } from "../../../../../../../db/client.ts";
import { approveUser, resetPassword } from "../../../../../../../db/lib/accounts.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";

const ACCOUNT_ROLES = new Set(["admin", "analyst", "viewer"]);
const DISPLAY_NAME_MAX = 60;

// CSPRNG-backed (the temporary password is a credential, not a display value).
function randomBase36(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function PUT(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const ctx = auth.auth;
  const { userId } = await params;
  const body = (await request.json().catch(() => null)) as { action?: string; role?: string; temporary_password?: string; display_name?: string } | null;
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

  if (body?.action === "set_display_name") {
    const name = typeof body.display_name === "string" ? body.display_name.trim() : "";
    if (!name || name.length > DISPLAY_NAME_MAX) {
      return badRequest("invalid_request", `display_name must be 1-${DISPLAY_NAME_MAX} characters.`);
    }
    const res = db.run("UPDATE app_user SET display_name = ? WHERE user_id = ?", [name, userId]);
    if (res.changes === 0) return notFound();
    appendAudit(db, { actor: ctx.userId, action: "account_set_display_name", target: userId, now });
    return ok({ ok: true, display_name: name });
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

  if (body?.action === "reset_password") {
    // Admin-initiated reset: temporary password, forces the change flow,
    // revokes sessions (accounts.resetPassword). The temp password is shown
    // once in this response — never stored in plaintext or audit.
    const tempPassword = body.temporary_password && body.temporary_password.length >= 8 ? body.temporary_password : `tmp-${randomBase36(8)}!A`;
    try {
      await resetPassword(db, { userId, tempPassword, resetBy: ctx.userId, now });
    } catch (err) {
      return badRequest("reset_failed", err instanceof Error ? err.message : "Reset failed.");
    }
    return ok({ ok: true, temporary_password: tempPassword, must_change_password: true });
  }

  if (body?.action === "delete") {
    if (userId === ctx.userId) {
      return badRequest("self_delete_blocked", "An admin cannot delete their own account.");
    }
    // Drop dependent rows BEFORE the user row — the FK constraints are
    // enforced, so deleting app_user first 500s on any account that has
    // ever logged in, changed, or reset a password.
    db.run("DELETE FROM password_history WHERE user_id = ?", [userId]);
    db.run("DELETE FROM session WHERE user_id = ?", [userId]);
    db.run("DELETE FROM api_token WHERE user_id = ?", [userId]);
    const res = db.run("DELETE FROM app_user WHERE user_id = ?", [userId]);
    if (res.changes === 0) return notFound();
    appendAudit(db, { actor: ctx.userId, action: "account_delete", target: userId, now });
    return ok({ ok: true, deleted: userId });
  }

  return badRequest("invalid_request", "action must be approve|set_role|set_display_name|disable|enable|reset_password|delete.");
}
