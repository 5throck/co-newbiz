// /api/tokens — self-service personal API tokens
// (docs/designs/2026-10-11-self-service-api-tokens-design.md §4.1).
//
// Issue and revoke are human-session-only: a bearer token cannot mint or
// revoke tokens (no lifetime laundering, no sibling revocation). Issue is
// capped (5 active) and rate-limited (10 per user per hour, in-memory —
// same pattern as /api/oauth/register). All refusals are audited through
// the existing append-only audit_log — no new tables.
import { getDb } from "../../../../../db/client.ts";
import {
  addDays,
  countActivePersonalTokens,
  DEFAULT_TTL_DAYS,
  isAllowedTtl,
  issueApiToken,
  listApiTokens,
  MAX_ACTIVE_TOKENS,
} from "../../../../../db/lib/api-tokens.ts";
import { appendAudit } from "../../../../../db/lib/access-control.ts";
import { authenticate, type AuthContext } from "../../../lib/auth.ts";
import { badRequest, fail, forbidden, ok } from "../../../lib/envelope.ts";

const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_ISSUES_PER_HOUR = 10;
const KEY = Symbol.for("co-newbiz.apiTokenIssueHits");
type Holder = { [KEY]?: Map<string, number[]> };
const holder = globalThis as Holder;
const issueHits = holder[KEY] ?? (holder[KEY] = new Map<string, number[]>());

// Human web session only (same contract as /api/oauth/authorize): a bearer
// token — including the in-process OAuth-delegated principal — cannot mint
// or revoke tokens.
function sessionGate(request: Request): { ok: true; auth: AuthContext } | { ok: false; response: Response } {
  // Any Bearer credential — valid or not — can never pass this gate, so
  // refuse it before authenticate()'s generic scope check can answer
  // insufficient_scope instead of session_required.
  if ((request.headers.get("authorization") ?? "").toLowerCase().startsWith("bearer ")) {
    return {
      ok: false,
      response: forbidden(
        "session_required",
        "Personal API tokens are issued and revoked from your own web session; bearer tokens cannot authorize this action.",
      ),
    };
  }
  const auth = authenticate(request);
  if (!auth.ok) return auth;
  if (auth.auth.via !== "cookie") {
    return {
      ok: false,
      response: forbidden(
        "session_required",
        "Personal API tokens are issued and revoked from your own web session; bearer tokens cannot authorize this action.",
      ),
    };
  }
  return auth;
}

// Audit detail carries the refusal reason only — never a token or its hash.
function denyIssue(db: ReturnType<typeof getDb>, userId: string, now: string, reason: string): void {
  appendAudit(db, { actor: userId, action: "api_token_issue_denied", target: reason, now });
}

export async function POST(request: Request) {
  const gate = sessionGate(request);
  if (!gate.ok) return gate.response;
  const auth = gate.auth;

  const db = getDb();
  const now = new Date().toISOString();

  const body = (await request.json().catch(() => null)) as
    | { label?: string; scopes?: string[]; expiresInDays?: number }
    | null;
  if (!body?.label?.trim()) return badRequest("invalid_request", "label is required.");

  const rawScopes = body.scopes && body.scopes.length > 0 ? body.scopes : ["read"];
  const normalized = [...new Set(rawScopes.map((s) => String(s).trim().toLowerCase()))].sort();
  if (normalized.length === 0 || (normalized.join(",") !== "read" && normalized.join(",") !== "read,write")) {
    return badRequest("invalid_request", 'scopes must be ["read"] or ["read","write"].');
  }
  const scopes = normalized;

  // Viewer and admin cannot hold write-scoped tokens (ADR-0146).
  if (scopes.includes("write") && auth.role === "viewer") {
    denyIssue(db, auth.userId, now, "role:viewer");
    return forbidden("role_required", "Personal tokens with the 'write' scope require an analyst account.");
  }
  if (scopes.includes("write") && auth.role === "admin") {
    denyIssue(db, auth.userId, now, "role:admin");
    return forbidden("role_forbidden", "Personal tokens with the 'write' scope require an analyst account.");
  }

  const ttl = body.expiresInDays ?? DEFAULT_TTL_DAYS;
  if (!isAllowedTtl(ttl)) {
    return badRequest("invalid_request", "expiresInDays must be one of 7, 30, 90, or 180.");
  }

  // Rate limit first (cheapest refusal); denials count against the window.
  const nowMs = Date.now();
  const recent = (issueHits.get(auth.userId) ?? []).filter((t) => nowMs - t < RATE_WINDOW_MS);
  if (recent.length >= MAX_ISSUES_PER_HOUR) {
    denyIssue(db, auth.userId, now, "rate_limited");
    return fail(429, "rate_limited", "Too many tokens issued; retry later.");
  }
  recent.push(nowMs);
  issueHits.set(auth.userId, recent);

  if (countActivePersonalTokens(db, auth.userId, now) >= MAX_ACTIVE_TOKENS) {
    denyIssue(db, auth.userId, now, "token_limit");
    return fail(409, "token_limit_reached", "You already have the maximum number of active personal tokens. Revoke one first.");
  }

  try {
    const issued = issueApiToken(db, {
      userId: auth.userId,
      label: body.label.trim(),
      scopes,
      now,
      expiresAt: addDays(now, ttl),
    });
    const res = ok({ token: issued.token, id: issued.id, label: body.label.trim() }, 201, {
      note: "Store this token now — it is never shown again.",
    });
    res.headers.set("cache-control", "no-store");
    return res;
  } catch (err) {
    // Fixed code, generic message; logged server-side without the request body.
    console.error("token issue failed:", err instanceof Error ? err.name : "unknown");
    return fail(500, "token_issue_failed", "Token issue failed.");
  }
}

export async function GET(request: Request) {
  // Any authenticated caller may list its own tokens (design §4.1.1).
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  return ok(listApiTokens(getDb(), auth.auth.userId));
}
