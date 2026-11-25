---
lang: ko
lang_reason: proper-noun
---

# ADR-0206: S8 excluded targets — source filtering and a stale-target GO block

- Status: Accepted (2026-11-24, approved by PM and the user)
- Date: 2026-11-24
- Deciders: New Business Review Lead (PM); workspace owner (decisions A/B, 2026-11-24)
- Design of record: `docs/designs/2026-11-24-s8-excluded-target-handling-design.md`
- Amends: ADR-0186 (adds rule family `target`), ADR-0143 (Short List exits after S8 entry)
- Related: ADR-0053 / boundary #2, ADR-0157, DEC-20261124-02

## Context

A shortlisted target can be excluded after S8 cases were generated, after a target was selected, or
after a case was adopted. Lists still showed its cases (PR #973 fixed two AI inputs only), and
downstream consumers (IC package, report, memo, recommendations) kept using the stale adopted case.

## Decision

1. `listBusinessCases` filters excluded-target cases by default; history callers opt out explicitly.
2. Selection and adoption records are never auto-invalidated (humans own decisions). Staleness is
   computed by a pure helper and surfaced on every S8 surface.
3. New ADR-0186 rule family `target` (`CO_NEWBIZ_GATE_INTEGRITY_TARGET`): a project GO at `fs`, `dd`,
   `entity_ic`, `group_ic` is refused with 409 `target_not_shortlisted` while the selection or adoption
   is stale. HOLD/KILL always allowed; existing rows untouched. Default `enforce` with no shadow release; the env var is kept as an operator escape hatch.
4. Downstream consumers refuse or render the stale state instead of stale figures.

## Alternatives considered

- Auto-invalidate selection/adoption on exclusion — rejected by the owner (boundary #2).
- Warning only, no GO block — rejected by the owner (decision B).
- Show excluded cases as a reference section — rejected by the owner (decision A).
- Per-consumer filtering — rejected; leaks by default for new call sites.

## Consequences

- No schema change. One new gate error code and env flag. Re-select + re-adopt becomes the
  recovery path; projects with a stale record cannot pass FS until a human acts.
