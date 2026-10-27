// Gate-integrity rollout plumbing - ADR-0186 design 3.15 / section 7. Flags live in
// gate-integrity-flags.ts (dependency-free); this module adds the shadow audit,
// the apply helper and the human-session guards used by the new routes.
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { hasHumanRole } from "../../../db/lib/human-roles.ts";
import { fail, forbidden, type EnvelopeStatus } from "./envelope.ts";
import { gateIntegrityMode, type GateIntegrityFamily } from "./gate-integrity-flags.ts";
import { humanOnlyDenied, requireBusinessActor, type AuthContext } from "./auth.ts";

export { GATE_INTEGRITY_FAMILIES, gateIntegrityEnvName, gateIntegrityMode, type GateIntegrityFamily, type GateIntegrityMode } from "./gate-integrity-flags.ts";

export const WOULD_BLOCK_TARGET_MAX = 200;
export const WOULD_BLOCK_PER_ACTOR_PER_DAY = 100;

export interface IntegrityFailure {
  status: EnvelopeStatus;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface IntegrityContext {
  entityType: "opportunity" | "project";
  entityId: string;
  gate: string;
  actor: string;
}

/**
 * Record a would-block once per (entity, gate, code, day). Returns true when a
 * row was written. The audit table is append-only; de-duplication is a read
 * of today's rows for the same action and target.
 */
export function recordWouldBlock(db: Database, ctx: IntegrityContext, code: string, now: Date = new Date()): boolean {
  const action = `gate_integrity.would_block:${code}`;
  // Caller-influenced strings are bounded, and one actor can write only a fixed number of rows per day,
  // so shadow mode cannot be used to flood the append-only audit_log.
  const target = `${ctx.entityType}:${ctx.entityId}:${ctx.gate}`.slice(0, WOULD_BLOCK_TARGET_MAX);
  const dayStart = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
  const actorToday = db
    .query("SELECT COUNT(*) AS c FROM audit_log WHERE actor_user_id = ? AND action LIKE 'gate_integrity.would_block:%' AND created_at >= ?")
    .get(ctx.actor, dayStart) as { c: number };
  if (actorToday.c >= WOULD_BLOCK_PER_ACTOR_PER_DAY) return false;
  const seen = db.query("SELECT 1 FROM audit_log WHERE action = ? AND target = ? AND created_at >= ? LIMIT 1").get(action, target, dayStart);
  if (seen) return false;
  appendAudit(db, { actor: ctx.actor, action, target, now: now.toISOString() });
  return true;
}

/**
 * Run one family's rule and return the failure to enforce (or null). `check` returns the failure or
 * null; it is not called at all in off mode. In shadow mode a failure is audited and null is
 * returned (the request proceeds). Used where the caller must unwind a transaction itself.
 */
export function applyFamilyFailure(family: GateIntegrityFamily, ctx: IntegrityContext, check: () => IntegrityFailure | null, db: Database = getDb()): IntegrityFailure | null {
  const mode = gateIntegrityMode(family);
  if (mode === "off") return null;
  const failure = check();
  if (!failure) return null;
  if (mode === "shadow") {
    recordWouldBlock(db, ctx, failure.code);
    return null;
  }
  return failure;
}

/**
 * Run one family's rule. `check` returns the failure or null; it is not called
 * at all in off mode. In shadow mode a failure is audited and null is
 * returned (the request proceeds). In enforce mode the failure becomes the
 * error response.
 */
export function applyFamily(family: GateIntegrityFamily, ctx: IntegrityContext, check: () => IntegrityFailure | null): Response | null {
  const failure = applyFamilyFailure(family, ctx, check);
  return failure ? fail(failure.status, failure.code, failure.message, failure.details) : null;
}

// ── Human-session routes (waiver approve, na confirm, grant admin) ───────────

// Authorization header of any kind is refused before authenticate() so a bearer
// token (or the in-process MCP principal, caught by humanOnlyDenied) can never
// exercise a human-role grant: ADR-0186 design 3.14.
export function bearerPresent(request: Request): boolean {
  return (request.headers.get("authorization") ?? "").toLowerCase().startsWith("bearer ");
}

export function humanSessionDenied(request: Request, auth: AuthContext | null): Response | null {
  if (bearerPresent(request)) {
    return forbidden("human_only", "This action is exercised from a human web session; bearer tokens and agent sessions cannot perform it.");
  }
  if (auth) return humanOnlyDenied(auth, "This action is exercised from a human web session; bearer tokens and agent sessions cannot perform it.");
  return null;
}

/** Analyst-or-higher, non-admin business actor holding one of the roles; deny-by-default (403 human_role_required). */
export function requireHumanRoleGrant(auth: AuthContext, roles: readonly string[]): Response | null {
  const denied = requireBusinessActor(auth, "write");
  if (denied) return denied;
  if (!hasHumanRole(getDb(), auth.userId, roles)) {
    return forbidden("human_role_required", `This action requires an active human-role grant (${roles.join(" | ")}); an administrator issues grants.`);
  }
  return null;
}

// ── Rate limit for the human-session routes (in-memory, same pattern as /api/tokens) ──

const RL_KEY = Symbol.for("co-newbiz.gateIntegrityRateHits");
type RlHolder = { [RL_KEY]?: Map<string, number[]> };
const rlHolder = globalThis as RlHolder;
const rateHits = rlHolder[RL_KEY] ?? (rlHolder[RL_KEY] = new Map<string, number[]>());
const RATE_WINDOW_MS = 60 * 60 * 1000;
export const GATE_INTEGRITY_MAX_ACTIONS_PER_HOUR = 60;

export function rateLimited(bucket: string, userId: string, now: number = Date.now(), max: number = GATE_INTEGRITY_MAX_ACTIONS_PER_HOUR): Response | null {
  const key = `${bucket}:${userId}`;
  const recent = (rateHits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= max) {
    rateHits.set(key, recent);
    return fail(429, "rate_limited", "Too many requests for this action; retry later.");
  }
  recent.push(now);
  rateHits.set(key, recent);
  return null;
}

/** Test seam: forget recorded hits. */
export function resetRateLimits(): void {
  rateHits.clear();
}
