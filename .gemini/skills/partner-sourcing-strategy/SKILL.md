---
name: partner-sourcing-strategy
scope: co-newbiz
description: >
  States the capability gap defining the need for a partner before sourcing
  starts, and determines whether the business model has a hard partner
  dependency — in which case partner-sourcing failure is a Kill Criteria
  candidate (deal termination), not a schedule delay (ADR-0031). Mandatory
  Partnership DD validator (`checklists/partnership-checklist.yaml` pt-01/pt-05).

  Use when: "partner sourcing", "capability gap for a partner", "hard
  partner dependency", "JV partner search".
version: 1.1.0
last_reviewed: 2026-08-20
status: active
owner: partnership-agent
prerequisites: none
metadata:
  type: domain
  procedure_keys:
    - deal-shape-chain
  triggers:
    - partner sourcing
    - capability gap for a partner
    - hard partner dependency
    - JV partner search
---

## Context

ADR-0031's decision is per-project, not automatic: a hard partner
dependency exists when the business model *structurally* cannot proceed
without one (e.g. regulation requires local JV participation, or the
business requires a technology license only a partner can provide) — not
merely "a partner would help." Getting this classification wrong in either
direction is costly: treating a hard dependency as a soft one lets a
valuation silently assume a partner materializes on schedule; treating a
soft dependency as hard triggers an unwarranted Kill Criteria framing.

## When to Use

- Before partner sourcing begins on any deal that might need one
- Classifying whether a specific partner dependency is structural (hard) or preferential (soft)

## Execution Steps

1. **State the capability gap explicitly** before sourcing starts (pt-01) —
   what specifically can this business not do without a partner: regulatory
   access, technology, distribution, local relationships?
2. **Classify hard vs. soft dependency**: does the business model
   structurally require a partner (regulation-mandated local participation,
   an irreplaceable technology license), or would a partner meaningfully
   help but the deal can proceed alone if sourcing fails?
3. **If hard**: flag this to `stage-gate-governance` as a Kill Criteria
   candidate — a partner-sourcing failure on this deal terminates it, and
   the financial model must not assume partner terms that haven't been
   secured (pt-05, ADR-0031)
4. **If soft**: model sourcing failure as a schedule/cost risk instead, not
   a termination trigger
5. **Define the sourcing criteria** from the capability gap: what a
   qualifying partner candidate must bring, feeding `partner-due-diligence`'s
   screening

## Output Format

- Capability-gap statement, hard/soft dependency classification with
  rationale, sourcing criteria for candidate screening

## Related Skills

- `partner-due-diligence` — the candidate screening this sourcing strategy feeds
- `stage-gate-governance` — where a hard-dependency classification routes as a Kill Criteria candidate
