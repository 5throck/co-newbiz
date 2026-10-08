// RFC 7591 dynamic client registration — ADR-0154 §2, design §4.2.
// Public clients only (token_endpoint_auth_method "none"); clients start
// unverified; redirect URIs must be https or loopback http. When
// CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST is set (comma list of hosts),
// only those redirect hosts (plus loopback) may register.
import { getDb } from "../../../../../../db/client.ts";
import { registerClient } from "../../../../../../db/lib/oauth.ts";
import { oauthError, oauthJson } from "../../../../lib/mcp/config.ts";
import { preflight, withCors } from "../../../../lib/mcp/cors.ts";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 20;
const KEY = Symbol.for("co-newbiz.oauth.dcrHits");
type Holder = { [KEY]?: Map<string, number[]> };
const holder = globalThis as Holder;
const hits = holder[KEY] ?? (holder[KEY] = new Map<string, number[]>());

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
}

function hostAllowed(uri: string): boolean {
  const list = (process.env.CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return true;
  const host = new URL(uri).hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || list.includes(host);
}

export async function POST(request: Request) {
  const now = Date.now();
  const ip = clientIp(request);
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) return withCors(oauthError("invalid_request", "Too many registrations; retry later.", 429));
  recent.push(now);
  hits.set(ip, recent);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return withCors(oauthError("invalid_client_metadata", "JSON body required."));
  const method = body.token_endpoint_auth_method ?? "none";
  if (method !== "none") return withCors(oauthError("invalid_client_metadata", "Only public clients (token_endpoint_auth_method=none) are supported."));
  const grants = Array.isArray(body.grant_types) ? body.grant_types : ["authorization_code", "refresh_token"];
  if (grants.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
    return withCors(oauthError("invalid_client_metadata", "Only authorization_code and refresh_token grants are supported."));
  }
  const uris = body.redirect_uris;
  if (Array.isArray(uris) && uris.some((u) => typeof u === "string" && URL.canParse(u) && !hostAllowed(u))) {
    return withCors(oauthError("invalid_redirect_uri", "Redirect host is not on the administrator allowlist."));
  }
  const res = registerClient(getDb(), { name: body.client_name, redirectUris: uris, now: new Date().toISOString() });
  if (!res.ok) return withCors(oauthError(res.error, res.description));
  return withCors(
    oauthJson(
      {
        client_id: res.client.client_id,
        client_id_issued_at: Math.floor(Date.parse(res.client.created_at) / 1000),
        client_name: res.client.name,
        redirect_uris: res.client.redirect_uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      201,
    ),
  );
}

export async function OPTIONS() {
  return preflight();
}
