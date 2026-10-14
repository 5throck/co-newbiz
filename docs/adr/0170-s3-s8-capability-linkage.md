---
lang: ko
lang_reason: proper-noun
---

# ADR-0170 - S3-S8 required-capability linkage (S3 single source, stale judgements, S8 read-only S3 fields)

- Status: Accepted (2026-10-14)
- Date: 2026-10-14
- Decider: Human decider (chat approval 2026-10-14, "ADR-0170 승인"). Drafted by platform-lead.
- Design-of-record: [docs/designs/2026-10-14-s3-s8-capability-linkage-design.md](../designs/2026-10-14-s3-s8-capability-linkage-design.md)
- Related: ADR-0168 (S8 attainability on the S3 register), ADR-0169 (technical lens, single register write path), ADR-0136 (S5 fills levels), ADR-0143 (Brown Field per-target judgements)
- Slices: 4 (1 hash + stale + S8 read-only, 2 S3-side column, 3 Brown Field per-target detection, 4 docs/wiki/glossary). None implemented by this ADR.

## Context

The S8 attainability judgement sits on the S3 register row it judges (`opportunity.capability_gap_json`). S8 can currently write `requiredLevel` / `currentLevel` into that row, and an S3 change keeps the old judgement (including its confirmation) because the S3 save carries it over by row id. A row deleted in S3 loses its judgement without trace.

## Decision

1. **S3 is the single source.** S3-owned fields: `capability`, `requiredNote`, `held.status`, `held.holders`, `held.evidence`, `requiredLevel`, `currentLevel` (levels filled by S5 per ADR-0136). S8 owns `resolution` and `attainability.*`.
2. **Row revision hash.** A versioned content hash over the S3-owned fields (canonical JSON, trimmed, holders sorted; `source`, `note`, `resolution`, `attainability` and register-level keys excluded) is stamped server-side into `attainability.basisHash` on every S8 save or confirm. Stale = judgement exists and `basisHash` differs from the current hash; derived on read, so every register writer triggers it.
3. **Invalidation, never deletion.** On a register write, stale judgements are moved into `attainability.history[]` (capped), confirmation is cleared, `staleSince` is set, prior values stay pre-filled, and the row shows `S3 변경 — 재판정 필요`. A person re-judges and re-confirms; confirm on a stale row without a fresh save is rejected. Judgements of rows deleted in S3 move to a register-level `removedCapabilities[]` history carried by `serializeGapRegister`.
4. **S8 read-only for S3 fields.** `PUT /api/projects/:id/capability-attainability` rejects S3-owned fields with 400 `s3_owned_field`; the S8 panel shows levels and held status read-only with a link to S3/S5. No data migration: levels already written via S8 are valid S3 values.
5. **Brown Field per target.** Detection basis = S3 row hash plus the target's evaluation state for the seeded criterion; only that target's judgement is invalidated. This basis (design OD-1) is confirmed by the decider's approval.
6. **Surfaces.** S3 (and S5) gets a read-only `S8 판정` column (grade, confirmed / not confirmed / re-judgement needed). A stale row counts as unjudged for the banner, ADR-0169 T1 and the gate-brief line. No grade cap, no gate block.
7. **Audit and permissions.** Invalidation, archive of removed rows and history trimming append `audit_log` entries under the calling user whose write caused them (boundary #1: agents inherit the caller's permissions). Confirmation remains human-only (ADR-0168 D1).

## Consequences

- No DB migration; the register JSON contract gains optional keys (`basisHash`, `history`, `staleSince`, `removedCapabilities`).
- S3 edits after confirmation create re-judgement work by design; prior values reduce it to a review and one confirm.
- Changing the hashed field set later re-stales every row and needs an amendment plus a re-stamp.
- Brown Field criteria are seeded once today; rows added later need seeding before per-target detection works (slice 3).

## Honest limits

Accepted by chat instruction. The Brown Field basis (Decision 5) and the legacy-judgement handling (design OD-4) are resolved as recommended in the design (OD-1..OD-5). Judgements remain human decisions, not investment advice. Slices 1-4 are not implemented by this ADR.

## Acceptance record

- Approver: the human decider (user, account techcross), chat 2026-10-14: "ADR-0170 승인". Recorded in DEC-20261014-07.
- Basis: chat approval of the ADR as written, including the design's recommended resolutions of OD-1..OD-5. Acceptance is by chat instruction; no per-item checklist was recorded. This record does not claim the approver read specific items.
- Scope: acceptance covers the decision. Nothing of slices 1-4 is implemented.
- Known limitations (owner: platform-lead): the Brown Field criteria are seeded once, so rows added later need seeding before per-target detection works (slice 3); the legacy stamp (OD-4) is a one-off audited script still to be written.
