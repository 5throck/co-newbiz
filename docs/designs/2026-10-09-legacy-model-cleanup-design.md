# Legacy business-case model cleanup (S8)

- Date: 2026-10-09
- Status: Implemented
- ADR: `docs/adr/0158-legacy-business-case-archive.md`
- Related: ADR-0143, R2-E legacy notice (`lib/business-case-legacy.ts`)

## Problem

The brownfield S8 list shows only the selected target's models, so pre-ADR-0143
models (`target_id` NULL) are invisible, but the legacy notice still counts
them. A user deleted six visible per-target models trying to clear it. One
legacy model is the adopted case behind an fs/IC GO and must not be deleted.

## Design

- Migration 0133: nullable `archived_at`, `archived_by` on `business_case_model`.
- `lib/business-case-legacy.ts`: `legacyModelsWithReferences` / `cleanupLegacyModels`.
  Referenced = an `s8_case_adopt` process_run whose `meta.model_id` is the model,
  or a `gate_decision` / IC package evidence text that contains the id.
  Unreferenced legacy models are deleted (simulations, lines, model; audit
  `business_case.delete`); referenced ones are archived (audit
  `business_case.archive`).
- `POST /api/projects/{id}/business-case/legacy-cleanup` (analyst+, human-only;
  rejected for delegated/agent principals). `GET .../business-case` returns
  `legacy_models` (name, scenario, variant, created date, `referenced`).
- Archived models are excluded from list, comparison, RAG and completion
  predicates; `listBusinessCases` returns them separately in `archived`, and the
  adoption/IC-package/report views resolve the adopted case from both sets and
  show an "archived" chip.
- UI: the notice lists each legacy model with a "referenced: archive" or "unreferenced: delete"
  tag, per-model and bulk legacy-model cleanup behind a confirm dialog. The ordinary
  delete button and its confirm body name the target.

## Accessibility and tokens

Onyx 3.0 tokens only; status conveyed by chip text, not color alone; buttons
have visible text labels and are keyboard operable via the shared confirm dialog.

## Out of scope

Un-archive UI, backfill of target_id, any change to gate decisions.
