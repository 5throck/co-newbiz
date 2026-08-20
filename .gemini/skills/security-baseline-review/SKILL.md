---
name: security-baseline-review
scope: co-newbiz
description: >
  Runs `docs/security-baseline.md`'s recurring cadence: weekly dependency/
  secrets scans, monthly access-permission review, quarterly threat-model
  refresh (`docs/security-model.md`'s STRIDE matrix re-walked against any
  schema/API change since last review) and DR drill, security review
  required (not optional) on every schema change touching information-
  protection tables.

  Use when: "security baseline cadence", "STRIDE matrix refresh",
  "quarterly threat model review", "pre-deployment security gate".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: security-engineer
prerequisites: none
metadata:
  type: process
  triggers:
    - security baseline cadence
    - STRIDE matrix refresh
    - quarterly threat model review
    - pre-deployment security gate
---

## Context

`docs/security-baseline.md` is the authoritative cadence table this skill
executes, not restates — its own header notes it's "Not yet executable
(Stage 5, once the system exists)," meaning this skill is the first actual
operational execution of a cadence that was previously only documented
intent. The pre-deployment gate items (`security-scan` 0 Critical
findings, `stride-threat-matrix` re-run, `sarif-exporter` tracking) are
already-existing reused workspace skills — this skill orchestrates their
application on the correct cadence, it doesn't reimplement their function.

## When to Use

- Weekly, monthly, quarterly per the baseline's own cadence table
- Before any deployment (pre-deployment gate)
- Any schema change touching an information-protection table (`docs/db-schema.md` §9)

## Execution Steps

1. **Weekly**: dependency vulnerability scan (`security-scan` skill),
   secrets scan (gitleaks), false-positive alert review
2. **Monthly**: access-permission review (delegates to
   `access-control-review`'s own detailed skill, not duplicated here)
3. **Quarterly**: threat-model refresh — re-walk `docs/security-model.md`'s
   STRIDE matrix against every schema/API change since the last review,
   plus the DR drill (`database-operations`)
4. **On every dependency bump**: CVE check before merge (delegates to
   `vulnerability-management`)
5. **On every schema change touching information-protection tables**:
   security review required before merge — security-engineer + data-architect
   joint sign-off, not optional for these tables specifically
6. **Pre-deployment gate**: `security-scan` (0 Critical required),
   `stride-threat-matrix` re-run for any trust-boundary change,
   `sarif-exporter` findings tracked, secrets discipline confirmed
7. **Webhook/outbound payload review**: confirm no sensitive financial or
   compensation data appears in webhook payloads — summary-level content
   only, detail requires an authenticated follow-up call

## Output Format

- Cadence-item completion log (weekly/monthly/quarterly), pre-deployment
  gate result, sign-off record for information-protection-table changes

## Related Skills

- `vulnerability-management`, `access-control-review`, `incident-response` — the specific disciplines this cadence orchestrates
- `db-migration-governance` — where an information-protection-table change originates
