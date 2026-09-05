# ADR-0015: Operating rhythm and SLOs

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: platform-lead, sre, dba

## Context

Without a defined operating cadence, monitoring and maintenance tasks (backup verification, capacity review, threat-model refresh) tend to happen only reactively, after an incident.

## Decision

Define daily/weekly/monthly/quarterly/annual operating rhythm (`docs/governance/ops-cadence.md`) with named owners per task, including the monthly recovery drill (a backup never restored is not verified) and monthly RAG threshold calibration.

## Consequences

A recovery drill and RAG calibration on a fixed calendar, rather than left as an implicit expectation, converts a hoped-for practice into an auditable one.
