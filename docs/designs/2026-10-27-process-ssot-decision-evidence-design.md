---
title: "Process SSOT and decision evidence (wave W3) - design"
date: 2026-10-27
status: approved
revision: 2 (ADR-0187 accepted 2026-10-27 at the PR #752 merge)
author: process-governance-manager
design_of_record:
  - "docs/reports/2026-10-26-project-review-s1-s12.md"
  - "docs/adr/0187-process-ssot-decision-evidence.md"
lang: en
---

# Process SSOT and decision evidence (wave W3) - design

Companion to [ADR-0187](../adr/0187-process-ssot-decision-evidence.md) (Accepted 2026-10-27, owner merge of PR #752). Implementation proceeds phase by phase per section 5. Outputs of this system are decision support (boundary 2).

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
- `greenfield-dd` schema: the greenfield internal-expansion sub-tracks (existing_business_rbd, intra_venture; owner decision 2026-10-28 - NOT origin=internal) trim to the items in D9; a new-site plant keeps the full DD.

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
| D9 | Decided (owner, 2026-10-27): (b) trim to capability, financial, legal-regulatory, EHS. Scope clarified (owner, 2026-10-28): applies only to the greenfield internal-expansion sub-tracks (existing_business_rbd, intra_venture), not to every origin=internal project (ADR-0166 defaults every greenfield project to internal, so a new-site plant keeps the full DD) |

The D2 thresholds (S10 uses within +/-5% of the S8 investment; downside DSCR headroom of at least 1.2x) are confirmed as starting values, owned by `risk-officer` + `quant-methodologist`.

ADR-0187 was accepted at the owner's merge of PR #752 (2026-10-27).

## 10. Acceptance

Accepted: ADR-0187 was accepted by the human owner on 2026-10-27 (PR #752 merge) with D1-D9 recorded. Section 4 is implemented by the phases of section 5.

## 11. P1 baseline findings

Run on 2026-10-28 against the tree after P0 (#753) with `bun run process:ssot-check` (report-only; `scripts/co-newbiz/process-ssot-check.ts` 1.0.0). Counts per validator:

| Validator | Finding | Count |
|---|---|---|
| check-engine-spec-parity | H8 | 51 |
| check-checklist-consumers | H9 | 13 |
| activity-agent-in-procedure | M2 | 32 |
| check-kill-registry-parity | M4 | 1 |
| check-stage-inputs | M9 | 0 (closed by P0) |
| check-review-coverage | M7/M8 | 55 |
| check-s12-coverage | M17 | 4 |
| check-stages-derived | M3 | 0 (closed by P0) |

Notes: engine labels are still Korean strings, so H8 parity is exact-string until P3 stable keys; the checklist consumer heuristic excludes projection and translation modules; the review matrix is absent until P4, so every author domain resolves by fallback; S12 cells are case_type x origin x sub_track and include combinations that may be unreachable in practice (needs judgement). Verbatim findings:

```text
[WARN] check-engine-spec-parity: S1: engine blocker "데이터 신뢰도 등급" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S2: engine blocker "기회 매력도 평가" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S2: flow.spec requiredArtifact "기회 등록(가치사슬 노드·매력도)" has no engine blocker with the same key (declared, not enforced)
[WARN] check-engine-spec-parity: S3: engine blocker "필요 역량 목록(출처 포함)" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S3: engine blocker "기회 선택(selected)" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S4: engine blocker "route_decision(트랙)" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S4: engine blocker "brownfield sub_track" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S4: engine blocker "5-criteria 채점" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S4: flow.spec requiredArtifact "트랙 결정(GF/BF)·근거" has no engine blocker with the same key (declared, not enforced)
[WARN] check-engine-spec-parity: S4: flow.spec requiredArtifact "Brownfield 선택 시 Route 유형(M&A/JV/전략적 투자/소수점 지분/파트너십/R&BD/CVC)" has no engine blocker with the same key (declared, not enforced)
[WARN] check-engine-spec-parity: S4: flow.spec requiredArtifact "5criteria 채점 결과(통제 필요도·역량 결정성·시장 불확실성·통합 역량·역량확보 속도 각 20%)" has no engine blocker with the same key (declared, not enforced)
[WARN] check-engine-spec-parity: S5: engine blocker "역량 격차·해소 방식" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S5: engine blocker "진출전략" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S5: engine blocker "검토한 대안" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S5: flow.spec requiredArtifact "진출전략(Build/Partner/Hire/Invest 결정·근거)" has no engine blocker with the same key (declared, not enforced)
[WARN] check-engine-spec-parity: S6: engine blocker "Long List 후보 필수 속성·출처" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S6: engine blocker "Long List 최소 커버리지" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S6: flow.spec requiredArtifact "Target Company Long List" has no engine blocker with the same key (declared, not enforced)
[WARN] check-engine-spec-parity: S7: engine blocker "대상 후보 스크리닝" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S7: engine blocker "후보별 스크리닝 판정" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S7: engine blocker "후보별 스크리닝 근거" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S7: engine blocker "knock-out 통과 Short List" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S7: flow.spec requiredArtifact "Target Company Short List" has no engine blocker with the same key (declared, not enforced)
[WARN] check-engine-spec-parity: S7: flow.spec requiredArtifact "Target Ranking/Score" has no engine blocker with the same key (declared, not enforced)
[WARN] check-engine-spec-parity: S7: flow.spec requiredArtifact "Exclusion Reasons" has no engine blocker with the same key (declared, not enforced)
[WARN] check-engine-spec-parity: S8: engine blocker "Business Case(비용·수익 라인 또는 밸류에이션)" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S8: flow.spec requiredArtifact "Target 비교 분석 (brownfield)" has no engine blocker with the same key (declared, not enforced)
[WARN] check-engine-spec-parity: S9: engine blocker "필수 항목 해소" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S11: engine blocker "법인 투자심의위원회 승인" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S11: engine blocker "그룹 투자심의위원회 승인" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S11: engine blocker "투자심의 자료(채택 Business Case)" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S11: engine blocker "추진계획(차터) 기준선" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S11: engine blocker "PMI 킥오프 기록 (brownfield)" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S11: engine blocker "classification_conflict" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S11: engine blocker "트랙 분류 정리 (case_type ↔ route)" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S11: engine blocker "실행 기준선 확인 (greenfield)" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S11: flow.spec requiredArtifact "투자심의 자료" has no engine blocker with the same key (declared, not enforced)
[WARN] check-engine-spec-parity: S11: flow.spec requiredArtifact "추진계획(차터) 기준선 — 목적·트랙 근거·진출 범위·KPI 선커밋" has no engine blocker with the same key (declared, not enforced)
[WARN] check-engine-spec-parity: S11: flow.spec requiredArtifact "설립 실행 기록(신규 법인 설립 — 설립준비·등기·인허가 분류·인력이전·완료확인 — chk-entity-formation 증적, origin∈{internal,joint} / 신규 사업부 추진 — 신설 결의·사업자등록 정리·인허가 명의 확인·인력 배치·완료 확인 — chk-business-unit-formation 증적, origin=internal)" has no engine blocker with the same key (declared, not enforced)
[WARN] check-engine-spec-parity: S11: 2 engine missing.push call(s) carry no literal key (computed labels cannot be matched until P3 stable keys)
[WARN] check-engine-spec-parity: S12: engine blocker "벤처 스코어카드" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S12: engine blocker "분기별 스코어카드 갱신" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S12: engine blocker "사람 전환 결정 기록(어휘 5종)" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S12: engine blocker "차기 트랜치 조건(tranche_condition)" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S12: engine blocker "핵심사업 인계 기록(core_handoff)" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S12: engine blocker "매각/청산 계획(divest_plan)" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S12: engine blocker "학습 포착 기록(kill_with_learning_captured)" is not a flow.spec requiredArtifact (undeclared blocker)
[WARN] check-engine-spec-parity: S12: flow.spec requiredArtifact "벤처 스코어카드 (greenfield — brownfield은 integration/partnership 모니터링, 권장·비차단)" has no engine blocker with the same key (declared, not enforced)
[WARN] check-engine-spec-parity: S12: flow.spec requiredArtifact "사람 전환 결정 기록(어휘 5종, decided_by=venture-portfolio-ic, rationale 필수 — venture_transition_decision 원장)" has no engine blocker with the same key (declared, not enforced)
[WARN] check-engine-spec-parity: S12: flow.spec requiredArtifact "전환별 결정 부속 기록: 차기 트랜치 조건(next_tranche_released/held_evidence_incomplete), 핵심사업 인계 기록(graduate_to_core), 매각/청산 계획(reduce_or_divest), 학습 포착 기록(kill_with_learning_captured — group-review-agent 기록, risk-officer가 S1/S2 기본률에 환류)" has no engine blocker with the same key (declared, not enforced)
[WARN] check-engine-spec-parity: S12: flow.spec requiredArtifact "실행 기준선 대비 차이(greenfield)" has no engine blocker with the same key (declared, not enforced)
[WARN] check-checklist-consumers: business-unit-formation-checklist (chk-business-unit-formation): no producer - no step of a flow.spec-hosted procedure cites checklists/business-unit-formation-checklist.yaml
[WARN] check-checklist-consumers: strategic-fit-screening-checklist (chk-strategic-fit): no gate consumer - no runtime module reads it (projection/translation files excluded)
[WARN] check-checklist-consumers: legal-regulatory-checklist (chk-legal-regulatory): no producer - no step of a flow.spec-hosted procedure cites checklists/legal-regulatory-checklist.yaml
[WARN] check-checklist-consumers: legal-regulatory-checklist (chk-legal-regulatory): no gate consumer - no runtime module reads it (projection/translation files excluded)
[WARN] check-checklist-consumers: financial-dd-checklist (chk-financial-dd-checklist): no producer - no step of a flow.spec-hosted procedure cites checklists/financial-dd-checklist.yaml
[WARN] check-checklist-consumers: financial-dd-checklist (chk-financial-dd-checklist): no gate consumer - no runtime module reads it (projection/translation files excluded)
[WARN] check-checklist-consumers: greenfield-feasibility-checklist (chk-greenfield-feasibility): no producer - no step of a flow.spec-hosted procedure cites checklists/greenfield-feasibility-checklist.yaml
[WARN] check-checklist-consumers: greenfield-feasibility-checklist (chk-greenfield-feasibility): no gate consumer - no runtime module reads it (projection/translation files excluded)
[WARN] check-checklist-consumers: site-selection-checklist (chk-site-selection): no gate consumer - no runtime module reads it (projection/translation files excluded)
[WARN] check-checklist-consumers: legal-dd-checklist (chk-legal-dd): no gate consumer - no runtime module reads it (projection/translation files excluded)
[WARN] check-checklist-consumers: hr-dd-checklist (chk-hr-dd): no gate consumer - no runtime module reads it (projection/translation files excluded)
[WARN] check-checklist-consumers: market-dd-checklist (chk-market-dd): no gate consumer - no runtime module reads it (projection/translation files excluded)
[WARN] check-checklist-consumers: financing-plan-checklist (chk-financing): no gate consumer - no runtime module reads it (projection/translation files excluded)
[WARN] activity-agent-in-procedure: S2/business-model-sketch: agent 'greenfield-agent' holds no step in procedure 'brownfield-screening'
[WARN] activity-agent-in-procedure: S3/synergy-analysis: agent 'financial-analyst' holds no step in procedure 'greenfield-screening'
[WARN] activity-agent-in-procedure: S3/synergy-analysis: agent 'financial-analyst' holds no step in procedure 'brownfield-screening'
[WARN] activity-agent-in-procedure: S3/synergy-red-team: agent 'risk-officer' holds no step in procedure 'greenfield-screening'
[WARN] activity-agent-in-procedure: S3/synergy-red-team: agent 'risk-officer' holds no step in procedure 'brownfield-screening'
[WARN] activity-agent-in-procedure: S4/route-strategy: agent 'pm' holds no step in procedure 'greenfield-pre-fs'
[WARN] activity-agent-in-procedure: S4/route-strategy: agent 'pm' holds no step in procedure 'brownfield-pre-fs'
[WARN] activity-agent-in-procedure: S4/route-strategy: agent 'pm' holds no step in procedure 'deal-shape-chain'
[WARN] activity-agent-in-procedure: S4/deal-shape-evaluation: agent 'brownfield-agent' holds no step in procedure 'greenfield-pre-fs'
[WARN] activity-agent-in-procedure: S4/deal-shape-evaluation: agent 'brownfield-agent' holds no step in procedure 'deal-shape-chain'
[WARN] activity-agent-in-procedure: S4/route-advisory: agent 'pm' holds no step in procedure 'greenfield-pre-fs'
[WARN] activity-agent-in-procedure: S4/route-advisory: agent 'pm' holds no step in procedure 'brownfield-pre-fs'
[WARN] activity-agent-in-procedure: S4/route-advisory: agent 'pm' holds no step in procedure 'deal-shape-chain'
[WARN] activity-agent-in-procedure: S8/target-selection: agent 'pm' holds no step in procedure 'brownfield-fs-comparative'
[WARN] activity-agent-in-procedure: S9/commercial-dd: agent 'commercial-dd-agent' holds no step in procedure 'greenfield-dd'
[WARN] activity-agent-in-procedure: S9/legal-dd: agent 'legal-counsel' holds no step in procedure 'greenfield-dd'
[WARN] activity-agent-in-procedure: S9/financial-dd: agent 'financial-analyst' holds no step in procedure 'greenfield-dd'
[WARN] activity-agent-in-procedure: S9/financial-dd: agent 'financial-analyst' holds no step in procedure 'brownfield-dd'
[WARN] activity-agent-in-procedure: S9/hr-dd: agent 'hr-integration-agent' holds no step in procedure 'greenfield-dd'
[WARN] activity-agent-in-procedure: S9/market-dd: agent 'market-intelligence-agent' holds no step in procedure 'greenfield-dd'
[WARN] activity-agent-in-procedure: S9/financing-dd: agent 'financing-agent' holds no step in procedure 'greenfield-dd'
[WARN] activity-agent-in-procedure: S9/financing-dd: agent 'financing-agent' holds no step in procedure 'brownfield-dd'
[WARN] activity-agent-in-procedure: S9/dd-waiver-review: agent 'compliance-officer' holds no step in procedure 'greenfield-dd'
[WARN] activity-agent-in-procedure: S9/capability-dd: agent 'brownfield-agent' holds no step in procedure 'brownfield-dd'
[WARN] activity-agent-in-procedure: S10/deal-structure-hypothesis: agent 'brownfield-agent' holds no step in procedure 'brownfield-fs'
[WARN] activity-agent-in-procedure: S10/deal-structure-hypothesis: agent 'brownfield-agent' holds no step in procedure 'deal-shape-chain'
[WARN] activity-agent-in-procedure: S11/ic-preparation: agent 'pm' holds no step in procedure 'entity-ic-review'
[WARN] activity-agent-in-procedure: S11/ic-preparation: agent 'pm' holds no step in procedure 'group-investment-review'
[WARN] activity-agent-in-procedure: S11/charter-baseline: agent 'pm' holds no step in procedure 'entity-ic-review'
[WARN] activity-agent-in-procedure: S11/investment-structuring: agent 'brownfield-agent' holds no step in procedure 'jv-lifecycle-governance'
[WARN] activity-agent-in-procedure: S11/risk-review: agent 'risk-officer' holds no step in procedure 'group-investment-review'
[WARN] activity-agent-in-procedure: S11/group-review: agent 'group-review-agent' holds no step in procedure 'entity-ic-review'
[WARN] check-kill-registry-parity: neb-policy section 4 row states a criterion with no registry entry: row 4
[WARN] check-review-coverage: S1: output "시장 규모·성장 추정 (systematic-market-sizing 매트릭스 — 버전 관리)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S1: output "경쟁 구조 (시장 집중도·주요 플레이어 — competitive-intelligence 액티비티 산출)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S1: output "외부 미래 전망 대비 격차 분석 (입수 시 — 신규·강화 드라이버 요인 포함, S2 인사이트로 연동)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S2: output "기회 퍼널(매력도 포함)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S2: output "진입시장 산정 (기회별 — S1 링크·대상 범위·배율 도출 사슬, ADR-0180)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S3: output "시너지 점수" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S3: output "전략적 적합성 평가" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S3: output "필요 역량 목록 (시장 요구사항 — S2 스케치 requiredCapabilities·S1 요인에서 도출)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S3: output "역량 갭 분석 (그룹/계열사 보유 역량 대비; 내부(자사 단독) 역량 평가는 후속 보강)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S4: output "라우트 결정 기록" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S5: output "진출전략(Build/Partner/Hire/Invest)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S5: output "Business Case 라인(비용·수익 구조)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S6: output "Target Universe 정의(선정 기준·커버리지)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S6: output "Target Company Long List(필수 속성·출처 포함)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S7: output "Screening Evidence" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S8: output "Business Case / 밸류에이션 (brownfield — 대상별)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S8: output "시뮬레이션 NPV 분포" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S8: output "BEP 시점·물량 (밸류에이션)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S8: output "시뮬레이션 입력 스냅샷 (job-spec 기록)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S8: output "Target 비교 분석·권고 (brownfield)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S8: output "대상 선정 기록 (brownfield — 사람 결정)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S8: output "채택 Business Case (사람의 채택 기록 s8_case_adopt — S10·S11 투자심의 자료의 정량 축)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S9: output "DD 체크리스트 판정" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S9: output "조사내역(dd_finding)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S9: output "대상별 DD 비교(선택)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S9: output "필요 역량 검증 판정 (brownfield, 역량별 해소/부분 해소/미해소 — S8 기술 렌즈 T1의 근거)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S9: output "기술 렌즈 T2~T5 롤업 근거 (기술·인사·법무 체크리스트 판정 — design 2026-10-20-technical-items-s9)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S10: output "투자구조 가설(4축 검토 완료 — deal_structure_review 아티팩트 참조; 그린필드는 설립 구조 결정(신규 법인 설립 또는 신규 사업부 추진) 포함)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S10: output "자금조달 계획(sources & uses 균형·자금 확정성 증빙)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S11: output "IC 결정" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S11: output "투자 구조 확정(투자 주체·자금 조달 mix·지급 일정)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S11: output "설립 완료 법인(신설 법인 — 사내벤처·자회사, origin∈{internal,joint})" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S11: output "실행 진입(PMI / 벤처 모니터링 / R&BD 실행)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S11: output "실행 기준선(greenfield — capex_tranche 연결·인허가/인증 마일스톤·채용·램프업 KPI·인센티브 의무, 사람 확인)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S12: output "포트폴리오 스코어카드" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S12: output "사업 성과 리포트" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S12: output "포트폴리오 전환 결정(어휘 5종: next_tranche_released / held_evidence_incomplete / graduate_to_core / reduce_or_divest / kill_with_learning_captured)" is not in the review registry (not a requiredArtifact - skips AI-2nd)
[WARN] check-review-coverage: S1: author domain 'functional' resolves by DEFAULT_REVIEWER_DOMAIN fallback (matrix file absent - P4)
[WARN] check-review-coverage: S2: author domain 'functional' resolves by DEFAULT_REVIEWER_DOMAIN fallback (matrix file absent - P4)
[WARN] check-review-coverage: S3: author domain 'functional' resolves by DEFAULT_REVIEWER_DOMAIN fallback (matrix file absent - P4)
[WARN] check-review-coverage: S4/route-strategy: author agent 'pm' has no review domain
[WARN] check-review-coverage: S4/route-advisory: author agent 'pm' has no review domain
[WARN] check-review-coverage: S4: author domain 'functional' resolves by DEFAULT_REVIEWER_DOMAIN fallback (matrix file absent - P4)
[WARN] check-review-coverage: S5: author domain 'functional' resolves by DEFAULT_REVIEWER_DOMAIN fallback (matrix file absent - P4)
[WARN] check-review-coverage: S6: author domain 'functional' resolves by DEFAULT_REVIEWER_DOMAIN fallback (matrix file absent - P4)
[WARN] check-review-coverage: S7: author domain 'functional' resolves by DEFAULT_REVIEWER_DOMAIN fallback (matrix file absent - P4)
[WARN] check-review-coverage: S8/target-selection: author agent 'pm' has no review domain
[WARN] check-review-coverage: S8: author domain 'functional' resolves by DEFAULT_REVIEWER_DOMAIN fallback (matrix file absent - P4)
[WARN] check-review-coverage: S9: author domain 'functional' resolves by DEFAULT_REVIEWER_DOMAIN fallback (matrix file absent - P4)
[WARN] check-review-coverage: S9: author domain 'region' resolves by DEFAULT_REVIEWER_DOMAIN fallback (matrix file absent - P4)
[WARN] check-review-coverage: S10: author domain 'functional' resolves by DEFAULT_REVIEWER_DOMAIN fallback (matrix file absent - P4)
[WARN] check-review-coverage: S11/ic-preparation: author agent 'pm' has no review domain
[WARN] check-review-coverage: S11/charter-baseline: author agent 'pm' has no review domain
[WARN] check-review-coverage: S11: author domain 'functional' resolves by DEFAULT_REVIEWER_DOMAIN fallback (matrix file absent - P4)
[WARN] check-review-coverage: S12: author domain 'functional' resolves by DEFAULT_REVIEWER_DOMAIN fallback (matrix file absent - P4)
[WARN] check-s12-coverage: cell (brownfield, external, jv) matches no S12 activity
[WARN] check-s12-coverage: cell (brownfield, external, minority_investment) matches no S12 activity
[WARN] check-s12-coverage: cell (brownfield, external, rbd) matches no S12 activity
[WARN] check-s12-coverage: cell (brownfield, external, corporate_venture) matches no S12 activity
```

## 12. P2 results

Run on 2026-10-28 after the P2 changes (`process-ssot-check.ts` 2.0.0). Six checks are now blocking (ERROR, exit 1; also fail `scripts/co-newbiz/audit-variant.ts` 1.5.0 and, for M2, `procedures/_validate.ts` 1.9.0). The two the design closes later stay report-only.

| Validator | Finding | P1 | P2 | Mode |
|---|---|---|---|---|
| check-engine-spec-parity | H8 | 51 | 52 | WARN until P3 (the new S4 requiredArtifact is declared, not yet an engine blocker) |
| check-checklist-consumers | H9 | 13 | 0 | blocking |
| activity-agent-in-procedure | M2 | 32 | 0 | blocking |
| check-kill-registry-parity | M4 | 1 | 0 | blocking |
| check-stage-inputs | M9 | 0 | 0 | blocking |
| check-review-coverage | M7/M8 | 55 | 55 | WARN until P4 |
| check-s12-coverage | M17 | 4 | 0 | blocking |
| check-stages-derived | M3 | 0 | 0 | blocking |

How each P1 finding closed:

- M2 (32): 22 pairs reconciled by a procedure step (S3 synergy author and red-team in both screening procedures; greenfield-dd steps 9-17; brownfield-dd steps 4.5, 5.5, 12.5) or by correcting an activity procedure list where another listed procedure already holds the activity's step (S2 business-model-sketch, S4 deal-shape-evaluation, S10 deal-structure-hypothesis, S11 investment-structuring / risk-review / group-review). The remaining 10 are `pm` gateway-assembler pairs in `ACTIVITY_AGENT_ALLOWLIST`, each with its ADR (ADR-0185 F-12 and section 1.6, ADR-0104 decisions 1-3).
- H9 (13): legal-regulatory gets the S4 `regulatory-screening` activity (legal-counsel) and screening steps as producer, and an S4 requiredArtifact (mirrored in the engine STAGES list) as the Screening gate consumer; financial-dd gets DD steps; greenfield-feasibility and business-unit-formation get item citations in their producing steps (the BU procedure is now listed by the S11 establishment activity). The five DD checklists are consumed by `DD_WORKSPACE_CHECKLISTS` (verified declared consumer). Three consumer sides are justified exemptions: strategic-fit (ADR-0134), site-selection and greenfield-feasibility (machine consumer deferred to P3).
- M4 (1): `greenfield-dd__covenant_breach_under_downside_financing_plan` declared and cited by neb-policy 1.2.1 section 4; the screening (market, data confidence, knock-out) and pre_fs (route undecided) summary lines are declared too. All nine new entries are declared-but-inert.
- M17 (4): portfolio-venture-monitoring 1.3.0 (D8) covers external minority / R&BD / CVC. The (brownfield, external, jv) cell is reachable: classification is human-recorded independently of the route and `deriveOriginFromSubTrack` only defaults JV to joint. jv-lifecycle-governance 1.2.0 covers it with step 2. The S12 step scope is declared in flow.spec `procedureSteps`.

Deferred, with reasons: the runtime D9 trim of the greenfield DD workspace and the origin-aware step exclusion (greenfield-subtrack.ts is authoritative; engine work, P3); a compliance-engine gate requirement for chk-legal-regulatory and machine consumers for site-selection / greenfield-feasibility (P3 stable blocker keys); executable predicates for the nine inert kill criteria (thresholds by risk-officer + quant-methodologist, design Decision 8). Needs judgement: every greenfield project defaults to origin=internal (ADR-0166), so the D9 trim reaches new-site plants as well as expansions; the owner should confirm the scope before P3 makes it effective. Policy change record: `docs/decisions/DEC-20261028-01.md`.

## 13. P3 results

Run on 2026-10-28 after the P3 changes (`process-ssot-check.ts` 3.0.0, flow.spec 2.16.0). Seven checks are blocking; only `check-review-coverage` (M7/M8, 55 findings) stays report-only until P4.

| Validator | Finding | P2 | P3 | Mode |
|---|---|---|---|---|
| check-engine-spec-parity | H8 | 52 | 0 | blocking |
| check-checklist-consumers | H9 | 0 | 0 | blocking (exemptions: chk-strategic-fit consumer only, ADR-0134) |
| activity-agent-in-procedure | M2 | 0 | 0 | blocking |
| check-kill-registry-parity | M4 | 0 | 0 | blocking |
| check-stage-inputs | M9 | 0 | 0 | blocking |
| check-review-coverage | M7/M8 | 55 | 55 | WARN until P4 |
| check-s12-coverage | M17 | 0 | 0 | blocking |
| check-stages-derived | M3 | 0 | 0 | blocking |

### 13.1 Stable blocker keys (H8)

- Every `missing` entry the engine reports goes through `blocker("<key>")` (`app/web-next/lib/process-blocker-keys.ts`): 60 keys of the form `s<stage>.<snake_case>`. The key's label is the exact string the engine has always emitted, so `gate_decision.missing_artifacts_json`, the process API payload and the STAGES mirror of flow.spec `requiredArtifacts` do not change meaning. A new engine blocker needs a key (a raw `missing.push("...")` is a finding).
- flow.spec 2.16.0 declares `blockers:` per stage: `{ key, artifacts: [i], criteria: [j] }`, where the indices are 0-based positions in that stage's `requiredArtifacts` / `completionCriteria`. Rules checked: engine keys = spec keys per stage; each spec key exists in the registry and every registry key is emitted (no dead key); the key prefix names the stage; indices are in range; every requiredArtifact is covered by a key or listed in `nonBlockingArtifacts` (S12 "baseline variance" only - advisory by design). The spec lines are no longer compared as Korean strings.
- i18n: each key has `processBlockers.<key>` in ko and en (`s3_synergy_assessment` form); `localizeBlocker(tr, label)` resolves a reported label through the catalog and falls back to the Korean rewriter for free-form prose. Wired into the process page, the deal stage page and the stage-frame "what is left" list.
- H8 before/after: 52 findings (engine labels not declared, spec artifacts without an engine blocker, 2 computed labels) to 0. The S4 `chk-legal-regulatory` artifact now has its engine blocker `s4.legal_regulatory_screening`. Engine blockers that were enforced but undeclared are now declared: S8 WACC confirmation (ADR-0186 D8) and S11 condition precedents (ADR-0186 D4), as completion criteria.

### 13.2 S10 checks (M1)

`app/web-next/lib/s10-checks.ts`; constants `S10_USES_RECONCILIATION_TOLERANCE = 0.05` and `S10_MIN_DOWNSIDE_DSCR = 1.2` carry the D2 provenance (owner `risk-officer` + `quant-methodologist`).

| Check | Blocks when | Does not block when |
|---|---|---|
| (a) uses reconcile to the S8 adopted investment | adopted capex total is derivable (KRW_M lines, > 0) and total uses deviate by more than 5% | not derivable (no adopted case, no capex lines, unit not KRW_M, total <= 0): a non-blocking advisory in `blockers` asks a person to reconcile |
| (b) downside covenant headroom | the project has debt and: no simulation, no covenant tests, no DSCR test, a DSCR breach, or minimum projected DSCR < 1.2 | no `debt_instrument` row |
| (c) funding evidence | any source row lacks `evidence_kind` or a non-blank `evidence_ref` (migration 0162 columns) | - |

The investment proxy is the adopted case's capex lines (the same figure `trancheReconciliation` reconciles to). The latest covenant simulation of the project is treated as the downside run (the snapshot filler reads the same one); simulations carry no scenario tag today. Cut-over: projects whose earliest policy pin or creation is on or after 2026-10-28; earlier projects keep the legacy S10 predicate (ADR-0151 precedent). The demo seeds and the scenario deal fixture now carry source evidence; the greenfield demo plan is re-cut to the adopted case.

### 13.3 D9 re-key (owner decision 2026-10-28)

The trim keys on the greenfield sub-track, not on origin. ADR-0166 defaults every greenfield project to `origin=internal`, so the P2 origin predicates would also have trimmed a new-site plant. Rule: for a greenfield route whose sub-track is `existing_business_rbd` or `intra_venture` (selection active), procedure steps 9 (commercial), 12 (HR), 13 (market), 14 (financing), 15 (IP and FTO) and 16 (region labor) do not apply; steps 10 (legal-regulatory), 11 (financial), 17 (waiver) and the EHS/site steps stay. The plain route (no sub-track), an unknown value, an unassessed route and a grandfathered project (selection inactive) keep every step. Where: `greenfield-dd` 1.3.0 predicates (`none_of project.sub_track in [...]`), `greenfield-subtrack.ts` `D9_TRIMMED_STEPS` / `d9TrimApplies` (feeds `excluded_steps`), workspace overlay 1.3.0 (`applies: 'no'` for the two sub-tracks on those steps). `tests/unit/greenfield-subtrack.test.ts` keeps procedure and code equal. Recorded in ADR-0187's decision log and DEC-20261028-02.

Needs judgement: "existing-site capacity expansion" has no sub-track of its own - the route model's greenfield sub-tracks are `existing_business_rbd` and `intra_venture`. Adding a dedicated expansion sub-track means widening the `route_decision.sub_track` CHECK constraint (a schema change, ADR trigger). Item-level scoping of the trimmed domains stays as the approved overlay codes it (per-row human approvals, binding items always A); P3 trims the step scope only.

### 13.4 Gate consumers (H9)

`app/web-next/lib/checklist-gate-consumers.ts`. The compliance engine (`db/lib/compliance.ts`) runs from the project carrier on (waivers and `compliance_check` rows are project-keyed), while the Screening and Pre-FS gates run on the opportunity; the consumers therefore apply the engine's requirement semantics in memory (mandatory item unmet = blocked, recommended = `reason_required`, never blocks) to a person-recorded ledger (`process_run`, entity opportunity; `POST /api/opportunities/:id/checklist-screening`, append-only, audited).

| Checklist | Gate / stage | Engine blocker |
|---|---|---|
| chk-legal-regulatory | Screening / S4 | `s4.legal_regulatory_screening` |
| chk-greenfield-feasibility | Pre-FS / S5 (greenfield) | `s5.greenfield_feasibility_checklist` |
| chk-site-selection | Pre-FS / S5 (greenfield) | `s5.site_selection_checklist` |

Rollout: `CO_NEWBIZ_CHECKLIST_CONSUMERS` = off / shadow / enforce (default shadow in production, off elsewhere, as ADR-0186). shadow shows an advisory line, enforce blocks the stage; opportunities created before 2026-10-28 are exempt. It ships off by default because no screen records the checklists yet (UI: frontend-engineer). The H9 exemptions for site-selection and greenfield-feasibility are removed; only chk-strategic-fit stays (ADR-0134).

### 13.5 Other P3 items

- D5 prompt rebind: `s3.capability_gap_draft` is bound to `greenfield-agent` / `S3.capability-register-greenfield`; both routes attribute the call to `brownfield-agent` once the recorded route is brownfield (`lib/capability-register-lead.ts`). pm-catalog regenerated.
- MCP: `propose_gate_decision` covers `stage:S5:3` and `stage:S5:4`; the record write has no tool (human-only record).

Deferred, with reasons: executable predicates for the nine inert kill criteria (thresholds by risk-officer + quant-methodologist, design Decision 8); a recording screen for the three checklists and a runbook for the enforce flip (frontend-engineer, sre); enabling `CO_NEWBIZ_CHECKLIST_CONSUMERS=enforce` (owner decision after the UI exists); item-level D9 scoping and a dedicated expansion sub-track (human approvals, schema ADR); H7/H11/M7 and the schema work (P4).

## 14. P4 results

Merged as PR #759 (`process-ssot-check.ts` 4.0.0, `audit-variant.ts` 1.7.0, migrations 0180-0182). The P4 PR recorded its detail in the changelog and the code; this section is the design-side record.

- H7 (D1): the data-confidence grade is `U` (unknown) when no proxy chain is recorded and the source is not direct data (`packages/core-scoring` 1.1.0; rationale text generated from the real hop list). `U` caps the RAG at Amber and never reaches Green. Migration 0180 rebuilds `market_sizing_version` for the new CHECK value and labels zero-hop legacy defaults; stored grades are not recomputed (write-time only, section 6).
- H7 (D2): migration 0181 adds `base_rate` (provenance NOT NULL, p10 <= p50 <= p90, no delete, supersede-only updates) and provenance columns on `benchmark_case`. All-or-nothing importers `import-base-rates.ts` and `import-benchmark-cases.ts` reject unsourced rows and project identifiers. `GET /api/base-rates` answers `not_available` rather than a default. No rows are seeded: the data needs owner-supplied sources.
- H11 (D4): migration 0182 adds `stage_captured` / `captured_by` / `captured_at` to `permit` and `incentive` (certification untouched). `GET|POST /api/projects/:id/pre-ic-captures` captures S5 or S8 candidates (incentive type and clawback terms required); human-only `/adopt` links them into an unconfirmed S11 baseline by id in one transaction. A latent bug fixed on the way: stored baseline milestone links were dropped on re-read.
- M7 / M8 (D3): `process/cross-validation-matrix.yaml` (artifact type x author domain -> reviewer agent), projected by `generate-review-matrix.ts` into `review/domains.ts` and `ai-second.ts`; the fallback is labelled and the `target_screening` exception is carried. Review coverage 55 -> 0 and blocking: all eight process-ssot checks now block.

## 15. P5 results

Run on 2026-10-28 (`seed-s1-s12-demo.ts` 1.14.0, `tests/unit/adr-0187-p5-seed-subtracks.test.ts`). No schema change; no production or dev database touched (every test seeds a temporary database).

### 15.1 M14 residual - demo seed evidence

| Row | Track | How it is written |
|---|---|---|
| 2 ranked site candidates (`site`, scores, permit lead time, infra capex) | greenfield | direct insert in the `POST /api/projects/:id/sites` shape (the route has no service function), `site.create` audited |
| Permit candidates: S5 environmental consultation, S8 industrial-complex entry | greenfield | `capturePermitCandidate` (`lib/pre-ic-capture.ts`, the function the pre-ic-captures route calls); `stage_captured`, `captured_by`, `captured_at` set, audited |
| Incentive candidate (subsidy, NPV 1500 KRW M, clawback terms, deadlines, `src:` evidence) | greenfield | `captureIncentiveCandidate`, stage S8 |
| S11 adoption | greenfield | `adoptPreIcCaptures` links every capture into the baseline by id (no re-entry) before `confirmExecutionBaseline`; the baseline carries the permit milestones and the clawback obligation |
| One optional commercial item `fail` with a reason; one optional legal item `na` with a note | brownfield | seed rows, optional items only (a mandatory non-pass would block S9 by design) |
| One optional technical item `fail` with a reason; one optional HR item `na` with a note | greenfield | same |

The ADR-0186 brownfield waiver (a mandatory waiver-eligible item `waived` through the waiver path) stays the single `waived` row. The seeds stay idempotent: every row is looked up by its natural key and a re-run leaves site, permit, incentive, checklist-state, audit and baseline counts unchanged. The brownfield demo carries no site, permit or incentive rows: those registers belong to the greenfield execution path.

### 15.2 M15 - brownfield sub-track fixtures through S12

Spec-level (real `flow.spec.yaml` and `procedures/_shared`, exported helpers of `process-ssot-check.ts`): the S12 activities a classification cell resolves to.

| Cell (brownfield, external) | S12 activities |
|---|---|
| m_and_a, strategic_investment | integration-monitoring (pmi-integration-execution step 6) |
| jv, partnership | partnership-monitoring (jv-lifecycle-governance step 2) |
| minority_investment, rbd, corporate_venture | portfolio-monitoring (portfolio-venture-monitoring, D8) |
| jv with origin=joint | portfolio-monitoring and partnership-monitoring |

Asserted: the five sub-tracks never match the PMI integration step, every origin of every one has at least one S12 activity, every greenfield cell resolves to portfolio-monitoring, and `check-s12-coverage` is clean on the real tree.

D9 trim, asserted over all classification cells: greenfield-dd steps 9 and 12-16 are dropped exactly when the sub-track is `existing_business_rbd` or `intra_venture`, whatever the origin; steps 10, 11 and 17 always stay; a plain route (new site, origin internal by the ADR-0166 default) keeps every step; `d9TrimApplies` is false for all seven brownfield sub-tracks and `brownfield-dd` carries no expansion-sub-track predicate.

Engine fixture: the seeded brownfield project is re-pointed to each of m_and_a, jv, minority_investment, partnership, rbd and corporate_venture (each sub-track's own S9 checklists judged, as the seed does for M&A). S11 raises the PMI-kickoff blocker exactly where `pmiKickoffApplies` says (m_and_a and jv) and S11 and S12 complete for all six. A finding worth knowing: a sub-track change alone re-opens S9, because each shape brings its own checklists (partner-shape, R&BD technology, M&A special topics).

## 16. W3 closeout

Wave W3 = findings H7-H9, H11, M1-M9, M14, M15, M17 (M16 closed by ADR-0186; M10-M13 out of scope). PRs: #752 (ADR and design), #753 (P0), #754 (P1), #757 (P2), #758 (P3), #759 (P4), P5 (this change, number assigned at sync).

| ID | Status | Closed by | Remaining |
|---|---|---|---|
| H7 | partial | #759 (U grade, `base_rate`, benchmark provenance, importers, API) | no base-rate or benchmark rows exist (needs owner-supplied sources, D2); stored grades keep their legacy value |
| H8 | closed | #753 (declarations), #758 (stable keys, parity blocking, 52 -> 0) | none |
| H9 | partial | #757 (producers, S4 artifact), #758 (gate consumers, shadow/enforce flag) | consumers ship off/shadow; no recording screen; enforce flip is an owner decision |
| H11 | closed | #759 (migration 0182, capture + adopt API), P5 (seed proves the path) | no capture screen yet (frontend-engineer) |
| M1 | closed | #758 (`lib/s10-checks.ts`: reconciliation, downside DSCR >= 1.2x, funding evidence) | non-derivable investment is an advisory, not a block; thresholds are starting values |
| M2 | closed | #757 (32 -> 0; 10 `pm` assembler pairs allowlisted with ADRs) | none |
| M3 | closed | #753 (v2 gate order), #754 (derived-from-spec validator) | none |
| M4 | closed | #753 (registry canonical), #757 (parity blocking, 1 -> 0) | nine kill criteria are declared but inert (no executable predicate) |
| M5 | closed | #753 (D7: group IC GO before establishment, in flow.spec S11) | none |
| M6 | closed | #753 (D6: financial-analyst authors, risk-officer red-teams), #757 (procedure steps) | none |
| M7 | closed | #759 (cross-validation matrix, fallback labelled) | none |
| M8 | closed | #753 (policy exception, AI-2nd default), #759 (55 -> 0, blocking) | none |
| M9 | closed | #753 (S2 entry market declared on S5-S7, S9-S12) | none |
| M14 | closed | ADR-0186 P5 (HOLD, KILL, waiver, six validators), P5 (site, permit, incentive, non-pass rows) | brownfield demo has no site/permit/incentive rows (greenfield registers) |
| M15 | partial | #757/#758 (D9 trim, re-keyed to the two sub-tracks), P5 (sub-track fixtures and trim assertions) | an existing-site capacity expansion has no sub-track of its own, so it still gets the full DD; item-level D9 scoping; both need a schema ADR |
| M17 | closed | #757 (D8 widening, jv branch, 4 -> 0), P5 (per sub-track fixtures) | none |

Exit state: all eight process-ssot checks block and are green on the tree; no new schema in P5.

## 17. Consolidated open decisions and deferrals (P0-P5)

Owner decisions open:

1. Enable `CO_NEWBIZ_CHECKLIST_CONSUMERS=enforce` (H9). Needs the recording screen first; today default is shadow in production and off elsewhere. Opportunities created before 2026-10-28 stay exempt.
2. Dedicated "existing-site capacity expansion" sub-track (M15). Widening the `route_decision.sub_track` CHECK is a schema change and needs its own ADR; until then only `existing_business_rbd` and `intra_venture` are trimmed. Item-level D9 scoping is the companion decision.
3. Whether stored `data_confidence` grades are recomputed (H7). P4 keeps them as recorded with a legacy label; a backfill is a data change the owner has not asked for.
4. Base-rate and benchmark-case sources (D2). The importers and API exist and reject unsourced rows; `risk-officer` + `quant-methodologist` must supply the first sourced rows.
5. Executable predicates for the nine inert kill criteria (design Decision 8). Thresholds belong to `risk-officer` + `quant-methodologist`.
6. D2 thresholds stay "starting values": S10 uses +/-5% of the S8 adopted investment and downside DSCR >= 1.2x. Two modelling assumptions to confirm: the investment proxy is the adopted case's capex total, and the latest covenant simulation is treated as the downside run (simulations carry no scenario tag).

Deferrals (owner-visible, no decision needed to proceed):

7. UI: a recording screen for chk-legal-regulatory / chk-greenfield-feasibility / chk-site-selection and a capture/adopt screen for pre-IC permits and incentives (`frontend-engineer`); a runbook for the enforce flip (`sre`).
8. Cut-over dates: S10 checks apply to projects created or pinned on or after 2026-10-28; legacy projects keep the old predicate (ADR-0151 precedent).
9. Re-seeding the 7748 dev database to see the P5 evidence rows is owner/dba-run; nothing here touches 7748 or 7749.
10. Cosmetic: the flow.spec S12 `portfolio-monitoring` comment still says the applies_when widening "lands in P2; until then ... known gap", contradicted by the v2.15.0 comment below it. Fixing it is a spec patch (ADR-0074) for `process-governance-manager`; no behaviour changes.
11. `docs/reports/2026-10-26-project-review-s1-s12.md` is an analysis-only record and W1/W2 did not annotate it, so its action-wiring section is left unchanged; this section is the W3 status of record.

## 18. Post-W3 amendments D6' and D3' (owner, 2026-10-28)

- **D6' (amends D6)**: S3 `synergy-analysis` is led by `market-intelligence-agent`, which locates the synergies (affiliates; forward/backward customers, supply chain, channel, technology) with the six-axis value-chain linkage analysis. `financial-analyst` quantifies each line (revenue and cost) against the assumption register as a procedure-step support role; `risk-officer` keeps only `synergy-red-team`. flow.spec 2.17.0; greenfield-screening 1.6.0 (1.5 / 1.55 / 1.6); brownfield-screening 1.4.0 (2.5 / 2.55 / 2.6); prompt `s3.synergy_synergy` rebinds, `s3.synergy_fa` becomes a sanctioned dual assignment.
- **D3' (amends D3)**: cross-validation-matrix 1.1.0 routes valuation and synergy AI-2nd review to `industry-lead` (functional/technical/region authors) and `region-lead` (industry authors). `risk-officer` remains a first-stage specialist; the matrix's OPEN note on the functional-author valuation fallback is removed.
- **Finance-trio boundaries** (docs only): financial-analyst - historical analysis, QoE, ratio peer comparison, growth-projection assumptions with evidence; valuation-agent - DCF/NPV/IRR/DSCR, EV/Revenue bands, simulation; financing-agent - funding structure and independent downside covenant-headroom check. None recommends the investment decision.
- Record: DEC-20261028-03 (impact analysis, pin check against the latest local backup).
