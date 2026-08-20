---
name: observability-and-alerting
scope: co-newbiz
description: >
  Operates system-level observability (health checks, error rates, job-run
  status via `schedule_job`/`job_run`) — distinct from
  `continuous-monitoring-and-alerting`'s deal-level RAG/watch cycle, this
  skill covers whether the platform itself is healthy, not whether a
  specific project's data changed.

  Use when: "system health monitoring", "error rate alerting",
  "job run status", "platform observability".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: sre
prerequisites: none
metadata:
  type: implementation
  triggers:
    - system health monitoring
    - error rate alerting
    - job run status
    - platform observability
---

## Context

Two monitoring layers, two different questions: `continuous-monitoring-and-alerting`
asks "did this project's underlying data change enough to warrant
re-evaluation" (business logic); this skill asks "is the platform itself
running correctly" (infrastructure). The real `schedule_job`/`job_run`
tables (Wave 5.6A's admin endpoints already expose them) are the concrete
mechanism: every scheduled job's status/error is queryable, not inferred
from silence.

## When to Use

- Ongoing platform health monitoring
- Investigating whether a scheduled job (watch cycle, backup, retention) actually ran successfully

## Execution Steps

1. **Monitor `schedule_job`/`job_run` status** for every registered job —
   a job that silently stopped running is a worse failure mode than one
   that runs and reports an error, since the silence produces no signal at all
2. **Track error rates** across the API surface — a spike in 5xx responses
   or unexpected exceptions is a platform-health signal distinct from any
   individual deal's data
3. **Monitor query performance trends** (feeds `query-performance-tuning`
   when a degradation is found) — a slow query that was fine at low data
   volume can degrade as the system scales
4. **Alert on job failures and error-rate spikes** through
   `notification-channel-management`'s channel infrastructure, with
   `ops`-severity classification (distinct from deal-level severities)
5. **Feed findings into the quarterly threat-model refresh**
   (`security-baseline-review`) where an observability gap itself
   represents a security-relevant blind spot

## Output Format

- Job-run status dashboard/report, error-rate trend, alert firing record

## Related Skills

- `continuous-monitoring-and-alerting` — the deal-level counterpart
- `notification-channel-management` — the delivery infrastructure this uses
- `incident-response` — where an observability finding may escalate
