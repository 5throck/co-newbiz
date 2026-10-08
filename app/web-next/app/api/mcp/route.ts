// Remote MCP endpoint (Streamable HTTP) — ADR-0154, design §3.2.
// Authentication is the OAuth 2.1 access token audience-bound to this
// resource; session cookies and personal API tokens are not accepted here.
import { handleMcpRequest } from "../../../lib/mcp/http-server.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleMcpRequest(request);
}

export async function GET(request: Request) {
  return handleMcpRequest(request);
}

export async function DELETE(request: Request) {
  return handleMcpRequest(request);
}
