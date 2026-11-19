// @version 1.0.0
// Shared responder for the authorization-server discovery documents —
// /.well-known/oauth-authorization-server (RFC 8414) and
// /.well-known/openid-configuration, each with the optional resource-path
// suffix (`/api/mcp`) some clients append. All forms return the same RFC 8414
// body; this server is OAuth only (no id_token), so no OIDC-only fields.
// Design 2026-11-19-oauth-manual-client-registration §3b c1/c2.
import { authorizationServerMetadata, oauthJson } from "./config.ts";
import { withCors } from "./cors.ts";
import { requestId, withRequestId } from "./request-meta.ts";

export async function authServerMetadataResponse(
  request: Request,
  params: Promise<{ path?: string[] }>,
): Promise<Response> {
  const { path } = await params;
  const suffix = (path ?? []).join("/");
  const rid = requestId(request);
  if (suffix !== "" && suffix !== "api/mcp")
    return withRequestId(withCors(oauthJson({ error: "not_found" }, 404)), rid);
  return withRequestId(withCors(oauthJson(authorizationServerMetadata(request))), rid);
}
