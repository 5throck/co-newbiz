---
name: statute-change-monitoring
scope: co-newbiz
description: >
  Tracks statutes/regulations applicable to a specific active project's
  target industry and jurisdiction, distinct from `regulation-monitoring`'s
  portfolio-wide standing watch — this skill is the project-scoped DD check
  that confirms nothing material has changed since screening, and routes a
  detected change back into that project's own gate review.

  Use when: "statute change affecting this project", "regulation change
  during DD", "re-check applicable statutes".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: legal-counsel
prerequisites: none
metadata:
  type: domain
  triggers:
    - statute change affecting this project
    - regulation change during DD
    - re-check applicable statutes
---

## Context

`regulation-monitoring` is the standing, portfolio-wide watch that runs
independent of any single deal. This skill is narrower and project-scoped:
at each gate transition (or on `regulation-monitoring`'s referral), confirm
the statutes a specific project's regulatory screening relied on haven't
changed in a way that invalidates the earlier finding.

## When to Use

- At each gate transition for a project already past Screening
- `regulation-monitoring` flags a change potentially affecting an active project
- Before DD exit, as a final confirmation

## Execution Steps

1. **Pull the statute list** this project's `regulatory-screening` and
   `permit-pathway-mapping`/`certification-roadmap` findings relied on
2. **Check each for amendments since the finding was recorded** — via
   `k-law` or `regulation-monitoring`'s referral
3. **If unchanged**: confirm and move on, no re-work needed
4. **If changed**: assess whether the change invalidates the earlier
   finding (permit requirement changed, certification body rule changed,
   filing threshold changed) — if material, route back through the
   affected skill (`regulatory-screening`, `permit-pathway-mapping`, etc.)
   for re-assessment before the gate proceeds
5. **Record the confirmation or re-assessment** as part of the gate's
   evidence trail

## Output Format

- Statute-currency confirmation per project gate, with re-assessment record
  where a change was found material

## Related Skills

- `regulation-monitoring` — the portfolio-wide watch this project-scoped check complements
- `regulatory-screening` — the finding this confirms remains current
