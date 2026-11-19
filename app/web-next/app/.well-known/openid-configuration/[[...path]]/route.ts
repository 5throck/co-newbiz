// OIDC-style discovery alias — MCP clients may probe it after (or before) RFC 8414.
// Returns the same OAuth authorization-server document; this server issues no
// id_tokens. Also served with the `/api/mcp` suffix.
import { preflight } from "../../../../lib/mcp/cors.ts";
import { authServerMetadataResponse } from "../../../../lib/mcp/well-known.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  return authServerMetadataResponse(request, params);
}

export async function OPTIONS() {
  return preflight();
}
