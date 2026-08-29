---
name: certification-transferability
scope: co-newbiz
description: >
  Confirms certification transferability on change of control against the
  actual certifying body's own rules — inference is explicitly disallowed
  (design's non-negotiable rule, restated in `checklists/brownfield-feasibility-checklist.yaml`
  bf-03 and `checklists/ma-special-topics-checklist.yaml` ma-12, which
  requires this check LAST in the M&A evaluation sequence, since a
  non-transferable certification can strip the premium a valuation already assumed).

  Use when: "certification transferability", "change of control
  certification", "certification survives acquisition".
version: 1.2.0
last_reviewed: 2026-08-23
status: active
owner: legal-counsel
prerequisites:
  - certification-roadmap
metadata:
  type: domain
  triggers:
    - certification transferability
    - change of control certification
    - certification survives acquisition

  procedure_keys:
    - brownfield-dd
    - entity-establishment-execution
relates_to:
  - skill: financing-plan-review
    type: follows
  - skill: org-readiness-assessment
    type: follows

---

## Context

This is one of the few places in the whole system where the design
explicitly forbids inference — not "prefer confirmation, infer if
unavailable," but disallowed outright. A certifying body's actual published
rules (or a direct confirmation from the body) is required; the target's
own characterization of its certification's transferability is not
sufficient, since a target may be mistaken or motivated to overstate
transferability. `checklists/ma-special-topics-checklist.yaml`'s evaluation
order places this check **last**, specifically because a non-transferable
certification can strip the acquisition premium and must not be computed
against a valuation that already assumed it survives.

Ownership note (v1.1.0, design of record 2026-08-22 §5 PR-3): the
change-of-control transferability **judgment is legal-counsel's call** —
`agents/legal-counsel.md` claims this responsibility and the procedure
(brownfield-dd step 9) dispatches legal-counsel here; certification-agent
acts as input provider (requirement identification, roadmap,
source-regulation pointers), not as the judge.

## When to Use

- Brown Field DD — always, per the mandatory checklist item ma-12/bf-03,
  and always evaluated last in the M&A sequence
- Any Green Field or Brown Field deal thesis that assumes a specific
  certification remains valid through a corporate transaction

## Execution Steps

1. **Identify every certification the deal thesis depends on** surviving
   the transaction
2. **Locate the certifying body's actual published rules** on
   transferability upon change of control, acquisition, or restructuring
   — not a summary, the source rule itself where obtainable
3. **Where the rule is ambiguous or unpublished**: contact the certifying
   body directly for confirmation rather than inferring from analogous
   cases or the target's assurance
4. **Never accept the target's self-characterization as sufficient** — a
   target's confident assertion that "our certification transfers
   automatically" is not confirmation
5. **Run this check last** in the M&A evaluation sequence — after
   valuation work is otherwise complete, so a non-transferability finding's
   premium-stripping impact is applied to the actual final valuation, not
   an interim one that will be redone anyway
6. **If non-transferable and load-bearing**: this is a binding Kill
   Criterion (`policies/group/neb-policy.md` §4), not a valuation haircut
   to absorb and proceed

## Output Format

- Per-certification transferability finding: source (certifying body rule
  or direct confirmation), transferable/non-transferable determination,
  Kill Criteria flag if load-bearing and non-transferable

## Related Skills

- `certification-roadmap` — the requirements this transferability check follows
- `stage-gate-governance` — the Kill Criterion a non-transferable, load-bearing certification triggers
- `dd-to-valuation-bridge` — where a finding here feeds the valuation adjustment
