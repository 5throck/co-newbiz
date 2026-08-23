// @version 1.1.0
/**
 * Account/session engine — Wave 5.5, docs/security-model.md §4,
 * ADR-0009 (PBKDF2 reuse), design v1.0 §4-9.
 *
 * Passwords: PBKDF2-HMAC-SHA256 / 210,000 iterations / 16B salt / 32B key,
 * imported from scripts/lib/auth.ts (FR-SEC-09 requires REUSE, not a copy).
 * Only salt+hash+iterations ever touch the DB; plaintext exists as a function
 * argument and nowhere else — not in logs, not in audit payloads.
 *
 * Sessions: server-side rows; the bearer token is random 32 bytes and only
 * its SHA-256 is stored, so a DB dump cannot be replayed as a login.
 *
 * Lockout: 5 consecutive failures lock the account for 30 minutes
 * (security-model §4). `locked` status and `locked_until` move together.
 *
 * Authentication trail: lockout AND successful login are both audited
 * (`account_locked` / `login`), so repudiation resistance does not depend
 * on which way the attempt went (logout is audited by app/server/auth.ts).
 *
 * Agents have no accounts (FR-SEC-08): every userId here refers to a human.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Database } from "bun:sqlite";
import { hashPassword, verifyPassword } from "../../scripts/lib/auth.ts";
import { ulid } from "./ulid.ts";
import { appendAudit } from "./access-control.ts";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 30;
export const SESSION_HOURS = 12;
export const MIN_PASSWORD_LENGTH = 8;

export type UserRole = "admin" | "analyst" | "viewer";

interface StoredHash {
  password_salt: string;
  password_hash: string;
  password_iterations: number;
}

function storedHashOf(row: StoredHash) {
  return { salt: row.password_salt, hash: row.password_hash, iterations: row.password_iterations };
}

function lockoutDeadline(now: string): string {
  return new Date(new Date(now).getTime() + LOCKOUT_MINUTES * 60_000).toISOString();
}

function sessionExpiry(now: string): string {
  return new Date(new Date(now).getTime() + SESSION_HOURS * 3_600_000).toISOString();
}

export interface CreateUserOptions {
  userId: string;
  role: UserRole;
  password: string;
  displayName?: string;
  createdBy: string;
  now: string;
  wallGroup?: string | null;
}

/**
 * Create an account in `pending` status. Self-signup and admin creation both
 * land here; nothing authenticates until an admin approves (design §4-9).
 */
export async function createUser(db: Database, opts: CreateUserOptions): Promise<void> {
  if (opts.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const existing = db.query("SELECT user_id FROM app_user WHERE user_id = ?").get(opts.userId);
  if (existing) {
    throw new Error(`User '${opts.userId}' already exists.`);
  }
  const hashed = await hashPassword(opts.password);
  db.run(
    `INSERT INTO app_user (id, user_id, display_name, role, status, password_salt, password_hash,
                           password_iterations, wall_group, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [ulid(), opts.userId, opts.displayName ?? null, opts.role, "pending", hashed.salt, hashed.hash, hashed.iterations, opts.wallGroup ?? null, opts.now],
  );
  appendAudit(db, { actor: opts.createdBy, action: "account_create", target: opts.userId, now: opts.now });
}

export interface UserSummary {
  user_id: string;
  display_name: string | null;
  role: UserRole;
  status: string;
  created_at: string;
  approved_at: string | null;
}

/**
 * List accounts for the admin console / CLI. Deliberately selects identity
 * columns only — no hash material ever leaves the engine (FR-SEC-09: not
 * even an admin surface renders password data).
 */
export function listUsers(db: Database): UserSummary[] {
  return db
    .query("SELECT user_id, display_name, role, status, created_at, approved_at FROM app_user ORDER BY created_at")
    .all() as UserSummary[];
}

export interface ApproveUserOptions {
  userId: string;
  approvedBy: string;
  now: string;
}

/** pending -> active. The approver is recorded on the row and in the audit log. */
export function approveUser(db: Database, opts: ApproveUserOptions): void {
  const res = db
    .run("UPDATE app_user SET status = 'active', approved_by = ?, approved_at = ? WHERE user_id = ? AND status = 'pending'", [
      opts.approvedBy,
      opts.now,
      opts.userId,
    ]);
  if (res.changes === 0) {
    throw new Error(`'${opts.userId}' is not a pending account.`);
  }
  appendAudit(db, { actor: opts.approvedBy, action: "account_approve", target: opts.userId, now: opts.now });
}

export type AuthenticateResult =
  | { ok: true; mustChangePassword: boolean; session: { token: string; expiresAt: string } }
  | { ok: false; reason: "invalid_credentials" | "pending_approval" | "disabled" | "locked"; lockedUntil?: string };

export interface AuthenticateOptions {
  userId: string;
  password: string;
  now: string;
}

/**
 * Verify credentials and issue a session. Failure accounting:
 *   - unknown user / wrong password -> identical `invalid_credentials`
 *     (existence is not leaked);
 *   - 5th consecutive failure locks for 30 minutes;
 *   - a successful login clears the counter.
 */
export async function authenticate(db: Database, opts: AuthenticateOptions): Promise<AuthenticateResult> {
  const row = db
    .query("SELECT * FROM app_user WHERE user_id = ?")
    .get(opts.userId) as (StoredHash & {
      user_id: string; status: string; must_change_password: number; failed_attempts: number; locked_until: string | null;
    }) | null;

  if (!row) return { ok: false, reason: "invalid_credentials" };
  if (row.status === "disabled") return { ok: false, reason: "disabled" };
  if (row.status === "pending") return { ok: false, reason: "pending_approval" };
  if (row.locked_until && row.locked_until > opts.now) {
    return { ok: false, reason: "locked", lockedUntil: row.locked_until };
  }

  const valid = await verifyPassword(opts.password, storedHashOf(row));
  if (!valid) {
    const attempts = row.failed_attempts + 1;
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const until = lockoutDeadline(opts.now);
      db.run("UPDATE app_user SET failed_attempts = ?, locked_until = ?, status = 'locked' WHERE user_id = ?", [attempts, until, opts.userId]);
      appendAudit(db, { actor: opts.userId, action: "account_locked", target: opts.userId, now: opts.now });
      return { ok: false, reason: "locked", lockedUntil: until };
    }
    db.run("UPDATE app_user SET failed_attempts = ? WHERE user_id = ?", [attempts, opts.userId]);
    return { ok: false, reason: "invalid_credentials" };
  }

  // Success clears the failure slate (also unlocks an expired lockout).
  db.run("UPDATE app_user SET failed_attempts = 0, locked_until = NULL, status = 'active' WHERE user_id = ?", [opts.userId]);
  const session = issueSession(db, { userId: opts.userId, now: opts.now });
  appendAudit(db, { actor: opts.userId, action: "login", target: session.sessionId, now: opts.now });
  return { ok: true, mustChangePassword: row.must_change_password === 1, session };
}

export interface SessionIssued {
  token: string;
  expiresAt: string;
  sessionId: string;
}

export function issueSession(db: Database, opts: { userId: string; now: string }): SessionIssued {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = sessionExpiry(opts.now);
  const sessionId = ulid();
  db.run(
    "INSERT INTO session (id, user_id, token_hash, created_at, expires_at) VALUES (?,?,?,?,?)",
    [sessionId, opts.userId, tokenHash, opts.now, expiresAt],
  );
  return { token, expiresAt, sessionId };
}

export interface ValidSession {
  userId: string;
  role: UserRole;
  mustChangePassword: boolean;
  sessionId: string;
}

/** Resolve a bearer token to a live session + account role, or null. */
export function validateSession(db: Database, token: string, now: string): ValidSession | null {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = db
    .query(
      `SELECT s.id AS session_id, s.user_id, u.role, u.must_change_password, u.status
       FROM session s JOIN app_user u ON u.user_id = s.user_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    )
    .get(tokenHash, now) as { session_id: string; user_id: string; role: UserRole; must_change_password: number; status: string } | null;
  if (!row || row.status !== "active") return null;
  return { userId: row.user_id, role: row.role, mustChangePassword: row.must_change_password === 1, sessionId: row.session_id };
}

export function revokeSessions(db: Database, opts: { userId: string; exceptSessionId?: string; now: string }): number {
  const res = db
    .run("UPDATE session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id != ?", [
      opts.now,
      opts.userId,
      opts.exceptSessionId ?? "",
    ]);
  return res.changes;
}

async function isPasswordReused(db: Database, userId: string, candidate: string): Promise<boolean> {
  const current = db.query("SELECT password_salt, password_hash, password_iterations FROM app_user WHERE user_id = ?").get(userId) as StoredHash | null;
  if (current && (await verifyPassword(candidate, storedHashOf(current)))) return true;
  const history = db
    .query("SELECT password_salt, password_hash, password_iterations FROM password_history WHERE user_id = ?")
    .all(userId) as StoredHash[];
  for (const h of history) {
    if (await verifyPassword(candidate, storedHashOf(h))) return true;
  }
  return false;
}

function persistNewPassword(db: Database, userId: string, hashed: { salt: string; hash: string; iterations: number }): void {
  db.run(
    "UPDATE app_user SET password_salt = ?, password_hash = ?, password_iterations = ? WHERE user_id = ?",
    [hashed.salt, hashed.hash, hashed.iterations, userId],
  );
}

function archiveCurrentPassword(db: Database, userId: string, current: StoredHash, now: string): void {
  db.run(
    "INSERT INTO password_history (id, user_id, password_salt, password_hash, password_iterations, changed_at) VALUES (?,?,?,?,?,?)",
    [ulid(), userId, current.password_salt, current.password_hash, current.password_iterations, now],
  );
}

export interface ChangePasswordOptions {
  userId: string;
  currentPassword: string;
  newPassword: string;
  now: string;
}

/**
 * User-initiated change (also the completion step of the forced
 * must-change-password flow). The current password must verify; the new one
 * is checked against the current hash and every password_history row; all
 * other sessions are revoked and a fresh one issued (security-model §4).
 */
export async function changePassword(db: Database, opts: ChangePasswordOptions): Promise<SessionIssued> {
  const row = db
    .query("SELECT password_salt, password_hash, password_iterations FROM app_user WHERE user_id = ?")
    .get(opts.userId) as StoredHash | null;
  if (!row) throw new Error(`User '${opts.userId}' does not exist.`);
  if (!(await verifyPassword(opts.currentPassword, storedHashOf(row)))) {
    throw new Error("Current password does not match.");
  }
  if (opts.newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (await isPasswordReused(db, opts.userId, opts.newPassword)) {
    throw new Error("New password matches a previously used password (password_history reuse block).");
  }

  const hashed = await hashPassword(opts.newPassword);
  const issued = db.transaction(() => {
    archiveCurrentPassword(db, opts.userId, row, opts.now);
    persistNewPassword(db, opts.userId, hashed);
    db.run("UPDATE app_user SET must_change_password = 0, failed_attempts = 0, locked_until = NULL WHERE user_id = ?", [opts.userId]);
    revokeSessions(db, { userId: opts.userId, now: opts.now });
    const session = issueSession(db, { userId: opts.userId, now: opts.now });
    appendAudit(db, { actor: opts.userId, action: "password_change", target: opts.userId, now: opts.now });
    return session;
  })();
  return issued;
}

export interface ResetPasswordOptions {
  userId: string;
  tempPassword: string;
  resetBy: string;
  now: string;
}

/**
 * Admin-initiated reset (security-model §4): sets a temporary password,
 * forces the change flow (must_change_password=1), clears the failure
 * counter/lockout, and revokes every existing session. A disabled account
 * cannot be resurrected this way — re-enabling is a separate, audited
 * decision, not a side effect of a reset.
 */
export async function resetPassword(db: Database, opts: ResetPasswordOptions): Promise<void> {
  const row = db.query("SELECT status FROM app_user WHERE user_id = ?").get(opts.userId) as { status: string } | null;
  if (!row) throw new Error(`User '${opts.userId}' does not exist.`);
  if (row.status === "disabled") throw new Error("A disabled account cannot be reset — re-enable it first (separate audited decision).");
  if (opts.tempPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const hashed = await hashPassword(opts.tempPassword);
  db.transaction(() => {
    persistNewPassword(db, opts.userId, hashed);
    db.run("UPDATE app_user SET must_change_password = 1, failed_attempts = 0, locked_until = NULL, status = 'active' WHERE user_id = ?", [opts.userId]);
    revokeSessions(db, { userId: opts.userId, now: opts.now });
    appendAudit(db, { actor: opts.resetBy, action: "password_reset", target: opts.userId, now: opts.now });
  })();
}
