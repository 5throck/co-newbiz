// 관리자 — 사용자별 API 토큰 관리 (목록/폐기). 발급은 금지된다.
// E2 (design 2026-11-11-owner-decisions-intake-batch §4.2 / DEC-20261111-03
// ruling 2): admins keep visibility (list) and the kill switch (revoke) but
// LOSE minting — the former on-behalf POST minted tokens for any user with
// RAW body.scopes and no scope validation, and the whole handler is removed
// with that hole (no separate scope validation needed). db/lib/api-tokens.ts
// validation is untouched, so existing tokens stay valid until expiry.
import { getDb } from "../../../../../../../../db/client.ts";
import { listApiTokens, revokeApiToken } from "../../../../../../../../db/lib/api-tokens.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireAdmin as authRequireAdmin } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";

function requireAdmin(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth;
  const denied = authRequireAdmin(auth.auth);
  if (denied) return { ok: false as const, response: denied };
  return { ok: true as const, ctx: auth.auth };
}

function assertUserExists(db: ReturnType<typeof getDb>, userId: string) {
  return db.query("SELECT user_id FROM app_user WHERE user_id = ?").get(userId) as { user_id: string } | undefined;
}

export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const guard = requireAdmin(request);
  if (!guard.ok) return guard.response;
  const { userId } = await params;
  const db = getDb();
  if (!assertUserExists(db, decodeURIComponent(userId))) return notFound();
  return ok(listApiTokens(db, decodeURIComponent(userId)), 200, {
    count: listApiTokens(db, decodeURIComponent(userId)).length,
  });
}

// Token issuance on behalf of users is forbidden at the only seam that had it
// (design §4.2 item 2): one audited refusal, audited BEFORE the 403 so even a
// response-reading client cannot race the evidence away. The audit target is
// the requested user id (the refusal reason is the action name itself).
export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const guard = requireAdmin(request);
  if (!guard.ok) return guard.response;
  const { userId } = await params;
  const targetUser = decodeURIComponent(userId);
  const db = getDb();
  const now = new Date().toISOString();
  appendAudit(db, { actor: guard.ctx.userId, action: "api_token_admin_issue_denied", target: targetUser, now });
  return forbidden("role_forbidden", "Administrators cannot issue API tokens on behalf of users.");
}

export async function DELETE(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const guard = requireAdmin(request);
  if (!guard.ok) return guard.response;
  const { userId } = await params;
  const tokenId = new URL(request.url).searchParams.get("tokenId");
  if (!tokenId) return badRequest("invalid_request", "tokenId is required.");
  const db = getDb();
  const targetUser = decodeURIComponent(userId);
  const row = db.query("SELECT user_id FROM api_token WHERE id = ?").get(tokenId) as { user_id: string } | null;
  if (!row || row.user_id !== targetUser) return notFound();
  const revoked = revokeApiToken(db, { tokenId, revokedBy: guard.ctx.userId, now: new Date().toISOString() });
  return ok({ ok: true, revoked });
}
