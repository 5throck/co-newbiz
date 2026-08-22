---
name: intra-group-transaction-compliance
scope: co-newbiz
description: >
  Implements step 3 of `group-investment-review`: the Korean Fair Trade Act
  Art. 47 related-party-transaction screen, run only when the deal involves
  affiliate transactions (sibling-entity deals within the same corporate
  group — the design's "group vs. entity" distinction, validated against a
  real intra-group case in `docs/pilots/pilot-003-doosan-bobcat-robotics.md`).

  Use when: "related party transaction", "Fair Trade Act Art. 47",
  "intra-group transaction", "affiliate transaction screen".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: group-review-agent
prerequisites:
  - legal-counsel
metadata:
  type: domain
  triggers:
    - related party transaction
    - Fair Trade Act Art. 47
    - intra-group transaction
    - affiliate transaction screen

  procedure_keys:
    - group-investment-review
---

## Context

Runs **only if** the proposal involves a transaction between affiliates of
the same corporate group (e.g. one subsidiary acquiring or merging with
another, a spin-off between sibling entities) — not every Group IC
submission. `docs/pilots/pilot-003-doosan-bobcat-robotics.md` is the
validated real-world case: a group proposing to move a profitable
subsidiary into a loss-making one, a textbook Fair Trade Act Art. 47
related-party scenario, distinct from a cross-group acquisition (which
`antitrust-screening` handles instead).

## When to Use

- A Group IC submission is between two entities of the same corporate group
- Reviewing whether a proposed structure requires related-party disclosure
  or Fair Trade Commission notification

## Execution Steps

1. **Confirm applicability first**: if the transaction is between entities
   of *different* corporate groups, this skill does not apply — route to
   `antitrust-screening` instead
2. **Identify the related-party relationship**: ownership/control chain
   connecting the two entities, per the group's actual corporate structure
3. **Screen against Fair Trade Act Art. 47**: transaction size thresholds,
   disclosure obligations, and whether Fair Trade Commission notification is
   triggered — via `legal-counsel`
4. **Assess fairness of terms**: is the transaction priced/structured on
   arm's-length terms, or does it favor one sibling entity at the other's
   expense in a way that could be challenged? (This is the substantive
   question behind pilot-003's finding, not a formality.)
5. **Record the finding**: `related_party_transaction_finding` — applicable
   thresholds, notification obligations, fairness assessment, and any
   condition the Group IC decision should carry as a result

## Output Format

- `related_party_transaction_finding` — feeds directly into
  `group-level-review`'s step 3 and the eventual Group IC decision's conditions

## Related Skills

- `group-level-review` — the orchestrating skill this fits inside
- `antitrust-screening` — the cross-group counterpart (different applicability trigger)
- `legal-counsel`'s domain generally, for the Fair Trade Act analysis itself
