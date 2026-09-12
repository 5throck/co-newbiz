# Pipeline Spec-Conformance Hardening (P2) — Design

- **Spec ID**: 2026-09-12-pipeline-alignment-p2-design
- **Date**: 2026-09-12
- **Status**: implemented
- **Scope**: process engine predicates, promotion repository, gate/route APIs, MCP tool, spec-copy parity gates
- **Upstream**: S1–S12 linkage audit (2026-09-12) findings P2-1..P2-5; companion to 2026-09-12-pipeline-linkage-p1-design

## 1. Problem

The spec (`process/flow.spec.yaml` v2.3.0) and the enforcement code had drifted
at five points, all on the "is the spec actually enforced" side of the
definition/execution split (ADR-0074):

| # | Finding |
|---|---------|
| P2-1 | Greenfield S4 5-criteria scoring not enforced (spec v2.2.0+: greenfield also records the 5-criteria scorecard, ADR-0104) — both the REST route and the S4 completion predicate checked brownfield only |
| P2-2 | Promotion preconditions looser than the auto-pipeline: `promoteOpportunity` checked artifacts only; the pipeline additionally requires every track-relevant gate GO (`firstPendingGate`) — the direct path could promote past a pending/never-recorded gate, and the project branch then asserts S1–S7 complete |
| P2-3 | S11 completion ignored two spec requiredArtifacts: the adopted Business Case (IC package's quantitative input) and the charter baseline confirmation — the confirmation surface itself had no writer (`charter_confirmed_at` was read-only dead schema) |
| P2-4 | Gate placement unvalidated: the opportunity route accepted project-carrier gates (fs/dd/entity_ic/group_ic) |
| P2-5 | Project-stage default predicate was fail-open (unmapped S8+ stages auto-complete), asymmetric with the opportunity branch |

Plus B1: two of the four spec copies (`process-flow.ts` `STAGES`,
`spec-activities.generated.ts`) had no drift gate — only `stage-meta.ts` and
`docs/process-flow.md` were test-locked.

## 2. Design

### 2.1 Greenfield S4 scoring (P2-1)

- `route-decision/route.ts` POST: `intent` + 5-criteria `scores` are mandatory
  for BOTH tracks; the lexicographic pre-exclusion check stays brownfield-only
  (partnership/rbd/corporate_venture sub-tracks do not exist on greenfield).
- `process-flow.ts` S4 predicate: `scoreCount >= 5` required regardless of
  track; brownfield sub_track requirement unchanged.
- `route-decision/page.tsx`: Stage 1 intent fieldset renders for both tracks
  (track-neutral route hints); Stage 2 scoring legend always mandatory;
  `canSubmit` requires intent + full scoring on both tracks.
- Compatibility: existing greenfield decisions without scores make S4
  incomplete — remediation is re-recording the decision with scores via the
  existing form (latest decision wins). Noted in the UI guidance.

### 2.2 Promotion gate alignment (P2-2)

`assertPromotionPreconditions` now requires latest-decision GO for
`screening` + `pre_fs` (both tracks) and `target_screening` (brownfield),
mirroring `pipeline.ts firstPendingGate` exactly. Latest-per-gate uses the same
`ROW_NUMBER ... ORDER BY decided_at DESC, id DESC` tie-break as
`latestGateDecisions` so the two paths cannot disagree. This is an explicit
amendment of ADR-0095's "fact checks only" posture: the fact checks remain,
gates are added so neither promotion path can outrun the other.

### 2.3 S11 predicate + charter confirmation surface (P2-3)

- S11 predicate adds: an adopted business case (`process_run` row
  `stage='s8_case_adopt'`, `status='done'`, `meta_json.model_id` — the same key
  `latestAdoption` reads) and a confirmed charter
  (`md_project.charter_json` + `charter_confirmed_at`, migration 0074).
- New `POST /api/projects/[id]/charter/confirm` (analyst+, member-visible,
  open projects): stamps `charter_confirmed_at`, audit `project_charter.confirm`,
  idempotent re-stamp (re-baselines after an amendment). Registered in
  `docs/architecture/openapi.yaml` (ADR-0109 drift gate).
- Charter page: a "confirm charter baseline (S11 input)" action (Korean label) when unconfirmed, with
  the re-confirm-after-amendment rule stated inline.

### 2.4 Gate placement (P2-4)

Opportunity gate-decisions route accepts only `screening|pre_fs|target_screening`;
project-carrier gates are rejected with a pointer to the project route.
Existing rows untouched (new recordings only).

### 2.5 Fail-closed project default (P2-5)

`evaluateProjectStage` default flips to `complete: false` — symmetric with the
opportunity branch; a future unguarded stage surfaces as blocked, never
auto-complete.

### 2.6 Spec-copy parity gates (B1)

`tests/unit/process-flow.test.ts` gains two gates:
- `STAGES` (process-flow.ts) mirrors the spec verbatim — id/sequence/name/
  objective/gateIds/requiredArtifacts string-equal; `applicableTracks ["all"]`
  normalized to `[greenfield, brownfield]`.
- `spec-activities.generated.ts` — `SPEC_VERSION` equals `meta.version` and
  every stage's activity list (id·agent·skills·procedure, ordered) equals the
  YAML.

To satisfy the first gate, the `STAGES` copy was regenerated verbatim from the
YAML (objectives + requiredArtifacts, including S11's charter line). This also
repairs the stale "flow.spec v2.2.0" comment (P3) — `stage-meta.ts` header now
cites v2.3.0.

## 3. Test updates

Fixtures that promote via `promoteOpportunity` now seed the required gate GOs
(9 files); S11/S12-completion fixtures additionally seed the adopted case and
charter (portfolio) or exercise the confirm endpoint (ic-package). The MCP
`create_route_decision` tool schema now carries `intent` + `scores` (required),
matching the REST contract. New coverage: pending-gate promotion rejection,
charter confirm endpoint, both spec-copy parity gates.

## 4. Verification

- `bun run test:unit` — 99 files pass
- `bun run build` (web-next) — passes
- `bun run design:lint` + app-local `lint:design` — 0 violations
- `bun run contrast:check` — pass
