# ADR-0158 — Archive-or-delete cleanup of pre-ADR-0143 business-case models

- Status: Accepted (2026-10-09, requested by the user in chat)
- Date: 2026-10-09
- Deciders: Human reviewer (user, requested in chat). Drafted by backend-engineer. AI review alone cannot accept this ADR (DB schema change).
- Design of record: `docs/designs/2026-10-09-legacy-model-cleanup-design.md`
- Related: ADR-0143 (S8 per-target axis), ADR-0098 (S8 CRUD), ADR-0154 (human-only actions), ADR-0053 (human decision records)

## Context

ADR-0143 made brownfield S8 per-target. Models created before it carry
`business_case_model.target_id IS NULL`. The S8 list filters by target, so
these models are invisible, yet the R2-E legacy notice still counts them. A
user trying to clear the notice deleted six visible per-target models instead.
At least one legacy model (PRJ-QGB2W5) is referenced by an `s8_case_adopt`
`process_run` — the human adoption behind the fs and IC GO decisions — so
deleting it would break the decision audit trail.

## Decision

1. **Additive migration 0133.** `business_case_model` gains nullable
   `archived_at` and `archived_by`. NULL = active; all existing rows are
   grandfathered. No backfill, no data change.
2. **A human-only cleanup action** (`POST /api/projects/{id}/business-case/legacy-cleanup`,
   analyst+, registered in `HUMAN_ONLY_ROUTES`; agents and OAuth-delegated
   principals are rejected). It acts only on shortlist-scoped projects and only
   on active `target_id IS NULL` models:
   - **unreferenced** → deleted through the existing delete path (simulation,
     line and model rows; `business_case.delete` audit entry);
   - **referenced** (an `s8_case_adopt` process_run `meta.model_id`, or a gate /
     IC evidence blob that names the model id) → ARCHIVED, never deleted
     (`business_case.archive` audit entry).
3. **Archived models** are excluded from the legacy notice count, the S8 list,
   target comparison, `recommendedFromDb` and the completion / RAG predicates.
   They still resolve by id for the adoption and IC-package history views,
   labelled "archived" in the UI.
4. **The ordinary delete** is unchanged, but its button and confirm text
   now name the model's target ("target: X") so a per-target model is not deleted
   by mistake.
5. Boundary #2 holds: cleanup removes no decision; it never touches gate
   decisions, adoption records or per-target models.

## Alternatives considered

- **Delete everything legacy** — rejected: breaks the adoption/IC audit trail.
- **Backfill target_id on legacy models** — rejected (ADR-0143, R2-E): a human
  regenerates; legacy figures were never per-target.
- **Soft-delete via a status column on all models** — rejected: archive is only
  meaningful for referenced legacy models; two nullable columns are enough.

## Consequences

- Existing projects behave identically until a human runs the cleanup.
- Every read of `business_case_model` that feeds a predicate must filter
  `archived_at IS NULL`; history views resolve archived rows explicitly.
- Archive is not reversible from the UI (restore by SQL from the audit trail).
