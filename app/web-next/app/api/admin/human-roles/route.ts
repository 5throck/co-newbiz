// /api/admin/human-roles - human-role grants (ADR-0186 D6 / design 3.6, 3.14; migration 0176).
// GET lists active grants (?include_revoked=1 adds revoked ones). POST issues one grant.
// Admin-only and cookie-session-only (bearer tokens and agent sessions cannot manage grants).
// A user cannot grant themselves a role and agents hold none (repository rules); every
// issuance is audited (grant.issue). A grant gives authority only on the routes that check
// it (waiver approve, na confirm; later countersign and override), deny-by-default (ADR-0038).
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { HumanRoleError, issueHumanRoleGrant, listHumanRoleGrants, pendingCountersignConflicts, GRANTABLE_ROLE_KEYS } from "../../../../../../db/lib/human-roles.ts";
import { AGENT_KEYS } from "../../../../lib/agent-registry.generated.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { badRequest, fail, ok } from "../../../../lib/envelope.ts";
import { applyFamily, humanSessionDenied, rateLimited, recordRefusal } from "../../../../lib/gate-integrity.ts";
import { route } from "../../../../lib/route.ts";

export const GET = route(async (request: Request) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const url = new URL(request.url);
  const grants = listHumanRoleGrants(getDb(), {
    userId: url.searchParams.get("user_id") ?? undefined,
    includeRevoked: url.searchParams.get("include_revoked") === "1",
  });
  return ok({ grants, grantable_roles: GRANTABLE_ROLE_KEYS }, 200, { count: grants.length });
});

export const POST = route(async (request: Request) => {
  const early = humanSessionDenied(request, null);
  if (early) return early;
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const human = humanSessionDenied(request, ctx);
  if (human) return human;
  const adminCheck = requireAdmin(ctx);
  if (adminCheck) return adminCheck;
  const limited = rateLimited("grant_issue", ctx.userId);
  if (limited) return limited;
  const body = (await request.json().catch(() => null)) as { user_id?: string; role_key?: string } | null;
  const userId = body?.user_id?.trim();
  const roleKey = body?.role_key?.trim();
  if (!userId || !roleKey) return badRequest("invalid_request", "user_id and role_key are required.");
  const db = getDb();
  const now = new Date().toISOString();
  // ADR-0186 D6 (family `maker_checker`): the maker of a pending IC GO cannot be placed in the checker seat for it.
  const conflicts = pendingCountersignConflicts(db, userId, roleKey);
  const conflictDenied = conflicts.length === 0 ? null : applyFamily("maker_checker", { entityType: "project", entityId: conflicts[0].project_id, gate: `grant:${roleKey}`, actor: ctx.userId }, () => ({
    status: 409,
    code: "checker_conflict",
    message: `User ${userId} recorded a pending ${conflicts[0].gate} GO that a ${roleKey} grant would let them countersign; another reviewer must countersign it first.`,
    details: { decisions: conflicts },
  }));
  if (conflictDenied) {
    recordRefusal(db, { actor: ctx.userId, scope: "grant.issue", target: `${userId}:${roleKey}` }, "checker_conflict");
    return conflictDenied;
  }
  try {
    const id = issueHumanRoleGrant(db, { userId, roleKey, grantedBy: ctx.userId, now, agentKeys: AGENT_KEYS });
    appendAudit(db, { actor: ctx.userId, action: "grant.issue", target: `${userId}:${roleKey}:${id}`, now });
    return ok({ id, user_id: userId, role_key: roleKey, granted_by: ctx.userId, granted_at: now }, 201);
  } catch (err) {
    if (err instanceof HumanRoleError) {
      const status = err.code === "already_granted" ? 409 : err.code === "self_grant" || err.code === "agent_account" ? 403 : 400;
      return fail(status, err.code === "self_grant" ? "self_grant_forbidden" : err.code, err.message);
    }
    throw err;
  }
});
