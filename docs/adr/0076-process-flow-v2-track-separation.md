---
lang: ko
lang_reason: source-material
---

# ADR-0076: Process Flow v2.0.0 — post-route-decision track separation (Greenfield capability path, Brownfield target identification/screening stages)

**Status**: Accepted — spec, procedures, generated doc, and interim web surface shipped in the same change
**Date**: 2026-08-31
**Deciders**: user (standing directive), pm (process owner), brownfield-agent + greenfield-agent (domain inputs)
**Design of record**: `process/flow.spec.yaml` v2.0.0, `docs/process-flow.md` (generated), procedures `procedures/_shared/brownfield-target-{identification,screening}/schema.yaml`

## Context

ADR-0074 established the declarative process meta model (flow.spec.yaml as SSOT). Its first
runtime, however, compressed everything after the Route Decision into a single "사업성 분석 ·
대상 선별" stage (S5). This clashed with the business reality the user fixed as a standing
directive:

- **Greenfield is an internal-capability entry** — there is no Target Company object at all.
  The core question is "can we enter with our own capability, and what must we build?"
  (capability assessment → gap → Build/Partner/Hire/Invest → entry strategy).
- **Brownfield ≠ M&A** — it is any combination with an existing company/asset (M&A, JV,
  strategic/minority investment, partnership, R&BD, CVC). Its core process is a reproducible
  **Target Selection**: Target Universe → Target Company Long List → screening/ranking →
  Target Company Short List, with detailed assessment (CDD/TDD/valuation) starting only after
  the Short List is confirmed.
- The Long List → Short List narrowing must be an independent process stage with its own
  artifacts and gate, not a byproduct of financial analysis.

## Decision

1. **S4 (진출방식 결정) remains the single Route Decision point.** After it, the flow
   separates by track while keeping ONE linear stage chain (runtime invariant: the contiguity
   test requires a single `onComplete` successor per stage):

   | Stage | Name | Track | Content |
   |---|---|---|---|
   | S5 | 역량 평가·진출전략 | greenfield | capability assessment → gap → Build/Partner/Hire/Invest |
   | S6 | 대상 후보 발굴 | brownfield | Target Universe definition → Target Company Long List |
   | S7 | 대상 스크리닝 | brownfield | Long List → Short List (knock-out screens, ranking, exclusion reasons) |
   | S8 | 사업성 분석 | both | Business Case (GF entry strategy) / valuation (BF Short List targets) |
   | S9–S11 | 실사 → 투자심사 → 사후관리 | both | unchanged content, renumbered |

   Greenfield runs skip S6–S7 via the existing `applicableTracks` mechanism (a stage whose
   tracks do not match is skipped at runtime), so no branching in `stateTransitions` is needed.

2. **New gate `target_screening`** (agent-decided, attached to S7): Short List exists, every
   Long List candidate has a ranking or written exclusion reason, all Short List candidates
   passed knock-out screens. Kill: zero candidates pass knock-out.

3. **Two new shared procedures**: `brownfield-target-identification` (gate Pre-FS; universe
   definition with explicit selection criteria and minimum coverage → Long List with required
   attributes and sources) and `brownfield-target-screening` (gate Target Screening; knock-out
   screens → fact-gated regulatory pre-screen → peer-benchmarked ranking → Short List proposal).
   The Long List step inside `brownfield-screening` stays where it is (Screening gate) and is
   documented as an EARLY deal-thesis scan made BEFORE the route is chosen — the two must not
   be conflated.

4. **Definition/Execution discipline**: `meta.version` bumped to 2.0.0 per ADR-0074's
   `process_run.spec_version` split; past runs keep the v1 definition they ran under.

5. **S1–S3 corrections included**: opportunity selection (`selected` status) moved from S2 to
   S3 completion criteria (selection is the outcome of synergy/fit evaluation, not of
   discovery); S2 inputs now include S1 market sizing; S3 input wording fixed to "candidate
   opportunities".

## Consequences

- **Positive**: Brownfield target selection is reproducible and auditable (universe criteria,
  coverage, per-candidate evidence, exclusion reasons); Greenfield no longer pretends a Target
  Company exists; CDD/TDD cannot start before a confirmed Short List.
- **Transitional state (recorded)**: the pre-v2 web surface for S4–S7 was removed rather than
  half-migrated (see ADR-0078). The website currently implements S1–S3 only; the S5–S11 web
  workflow is rebuilt against this spec in a follow-up.
- **Data model unchanged**: `project_company` (role: candidate = Long List, target = Short
  List) and `screening_longlist` serve the new stages as-is; no migration required.
- **Neutral**: existing procedures referenced by stage number in prose only — they key on gate
  names, so the renumbering required no procedure moves.
