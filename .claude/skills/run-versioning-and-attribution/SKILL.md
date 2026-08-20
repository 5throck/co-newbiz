---
name: run-versioning-and-attribution
scope: co-newbiz
description: >
  Ensures every analysis produces a `run` row with an immutable
  `run_input` snapshot and `input_hash` (every simulation additionally
  records its `seed`), so a re-run with identical seed and inputs must
  reproduce identical output — a verification gate (ADR-0005, design §12),
  not a nice-to-have. Every rendered report prints run id / as_of /
  input_hash / version / policy_version automatically.

  Use when: "run versioning", "input hash", "reproduce a prior result",
  "run attribution", "superseded_by chain".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: data-architect
prerequisites: none
metadata:
  type: implementation
  triggers:
    - run versioning
    - input hash
    - reproduce a prior result
    - run attribution
    - superseded_by chain
---

## Context

The determinism requirement is exact and testable: same seed, same inputs,
same output — not "should generally be similar." This is what makes a run
from three months ago independently verifiable rather than trusted on
faith, and it's the same discipline `monte-carlo-simulation`'s own
seeded-Generator requirement implements at the simulation-code level.
Documents carry a `superseded_by` chain so an amended finding never
silently overwrites the record of what an earlier decision was actually
based on.

## When to Use

- Any analysis, model run, or simulation — always, not opt-in
- Verifying a prior result is reproducible
- Amending a document/finding that supersedes an earlier one

## Execution Steps

1. **Record a `run` row for every analysis**: immutable `run_input`
   snapshot (the exact inputs used) and `input_hash` (a hash confirming
   integrity of that snapshot)
2. **For simulations, additionally record `seed`** — `monte-carlo-simulation`
   already does this; confirm any other simulation-producing skill does too
3. **Never mutate a `run_input` snapshot after the fact** — a correction
   is a new run, not an edit to the old one
4. **On document amendment**: set `superseded_by` pointing to the new
   version, preserving the old one rather than overwriting — mirrors
   `interpretation-registry`'s same explicit-supersession discipline
5. **Confirm every rendered report prints run id / as_of / input_hash /
   version / policy_version automatically** — a report missing this
   provenance block is not reproducibility-compliant regardless of how
   correct its numbers look
6. **Reproducibility check**: re-run with the identical seed and input
   snapshot; a mismatched result is a defect in the analysis code, not
   accepted variance

## Output Format

- `run` row (input snapshot, input_hash, seed where applicable), report
  provenance block, `superseded_by` chain where amending a prior document

## Related Skills

- `monte-carlo-simulation` — the simulation-specific determinism requirement this generalizes
- `assumption-audit` — the companion discipline for the assumptions feeding a run
