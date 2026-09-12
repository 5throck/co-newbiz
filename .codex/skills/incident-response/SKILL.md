---
name: incident-response
scope: co-newbiz
description: >
  Runs incident response per `docs/security/security-baseline.md` §5: `sre`
  triages and classifies severity; an incident touching an
  `mnpi_flag=true` project pulls `data_access_log`/`insider_list` into the
  incident record, not as an afterthought; post-incident analysis is
  mandatory for any production security incident and feeds the quarterly
  threat-model refresh; any incident affecting audit-log integrity is
  Critical-severity by default.

  Use when: "security incident", "incident triage", "MNPI incident",
  "audit log integrity incident", "post-incident analysis".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: sre
prerequisites: none
relates_to:
  - skill: observability-and-alerting
    type: composes_with
metadata:
  type: process
  triggers:
    - security incident
    - incident triage
    - MNPI incident
    - audit log integrity incident
    - post-incident analysis
---

## Context

The audit-log-integrity default-Critical rule is deliberate, even though
the log is append-only-enforced at two layers (DB triggers plus the
absence of any DELETE route at any privilege level per FR-SEC-07): the
log's role as the system's accountability backbone means any threat to its
integrity, however unlikely given the layered enforcement, is treated with
the severity that role warrants, not the severity its actual likelihood
might otherwise suggest.

## When to Use

- Any suspected security incident
- Any anomaly touching an MNPI-flagged project's data access
- A finding that might indicate audit-log tampering (however unlikely)

## Execution Steps

1. **`sre` triages and classifies severity** first — this is not a
   distributed decision, one role owns initial classification
2. **If the incident touches an `mnpi_flag=true` project**: pull
   `data_access_log` and `insider_list` records into the incident record
   immediately — these are core evidence, not supplementary detail added later
3. **Classify audit-log-integrity incidents as Critical by default** —
   regardless of how contained the apparent impact looks initially
4. **Contain, then investigate** — standard incident-response sequencing,
   but confirm containment doesn't itself destroy evidence needed for the
   mandatory post-incident analysis
5. **Post-incident analysis is mandatory** for any production security
   incident — not optional, not skippable for a "minor" incident
6. **Feed findings into the quarterly threat-model refresh**
   (`security-baseline-review`) — an incident that doesn't inform the next
   STRIDE re-walk is a missed learning opportunity

## Output Format

- Incident record: severity classification, MNPI-touching evidence where
  applicable, containment/remediation actions, mandatory post-incident analysis

## Related Skills

- `security-baseline-review` — the quarterly cadence this feeds
- `observability-and-alerting` — a common detection source for incidents
- `access-control-review` — a common remediation target (revoke a compromised credential's access)
