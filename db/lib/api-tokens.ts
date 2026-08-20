// @version 1.0.0
/**
 * Scoped API-token engine — Wave 5.6, api-spec.md §2, design §4-11.
 *
 * Bearer credentials for MCP/CLI clients. Storage rule identical to sessions
 * (FR-SEC-09): the bearer token is random 32 bytes handed to the client once;
 * only its SHA-256 is stored, so a DB dump is not a credential set.
 *
 * Scopes: 'read' allows GET, 'write' allows mutations. Scope enforcement
 * happens in app/server/middleware.ts before any route handler runs — a
 * handler never has to remember to check the scope itself.
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
}

/** Issue a token — the plaintext is returned exactly once and never stored. */
export function issueApiToken(db: Database, opts: IssueTokenOptions): { token: string; id: string } {
  const scopes = normalizeScopes(opts.scopes);
  const token = randomBytes(32).toString("hex");
  const id = ulid();
  db.run(
    "INSERT INTO api_token (id, user_id, token_hash, label, scopes, created_at) VALUES (?,?,?,?,?,?)",
    [id, opts.userId, hashToken(token), opts.label, scopes.join(","), opts.now],
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

/** Resolve a bearer token to a live, non-revoked token of an active account. */
export function validateApiToken(db: Database, token: string): ValidApiToken | null {
  const row = db
    .query(
      `SELECT t.id AS token_id, t.user_id, t.scopes, u.role, u.status, u.must_change_password
       FROM api_token t JOIN app_user u ON u.user_id = t.user_id
       WHERE t.token_hash = ? AND t.revoked_at IS NULL`,
    )
    .get(hashToken(token)) as { token_id: string; user_id: string; scopes: string; role: string; status: string; must_change_password: number } | null;
  if (!row || row.status !== "active") return null;
  // Best-effort last-used stamp — never blocks the request on failure.
  try {
    db.run("UPDATE api_token SET last_used_at = ? WHERE id = ?", [new Date().toISOString(), row.token_id]);
  } catch {
    /* read-only replica or similar — the lookup above already succeeded */
  }
  return {
    tokenId: row.token_id,
    userId: row.user_id,
    role: row.role,
    scopes: row.scopes.split(",") as TokenScope[],
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

/** List a user's tokens — identity columns only, hash material never leaves the engine. */
export function listApiTokens(db: Database, userId: string) {
  return db
    .query(
      "SELECT id, label, scopes, created_at, last_used_at, revoked_at FROM api_token WHERE user_id = ? ORDER BY created_at DESC",
    )
    .all(userId) as { id: string; label: string; scopes: string; created_at: string; last_used_at: string | null; revoked_at: string | null }[];
}
