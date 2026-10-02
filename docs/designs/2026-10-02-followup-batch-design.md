# Follow-up Batch Design — ADR-0150 remainder, spec-activities generator, board 404s

- Date: 2026-10-02
- Author: platform-lead (Row 0 Design Gate)
- Status: draft
- Spec id: (assigned by spec-register)
- Design of record for: three follow-up items left from the ADR-0149/ADR-0150 implementation PR (#448)
- Related: ADR-0150 (S12 lifecycle completion criteria), ADR-0101 (venture_transition_decision ledger), ADR-0102 (pipeline status), ADR-0074 (flow.spec SSOT)

## Scope

Three independent work items in one batch:

1. Transition-record columns for `venture_transition_decision` (needs ADR-0151 + human acceptance before implementation).
2. A deterministic generator for `app/web-next/lib/spec-activities.generated.ts` with a `--check` drift gate.
3. Fix the per-row 404s from `GET /api/opportunities/{id}/pipeline/status` on the /deals board.

Not in scope: implementing item 1 before ADR-0151 is human-accepted; any new UI beyond the item 3 fix.

---

## Item 1 — Transition-record columns (ADR-0151 first)

### Problem

ADR-0150 criteria 3-5 require transition-specific records, but the ledger table has no dedicated columns for them:

- `next_tranche_released` / `held_evidence_incomplete` (criterion 3): next-tranche condition — no column.
- `graduate_to_core` (criterion 4): hand-off to core business record — no column.
- `reduce_or_divest` (criterion 5): divestment or wind-down plan — no column.

Only `rationale` (REQUIRED, `CHECK <> ''`) and `learning_capture` (nullable, criterion 6 only) exist. The S12 predicate currently accepts the criterion 3-5 records as "a non-empty rationale", weakening the accepted criteria.

### Evidence

- `db/migrations/0071_venture_transition_decision.sql:44-45` — `rationale TEXT NOT NULL CHECK (rationale <> '')`, `learning_capture TEXT` only.
- `app/web-next/lib/process-flow.ts:597-601` — the limitation comment (paraphrased): migration 0071 has only the rationale and learning_capture columns; when a migration adds the dedicated columns, strengthen this predicate against them.
- `docs/adr/0150-s12-lifecycle-completion-criteria.md` criteria table (rows 3-5).
- `app/web-next/lib/process-flow.ts:47` — S12 `requiredArtifacts` already name the three records in prose.

### Column-shape comparison

| Option | Pros | Cons |
|---|---|---|
| A — three nullable columns: `tranche_condition`, `core_handoff`, `divest_plan` | Directly queryable (`WHERE tranche_condition IS NULL` finds criterion-3 gaps in SQL); each column maps 1:1 to one ADR-0150 criterion; CHECK constraints per column are expressible (e.g. `CHECK (decision NOT IN ('next_tranche_released','held_evidence_incomplete') OR tranche_condition IS NOT NULL)`); self-documenting schema | Three columns where each row uses at most one; future transition vocabulary change touches DDL |
| B — one nullable `decision_record` JSON column | Simple; schema-stable if the transition vocabulary grows | Record contents not queryable without JSON parsing; no DB-level completeness constraint; drift between code expectations and JSON shape is silent; fails the governance "fail-closed at the schema" pattern used by `rationale`/`learning_capture` |

### Proposed decision — Option A (three columns)

Recommended for queryability and schema-level enforcement: an audit ledger exists to be checked, and a JSON blob hides incompleteness. Add migration `0080_venture_transition_record_columns.sql` (next number after `0079_profile_anchor_remap.sql`), following repo convention: `-- @reversible: true` header (purely additive nullable columns; rollback is pre-migration backup restore per ADR-0014), `ALTER TABLE venture_transition_decision ADD COLUMN ...` for each, `CHECK (...)` per ADR-0150 mapping as above, plain add (no table rebuild), no backfill needed (all existing rows keep NULL; the strengthened predicate makes affected transitions incomplete until recorded — consistent with ADR-0150 IMMEDIATE full application).

Predicate strengthening in `PROJECT_STAGE_COMPLETION.S12` (process-flow.ts): replace the limitation comment; when the latest recorded decision is `next_tranche_released` or `held_evidence_incomplete`, require non-empty `tranche_condition`; `graduate_to_core` → `core_handoff`; `reduce_or_divest` → `divest_plan`; kill path unchanged (`learning_capture`).

Follow-up edits:

- `procedures/_shared/portfolio-venture-monitoring/schema.yaml` — name the three dedicated record fields per step if the step records reference fields (process-governance-manager confirms wording).
- Seed update (`db/seed*` demo path for DEMO-S1-S12) so the demo project keeps working S12 sample rows with the new columns filled.

### Acceptance criteria

1. Migration 0080 applies up and restores down per the repo's migration test path (up/down tested).
2. An S12 evaluation with `next_tranche_released` and empty `tranche_condition` is NOT complete, with a named blocker; same for the criterion 4/5 pairs.
3. Criterion-6 kill path behavior unchanged (existing tests stay green).
4. `test:unit`, `bun run tsc` baseline, `procedures:lint` pass.

### Owner

ADR-0151: process-governance-manager (draft) → human acceptance (gate). Implementation: backend-engineer, ONLY after human acceptance of ADR-0151.

### ADR-0151 title and outline (for process-governance-manager to draft)

Title: **"ADR-0151 — Dedicated transition-record columns for venture_transition_decision (ADR-0150 criteria 3-5)"**

Outline: Context (ADR-0150 criteria 3-5 lack dedicated storage; predicate weakens them to a non-empty rationale); Decision (three nullable columns `tranche_condition` / `core_handoff` / `divest_plan`, CHECK-enforced per decision; Option B JSON rejected — queryability + schema-level fail-closed enforcement); Migration (additive 0080, no backfill, IMMEDIATE application consistent with ADR-0150); Consequences (in-flight incomplete transitions surface as blockers until recorded); Open point for the human: column-shape choice and whether rationale-only historical rows are grandfathered (recommend no grandfathering, matching ADR-0150's IMMEDIATE decision).

Implementation waits for human acceptance of ADR-0151. AI review alone cannot accept it (design boundary 2).

---

## Item 2 — spec-activities generator

### Problem

`app/web-next/lib/spec-activities.generated.ts` says "Do not edit by hand ... regenerate this projection", but no generator exists — the file is hand-maintained and has silently drifted from `process/flow.spec.yaml` before.

### Evidence

- `app/web-next/lib/spec-activities.generated.ts:1-2` — the "generated" header with no generating script.
- `tests/unit/process-flow.test.ts:179-190` — the mirrors-spec test compares the file against the spec at test time, but nothing regenerates or gates the file in CI-style check mode.
- Precedent: `scripts/co-newbiz/generate-process-flow.ts` (v1.4.0, `--check` mode, exit 1 on drift) for `docs/process-flow.md`.

### Proposed decision

New script `scripts/co-newbiz/generate-spec-activities.ts`:

- Reads `process/flow.spec.yaml` and emits `app/web-next/lib/spec-activities.generated.ts` with the SAME shape and exports as today: header comment, `SPEC_VERSION` (from `spec.meta.version`), `SPEC_STAGES: SpecStage[]` with `{ id, activities: [{ id, agent, skills, procedure }] }`, deterministic key order and 2-space JSON indentation matching the current file (byte-identical round-trip is the acceptance bar).
- `--check` mode: exit 1 if the file would change (mirrors generate-process-flow.ts).
- Wire into the same places the process-flow drift gate is wired (package script / pre-commit coverage used by generate-process-flow.ts).
- Switch the workflow to generate-then-test: the test at `tests/unit/process-flow.test.ts:179` keeps asserting equality; contributors run the generator after spec edits, and `--check` catches drift.

### Acceptance criteria

1. `bun scripts/co-newbiz/generate-spec-activities.ts` on the current repo produces a byte-identical file (no diff).
2. `bun scripts/co-newbiz/generate-spec-activities.ts --check` exits 0 now, and exits 1 when the spec changes without regeneration.
3. `test:unit` green; `tsc` baseline unchanged.

### Owner

backend-engineer (Medium, sonnet).

---

## Item 3 — Board pipeline-status 404s

### Problem

The /deals board calls `GET /api/opportunities/{id}/pipeline/status` per row and the browser console shows 404s for several ids (`demo-s1-s12-opportunity`, several ULIDs) for a viewer-role user.

### Diagnosis (from the route code)

The route exists and is reachable. Two 404 paths exist in `app/web-next/app/api/opportunities/[id]/pipeline/status/route.ts`:

1. Line 20: opportunity row not found — NOT the cause; the board lists ids from `GET /api/opportunities`, so rows exist.
2. **Line 33: `if (!run) return notFound()` — the actual cause.** Opportunities with no `pipeline_run` rows at all (never started a pipeline run — the demo project and stale ULIDs) hit this. Auth is not the cause: `requireBusinessActor(auth, "read")` (route line 16; `app/web-next/lib/auth.ts:167-177`) allows viewer for read mode (it only blocks admin and viewer-write), so a viewer gets the same 404.

The board fetch is fire-and-forget with `.catch(() => undefined)` (`app/web-next/app/deals/page.tsx:97-103`), so the 404s are harmless to rendering but noisy — and a legitimate "no run yet" state is indistinguishable, by status code, from "entity missing".

### Proposed decision

Change the not-found-run branch to return a default payload: `200` with `{ pipeline_run_id: null, status: "none", current_stage: null, paused_reason: null, deep_link: null, segments: [] }` (keep the row-missing 404 at line 20 — a truly unknown id should still 404). The board's existing `.then` handler already no-ops unless `status === "paused_for_human"`, so no board change is required, but the handler must ignore `status === "none"` explicitly. Correct semantics: a status probe for a known entity with no run is a defined state, not an error; suppressing the per-row calls is rejected because paused banners must still be fetched per row.

### Acceptance criteria

1. Board loads at the /deals route with ZERO console errors for both viewer and analyst roles (opportunities with and without pipeline runs).
2. A paused run still lights its banner with the ADR-0102 deep link (regression check).
3. Unknown id still returns 404; unauthenticated still 401.

### Owner

backend-engineer (Medium, sonnet).

---

## Risks

| Risk | Mitigation |
|---|---|
| Item 1 blocks the batch on human ADR-0151 acceptance | Split PR plan (below): items 2-3 ship independently |
| Strengthened S12 predicate regresses in-flight demo data (rows with rationale-only criterion-3-5 decisions become incomplete) | Consistent with ADR-0150 IMMEDIATE application; demo seed updated in the same PR; surface as named blockers, not silent failures |
| Generated file differs in formatting from the current hand-maintained file | Acceptance bar is byte-identical regeneration; if the initial regeneration changes bytes, land that regeneration in the same PR and confirm test:unit |
| 200-with-default weakens "unknown entity" signal | Keep the line-20 404; only the no-run case becomes 200 |

## Verification plan

- `bun run test:unit` (process-flow tests including the mirrors-spec test, board-related route tests)
- `bun run tsc` baseline unchanged
- `bun run design:lint`, `bun run validate:language`, `bun run procedures:lint`
- Migration 0080 up/down tested per repo migration convention

## Accessibility / Preview note

- Item 3 affects the board UI: rendered check of /deals at 2 breakpoints (desktop and narrow), zero console errors, paused banner keyboard-reachable via its existing link.
- Items 1-2 are non-UI (DB schema + generator script): exempt.

## Execution order (per execution-plan-templates §5.1)

PM running on: GLM-5.3-Flash[1m]

| # | Task | Agent | Tier | Model | Platform |
|---|---|---|---|---|---|
| 0 | This design document + registration | platform-lead | High | opus | claude |
| 1 | Draft ADR-0151 (outline above) | process-governance-manager | High | opus | claude |
| 2 | Schema migration 0080 + predicate + seed — AFTER human acceptance of ADR-0151 | backend-engineer | Medium | sonnet | claude |
| 3 | spec-activities generator + --check gate | backend-engineer | Medium | sonnet | claude |
| 4 | Board pipeline-status 404 fix | backend-engineer | Medium | sonnet | claude |
| N | /sync (final step) | pm | Medium | sonnet | claude |

PR plan: recommend ONE PR (items 2-4) with item 2 gated behind ADR-0151 human acceptance in time — i.e. ship items 3-4 first and add item 2 in the same PR once accepted; if acceptance is delayed beyond the review window, SPLIT: PR-A (items 3-4), PR-B (item 2, after acceptance).

## Open decisions

1. ADR-0151 human acceptance (gates item 2). Draft owner: process-governance-manager.
2. Column-shape choice (Option A three columns vs Option B JSON) — design recommends Option A; human decides in ADR-0151.
3. Grandfathering of rationale-only historical criterion-3-5 rows — recommend none (matches ADR-0150 IMMEDIATE); confirm in ADR-0151.
