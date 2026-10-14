---
lang: ko
lang_reason: proper-noun
---

# ADR-0171 - Required-capability check at S5 (Green Field) and S7 per target (Brown Field)

- Status: Accepted (2026-10-14)
- Date: 2026-10-14
- Decider: Human decider (chat approval 2026-10-14, "ADR-0171 / 0172 승인"). Drafted by platform-lead.
- Design-of-record: [docs/designs/2026-10-14-capability-check-at-s5-s7-design.md](../designs/2026-10-14-capability-check-at-s5-s7-design.md)
- Related: ADR-0168 (partly superseded), ADR-0169 (T1 source amended), ADR-0170 (Decisions 4-6 partly superseded), ADR-0136 (amended), ADR-0143 (amended)
- Slices: 3 (1 Green Field S5 edit surface + S8 read-only summary, 2 Brown Field S7 per-target judgements + criteria reconcile + detection, 3 S8 scenario/lens/gate-brief + wiki/glossary). None implemented by this ADR; implementation begins after acceptance.

## Context

The attainability judgement for required capabilities is edited on S8 (ADR-0168), while the question it answers belongs to S5 for Green Field (`스스로 진입할 수 있는가?`) and to S7 per target for Brown Field (`어떤 대상이 유망한가?`, gate `target_screening`). Brown Field S3 rows are seeded once as technical criteria, so later S3 rows never reach S7.

## Decision

1. **Check location.** GF: S5 owns the judgement edit surface; storage stays on the S3 register row. BF: S7 owns it per target, only for shortlisted and selected targets.
2. **S3 single source** as in ADR-0170 and its correction (levels are S5-owned, not S3 inputs).
3. **S8 read-only.** The technical-feasibility tab shows a summary (S3 definition plus S5 or selected-target S7 judgement) with edit links. S8 PUT/confirm routes return 410 `editAt` for one release, then are removed.
4. **BF storage.** New table `brownfield_target_capability_judgement` keyed by `(brownfield_target_id, capability_row_id)`, reusing the ADR-0170 judgement JSON shape. DB schema change: this ADR is the required record; a numbered migration with rollback note follows in slice 2.
5. **Staleness.** GF as ADR-0170. BF: S3 row hash plus the target's evaluation state hash for the seeded criterion; only that target is invalidated. Invalidation keeps history and clears confirmation.
6. **Seed-once fix.** Criterion seeding becomes an idempotent reconcile: missing rows are seeded, removed rows are retired (marker, not deletion) with history.
7. **Gates.** S5 completeness and S7 `target_screening` readiness show a warning-only capability check; S8 lens T1, banner and gate briefs read S5/S7. No grade cap, no gate block.
8. **Permissions and audit.** Confirmation stays human-only; audit rows carry the calling user, `surface` and `target_id`.

## Consequences

- One migration (BF table, criterion retire columns); GF needs no data move.
- A one-off audited script copies legacy BF register judgements, unconfirmed, to the selected target.
- The capability-adjusted scenario reads confirmed, non-stale S5/S7 judgements only.
- ADR-0168/0169/0170 bodies are not edited; the README index notes the partial supersession at acceptance.

## Honest limits

Accepted by chat; open decisions OD-1..OD-6 are resolved as recommended in the design. The S5 completeness and S7 readiness code paths were not traced in detail. Judgements remain decision support, not investment advice.

## Acceptance record

- Approver: the human decider (user, account techcross), chat 2026-10-14: "ADR-0171 / 0172 승인". Recorded in DEC-20261014-08.
- Basis: chat approval of the ADR as written, including the design's recommended resolutions of OD-1..OD-6. Acceptance is by chat instruction; the decider did not review a per-item checklist, and this record does not claim the approver read specific items.
- Scope: acceptance covers the decision. Nothing of slices 1-3 is implemented; implementation begins after acceptance.
- Known limitations (owner: platform-lead): the S5 completeness and S7 readiness code paths were not traced in detail.
