---
lang: en
lang_reason: Code-adjacent decision record; docs are English-only zone
---

# ADR-0202: Unreviewed AI-draft verdicts block the S6-consuming gates

**Status**: Accepted (2026-11-18; owner chose option 1 - block at the gate - in chat as decision N1, implemented in PR #907)
**Date**: 2026-11-17
**Deciders**: Owner (direction in chat 2026-11-17); drafted by backend-engineer. PM runs spec-register.
**Amends**: [ADR-0200](0200-s6-direct-ai-verdicts-with-origin.md) (adds a gate-consumption rule on top of the verdict-origin model; the origin model itself is unchanged). It reverses ADR-0200's rejected alternative "Block Short List promotion while unreviewed AI verdicts exist": the owner now accepts that block, applied at the `pre_fs` and `target_screening` gates rather than as a per-version confirm wall.
**Related**: ADR-0005 (append-only), ADR-0118 (proposal-only AI), ADR-0184 (next-intl ko/en, i18n rules), ADR-0186 (Wave C-3 gate prerequisites), ADR-0201 (migration-number neighbour)

## Context

ADR-0200 (migration 0197) lets AI evaluation results land directly as S6 target-evaluation verdicts with
`verdict_source` ∈ {`human`, `auto_rule`, `ai_draft`}. A person's save always lands and turns the row `human`
(G5), and the accept-rule flow bulk-accepts `auto_rule` rows as `human`. A `ai_draft` verdict a person has not
reviewed still scores into the target evaluation, so a brownfield pre_fs or target_screening GO could record on
verdicts no person has ever looked at — silently passing review items that are, in review-model terms,
INCOMPLETE.

## Decision

1. **Blocking rule**: at the gates that consume the S6 verdicts — opportunity `pre_fs` (brownfield) and
   `target_screening` — live `ai_draft` verdicts count as INCOMPLETE review items. `gateGoPrerequisiteGaps`
   (app/web-next/lib/process-flow.ts) reports them as a gap and the gate-decisions routes refuse the GO with
   409 `gate_prerequisites_incomplete` and a machine-readable gap token `ai_draft_review:<n>`.
2. **auto_rule never blocks**: `auto_rule` verdicts are deterministic checks (ADR-0200 §4.1); only `ai_draft`
   counts. Pending rows are not verdicts and never count.
3. **No auto-clear**: the count does not decay. Only a person's save via `recordEvalVerdict` (human) or the
   accept-rule flow turns a row `human`, which removes it from the count.
4. **Scope of "live"**: rows whose target is not `excluded` (a verdict on an excluded target cannot block a
   forward-looking gate) and status ≠ `pending`.
5. **Snapshot visibility**: the gate snapshot carries a display-only `ai_draft_review.unreviewed` count at the
   same two gates (inside the hash; the key is ABSENT at every other gate/entity, so existing snapshot hashes and
   `GATE_SNAPSHOT_SCHEMA_VERSION` 3 are unchanged), and `snapshotInputVersion` includes
   `brownfield_target_eval_state` so a review stale-s the cached preview. It is DISPLAY only — the blocking
   semantics live in `gateGoPrerequisiteGaps`.
6. **Localization**: the gap token is machine-readable (`ai_draft_review:<n>`); the UI translates it via the
   locale JSON key `components.gateIntegrity.gapAiDraftReview` (ko/en) — no new Korean in .ts files.

## Alternatives considered

- **Block at record time** (refuse `ai_draft` application into verdicts): rejected — it would reintroduce the
  pre-0200 confirm queue the owner explicitly replaced with direct application + human review.
- **Block only at target_screening**: rejected — a pre_fs GO consumes the same verdicts.

## Consequences

- A GO can no longer land on unreviewed AI verdicts; HOLD and KILL are never blocked.
- The gap message is localized in ko/en; server detail carries the raw token so programmatic callers (MCP
  record_gate_decision proposals) see a stable contract.
- No snapshot schema bump: the new key is optional and absent outside the two opportunity gates.
