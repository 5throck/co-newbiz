# Process Map — co-newbiz New Business Review

**Owner**: process-governance-manager
**Design of record**: [`docs/designs/2026-08-19-co-newbiz-design_ko.md`](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) section 6, refined by [Stage 1 meetings](../memory/meeting-2026-08-20-m1-process-skeleton.md) M1/M2/M6.

> **Do not confuse this with the product build Phase 0–6** (design section 4/10). This document maps the *business review process* the team's system implements. The product-build phases are how the team builds and ships that system; this map is what the system, once built, actually runs.

## Stage Gate Sequence

```
Screening → Pre-FS → FS → DD → Entity IC → Group IC
```

## Per-Gate Deliverables, Approvers, and RACI

| Gate | Deliverable | Blocking Condition (Kill Criteria candidate) | Approver | R | A | C | I |
|---|---|---|---|---|---|---|---|
| **Screening** | GF: market size + site shortlist. BF: target longlist (origin-gated — internal origin exempts the longlist step only) + preliminary HHI screen (fact-gated on `target.has_external_market_presence`, never on the origin label — 2026-08-22 design Decision 5e; both `applies_when` predicates evaluated by `db/lib/applies-when.ts`). | GF: zero site candidate clears mandatory infrastructure minimums (wastewater capacity is the headline case — checked before power). | process-governance-manager | greenfield-agent / brownfield-agent | pm | industry-lead, region-lead | risk-officer |
| **Pre-FS** | GF: infra lead-time/cost estimate + incentive-NPV site comparison. BF: deal structure hypothesis. WACC/hurdle IRR confirmed `kind=user`. | WACC/hurdle IRR still `assumed` — FS cannot open with provisional discount rates. Certification transferability unconfirmed where load-bearing to a BF thesis. | process-governance-manager | valuation-agent, quant-methodologist | pm | certification-agent, legal-counsel | risk-officer |
| **FS** | GF: full capex schedule with permit critical path. BF: full valuation, six-way M&A cross-check *started*. | Growth projection outside top-decile base rate without risk-officer sign-off. | process-governance-manager | financial-analyst, market-intelligence-agent | pm | quant-methodologist | risk-officer |
| **DD** | Commercial + technical DD complete. BF: all six M&A validators covered — completed compliance rows, or a live `not_applicable` skip row for a validator the applicability registry does not apply (brownfield-dd steps 6-11, ADR-0048). | Any APPLICABLE one of the six BF validators (antitrust, hr-comp, customer, incentive, contingent-liability, certification) missing at DD exit — **no waiver path**, this is a completeness check; the record is 6 declared / N applicable / M completed. | process-governance-manager | commercial-dd-agent, technical-dd-agent | pm | brownfield-agent | risk-officer |
| **Entity IC** | IC memo, RAG assessment (proposed by agents, confirmed by human reviewer). | `analysis_task.reviewed_by` NULL on any required deliverable. | Entity IC (human) | process-governance-manager | Entity IC | valuation-agent, risk-officer | group-review-agent |
| **Group IC** | `group_agenda` ranking entry. Requires completed Entity IC approval recorded in `approval_chain`. | Entity IC approval not yet recorded — Group-level procedures are unreachable, system-enforced. | Group IC (human) | group-review-agent | Group IC | process-governance-manager | pm |

## Green Field vs. Brown Field Divergence

| | Green Field | Brown Field |
|---|---|---|
| Primary risk axis | Infrastructure, permits, talent, community | Deal structure, contingent liabilities, six-validator completeness recorded as 6 declared / N applicable / M completed (classification-aware, ADR-0048) |
| Screening-stage hard filter | Infrastructure minimums (wastewater before power) | Preliminary antitrust screen (rough HHI) |
| Unique mandatory validators | site-infrastructure-assessment, talent-pipeline-planning, community-partnership-planning | antitrust, hr-comp (executive CoC compensation), customer (CoC retention), incentive clawback, contingent-liability, certification-transferability — the steps 6-11 six (ADR-0048 registry decides which apply per classification) |
| Site/target comparison | Two-stage: hard pre-filter → weighted score (infra 30 / incentive-NPV 25 / logistics 15 / labor 15 / permit-critical-path 15%) | Deal structure hypothesis → valuation with sequenced special-topic linkage |

## Certification & Permit Tracks (Parallel, Not Merged)

Permits (`permit`/`permit_edge`) and certifications (`certification`/`certification_edge`) run as **separate DAGs with separate critical paths** — a permit lets you operate, a certification lets you sell. See [glossary: 선급](../glossary/industry.yaml) and design section 8.8-1.

## RACI Legend
R = Responsible (does the work), A = Accountable (owns the outcome, single name), C = Consulted (two-way input before decision), I = Informed (told after decision).

## Gate Procedures

Every gate in the sequence above now has a formal `procedures/_shared/*/schema.yaml` (closed 2026-08-20, informed by pilots 001-004's findings — see `docs/pilots/`):

| Gate | Green Field | Brown Field |
|---|---|---|
| Screening | `procedures/_shared/greenfield-screening/` | `procedures/_shared/brownfield-screening/` |
| Pre-FS | `procedures/_shared/greenfield-pre-fs/` | `procedures/_shared/brownfield-pre-fs/` |
| FS | `procedures/_shared/greenfield-fs/` | `procedures/_shared/brownfield-fs/` |
| DD | `procedures/_shared/greenfield-dd/` | `procedures/_shared/brownfield-dd/` (six-validator no-waiver completeness check, step 14; validators at steps 6-11 per ADR-0051) |
| Entity IC | `procedures/_shared/entity-ic-review/` (shared — same shape for both) | |
| Group IC | `procedures/_shared/group-investment-review/` (shared — same shape for both) | |

The Entity IC and Group IC decision models both carry a fourth state, `withdrawn_pending_resubmission`, added per `docs/pilots/pilot-003-doosan-bobcat-robotics.md` finding F-2 — a real case's withdraw-and-re-propose pattern that the original three-state (approved/rejected/conditional) model couldn't represent.

**Parallel entry chain — deal-shape selection (ADR-0052 §A)**: `procedures/_shared/deal-shape-chain/` is a SECOND entry route alongside the market-shaped chains above, for capability-gap closures that want a partner before (or instead of) an acquisition: P0 need & funnel → P1 partnership screen → P2 partner DD → P3 deal-shape selection → P4 contracting (shape-keyed pre-signing gate, `checklists/deal-shape-presigning-checklist.yaml`) → P5 post-launch review. The full-M&A outcome routes OUT to the brownfield chain unchanged; the P3 decision *writes* the classification axes (ADR-0047 §A.5), which is why the chain itself carries no `applies_when` — it runs before classification exists.

**Post-close chain — PMI (ADR-0052 §B)**: where a Brown Field acquisition completes, `procedures/_shared/pmi-integration-execution/` owns signing → close → integration → BAU at the NEW `post_close` gate slot after Group IC: pre-close (IMO, integration thesis, clean team, staged synergy targets) → day-1 (continuity, control handover) → first 100 days (cadence, promised-vs-actual synergy, 30/60/90 attrition) → BAU exit — a human Finance certification (`bau-exit-certifier`); an uncertified synergy run-rate halts the handover. Non-control acquisitions run the reduced phase set (pre-close + day-1 + monitoring only), scoped by ADR-0045's stake axis.

**Post-formation lifecycle — JV governance (ADR-0052 §C)**: `procedures/_shared/jv-lifecycle-governance/` (`applies_when: origin = joint`) owns the decade between formation and exit that `entity-establishment-execution` deliberately stops at (its step-5 completion confirm, JV addendum ef-13..17): operate (board-approved governance framework, reserved-matters map, three-type CoI protocol, arm's-length pricing) → monitor (seven-dimension health scorecard; annual strategic asset review carrying the parent-side disciplines — designated executive accountability, portfolio gameboard, lookbacks) → restructure (metric-tied triggers, six-item menu, time-boxed deadlock ladder) → exit (the five-step practice exercising the formation-time ef-16 exit clauses — designed at formation, executed here). Steps 1–2 run on standing cadence, 3 annually, 4–5 on trigger — phases, not one-shot gates. Scorecard storage (a schema addition) is ADR-0052 open question (e), the prerequisite for the Section E portfolio script.

**FS quant dispatches + R&BD gating (ADR-0052 §D)**: both FS procedures now dispatch `quant-methodologist` — `monte-carlo-simulation` at valuation (seeded P50/P95 NPV + value-at-risk, `distributional_valuation`; proxy-chain reliability enters as demand-driver dispersion) and `scenario-planning` at risk assessment (downside/base/upside + the rate-shock covenant test, `scenario_risk_assessment`), closing the agent's zero-dispatch status on both tracks. The R&BD track's per-gate TRL/MRL evidence matrix (cutoffs ILLUSTRATIVE until the thresholds meeting), the GAO-20-48G evidence-quality rules (named tests/environments/artifacts, non-champion reviewer), and staged-funding-as-real-options discipline live in `checklists/rbd-technology-checklist.yaml` v1.3.0 (rbd-08..rbd-15) — enforced at pre-FS/DD via the referencing procedures, at the other gates via the `gate_pass_record` completeness check; gate vocabulary for tech bets adds Hold/Recycle alongside Go/Kill.

**Portfolio monitoring — venture cells (ADR-0052 §E)**: `procedures/_shared/portfolio-venture-monitoring/` (group level, `applies_when: origin in [internal, hybrid, joint]`) gives the venture-character cells (5/6/7/8/9/10) post-IC visibility: a bifurcated financial/strategic scorecard rollup per review cycle, a stage-transition evidence pack (tranche preconditions, contribution-responsibility obligations, time-boxed windows, six-option exit-path evaluation: integrate / standalone / spinout / reduce ownership / divest / kill), and a human tranche + kill/graduate decision (`venture-portfolio-ic` — a kill is a governed decision with learning capture, not a silent starve). The scripted view (stage-progression ledger, capital-vs-milestone comparison) waits on the scorecard-storage schema — ADR-0052 open question (e), the longest-lead chain.

## Related
- `skills/stage-gate-governance/SKILL.md` *(not yet created — Stage 2.4)*
- `docs/stage-gates.md` *(this doc's companion — not yet created — Stage 2.4)*
- `docs/pilots/` — four real-case manual pilots that informed the gate procedures above
- [Meeting M1](../memory/meeting-2026-08-20-m1-process-skeleton.md), [M2](../memory/meeting-2026-08-20-m2-entity-group-boundary.md), [M6](../memory/meeting-2026-08-20-m6-site-selection-criteria.md)
