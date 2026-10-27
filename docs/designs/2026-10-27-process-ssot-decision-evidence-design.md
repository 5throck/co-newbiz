---
title: "Process SSOT and decision evidence (wave W3) - design"
date: 2026-10-27
status: proposed
revision: 1
author: process-governance-manager
design_of_record:
  - "docs/reports/2026-10-26-project-review-s1-s12.md"
  - "docs/adr/0187-process-ssot-decision-evidence.md"
lang: en
---

# Process SSOT and decision evidence (wave W3) - design

Companion to [ADR-0187](../adr/0187-process-ssot-decision-evidence.md) (Proposed). This is a proposal to the owner; no code, procedure, checklist, policy or flow.spec file changes until ADR-0187 is accepted. Outputs of this system are decision support (boundary 2).

## 1. Scope and binding inputs

In scope: review findings H7, H8, H9, H11, M1-M9, M14, M15, M17. Out of scope: M10-M13, M16 (M16 closed by ADR-0186), SSO, UI copy.

Owner decisions recorded during W2 that bind this wave (not reopened here):

| # | Decision | Where it lands |
|---|---|---|
| W2-a | W3 numeric thresholds are owned by `risk-officer` + `quant-methodologist` | sections 4.1, 4.6; open decisions D1, D2 |
| W2-b | Region-labor review applies to every track except greenfield `origin=internal` | M2/M15 changes; `brownfield-dd`, `greenfield-dd` applies_when |
| W2-c | Reuse `regulatory-screening` (no new skill) as the H9 producer | section 4.3 |
| W2-d | New `ip-fto-review` activity | section 4.2 (activity in S9 / GF DD) |
| W2-e | Drop the S10 site activity | section 4.2 |
| W2-f | `ma-13` applies to M&A + JV | `ma-special-topics-checklist` applicability |

Authority layering (AGENTS.md section 7): flow.spec is the SSOT for stage dispatch and blockers; procedures own step `agent_key`; skills never restate steps. Every divergence below is reconciled in the higher layer and then mirrored down, never the reverse.

## 2. Verified status per finding (read from code, 2026-10-27, after ADR-0186 P0-P5)

The live database is not in the repository (production on port 7749), so DB row counts below are quoted from the review report and were not re-queried; they are marked "report".

| ID | Status | Evidence (current tree) |
|---|---|---|
| H7 | **partial** | `db/lib/data-confidence.ts` lines 1-21 already derive the hop grade from `proxy_link` rows (A none / B one statistical hop r2>=0.6 / C otherwise) and take the worse of hop grade and source cap. Defect remains: with zero `proxy_link` rows (report) and an `llm-estimate` source, the result is always B and the rationale text describes a hop that does not exist. `benchmark_case` 0 rows and no base-rate source (report). `packages/core-scoring/src/rag-engine.ts` caps on that grade, so the cap is driven by a defaulted value. |
| H8 | **open** | `lib/process-flow.ts` 339-341 blocks S3 on `countSourcedCapabilityRows(capability_gap_json)`; flow.spec S3 (336-389) has activities strategic-fit-screening / synergy-analysis / our-company-profile and no capability-register owner or required artifact. S8 adoption blocker (`process-flow.ts` 709-718, `s8_case_adopt`) and S11 PMI-kickoff / GF baseline blockers (733-775) are not in flow.spec `requiredArtifacts`/`completionCriteria` for S8 (568-638) or S11 (791-890). |
| H9 | **open** | `checklists/legal-regulatory-checklist.yaml` is referenced only by the library projection (`library.generated.ts`) and as `legal_basis` text in `legal-dd`; no flow.spec activity produces it and no gate consumer reads it. |
| H11 | **open** | Permit/incentive/clawback records exist only post-IC (`lib/greenfield-execution.ts` ~594, S11 `greenfield-execution-baseline`). No pre-IC capture in S5/S8 for greenfield. |
| M1 | **open** | `process-flow.ts` S10 (617-649) checks sources = uses only. |
| M2 | **open** | Activities whose agent holds no step in the referenced procedure: S9 capability-dd, financial-dd, financing-dd, several GF DD activities; S3 synergy-analysis (report A-05; no validator exists to prove the full list - P1 validator will enumerate). |
| M3 | **open** | `process/stages.yaml` (127 lines, G1-G8 `order`) still carries the pre-v2 gate order and pre-fs wording. |
| M4 | **open** | `policies/group/neb-policy.md` section 4, `procedures/_kill-criteria/*.json` (registry) and flow.spec `killCriteria` (185, 195, 204, ...) are three lists; no parity check. ADR-0186 wired the evaluator into the gate path but did not reconcile the lists. |
| M5 | **open** | flow.spec S11 entry/completion text does not fix establishment vs `group_ic` order; `stages.yaml` G7 text ("entity establishment ... authorized or held") implies after group IC. |
| M6 | **partial** | `synergy-analysis` agent is `risk-officer` (flow.spec S3); `assumption-audit` skill is the red-team activity, but author and red-team are the same agent key. ADR-0185 restored partial independence only. |
| M7 | **open** | `app/web-next/lib/review/domains.ts` 22-28: `DEFAULT_REVIEWER_DOMAIN` maps functional to technical, so every deal artefact authored by a functional agent goes to `platform-lead`. No committed matrix file. |
| M8 | **open** | `target_screening` three-stage exception exists in code, not in neb-policy; outputs not listed in the review registry skip AI-2nd. |
| M9 | **open (confirmed)** | S2 entry market appears in inputs of S3, S4, S8 only; absent from S5, S6, S7, S9, S10, S11, S12 (grep of each stage block). |
| M14 | **mostly closed** | `scripts/co-newbiz/seed-demo-gate-contract.ts` (ADR-0186 P5) seeds the six validator records (181-189), a waiver requested by maker and approved by `demo-entity-reviewer` (195-222), and a KILL path at screening (249); `seed-s1-s12-demo.ts` 13, 627-628 adds HOLD before GO, CP cleared, KILL with learning capture. Remaining: no site/permit/incentive evidence rows (2 incidental mentions only) and checklist rows other than the waived one are still all `pass`. Residual moves to P5. |
| M15 | **open** | GF DD still runs full DD checklists for `origin=internal` expansions; brownfield JV/minority/partnership/R&BD/CVC not exercised by any seed or fixture. |
| M17 | **verified open** (was "could not verify") | S12 (891-) has portfolio-monitoring (`portfolio-venture-monitoring`, applies_when origin in internal/hybrid/joint or greenfield), integration-monitoring (`pmi-integration-execution` step 6, applies_when `none_of` sub_track in jv/minority_investment/partnership/rbd/corporate_venture/...), partnership-monitoring. A brownfield `origin=external` project with `sub_track` in minority_investment / rbd / corporate_venture matches **no** S12 activity. |

## 3. Principles

1. Declare before enforce: every engine blocker gets a flow.spec line first; then a parity validator keeps code and spec equal.
2. No defaulted evidence: an absent input yields "unknown/not derivable", never a mid grade (Deliverable Standards: data confidence caps conclusions).
3. Validators before content: each script-gap finding ships its validator in the same phase as the fix, failing on the old tree.
4. Write-time only; legacy rows get a label (ADR-0161 precedent), no rewrite of recorded decisions.
5. Thresholds are proposals from `risk-officer` + `quant-methodologist` (W2-a) and become binding only through a recorded owner decision.

## 4. Proposed changes

### 4.1 Decision evidence (H7, H11, M1)

- `db/lib/data-confidence.ts` (+ SQL twin migration): when no `proxy_link` row is incident and the source is not direct data, return grade `C` (or `U` per D1) with rationale `no_chain_recorded`; rationale strings generated from the actual hop list. `packages/core-scoring/src/rag-engine.ts`: cap reads the derived grade; `U` caps at Amber.
- New tables (ADR trigger: DB schema): `benchmark_case` population path (import script `scripts/co-newbiz/import-benchmark-cases.ts`) and `base_rate` (reference class key, metric, p10/p50/p90, source, verified_on, maintainer). Consumers: `assumption-audit` (S3), S8 valuation sanity, risk-officer red-team.
- H11 pre-IC capture: greenfield S8 (or S5, D4) records `permit_candidate`, `incentive_candidate` (with clawback terms) as first-class rows reusing the S11 schema shape with `stage_captured`; S11 baseline links to them instead of re-entering. Files: `lib/greenfield-execution.ts`, `procedures/_shared/greenfield-fs/schema.yaml` (new step, agent_key `incentive-agent` / `legal-counsel`), flow.spec S8 requiredArtifacts (greenfield).
- M1: `process-flow.ts` S10 adds (a) total uses reconcile to the S8 adopted investment within tolerance (D2), (b) covenant headroom under downside >= threshold from `financing-plan-review`, (c) funding-evidence pointer per source; flow.spec S10 completionCriteria gains the same three lines.

### 4.2 SSOT alignment (H8, M2, M3, M5, M6, M9, M17)

- flow.spec (minor bump 2.13.0 -> 2.14.0 through ADR-0187):
  - S3: add `capability-register` output + requiredArtifact, owner activity (D5: `strategic-fit-screening` / process-governance-manager vs a separate activity for `greenfield-agent`/`brownfield-agent`); fix personas accordingly.
  - S8: declare the `s8_case_adopt` adoption blocker; S11: declare PMI kickoff (brownfield, non-PMI sub-tracks excluded) and GF execution-baseline blockers.
  - S3 M6: `synergy-analysis` author moves to `financial-analyst` (D6), `risk-officer` keeps the `assumption-audit` red-team activity.
  - S9 / GF DD: add `ip-fto-review` activity (`ip-agent`, W2-d); region-labor review activity applies_when all tracks except GF internal (W2-b).
  - S10: remove the site activity (W2-e).
  - S11: state the order explicitly (D7).
  - S5-S7, S9-S12 inputs: add "S2 entry market" (M9).
  - S12: add coverage for brownfield external minority / R&BD / CVC (D8) - preferred: widen `portfolio-venture-monitoring` applies_when to `project.sub_track in [minority_investment, rbd, corporate_venture]`.
- Procedures: for each M2 pair, either add a step with the activity agent's `agent_key` or change the activity agent - reconciled pair by pair in P1 from the validator's output; version bumps per ADR-0020.
- `process/stages.yaml` + stage-aliases: regenerate to the v2 gate order and wording (M3); thereafter derived from flow.spec by script, not hand-edited.
- `checklists/ma-special-topics-checklist.yaml`: `ma-13` applicability M&A + JV (W2-f).

### 4.3 Checklists and policy (H9, M4, M8)

- H9: producer = new S4/Screening step in `brownfield-screening` and `greenfield-screening` using the existing `regulatory-screening` skill (W2-c), agent_key `legal-counsel`; consumer = `screening` gate mandatory-deliverable list (compliance engine). flow.spec S4 requiredArtifacts lists the checklist.
- M4: one canonical kill list = the registry (`procedures/_kill-criteria/`); neb-policy section 4 cites registry keys; flow.spec `killCriteria` entries carry the registry key. `policy_change` record required.
- M8: neb-policy names the `target_screening` exception; the review registry lists every stage output with its review requirement (default: AI-2nd required).

### 4.4 Review routing (M7)

- New `process/cross-validation-matrix.yaml` (artifact type x author domain -> reviewer agent, with rationale); `review/domains.ts` reads it and falls back to `DEFAULT_REVIEWER_DOMAIN` only for unlisted types and records `fallback_used`. Content is D3.

### 4.5 Seeds and tracks (M14 residual, M15)

- `seed-s1-s12-demo.ts`: add one failing-then-remediated checklist row, site assessment, permit candidate and incentive-with-clawback rows (after P2 schema).
- Fixtures for brownfield JV, minority, partnership, R&BD, CVC through S12 (pairs with M17).
- `greenfield-dd` schema: origin=internal trims to the items in D9.

### 4.6 New validators (script-gap items)

All under `scripts/co-newbiz/` (or `procedures/_validate.ts` rules), wired into `bun scripts/audit.ts`; each must fail on a fixture reproducing the finding.

| Validator | Finding | Rule |
|---|---|---|
| `check-engine-spec-parity.ts` | H8 | every blocker code emitted by `lib/process-flow.ts` maps to a flow.spec requiredArtifact/completionCriterion id (blocker ids become stable keys, not Korean strings) and vice versa |
| `check-checklist-consumers.ts` | H9 | every `checklists/*.yaml` with mandatory items has >=1 producer activity/step and >=1 gate consumer |
| `procedures/_validate.ts` rule `activity-agent-in-procedure` | M2 | for each flow.spec activity, `activity.agent` appears as `agent_key` in >=1 step of each listed procedure (allowlist with ADR reference for lead-only activities) |
| `check-kill-registry-parity.ts` | M4 | neb-policy section 4 keys = registry keys = flow.spec killCriteria keys |
| `check-stage-inputs.ts` | M9 | stages S3-S12 declare the S2 entry-market input |
| `check-review-coverage.ts` | M7/M8 | every stage output is in the review registry; every author-domain/artifact pair resolves in the matrix |
| `check-s12-coverage.ts` | M17 | for each (case_type, origin, sub_track) cell in the ADR-0047 matrix, >=1 S12 activity's procedure applies_when matches |
| `check-stages-derived.ts` | M3 | `stages.yaml` equals the projection from flow.spec |

## 5. Phased plan (each phase one PR)

| Phase | Content | Owners | Exit check |
|---|---|---|---|
| P0 Governance docs | ADR-0187 accepted; flow.spec 2.14.0 declarations (4.2); neb-policy en/ko (M4, M8) + `policy_change`; stages.yaml regeneration; ma-13 applicability; open decisions D3/D5-D9 recorded | process-governance-manager, docs-writer, compliance-officer | `procedures/_validate.ts`, `graph-map.ts --check`, `validate:language` pass |
| P1 Validators | the eight validators in 4.6 with failing fixtures; report-only mode for the first run | backend-engineer; PGM review | each validator fails on its fixture; current tree findings listed |
| P2 Procedure + checklist reconciliation | M2 pairs, H9 producer/consumer, ip-fto-review, region-labor, S10 site removal, S12 applies_when (M17), GF internal DD trim (M15); validators to blocking | process-governance-manager, legal-counsel, ip-agent, region-lead | all P1 validators green in blocking mode |
| P3 Engine parity | stable blocker keys in `process-flow.ts`; S8/S11 blockers mapped; S10 reconciliation/headroom/funding evidence (M1) | backend-engineer, valuation-agent, financing-agent | parity validator green; unit tests for M1 |
| P4 Evidence data | data-confidence derivation + migration (H7), `base_rate`/`benchmark_case` schema + import, pre-IC permit/incentive capture (H11), matrix file + `review/domains.ts` (M7) | data-architect, quant-methodologist, risk-officer, incentive-agent, backend-engineer | migrations reversible; RAG cap test with zero-hop input yields D1 grade |
| P5 Seeds and tracks | M14 residual, M15 sub-track fixtures through S12 | backend-engineer | seed run produces evidence rows; S12 coverage validator green against fixtures |

P3 and P4 are independent after P2; run sequentially per the branch-dependency rule.

## 6. Migration and ADR triggers

- ADR required: DB schema (`base_rate`, `benchmark_case` changes, pre-IC permit/incentive capture, data_confidence twin migration); policy amendment (neb-policy section 4, three-stage exception); procedure changes (`policies/**`, `procedures/**` lifecycle rule - policy impact analysis and `project_policy_pin` check for in-flight projects).
- flow.spec minor bump only through ADR-0187 (ADR-0074).
- In-flight projects: data_confidence recomputation is write-time only; existing RAG records keep their grade and get `confidence_basis=legacy_default` label.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Changing the zero-hop default from B to C/U downgrades many in-flight RAG proposals | Write-time only; label legacy; owner decision D1 |
| Base-rate data quality (no reliable external source) | D2: start with internal post-mortems + sourced public studies, every row with `source`/`verified_on`/`maintainer`; mark gaps UNKNOWN |
| M2 reconciliation churns procedures in-flight | Version bumps; pinned projects keep old versions per ADR-0020 |
| Validators flood audit with errors | P1 report-only, P2 blocking |
| Matrix routes too many reviews to scarce leads | D3 keeps fallback with explicit `fallback_used` label |

## 8. Test plan

- Unit: data-confidence (0 hops/llm source, 1 hop r2 0.7, 2 hops, direct data); RAG cap; S10 reconciliation tolerance boundaries; matrix resolution and fallback.
- Validator fixtures: one failing fixture per validator reproducing each finding; real tree passes after P2.
- Integration: seed run end-to-end S1-S12 for GF internal, GF new site, BF M&A, JV, minority, partnership, R&BD, CVC; S12 activity resolved for each.
- Regression: `bun scripts/audit.ts`, `procedures/_validate.ts`, `graph-map.ts --check`, existing gate-integrity tests (ADR-0186).
- Review: AI-1st formal; AI-2nd by `platform-lead` (validators, schema) and `risk-officer` (thresholds, kill list); human final for ADR, policy and thresholds.

## 9. Open decisions (owner)

See ADR-0187 "Open decisions" - D1 through D9, each with options and a recommendation.

Owner confirmation (2026-10-27): all nine decisions are decided exactly as recommended; the options remain in ADR-0187 for the record.

| ID | Decision |
|---|---|
| D1 | Decided (owner, 2026-10-27): (c) new `U` (unknown) capping RAG at Amber and blocking Green |
| D2 | Decided (owner, 2026-10-27): (b) internal post-mortems + sourced public studies with provenance now, (a) evaluated later |
| D3 | Decided (owner, 2026-10-27): (b) artifact type x author domain -> reviewer agent |
| D4 | Decided (owner, 2026-10-27): (c) new rows reusing S11 schema with `stage_captured`, linked at S11; captured at S8, S5 optional |
| D5 | Decided (owner, 2026-10-27): (b) new activity per track lead (greenfield-agent / brownfield-agent) |
| D6 | Decided (owner, 2026-10-27): (a) financial-analyst |
| D7 | Decided (owner, 2026-10-27): (a) group IC GO before establishment |
| D8 | Decided (owner, 2026-10-27): (a) widen portfolio-venture-monitoring applies_when |
| D9 | Decided (owner, 2026-10-27): (b) trim to capability, financial, legal-regulatory, EHS |

The D2 thresholds (S10 uses within +/-5% of the S8 investment; downside DSCR headroom of at least 1.2x) are confirmed as starting values, owned by `risk-officer` + `quant-methodologist`.

ADR-0187 stays Proposed; acceptance happens at the owner's merge of the PR.

## 10. Acceptance

Accepted when ADR-0187 is accepted by the human owner and D1-D9 are recorded. Until then nothing in section 4 is implemented.
