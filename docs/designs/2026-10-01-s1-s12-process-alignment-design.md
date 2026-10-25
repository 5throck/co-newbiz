---
title: S1-S12 Process Alignment Design
date: 2026-10-01
status: implemented (adjudicated 2026-10-25, DEC-20261025-03)
owner: platform-lead
design_gate: Row 0 (platform-lead acts as Design Gate owner; no architect agent exists)
---

# S1-S12 Process Alignment Design

## 1. Purpose and Scope

This design aligns the S1-S12 business-stage specification with the gate ladder, the web stage pages, and the generated docs.
The scope is spec text, generated docs, and a route audit.
This design adds no new UI.
This design implements no fix. Rows 1-5 implement the fixes after approval.

| Item | In scope | Out of scope |
|---|---|---|
| `process/flow.spec.yaml` text fixes | Yes | New stages |
| Stage vocabulary (S vs gate ladder) | Decision options + ADR | Rename before ADR approval |
| S10/S11 objective wording | Yes | Skill changes |
| Implementation-matrix route audit | Findings only | Route deletion |
| S12 lifecycle criteria | Proposal only | Policy change before human approval |

## 2. Findings

### F1. YAML object rendering and typo in flow.spec.yaml

| Field | Content |
|---|---|
| Problem | Unquoted completionCriteria strings that start with `brownfield:` parse as YAML mappings. The generator renders them as `[object Object]` in `docs/process-flow.md` (S8, two lines). The FS gate `fundingDecision` text contained a one-syllable typo that read "chak-si" (illusion) and must read "chak-su" (start), giving "resource allocation for DD start". |
| Evidence | `process/flow.spec.yaml:117`, `:478`, `:479` (quoted strings now); `process/flow.spec.yaml:120` (`fundingDecision`, now reads "chak-su", resource allocation for DD start); `git diff --stat` shows 2 files, 7 insertions, 7 deletions. |
| Decision | Quote every scalar that contains `<word>: ` at the start. Correct the typo from "chak-si" to "chak-su" (resource allocation for DD start). |
| Status | Applied, pending review. PM applied these three edits directly to the working tree. |
| Process note | A PM direct edit breaks the PM role boundary. PM coordinates and does not implement. Row 1 (backend-engineer) must review and own these edits in the PR. |
| Pattern check | Row 1 scans all list items and scalar fields in `flow.spec.yaml` for unquoted `key: value` text. Line 425 (`subjectScope: { greenfield: single, brownfield: shortlist }`) is an intended mapping and stays. Lines 99 and 438 are already quoted. |
| Acceptance | `docs/process-flow.md` contains zero `[object Object]` after regeneration. A unit test or lint step asserts every `completionCriteria` item is a string. |
| Owner | backend-engineer (Row 1) |
| ADR | Not required (text fix). |

### F2. Stage vocabulary collision (S-stage vs gate ladder)

| Field | Content |
|---|---|
| Problem | `process/stages.yaml` defines S1-S8 as a gate ladder (Screening, Target Screening, Pre-FS, FS, DD, Entity IC, Group IC, Post-Close). `process/flow.spec.yaml` defines S1-S12 as business stages. The same id has two meanings. For example, S3 is "Pre-FS" in the gate ladder and a business stage in the flow spec. |
| Evidence | `process/stages.yaml:4-114` (ids S1-S8, titles at lines 5, 22, 38, 53, 68, 84, 99, 114); `process/stages.yaml:50` (`owner_agent: TODO` on S3); `process/stage-aliases.yaml:1-14` (maps `gate:` values onto the DEG Stage axis, ADR-0083); `app/web-next/lib/process-flow.ts:40-46` (S1-S12 business stages). |
| Affected consumers | `process/stage-aliases.yaml`, `procedures/_validate.ts` (closed-registry check, both directions), `tests/unit/stage-aliases-registry.test.ts`, ADR-0074 (process meta-model), ADR-0083 (DEG stage export). |
| Decision | Recommend Option A. Needs an ADR. Needs human approval. |
| Acceptance | No id string resolves to two different stage meanings across `process/**`, `lib/process-flow.ts`, and generated docs. `procedures/_validate.ts` and `stage-aliases-registry.test.ts` pass. S3 (or its renamed id) has a real `owner_agent`. |
| Owner | process-governance-manager (Row 2), with backend-engineer for validator and test changes. |
| ADR | Required. |

Options:

| Option | Change | Pros | Cons |
|---|---|---|---|
| A. Rename gate ladder to G1-G8 | `stages.yaml` ids S1-S8 become G1-G8. `stage-aliases.yaml` targets change to G-ids. `_validate.ts` and the test update the expected prefix. | Clear separation. One meaning per id. Small diff. | Breaks the DEG export id if the workspace standard expects `S`-prefixed ids. Needs an ADR-0083 amendment. |
| B. Namespace the gate axis ("gate stage") without id change | Keep S1-S8. Add an `axis: gate` field. Prefix in docs as "gate-stage S3". | No id migration. | The collision stays in raw data, URLs, and logs. Readers still confuse ids. |
| C. Rename business stages to B1-B12 | Flow spec ids change. | Gate ladder keeps the DEG export unchanged. | Large blast radius: routes `/deals/[id]/[stage]`, `lib/process-flow.ts`, DB rows, docs. |
| D. Use gate slugs as ids (screening, pre_fs, fs, dd, entity_ic, group_ic, ...) | `stages.yaml` ids become the existing gate slugs. | Ids match `gate:` values and the flow spec `gateIds`. Self-describing. | Breaks ordinal sort. Needs an explicit `sequence` field. ADR-0083 amendment. |

Recommendation: Option A (G1-G8). It removes the collision with the smallest blast radius. The ADR must confirm the DEG export contract under ADR-0083 accepts the G prefix or adds a mapping.

### F3. S10 and S11 overlap

| Field | Content |
|---|---|
| Problem | The S11 objective says S11 designs the investment structure (vehicle, financing, payment structure). S10 already owns this. The S11 investment-structuring activity reuses the S10 skills. |
| Evidence | `process/flow.spec.yaml:563`; `app/web-next/lib/process-flow.ts:46` (S11 objective); `app/web-next/lib/process-flow.ts:45` (S10 objective). |
| Decision | S11 consumes the S10 structure. S11 does not design it. Remove the duplicate investment-structuring activity from S11, or change it to a reference to the S10 output. |
| Replacement wording (S11 objective) | English meaning of the Korean replacement string: "Do we invest? Bundle the investment structure and financing plan designed in S10 into the IC package, pass Entity/Group IC review, and on approval execute (entity formation or acquisition closing)." Row 2 writes the Korean text in `flow.spec.yaml`; the leading question stays "tuja-hal geosinga?" ("Do we invest?"). |
| Files changed | `process/flow.spec.yaml` (S11 objective and S11 activity list), `app/web-next/lib/process-flow.ts:46` (same string), `docs/process-flow.md` (regenerated). |
| Acceptance | The S11 objective contains no design verb for the investment structure. The S11 activity list names no S10 skill as its own activity. The strings in `flow.spec.yaml` and `lib/process-flow.ts` match exactly. |
| Owner | process-governance-manager (Row 2) for the spec; frontend-engineer (Row 4) for `lib/process-flow.ts`. |
| ADR | Not required. The change removes a duplicate. It does not change gate ownership. |

### F4. Stale implementation matrix and legacy STAGE_LINK targets

| Field | Content |
|---|---|
| Problem | `docs/designs/2026-09-12-implementation-matrix.md` is a 2026-09-12 snapshot. Routes marked "legacy" are now integrated into `/deals/[id]/[stage]`. `STAGE_LINK` still points at legacy routes. |
| Evidence | `app/web-next/app/deals/[id]/[stage]/page.tsx:30` (`STAGE_LINK` definition); `:234` (single consumer). No other file references `STAGE_LINK`. |
| Decision | Run the audit below. Record findings only. Do not delete routes in this change. |
| Acceptance | The matrix gains an audit table dated 2026-10-01 with one row per legacy route and a "still needed" column for each `STAGE_LINK` target. |
| Owner | platform-lead (Row 5) for the audit; docs-writer (Row 3) for the matrix update. |
| ADR | Not required for the audit. A later route deletion may need one. |

Initial audit snapshot (2026-10-01, from the file tree):

| Legacy route | Page file exists | Redirect | Next check |
|---|---|---|---|
| `/market` | `app/market/page.tsx` | No | Compare with `/deals/[id]/s1` content |
| `/opportunities/[id]` | `app/opportunities/[id]/page.tsx` | No | Check standalone use outside a deal |
| `/synergy` | `app/synergy/page.tsx` | No | Compare with stage page |
| `/route-decision` | `app/route-decision/page.tsx` | Yes (file references `redirect`) | Confirm target |
| `/greenfield` | `app/greenfield/page.tsx` | No | Compare with S5 stage page |
| `/brownfield` | `app/brownfield/page.tsx` | No | Compare with S6/S7 stage page |
| `/projects/[id]/...` | `app/projects/[id]/page.tsx` | No | List sub-routes used by `STAGE_LINK` |

Audit steps:

1. List every `STAGE_LINK` key and target.
2. For each target, record: page exists, redirect or standalone, linked from navigation.
3. Record whether `StageGuidanceTab` (the line 234 consumer) still needs the link after the stage page integration.
4. Record each finding as keep, redirect candidate, or removal candidate. Do not act on candidates.

### F5. S12 is thin (Proposed, needs human approval)

| Field | Content |
|---|---|
| Problem | S12 has one activity, no gate, one artifact (the "venture scorecard", transliterated "bencheo seukoeokadeu"), and one completion criterion. The web already exposes five portfolio transition decisions. |
| Evidence | `app/web-next/lib/process-flow.ts:47` (S12, `gateIds: []`); `app/web-next/lib/process-flow.ts:50-56` (`PORTFOLIO_TRANSITIONS`); `app/web-next/components/stages/PortfolioStage.tsx`. |
| Decision | Proposed only. The criteria are a business policy decision for a human. |
| Owner | process-governance-manager (Row 2) after human approval. |
| ADR | Required if the change touches `policies/**` or `procedures/**`. |

Proposed completion criteria:

| # | Criterion (proposal) | Maps to transition |
|---|---|---|
| 1 | A periodic scorecard review exists for each review period. | all |
| 2 | Each review records one human transition decision with rationale. | all |
| 3 | A continue decision records the next tranche condition. | `next_tranche_released`, `held_evidence_incomplete` |
| 4 | An expansion decision records the hand-off to core business. | `graduate_to_core` |
| 5 | An exit decision records the divestment or wind-down plan. | `reduce_or_divest` |
| 6 | A kill decision records the captured learning and feeds it back to S1/S2 base rates. | `kill_with_learning_captured` |

Policy-impact analysis plan (Co Newbiz lifecycle rules):

1. List every `policies/**` and `procedures/**` file that references S12, post-close, or portfolio monitoring.
2. Run policy impact analysis on each file.
3. Query `project_policy_pin` for every in-flight project. Record which projects pin the current version.
4. Decide whether pinned projects keep the old criteria or migrate.
5. Write the ADR before any procedure change.
6. Get human approval. AI review alone cannot pass a policy change.

## 3. Accessibility

The scope is spec, docs, and route audit. This design adds no new UI. WCAG 2.1 AA work is not affected.
One UI string changes: the S11 objective text, if the stage page shows it. The string change keeps the existing component, heading level, and contrast.

## 4. Preview Verification

Exemption: this design adds no new UI. A full preview verification is not required.
If the S11 objective string shows in the UI, Row 4 renders `/deals/{id}/s11` and confirms the new text, no layout shift, and no console error.

## 5. Execution Plan

The project has no architect or automation-engineer agent, so platform-lead owns Row 0 and backend-engineer owns script work.

PM running on: claude-sonnet-5-5

| # | Task | Agent | Tier | Model | Spec |
|---|------|-------|------|-------|------|
| 0 | Create design doc `docs/designs/2026-10-01-s1-s12-process-alignment-design.md` (Design Gate) | platform-lead | High | opus | NEW |
| 1 | Review and own F1 edits; scan for other unquoted `key: value` scalars; add string assertion | backend-engineer | Medium | sonnet | 2026-10-01-s1-s12-process-alignment-design |
| 2 | F3 spec wording; F2 ADR draft; F5 proposal and impact plan (no policy change before approval) | process-governance-manager | High | opus | 2026-10-01-s1-s12-process-alignment-design |
| 3 | Regenerate `docs/process-flow.md`; update implementation matrix with audit table | docs-writer | Medium | sonnet | 2026-10-01-s1-s12-process-alignment-design |
| 4 | Update `lib/process-flow.ts` S11 string; rendered check if shown | frontend-engineer | Medium | sonnet | 2026-10-01-s1-s12-process-alignment-design |
| 5 | F4 route and `STAGE_LINK` audit | platform-lead | High | opus | 2026-10-01-s1-s12-process-alignment-design |
| N | `/sync "fix(process): align S1-S12 spec, stage vocabulary and matrix"` — lifecycle + audit + commit + push + PR | pm | Medium | sonnet | |

**Execution Order**: Sequential

Dependencies: Rows 1, 2 and 5 follow Row 0. Row 4 follows Row 2. Row 3 follows Rows 1, 2 and 5.

Single-PR plan: Rows 1-5 land in one PR. The F2 rename and the F5 criteria do not land in this PR. They wait for human approval and get their own ADR-backed PRs.

## 6. Verification Plan

| Step | Command | Pass condition |
|---|---|---|
| 1 | `bun run procedures:lint` | Exit 0 |
| 2 | `bun run checklists:lint` | Exit 0 |
| 3 | `bun run glossary:lint` | Exit 0 |
| 4 | `bun run design:lint` | Exit 0 |
| 5 | `bun run validate:language` | Exit 0 |
| 6 | `bun run test:unit` | All pass |
| 7 | `bun scripts/co-newbiz/generate-process-flow.ts` | Regenerated file has no diff beyond intended lines |
| 8 | `grep -c "object Object" docs/process-flow.md` | Output is 0 |

## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| PM direct edits skip specialist review | Unreviewed spec text merges | Row 1 reviews and owns the edits |
| Other unquoted colon scalars exist | More `[object Object]` output | Row 1 scan plus string assertion |
| Stage rename breaks DEG export (ADR-0083) | Workspace-level consumers fail | ADR before rename; alias mapping |
| S11 string drift between spec and web | UI shows stale objective | Exact-match check in Row 4 |
| Route audit read as deletion approval | Live routes removed | Findings only; deletion needs a later decision |
| S12 criteria change affects in-flight projects | Gate rules change mid-deal | `project_policy_pin` check and human approval |

## 8. Open Decisions for the Human

1. Choose the stage vocabulary option for the gate ladder (A: G1-G8, B: namespace only, C: rename business stages, D: gate slugs). Recommendation: A.
2. Assign a real `owner_agent` for gate-ladder S3 (Pre-FS).
3. Approve or amend the S12 lifecycle completion criteria proposal.
4. Decide whether in-flight projects pinned to the current policy keep the old S12 criteria.
5. Approve the S11 replacement wording.
