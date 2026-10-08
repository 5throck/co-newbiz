// RFC 9728 protected-resource metadata for /api/mcp — served at both
// /.well-known/oauth-protected-resource and the path-inserted form
// /.well-known/oauth-protected-resource/api/mcp. ADR-0154 §2.
import { oauthJson, protectedResourceMetadata } from "../../../../lib/mcp/config.ts";
import { preflight, withCors } from "../../../../lib/mcp/cors.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path } = await params;
  const suffix = (path ?? []).join("/");
  if (suffix !== "" && suffix !== "api/mcp") return withCors(oauthJson({ error: "not_found" }, 404));
  return withCors(oauthJson(protectedResourceMetadata(request)));
}

export async function OPTIONS() {
  return preflight();
}
