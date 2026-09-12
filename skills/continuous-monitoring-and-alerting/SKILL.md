---
name: continuous-monitoring-and-alerting
scope: co-newbiz
description: >
  Operates the watch → auto-rerun → RAG re-evaluation → notification cycle
  (ADR-0017, `watch-run.ts`, Wave 5.4): OS-level scheduler-driven, not an
  in-process timer that dies with the app; per-(project, trigger_type)
  cooldown and hysteresis to prevent alert fatigue; deterioration alerts
  are non-optional — a bidirectional policy, not improvement-only.

  Use when: "watch cycle", "auto re-analysis", "deterioration alert",
  "cooldown and hysteresis", "OS scheduler registration".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: sre
prerequisites: none
metadata:
  type: implementation
  triggers:
    - watch cycle
    - auto re-analysis
    - deterioration alert
    - cooldown and hysteresis
    - OS scheduler registration
---

## Context

The design's explicit rationale for the bidirectional rule: an in-flight
deal quietly getting worse is a larger loss than a missed opportunity, so
deterioration alerts are non-optional — a monitoring system that only
celebrates improvement is a worse system than one with no automation at
all, since it creates false confidence. The OS-level scheduler choice
(ADR-0019, alongside ADR-0017) is deliberate: an in-process timer dies the
moment the app process restarts, silently breaking the monitoring cycle
without an obvious signal that it's broken.

## When to Use

- Registering a new watch/monitoring cycle for the OS scheduler
- Investigating why an expected notification didn't fire
- Reviewing cooldown/hysteresis tuning for alert-fatigue risk

## Execution Steps

1. **Confirm scheduler registration**: `watch:run` is registered with the
   OS-level scheduler (cron/Task Scheduler), not relying on the
   application process staying alive continuously
2. **Cycle stages**: fetch → impact detection (did the underlying data
   actually change materially?) → auto-rerun (only on material change,
   never unconditionally) → RAG re-evaluation → notification
3. **Confirm bidirectionality**: both an improvement and a deterioration
   in RAG grade or a monitored metric trigger a notification — an
   implementation that only fires on improvement is non-compliant, not a
   lighter-weight acceptable variant
4. **Apply cooldown per `(project, trigger_type)`**: don't re-notify the
   same project/trigger combination faster than the cooldown window, even
   if the underlying condition re-triggers repeatedly
5. **Apply hysteresis** consistent with `rag-scoring-framework`'s own
   Amber↔Green hysteresis rules — a monitoring re-evaluation should not
   bypass the same grade-stability discipline a manual re-evaluation follows

## Output Format

- Scheduler registration confirmation, watch-cycle execution log, notification firing record (bidirectional)

## Related Skills

- `notification-channel-management` — the delivery side this feeds
- `rag-scoring-framework` — the re-evaluation logic this cycle triggers
- `batch-scheduling-operations` — the OS-scheduler operational counterpart
