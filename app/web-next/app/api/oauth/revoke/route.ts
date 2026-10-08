// RFC 7009 token revocation — ADR-0154 §2. Always 200 (no token oracle).
import { getDb } from "../../../../../../db/client.ts";
import { revokeToken } from "../../../../../../db/lib/oauth.ts";
import { oauthJson, readForm } from "../../../../lib/mcp/config.ts";
import { preflight, withCors } from "../../../../lib/mcp/cors.ts";

export async function POST(request: Request) {
  const form = await readForm(request);
  revokeToken(getDb(), { token: form.token ?? null, clientId: form.client_id ?? null, now: new Date().toISOString() });
  return withCors(oauthJson({}));
}

export async function OPTIONS() {
  return preflight();
}
