// @version 1.0.0
/**
 * Watch / notification engine — design v1.0 §4-3, ADR-0019, FR-MON-01..04,
 * Wave 5.4.
 *
 * FR-MON-02 (non-negotiable): notification is bidirectional. A RAG upgrade
 * is an opportunity; a downgrade is a warning — both fire, downgrade is
 * never silenced by "good news only" framing.
 *
 * FR-MON-03 fatigue prevention has three independent mechanisms, and this
 * module owns the first two (bundling is a delivery-layer concern, Wave
 * 5.6/5.9):
 *   - cooldown: at most one notification per (project, trigger_type) inside
 *     `watch_rule.cooldown_hours`, EXCEPT kill_criteria, which bypasses
 *     cooldown entirely — a live danger signal repeating every run cycle is
 *     not spam, it is the system correctly refusing to stop warning you
 *     (same philosophy as RAG's "Red is never delayed", rag-engine.ts).
 *   - bundle classification: 'immediate' (urgent) vs 'daily' (everything
 *     else) is recorded on the notification row; a digest sender consumes
 *     'daily' rows later. This module does not send anything — there is no
 *     email/webhook transport yet (Wave 5.6/5.9) — it only decides WHETHER
 *     and HOW a notification should be recorded.
 */

import type { Database } from "bun:sqlite";
import { ulid } from "./ulid.ts";
import type { RagGrade } from "./rag-engine.ts";

export type TriggerType =
  | "rag_upgrade"
  | "rag_downgrade"
  | "kill_criteria"
  | "regulation_change"
  | "threshold_breach"
  | "staleness"
  | "batch_failure";

export type Severity = "opportunity" | "warning" | "urgent" | "info" | "ops";
export type Channel = "in_app" | "email" | "webhook" | "all";
export type Bundle = "immediate" | "daily";

const GRADE_RANK: Record<RagGrade, number> = { red: 0, amber: 1, green: 2 };

// ---------------------------------------------------------------------------
// Subscription management
// ---------------------------------------------------------------------------

export interface CreateWatchOptions {
  projectId: string;
  userId: string;
  now: string;
}

export function createWatch(db: Database, options: CreateWatchOptions): string {
  const id = ulid();
  db.run(
    "INSERT INTO watch (id, project_id, user_id, last_checked_at, created_at) VALUES (?,?,?,NULL,?)",
    [id, options.projectId, options.userId, options.now],
  );
  return id;
}

export interface AddWatchRuleOptions {
  watchId: string;
  triggerType: TriggerType;
  threshold?: number | null;
  cooldownHours?: number;
  channel: Channel;
  adrRef?: string | null;
}

export function addWatchRule(db: Database, options: AddWatchRuleOptions): string {
  const id = ulid();
  db.run(
    "INSERT INTO watch_rule (id, watch_id, trigger_type, threshold, cooldown_hours, channel, adr_ref, enabled) VALUES (?,?,?,?,?,?,?,1)",
    [id, options.watchId, options.triggerType, options.threshold ?? null, options.cooldownHours ?? 24, options.channel, options.adrRef?.trim() || null],
  );
  return id;
}

// ---------------------------------------------------------------------------
// Cooldown
// ---------------------------------------------------------------------------

function hoursBetween(aIso: string, bIso: string): number {
  return (Date.parse(bIso) - Date.parse(aIso)) / 3_600_000;
}

/**
 * True when a notification for this (project, trigger_type) fired within
 * the last `cooldownHours` — the caller should suppress a new send. Always
 * false for kill_criteria (never cooled down, see module docstring).
 */
export function isInCooldown(
  db: Database,
  options: { projectId: string; triggerType: TriggerType; cooldownHours: number; now: string },
): boolean {
  if (options.triggerType === "kill_criteria") return false;
  const last = db
    .query(
      "SELECT sent_at FROM notification WHERE project_id = ? AND trigger_type = ? ORDER BY sent_at DESC LIMIT 1",
    )
    .get(options.projectId, options.triggerType) as { sent_at: string } | null;
  if (!last) return false;
  return hoursBetween(last.sent_at, options.now) < options.cooldownHours;
}

// ---------------------------------------------------------------------------
// Notification recording
// ---------------------------------------------------------------------------

export interface RecordNotificationOptions {
  userId: string;
  projectId: string;
  triggerType: TriggerType;
  severity: Severity;
  payload: string;
  channel: Channel;
  now: string;
}

export function recordNotification(db: Database, options: RecordNotificationOptions): string {
  const id = ulid();
  const bundle: Bundle = options.severity === "urgent" ? "immediate" : "daily";
  db.run(
    "INSERT INTO notification (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, options.userId, options.projectId, options.triggerType, options.severity, options.payload, options.channel, bundle, options.now],
  );
  return id;
}

// ---------------------------------------------------------------------------
// RAG transition -> notification
// ---------------------------------------------------------------------------

export interface EvaluateTransitionOptions {
  projectId: string;
  ragTransitionId: string;
  fromGrade: RagGrade | null;
  toGrade: RagGrade;
  now: string;
}

export interface EvaluateTransitionResult {
  fired: { watchId: string; userId: string; notificationId: string }[];
  suppressedByCooldown: { watchId: string; userId: string }[];
}

/**
 * FR-MON-02: evaluate every active watch on a project against a RAG
 * transition and record notifications for matching, non-cooled-down rules.
 * Direction is derived from grade rank (green=2 > amber=1 > red=0), not
 * from a caller-supplied label — the direction is a fact about the
 * transition, not an opinion the caller could get wrong.
 *
 * A first-ever assessment (fromGrade === null) is not a transition in the
 * upgrade/downgrade sense — nothing to compare against — so it never fires
 * rag_upgrade/rag_downgrade rules. It still fires kill_criteria evaluation
 * separately via evaluateKillCriteria if applicable.
 */
export function evaluateTransitionNotifications(
  db: Database,
  options: EvaluateTransitionOptions,
): EvaluateTransitionResult {
  const result: EvaluateTransitionResult = { fired: [], suppressedByCooldown: [] };
  if (options.fromGrade === null) {
    return result;
  }

  const direction: TriggerType =
    GRADE_RANK[options.toGrade] > GRADE_RANK[options.fromGrade] ? "rag_upgrade" : GRADE_RANK[options.toGrade] < GRADE_RANK[options.fromGrade] ? "rag_downgrade" : null!;
  if (direction === null) {
    return result; // same rank (should not happen — assessRun only records actual changes) — defensive no-op.
  }

  const rules = db
    .query(
      `SELECT wr.id AS rule_id, wr.channel, w.id AS watch_id, w.user_id, wr.cooldown_hours
       FROM watch_rule wr JOIN watch w ON w.id = wr.watch_id
       WHERE w.project_id = ? AND wr.trigger_type = ? AND wr.enabled = 1`,
    )
    .all(options.projectId, direction) as {
    rule_id: string;
    channel: Channel;
    watch_id: string;
    user_id: string;
    cooldown_hours: number;
  }[];

  const severity: Severity = direction === "rag_upgrade" ? "opportunity" : "warning";
  const payload = JSON.stringify({
    trigger: direction,
    from_grade: options.fromGrade,
    to_grade: options.toGrade,
    rag_transition_id: options.ragTransitionId,
  });

  let anyFired = false;
  for (const rule of rules) {
    if (isInCooldown(db, { projectId: options.projectId, triggerType: direction, cooldownHours: rule.cooldown_hours, now: options.now })) {
      result.suppressedByCooldown.push({ watchId: rule.watch_id, userId: rule.user_id });
      continue;
    }
    const notificationId = recordNotification(db, {
      userId: rule.user_id,
      projectId: options.projectId,
      triggerType: direction,
      severity,
      payload,
      channel: rule.channel,
      now: options.now,
    });
    result.fired.push({ watchId: rule.watch_id, userId: rule.user_id, notificationId });
    anyFired = true;
  }

  if (anyFired) {
    db.run("UPDATE rag_transition SET notified = 1 WHERE id = ?", [options.ragTransitionId]);
  }
  return result;
}

/**
 * FR-MON-02 / design §4-3: Kill Criteria triggers the 'urgent' severity on
 * every channel and is NEVER cooldown-suppressed — a project that keeps
 * tripping a kill condition every run cycle needs a human to see that every
 * time, not just the first time (same non-negotiable-immediacy stance the
 * RAG engine takes for a Red candidate).
 */
export function evaluateKillCriteriaNotifications(
  db: Database,
  options: { projectId: string; runId: string; now: string },
): { watchId: string; userId: string; notificationId: string }[] {
  const rules = db
    .query(
      `SELECT wr.id AS rule_id, w.id AS watch_id, w.user_id
       FROM watch_rule wr JOIN watch w ON w.id = wr.watch_id
       WHERE w.project_id = ? AND wr.trigger_type = 'kill_criteria' AND wr.enabled = 1`,
    )
    .all(options.projectId) as { rule_id: string; watch_id: string; user_id: string }[];

  const payload = JSON.stringify({ trigger: "kill_criteria", run_id: options.runId });
  const fired: { watchId: string; userId: string; notificationId: string }[] = [];
  for (const rule of rules) {
    const notificationId = recordNotification(db, {
      userId: rule.user_id,
      projectId: options.projectId,
      triggerType: "kill_criteria",
      severity: "urgent",
      payload,
      channel: "all",
      now: options.now,
    });
    fired.push({ watchId: rule.watch_id, userId: rule.user_id, notificationId });
  }
  return fired;
}
