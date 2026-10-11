// @version 1.2.0
/**
 * Scoped API-token engine — Wave 5.6, api-spec.md §2, design §4-11.
 * 2026-10-11: self-service personal tokens (design
 * docs/designs/2026-10-11-self-service-api-tokens-design.md §4.1) —
 * expiry (default 30d / max 90d), lazy grace expiry for legacy NULL rows,
 * role re-check at validation (viewer/admin lose 'write'), cnb_pat_ prefix,
 * active-token cap, and per-hour use auditing. All refusals are audited via
 * the existing append-only audit_log — no new tables.
 *
 * Bearer credentials for MCP/CLI clients. Storage rule identical to sessions
 * (FR-SEC-09): the bearer token is random 32 bytes handed to the client once;
 * only its SHA-256 is stored, so a DB dump is not a credential set.
 *
 * Scopes: 'read' allows GET, 'write' allows mutations. Scope enforcement
 * happens in the shared auth gate (app/web-next/lib/auth.ts) before any route
 * handler runs — a handler never has to remember to check the scope itself.
 *
 * Agents have no accounts (FR-SEC-08): every token belongs to a human
 * app_user, and actions taken with it are attributed to that user.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Database } from "bun:sqlite";
import { ulid } from "./ulid.ts";
import { appendAudit } from "./access-control.ts";

export type TokenScope = "read" | "write";
const VALID_SCOPES: readonly TokenScope[] = ["read", "write"];

/**
 * Secret-scanner prefix (gitleaks / GitHub push protection). The hash covers
 * the FULL string including the prefix, so legacy unprefixed tokens keep
 * validating unchanged.
 */
export const TOKEN_PREFIX = "cnb_pat_";

/** Allowed expiry choices (days); anything else is refused at issue. */
export const TOKEN_TTL_DAYS = [7, 30, 90] as const;
export const DEFAULT_TTL_DAYS = 30;
export const MAX_TTL_DAYS = 90;
/** Legacy NULL-expiry rows get this grace window, written once lazily. */
export const GRACE_TTL_DAYS = 30;
/** At most this many active (not revoked, not expired) personal tokens per user. */
export const MAX_ACTIVE_TOKENS = 5;
/** Token use is audited at most once per token per hour (throttled by last_used_at). */
export const USE_AUDIT_INTERVAL_MS = 60 * 60 * 1000;

export function isAllowedTtl(days: unknown): days is number {
  return typeof days === "number" && Number.isInteger(days) && (TOKEN_TTL_DAYS as readonly number[]).includes(days);
}

export function addDays(now: string, days: number): string {
  return new Date(Date.parse(now) + days * 24 * 60 * 60 * 1000).toISOString();
}

export function normalizeScopes(scopes: string[]): TokenScope[] {
  const unique = [...new Set(scopes.map((s) => s.trim().toLowerCase()))];
  for (const s of unique) {
    if (!VALID_SCOPES.includes(s as TokenScope)) {
      throw new Error(`Invalid token scope '${s}' (allowed: read, write).`);
    }
  }
  if (unique.length === 0) throw new Error("A token needs at least one scope (read and/or write).");
  return unique as TokenScope[];
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssueTokenOptions {
  userId: string;
  label: string;
  scopes: string[];
  now: string;
  /** Computed by the route from a validated expiresInDays; the engine trusts it. */
  expiresAt?: string;
}

/** Issue a token — the plaintext is returned exactly once and never stored. */
export function issueApiToken(db: Database, opts: IssueTokenOptions): { token: string; id: string } {
  const scopes = normalizeScopes(opts.scopes);
  const token = TOKEN_PREFIX + randomBytes(32).toString("hex");
  const id = ulid();
  db.run(
    "INSERT INTO api_token (id, user_id, token_hash, label, scopes, created_at, expires_at) VALUES (?,?,?,?,?,?,?)",
    [id, opts.userId, hashToken(token), opts.label, scopes.join(","), opts.now, opts.expiresAt ?? null],
  );
  appendAudit(db, { actor: opts.userId, action: "api_token_issue", target: id, now: opts.now });
  return { token, id };
}

export interface ValidApiToken {
  tokenId: string;
  userId: string;
  role: string;
  scopes: TokenScope[];
  /** Carried so the must-change-password gate applies to tokens too. */
  mustChangePassword: boolean;
}

const ROLE_WRITE_FORBIDDEN = new Set(["viewer", "admin"]);

interface TokenRow {
  token_id: string;
  user_id: string;
  scopes: string;
  role: string;
  status: string;
  must_change_password: number;
  expires_at: string | null;
  last_used_at: string | null;
}

/**
 * Resolve a bearer token to a live, non-revoked, non-expired PERSONAL token
 * of an active account. OAuth access/refresh tokens (migration 0128,
 * ADR-0154) are audience-bound to /api/mcp and are never accepted by the
 * general REST API.
 *
 * Two lazy, best-effort side effects (never block the request on failure):
 * - a legacy NULL-expiry row is stamped once with now + GRACE_TTL_DAYS
 *   (PM decision 2026-10-11: backfill at first validation, not revoked);
 * - 'api_token_use' is audited at most once per token per hour.
 */
export function validateApiToken(db: Database, token: string): ValidApiToken | null {
  const now = new Date();
  const nowIso = now.toISOString();
  const row = db
    .query(
      `SELECT t.id AS token_id, t.user_id, t.scopes, u.role, u.status, u.must_change_password,
              t.expires_at, t.last_used_at
       FROM api_token t JOIN app_user u ON u.user_id = t.user_id
       WHERE t.token_hash = ? AND t.revoked_at IS NULL AND t.kind = 'personal'
         AND (t.expires_at IS NULL OR t.expires_at > ?)`,
    )
    .get(hashToken(token), nowIso) as TokenRow | null;
  if (!row || row.status !== "active") return null;
  // Best-effort housekeeping — never blocks the request on failure.
  try {
    if (row.expires_at === null) {
      db.run("UPDATE api_token SET expires_at = ?, last_used_at = ? WHERE id = ? AND expires_at IS NULL", [
        addDays(nowIso, GRACE_TTL_DAYS),
        nowIso,
        row.token_id,
      ]);
    } else {
      db.run("UPDATE api_token SET last_used_at = ? WHERE id = ?", [nowIso, row.token_id]);
    }
    const lastUsed = row.last_used_at ? Date.parse(row.last_used_at) : 0;
    if (now.getTime() - lastUsed > USE_AUDIT_INTERVAL_MS) {
      appendAudit(db, { actor: row.user_id, action: "api_token_use", target: row.token_id, now: nowIso });
    }
  } catch {
    /* read-only replica or similar — the lookup above already succeeded */
  }
  // Role re-check at validation time (design §4.1.5): a user demoted to
  // viewer (or promoted to admin) loses the 'write' scope on existing tokens.
  const stored = row.scopes.split(",") as TokenScope[];
  const scopes = ROLE_WRITE_FORBIDDEN.has(row.role) ? stored.filter((s) => s !== "write") : stored;
  return {
    tokenId: row.token_id,
    userId: row.user_id,
    role: row.role,
    scopes,
    mustChangePassword: row.must_change_password === 1,
  };
}

export function revokeApiToken(db: Database, opts: { tokenId: string; revokedBy: string; now: string }): boolean {
  const res = db
    .run("UPDATE api_token SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [opts.now, opts.tokenId]);
  if (res.changes > 0) {
    appendAudit(db, { actor: opts.revokedBy, action: "api_token_revoke", target: opts.tokenId, now: opts.now });
  }
  return res.changes > 0;
}

/** Count the caller's active personal tokens (not revoked, not expired) — cap check, no schema change. */
export function countActivePersonalTokens(db: Database, userId: string, now: string): number {
  const row = db
    .query(
      `SELECT COUNT(*) AS n FROM api_token
       WHERE user_id = ? AND kind = 'personal' AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .get(userId, now) as { n: number };
  return row.n;
}

export interface ListedApiToken {
  id: string;
  display_id: string;
  label: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  status: "active" | "expired" | "revoked";
}

/** List a user's tokens — identity columns only, hash material never leaves the engine. */
export function listApiTokens(db: Database, userId: string): ListedApiToken[] {
  const rows = db
    .query(
      `SELECT id, label, scopes, created_at, last_used_at, expires_at, revoked_at
       FROM api_token WHERE user_id = ? AND kind = 'personal' ORDER BY created_at DESC`,
    )
    .all(userId) as (Omit<ListedApiToken, "display_id" | "status">)[];
  const now = new Date().toISOString();
  return rows.map((r) => ({
    ...r,
    display_id: r.id.slice(-6),
    status: r.revoked_at ? "revoked" : r.expires_at && r.expires_at <= now ? "expired" : "active",
  }));
}
