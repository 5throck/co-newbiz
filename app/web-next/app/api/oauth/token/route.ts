// OAuth 2.1 token endpoint — ADR-0154 §2. authorization_code (+PKCE S256)
// and refresh_token only. client_credentials, password and every other grant
// are refused: no token may exist without a human who consented (boundary #1).
import { getDb } from "../../../../../../db/client.ts";
import { exchangeAuthorizationCode, refreshTokens } from "../../../../../../db/lib/oauth.ts";
import { mcpResource, oauthError, oauthJson, readForm } from "../../../../lib/mcp/config.ts";
import { preflight, withCors } from "../../../../lib/mcp/cors.ts";

export async function POST(request: Request) {
  const form = await readForm(request);
  const db = getDb();
  const now = new Date().toISOString();
  const expectedResource = mcpResource(request);
  let result;
  if (form.grant_type === "authorization_code") {
    result = exchangeAuthorizationCode(db, {
      code: form.code ?? null, clientId: form.client_id ?? null, redirectUri: form.redirect_uri ?? null,
      codeVerifier: form.code_verifier ?? null, resource: form.resource ?? null, expectedResource, now,
    });
  } else if (form.grant_type === "refresh_token") {
    result = refreshTokens(db, {
      refreshToken: form.refresh_token ?? null, clientId: form.client_id ?? null, scope: form.scope ?? null,
      resource: form.resource ?? null, expectedResource, now,
    });
  } else {
    return withCors(oauthError("unsupported_grant_type", "Only authorization_code and refresh_token are supported."));
  }
  if (!result.ok) return withCors(oauthError(result.error, result.description));
  const { ok: _ok, ...body } = result;
  return withCors(oauthJson(body));
}

export async function OPTIONS() {
  return preflight();
}
