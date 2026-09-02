// 관리자 — 사용자별 API 토큰 관리 (발급/목록/폐기).
// db/lib/api-tokens.ts 엔진 재사용: 평문은 발급 시 1회만 반환되고 해시만 저장된다
// (FR-SEC-09). 스코프는 read/write (middleware에서 강제). admin 전용.
import { getDb } from "../../../../../../../../db/client.ts";
import { issueApiToken, listApiTokens, revokeApiToken } from "../../../../../../../../db/lib/api-tokens.ts";
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
  return ok(listApiTokens(db, decodeURIComponent(userId)), 200, { count: listApiTokens(db, decodeURIComponent(userId)).length });
}

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const guard = requireAdmin(request);
  if (!guard.ok) return guard.response;
  const { userId } = await params;
  const targetUser = decodeURIComponent(userId);
  const body = (await request.json().catch(() => null)) as { label?: string; scopes?: string[] } | null;
  if (!body?.label?.trim()) return badRequest("invalid_request", "label은 필수입니다.");
  const db = getDb();
  if (!assertUserExists(db, targetUser)) return notFound();
  try {
    const issued = issueApiToken(db, {
      userId: targetUser,
      label: body.label.trim(),
      scopes: body.scopes && body.scopes.length > 0 ? body.scopes : ["read"],
      now: new Date().toISOString(),
    });
    appendAudit(db, { actor: guard.ctx.userId, action: "api_token_admin_issue", target: issued.id, now: new Date().toISOString() });
    // 평문은 이 응답 1회만 반환된다 (저장 규칙: SHA-256 해시만 보관).
    return ok({ token: issued.token, id: issued.id, label: body.label.trim(), user_id: targetUser }, 201,
      { note: "Store this token now — it is never shown again." });
  } catch (err) {
    return badRequest("token_issue_failed", err instanceof Error ? err.message : "Token issue failed.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const guard = requireAdmin(request);
  if (!guard.ok) return guard.response;
  const { userId } = await params;
  const tokenId = new URL(request.url).searchParams.get("tokenId");
  if (!tokenId) return badRequest("invalid_request", "tokenId는 필수입니다.");
  const db = getDb();
  const targetUser = decodeURIComponent(userId);
  const row = db.query("SELECT user_id FROM api_token WHERE id = ?").get(tokenId) as { user_id: string } | null;
  if (!row || row.user_id !== targetUser) return notFound();
  const revoked = revokeApiToken(db, { tokenId, revokedBy: guard.ctx.userId, now: new Date().toISOString() });
  return ok({ ok: true, revoked });
}
