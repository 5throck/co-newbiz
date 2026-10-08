// @version 1.0.0
// Public OAuth endpoints (metadata, DCR, token, revoke) carry no cookies and
// no ambient authority, so a wildcard CORS policy is safe and lets browser-
// based MCP clients complete the flow. /oauth/authorize and /api/mcp do NOT
// use this (cookie / Origin-allowlisted surfaces).
export const PUBLIC_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "600",
} as const;

export function withCors(res: Response): Response {
  for (const [k, v] of Object.entries(PUBLIC_CORS)) res.headers.set(k, v);
  return res;
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: PUBLIC_CORS });
}
