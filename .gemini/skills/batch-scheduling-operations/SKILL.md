---
name: batch-scheduling-operations
scope: co-newbiz
description: >
  Operates the OS-level scheduler registrations (ADR-0019) driving
  `watch:run` and other periodic jobs — an in-process timer dies with the
  app, so every recurring job must be registered at the OS level, not
  relied on to self-perpetuate from within the running application.

  Use when: "OS scheduler registration", "cron job setup", "batch job
  scheduling", "recurring task registration".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: infra-automation-engineer
prerequisites: none
relates_to:
  - skill: infrastructure-automation
    type: composes_with
metadata:
  type: implementation
  triggers:
    - OS scheduler registration
    - cron job setup
    - batch job scheduling
    - recurring task registration
---

## Context

ADR-0019's decision is specific and non-negotiable: OS-level scheduler
(cron on Unix, Task Scheduler on Windows), never an in-process timer —
an in-process timer dies the instant the application process restarts
(a deploy, a crash, a manual restart), silently breaking the schedule with
no obvious signal that it broke. This affects every periodic job in the
system: `watch:run`, backup, retention, statute monitoring cadence.

## When to Use

- Registering a new periodic job
- Auditing that all expected periodic jobs are actually registered at the OS level

## Execution Steps

1. **Never implement a recurring task as an in-process `setInterval`/timer**
   — register it with the OS scheduler instead
2. **Record the registration in `schedule_job`** (job_key, cron_expr,
   enabled) so it's queryable via the admin console, not just configured
   somewhere in infrastructure code no one can easily audit
3. **Confirm `job_run` entries are written on every execution** — status,
   started_at/finished_at, error — so `observability-and-alerting` can
   monitor it
4. **After any deploy or infrastructure change**, verify scheduled jobs
   are still registered — a deploy process that doesn't preserve OS-level
   scheduler registrations is a real risk this discipline exists to catch
5. **Audit periodically**: cross-check the list of jobs that should be
   running (backup, retention, watch:run, statute monitoring) against
   what's actually registered — a job silently missing from the schedule
   is worse than one that fails loudly

## Output Format

- Scheduler registration confirmation per job, `schedule_job` record,
  periodic audit of expected-vs-actual registered jobs

## Related Skills

- `continuous-monitoring-and-alerting` — the primary consumer of this scheduling infrastructure
- `observability-and-alerting` — where job-run status is monitored
- `infrastructure-automation` — the broader automation this scheduling fits within
