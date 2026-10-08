// OAuth 2.1 authorization (consent) API — ADR-0154 §2, design §4.2.
//
// GET  validates the authorization request and returns what the consent
//      page must show (client name, verified status, redirect host, scopes).
// POST records the human's decision and returns the redirect target.
//
// Both require the human's own WEB SESSION (cookie). A bearer token — a
// personal API token or anything an agent holds — is refused, so an agent
// can never approve its own consent (boundary #1). POST additionally goes
// through authenticate()'s Origin + CSRF double-submit checks.
// Errors before the client and exact redirect_uri are verified are never
// sent to redirect_uri (no open redirect).
import { getDb } from "../../../../../../db/client.ts";
import {
  allowedScopesForRole, issueAuthorizationCode, validateAuthorizeRequest, type AuthorizeParams,
} from "../../../../../../db/lib/oauth.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { badRequest, forbidden, ok } from "../../../../lib/envelope.ts";
import { mcpResource, publicOrigin } from "../../../../lib/mcp/config.ts";

function paramsFrom(get: (k: string) => string | null): AuthorizeParams {
  return {
    responseType: get("response_type"),
    clientId: get("client_id"),
    redirectUri: get("redirect_uri"),
    scope: get("scope"),
    state: get("state"),
    codeChallenge: get("code_challenge"),
    codeChallengeMethod: get("code_challenge_method"),
    resource: get("resource"),
  };
}

function redirectWith(redirectUri: string, params: Record<string, string | null>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  return u.toString();
}

function requireHumanSession(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth;
  if (auth.auth.via !== "cookie") {
    return { ok: false as const, response: forbidden("session_required", "OAuth consent requires your own web session; bearer tokens cannot authorize clients.") };
  }
  return auth;
}

export async function GET(request: Request) {
  const auth = requireHumanSession(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const v = validateAuthorizeRequest(getDb(), paramsFrom((k) => url.searchParams.get(k)), mcpResource(request));
  if (!v.ok) {
    if (!v.redirectSafe) return badRequest(v.error, v.description);
    const p = paramsFrom((k) => url.searchParams.get(k));
    return ok({
      valid: false,
      error: v.error,
      error_description: v.description,
      redirect_to: redirectWith(p.redirectUri ?? "", { error: v.error, error_description: v.description, state: p.state, iss: publicOrigin(request) }),
    });
  }
  const allowed = allowedScopesForRole(auth.auth.role);
  return ok({
    valid: true,
    client: { client_id: v.request.client.client_id, name: v.request.client.name, verified: v.request.client.verified },
    redirect_host: new URL(v.request.redirectUri).host,
    scopes: v.request.scopes.map((s) => ({ scope: s, allowed: allowed.includes(s) })),
    user_id: auth.auth.userId,
  });
}

export async function POST(request: Request) {
  const auth = requireHumanSession(request);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as (Record<string, unknown> & { decision?: unknown }) | null;
  if (!body) return badRequest("invalid_request", "JSON body required.");
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : null);
  const db = getDb();
  const v = validateAuthorizeRequest(db, paramsFrom(str), mcpResource(request));
  if (!v.ok) return badRequest(v.error, v.description);
  const iss = publicOrigin(request);
  if (body.decision !== "approve") {
    return ok({ redirect_to: redirectWith(v.request.redirectUri, { error: "access_denied", state: v.request.state, iss }) });
  }
  const issued = issueAuthorizationCode(db, { userId: auth.auth.userId, request: v.request, now: new Date().toISOString() });
  if (!issued.ok) return forbidden(issued.error, issued.description);
  return ok({ redirect_to: redirectWith(v.request.redirectUri, { code: issued.code, state: v.request.state, iss }) });
}
