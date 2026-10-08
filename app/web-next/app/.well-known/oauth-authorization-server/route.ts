// RFC 8414 authorization-server metadata — ADR-0154 §2.
import { authorizationServerMetadata, oauthJson } from "../../../lib/mcp/config.ts";
import { preflight, withCors } from "../../../lib/mcp/cors.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withCors(oauthJson(authorizationServerMetadata(request)));
}

export async function OPTIONS() {
  return preflight();
}
