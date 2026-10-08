// Revoke one connected app: every access and refresh token the session user
// granted to that client — ADR-0154 §2. Owner-scoped by construction (the
// UPDATE is keyed on the caller's user_id).
import { getDb } from "../../../../../../../db/client.ts";
import { revokeConnectedApp } from "../../../../../../../db/lib/oauth.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { ok } from "../../../../../lib/envelope.ts";

export async function DELETE(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { clientId } = await params;
  const revoked = revokeConnectedApp(getDb(), { userId: auth.auth.userId, clientId, now: new Date().toISOString() });
  return ok({ revoked });
}
