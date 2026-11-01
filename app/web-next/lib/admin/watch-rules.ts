// @version 1.0.0
/**
 * Watch-rule field validation for the admin CRUD + preview API (design
 * 2026-10-29-scheduled-jobs-design section 13.6, phase P4).
 *
 * The authoritative sets live in db/lib/watch-engine.ts (P4 trigger metadata):
 *   - WATCH_RULE_TRIGGER_TYPES — the 7 values the watch_rule CHECK (0007, rebuilt
 *     verbatim in 0033) accepts. NOT the notification table's 11-value set: inserts
 *     with pipeline_paused / establishment_* / test would fail the DB CHECK.
 *   - THRESHOLD_BEARING_TRIGGERS — threshold_breach (IRR/NPV delta in percentage
 *     points, 0007 column comment) and staleness (days, P4 owner brief). Required
 *     and > 0 for these, rejected for the other five (event-driven, no threshold
 *     meaning — derived from the engine's own usage, section 13.6).
 *
 * Channel gating: in_app is always available; email requires SMTP env
 * (isEmailConfigured); webhook requires at least one ENABLED notify_webhook_target
 * row. 'all' is always acceptable — external sub-channels self-skip as
 * channel_unconfigured at delivery time, so 'all' degrades gracefully to whatever
 * is configured.
 *
 * NOTE on severity: watch_rule has NO severity column (0007/0033/0036) — severity
 * is a producer decision at fire time (deriveSeverityForTrigger). A severity field
 * in a rule body is therefore a validation error, not an inventable column.
 */
import { isEmailConfigured } from "../../../../db/lib/notify/email.ts";
import {
  THRESHOLD_BEARING_TRIGGERS,
  WATCH_RULE_TRIGGER_TYPES,
  isThresholdBearing,
  type Channel,
  type TriggerType,
} from "../../../../db/lib/watch-engine.ts";

export const COOLDOWN_MIN_HOURS = 1;
export const COOLDOWN_MAX_HOURS = 720;
export const DEFAULT_COOLDOWN_HOURS = 24;

/** The watch_rule CHECK's own 7-value set — see module docstring for why it is not the notification set. */
export const RULE_TRIGGER_TYPES = WATCH_RULE_TRIGGER_TYPES;
/** Notification-CHECK values that the watch_rule CHECK rejects (reported verbatim in validation errors). */
const NOTIFICATION_ONLY_TRIGGERS = ["pipeline_paused", "establishment_step_reopened", "establishment_step_assigned", "test"];

export type FieldErrors = Record<string, string>;

export interface WatchRuleValues {
  trigger_type: TriggerType;
  threshold: number | null;
  cooldown_hours: number;
  channel: Channel;
  enabled: number;
  adr_ref: string | null;
}

/**
 * Channel availability on this server: 'in_app' and 'all' always; 'email' when
 * SMTP env is present; 'webhook' when at least one enabled notify_webhook_target
 * row exists. The URL itself is NEVER read here (design section 13.8 — it lives
 * in env only).
 */
export function configuredRuleChannels(db: { query: Function }): Set<Channel> {
  const allowed = new Set<Channel>(["in_app", "all"]);
  if (isEmailConfigured()) allowed.add("email");
  const webhookRow = db.query("SELECT channel_key FROM notify_webhook_target WHERE enabled = 1 LIMIT 1").get();
  if (webhookRow) allowed.add("webhook");
  return allowed;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate watch-rule fields (create: full; PATCH: partial merged over `current`
 * so a trigger change re-checks the threshold of the NEW trigger against the
 * resulting threshold value). Returns every failing field, not just the first.
 */
export function validateWatchRuleFields(
  db: { query: Function },
  body: unknown,
  opts: { partial: boolean; current?: Partial<WatchRuleValues> },
): { ok: true; value: WatchRuleValues } | { ok: false; fields: FieldErrors } {
  const fields: FieldErrors = {};
  if (!isPlainObject(body)) {
    return { ok: false, fields: { body: "request body must be a JSON object." } };
  }

  // Unknown fields are rejected so a typo cannot silently no-op (severity included,
  // with a message that explains where severity actually lives).
  const KNOWN = new Set(["trigger_type", "threshold", "cooldown_hours", "channel", "enabled", "adr_ref"]);
  for (const key of Object.keys(body)) {
    if (!KNOWN.has(key)) {
      fields[key] =
        key === "severity"
          ? "severity is not stored on watch_rule — it is derived per trigger at fire time (watch-engine deriveSeverityForTrigger)."
          : "unknown field.";
    }
  }

  const mergedTrigger = ("trigger_type" in body ? body.trigger_type : opts.current?.trigger_type) as unknown;
  const mergedThreshold = ("threshold" in body ? body.threshold : opts.current?.threshold) as unknown;

  // trigger_type
  let triggerType: TriggerType | null = null;
  if ("trigger_type" in body || !opts.partial) {
    if (typeof mergedTrigger !== "string") {
      fields.trigger_type = "trigger_type is required and must be a string.";
    } else if ((NOTIFICATION_ONLY_TRIGGERS as string[]).includes(mergedTrigger)) {
      fields.trigger_type = `'${mergedTrigger}' exists on the notification table only — the watch_rule CHECK accepts: ${RULE_TRIGGER_TYPES.join(", ")}.`;
    } else if (!(RULE_TRIGGER_TYPES as readonly string[]).includes(mergedTrigger)) {
      fields.trigger_type = `trigger_type must be one of: ${RULE_TRIGGER_TYPES.join(", ")}.`;
    } else {
      triggerType = mergedTrigger as TriggerType;
    }
  }

  // threshold — validated against the EFFECTIVE (post-merge) trigger, so a create and a
  // partial PATCH share one rule: required and > 0 for threshold-bearing triggers
  // (percentage points for threshold_breach, days for staleness), rejected for the
  // event-driven five. An unknown trigger already carries its own error above and the
  // threshold check is skipped (nothing honest to compare against).
  let threshold: number | null = null;
  if (triggerType !== null) {
    if (isThresholdBearing(triggerType)) {
      if (typeof mergedThreshold !== "number" || !Number.isFinite(mergedThreshold)) {
        fields.threshold = `threshold is required and must be > 0 for '${triggerType}' (percentage points for threshold_breach, days for staleness).`;
      } else if (mergedThreshold <= 0) {
        fields.threshold = "threshold must be > 0 (percentage points for threshold_breach, days for staleness).";
      } else {
        threshold = mergedThreshold;
      }
    } else if (mergedThreshold !== null && mergedThreshold !== undefined) {
      fields.threshold = `threshold is not accepted for '${triggerType}' — the trigger is event-driven and has no threshold meaning.`;
    } else {
      threshold = null; // NULL where the trigger has no threshold (0007 column comment)
    }
  } else if (typeof mergedThreshold === "number" && (!Number.isFinite(mergedThreshold))) {
    fields.threshold = "threshold must be a finite number.";
  }

  // cooldown_hours
  let cooldownHours: number = opts.current?.cooldown_hours ?? DEFAULT_COOLDOWN_HOURS;
  if ("cooldown_hours" in body) {
    const v = body.cooldown_hours;
    if (typeof v !== "number" || !Number.isInteger(v) || v < COOLDOWN_MIN_HOURS || v > COOLDOWN_MAX_HOURS) {
      fields.cooldown_hours = `cooldown_hours must be an integer between ${COOLDOWN_MIN_HOURS} and ${COOLDOWN_MAX_HOURS}.`;
    } else {
      cooldownHours = v;
    }
  } else if (!opts.partial) {
    cooldownHours = DEFAULT_COOLDOWN_HOURS;
  }

  // channel — gated on server configuration (see configuredRuleChannels). Create defaults
  // to 'in_app' (always available; the least surprising floor — a rule without an explicit
  // channel never tries an unconfigured external transport).
  let channel: Channel = opts.current?.channel ?? "in_app";
  if ("channel" in body) {
    const v = body.channel;
    if (typeof v !== "string") {
      fields.channel = "channel must be a string.";
    } else {
      const allowed = configuredRuleChannels(db);
      if (!(allowed as Set<string>).has(v)) {
        const unconfigured =
          v === "email" ? "the email channel is not configured (NOTIFY_SMTP_HOST / NOTIFY_SMTP_FROM missing)" :
          v === "webhook" ? "no enabled webhook target exists (notify_webhook_target)" :
          `channel must be one of: ${[...allowed].join(", ")}`;
        fields.channel = `channel '${v}' is not available: ${unconfigured}.`;
      } else {
        channel = v as Channel;
      }
    }
  }

  // enabled
  let enabled: number = opts.partial ? (opts.current?.enabled ?? 1) : 1;
  if ("enabled" in body) {
    const v = body.enabled;
    if (typeof v !== "boolean") fields.enabled = "enabled must be a boolean.";
    else enabled = v ? 1 : 0;
  }

  // adr_ref
  let adrRef: string | null = opts.current?.adr_ref ?? null;
  if ("adr_ref" in body) {
    const v = body.adr_ref;
    if (v !== null && typeof v !== "string") fields.adr_ref = "adr_ref must be a string or null.";
    else adrRef = typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    value: { trigger_type: triggerType ?? (opts.current?.trigger_type as TriggerType), threshold, cooldown_hours: cooldownHours, channel, enabled, adr_ref: adrRef },
  };
}
