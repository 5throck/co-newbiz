# Deal Pipeline Linkage Repair (P1) + Upgrade-Clobber Restoration — Design

- **Spec ID**: 2026-09-12-pipeline-linkage-p1-design
- **Date**: 2026-09-12
- **Status**: implemented
- **Scope**: app/web-next (UI surfaces), tests/unit, roster/skill file restoration
- **Upstream analysis**: stage-by-stage S1–S12 linkage audit (2026-09-12) — findings P1-1..P1-4

## 1. Problem

The S1–S12 process chain is organically linked in `process/flow.spec.yaml` and the
`evaluateProcess()` engine, but three UI-level linkages were broken, making the
screen-level journey dead-end at S7:

| # | Finding | Impact |
|---|---------|--------|
| P1-1 | No UI trigger for `POST /api/opportunities/[id]/promote` (nor `pipeline/start`) | A user completing S5 (greenfield) or S7 (brownfield) has no path to create the project — the S7→S8 carrier handoff is unreachable from the UI |
| P1-2 | `StageRail` renders `role="link"` spans without href | The S1–S12 progress strip looks navigable but is inert |
| P1-3 | `/pipeline` header links to `/projects/undefined/process` | `useParams()` misused on a static route |
| P1-4 | `/projects` "view opportunity" (Korean) link to `/opportunities?id=…`; the page only reads `status` | Deep link lands on the unfiltered list |

Additionally, commit db271ba ("design gate phase C — fleet sync") clobbered
project-specific content — the same failure class as the CI clobber repaired in
7dd396d: 39 roster files under `agents/` and 57 deal-pipeline skills under
`skills/` were deleted, breaking `tests/unit` (process-flow, committee-boundary,
skill-graph) and the declared source of truth of
`scripts/co-newbiz/sync-agent-personas.ts` ("Source of truth: agents/*.md") and
AGENTS.md. Six pre-existing web-next build/type errors blocked `bun run build`.

## 2. Design

### 2.1 PromotionPanel (P1-1)

New `app/web-next/components/PromotionPanel.tsx` — the single promotion surface,
mounted on the three places a deal reaches its track-final stage:

- `/greenfield` (after `GateDecisionPanel`) (heading suffixed "promote to project (S5 → S8)" in Korean)
- `/brownfield` (after `CommitteePanel`) (heading suffixed "promote to project (S7 → S8)" in Korean)
- `/opportunities` expanded row (`status === "selected" && !project_id`)

Behavior:

- Reads `GET /api/opportunities/[id]/process` to show track + track-final stage
  (S5 greenfield / S7 brownfield, per `applicableTracks`) completion state and
  current blockers. Readiness display only — the authoritative precondition
  check remains server-side (`promoteOpportunity`), per ADR-0095 ("fact checks,
  not judgements").
- Submits `POST /api/opportunities/[id]/promote` with `needToKnowBasis`
  (required), optional `origin` enum and `project_name`; on success navigates
  to `/projects/{project_id}`. A `useConfirm()` dialog states the consequences
  (charter auto-build, promoter becomes lead).
- Boundary #2 preserved: promotion is recorded only by this explicit human
  action; no automation writes it (pipeline.test.ts regression untouched).
- Role separation (ADR-0091): the panel renders `null` for `admin`; `viewer`
  sees the form disabled with an analyst+ note. API rejections
  (`already_promoted`, `precondition_failed`, `role_*`) map to plain-language
  Korean messages.

Pattern/tokens: standard screen pattern (SectionToolbar + section), existing
`market-section`/`sizing-new-form`/`btn-ghost`/`status-chip` vocabulary;
no new tokens or components (design-token conformance, ADR-0087).

### 2.2 Clickable StageRail (P1-2)

`components/StageFrame.tsx` adds a `STAGE_HREF` map derived from stage ids:
S1→`/market`, S2→`/opportunities`, S3→`/synergy`, S4→`/route-decision`,
S5→`/greenfield`, S6/S7→`/brownfield`; S8–S12 resolve to
`/projects/[id]/<sub>` only when a project context exists (`params.id`, i.e.
rendered under `/projects/[id]/**`). Track-inapplicable stages stay non-links
(struck-through). Links use `next/link` with `aria-current` retained.

### 2.3 Pipeline page link (P1-3)

Removed the `useParams`-derived broken header link; funnel rows already link to
each project's `/projects/[id]/process`.

### 2.4 Opportunity deep link (P1-4)

`/opportunities` now also reads `?opportunity=` on mount and expands that row;
`/projects` "view opportunity" href switched to the same parameter.

### 2.5 Upgrade-clobber restoration

Restored only the paths deleted by db271ba (from `db271ba^`), leaving surviving
files untouched: 39 × `agents/<name>.md`, 57 × `skills/<key>/SKILL.md`.
Verified with `bun run agent:verify` (40/40 documented, 0 orphans).

### 2.6 Pre-existing build/type repairs (gate unblock)

| File | Repair |
|---|---|
| `app/companies/page.tsx` | import depth `../../../lib` → `../../lib` |
| `app/api/companies/[companyId]/sync/route.ts` | dropped spurious `actor` opt (audit is the separate `appendAudit` call) |
| `lib/envelope.ts` | `EnvelopeStatus` gains `503` (route documented 503 for DART-not-configured) |
| `app/projects/[id]/wacc/page.tsx` | type-predicate filter for non-null suggestions; `missing?: string[]` on view state |
| `lib/dart-financial-facts.ts` | import `getDb`; optional `fin.yearly` handling |
| `lib/report-composer.ts` | DD completion verdict from `pending === 0 && mandatoryUnmet === 0` (field `complete` never existed) |
| `db/lib/wacc-reference.ts` | return computed `spread_pct` (required by `WaccReference`) |
| `tests/unit/wacc-session.test.ts` | drop hardcoded `asOf` that slips into the past and flips `as_of DESC` ordering (hazard documented in the test's own comment) |

## 3. Alternatives considered

- Promotion button per row in `/opportunities` list (rejected: N×process fetches;
  the expanded row bounds the fetch and the stage pages are the natural place).
- StageRail linking to `/process/[stage]` card hub (rejected: direct stage pages
  are the working surfaces; the hub remains reachable by URL).
- Restoring whole `agents/`+`skills/` dirs from history (rejected: would
  overwrite post-upgrade updates of surviving files; selective path restore is
  exact).

## 4. Verification

- `bun run build` (web-next) — passes
- `bun run test:unit` — 99 files pass (incl. navigation parity, pipeline
  boundary, promotion preconditions)
- `bun run design:lint` + `cd app/web-next && bun run lint:design` — 0 violations
- `bun run contrast:check` — all enforced pairs ≥ 4.5:1 both themes
- `bun run agent:verify` — 40 agents verified

## 5. Follow-ups (separate specs)

- P2 spec-conformance hardening (greenfield 5-criteria enforcement, promotion
  gate preconditions, S11 charter/IC-package predicates, gate placement
  validation, fail-closed project default) — 2026-09-12 pipeline alignment work.
- Deal-centric workspace IA (ADR-0105 revision) per the approved phased plan.
