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
// Trigger metadata (P4 watch-rule validation, design 2026-10-29 §13.6)
// ---------------------------------------------------------------------------

/**
 * The exact trigger_type set the watch_rule CHECK constraint (migration 0007,
 * rebuilt verbatim in 0033) accepts. NOTE: this is 7 values — NOT the
 * notification table's 11-value set (0185): watch_rule never gained the
 * pipeline_paused / establishment_* triggers, and inserts with those values
 * would fail the DB CHECK. The API validates against THIS list.
 */
export const WATCH_RULE_TRIGGER_TYPES: readonly TriggerType[] = [
  "rag_upgrade",
  "rag_downgrade",
  "kill_criteria",
  "regulation_change",
  "threshold_breach",
  "staleness",
  "batch_failure",
];

/**
 * Threshold-bearing triggers, derived from the engine's and the schema's own
 * semantics (design 2026-10-29 §13.6 "derive from watch-engine's usage"):
 *   - `threshold_breach` — migration 0007's column comment fixes the unit:
 *     "an IRR/NPV delta in percentage points".
 *   - `staleness` — P4 owner brief fixes the unit: days since the newest
 *     data_change_log row of the project's live-anchor series.
 * The other five triggers are event-driven (RAG transitions, kill-criteria
 * evaluations, regulation feeds, batch failures) — a threshold has no meaning
 * and must be rejected.
 */
export const THRESHOLD_BEARING_TRIGGERS: readonly TriggerType[] = ["threshold_breach", "staleness"];

export function isThresholdBearing(triggerType: TriggerType): boolean {
  return (THRESHOLD_BEARING_TRIGGERS as readonly string[]).includes(triggerType);
}

/**
 * Severity each trigger's notification is recorded with. Derived from the
 * engine's own producers: rag_upgrade → opportunity / rag_downgrade → warning
 * (evaluateTransitionNotifications), kill_criteria → urgent
 * (evaluateKillCriteriaNotifications, cooldown-bypassing). staleness and
 * threshold_breach have NO engine producer yet — the preview assigns
 * 'warning' (a deterioration signal) as a documented preview-side assumption;
 * severity is a producer decision at fire time, never stored on the rule.
 */
export function deriveSeverityForTrigger(triggerType: TriggerType): Severity | null {
  switch (triggerType) {
    case "rag_upgrade":
      return "opportunity";
    case "rag_downgrade":
      return "warning";
    case "kill_criteria":
      return "urgent";
    case "threshold_breach":
    case "staleness":
      return "warning"; // preview-side assumption — no producer exists yet (see docstring)
    default:
      return null; // regulation_change / batch_failure: event-driven, no current-data basis
  }
}

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
  /**
   * Dry run (P4 preview, design 2026-10-29 §13.6): evaluate which rules WOULD
   * fire without writing anything — no notification rows, and the
   * rag_transition.notified flip is skipped. Fired entries carry
   * notificationId: null.
   */
  dryRun?: boolean;
}

export interface EvaluateTransitionResult {
  fired: { watchId: string; userId: string; notificationId: string | null }[];
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
    const notificationId = options.dryRun
      ? null // dry run: nothing recorded, the caller only learns the rule WOULD fire
      : recordNotification(db, {
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

  if (anyFired && !options.dryRun) {
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
  options: { projectId: string; runId: string; now: string; dryRun?: boolean },
): { watchId: string; userId: string; notificationId: string | null }[] {
  const rules = db
    .query(
      `SELECT wr.id AS rule_id, w.id AS watch_id, w.user_id
       FROM watch_rule wr JOIN watch w ON w.id = wr.watch_id
       WHERE w.project_id = ? AND wr.trigger_type = 'kill_criteria' AND wr.enabled = 1`,
    )
    .all(options.projectId) as { rule_id: string; watch_id: string; user_id: string }[];

  const payload = JSON.stringify({ trigger: "kill_criteria", run_id: options.runId });
  const fired: { watchId: string; userId: string; notificationId: string | null }[] = [];
  for (const rule of rules) {
    const notificationId = options.dryRun
      ? null // dry run: evaluate only, no notification row (P4 preview)
      : recordNotification(db, {
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

// ---------------------------------------------------------------------------
// Draft-rule preview (P4, design 2026-10-29 §13.6) — pure read path
// ---------------------------------------------------------------------------

export interface WatchRuleDraft {
  projectId: string;
  triggerType: TriggerType;
  threshold?: number | null;
  cooldownHours?: number;
  channel: Channel;
}

export interface WatchRulePreviewResult {
  /** false when the trigger is event-driven and has no current-data basis to evaluate */
  evaluated: boolean;
  wouldFire: boolean;
  /** true when the fire is suppressed by the draft's own cooldown window */
  suppressedByCooldown: boolean;
  /** human-readable basis: what current data the decision came from */
  reason: string;
  severity: Severity | null;
  cooldownHours: number;
}

/**
 * Evaluate a NOT-PERSISTED rule draft against the project's current data with
 * zero writes (no notification row, no watermark, no notified flip — pure
 * SELECTs). The per-trigger basis mirrors exactly what the real producers
 * would evaluate:
 *   - rag_upgrade / rag_downgrade: the latest rag_transition of the project,
 *     direction derived from grade rank (same GRADE_RANK rule the engine
 *     uses), cooldown checked with the draft's own window (read-only
 *     isInCooldown).
 *   - kill_criteria: the latest kill_criteria_evaluation rows of the project —
 *     any row with outcome 'triggered' fires; cooldown never applies (FR-MON-03).
 *   - staleness: days since the newest data_change_log row across the latest
 *     run's live-anchor series (the same series the watch:run cycle reads);
 *     fires when the age reaches the draft threshold (days).
 *   - threshold_breach / regulation_change / batch_failure: evaluated:false —
 *     no engine producer derives them from current data today (they are
 *     recorded by their own producer paths), so a preview has no honest basis
 *     and reports that instead of inventing one.
 */
export function previewWatchRule(db: Database, draft: WatchRuleDraft, now: string): WatchRulePreviewResult {
  const cooldownHours = draft.cooldownHours ?? 24;
  const severity = deriveSeverityForTrigger(draft.triggerType);
  const base: WatchRulePreviewResult = {
    evaluated: true,
    wouldFire: false,
    suppressedByCooldown: false,
    reason: "",
    severity,
    cooldownHours,
  };

  if (draft.triggerType === "rag_upgrade" || draft.triggerType === "rag_downgrade") {
    const latest = db
      .query(
        "SELECT from_grade, to_grade, at, reason FROM rag_transition WHERE project_id = ? ORDER BY at DESC, id DESC LIMIT 1",
      )
      .get(draft.projectId) as { from_grade: RagGrade | null; to_grade: RagGrade; at: string; reason: string } | null;
    if (!latest) {
      return { ...base, reason: "no RAG transition recorded for this project yet" };
    }
    if (latest.from_grade === null) {
      return { ...base, reason: `latest assessment (${latest.at}) is a first-ever grade (${latest.to_grade}) — no prior grade to compare` };
    }
    const direction: TriggerType | null =
      GRADE_RANK[latest.to_grade] > GRADE_RANK[latest.from_grade]
        ? "rag_upgrade"
        : GRADE_RANK[latest.to_grade] < GRADE_RANK[latest.from_grade]
          ? "rag_downgrade"
          : null;
    if (direction !== draft.triggerType) {
      return {
        ...base,
        reason: `latest transition ${latest.from_grade}→${latest.to_grade} (${latest.at}) is ${direction ?? "rank-neutral"}, rule trigger is ${draft.triggerType}`,
      };
    }
    const cooled = isInCooldown(db, {
      projectId: draft.projectId,
      triggerType: draft.triggerType,
      cooldownHours,
      now,
    });
    return {
      ...base,
      wouldFire: !cooled,
      suppressedByCooldown: cooled,
      reason: `latest transition ${latest.from_grade}→${latest.to_grade} (${latest.at}) matches ${draft.triggerType}${cooled ? " — inside the cooldown window" : ""}`,
    };
  }

  if (draft.triggerType === "kill_criteria") {
    const triggered = db
      .query(
        `SELECT criterion_id, action, evaluated_at FROM kill_criteria_evaluation
         WHERE project_id = ? AND outcome = 'triggered' ORDER BY evaluated_at DESC, id DESC LIMIT 1`,
      )
      .get(draft.projectId) as { criterion_id: string; action: string; evaluated_at: string } | null;
    if (!triggered) {
      return { ...base, reason: "no triggered kill-criterion in the project's evaluations" };
    }
    // kill_criteria bypasses cooldown entirely (FR-MON-03 — see module docstring).
    return {
      ...base,
      wouldFire: true,
      reason: `kill criterion ${triggered.criterion_id} triggered (${triggered.action}) at ${triggered.evaluated_at} — never cooldown-suppressed`,
    };
  }

  if (draft.triggerType === "staleness") {
    const thresholdDays = draft.threshold ?? 0;
    const latestRun = db
      .query(
        "SELECT id FROM run WHERE project_id = ? AND COALESCE(label, '') NOT LIKE 'gate_integrity_eval:%' ORDER BY created_at DESC LIMIT 1",
      )
      .get(draft.projectId) as { id: string } | null;
    const anchorRefs = latestRun
      ? (
          db
            .query("SELECT DISTINCT anchor_ref FROM assumption WHERE run_id = ? AND kind = 'live' AND anchor_ref IS NOT NULL")
            .all(latestRun.id) as { anchor_ref: string }[]
        ).map((r) => r.anchor_ref)
      : [];
    if (anchorRefs.length === 0) {
      return { ...base, reason: "no live-anchor series on the latest run to measure staleness against" };
    }
    const placeholders = anchorRefs.map(() => "?").join(",");
    const newest = db
      .query(`SELECT MAX(detected_at) AS at FROM data_change_log WHERE series_id IN (${placeholders})`)
      .get(...anchorRefs) as { at: string | null };
    if (!newest.at) {
      return { ...base, wouldFire: true, reason: `no data change ever recorded for the project's ${anchorRefs.length} live-anchor series (threshold ${thresholdDays} days)` };
    }
    const ageDays = (Date.parse(now) - Date.parse(newest.at)) / 86_400_000;
    const fires = ageDays >= thresholdDays;
    return {
      ...base,
      wouldFire: fires,
      reason: `newest change across ${anchorRefs.length} live-anchor series is ${ageDays.toFixed(1)} days old (threshold ${thresholdDays} days)`,
    };
  }

  // threshold_breach, regulation_change, batch_failure — event-driven, no current-data basis.
  return {
    ...base,
    evaluated: false,
    reason: `no engine evaluation exists for ${draft.triggerType}; the trigger is producer-recorded and cannot be previewed against current data`,
  };
}
