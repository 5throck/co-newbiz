---
title: Recalibrate the calibration loop — 15% convergence goal, escalation removal, top-down reference visibility
date: 2026-11-13
status: Implemented (Design Gate ADR-0074 — Row 0 determination accepted per DEC-20261113-03; implemented 2026-11-13 including amendments 2026-11-13a/b; registered implemented in docs/specs/registry.json)
owner: backend-engineer (design; PM dispatch per DEC-20261113-03)
reviewers_required: process-governance-manager (AI-2nd, functional domain — author is technical domain), frontend-engineer consult (UI surfaces), owner (human approval)
decision_record: docs/decisions/DEC-20261113-03.md
supersedes: docs/designs/2026-09-20-calibration-escalation-design.md (that doc is NOT edited; supersession recorded here per its frontmatter/relationships only)
related: design 2026-09-18-s1-growth-gap-calibration (loop of record, incl. amendments 2026-11-12/12b/12c), design 2026-11-06-s1-quantitative-web-grounding (owns the consensus priority ladder and ANCHOR_CITATION_TOLERANCE_PCT), ADR-0074 (Design Gate), ADR-0012 (append-only audit), DEC-20261113-03
---

# Recalibrate the calibration loop — 15% convergence goal, escalation removal, top-down reference visibility

## 1. Conclusion (the chosen design)

The S1 growth-gap calibration loop gets **one goal line**: the bottom-up vs top-down relative
CAGR gap must fall **below 15%**. One constant (`CONVERGENCE_GOAL_PCT = 15`) replaces both of
today's disagreeing thresholds — the 20% proposal trigger (`CALIBRATION_TRIGGER_PCT`,
`market-calibration.ts:12`) and the sweep's 15% feasibility line (`calibration-sweep.ts:21`) — so
"triggered" simply means **unconverged** (gap ≥ 15%) and "converged" (gap < 15%) ends the loop:
no proposals, no unconverged badge, trend stays visible. The **deterministic-scaling escalation
is removed in full** — its ×0.85 output pins the residual at exactly 15.0% (it can never satisfy
"< 15%") and it erases the independent bottom-up estimate; `resolveEffectiveCagr` becomes "raw
bottom-up of the latest completed version, or null", the escalate route, its UI, and the four
downstream `escalated_*` response fields die with it, and the one historical
`calibration_escalation` row survives untouched as a read-only history card (no destructive
migration). The **calibration sweep stays** as the loop's planning tool — it is the only
mechanism that answers "can accepted driver combinations reach < 15% before a costly
re-analysis" — with goal-line semantics and its escalation-suggesting message text dropped. And
the **top-down reference becomes visible where the consensus is shown**: a reference chip in
`SizingGrowthTab`, an additive `{ reference, latest }` shape on the external-reference GET that
lets the growth tab banner "The displayed version's consensus cites a superseded reference —
re-analysis will recompute the consensus" (en.json `consensusCitesSupersededReference`) when
the displayed version predates the supersede, and a per-`captured_from` tolerance note in
`resolveTopDownConsensus` so pipeline-saved LLM priors stop wearing the "person-recorded"
label (translated from the Korean copy).

Mental model: the loop is a **thermostat, not a scaler**. The 15% line is the set point; while
the room is warmer than the set point the loop keeps showing the gap, the driver proposals, and
the re-analysis door. The old escalation was a fake window — it reported exactly-set-point
temperature by overwriting the thermometer. We remove the window, keep the thermometer honest,
and give the sweep the role it always had: the pre-flight check of whether the heating
(accepted drivers) can ever reach the set point.

Advisory boundary unchanged (R6): proposals, badges, banners, and CTAs are LLM/UX outputs;
re-analysis and accept/release decisions stay human. No auto-triggered reruns anywhere in this
design.

## 2. Verified state (KNOWN)

All file:line anchors read on the working tree, 2026-11-13.

- **Trigger**: `CALIBRATION_TRIGGER_PCT = 20` (`market-calibration.ts:12`);
  `isCalibrationTriggered` = `gap !== null && gap >= CALIBRATION_TRIGGER_PCT`
  (`market-calibration.ts:62-65`); gap basis is `relativeCagrGapPct` = |our − external| /
  external × 100, rounded to 0.1, `null` when external ≤ 0 (`market-calibration.ts:54-59`).
  Pipeline call site: `market-sizing-pipeline.ts:1276`; summary strings mention "calibration
  trigger (≥20%)" (Korean copy) at `:1338` and `:1348`. Tests pin 20 at `tests/unit/market-calibration.test.ts:77`.
- **Proposal cadence**: when the trigger fires, step 5-C collects up to 5 driver proposals
  (`market-sizing-pipeline.ts:1310-1334`); at persist time the pipeline deletes ALL
  `status='proposed'` rows for the industry and inserts the fresh batch
  (`market-sizing-pipeline.ts:1692-1703`). Not triggered → no proposal writes.
- **15% line today**: `CONVERGENCE_TARGET_PCT = 15` defined twice — escalation-only
  (`market-calibration.ts:216`; used by `computeDeterministicScaling:227-228` and the
  already-converged guard `:286-291`) and the sweep (`calibration-sweep.ts:21`; feasible ratio
  `:137`, success/infeasible messages `:234-235` where the infeasible branch suggests
  "consider escalation" (Korean copy), echoed field `convergence_target_pct:239`).
- **Escalation**: POST route
  `app/web-next/app/api/market-overview/industry/[industryId]/calibration/escalate/route.ts`
  (analyst+, rationale mandatory, 409 on `already_converged`); registered in
  `docs/architecture/openapi.yaml:5769-5783` (operationId `applyCalibrationEscalation`). UI:
  `CalibrationEscalation.tsx` (whole file: applied-record card + offer + rationale form),
  mounted by `CalibrationPanel.tsx:11,279-291` with `offer={triggered && (cal?.gapPct ?? 0) > 15}`
  (`:281`); panel state/POST at `CalibrationPanel.tsx:40-42,137-152`. The calibration GET
  returns `escalation: latestCalibrationEscalation(...)` (`calibration/route.ts:43`). Table
  `calibration_escalation` (migration 0119) holds one row (drone, 2026-11-12) — preserved.
- **Resolver**: `resolveEffectiveCagr` (`market-calibration.ts:329-372`) — escalation branches at
  `:354-362` (escalation newer than the version wins) and `:364-370` (escalation as fallback when
  the payload has no numbers). Five consumers, all verified:
  `projects/[id]/business-case/route.ts:58` (exposes `escalated_cagr_pct` at `:84`),
  `market-overview/insights/route.ts:95` (exposes at `:94-96`),
  `our-company/members/[memberId]/profile/route.ts:31` (injects `escalatedCagrPct` at `:26-32`),
  `lib/business-case-generator.ts:171-176` (overrides `marketGrowth` only when
  `source === "escalated"`), `lib/company-profile-pipeline.ts:252` (sets `escalatedCagrPct`).
  UI readers of those fields: `BusinessCaseStage.tsx:243,1067-1072`,
  `ProfileBasicTabs.tsx:114`, `components/stages/our-company/types.ts:48`.
- **External-reference GET**:
  `app/api/market-overview/industry/[industryId]/external-reference/route.ts:21` returns
  `{ reference: resolveExternalReference(db, industryId) }`; the resolver filters
  `superseded_at IS NULL` (`market-calibration.ts:70-78`). No query returns the absolute latest
  row regardless of supersession. Consumers: `CalibrationPanel.tsx:69-74` and
  `SizingGrowthTabs.tsx:47-54` — both read `r.data.reference` only.
- **Growth tab**: shows `matrix.consistency.topDownCagr` via `ConsistencyChart`
  (`SizingScenarioCharts.tsx:159-170`) and the `tolerance` note (`SizingGrowthTabs.tsx:153-155`);
  reference DETAILS (source_label, captured_from, target_year, source_url, created_at) render
  only inside `CalibrationPanel.tsx:177-222`. The tab's live GET already carries every chip
  field (`SizingGrowthTabs.tsx:30-38` local `RefRow`, populated at `:47-54`).
- **Staleness**: `referenceNewerThanVersion` (`market-reference-staleness.ts:10-19`) fires only
  when an ACTIVE reference is newer than the displayed version; `rerunCtaMode` hardcodes
  `Math.abs(gapPct) >= 20` (`:26`); the growth tab's inline gap card gate is also `< 20`
  (`SizingGrowthTabs.tsx:174`). A superseded reference produces `reference = null` → no banner,
  no chip — the verified drone case (superseded 2026-11-13 01:22, v4 created 01:20 still
  showing topDown 14%) displays nothing today.
- **Consensus note**: the recorded-reference branch of `resolveTopDownConsensus`
  (`market-sizing-pipeline.ts:391-400`) interpolates `captured_from` verbatim into the note
  "person-recorded external reference ({source_label}, {captured_from})…" (Korean copy,
  `:397`) and hardcodes
  `source.origin: "user"` (`:399`). `llm_prior` rows are auto-saved by the pipeline
  (`appendExternalReference` with `captured_from: "llm_prior"`,
  `market-sizing-pipeline.ts:1214-1220`; `web_research` at `:1189-1196`). Step 5-B's own summary
  already branches per origin (`:1157`) — wording precedent exists. The note suffix
  "used for internal consistency checks only (not independent verification)" (Korean copy) is
  shared by every branch and stays.
- **No house precedent for retiring endpoints**: `openapi.yaml` has no operation-level
  deprecation/removal pattern (only a schema-property `deprecated: true` at `:8756`).
- **Cancelled predecessor**: no "persistent escalation" artifact exists anywhere in `docs/` or
  `memory/` (grep-verified) — the DEC records the decision sequence instead.
- **Spec registration**: `bun scripts/spec-register.ts --file <doc> --source manual` upserts
  `docs/specs/entries/<id>.json` and regenerates `docs/specs/registry.json`.

### INFERRED

- Aligning the trigger to 15% makes proposals regenerate in the 15–20% band on every (human-initiated)
  rerun. Churn is bounded by the existing delete-then-insert cadence (`:1692-1703`) and is the
  intended behavior — the loop must present its next action while unconverged.
- Removing the escalated_* fields is display-safe: every consumer of those fields is a chip or
  note computed directly from them (verified above); no arithmetic depends on their presence.
- After the resolver change, the drone escalation row stops influencing business-case/insights/
  profile surfaces — those surfaces show bottom-up again. This is the intended outcome of the
  user decision, stated here so the change is not a surprise in review.

### ASSUMED

- The single `calibration_escalation` row (drone, 2026-11-12) is the only production row
  (user-stated 2026-11-13).
- All escalation locale keys removed below exist under `stages.s1.calibrationPanel` in
  `locales/ko.json`/`en.json` (observed at ko `:3540-3562`); the exact key set is re-checked at
  implementation time by grep.

### UNKNOWN

- Whether the web-grounding design owner wants `ANCHOR_CITATION_TOLERANCE_PCT` (20,
  `market-calibration.ts:19`) revisited once the trigger moves to 15% — see §6, interaction
  note. This design keeps 20 and flags it; it does not decide for that doc's owner.
- Whether any client outside this repo calls the removed escalate endpoint — none exists in this
  workspace (the MCP registry has no calibration tools, grep-verified); stated as a PR-body break
  notice rather than a compat shim.

## 3. Design

### 3.1 One goal line — trigger = unconverged (user decision 1)

- **Constant**: `market-calibration.ts` gains `export const CONVERGENCE_GOAL_PCT = 15;` (the
  loop's set point). `CALIBRATION_TRIGGER_PCT` (20) is deleted. `isCalibrationTriggered` becomes
  `gap !== null && gap >= CONVERGENCE_GOAL_PCT` — "triggered" now means exactly "unconverged".
  `calibration-sweep.ts` drops its local `CONVERGENCE_TARGET_PCT` and imports
  `CONVERGENCE_GOAL_PCT` (no import cycle: sweep imports nothing from market-calibration today;
  market-calibration does not import sweep), keeping the `convergence_target_pct` response field
  fed from it. Direction check: sweep → market-calibration only.
- **Boundary semantics**: converged = gap < 15; unconverged = gap ≥ 15 (on the 0.1-rounded gap).
  Boundary tests pin 14.9 → not triggered, 15.0 → triggered.
- **Pipeline ripples** (`market-sizing-pipeline.ts`): the step-5-C branch (`:1308`), the proposal
  persist block (`:1692`), and the summary strings (`:1338`, `:1348`) follow the new constant;
  summary wording becomes "unconverged (goal line 15%)" style instead of "calibration trigger
  (≥20%)" (both Korean copy).
- **UI ripples**:
  - `CalibrationPanel` badge (`:155-170`): triggered → red unconverged chip (reworded
    "calibrationNeeded" → unconverged semantics); cal present && !triggered → green converged chip
    (reworded "belowTrigger" → converged); no cal → nothing. The gap-trend table (`:357-388`) is
    unchanged and stays visible in both states.
  - Growth-tab gap card + CTA: `rerunCtaMode`'s hardcoded 20 (`market-reference-staleness.ts:26`)
    and the inline `< 20` gate (`SizingGrowthTabs.tsx:174`) import `CONVERGENCE_GOAL_PCT` instead
    of hardcoding — one number everywhere.
- **Escalation offer gate** (`CalibrationPanel.tsx:281`) dies with the escalation (§3.2).
- **Interaction note (recorded, not decided here)**: `ANCHOR_CITATION_TOLERANCE_PCT` stays 20.
  After this change a 15–20% gap can attach an anchor citation AND fire the loop. Accepted as
  benign — the citation is a provenance record of size agreement within ±20%; the trigger is the
  next-action signal — but the "one gap, two directions" (Korean source) disjointness comments
  (`market-calibration.ts:14-18`, pipeline citation block `~:1252-1263`) become stale and are
  updated to describe the overlap. Flagged to the web-grounding design owner (UNKNOWN above).

### 3.2 Escalation removal (user decision 2)

- **Route**: delete `app/api/market-overview/industry/[industryId]/calibration/escalate/route.ts`
  and its `openapi.yaml` path block (`:5769-5783`). **API contract break stated in the PR body**:
  `POST /api/market-overview/industry/{industryId}/calibration/escalate` is removed (404 after
  deploy); no deprecation shim — no house precedent exists for retired endpoints, all consumers
  are in-repo, and a shim would keep ×0.85 nominally alive. No migration: the route's removal is
  a file deletion; `calibration_escalation` (migration 0119) is untouched.
- **Lib** (`market-calibration.ts`): delete `computeDeterministicScaling`,
  `applyCalibrationEscalation`, `EscalationError`, and the escalation-local
  `CONVERGENCE_TARGET_PCT` (`:216`). **Keep** `CalibrationEscalationRow` and
  `latestCalibrationEscalation` — the calibration GET (`calibration/route.ts:43`) keeps returning
  `escalation` so history stays readable.
- **Resolver** (`resolveEffectiveCagr`, `:329-372`): both escalation branches deleted. New
  contract: read the latest completed version → `matrix.calibration.ourCagrPct`, else
  `matrix.consistency.bottomUpCagr`, else null → `{ cagrPct, source: "bottom_up" }` or null.
  The `EffectiveCagr.source` type narrows to `"bottom_up"`; `escalationId`/`baseCagrPct` fields
  are removed.
  **Explicit behavior change for the 5 consumers**: all of them now always receive the raw
  bottom-up CAGR of the latest completed version (or its `consistency.bottomUpCagr` fallback), or
  null. Previously, a person's escalation decision newer than the latest version overrode the
  value with external × 0.85 — e.g. `business-case-generator.ts:171-176` would replace
  `marketGrowth`; that override becomes dead and is deleted with the source check.
- **Field removals (contract breaks, same PR-body notice)**:
  `escalated_cagr_pct` removed from the business-case GET (`:84`) and insights GET
  (`insights/route.ts:94-96`); `escalatedCagrPct` removed from the member-profile GET
  (`profile/route.ts:26-32`) and `company-profile-pipeline.ts:252-260`. UI readers die with them:
  `BusinessCaseStage.tsx` escalated-CAGR chip (`:243,1067-1072`),
  `ProfileBasicTabs.tsx:114`, `our-company/types.ts:48`.
- **UI**: `CalibrationEscalation.tsx` shrinks to a **read-only history card** — the applied-record
  branch (`:39-54`) stays (chip reworded to a "Retired policy — past decision (display only)"
  — en.json `escalationApplied` — muted state), the offer
  and rationale-form branches (`:56-93`) are deleted; `CalibrationPanel` drops the escalation
  state, `applyEscalation`, `showEscalate`/`escalateRationale`, and the form props (`:40-42`,
  `:137-152`, `:277-291`) but keeps rendering `EscalationSection` with the GET's `escalation`
  row. Rationale: the record was a person's decision that downstream surfaces displayed until
  now — hiding it would make CAGR changes unexplained; read-only display in the panel where it
  was decided is the smallest audit-visible change (the `calibration_escalation` row and the
  `market_calibration.escalate` audit entries remain in the DB regardless).
- **Sweep stays** (`calibration-sweep.ts`): the feasible-ratio sweep is the loop's planning tool
  — it projects whether accepted driver combinations can reach the goal line before a person
  spends a re-analysis. Its 15% line was already goal semantics; only the infeasible message
  drops the escalation suggestion (Korean copy: "…add proposals, re-review the reference, or
  consider escalation" → "…add proposals or re-review the reference"). Verdict threshold
  (feasible_ratio ≥ 0.05), table
  (`calibration_sweep_result`), and audit are unchanged.
- **Supersession**: `2026-09-20-calibration-escalation-design.md` is marked superseded by THIS
  doc's frontmatter only — that doc is not edited (house mutation model: supersession is recorded
  by the successor).

### 3.3 Top-down reference visibility (user decision 3)

- **(a) Reference chip in the growth tab.** One caption line rendered directly under the
  tolerance note (`SizingGrowthTabs.tsx:153-155`), when the live GET's `reference` is non-null:
  "Top-down consensus reference: {source_label} · {captured_from label} · targeting
  {target_year} · CAGR {external_cagr_pct}% · recorded {created_at date}" (en.json
  `topDownReferenceChip`), with `source_url` as a link when present. Every
  field is already client-side (`RefRow`, `SizingGrowthTabs.tsx:30-38`) — no new fetch, no prop
  drilling. New locale keys under `stages.s1.sizingGrowthTabs` (en + ko). When `reference` is
  null the chip is absent — the superseded banner (below) covers that case.
- **(b) Superseded-reference staleness.** The external-reference GET becomes additively
  `{ reference: row | null, latest: row | null }` where `latest` is the newest row regardless of
  supersession — new tiny query `latestExternalReferenceRow(db, industryId)` in
  `market-calibration.ts` (same ORDER BY as `resolveExternalReference:74`, without the
  `superseded_at IS NULL` filter). Both existing consumers read `r.data.reference` only
  (`CalibrationPanel.tsx:69-74`, `SizingGrowthTabs.tsx:47-54`) — additive field, zero consumer
  churn; this is why the nested-key replacement shape was rejected. New pure comparator in
  `market-reference-staleness.ts`: `consensusCitesSupersededReference(latestSupersededAt,
  versionCreatedAt)` → true iff both parse and the version predates the supersede (fail-closed
  false on missing/unparseable, mirroring `referenceNewerThanVersion:14-18`). Banner condition in
  `SizingGrowthTab`: `reference === null && latest?.superseded_at != null &&
  consensusCitesSupersededReference(latest.superseded_at, detail.versions[0]?.created_at)` →
  render the staleness card with the message "The displayed version's consensus cites a
  superseded reference — re-analysis will recompute the consensus" (en.json
  `consensusCitesSupersededReference`) and the re-analysis CTA (`showCta={ctaMode !== "gap"}` —
  the existing gap card wins to avoid duplicate buttons, same rule as `rerunCtaMode:25-29`).
  Mutually exclusive with the C1 banner by construction: C1 requires `reference != null`, this
  banner requires `reference === null`. Precision of the condition: a version created AFTER the
  supersede no longer cites the retired row (the fallback ladder resumed at its run) — the
  version-predates-supersede check is what keeps the banner truthful. Verified real case
  satisfied: drone v4 (created 01:20) predates the supersede (01:22) → banner; any post-supersede
  version → no banner.
- **(c) Per-captured_from consensus note.** The recorded-reference branch of
  `resolveTopDownConsensus` (`market-sizing-pipeline.ts:391-400`) maps the lead phrase by
  `ref.captured_from` (lead phrases below are English renderings of the shipped Korean copy):
  - `user` → "person-recorded external reference"
  - `web_research` → "reference obtained via web search"
  - `llm_prior` → "LLM-prior reference saved by the pipeline (verification needed)"

  The suffix "used for internal consistency checks only (not independent verification)" is
  unchanged for every branch, and `summaryLabel` (`:396`, "(recorded external reference)") is
  unchanged — all three origins ARE recorded
  references. The same fix sets `source.origin = ref.captured_from` (`:399` today hardcodes
  `"user"`), so anchor provenance stops mislabeling pipeline-saved priors. Wording precedent:
  the step 5-B summary already branches user vs pipeline-saved (`:1157`).

## 4. Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| 1 | Persistent escalation (cancelled predecessor) | Output pinned at exactly 15.0% residual can never satisfy "< 15%"; erases the independent bottom-up estimate. Cancelled pre-artifact; superseded by the removal decision (DEC-20261113-03). |
| 2 | Keep the 20% proposal trigger, add a separate "unconverged" presentation at 15% | Two live thresholds: the 15–20% band would show a green "below trigger" chip while the goal line says unconverged — the exact mixed signal this design removes. The band's hysteresis purpose fed the escalation path, which dies. |
| 3 | Remove the sweep with the escalation | The sweep is the loop's only forward-looking planning tool (can accepted drivers reach < 15%?); its 15% line already has goal semantics. Only its escalation-suggesting message dies. |
| 4 | Destructive migration of `calibration_escalation` | Audit and decision history are append-only (ADR-0012 family); the table and its row stay, the write path stops existing. |
| 5 | Hide the historical escalation record from the UI | The record was a person's decision that downstream surfaces displayed until today; silent hiding makes CAGR changes unexplained. Read-only card = smallest audit-visible change. |
| 6 | Deprecation shim (410 / null-field grace period) for removed endpoint/fields | No house precedent for retired endpoints; all consumers in-repo and cleaned in the same PR; break documented in DEC + design + PR body. |
| 7 | Note-only fix for the llm_prior mislabel (leave `source.origin: "user"`) | Same root cause — the recorded-reference branch ignores `captured_from`; fixing the note while anchor provenance still says "user" leaves a contradiction in the same payload. |
| 8 | Replace the external-reference GET payload shape (nested key move) | Two existing consumers read `r.data.reference`; an additive `latest` field reaches the goal with zero consumer churn. |
| 9 | Also move `ANCHOR_CITATION_TOLERANCE_PCT` to 15 | Constant is owned by design `2026-11-06-s1-quantitative-web-grounding`; its citation semantics (size agreement within ±20%) do not depend on the loop trigger. Kept; overlap band accepted and flagged. |

## 5. Acceptance criteria (testable)

1. **Goal-line trigger**: `isCalibrationTriggered(11.5, 10)` (gap 15.0) → true;
   `isCalibrationTriggered(11.49, 10)` (gap 14.9) → false;
   `isCalibrationTriggered(9.4, 10)` (gap 6.0) → false; external ≤ 0 → false unchanged.
   `CONVERGENCE_GOAL_PCT === 15`; `CALIBRATION_TRIGGER_PCT` no longer exists (grep-clean).
2. **Unconverged presentation**: a payload with gap ≥ 15 shows the red unconverged chip and
   carries driver proposals after a triggered rerun; a payload with gap < 15 shows the green
   converged chip, no proposals are written, and the gap-trend table remains visible.
3. **Escalation gone**: `POST .../calibration/escalate` → 404; no openapi entry; grep finds no
   `computeDeterministicScaling` / `×0.85` / `applyCalibrationEscalation` outside
   `calibration_escalation` history references; `resolveEffectiveCagr` returns
   `{ cagrPct, source: "bottom_up" }` or null, and an existing `calibration_escalation` row in
   the DB does NOT change its output.
4. **History preserved**: `calibration_escalation` still holds the drone row (migration 0119
   untouched); the calibration GET still returns `escalation`; the panel renders the record
   read-only with no apply affordance.
5. **Consumers**: business-case, insights, member-profile responses no longer carry
   `escalated_cagr_pct` / `escalatedCagrPct`; business-case generation uses the bottom-up CAGR
   (no escalation override branch); tsc passes with the narrowed `EffectiveCagr` type.
6. **Reference chip**: with an active reference, the growth tab renders the chip with
   source_label, captured_from label, target_year, CAGR, and record date; without one, no chip.
7. **Superseded banner**: after a supersede, GET returns `{ reference: null, latest: <row> }`; a
   version created before `superseded_at` shows the banner with the re-analysis CTA; a version
   created after it does not; an active newer reference shows the existing C1 banner instead
   (mutual exclusivity pinned by test).
8. **Consensus note**: the recorded-reference tolerance note uses the per-`captured_from` lead
   phrase; the `llm_prior` payload no longer contains the "person-recorded external reference"
   phrase; `source.origin`
   equals `captured_from` in all three branches; the shared suffix is byte-identical to today.
9. **Sweep**: `feasible_ratio` still measured against 15; the infeasible message contains no
   escalation suggestion; `convergence_target_pct` === 15.
10. **Standard gates**: `bun run test:unit`, `bunx tsc --noEmit` (web), `biome ci --changed`,
    design-lint, `lint:i18n`, and the openapi drift gate all green.

## 6. Touched files

- `app/web-next/lib/market-calibration.ts` — `CONVERGENCE_GOAL_PCT`, trigger rewrite,
  `latestExternalReferenceRow`, resolver narrowing, escalation lib deletion (§3.1, §3.2, §3.3b).
- `app/web-next/lib/calibration-sweep.ts` — import the goal constant, infeasible message
  (§3.2).
- `app/web-next/lib/market-sizing-pipeline.ts` — trigger/summary wording, proposal branch
  constant, consensus note + origin (§3.1, §3.3c).
- `app/web-next/lib/market-reference-staleness.ts` — `consensusCitesSupersededReference`,
  `rerunCtaMode` constant import (§3.1, §3.3b).
- `app/web-next/app/api/market-overview/industry/[industryId]/calibration/escalate/route.ts` —
  DELETED (§3.2).
- `app/web-next/app/api/market-overview/industry/[industryId]/external-reference/route.ts` —
  GET returns `{ reference, latest }` (§3.3b).
- `docs/architecture/openapi.yaml` — escalate path block removed (§3.2).
- `app/web-next/app/api/projects/[id]/business-case/route.ts`,
  `app/web-next/app/api/market-overview/insights/route.ts`,
  `app/web-next/app/api/our-company/members/[memberId]/profile/route.ts`,
  `app/web-next/lib/business-case-generator.ts`,
  `app/web-next/lib/company-profile-pipeline.ts` — escalated-field removal (§3.2).
- `app/web-next/components/stages/market/CalibrationEscalation.tsx` — read-only history card
  (§3.2).
- `app/web-next/components/stages/market/CalibrationPanel.tsx` — badge rewording, escalation
  state/form removal (§3.1, §3.2).
- `app/web-next/components/stages/market/SizingGrowthTabs.tsx` — reference chip, superseded
  banner, gap-gate constant (§3.1, §3.3a, §3.3b).
- `app/web-next/components/stages/market/GrowthBannerViews.tsx` — banner message variant for the
  superseded case (§3.3b).
- `app/web-next/components/stages/BusinessCaseStage.tsx`,
  `app/web-next/components/stages/our-company/ProfileBasicTabs.tsx`,
  `app/web-next/components/stages/our-company/types.ts` — escalated-chip/field removal (§3.2).
- `app/web-next/locales/en.json`, `app/web-next/locales/ko.json` — chip + banner keys added,
  escalation offer keys and stale badge wording updated (§3.1–§3.3).
- Tests (§7).

## 7. Test plan (house patterns: lib-level scratch SQLite, renderToStaticMarkup under
NextIntlClientProvider, source-assertion pins)

- `tests/unit/market-calibration.test.ts` — boundary rewrite: `CONVERGENCE_GOAL_PCT === 15`;
  gap 15.0 triggers, 14.9 does not; external ≤ 0 never triggers; constraint builder unchanged.
- `tests/unit/calibration-escalation.test.ts` — rewritten as the removal regression suite (file
  name kept deliberately: it now pins that escalation is inert): insert a `calibration_escalation`
  row by direct SQL, assert `resolveEffectiveCagr` ignores it and returns bottom-up / null;
  assert `source === "bottom_up"` only; assert the escalation lib exports no longer exist
  (source-assertion or import-null check).
- `tests/unit/market-growth-staleness.test.ts` — `consensusCitesSupersededReference` cases:
  version predates supersede (true), postdates (false), missing/unparseable (false — fail-closed);
  `rerunCtaMode` at the 15 boundary (gap 15 → "gap", 14.9 + referenceNewer → "staleness").
- `tests/unit/market-growth-banner-render.test.ts` — render pins: superseded banner message +
  CTA, reference chip markup, converged/unconverged panel chips (house renderToStaticMarkup
  pattern); source-assertion pins for the banner condition wiring in `SizingGrowthTab`.
- `tests/unit/market-sizing-web-grounding.test.ts` (and `tests/unit/sizing-matrix-guard.test.ts`
  where it pins consensus strings) — per-`captured_from` note wording (three branches), shared
  suffix byte-identical, `source.origin` equals `captured_from`, `summaryLabel` unchanged.
- `tests/unit/external-reference-supersede.test.ts` — GET shape: after supersede
  `{ reference: null, latest: <superseded row> }`; before any supersede `latest === reference`.
- `tests/unit/calibration-sweep.test.ts` — constant import renamed, `convergence_target_pct === 15`,
  infeasible message contains no escalation suggestion.
- Pipeline/route regression: existing market route suites re-run; business-case/insights/profile
  payloads asserted without the removed fields; full gates per AC-10.

## 8. Out of scope / non-goals

- No auto-triggered re-analysis or any human-action automation (R6 boundary).
- No change to `market_external_reference` / `industry_driver_calibration` /
  `calibration_sweep_result` schemas; no migration at all.
- No change to the consensus priority ladder (recorded reference > web extraction > LLM prior >
  unset) or to `ANCHOR_CITATION_TOLERANCE_PCT` — owned by design
  `2026-11-06-s1-quantitative-web-grounding`; flagged for its owner.
- No rewrite of completed payloads — historical versions keep the consensus and gap they were
  run with; the superseded banner is the only signal about their staleness.
- No MCP surface changes (no calibration tools exist in the registry).

---

# Amendment 2026-11-13a — Monte Carlo sweep injection into the loop's constraints

- Spec ID: `2026-11-13-calibration-loop-convergence` (this amendment)
- Date: 2026-11-13
- Status: implemented (user decision 2026-11-13 — translated from the Korean original:
  "find new factors and calibrate them through a Monte Carlo simulation" — the Monte Carlo sweep
  PARTICIPATES in calibration instead of staying an
  analyst-only planning readout)

## A1. Requirements

- AM1-R1: When a re-analysis runs while the gap is unconverged (≥ the goal line) and accepted
  drivers exist and a CAGR-bearing external reference resolves, the pipeline itself runs the
  deterministic feasibility sweep and injects its results into the next rerun's step-2/step-4
  constraints.
- AM1-R2: The injected block is a PROMPT-LEVEL SOFT CONSTRAINT — the sweep never numerically
  edits matrix cells. The R6 advisory boundary and the no-auto-rerun rule stand unchanged.
- AM1-R3: The sweep view the rerun consumed is persisted via `runCalibrationSweep` with
  `created_by = "market-sizing-pipeline"` (the pipeline's system actor — the same actor string
  it uses for auto-saved references, proposal inserts, and version rows), so CalibrationPanel's
  sweep readout always reflects what the rerun consumed. Raw samples stay unstored (existing §4
  contract); rows always append (append-only audit family — no dedupe).
- AM1-R4: The sweep's goal line is the unified `CONVERGENCE_GOAL_PCT` — no escalate/409 logic
  exists to interact with (§3.2 removed it).

## A2. Design

- **Trigger basis (startup, `runSizingPipeline`)**: `gapForSweep = previousGapPct ??
  relativeCagrGapPct(previousOurCagrPct, externalCagrPct)` where `previousOurCagrPct` is the
  previous completed payload's `matrix.calibration.ourCagrPct ?? matrix.consistency.bottomUpCagr`
  (the prev parse extends to read them), and `externalCagrPct` is the resolved reference's
  `external_cagr_pct`. Inject when `gapForSweep !== null && gapForSweep >= CONVERGENCE_GOAL_PCT`
  AND `acceptedDrivers.length > 0` AND `externalCagrPct > 0`.
- **Execution**: `runCalibrationSweep(db, { industryId, ourCagrPct: previousOurCagrPct,
  externalCagrPct, drivers: acceptedDrivers, createdBy: "market-sizing-pipeline" })` — defaults
  are the sweep's own (seed 20260919 fixed, 20000 samples, CPU cost trivial). Its returned view
  feeds `buildCalibrationConstraints({ ..., sweepView })`.
- **Injected block** (appended to the constraint string when `sweepView` is present; English
  renderings below — the shipped prompt strings are Korean):
  - `Latest Monte Carlo sweep (seed fixed, {sample_count} samples): {feasible_ratio %} of the
    accepted driver combinations can converge within the {goal}% line — gap P50 {p50}% / P90 {p90}%`
  - top 3 contributors by p50: `Top contributing drivers: {driver} contribution P50 ±{p50}%p, ...`
  - guidance: `Reflect this combination's upper-bound contribution first when deriving the
    per-cell CAGRs, and present the evidence for any remaining gap`
- **Persistence semantics**: `runCalibrationSweep` stamps `version_no = MAX(version_no)` at call
  time — during a rerun that is the PREVIOUS version's number (the new version row does not
  exist yet at startup). Accepted: the sweep answers "from the previous baseline, can the
  accepted drivers reach the goal line", so attaching it to that baseline's number is truthful.
  The panel readout therefore lags the newest version by at most one rerun, which is exactly the
  constraint's own basis.

## A3. Acceptance criteria additions

11. Unconverged gap + accepted drivers + CAGR-bearing reference → the step-2/4 prompt contains
    the Monte Carlo sweep block with feasible ratio and top contributors, and a
    `calibration_sweep_result` row persists with `created_by = "market-sizing-pipeline"`.
12. Converged gap (or within-noise absence of accepted drivers) → no sweep block, no sweep row.
13. Determinism: same seed/inputs → identical injected numbers across runs.

## A4. Touched files (additions)

- `app/web-next/lib/market-calibration.ts` — `buildCalibrationConstraints` gains the optional
  `sweepView` input and block.
- `app/web-next/lib/market-sizing-pipeline.ts` — prev-parse extension, sweep trigger, injection,
  persistence.
- `tests/unit/market-calibration.test.ts`, `tests/unit/sizing-matrix-guard.test.ts` — lib and
  pipeline-level tests per A3.

---

# Amendment 2026-11-13b — leave-one-out driver exclusion PROPOSAL

- Spec ID: `2026-11-13-calibration-loop-convergence` (this amendment)
- Date: 2026-11-13
- Status: implemented

## B1. Requirements

- BM1-R1: `EXCLUSION_NOISE_BAND_PCT = 3.0` in `market-calibration.ts` — the same-input
  rerun drift observed in production was 10.6 to 10.3 (about 0.3pp), so only a gap
  worsening STRICTLY GREATER than this band counts as evidence, never noise.
- BM1-R2: At the END of a rerun, when the new CAGR gap worsened vs the previous gap by
  more than the band, the pipeline runs a leave-one-out ranking: for each accepted
  driver, `sweepCombinations` without it (pure function, zero LLM calls), ranked by
  feasible-ratio improvement (`rankExclusionCandidates`, `calibration-sweep.ts`).
- BM1-R3: The output is an exclusion PROPOSAL, never an auto-exclusion (R6). A person
  confirms via the existing `decideCalibrationDriver` dismiss flow; `decided_by`
  records the person. Accept on an exclusion row is forbidden (route 400
  `exclusion_accept_forbidden`; the lib also throws — accepting would re-admit the
  excluded driver into the accepted set).
- BM1-R4: Guard — exclusion proposals only when a CAGR-bearing reference resolves
  (`external_cagr_pct > 0`) and at least one accepted driver exists.
- BM1-R5: Proposal evidence — gap worsening (previous, new), the leave-one-out table
  (every candidate with its without-driver feasible ratio and improvement), the ranked
  recommendation (top candidate only is proposed; no proposal when no removal improves
  feasibility), and a reference-quality warning when the reference's `captured_from`
  is not `user`.

## B2. Storage choice (documented per the dispatch condition)

Smallest coherent representation: the existing `industry_driver_calibration` table with
NO schema change and NO migration (the base design's non-goal stands).

- **Row-kind discriminator**: `proposed_by = "market-sizing-pipeline:exclusion"`
  (exported constant `EXCLUSION_PROPOSAL_BY`). The table's `status` CHECK and the
  `direction` CHECK are reused as-is; `impact_pct` carries the candidate driver's own
  CAGR impact (column semantics unchanged); the measured leave-one-out numbers live in
  the `rationale` evidence text. The calibration GET translates the marker into an
  `is_exclusion` boolean so the UI never learns the marker string.
- **Cadence**: `insertExclusionProposal` deletes the industry's open (`proposed`)
  exclusion rows before inserting — at most one live exclusion proposal, always the
  latest rerun's evidence. A triggered rerun's driver-proposal refresh (the existing
  delete-all-proposed block) also sweeps stale exclusion rows, so the panel's
  next-action area never doubles. When no rerun worsens the gap, the last proposal
  lingers exactly like driver-attribution proposals do today.
- **Effect of a confirmed exclusion**: `acceptedCalibrationDrivers` skips accepted
  drivers whose name matches a `dismissed` exclusion-marker row (`decided_by IS NOT
  NULL`), so the confirmed driver stops feeding the next rerun's constraints and
  sweeps. A dismissed NORMAL attribution proposal never excludes anything — the marker
  is what separates the row kinds. A merely proposed exclusion binds nobody.
- **Version linkage**: the proposal row's `version_id` is the NEW version id and the
  insert lives in the same transaction as the version row, so the calibration GET's
  version JOIN exposes it in the panel.
- **Panel**: `CalibrationPanel` renders exclusion rows via the extracted
  `CalibrationProposals.tsx` (the 400-line cap split) with the evidence block and a
  single confirm affordance (POST `action=dismiss`).

## B3. Acceptance criteria additions

14. Gap worsening beyond 3.0pp + accepted drivers + CAGR-bearing reference → exactly
    one proposed exclusion row, marker `proposed_by`, `version_id` = new version,
    rationale carries worsening numbers, leave-one-out table, recommendation, and the
    reference-quality warning for non-user references; the accepted set is unchanged.
15. Worsening within the band (or no accepted drivers, or no CAGR-bearing reference) →
    no exclusion row.
16. Person dismisses the exclusion proposal → `decided_by` = that person and the
    driver disappears from `acceptedCalibrationDrivers`; a dismissed normal proposal
    with the same name does not.
17. Accept on an exclusion row → 400 at the route, throw at the lib; the row stays
    open.

## B4. Touched files (additions)

- `app/web-next/lib/market-calibration.ts` — `EXCLUSION_NOISE_BAND_PCT`,
  `EXCLUSION_PROPOSAL_BY`, `insertExclusionProposal`, the `acceptedCalibrationDrivers`
  exclusion filter, the dismiss-only guard in `decideCalibrationDriver`.
- `app/web-next/lib/calibration-sweep.ts` — `rankExclusionCandidates` (pure).
- `app/web-next/lib/market-sizing-pipeline.ts` — end-of-rerun leave-one-out evaluation
  and proposal insert inside the version transaction.
- `app/web-next/app/api/market-overview/industry/[industryId]/calibration/route.ts` —
  `is_exclusion` annotation; `[rowId]/route.ts` — accept-on-exclusion 400.
- `app/web-next/components/stages/market/CalibrationProposals.tsx` (new, split from
  `CalibrationPanel.tsx`), `CalibrationPanel.tsx`, `types.ts`, `locales/en.json`,
  `locales/ko.json` (three keys).
- Tests: `tests/unit/market-calibration.test.ts`, `tests/unit/calibration-sweep.test.ts`,
  `tests/unit/sizing-matrix-guard.test.ts` (pipeline-level AC 11-12 rerun runs and the
  exclusion cases).
