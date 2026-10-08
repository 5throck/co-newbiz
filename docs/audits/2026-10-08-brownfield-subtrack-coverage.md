# Brownfield Sub-track Coverage Audit (S8–S11) — Wave F-7

- Date: 2026-10-08
- Scope: read-only audit of the seven Brownfield Route types (`route_decision.sub_track`) across S8–S11: required artifacts, checklists, predicates, and establishment applicability. Design of record: `docs/designs/2026-10-08-wave-f-process-closure-design.md` §7.
- Method: `process/flow.spec.yaml`, `procedures/_shared/*`, `checklists/*`, `app/web-next/lib/process-flow.ts`, `dd-checklist-tailor.ts`, `establishment.ts`, `library.ts`, and a repo-wide search for consumers of each checklist/procedure. No procedure or code was changed by this audit (the Wave Wave F-6 PMI-kickoff and reviewer predicates were landed separately and are noted where they interact).
- Gap classes: **spec-missing** (the spec/procedure does not say), **predicate-missing** (spec says, engine does not check), **UI-missing** (checked or required, but no surface to produce it).

## 1. Matrix

Legend: ✔ covered sub-track-specifically · ◐ covered only by the generic (sub-track-blind) path · ✘ not covered.

| Sub-track (`sub_track`) | S8 artifacts (valuation per Short List target) | S9 checklists (what the web enforces) | S10 structure (`deal_structure_hypothesis`) | S11 IC + execution entry | Establishment applicability (`project.origin`) |
|---|---|---|---|---|---|
| M&A (`m_and_a`) | ◐ per-target BC + p50 BEP + human selection (ADR-0143) | ◐ 7 shared DD domains; `ma-special-topics-checklist` + `brownfield-feasibility-checklist` (6 mandatory validators) **not wired** | ◐ generic (vehicle/stake/instrument/4-axis) | ◐ IC×2, charter, reviewer (Wave F-6), PMI kickoff (Wave F-6) | n/a (origin external) — correct |
| JV (`jv`) | ◐ target = JV counterparty; no JV contribution/dilution valuation shape | ◐ 7 shared domains; `partnership-checklist`, `deal-shape-presigning-checklist` (JV rows) **not wired** | ◐ `vehicle='jv'` selectable, no JV-specific required fields | ◐ PMI kickoff (Wave F-6) applies; `jv-lifecycle-governance` has **no predicate or UI** | ✘ requires `origin='joint'`, but origin is optional at promotion and not derived from `sub_track` |
| Strategic investment (`strategic_investment`) | ◐ as M&A | ◐ 7 shared domains only | ◐ generic | ◐ PMI kickoff applies (Wave F-6) | n/a |
| Minority investment (`minority_investment`) | ◐ valuation is per-company; no stake-level (minority discount, rights) shape | ◐ `deal-shape-presigning-checklist` (minority rows) **not wired** | ◐ `stake_type` exists, no minority-rights fields | ◐ Wave F-6 exempts PMI kickoff, but `pmi-integration-execution` says *reduced* phases (1–2 + monitoring) apply to non-control stakes — see B3 | n/a |
| Partnership (`partnership`) | ✘ "Short List target company" valuation does not fit a non-equity alliance | ✘ `partnership-checklist` (pt-01..12) **not wired**; partner DD workstreams (7) absent | ✘ no structure type for non-equity deals | ◐ IC runs; PMI exempted (Wave F-6) | n/a |
| R&BD (`rbd`; legacy `existing_business_rbd`) | ✘ same as partnership; no TRL/roadmap-based quantification | ✘ `rbd-technology-checklist` **not wired** | ✘ | ◐ IC runs; PMI exempted | n/a |
| CVC / corporate venture (`corporate_venture`; legacy `intra_venture`) | ◐ per-company valuation; no fund/vehicle economics | ◐ 7 shared domains only | ◐ `vehicle='internal_venture_spinoff'` exists, no CVC-specific required fields | ◐ IC runs; PMI exempted | ✘ should be `origin∈{internal,joint}` (new entity) but origin is optional and not derived |

## 2. Findings (ranked)

| # | Class | Finding | Evidence | Proposed fix (ticket, not done here) |
|---|---|---|---|---|
| B1 **FIXED (Wave F-8)** | predicate-missing / UI-missing | The special-topic checklists exist as library files but no web code or predicate consumes them: `ma-special-topics-checklist`, `brownfield-feasibility-checklist` (six mandatory M&A validators — `bf-01` makes a missing validator a binding Kill Criterion), `partnership-checklist`, `deal-shape-presigning-checklist`, `rbd-technology-checklist`. S9 completes on the 7 shared domains (`DD_WORKSPACE_CHECKLISTS`) for every sub-track, so an M&A deal can pass S9 without antitrust, customer-retention, incentive, HR, certification-transferability, or labor validators. | repo search: no references outside `*.generated.ts`; `lib/library.ts` `DD_WORKSPACE_CHECKLISTS`; `process-flow.ts` S9 | Make the S9 applicable-checklist set a function of `sub_track` (M&A → ma-special-topics + brownfield-feasibility; JV/partnership/minority → partnership + presigning; R&BD → rbd-technology). Requires an ADR (checklist applicability = policy) via process-governance-manager. |
| B2 | predicate-missing | S8 is sub-track-blind: it demands a per-Short-List-target Business Case with BEP. Partnership, R&BD and CVC do not have a "target company to value" in the same sense, and minority/JV need stake-level shapes. Those routes either cannot complete S8 honestly or complete it with a mis-shaped model. | `process-flow.ts` S8 brownfield branch | Spec decision first (spec-missing): define the S8 subject per sub-track in `flow.spec.yaml` (`subjectScope` already exists for GF/BF; extend per sub-track). |
| B3 | spec-missing | PMI applicability is inconsistent. `pmi-integration-execution` applies to `case_type = brownfield` (all seven) with a *reduced* phase set for non-control stakes; the `flow.spec` S11 comment limits `pmi-kickoff` to M&A/JV/strategic investment. The Wave F-6 predicate follows the flow.spec comment (M&A/JV/strategic require a kickoff; minority/partnership/R&BD/CVC do not). | `procedures/_shared/pmi-integration-execution/schema.yaml`; `flow.spec.yaml` S11 `pmi-kickoff` comment | process-governance-manager to rule: either minority gets a reduced kickoff (phases 1–2) or the procedure's `applies_when` is narrowed. Adjust `NON_PMI_SUB_TRACKS` in `lib/pmi-kickoff.ts` accordingly. |
| B4 **FIXED (Wave F-8)** | predicate-missing | Establishment applicability keys on `project.origin ∈ {internal, joint}`, but origin is an optional promotion field and is **not derived from `sub_track`** (ADR-0047 §A.5 says the deal-shape decision writes the classification axes). A JV or CVC promoted without an explicit origin skips the 5-step establishment record entirely. The IC screen even treats `origin == null` as "applies" while the predicate treats it as "does not". | `process-flow.ts` S11 (`origin === internal|joint`); `IcReviewStage.tsx` `estApplies`; `opportunities/[id]/promote/route.ts` | Derive a default origin at promotion from `sub_track` (jv→joint, corporate_venture→internal, m_and_a/strategic→external, minority→hybrid), keep it human-overridable, and align the UI/predicate on null handling. ADR (classification). |
| B5 | predicate-missing / UI-missing | `jv-lifecycle-governance` (origin=joint) has no predicate, no artifact table and no UI; JV deals get no post-formation governance baseline check at S11/S12. | no references in `app/` or `db/` (only the library projection) | Add a JV governance baseline artifact to S11 completion for `origin='joint'` (spec change first). |
| B6 | spec-missing | The route enum carries nine values (`existing_business_rbd`, `intra_venture` besides the seven documented). Legacy aliases are not mapped in the spec, the UI labels, or the PMI exemption list (Wave F-6 treats them as non-PMI). | migration 0049/0088 CHECK; `lib/pmi-kickoff.ts` | Normalize via a one-time mapping (`existing_business_rbd→rbd`, `intra_venture→corporate_venture`) or document them as retired. |
| B7 | UI-missing | S10 offers `vehicle='jv'` and `stake_type` but no sub-track-specific required fields (JV: contribution, governance, deadlock/exit; minority: protective rights, tag/drag; CVC: fund economics). The 4-axis review can be completed with none of these. | `deal_structure_hypothesis` columns | Sub-track-conditional required notes in the S10 form; predicate extension after the spec decides the field set. |
| B8 | spec-missing | Non-equity routes (partnership, R&BD) have no S9 "target" semantics: `brownfield_target` assumes a company with a DART code or master record. Partner/institute counterparties cannot satisfy the Wave F-6 S6 candidate-attribute rule (identity = DART code or `md_company`). | `longListCandidateGaps` | Allow a non-DART counterparty identity (name + registry id) for those sub-tracks, with the spec stating the required attributes. |

Wave F-8 status: B1 (S9 sub-track checklists, grandfathered) and B4 (origin derived at promotion) are fixed; see `docs/designs/2026-10-08-wave-f8-subtrack-gaps-design.md`.

## 3. What is covered correctly (no action)

- Route selection, 5-criteria scoring and alternatives (S4) are enforced for all seven sub-tracks; `sub_track` is required for Brownfield.
- Entity/Group IC gates, charter baseline and (since Wave F-6) the human reviewer record apply uniformly.
- The six M&A validators exist as skills/checklists and are owned (brownfield-agent et al.); only the wiring is missing (B1).

## 4. Suggested ordering of tickets

1. B1 (checklist wiring) — highest risk: a binding Kill Criterion is currently unenforced for M&A.
2. B4 (origin derivation) — silent skip of the establishment record.
3. B3 (PMI applicability ruling) — small, unblocks a clean Wave F-6 follow-up.
4. B2 / B7 / B8 (sub-track-specific S8/S10/S6 shapes) — spec decisions first.
5. B5, B6 — governance baseline and legacy enum cleanup.

Owners per the design: brownfield-agent (functional content), platform-lead (system mapping), partnership-agent (JV, partnership), financing-agent (minority, CVC).
