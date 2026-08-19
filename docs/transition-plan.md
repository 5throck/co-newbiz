# Transition Plan — Existing Practice → New Governance System

**Owner**: process-governance-manager (with compliance-officer)
**Design of record**: [design v1.0 §10 / meeting G7](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md)
**Status**: Stage 2 draft — applies once Stage 5 ships a usable system; until then it governs how Stage 3's manual pilot and any parallel real review are reconciled with pre-existing practice.

> Meeting G7 flagged that a transition plan was missing from the original design: what happens to a review already in flight, and in what order do the group's entities adopt the new governance and system. This document closes that gap.

## 1. In-Flight Reviews at Cutover

A review already past Screening when this governance regime becomes binding for its entity is **not** retroactively forced onto the new procedures mid-stream — see the `project_policy_pin` mechanism (`docs/governance-operations.md` §5, design §6.4). Two paths:

| Situation | Path |
|---|---|
| Review has not yet reached the gate at which the new procedure diverges materially from prior practice | **Complete under prior practice**, but retrofit the RAG grade and any available checklist/procedure metadata for continuity of record. Not required to re-run earlier gates. |
| Review is at or before Screening, or the sponsor requests it | **Opt in** to the new procedure from the next gate forward. Opt-in is logged as a `policy_change`-style decision (design §6.4) — never silent. |

**Default**: complete under prior practice unless the entity or Group IC explicitly elects to switch. Forcing a switch mid-review just to demonstrate adoption produces exactly the kind of formal-compliance-without-substance this governance model exists to prevent (`docs/governance-operations.md` §1).

## 2. Adoption Order Across Entities

Placeholder entities `ent-a` and `ent-b` are the only entities currently modeled (meeting M8, O-1). When real entities are onboarded, adoption follows this order — not simultaneous group-wide cutover:

1. **Pilot entity** (the one that ran the Stage 3 manual pilot, design §10 O-3) — first live adoption, since its team has already exercised the procedures once.
2. **Entities with no material procedure overrides** — a shared-procedure-only entity has the smallest gap between "current practice" and "new procedure," lowest transition risk.
3. **Entities with procedure overrides** (regional or entity-specific `add_steps`/`replace_steps`) — these require the override to actually be drafted and validated before cutover, not just group baseline.
4. **Group-level review process** cuts over only after **all** participating entities have adopted Entity IC-level procedures — Group IC has nothing meaningful to review under §6.4's two-tier chain until Entity IC exists underneath it.

## 3. Resistance Management

Adoption friction is treated as **signal, not obstruction to be overridden**:

- If a gate consistently takes longer under the new procedure than under prior practice, that goes into the governance KPI stream (`docs/governance-operations.md` §4) as a candidate for a procedure or checklist revision — not an enforcement escalation.
- If the same checklist item is waived repeatedly by a given entity, that is the waiver-concentration signal (`docs/governance-operations.md` §2) driving the next amendment cycle, exactly as it would for any other adoption pattern.
- No entity is required to adopt a procedure override it disagrees with without raising it through the interpretation registry (`docs/governance-operations.md` §3) first — silent non-adoption is the failure mode to avoid, not disagreement itself.

## 4. Training and Onboarding

Per design §6.6(d): a regulation nobody knows about is not enforced. Each entity's cutover includes:

1. An onboarding walkthrough of the applicable merged procedure (`proc:resolve` output once the CLI ships, or the manual merge in the interim — see `docs/procedure-reference-spec.md`) for every reviewer who will use it.
2. A pointer to the three manuals (`docs/manuals/{business,operations,admin}-manual.md`) scoped to the reader's role.
3. A named point of contact (`process-governance-manager` in the interim; `compliance-officer` for waiver/interpretation questions) for the first review cycle after cutover.

## 5. System Availability Dependency

This plan governs process adoption, which is independent of system availability (Stage 5). Before the system exists:

- All procedure resolution, RAG grading, and checklist tracking is **manual**, following the documents in `procedures/`, `checklists/`, `policies/` directly.
- The Stage 3 manual pilot (design §10 O-3) is the proof that this manual path is executable before any system commitment is made — see ADR-0034 (manual-pilot-first principle).
- Once Stage 5 ships, the system does not change the adoption order above; it only removes the manual-tracking burden from an entity that has already adopted the process.

## 6. Exit Criteria for This Plan

This transition plan is retired (folded into `docs/governance-operations.md` as steady-state operation) once:

1. All entities modeled at the time have completed cutover per §2, and
2. No in-flight review remains on prior practice per §1, and
3. One full quarterly governance-KPI cycle (`docs/governance-operations.md` §6) has run under the new procedures without a transition-specific waiver category.
