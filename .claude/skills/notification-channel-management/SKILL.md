---
name: notification-channel-management
scope: co-newbiz
description: >
  Manages the `watch_rule`/`notification` channel and bundling
  configuration (in_app/email/webhook/all, immediate/daily bundle) and the
  `severity` classification (opportunity/warning/urgent/info/ops) each
  notification carries — the delivery-side counterpart to
  `continuous-monitoring-and-alerting`'s detection cycle.

  Use when: "notification channel", "notification bundling", "watch_rule
  configuration", "notification severity".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: sre
prerequisites:
  - continuous-monitoring-and-alerting
metadata:
  type: implementation
  triggers:
    - notification channel
    - notification bundling
    - watch_rule configuration
    - notification severity
---

## Context

The real schema (Wave 5.4/5.6A) already fixes the shape: `watch_rule`
(`trigger_type`, `threshold`, `cooldown_hours` default 24, `channel`) per
watch, and `notification` (`trigger_type`, `severity`, `payload`,
`channel`, `bundle`) per firing. This skill is the operational discipline
for configuring these correctly — a mis-set channel or bundle setting
either floods a user with immediate notifications that should have been
daily-bundled, or silently delays an `urgent`-severity alert that should
have gone out immediately.

## When to Use

- Configuring a new watch's notification rules
- Reviewing notification volume/bundling for alert-fatigue risk
- Investigating a notification that fired at the wrong urgency or was delayed unexpectedly

## Execution Steps

1. **Set `trigger_type` and `threshold`** per the specific condition being
   watched (RAG downgrade, data staleness, gate-blocking finding)
2. **Choose channel(s)**: `in_app`/`email`/`webhook`/`all` — match to
   actual urgency, not a default-everything setting that trains users to
   ignore notifications
3. **Set `cooldown_hours`**: the default 24 is a reasonable baseline, but a
   genuinely time-sensitive trigger_type may need a shorter cooldown, and a
   low-signal one may need longer to avoid fatigue
4. **Classify severity correctly**: `urgent` should mean genuinely
   time-sensitive (a Kill Criteria hit, a covenant breach), not inflated
   for visibility — severity inflation degrades the signal for everyone
5. **Choose `bundle` setting**: `immediate` for urgent/warning severity,
   `daily` for lower-urgency informational updates — bundling everything
   immediate defeats the cooldown/hysteresis discipline
   `continuous-monitoring-and-alerting` already applies upstream

## Output Format

- Watch-rule configuration (trigger_type, threshold, channel, cooldown),
  notification severity/bundle policy confirmation

## Related Skills

- `continuous-monitoring-and-alerting` — the detection cycle this delivers for
- `admin-console-operations` — the admin UI surface for notification/threshold editing (mandatory ADR reference before save)
