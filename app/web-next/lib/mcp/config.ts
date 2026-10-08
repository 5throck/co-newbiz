// @version 1.0.0
// MCP / OAuth deployment configuration — ADR-0154, design §3.2 and §4.
//
// CO_NEWBIZ_PUBLIC_ORIGIN pins the issuer and the RFC 8707 resource
// identifier. Production MUST set it: without it the origin is derived from
// the request (X-Forwarded-Proto + Host), which is acceptable for local dev
// but lets a spoofed Host header change the advertised issuer.
// CO_NEWBIZ_MCP_ALLOWED_ORIGINS is a comma list of extra browser Origins
// allowed to call /api/mcp (DNS-rebinding defense); the public origin itself
// is always allowed.

import { requestIsSecure } from "../auth.ts";

export function publicOrigin(request: Request): string {
  const pinned = process.env.CO_NEWBIZ_PUBLIC_ORIGIN?.trim();
  if (pinned) return pinned.replace(/\/+$/, "");
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  return `${requestIsSecure(request) ? "https" : url.protocol.replace(":", "")}://${host}`;
}

export function mcpResource(request: Request): string {
  return `${publicOrigin(request)}/api/mcp`;
}

export function protectedResourceMetadataUrl(request: Request): string {
  return `${publicOrigin(request)}/.well-known/oauth-protected-resource/api/mcp`;
}

export function allowedOrigins(request: Request): string[] {
  const extra = (process.env.CO_NEWBIZ_MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return [publicOrigin(request), ...extra];
}

/** Absent Origin (non-browser client) passes; a present Origin must be allowlisted. */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return allowedOrigins(request).includes(origin.replace(/\/+$/, ""));
}

export function httpsRequired(request: Request): boolean {
  return process.env.NODE_ENV === "production" && !requestIsSecure(request);
}

export function authorizationServerMetadata(request: Request) {
  const issuer = publicOrigin(request);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["read", "write", "propose"],
    authorization_response_iss_parameter_supported: true,
  };
}

export function protectedResourceMetadata(request: Request) {
  return {
    resource: mcpResource(request),
    authorization_servers: [publicOrigin(request)],
    scopes_supported: ["read", "write", "propose"],
    bearer_methods_supported: ["header"],
    resource_name: "co-newbiz MCP",
  };
}

export const NO_STORE_HEADERS = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;

export function oauthJson(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...NO_STORE_HEADERS, ...extra },
  });
}

export function oauthError(error: string, description: string, status = 400): Response {
  return oauthJson({ error, error_description: description }, status);
}

/** Read an OAuth request body: form-encoded per spec, JSON tolerated. */
export async function readForm(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  const out: Record<string, string> = {};
  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    for (const [k, v] of Object.entries(body ?? {})) if (typeof v === "string") out[k] = v;
    return out;
  }
  const text = await request.text().catch(() => "");
  for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}
