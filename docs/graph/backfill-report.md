# procedure_keys Backfill Report — Applied Dispositions

**Status**: APPROVED & APPLIED (2026-08-25) — owner approved all 16 §4.1 proposals verbatim; `procedure_keys` written back to the 16 SKILL.md files and the graph regenerated (+28 `member_of` edges). No SKILL.md beyond those 16 was touched.
**Date**: 2026-08-25
**Design**: [2026-08-24-multi-element-skill-graph-pilot-design.md](2026-08-24-multi-element-skill-graph-pilot-design.md) §6
**Method**: two-view inference (what-the-skill-does × which-phase-needs-it) calibrated against each procedure's dispatched agent/skill sets extracted from `procedures/_shared/*/schema.yaml`, plus owner-agent ↔ procedure co-occurrence. Exact-name matching only; no fuzzy commits.

---

## 0. Segmentation (verified)

```
122 total skills
 ├─ 44  already declare metadata.procedure_keys   → integrity check only (§2)
 ├─ 22  common/platform copies                    → rule-based exclusion (§3)
 └─ 56  domain candidates                         → inferred below (§4)
      ├─ 16 receive membership PROPOSALS          (tier P2, contextual)
      └─ 40 receive N/A dispositions              (platform 27 / gov-ops 8 / cross-cutting 5)
```

## 1. Semantics used for `member_of`

`member_of` means **"this skill contextually belongs to this procedure"** (feeds context bundles and the graph), NOT necessarily "a schema.yaml step dispatches it". Verified fact: **none of the 56 appears as a dispatched `skill_key` in any shared schema today**, so every proposal below is tier-P2 (contextual association). Wiring a skill into actual dispatch would be a procedure-schema change — explicitly out of scope for backfill and flagged separately where relevant.

## 2. Integrity check — 44 declared skills: PASS

- Stale references (declared key without `procedures/_shared/<key>/schema.yaml`): **0**
- Reverse gap (procedure declared by zero skills): **0** — all 15 procedures are covered
- Separate finding (graph warnings, not a backfill item): 3 schema steps dispatch agents that do not exist in `agents/` (`entity-ic-reviewer`, `bau-exit-certifier`, `venture-portfolio-ic`); 8 platform-copy skills carry workspace-root owners outside this repo's roster.

## 3. Rule-based exclusion — 22 common/platform skills

`accessibility-audit, agent-lifecycle-manager, explain-me, gateguard, k-dart, k-law, mece-logic-auditor, meeting-facilitation, presenter-mode, sarif-exporter, script-lifecycle-manager, security-scan, skill-lifecycle-manager, sound-synth, standup-synthesizer, stride-threat-matrix, swe-solve, sync, team-builder, translate, update-bun-packages, validate-docs-links, zod-contract-gate`

These are template-shipped copies present across projects; they can never belong to a co-newbiz deal procedure. Disposition: `member_of: none(platform)` — recorded here so the absence is deliberate, not an oversight.

## 4. Domain candidates (56) — dispositions

### 4.1 Proposals (16) — reviewer verdict required per row

| Skill | Proposed member_of | Conf. | Rationale (two-view) |
|---|---|---|---|
| compensation-harmonization-analysis | `pmi-integration-execution` | Med-High | Does: post-integration comp harmonization modeling. Needs-it: PMI integration planning is the consuming phase; owner hr-integration-agent sits in brownfield-dd for incentives but harmonization is post-close. |
| customer-qualification | `brownfield-dd` | Medium | Does: customer-mandated vendor-registration/PPAP assessment. Needs-it: commercial-DD plane; commercial-dd-agent dispatches there. |
| deal-execution-playbook | `brownfield-screening, brownfield-pre-fs, brownfield-dd, brownfield-fs, entity-ic-review, group-investment-review` (+greenfield twins if reviewer prefers symmetric coverage) | Medium | Does: gate-by-gate execution map over the six gates. Reviewer call: six brownfield-chain keys, ten incl. greenfield twins, or N/A(cross-cutting index). |
| executive-presentation | `entity-ic-review, group-investment-review` | High | Does: builds Entity IC / Group IC decision decks — gates named explicitly in the skill itself. |
| expert-interview | `brownfield-dd` | High | Does: guideline-bound expert interviews with triangulation. Needs-it: commercial-DD evidence collection; owner dispatches in brownfield-dd. |
| financial-statement-analysis | `brownfield-fs, greenfield-fs` | Medium | Does: DART→KPI extraction feeding QoE and growth models. Needs-it: FS-phase financial-analyst work in both tracks. |
| group-level-review | `group-investment-review` | High | Does: owns the Group IC gate end-to-end against that exact schema. |
| historical-financial-analysis | `greenfield-fs, brownfield-fs` | Med-High | Does: time-series base-rate distribution — description states it anchors `growth-projection-modeling` (greenfield-fs) and mirrors into brownfield FS. |
| insight-synthesis | `entity-ic-review` | Medium | Does: integrates domain outputs into one stage-gate view with mandatory cross-check. Natural home: pre-IC synthesis. Currently un-dispatched — wiring it into the schema would be a separate procedure change. |
| peer-benchmarking | `greenfield-fs, brownfield-fs` | Med-High | Does: cross-sectional KPI benchmarking — description states it pairs with historical-financial-analysis feeding growth projections. |
| proxy-industry-chain | `brownfield-fs, greenfield-fs` | Low-Med | Does: demand estimation for industries without direct data; feeds feasibility inputs at FS. Un-dispatched today; alternative home is Screening-era market sizing — reviewer may prefer those keys. |
| statute-change-monitoring | `brownfield-dd` | Medium | Does: project-scoped statute confirmation — description calls it "the project-scoped DD check". Greenfield-dd currently lacks a legal step (noted gap). |
| unit-conversion-calibration | `brownfield-fs, greenfield-fs` | Low-Med | Does: OLS calibration of a proxy-chain hop — direct companion of proxy-industry-chain; inherits its open question. |
| waiver-management | `brownfield-dd` | Medium | Does: files/approves waivers; six-validator Brown Field completeness cross-check is the primary waiver surface; compliance-officer dispatches in brownfield-dd. |
| certification-roadmap | `brownfield-pre-fs, greenfield-pre-fs` | Low-Med | Does: required-certification gap + dependency DAG (sell-side certs, distinct from permits). Pre-FS is where certification-agent dispatches permit-pathway-mapping; roadmap is the certification-side sibling. Un-dispatched today. |
| company-intelligence | `brownfield-dd` | Low-Med | Does: deep single-company/group intelligence sweep. Needs-it: DD target briefs; owner (market-intelligence-agent) dispatches in brownfield-dd/fs and screenings. Un-dispatched today. |

### 4.2 N/A — platform (27)

`access-control-review, admin-console-operations, assumption-audit, auth-and-account-management, batch-scheduling-operations, continuous-monitoring-and-alerting, data-freshness-and-revision-control, data-normalization, database-operations, db-migration-governance, deal-workspace-operations, deployment-and-release, hwp-document-processing, incident-response, infrastructure-automation, market-data-pipeline, master-data-governance, mcp-server-integration, notification-channel-management, observability-and-alerting, procedure-reference-override, query-performance-tuning, rest-api-design, run-versioning-and-attribution, security-baseline-review, ui-information-architecture, vulnerability-management`

Rationale class: axis-B system build/run — the platform the review system runs ON, not part of any review procedure.

### 4.3 N/A — governance authoring/ops (8)

`adr-governance, checklist-authoring, glossary-management, governance-document-hierarchy, interpretation-registry, policy-change-impact-analysis, regulation-monitoring, regulatory-change-response`

Rationale class: axis-A standing governance work (authoring rules, watching statutes, recording interpretations) — continuous operations, not gate-sequence participants.

### 4.4 N/A — cross-cutting, everywhere-at-once (5)

`agent-output-provenance, industry-profile-application, region-profile-application, legal-risk-register, sample-driven-report-writing`

Rationale class: apply at every gate simultaneously. Declaring them in 10+ procedures would make `member_of` noise; their cross-cutting nature is better expressed by remaining undeclared (the graph's orphan report keeps them visible). Reviewer may override individual rows if bundle behavior should include them.

## 5. Write-back plan (after review)

1. Apply approved keys to the 16 (or edited subset of) SKILL.md files' `metadata.procedure_keys`.
2. Add `member_of: none(platform)` marker comment ONLY IF reviewer wants machine-visible exclusion markers — otherwise absence stays implicit (recommended; graph treats absence correctly already).
3. Regenerate `docs/graph/graph.{json,md}` (`bun scripts/co-newbiz/newbiz.ts graph`) — drift gate enforces the commit pairing.
4. Land as ONE PR together with this report's final verdict column.
