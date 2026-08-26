// Port of app/server/tokens.ts DELETE /api/tokens/:id — owner-scoped
// revocation (a token id you do not own is indistinguishable from one that
// does not exist).
import { getDb } from "../../../../../../db/client.ts";
import { revokeApiToken } from "../../../../../../db/lib/api-tokens.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { notFound, ok } from "../../../../lib/envelope.ts";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const row = getDb().query("SELECT user_id FROM api_token WHERE id = ?").get(id) as { user_id: string } | null;
  if (!row || row.user_id !== auth.auth.userId) return notFound();
  const revoked = revokeApiToken(getDb(), { tokenId: id, revokedBy: auth.auth.userId, now: new Date().toISOString() });
  return ok({ ok: true, revoked });
}
