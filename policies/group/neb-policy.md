---
governance_doc_id: pol-group-neb
layer: policy
title: Group New Business Review Policy
scope: shared
level: group
version: "1.2.0"
enforceability: mandatory
owner_agent: process-governance-manager
approver_role: group-ic
effective_from: "2026-08-20"
review_cycle_months: 12
lang: en
counterpart: neb-policy_ko.md
---

# Group New Business Review Policy

**Status**: Active (v1.2.0, amended 2026-10-27 by [ADR-0187](../../docs/adr/0187-process-ssot-decision-evidence.md); record `DEC-20261027-03`. Previous: v1.1.0 by [ADR-0186](../../docs/adr/0186-gate-integrity.md), record `DEC-20261027-01`)
**Design of record**: [design v1.0 §6](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md), refined by [Stage 1 meetings](../../memory/meeting-2026-08-20-m1-process-skeleton.md).

## 1. Purpose and Scope

This policy governs every new-business review across the group — Green Field (new establishment) and Brown Field (M&A) — from Screening through Group IC. It is the top-level document in the five-layer governance hierarchy (policy → procedure → guideline → checklist → template); entities may add addenda (see `policies/entities/<entity>/addendum.md`) but may not weaken a mandatory clause of this policy.

## 2. Mandatory Requirements

1. **Stage gates are sequential and system-enforced.** A GO at a gate requires a recorded, effective GO at the preceding gate of the track ladder, and the prior gate's deliverables recorded. The ladders are Green Field: Screening → Pre-FS → FS → DD → Entity IC → Group IC; Brown Field: Screening → Pre-FS → Target Screening → FS → DD → Entity IC → Group IC. An Entity IC or Group IC GO counts as effective only after a second person's countersign (§2.9); a stale or un-countersigned decision counts as not-GO for the ladder. HOLD and KILL are never blocked by the ladder. Entity IC approval is a hard precondition for entering Group-level procedures — the system rejects entry, it does not merely warn.
2. **WACC and hurdle IRR must be `kind=user`, never `assumed`, before the FS gate opens.** A provisional discount rate invalidates every downstream NPV. Stage S8 is not complete, and an FS GO is rejected, until the WACC subject and both rates are user-confirmed (Brown Field: the subject is the target unless a bf-13 waiver records the acquirer-based fallback; Green Field: the investing entity). Until confirmed, every output that uses the discount rate is labelled provisional.
3. **Brown Field reviews require all six mandatory cross-check validators** (antitrust, customer-retention, incentive, hr-integration, certification transferability, region-lead labor review) recorded before DD exit. There is no waiver path for this specific requirement — it is a completeness check, not a judgment call subject to exception. Completeness is derived from the validator completeness engine (declared 6 / applicable N / completed M), never from a manually set checklist state; the checklist item (bf-01) shows the derived result read-only, and a DD GO is rejected while an applicable validator is missing.
4. **Certification change-of-control transferability**, where load-bearing to a Brown Field deal thesis, must be confirmed — sourced from the certification body's own regulations, never inferred from the target's characterization — by Pre-FS gate close. Where load-bearing to the deal thesis, this confirmation is a hard block on a Pre-FS GO (checklist item bf-03 is binding and non-waivable, like bf-01 and bf-02); it is not an acknowledgement item.
5. **Kill Criteria are binding.** A project meeting a Kill Criteria condition (design §8.2, process map) is halted; overriding a Kill Criteria requires an explicit Group IC decision, recorded, not a unilateral entity action. The override is a recorded, audited `kill_criteria_override` issued by a person holding the `group-ic-reviewer` role, per entity and criterion, with a reason; it may be issued before the formal Group IC sitting. A criterion whose action is `halt` is binding: a GO is rejected unless a matching override exists, and the issuer is not the person who records the decision it unblocks. Criteria with other actions, and criteria the system could not assess, require a recorded acknowledgement with a reason.
6. **Information protection is non-negotiable** (design §8.10, meeting M7-1). Agents inherit the calling user's permissions and hold no accounts of their own. `management_package` never stores real names. `comp_benchmark` requires a minimum cohort of 5. MNPI projects require insider enrollment before any access.
7. **Every deliverable passes three-stage review** (AI formal → AI cross-domain → human final) before a gate opens. Regulations, gate approvals, investment decisions, the security/privacy model, and ADRs cannot pass on AI review alone. **Named exception — Target Screening:** the brownfield `target_screening` gate decision (S7 short list) is not run through the gate-review pipeline (no AI-2nd stage and no human-final snapshot); its human gate record and the per-candidate screening evidence carry the review, and the gate still requires a recorded human decision (ADR-0153 addendum 2026-10-22 a, named here by ADR-0187). No other exception exists: every stage output is listed in the review registry with its review requirement, the default being AI-2nd required. An output missing from the registry is a coverage defect to be reported and fixed, never an implied exemption.
8. **A project is evaluated under the policy version pinned at its start** (`project_policy_pin`), including at Group IC, unless a material policy change forces an explicit re-evaluation decision recorded as a `policy_change`.
9. **Gate-record integrity.** A GO at any gate is recorded together with a server-computed, immutable snapshot of what was known at decision time: kill-criteria outcomes (triggered, unassessed, inert), RAG grade and data-confidence cap, validator completeness, open non-waivable items, WACC state, active waivers and open conditions. The recorder acknowledges each item that needs judgement, with a reason; the client never supplies these facts. Only items this policy already binds (§2.1 ladder, §2.2 WACC, §2.3 validators, §2.4 bf-03, §2.5 binding kill criteria) are hard blocks; everything else is an acknowledgement. A rationale must show substance (minimum length and word count by script; placeholders and repeated characters are rejected) — the check is form only, whether the reasoning is sound stays with the human reviewers. When an AI recommendation exists and the recorded decision differs, a divergence reason is required. Entity IC and Group IC decisions need maker/checker: the checker is a different person who holds the matching human role (`entity-ic-reviewer` or `group-ic-reviewer`). HOLD and KILL are never blocked, and no recorded decision is edited or invalidated retroactively; legacy records are labelled, not rewritten. Agents and MCP tools may propose but never acknowledge, countersign, approve, clear or override.
10. **Condition precedents are tracked.** A condition attached to a conditional or GO decision is a tracked object with an owner role, a clear-by point (Group IC, establishment or closing) and a status. An open Group IC-scoped condition blocks a Group IC GO; an open establishment or closing condition keeps S11 incomplete. A condition is cleared only by a person who holds an IC reviewer role and did not create it, with a note (and evidence for closing conditions). An open HOLD's missing artifacts and `mark_conditional` kill results are offered as candidate conditions; dropping one requires a reason.
11. **Waiver and `na` rules.** A waiver lasts at most 90 days. It is requested by one person and approved by another: the approver differs from the requester and holds `entity-ic-reviewer` (or `group-ic-reviewer` for group-level items); approval time is recorded with the approver's authenticated identity, never a free-text name. A waiver cannot cover an item that is mandatory and not waiver-eligible, and every waiver names an existing checklist item. Marking a mandatory item `na` requires a reason, and a second person confirms it; an unconfirmed `na` on a mandatory item counts as pending. Binding items can be neither `na` nor waived.

## 3. Group IC Distinctive Review Axes

Per meeting M2, Group IC answers questions Entity IC structurally cannot:

- **Portfolio fit** — overlap or cannibalization against another group company's business.
- **Intra-group transaction compliance** — Fair Trade Act Art. 47 (improper benefit provision to related parties) screening for any deal involving affiliate transactions.
- **Capital allocation ranking** — Group IC is usually a ranking decision across concurrent `group_agenda` proposals competing for the same capital budget, not a simple approve/reject on one deal in isolation.
- **Group credit and holding-company conduct-restriction compliance.**

Group IC decisions may be `approved`, `rejected`, or **`conditional`** (approved at reduced capital, or contingent on a specific remediation) — `conditional` is a first-class outcome, not a note appended to `approved`.

## 4. Kill Criteria (Group-Level Binding List)

The kill-criteria registry (`procedures/_kill-criteria/<procedure>__<criterion>.json`) is the single canonical kill list. The procedure YAML declarations stay authoritative for each criterion's wording and action; the registry records them one entry per procedure. `process/flow.spec.yaml` lists, per gate, the registry keys that bind there (`killCriteriaRegistry`); its `killCriteria` strings are a human summary only. The group-level binding list below is a subset of the registry, cited by key:

| # | Group-level criterion | Registry keys |
|---|---|---|
| 1 | Zero site candidate clears mandatory infrastructure minimums (Green Field). | `greenfield-screening__zero_site_clears_infrastructure_minimums` |
| 2 | Any of the six Brown Field mandatory validators missing at DD exit. | `brownfield-dd__any_of_six_ma_validators_missing_at_dd_exit` |
| 3 | Growth projection outside the top-decile historical/peer base rate, without risk-officer sign-off. | `greenfield-fs__growth_projection_outside_top_decile_without_risk_officer_signoff` |
| 4 | Covenant breach under a downside scenario. | `brownfield-dd__covenant_breach_with_coc_acceleration_under_downside` (Brown Field). Green Field: no registry entry yet — declared in a procedure in ADR-0187 phase P2; until then judged by the reviewers against the S10 financing plan. |
| 5 | Non-transferable mandatory certification where load-bearing to the deal thesis. | `greenfield-pre-fs__certification_transferability_unconfirmed_and_load_bearing`, `brownfield-pre-fs__certification_transferability_unconfirmed_and_load_bearing`, `brownfield-dd__certification_transferability_computed_by_inference_not_confirmation` |
| 6 | Partner-sourcing failure where the business cannot proceed without the partner (see partnership-agent). | `greenfield-screening__partner_dependency_unconfirmed_and_no_alternative`, `brownfield-dd__partner_dependency_unconfirmed_and_no_alternative` |

A criterion is added to or removed from this list only together with its registry entry and procedure declaration, under an ADR and a `policy_change` record (§5). From ADR-0187 phase P1 a parity validator keeps this table, the registry and flow.spec `killCriteriaRegistry` equal.

## 5. Amendment

Amendments to this policy require an ADR (design §6.5/§11 trigger list) and a `policy_change` record with impact analysis before taking effect. `project_policy_pin` governs retroactive application (§2.8 above). History: v1.2.0 (2026-10-27) — §2.7 names the Target Screening review exception and the review-registry default; §4 cites the kill-criteria registry as the canonical list, under ADR-0187; see `docs/decisions/DEC-20261027-03.md`. v1.1.0 (2026-10-27) — §2.1–§2.5 amended and §2.9–§2.11 added under ADR-0186; see `docs/decisions/DEC-20261027-01.md`.

## 6. Related Documents

- `policies/entities/*/addendum.md` — entity-specific additions
- `procedures/_shared/*` — the procedures implementing this policy's requirements
- `procedures/_kill-criteria/` — the canonical kill-criteria registry (§4)
- `docs/governance/governance-operations.md` — compliance monitoring, waivers, interpretation registry
- `docs/planning/transition-plan.md` — how existing review practice migrates to this policy
