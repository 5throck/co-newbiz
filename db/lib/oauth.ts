// @version 1.0.0
/**
 * OAuth 2.1 authorization-server engine for the remote MCP endpoint —
 * ADR-0154 §2, design 2026-10-08-wave-m-mcp-parity §4.
 *
 * Rules enforced here (the HTTP routes under app/web-next only parse and
 * shape responses):
 *  - Public clients only (RFC 7591 DCR, token_endpoint_auth_method "none");
 *    PKCE S256 is mandatory. There is no implicit, password, or
 *    client_credentials grant — tokens exist only on behalf of a human
 *    app_user (boundary #1: agents have no accounts).
 *  - Authorization codes: single use, <= 60s, bound to client + exact
 *    redirect_uri + PKCE challenge + resource. A replayed code revokes the
 *    token family it produced.
 *  - Access tokens: 15 minutes, audience-bound (RFC 8707) to the MCP
 *    resource. Refresh tokens: 7 days, rotated on every use; presenting a
 *    rotated/revoked refresh token revokes the whole family.
 *  - Effective scopes = granted scopes ∩ what the user's CURRENT role allows,
 *    evaluated on every validation; a non-active user validates to null.
 *  - Only SHA-256 hashes are stored; token values never reach the audit log.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Database } from "bun:sqlite";
import { ulid } from "./ulid.ts";
import { appendAudit } from "./access-control.ts";

export type OAuthScope = "read" | "write" | "propose";
export const OAUTH_SCOPES: readonly OAuthScope[] = ["read", "write", "propose"];

export const ACCESS_TOKEN_TTL_S = 15 * 60;
export const REFRESH_TOKEN_TTL_S = 7 * 24 * 3600;
export const AUTH_CODE_TTL_S = 60;

const MAX_REDIRECT_URIS = 5;
const MAX_URI_LENGTH = 512;
const MAX_CLIENT_NAME = 100;

export type OAuthErrorCode =
  | "invalid_request" | "invalid_client" | "invalid_grant" | "invalid_scope"
  | "unauthorized_client" | "unsupported_grant_type" | "access_denied" | "invalid_target"
  | "invalid_redirect_uri" | "invalid_client_metadata";

export interface OAuthError {
  ok: false;
  error: OAuthErrorCode;
  description: string;
}

function fail(error: OAuthErrorCode, description: string): OAuthError {
  return { ok: false, error, description };
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function addSeconds(nowIso: string, seconds: number): string {
  return new Date(Date.parse(nowIso) + seconds * 1000).toISOString();
}

function audit(db: Database, actor: string, action: string, target: Record<string, unknown>, now: string): void {
  appendAudit(db, { actor, action, target: JSON.stringify(target), now });
}

// ── Scopes ────────────────────────────────────────────────────────────────

/** Parse a space-delimited scope string. Unknown scopes -> null. */
export function parseScopes(raw: string | null | undefined): OAuthScope[] | null {
  const parts = (raw ?? "").split(/\s+/).filter(Boolean);
  const out: OAuthScope[] = [];
  for (const p of parts) {
    if (!(OAUTH_SCOPES as readonly string[]).includes(p)) return null;
    if (!out.includes(p as OAuthScope)) out.push(p as OAuthScope);
  }
  return out;
}

/**
 * Scopes a role may hold. Mirrors the personal-token rule (POST /api/tokens):
 * viewer is read-only; admin is a system operator kept out of business
 * content (ADR-0091/0146), so read only.
 */
export function allowedScopesForRole(role: string): OAuthScope[] {
  if (role === "analyst") return ["read", "write", "propose"];
  if (role === "viewer" || role === "admin") return ["read"];
  return [];
}

// ── Clients (RFC 7591) ────────────────────────────────────────────────────

export function isAllowedRedirectUri(uri: string): boolean {
  if (uri.length > MAX_URI_LENGTH) return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
  return false;
}

export interface OAuthClient {
  client_id: string;
  name: string;
  redirect_uris: string[];
  registered_by_user_id: string | null;
  verified: boolean;
  created_at: string;
}

export function registerClient(
  db: Database,
  opts: { name: unknown; redirectUris: unknown; registeredByUserId?: string | null; now: string },
): { ok: true; client: OAuthClient } | OAuthError {
  const name = typeof opts.name === "string" ? opts.name.trim() : "";
  if (!name || name.length > MAX_CLIENT_NAME) return fail("invalid_client_metadata", "client_name is required (1-100 chars).");
  if (!Array.isArray(opts.redirectUris) || opts.redirectUris.length === 0 || opts.redirectUris.length > MAX_REDIRECT_URIS) {
    return fail("invalid_redirect_uri", `redirect_uris must list 1-${MAX_REDIRECT_URIS} URIs.`);
  }
  const uris: string[] = [];
  for (const u of opts.redirectUris) {
    if (typeof u !== "string" || !isAllowedRedirectUri(u)) {
      return fail("invalid_redirect_uri", "redirect_uris must be https URIs or loopback http URIs without fragments.");
    }
    uris.push(u);
  }
  const client: OAuthClient = {
    client_id: `mcp_${randomBytes(16).toString("hex")}`,
    name,
    redirect_uris: uris,
    registered_by_user_id: opts.registeredByUserId ?? null,
    verified: false,
    created_at: opts.now,
  };
  db.run(
    "INSERT INTO oauth_client (client_id, name, redirect_uris, registered_by_user_id, verified, created_at) VALUES (?,?,?,?,0,?)",
    [client.client_id, client.name, JSON.stringify(uris), client.registered_by_user_id, opts.now],
  );
  audit(db, client.registered_by_user_id ?? "anonymous", "oauth_client_register", { client_id: client.client_id }, opts.now);
  return { ok: true, client };
}

export function getClient(db: Database, clientId: string): OAuthClient | null {
  const row = db
    .query("SELECT client_id, name, redirect_uris, registered_by_user_id, verified, created_at FROM oauth_client WHERE client_id = ?")
    .get(clientId) as { client_id: string; name: string; redirect_uris: string; registered_by_user_id: string | null; verified: number; created_at: string } | null;
  if (!row) return null;
  return { ...row, redirect_uris: JSON.parse(row.redirect_uris) as string[], verified: row.verified === 1 };
}

// ── Authorization request validation ──────────────────────────────────────

export interface AuthorizeParams {
  responseType: string | null;
  clientId: string | null;
  redirectUri: string | null;
  scope: string | null;
  state: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  resource: string | null;
}

export interface ValidatedAuthorizeRequest {
  client: OAuthClient;
  redirectUri: string;
  scopes: OAuthScope[];
  state: string | null;
  codeChallenge: string;
  resource: string;
}

/**
 * Validate an authorization request. `redirectSafe` tells the caller whether
 * the error may be returned to redirect_uri (only after client + exact
 * redirect_uri match) or must be shown locally (never open-redirect).
 */
export function validateAuthorizeRequest(
  db: Database,
  p: AuthorizeParams,
  expectedResource: string,
): { ok: true; request: ValidatedAuthorizeRequest } | (OAuthError & { redirectSafe: boolean }) {
  const client = p.clientId ? getClient(db, p.clientId) : null;
  if (!client) return { ...fail("invalid_client", "Unknown client_id."), redirectSafe: false };
  if (!p.redirectUri || !client.redirect_uris.includes(p.redirectUri)) {
    return { ...fail("invalid_request", "redirect_uri does not exactly match a registered URI."), redirectSafe: false };
  }
  if (p.responseType !== "code") return { ...fail("invalid_request", "response_type must be 'code'."), redirectSafe: true };
  if (!p.codeChallenge || p.codeChallengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(p.codeChallenge)) {
    return { ...fail("invalid_request", "PKCE with code_challenge_method=S256 is required."), redirectSafe: true };
  }
  const resource = p.resource ?? expectedResource;
  if (resource !== expectedResource) return { ...fail("invalid_target", "resource must be the MCP endpoint."), redirectSafe: true };
  const scopes = parseScopes(p.scope ?? "read");
  if (!scopes || scopes.length === 0) return { ...fail("invalid_scope", "scope must be a subset of 'read write propose'."), redirectSafe: true };
  return { ok: true, request: { client, redirectUri: p.redirectUri, scopes, state: p.state, codeChallenge: p.codeChallenge, resource } };
}

interface LiveUser { user_id: string; role: string; status: string; must_change_password: number }

function liveUser(db: Database, userId: string): LiveUser | null {
  return db.query("SELECT user_id, role, status, must_change_password FROM app_user WHERE user_id = ?").get(userId) as LiveUser | null;
}

/**
 * Issue an authorization code after the human approved consent in their own
 * web session. Scopes the role cannot hold are refused, not silently dropped,
 * so the consent screen and the grant never diverge.
 */
export function issueAuthorizationCode(
  db: Database,
  opts: { userId: string; request: ValidatedAuthorizeRequest; now: string },
): { ok: true; code: string } | OAuthError {
  const user = liveUser(db, opts.userId);
  if (!user || user.status !== "active") return fail("access_denied", "Account is not active.");
  if (user.must_change_password === 1) return fail("access_denied", "Password change is required first.");
  const allowed = allowedScopesForRole(user.role);
  const denied = opts.request.scopes.filter((s) => !allowed.includes(s));
  if (denied.length > 0) return fail("invalid_scope", `Your role cannot grant: ${denied.join(" ")}.`);
  const code = randomToken();
  db.run(
    `INSERT INTO oauth_code (code_hash, user_id, client_id, redirect_uri, pkce_challenge, scopes, resource, expires_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      sha256Hex(code), opts.userId, opts.request.client.client_id, opts.request.redirectUri, opts.request.codeChallenge,
      opts.request.scopes.join(" "), opts.request.resource, addSeconds(opts.now, AUTH_CODE_TTL_S), opts.now,
    ],
  );
  audit(db, opts.userId, "oauth_code_issue", { client_id: opts.request.client.client_id, scopes: opts.request.scopes.join(" ") }, opts.now);
  return { ok: true, code };
}

// ── Token issuance ────────────────────────────────────────────────────────

export interface TokenResponse {
  ok: true;
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

function insertToken(
  db: Database,
  t: { kind: "oauth_access" | "oauth_refresh"; userId: string; clientId: string; familyId: string; scopes: string; audience: string; expiresAt: string; now: string },
): string {
  const token = randomToken();
  db.run(
    `INSERT INTO api_token (id, user_id, token_hash, label, scopes, created_at, kind, client_id, family_id, audience, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [ulid(), t.userId, sha256Hex(token), `oauth:${t.clientId}`, t.scopes, t.now, t.kind, t.clientId, t.familyId, t.audience, t.expiresAt],
  );
  return token;
}

function issuePair(db: Database, p: { userId: string; clientId: string; familyId: string; scopes: string; audience: string; now: string }): TokenResponse {
  const access = insertToken(db, { ...p, kind: "oauth_access", expiresAt: addSeconds(p.now, ACCESS_TOKEN_TTL_S) });
  const refresh = insertToken(db, { ...p, kind: "oauth_refresh", expiresAt: addSeconds(p.now, REFRESH_TOKEN_TTL_S) });
  return { ok: true, access_token: access, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_S, refresh_token: refresh, scope: p.scopes };
}

export function revokeFamily(db: Database, familyId: string, now: string): number {
  return db.run("UPDATE api_token SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL", [now, familyId]).changes;
}

function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export function exchangeAuthorizationCode(
  db: Database,
  opts: { code: string | null; clientId: string | null; redirectUri: string | null; codeVerifier: string | null; resource: string | null; expectedResource: string; now: string },
): TokenResponse | OAuthError {
  if (!opts.code || !opts.clientId || !opts.redirectUri || !opts.codeVerifier) {
    return fail("invalid_request", "code, client_id, redirect_uri and code_verifier are required.");
  }
  const row = db.query("SELECT * FROM oauth_code WHERE code_hash = ?").get(sha256Hex(opts.code)) as {
    code_hash: string; user_id: string; client_id: string; redirect_uri: string; pkce_challenge: string; scopes: string;
    resource: string; expires_at: string; consumed_at: string | null; family_id: string | null;
  } | null;
  if (!row) return fail("invalid_grant", "Unknown authorization code.");
  if (row.consumed_at) {
    // OAuth 2.1 §4.1.3: a replayed code revokes what it produced.
    if (row.family_id) revokeFamily(db, row.family_id, opts.now);
    audit(db, row.user_id, "oauth_code_replay_family_revoked", { client_id: row.client_id, family_id: row.family_id }, opts.now);
    return fail("invalid_grant", "Authorization code already used.");
  }
  // Consume before any other check: a failed attempt burns the code.
  db.run("UPDATE oauth_code SET consumed_at = ? WHERE code_hash = ?", [opts.now, row.code_hash]);
  if (Date.parse(row.expires_at) <= Date.parse(opts.now)) return fail("invalid_grant", "Authorization code expired.");
  if (row.client_id !== opts.clientId) return fail("invalid_grant", "Code was issued to a different client.");
  if (row.redirect_uri !== opts.redirectUri) return fail("invalid_grant", "redirect_uri mismatch.");
  if ((opts.resource ?? row.resource) !== row.resource || row.resource !== opts.expectedResource) {
    return fail("invalid_target", "resource mismatch.");
  }
  if (!pkceMatches(opts.codeVerifier, row.pkce_challenge)) return fail("invalid_grant", "PKCE verification failed.");
  const user = liveUser(db, row.user_id);
  if (!user || user.status !== "active") return fail("invalid_grant", "Account is not active.");

  const familyId = ulid();
  db.run("UPDATE oauth_code SET family_id = ? WHERE code_hash = ?", [familyId, row.code_hash]);
  const pair = issuePair(db, { userId: row.user_id, clientId: row.client_id, familyId, scopes: row.scopes, audience: row.resource, now: opts.now });
  audit(db, row.user_id, "oauth_token_issue", { client_id: row.client_id, family_id: familyId, scopes: row.scopes, grant: "authorization_code" }, opts.now);
  return pair;
}

export function refreshTokens(
  db: Database,
  opts: { refreshToken: string | null; clientId: string | null; scope: string | null; resource: string | null; expectedResource: string; now: string },
): TokenResponse | OAuthError {
  if (!opts.refreshToken || !opts.clientId) return fail("invalid_request", "refresh_token and client_id are required.");
  const row = db
    .query("SELECT id, user_id, client_id, family_id, scopes, audience, expires_at, revoked_at FROM api_token WHERE token_hash = ? AND kind = 'oauth_refresh'")
    .get(sha256Hex(opts.refreshToken)) as {
      id: string; user_id: string; client_id: string; family_id: string; scopes: string; audience: string; expires_at: string; revoked_at: string | null;
    } | null;
  if (!row) return fail("invalid_grant", "Unknown refresh token.");
  if (row.client_id !== opts.clientId) return fail("invalid_grant", "Refresh token was issued to a different client.");
  if (row.revoked_at) {
    // Reuse detection: a rotated (or revoked) refresh token came back.
    const n = revokeFamily(db, row.family_id, opts.now);
    audit(db, row.user_id, "oauth_refresh_reuse_family_revoked", { client_id: row.client_id, family_id: row.family_id, revoked: n }, opts.now);
    return fail("invalid_grant", "Refresh token reuse detected; the token family has been revoked.");
  }
  if (Date.parse(row.expires_at) <= Date.parse(opts.now)) return fail("invalid_grant", "Refresh token expired.");
  if ((opts.resource ?? row.audience) !== row.audience || row.audience !== opts.expectedResource) return fail("invalid_target", "resource mismatch.");
  const granted = row.scopes.split(" ").filter(Boolean);
  let scopes = granted;
  if (opts.scope) {
    const requested = parseScopes(opts.scope);
    if (!requested || requested.length === 0 || requested.some((s) => !granted.includes(s))) {
      return fail("invalid_scope", "A refresh can only narrow the granted scopes.");
    }
    scopes = requested;
  }
  const user = liveUser(db, row.user_id);
  if (!user || user.status !== "active") {
    revokeFamily(db, row.family_id, opts.now);
    return fail("invalid_grant", "Account is not active.");
  }
  // Rotate: revoke the presented refresh token (and the family's live access
  // tokens stay valid until expiry), then issue a new pair in the same family.
  db.run("UPDATE api_token SET revoked_at = ? WHERE id = ?", [opts.now, row.id]);
  const pair = issuePair(db, { userId: row.user_id, clientId: row.client_id, familyId: row.family_id, scopes: scopes.join(" "), audience: row.audience, now: opts.now });
  audit(db, row.user_id, "oauth_token_refresh", { client_id: row.client_id, family_id: row.family_id, scopes: scopes.join(" ") }, opts.now);
  return pair;
}

// ── Validation (resource server side) ────────────────────────────────────

export interface ValidAccessToken {
  tokenId: string;
  userId: string;
  role: string;
  clientId: string;
  familyId: string;
  /** Granted ∩ role-allowed, evaluated now. */
  scopes: OAuthScope[];
  mustChangePassword: boolean;
  expiresAt: string;
}

export function validateAccessToken(db: Database, token: string, audience: string, now: string): ValidAccessToken | null {
  const row = db
    .query(
      `SELECT t.id, t.user_id, t.client_id, t.family_id, t.scopes, t.audience, t.expires_at, u.role, u.status, u.must_change_password
       FROM api_token t JOIN app_user u ON u.user_id = t.user_id
       WHERE t.token_hash = ? AND t.kind = 'oauth_access' AND t.revoked_at IS NULL`,
    )
    .get(sha256Hex(token)) as {
      id: string; user_id: string; client_id: string; family_id: string; scopes: string; audience: string; expires_at: string;
      role: string; status: string; must_change_password: number;
    } | null;
  if (!row || row.status !== "active") return null;
  if (row.audience !== audience) return null;
  if (Date.parse(row.expires_at) <= Date.parse(now)) return null;
  const allowed = allowedScopesForRole(row.role);
  const scopes = (parseScopes(row.scopes) ?? []).filter((s) => allowed.includes(s));
  try {
    db.run("UPDATE api_token SET last_used_at = ? WHERE id = ?", [now, row.id]);
  } catch {
    /* best effort, as in validateApiToken */
  }
  return {
    tokenId: row.id, userId: row.user_id, role: row.role, clientId: row.client_id, familyId: row.family_id,
    scopes, mustChangePassword: row.must_change_password === 1, expiresAt: row.expires_at,
  };
}

// ── Revocation (RFC 7009) and connected apps ──────────────────────────────

/**
 * RFC 7009: always "succeeds" from the caller's view. A refresh token
 * revokes its family; an access token revokes only itself. A token issued to
 * a different client is left alone.
 */
export function revokeToken(db: Database, opts: { token: string | null; clientId: string | null; now: string }): void {
  if (!opts.token) return;
  const row = db
    .query("SELECT id, user_id, kind, client_id, family_id FROM api_token WHERE token_hash = ? AND kind IN ('oauth_access','oauth_refresh')")
    .get(sha256Hex(opts.token)) as { id: string; user_id: string; kind: string; client_id: string; family_id: string } | null;
  if (!row || (opts.clientId && row.client_id !== opts.clientId)) return;
  if (row.kind === "oauth_refresh") revokeFamily(db, row.family_id, opts.now);
  else db.run("UPDATE api_token SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [opts.now, row.id]);
  audit(db, row.user_id, "oauth_token_revoke", { client_id: row.client_id, family_id: row.family_id, kind: row.kind }, opts.now);
}

export interface ConnectedApp {
  client_id: string;
  name: string;
  verified: boolean;
  scopes: string;
  first_authorized_at: string;
  last_used_at: string | null;
}

/** Clients holding a live (unrevoked, unexpired) refresh token for this user. */
export function listConnectedApps(db: Database, userId: string, now: string): ConnectedApp[] {
  const rows = db
    .query(
      `SELECT c.client_id, c.name, c.verified,
              MIN(t.created_at) AS first_authorized_at,
              MAX(t.last_used_at) AS last_used_at,
              GROUP_CONCAT(DISTINCT t.scopes) AS scopes
       FROM api_token t JOIN oauth_client c ON c.client_id = t.client_id
       WHERE t.user_id = ? AND t.kind IN ('oauth_access','oauth_refresh') AND t.revoked_at IS NULL AND t.expires_at > ?
       GROUP BY c.client_id, c.name, c.verified
       ORDER BY last_used_at DESC`,
    )
    .all(userId, now) as Array<{ client_id: string; name: string; verified: number; first_authorized_at: string; last_used_at: string | null; scopes: string | null }>;
  return rows.map((r) => ({
    client_id: r.client_id,
    name: r.name,
    verified: r.verified === 1,
    scopes: [...new Set((r.scopes ?? "").split(/[\s,]+/).filter(Boolean))].join(" "),
    first_authorized_at: r.first_authorized_at,
    last_used_at: r.last_used_at,
  }));
}

/** Revoke every token a user granted to one client. Returns rows revoked. */
export function revokeConnectedApp(db: Database, opts: { userId: string; clientId: string; now: string }): number {
  const n = db.run(
    "UPDATE api_token SET revoked_at = ? WHERE user_id = ? AND client_id = ? AND kind IN ('oauth_access','oauth_refresh') AND revoked_at IS NULL",
    [opts.now, opts.userId, opts.clientId],
  ).changes;
  audit(db, opts.userId, "oauth_app_revoke", { client_id: opts.clientId, revoked: n }, opts.now);
  return n;
}

/** Audit one authenticated use of an access token (one per MCP tool call). */
export function auditTokenUse(
  db: Database,
  opts: { userId: string; clientId: string; familyId: string; tool: string; scope: string | null; result: string; argsHash: string; now: string },
): void {
  audit(db, opts.userId, "mcp_tool_call", {
    client_id: opts.clientId, token_family_id: opts.familyId, tool: opts.tool, scope: opts.scope, result: opts.result, args_sha256: opts.argsHash,
  }, opts.now);
}
