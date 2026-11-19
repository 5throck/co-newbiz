// RFC 8414 authorization-server metadata — ADR-0154 §2. Served at
// /.well-known/oauth-authorization-server and the path-inserted form
// /.well-known/oauth-authorization-server/api/mcp.
import { preflight } from "../../../../lib/mcp/cors.ts";
import { authServerMetadataResponse } from "../../../../lib/mcp/well-known.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  return authServerMetadataResponse(request, params);
}

export async function OPTIONS() {
  return preflight();
}
