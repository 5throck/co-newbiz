# ADR-0019: OS-level scheduler for periodic collection

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: infra-automation-engineer, sre

## Context

An in-process timer for scheduled data collection dies whenever the application process dies, silently breaking the monitoring pipeline it's supposed to run.

## Decision

Register the collection job with the OS scheduler (Task Scheduler on Windows, systemd timer on Linux) rather than an application-internal timer.

## Consequences

Scheduled collection survives application restarts and crashes; `job_run` is the audit trail checked first when a scheduled run appears not to have fired.
