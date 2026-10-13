# ADR-0162 — Brownfield S9 workspace items scoped per brownfield sub-track

- Status: Accepted
- Date: 2026-10-12
- Deciders: Accepted by the user (account techcross, chat, 2026-10-12). Drafted by process-governance-manager. AI review alone cannot accept this ADR (checklist applicability is governance).
- Addenda accepted together with this ADR (2026-10-12).
- Design of record: `docs/designs/2026-10-12-brownfield-dd-workspace-scope-by-subtrack-design.md`
- Related: ADR-0048, ADR-0051, ADR-0052, ADR-0148, ADR-0157, ADR-0160 (addendum b: greenfield overlay mechanism reused here)

## Context

All seven brownfield sub-tracks see the same 77 items of the seven ADR-0148 S9 workspace checklists. Existing scoping is checklist-level only (`SUB_TRACK_DD_CHECKLISTS`, `app/web-next/lib/library.ts:80-88`), and the deal-shape-presigning checklist is attached whole (26 items across four deal shapes) to jv, partnership and minority_investment. Many items presuppose control, a closing, an employer change or an acquired balance sheet that a JV, a minority or strategic stake, a CVC investment or a contractual alliance does not have.

## Decision (proposed)

1. A second overlay file `checklists/_overlays/brownfield-workspace-scope.yaml` (`ovl-brownfield-workspace-scope` 1.0.0) uses the **same schema, codes and validator** as the greenfield overlay (ADR-0160 addendum b), keyed by the seven brownfield sub-tracks. Codes A, R, X, N; C is rejected on brownfield.
2. **m_and_a is the baseline and stays byte-identical**: every m_and_a row is A, its extras are unchanged; the validator enforces this.
3. N only for structural impossibility for the deal shape; data-dependent absences stay judgeable and use `na` with a reason.
4. Binding items (fin-09; bf-01..03 in extras) are never N or X; since the risk-officer review 2026-10-12 a binding workspace item must be A in every column (fin-09 moved R -> A for jv, strategic_investment, minority_investment, partnership and corporate_venture; A/R per column: jv 57/18, strategic_investment 56/15, minority_investment 56/15, partnership 22/30, corporate_venture 56/15; judgeable counts unchanged; user decision pending).
5. Extra checklists are scoped by section through the overlay: deal-shape jvd for jv, min for minority_investment, lic+cdv for partnership; pt-06 N outside jv. Which extras a sub-track has is unchanged; a recorded opt-in attaches them even before WAVE_F (implementation addendum).
6. Judgeable counts (workspace + extras): m_and_a 102 (unchanged), jv 93, strategic_investment 71, minority_investment 87, partnership 78, rbd 92 (unchanged), corporate_venture 71 (overlay 1.1.0 after the 2026-10-12 legal-counsel review, DEC-20261012-01; previously 67 / 82 / 77 / 67); null sub-track unchanged.
7. Cut-off `BF_WORKSPACE_SCOPE_DATE` with the ADR-0160 human opt-in (audited, previewed); nothing deleted; a recorded fail on a newly N/X mandatory item stays unmet until re-judged. PRJ-QGB2W5 (strategic_investment, 37 rows) and PRJ-T7T81A are grandfathered by default. PRJ-T7T81A was on partnership when this ADR was written; the human decider re-recorded its route as strategic_investment on 2026-10-12 21:03 and confirmed that decision on 2026-10-13 (earlier route decisions are superseded history); its opt-in applies to strategic_investment.
8. Every overlay row needs a human approval record; unapproved rows load as A (fail closed).

## Policy impact (in-flight projects)

No project changes on deploy. PRJ-QGB2W5 and PRJ-T7T81A keep their current scope until opted in (PRJ-T7T81A was on partnership when this ADR was written; the human decider re-recorded its route as strategic_investment on 2026-10-12 21:03 and confirmed that decision on 2026-10-13, earlier route decisions are superseded history, and its opt-in applies to strategic_investment); the demo m_and_a project is unaffected by construction.

## Consequences

- Brownfield DD asks only questions the deal shape can answer; minority and partnership denominators fall by 33 and 38 items.
- The overlay validator and loader are generalized from one greenfield file to one file per track.
- Recorded, not decided: the ADR-0048 registry declares the six M&A validators applicable to every brownfield sub-track while their checklists attach only for m_and_a (design F7, Q5).

## Review

Human sign-off per overlay row. Cross review: risk-officer (N/X rows), legal-counsel (legal, labour and financing rows, deal-shape mapping), antitrust-agent (M&A-specific items and their non-M&A readings), partnership-agent and brownfield-agent (column fit), auditor (coverage, m_and_a byte-identity, grandfathering).

## Implementation addendum (2026-10-12, backend row; status at time of writing: Proposed; accepted 2026-10-13 by the human decider, chat instruction)

- Overlay projection: `scripts/co-newbiz/sync-library-projection.ts` 1.2.0 embeds the brownfield overlay as `LIBRARY_BROWNFIELD_WORKSPACE_OVERLAY` (same `--check` drift gate); read through `getBrownfieldWorkspaceOverlay()` in `app/web-next/lib/library.ts`.
- Loader and scope: `app/web-next/lib/brownfield-subtrack.ts` (sibling of `greenfield-subtrack.ts`, which is unchanged). Fail-closed: no overlay, a missing item, an unapproved row or an unapproved extra block resolves to A; a binding item (fin-09, and any mandatory non-waivable extra item) is never N/X whatever the file says; an X whose replacement checklist is not attached to the project falls back to A.
- Cut-off `BF_WORKSPACE_SCOPE_DATE` in `app/web-next/lib/wave-f-date.ts` (placeholder 2026-10-12, set at merge). Same grandfathering rule as greenfield; the opt-in pin is excluded from the earliest-pin date. User decision 2026-10-12: a recorded opt-in (non-m_and_a sub-track) also attaches the sub-track extras per `SUB_TRACK_DD_CHECKLISTS`, scoped by the overlay's `extra_checklists` and counted, even for a project that predates `WAVE_F_PREDICATE_DATE`; X pointers (fdd-01/fdd-07 -> pt-03) then resolve. The preview reports them in `extras_attached_by_opt_in` ([{checklist_id, judgeable, excluded}]). Non-opted-in projects and m_and_a are unchanged.
- The scoped path applies only to the six non-baseline sub-tracks in scope. `m_and_a`, a null or unknown sub-track and grandfathered projects keep the previous code path, so their payload and counts are byte-identical (tested against the no-overlay path).
- Read surfaces: `ddCompletionSummary` (S9 predicate, gate brief, IC package, report) and `listDdWorkspace` (`items[].scope` on the seven domains and the attached extra tabs, `brownfield_scope.workspace_scope`). Writes: a new judgement on an N/X item is 409 `dd_item_out_of_scope`; `na` needs a note on in-scope checklists.
- Opt-in: `GET/POST /api/projects/{id}/brownfield-scope/workspace-opt-in` (POST human-only, cookie + CSRF, analyst+, `migration_note`, audited `policy_pin_migrated`; listed in `HUMAN_ONLY_ROUTES` and `mcp-coverage.exclusions.yaml`). No DB schema change.
- Policy impact helper `inFlightBrownfieldCounts()` (read-only, counts only). Note: for projects created before 2026-10-01 (PRJ-QGB2W5, PRJ-T7T81A) only the three original domains are counted (ADR-0148 rule unchanged). Live-copy figures 2026-10-12: PRJ-QGB2W5 (strategic_investment, no extras) 29/38 judged/judgeable -> 27/36; PRJ-T7T81A (partnership, opt-in already recorded) 38 -> 55 (29 workspace + 26 extras).

## Addendum (2026-10-13): merger-control and FDI items for strategic, minority and CVC sub-tracks (status at time of writing: Proposed; accepted 2026-10-13 by the human decider, chat instruction)

User decision 2026-10-13 (DEC-20261013-03) closes risk-officer finding 1 of DEC-20261012-01. On the scoped path only (opt-in or past `BF_WORKSPACE_SCOPE_DATE`), `BF_SCOPED_EXTRA_ADDITIONS` in `app/web-next/lib/library.ts` attaches `chk-ma-special-topics-checklist` to strategic_investment, minority_investment and corporate_venture, and `chk-deal-shape-presigning-checklist` to strategic_investment and corporate_venture; legacy unscoped projects keep `SUB_TRACK_DD_CHECKLISTS` unchanged. Overlay 1.2.0 excludes every other item of those extras and adds an optional `readings` list on extra-checklist cells (code R with a reading; never on binding, excluded or baseline items, enforced by `checklists/_validate.ts`). Classification: ma-02 A for strategic and minority stakes (it is the filing-trigger test), also A for CVC (user decision 2026-10-13, after antitrust review); ma-01 and ma-03 R in all three (required where ma-02 finds a filing obligation or an overlap exists, including common ownership); min-05 A for strategic and minority, R for CVC; min-04 (standstill and information barriers) also applies to strategic_investment with code R (target is a competitor or overlaps). Overlay 1.2.2. Totals: strategic_investment 71 -> 76, minority_investment 87 -> 90, corporate_venture 71 -> 75. The readings' description of non-controlling filing and FDI triggers awaits antitrust-agent, legal-counsel and region-lead confirmation.

## Addendum (2026-10-13, b): cut-off applied retroactively from 2026-07-01

Decision of the human decider (user account techcross, chat, 2026-10-13; DEC-20261013-04): `BF_WORKSPACE_SCOPE_DATE` is set to `2026-07-01` (it was a 2026-10-12 placeholder), so non-baseline brownfield projects whose earliest pin or creation is on or after 2026-07-01 are on the scoped path without an opt-in. Because the new cut-off precedes `WAVE_F_PREDICATE_DATE` (2026-10-08, unchanged), the by-date scoped path is now checked ahead of the WAVE_F grandfathering in `subTrackChecklistIds()` and `brownfieldAttachedExtras()`, so an in-scope-by-date project gets the same scoped extras (including the DEC-20261013-03 merger-control and FDI items) as an opted-in one. `m_and_a`, a null or unknown sub-track and projects before 2026-07-01 keep the previous path. Dev-copy impact: PRJ-QGB2W5 (strategic_investment) moves to the scoped view, 36 workspace plus 5 extra judgeable items (41), 5 unassessed; S9 stays incomplete (it already had 8 pending).

## Addendum (2026-10-13, c): a recorded dd gate decision pins the pre-scope view

Proposed fix approved by the human decider in chat 2026-10-13 (DEC-20261013-05). Same problem and rule as ADR-0160 addendum (f): `brownfieldScopeByDate()` returns false for a project that has a valid (non-stale, ADR-0157) recorded dd gate decision of any verdict, using the shared helper `hasValidDdGateDecision()`. Because `brownfieldRouteInfo().by_date` is derived from it, `brownfieldAttachedExtras()` and `subTrackChecklistIds()` fall through to the earlier WAVE_F rule for such a project, so its S9 view and the later gates' prerequisites stay as at approval time. An opt-in recorded by a person stays valid; a stale marker releases the pin.
