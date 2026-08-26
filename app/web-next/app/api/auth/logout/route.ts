// Port of app/server/auth.ts POST /api/auth/logout — revokes exactly the
// current session or token.
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { authenticate, SESSION_COOKIE } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const a = auth.auth;
  const db = getDb();
  const now = new Date().toISOString();
  if (a.via === "cookie" && a.sessionId) {
    db.run("UPDATE session SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [now, a.sessionId]);
  } else if (a.tokenId) {
    db.run("UPDATE api_token SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [now, a.tokenId]);
  }
  appendAudit(db, { actor: a.userId, action: "logout", target: a.sessionId ?? a.tokenId ?? a.userId, now });
  const response = ok({ ok: true });
  if (a.via === "cookie") response.cookies.delete(SESSION_COOKIE);
  return response;
}
