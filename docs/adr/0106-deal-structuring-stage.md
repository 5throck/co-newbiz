---
lang: ko
lang_reason: source-material
---

# ADR-0106: Deal structuring as a first-class stage (S10) — investment vehicle, four-axis review, financing plan

- Status: Accepted
- Date: 2026-09-05
- Deciders: New Business Review Lead (PM), per user direction
- Related: ADR-0045 (investment vehicle four mandatory axes), ADR-0052 (deal structure hypothesis at pre-FS), ADR-0061 (value_impact unit), ADR-0098~0101 (S8~S12 automation ADRs), migration 0013 (deal_structure_hypothesis), migration 0075 (financing_sources_uses)

## Context

The 2026-09-05 investment-structure audit found the structure review fully
modeled but invisible end to end:

- `skills/investment-vehicle-structuring` defined the four mandatory axes
  (tax structure / liability isolation / financing leverage / exit structure)
  and the vehicle choice (direct / SPC / holdco / internal-venture spinoff /
  JV); `skills/financing-plan-review` defined the financing evidence pack.
- `deal_structure_hypothesis` (migration 0013) and its governance repository
  existed — rationale mandatory, four-axis completion a single deliberate
  setter requiring an artifact reference — but had **zero** API/UI consumers
  and **zero rows ever written**.
- No data model existed at all for the financing plan (sources & uses).
- flow.spec mentioned "투자 구조 확정" only in S10's outputs prose; the
  completion criteria required neither a four-axis review nor a financing
  plan, so a project could pass Entity/Group IC with no structure review
  recorded.

## Decision

1. **Deal structuring becomes its own stage.** flow.spec v2.2.0 inserts
   **S10 투자구조 설계** between S9 실사·검증 and the IC stage; the former S10
   (투자심사·실행) becomes **S11** and the former S11 (사후 관리) becomes
   **S12**. Gate ids (entity_ic, group_ic) are unchanged — stages are work
   intervals, gates are decision points. Rationale: (a) the DD → Structuring
   → Final IC ordering matches real deal practice; (b) structuring is
   *design work feeding the IC*, a different completion nature from the
   deliberation itself, and this platform's convention is one mechanical
   completion predicate per stage; (c) burying it as a section inside the IC
   tab is exactly how it stayed invisible for the platform's whole life.
2. **The S10 completion predicate is real**: the *latest*
   `deal_structure_hypothesis` must have `four_axis_review_completed = 1`
   (latest-wins — a fresh incomplete hypothesis re-blocks the stage) AND the
   financing plan must balance (`sources == uses > 0`, migration 0075's
   `financing_sources_uses`).
3. **New S10 surface**: `GET/POST /api/projects/{id}/deal-structure`
   (actions: `hypothesize` | `complete_four_axis` | `add_financing_entry` |
   `remove_financing_entry`) over the existing governance repository plus a
   new `financing-plan.repository`; the `/projects/[id]/deal-structure`
   screen (ProjectSubNav "투자구조" tab) records the vehicle hypothesis, the
   four axis notes, the artifact-referenced completion, and the live
   sources & uses table.
4. **The IC package embeds the structure**: S11's ic-package response carries
   a `deal_structure` section (latest hypothesis, four-axis state, balance)
   so the committees read the structure they approve.
5. **New procedure** `procedures/_shared/deal-structuring/` binds the two
   activities (deal-structure-hypothesis: brownfield-agent;
   financing-plan: valuation-agent) and their skills; the skills'
   `procedure_keys` metadata now reference it.
6. **Pre-FS relationship preserved**: brownfield-pre-fs step 2 still drafts
   the *early* structure hypothesis; S10 is where it is matured post-DD into
   the reviewable structure.

## Consequences

- Former S10/S11 stage ids are renumbered across the spec, the web lib/UI,
  openapi, and the handbook; historical ADR titles keep their original
  numbering (this ADR is the mapping of record).
- A project cannot reach Entity IC without a recorded, four-axis-complete
  structure and a balanced financing plan — closing the governance gap where
  SPC/tax/financing choices were made outside the system of record.
- The `.claude`/`.agents`/`.gemini`/`skills` handbook-skill template gap
  found during the same session was fixed separately (canonical sync from
  templates/common).

## Rejected alternatives

- **Strengthen S10 (old) in place** — cheaper (no renumbering), but the
  review would have stayed a section inside a deliberation tab; rejected
  because the stage's work product and completion nature differ from the IC
  deliberation itself.
- **Gate the four-axis review** (a new human gate) — rejected for now: the
  IC gates already decide the deal; S10's completion predicate gives the
  same enforcement without a seventh gate to staff and schedule.
