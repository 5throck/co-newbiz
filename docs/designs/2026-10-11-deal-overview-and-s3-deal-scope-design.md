# Deal Overview Rebuild and S3 Deal Scope - Design

- **Date**: 2026-10-11
- **Status**: approved (Design Gate Row 0)
- **Owner**: platform-lead
- **ADR**: none required (no DB schema, auth, or MCP tool-scope change; existing API contract reused)

## 1. Problem

Verified by PM on deal `01M2FYGNTDXNAZSQGQ7RXD0RER` (status assessed, attractiveness 72, synergy score null, no project).

**Deal overview** (`app/web-next/app/deals/[id]/page.tsx`):
- The step rail prints only numbers 1..12; the S3 page stepper (`StageRail` in `components/StageFrame.tsx`) shows names.
- "What to do now" is an unlabelled list merging `blockers` and `requiredArtifacts`, with raw values (for example "(selected)").
- "Track: undecided - progress:" ends blank (`RawKey` renders nothing when the track is null).
- The "Input <-" / "Output -> S4" strip carries no content.
- No key facts: attractiveness, synergy, gate decisions, HOLD, rationale, linked project or analyses.
- Sidebar: both "review/deal board" (`/deals`, active because `pathname.startsWith("/deals/")`) and "current deal overview" are marked active (`components/AppShell.tsx` ~L361 and ~L387).
- `DealBreadcrumb` duplicates the top-bar back control.

**S3 stage** (`components/stages/synergy/*`, mounted by `app/deals/[id]/[stage]/page.tsx` with `opportunityId={params.id} embedded`):
- `GET /api/synergy/analyses` is global; the list shows 3 analyses all linked to other deals with no indication that none belong to this deal.
- No per-deal start action; the new-analysis form leaves the opportunity picker (`oppSel`) empty by default.
- The company table (`data-table list-table`) is clipped at the right edge at pane width.

## 2. Decisions

### A. Deal overview rebuild

1. **Named stepper**: replace the ad-hoc `sizing-step-rail` with the shared `StageRail` (or a read-only variant fed by `lib/process-flow.ts` `STAGES[].name`), keeping skipped/complete/current states. Each step shows "S<n> <name>" and a non-colour state marker (check, dot, strike) plus a text equivalent for screen readers.
2. **Labelled sections**, in order:
   - **Current stage**: id, name, objective (from `STAGES`).
   - **Next action**: exactly ONE primary button "Go to stage screen" -> `dealStageHref(id, currentStage)` (`lib/deal-links.ts`). If terminated or all done, a status sentence and no primary button.
   - **Completion criteria**: `requiredArtifacts` rendered as a checklist with an explicit done / not-done state per item. An item is "not done" while it appears in `blockers`; otherwise "done". Blockers that are not artifacts render in a separate "Blockers" sub-list. Never a merged anonymous list.
   - **Artifacts**: links to the stage tabs that hold the artifacts (reuse `stageArtifactTabs`).
3. **Key facts card**: attractiveness, synergy score (with "recommended, not confirmed" when `synergy_score_confirmed_at` is null), track, gate decisions (chip per gate via `GATE_LABEL`/`DECISION_LABEL`), HOLD state with link via `gateHoldHref` (`lib/inbox.ts`), rationale excerpt, linked project, linked synergy analyses count with link to S3.
4. **Empty values**: any null/empty field renders the literal label "not recorded" (Korean UI string meaning "not recorded"), muted style. A helper `displayOrNotRecorded(v)` in `lib/labels.ts` is the single path. The track line uses it so it can never end blank.
5. **Raw enums**: every value from `blockers`/`requiredArtifacts`/status passes through `lib/labels.ts` (`RECORD_KEY_LABEL`, `localizeRequirement`). Parenthesised raw tokens such as "(selected)" are mapped (e.g. to "selected target") or stripped by `localizeRequirement`; a unit test asserts no `(snake_or_lower)` token survives.
6. **Input/Output strip**: remove it here, or populate it from `STAGES` (previous stage name -> current -> next stage name). Decision: populate; if neither side has a value, do not render it.
7. **Sidebar single active item**: in `AppShell`, the `/deals` item is not active when `pathname === dealOverviewHref` or `pathname.startsWith(dealOverviewHref + "/")`; only "current deal overview" carries `aria-current="page"` there.
8. **Breadcrumb**: remove `DealBreadcrumb` from the overview page (AppShell back already provides it), consistent with the earlier back-nav sweep.

### B. S3 deal scope

1. **Ordering and toggle**: client-side partition of the existing list into "this deal" (`a.opportunity_id === opportunityId`) and "other deals". This-deal rows come first and carry a "this deal" badge (text, not colour only). A segmented toggle "this deal only / all" (default: this deal only when embedded with an `opportunityId`; standalone `/synergy` keeps "all"). The toggle state is reflected as `aria-pressed`.
2. **Explicit empty state**: when embedded and no analysis is linked to this deal, show "No synergy analysis is linked to this deal yet" plus the count of analyses on other deals (reachable via the toggle). Never silently show other deals' rows as if they belonged here.
3. **Primary action "Start analysis for this deal"**: opens the existing `NewSynergyForm` with the opportunity pre-bound (see section 3). The existing "+ new analysis" and "new synergy evaluation" buttons keep their current behaviour; on the deal tab the per-deal action is the single primary, the others become secondary.
4. **Table overflow**: wrap the table in the existing `.table-scroll` container and add a minimum width modifier (same pattern as `.market-list-table` / `.opp-funnel-table`) so narrow panes scroll horizontally instead of clipping.

## 3. Binding mechanism for a per-deal analysis (no API or schema change)

`POST /api/synergy/analyses` already accepts `opportunityId`, validates it exists, and writes `synergy_analysis.opportunity_id`. The pipeline (`lib/synergy-pipeline.ts` ~L87) then writes the recommended `opportunity.synergy_score` / `synergy_rationale` and clears confirmation when the value changes. So binding is:

1. "Start analysis for this deal" calls `setOppSel(opportunityId)` and `setShowNewForm(true)` in `useSynergyList`.
2. In the form, the opportunity field shows the deal name as a visible, pre-filled value with a "change" control; the user still picks the group or affiliate target and presses "create". Nothing is submitted automatically.
3. Submission sends the existing body `{ targetType, memberId | groupId, opportunityId }`.

The group/affiliate profile requirement is unchanged: if no profile exists the API returns `profile_required` and the form keeps its existing link to the profile screen (`profileHrefFor(opportunityId)`).

This is not auto-selection of an opportunity: the deal is the screen's own context, the value is shown, editable, and only sent on an explicit human click. No analysis is auto-picked as "the" result beyond the existing auto-open of a linked analysis.

**Project carrier**: when `/deals/<id>` resolves to a promoted project, `params.id` is a project id, not an opportunity id. The frontend must pass the project's source opportunity id (from `/api/projects/[id]`) as `opportunityId`; if none exists, the per-deal action is disabled with a reason. Row 1 confirms the field is already exposed; if not, it adds it to the existing response (additive, no schema change).

**Optional server filter**: `GET /api/synergy/analyses?opportunityId=` (additive query param, same columns) is permitted but not required; client partitioning suffices at current volumes.

## 4. Data contract

- `GET /api/opportunities/{id}/process` (unchanged): `currentStage, nextStage, blockers[], requiredArtifacts[], gateStatus{}, track, subTrack, terminated, stages[]`.
- `GET /api/opportunities/{id}` (read only): `attractiveness`, `synergy_score`, `synergy_rationale`, `synergy_score_confirmed_at`, `status`, linked project id. Missing fields -> "not recorded".
- HOLD: existing hold source used by the inbox; link via `gateHoldHref({entityType, entityId, gate})`.
- `GET /api/synergy/analyses` (unchanged; optional additive `opportunityId` filter).
- `POST /api/synergy/analyses` (unchanged body).

## 5. Tests

- Unit: `displayOrNotRecorded`; `localizeRequirement` leaves no raw parenthesised token; partition helper `partitionAnalysesByDeal(analyses, opportunityId)`; completion-state derivation (artifact in blockers -> not done); AppShell active-item predicate (only one active on `/deals/<id>`).
- Source-reading: overview page no longer imports `DealBreadcrumb`; overview uses `dealStageHref` and `gateHoldHref`; exactly one `btn-primary` in the overview next-action section; S3 list table is inside `.table-scroll`; "start analysis for this deal" calls `setOppSel(opportunityId)` and does not call `createAnalysis` directly.
- If Row 1 adds the filter: route test that `opportunityId` filters and unknown id returns an empty list.

## 6. Accessibility (WCAG 2.1 AA)

- Stepper: `nav` with label, `aria-current="step"` on current, state conveyed by text and icon, not colour alone (1.4.1).
- Sections use headings h2 in order (1.3.1, 2.4.6); checklist items carry a visually hidden "done"/"not done" text.
- Toggle: buttons with `aria-pressed`; the list region announces count changes via a polite live region.
- Sidebar: a single `aria-current="page"`.
- Scrollable table wrapper is keyboard focusable (`tabIndex=0`, labelled) (2.1.1); contrast of the muted "not recorded" text meets 4.5:1 via existing tokens.

## 7. Preview verification

Verify in the browser at >= 2 breakpoints (desktop ~1440px and narrow ~768px, plus 375px for the table): overview shows named steps, labelled sections, no blank values, one active sidebar item; S3 on the reference deal shows the empty state with "start analysis for this deal", toggle reveals the 3 other-deal analyses, and the table scrolls instead of clipping. Run `design:lint`.

## 8. ADR assessment

No ADR: no table/column change, no auth or MCP scope change, POST contract reused. If Row 1 found that a column or table change were required, an ADR would be required before merge; the no-schema path in section 3 is the chosen design.

## 9. Non-goals

- Changing the synergy pipeline, scoring, or confirmation flow.
- Auto-creating or auto-running analyses, or auto-confirming synergy scores.
- Gate approval UI changes (humans decide gates; the overview only links to the decision screen).
- Reworking the standalone `/synergy` page beyond the shared table fix.

## 10. Open questions for the human

1. Default toggle on the deal S3 tab: "this deal only" (proposed) or "all"?
2. Should analyses linked to other deals be re-linkable to this deal from the S3 tab? Proposed: no (out of scope).
3. For a promoted project without a source opportunity, should "start analysis for this deal" be hidden or disabled with a reason? Proposed: disabled with reason.
4. Overview Input/Output strip: populate from stage metadata (proposed) or remove entirely?

## 11. Task split

| Row | Agent | Scope |
|---|---|---|
| 1 | backend-engineer | Confirm `/api/opportunities/[id]` exposes key facts and project responses expose the source opportunity id (additive only if missing); optional `opportunityId` filter on `GET /api/synergy/analyses`; `displayOrNotRecorded` and `localizeRequirement` hardening in `lib/labels.ts`; unit tests. |
| 2 | frontend-engineer | Overview rebuild (A1-A8), AppShell active predicate, S3 partition/toggle/empty state/per-deal action/table scroll (B1-B4), source-reading tests, preview verification. |
