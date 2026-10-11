// /api/tokens/:id — owner-scoped revocation (a token id you do not own is
// indistinguishable from one that does not exist). Human web session only:
// a bearer token cannot revoke sibling tokens
// (docs/designs/2026-10-11-self-service-api-tokens-design.md §4.1.1).
import { getDb } from "../../../../../../db/client.ts";
import { revokeApiToken } from "../../../../../../db/lib/api-tokens.ts";
import { authenticate, type AuthContext } from "../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../lib/envelope.ts";

function sessionGate(request: Request): { ok: true; auth: AuthContext } | { ok: false; response: Response } {
  // Any Bearer credential — valid or not — can never pass this gate, so
  // refuse it before authenticate()'s generic scope check can answer
  // insufficient_scope instead of session_required.
  if ((request.headers.get("authorization") ?? "").toLowerCase().startsWith("bearer ")) {
    return {
      ok: false,
      response: forbidden(
        "session_required",
        "Personal API tokens are issued and revoked from your own web session; bearer tokens cannot authorize this action.",
      ),
    };
  }
  const auth = authenticate(request);
  if (!auth.ok) return auth;
  if (auth.auth.via !== "cookie") {
    return {
      ok: false,
      response: forbidden(
        "session_required",
        "Personal API tokens are issued and revoked from your own web session; bearer tokens cannot authorize this action.",
      ),
    };
  }
  return auth;
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = sessionGate(request);
  if (!gate.ok) return gate.response;
  const auth = gate.auth;
  const { id } = await params;
  const row = getDb().query("SELECT user_id FROM api_token WHERE id = ?").get(id) as { user_id: string } | null;
  if (!row || row.user_id !== auth.userId) return notFound();
  const revoked = revokeApiToken(getDb(), { tokenId: id, revokedBy: auth.userId, now: new Date().toISOString() });
  return ok({ ok: true, revoked });
}
