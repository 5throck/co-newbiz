# ADR-0056: project_industry repository write path and the retire convention

**Status**: Accepted
**Date**: 2026-08-23
**Deciders**: PM, process-governance-manager (procedure/policy track)
**Resolves**: ADR-0054 Decision 5 (the deliberately-open unbind write question)

## Context

Migration 0021 landed `project_industry` schema-only, following the 0013 precedent (governance-controlled write paths land as their own PR). ADR-0054 Decision 5 left the exact **unbind** write deliberately undecided: "the schema's only promise is the reader contract `live = superseded_by IS NULL`." `snapshot-filler.ts` 1.1.0 reads live bindings as the default fact-family industry set; until this PR, no writer existed and bindings were reachable only via raw SQL in tests.

## Decision

**`db/repositories/project-industry.repository.ts`** is the single governance-controlled write path (the only `project_industry` writer application code may import):

- **`bindIndustry()`** — first binding for an industry appends a live row; binding a **different** industry while others are live is legal (0021: multi-industry targets are real; the consequence is decided at read time by the filler, not banned at write time); binding the **same** industry as a live row re-binds via the classification supersede sequence (successor born non-live → predecessor retires → successor goes live — the order `idx_project_industry_live` forces).
- **`retireIndustry()`** — resolves Decision 5 with a **born-dead self-superseded successor**: the retire marker row is INSERTed with `superseded_by = its own id`, then the target row's `superseded_by` points at the marker. Both statements in one transaction. The marker reuses the append-only row shape (`bound_by` = who retired, `bound_at` = when, `rationale` = why), so the unbind is itself history — "which industries did this project review against last quarter" stays answerable without new columns or a schema change.
- **`getLiveBindings()`** — the live set, mirroring the reader contract.

**Why born-dead rather than classification's three-step sequence**: classification's successor must eventually *go live*, so it is born non-live and goes live in a third step. A retire marker never goes live — its whole purpose is to record that a binding ended — so the sequence collapses to born-dead plus one UPDATE. The self-reference is honest FK-wise (ids are caller-supplied or ulids, so the row's own id exists when the INSERT runs), and `superseded_by = id` is a signature no real binding can have (a binding superseded by itself means nothing supersedes it).

**Governance layer** (the classification.repository.ts doctrine): DB CHECKs and indexes constrain *shape* (append-only, partial unique live slot, `rationale` NOT NULL); the repository enforces *governance* — every write requires an active `project_member` row (FR-SEC-08, `requireActiveMember`), current insider status at write time on MNPI projects (FR-SEC-06, `requireInsiderIfMnpi`), and both `appendAudit` (actions `project_industry_bound` / `_rebound` / `_retired`) and `logDataAccess` rows. All checks run **before** the transaction opens, so no rejection leaves partial state. Named errors (not raw FK failures) for unknown project/industry/nothing-to-retire.

## Consequences

- Bindings are now creatable by application code; the filler's default industry set becomes operationally reachable.
- A retired binding can be re-bound afterwards — history never blocks (proven by test: original binding, retire marker, new live row coexist).
- The born-dead convention is now precedent for any future "end-of-life without successor" rows on 0013-pattern tables.
- Tests: `tests/unit/project-industry-repository.test.ts` (16 tests) — guards, multi-live, supersede, born-dead retire, partial-index shape, audit trail.
