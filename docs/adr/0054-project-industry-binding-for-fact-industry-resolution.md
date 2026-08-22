# ADR-0054: Project-industry binding (`project_industry`) — append-only target-market binding

**Status**: Accepted
**Date**: 2026-08-23
**Deciders**: platform-lead, industry-lead

> Accepted in the same change that implements it (migration `0021_project_industry_binding.sql` + `db/lib/snapshot-filler.ts` 1.1.0) — the approach was approved by the user on 2026-08-23. This ADR closes the record-vs-schema gap the filler PR reported in the `snapshot-filler.ts` 1.0.0 module header ("KNOWN GAP") and in its CHANGELOG entry: the approved threshold records resolve `fact_industry` metrics per `industry_id` (D-M-MKT-3) and expect TAM/growth live at Screening and Pre-FS (D-M-MKT-9), but no project→industry carrier existed anywhere in the schema.

## Context

The three threshold decision records (`docs/decisions/market-thresholds.md`, `risk-thresholds.md`, `technical-execution-thresholds.md`, all approved 2026-08-23) are implemented 1:1 by migrations 0019/0020 and the snapshot filler. One contract could not be made live by schema alone: **D-M-MKT-3 resolves `market_tam_krw` / `market_growth_yoy_ratio` / `market_top3_share_ratio` per `industry_id`**, but nothing in the schema says which industries a given project reviews. The only project→industry carrier was `value_chain_link` — whose `from_industry_id`/`to_industry_id` describe chain **adjacency** (an assessment edge between two industries), not target-market **membership**, and whose semantics at Screening — where D-M-MKT-9 requires TAM already live — are undocumented. The filler therefore shipped 1.0.0 fail-closed: `industryIds` a caller parameter, default none → the three fact vars written `missing`, leaving the screening/pre-FS tam-growth rules UNASSESSED rather than false-passing.

That gap blocks PR-9 activation from making the tam-growth rules genuinely live: with no binding, every screening fill writes `missing` and the rules never fire on real evidence.

## Decision

### 1. New append-only table `project_industry` — the 0013 pattern, applied to industries

Migration 0021 creates:

| Column | Shape | Why |
|---|---|---|
| `id` | TEXT PK | Append-only rows; a binding is history, never a mutable slot |
| `project_id` | FK → `md_project(id)`, NOT NULL | The reviewing project |
| `industry_id` | FK → `md_industry(id)`, NOT NULL | The bound target-market industry (KSIC-anchored master data) |
| `bound_by` | NOT NULL | Who judged the binding (audit; agents inherit the calling user's identity) |
| `bound_at` | NOT NULL | Caller-supplied ISO-8601 TEXT (ADR-0002); the migration seeds nothing, so no fixed literal appears in it |
| `rationale` | NOT NULL | A binding is a judged claim — the `dimension_input` / `project_case_classification` discipline |
| `superseded_by` | self-FK | Row that replaced this one; non-NULL = not live |

This is `project_case_classification`'s pattern verbatim (and the pattern 0015 rebuilt `project_policy_pin` onto): re-binding adds a row and supersedes, so "which industries did this project review against last quarter" stays answerable — the same audit-trail rationale ADR-0047 §4 gave for pins.

### 2. One live binding per (project, industry); multiple distinct live industries per project are LEGAL

`idx_project_industry_live` is a partial UNIQUE on `(project_id, industry_id) WHERE superseded_by IS NULL` — at most one **live** row per pair; history rows never block re-binding. Unlike classification (exactly one live row per project), **multiple distinct live industries are deliberately allowed**: multi-industry targets are real (a target spanning two KSIC classes). The consequence is decided at **read** time, not banned at write time — the filler's documented conservative handling stands unchanged: two live bindings → the three fact vars are `missing`, because the record resolves per `(industry, metric)` and no decided aggregation exists across industries. Narrowing a project to one industry (retiring a binding) restores resolution immediately.

### 3. No `direction` column

`value_chain_link.direction` (`upstream`/`downstream`) describes the chain relation **between two industries**. This binding is the project's own target-market industry — membership, not traversal. A direction column here would invite reading the binding as a chain edge, conflating the two carriers the filler keeps separate (Family A reads bindings; Family B reads links).

### 4. Filler semantics: live bindings are the DEFAULT set; `industryIds` UNIONS

`snapshot-filler.ts` 1.1.0 reads live `project_industry` rows as the default industry set for the fact family. The existing `opts.industryIds` becomes an explicit **supplement** that unions with the bound set (kept for tests and direct runs) — it never replaces it. Fail-closed default preserved: no bindings and no option → `missing`, never guessed.

### 5. No seed, no backfill; write layer deferred

No live projects require backfill; the pilots' industries are bound when their cases are run — binding is a judged act (`bound_by` + `rationale`), and inventing bindings at migration time would be exactly the guess-the-answer the fail-closed default exists to prevent. No repository writer lands with this ADR (the 0013 precedent — the governance-controlled write path is its own PR); tests and future writers use raw SQL. The exact **unbind** write (a flip-pattern successor that stays non-live, or another convention) is deliberately left to that writer PR — the schema's only promise is the reader contract `live = superseded_by IS NULL`, which the filler and tests rely on.

## Consequences

- PR-9 activation can make `market-screening-tam-growth` / `market-pre-fs-tam-growth` genuinely live: a case binds its target industry at screening, facts resolve, the rule fires on evidence.
- The filler PR's reported record-vs-schema gap is closed; its CHANGELOG flag and module-header gap note are retired in the same change.
- Unbinding semantics beyond "superseded_by IS NOT NULL leaves the live set" remain an open write-layer question (Decision 5) — visible here, decided by the repository PR, not silently by convention.
- A project deliberately left multi-industry will read `missing` on TAM/growth/top3 at every gate until narrowed — the honest output, per D-M-MKT-3's per-industry resolution; any aggregation across industries would be a new record decision, not a filler liberty.
- Related: ADR-0046 (the evidence-var registry and snapshot the filler writes into), ADR-0047 §4 (the append-only supersede pattern's audit rationale), D-M-MKT-3/-9 (the contracts this binding makes reachable).
