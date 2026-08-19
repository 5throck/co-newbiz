---
governance_doc_id: pol-group-neb
layer: policy
title: Group New Business Review Policy
scope: shared
level: group
version: "1.0.0"
enforceability: mandatory
owner_agent: process-governance-manager
approver_role: group-ic
effective_from: "2026-08-20"
review_cycle_months: 12
---

# Group New Business Review Policy

**Status**: Active
**Design of record**: [design v1.0 §6](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md), refined by [Stage 1 meetings](../../memory/meeting-2026-08-20-m1-process-skeleton.md).

## 1. Purpose and Scope

This policy governs every new-business review across the group — Green Field (new establishment) and Brown Field (M&A) — from Screening through Group IC. It is the top-level document in the five-layer governance hierarchy (policy → procedure → guideline → checklist → template); entities may add addenda (see `policies/entities/<entity>/addendum.md`) but may not weaken a mandatory clause of this policy.

## 2. Mandatory Requirements

1. **Stage gates are sequential and system-enforced.** A project may not enter a later gate without the prior gate's deliverables recorded. Entity IC approval is a hard precondition for entering Group-level procedures — the system rejects entry, it does not merely warn.
2. **WACC and hurdle IRR must be `kind=user`, never `assumed`, before the FS gate opens.** A provisional discount rate invalidates every downstream NPV.
3. **Brown Field reviews require all six mandatory cross-check validators** (antitrust, customer-retention, incentive, hr-integration, certification transferability, region-lead labor review) recorded before DD exit. There is no waiver path for this specific requirement — it is a completeness check, not a judgment call subject to exception.
4. **Certification change-of-control transferability**, where load-bearing to a Brown Field deal thesis, must be confirmed — sourced from the certification body's own regulations, never inferred from the target's characterization — by Pre-FS gate close.
5. **Kill Criteria are binding.** A project meeting a Kill Criteria condition (design §8.2, process map) is halted; overriding a Kill Criteria requires an explicit Group IC decision, recorded, not a unilateral entity action.
6. **Information protection is non-negotiable** (design §8.10, meeting M7-1). Agents inherit the calling user's permissions and hold no accounts of their own. `management_package` never stores real names. `comp_benchmark` requires a minimum cohort of 5. MNPI projects require insider enrollment before any access.
7. **Every deliverable passes three-stage review** (AI formal → AI cross-domain → human final) before a gate opens. Regulations, gate approvals, investment decisions, the security/privacy model, and ADRs cannot pass on AI review alone.
8. **A project is evaluated under the policy version pinned at its start** (`project_policy_pin`), including at Group IC, unless a material policy change forces an explicit re-evaluation decision recorded as a `policy_change`.

## 3. Group IC Distinctive Review Axes

Per meeting M2, Group IC answers questions Entity IC structurally cannot:

- **Portfolio fit** — overlap or cannibalization against another group company's business.
- **Intra-group transaction compliance** — Fair Trade Act Art. 47 (improper benefit provision to related parties) screening for any deal involving affiliate transactions.
- **Capital allocation ranking** — Group IC is usually a ranking decision across concurrent `group_agenda` proposals competing for the same capital budget, not a simple approve/reject on one deal in isolation.
- **Group credit and holding-company conduct-restriction compliance.**

Group IC decisions may be `approved`, `rejected`, or **`conditional`** (approved at reduced capital, or contingent on a specific remediation) — `conditional` is a first-class outcome, not a note appended to `approved`.

## 4. Kill Criteria (Group-Level Binding List)

1. Zero site candidate clears mandatory infrastructure minimums (Green Field).
2. Any of the six Brown Field mandatory validators missing at DD exit.
3. Growth projection outside the top-decile historical/peer base rate, without risk-officer sign-off.
4. Covenant breach under a downside scenario.
5. Non-transferable mandatory certification where load-bearing to the deal thesis.
6. Partner-sourcing failure where the business cannot proceed without the partner (see partnership-agent).

## 5. Amendment

Amendments to this policy require an ADR (design §6.5/§11 trigger list) and a `policy_change` record with impact analysis before taking effect. `project_policy_pin` governs retroactive application (§2.8 above).

## 6. Related Documents

- `policies/entities/*/addendum.md` — entity-specific additions
- `procedures/_shared/*` — the procedures implementing this policy's requirements
- `docs/governance-operations.md` — compliance monitoring, waivers, interpretation registry
- `docs/transition-plan.md` — how existing review practice migrates to this policy
