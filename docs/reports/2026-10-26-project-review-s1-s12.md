---
lang: ko
lang_reason: source-material
---

# Project Review — co-newbiz S1–S12 Full Review (process, web/REST/MCP operability, journeys, UI/UX) — 2026-10-26

- **Date**: 2026-10-26
- **Scope**: full — S1–S12 process, web/REST/MCP operability, greenfield/brownfield journeys, UI/UX
- **Method**: machine battery + 4 parallel slots (A `process-governance-manager` — process integrity; B `platform-lead` — web/API/MCP; C `ux-designer-agent` — UI/UX journeys via isolated harness; D `risk-officer` — red-team journey effectiveness), each lead reviewing against its domain specialists' responsibilities
- **Disclaimer**: Analysis only. No files were modified in this report.

> Analysis only — no files modified in this report.

## Baseline (Step 0)

| Check | Result |
|---|---|
| `bun scripts/audit.ts` | All pass (1 skip) |
| agent-lifecycle | 41 agents, 4 warnings (`last_updated` older than last commit) |
| skill-lifecycle | 107 healthy |
| `procedures/_validate.ts` | Pass |
| `checklists/_validate.ts` | Pass (1 warning) |
| graph-map | Pass (24 procedures / 174 steps) |
| mcp-coverage | 107 tools / 56 activities / 56 exclusions |
| `design:lint` | 0 violations |
| `lint:i18n` | Pass |
| Unit suite | Pass |
| OpenAPI vs routes | 455/455 parity |
| Anonymous sweep | 445/455 return 401 (10 public by design) |
| Scenario e2e | 30/49 pass (19 fail) |

## Strengths

- OpenAPI 455/455 route parity.
- MCP is a pure REST client; the human-only boundary is machine-enforced.
- The gate API enforces HOLD artifacts, KILL learning, and GO prerequisites.
- The tri-state kill-criteria design and the validator engine are well designed (but unwired — see C2, C3).
- Sub-track scoping (ADR-0160/0162).
- Inputs-to-outputs strip and three-bucket review strip on every stage.
- AI outputs are labelled as proposals.
- Broad, fast unit suite.
- Isolated scenario harness.

## Review Results

Class legend: systemic (recurs by design or pattern), script-gap (a validator could catch it), one-time (single instance or data).

### Critical

| # | Issue | Slot(s) | File:Line | Class | Fix |
|---|---|---|---|---|---|
| C1 | Gate GO is not conditioned on kill criteria, RAG, the six validators, WACC, or waivers; a trivial rationale (".") is accepted; no maker/checker (approval_chain 0 rows; one user recorded all IC decisions); gate ladder enforced only entity_ic to group_ic | D F-1, A-06 | `app/web-next/app/api/projects/[id]/gate-decisions/route.ts:57-105`, `lib/process-flow.ts:1096-1121`, `lib/gate-sequence-view.ts:5` | systemic | Require an acknowledged snapshot of kill / unassessed / RAG / non-waivable state on GO, a substance check on the rationale, two-tier approval on IC, and a full gate-ladder sequence (ADR) |
| C2 | Kill criteria are never evaluated on the gate path (0 evaluation rows); 11 of 35 are inert, including base-rate, DD-to-valuation bridge, QoE, hurdle, and shortlist quality; brownfield-fs lacks a growth/base-rate criterion | D F-2 | `db/lib/kill-criteria.ts`, `procedures/_kill-criteria/` | systemic + script-gap | Wire evaluation into the gate path; activate or retire inert criteria; add a brownfield-fs growth/base-rate criterion |
| C3 | The bf-01 six-validator rule is not mechanically enforced: the completeness engine is unwired (no route, MCP tool, or script calls it); bf-01 is a free-text checklist pass; real project PRJ-QGB2W5 received IC GOs after a DD HOLD with no tracked condition precedent | D F-3 | `db/lib/validator-completeness.ts`, `lib/dd-checklist-tailor.ts:~750` | script-gap | Wire the completeness engine into the DD exit and gate paths; track condition precedents |

### High

| # | Issue | Slot(s) | File:Line | Class | Fix |
|---|---|---|---|---|---|
| H1 | S1–S12 UI journey scenarios are red: 19/49 fail (4 signatures: gate form hidden in tabs, e.g. `GreenfieldStage.tsx:634`/`:1438`; portfolio close button not found `PortfolioStage.tsx:183`; hidden S11 step heading; hidden duplicate text) | B F1 | `tests/scenarios/_support/ui.ts` | systemic | Repair the scenario helpers to open the owning tab and scope selectors |
| H2 | Raw i18n keys rendered in S6/S7, S10, S11 (both locales) | C1 | `components/stages/brownfield/constants.ts:8` + `LonglistSection.tsx:133`, `DealStructureStage.tsx:84-88`, `IcReviewStage.tsx:37-38` | script-gap | Fix the keys; extend i18n-lint to catch dotted literals |
| H3 | Journey navigation breaks: S6/S7 are the same page with a self-link "next"; no forward CTA S8–S12; brownfield S5 N/A page with a mislabeled CTA; overview shows "current stage S4" while the project is at S8 with all complete; "진입시장 미연결" with no link | C2, C3, C5, C7 | `components/StageFrame.tsx:266` | systemic | Derive the forward CTA and current stage from engine state; link unconnected-state messages |
| H4 | Internal governance jargon and IDs in user copy ("경계 #2" x18 in ko.json, ADR numbers, flow.spec versions, agent keys, checklist ids, "개발자용") | C4 | `locales/ko.json:1082,1128,3565,3898,3946,8049` | systemic + script-gap | Rewrite user copy; add a dev-jargon lint for locale files |
| H5 | N/A and waiver loopholes: `na` on mandatory items is unguarded (real PRJ-DSE4PW has 17 `na`); waiver `approved_by` is free text (self-approval); no maximum duration; `issueWaiver` omits `approved_at`, so waivers may never take effect | D F-4 | `waivers/route.ts:66-110`, `dd-checklist-tailor.ts:~745` | systemic | Guard `na` on mandatory items; bind approver to an authenticated human role; cap duration; set `approved_at` |
| H6 | WACC/hurdle never human-confirmed (0 assumptions; default 0.10) while FS/DD/IC GOs are recorded; S8 auto-cases are optimistic (T7T81A 40% CAGR vs ~18% bottom-up, downside p05 still positive); S4 route (partnership/minority) vs S8 100% acquisition vs S10 majority mismatch | D F-7, F-8 | `process-flow.ts:~560-590` | systemic (+ one-time data for T7T81A) | Gate GO on a confirmed WACC session; reconcile route, S8, and S10 structure; correct T7T81A data |
| H7 | Decision-quality evidence absent: `data_confidence` always "B" with a misleading "single statistical hop R²≥0.6" rationale; no proxy chains; benchmark_case has 0 rows and no reference-class/base-rate data | D F-5, F-6 | `db/lib/data-confidence.ts`, `packages/core-scoring/src/rag-engine.ts:~98` | systemic | Derive confidence from real chain hops; populate benchmark cases and base rates |
| H8 | SSOT lags the engine: the S3 capability register gates S3 but has no owner/activity/required artifact (personas contradict); S8 adoption and S11 baseline/PMI blockers are not in flow.spec | A-01, A-02 | `flow.spec.yaml:336-378,576-627,871-879`; `process-flow.ts:297-304,664-731` | script-gap | Declare the blockers and owners in flow.spec; add a parity test |
| H9 | `legal-regulatory-checklist` (Screening, 6/7 mandatory) has no producer or consumer | A-03 | `checklists/legal-regulatory-checklist.yaml:9` | script-gap | Assign a producer activity and a gate consumer; add a checklist consumer check |
| H10 | Group IC decision step is owned by an AI agent key (PGM) instead of a human role | A-04 | `procedures/_shared/group-investment-review/schema.yaml:51-56` | one-time (+ reverse validator rule) | Re-own the step to a human role; add the reverse decision_authority rule |
| H11 | Greenfield permits/incentives/clawback have no pre-IC data; the execution baseline exists only after IC; permits are not first-class before S11 | D F-10, A-13 | `lib/greenfield-execution.ts:~594` | systemic | Capture permit, incentive, and clawback data before IC |

### Moderate

| # | Issue | Slot(s) | File:Line | Class | Fix |
|---|---|---|---|---|---|
| M1 | S10 checks only sources = uses; no reconciliation to the S8 investment, covenant headroom, or funding evidence | D F-13 | `process-flow.ts:617-649` | systemic | Add the reconciliation, headroom, and funding-evidence checks |
| M2 | Activities whose agent has no step in the referenced procedure (S9 capability-dd, financial-dd, financing-dd, several GF DD; S3 synergy-analysis) | A-05 | — | script-gap | Add an activity.agent in procedure agent_keys check |
| M3 | `process/stages.yaml` and stage-aliases hold the pre-v2 gate order; pre-fs wording | A-07 | — | systemic | Update to the v2 gate order |
| M4 | neb-policy section 4 kill list, registry actions, and flow.spec killCriteria diverge | A-08 | — | systemic | Reconcile to a single list; add a policy-kill-to-registry check |
| M5 | S11 establishment vs Group IC order is ambiguous | A-09 | — | one-time | Fix the order in the SSOT |
| M6 | S3 synergy author and red-team are collapsed in `risk-officer`; s3 red-team independence is partly restored | A-10 | — | one-time | Separate author and red-team roles |
| M7 | The AI-2nd reviewer is effectively always `platform-lead` for deal content (no committed cross-validation matrix) | A-11 | `lib/review/domains.ts` | systemic | Commit the cross-validation matrix |
| M8 | Three-stage review gaps (target_screening exception not in policy; unlisted outputs skip AI-2nd) | A-12 | — | one-time | Add the exception to policy; list every output |
| M9 | S2 entry market is declared for S3–S12 but missing from S5–S7 and S9–S12 inputs | A-14 | — | script-gap | Add the S2 entry-market input-declaration check |
| M10 | Persona drift after ADR-0185 (ip, certification, region-lead, valuation, site-facility, PGM, compliance-officer; process-map cites v2.10.1) | A-15 | — | script-gap | Refresh personas; add a persona-vs-flow.spec check |
| M11 | Competitor registry writes are not audit-logged (4 routes) | B F3 | `app/web-next/app/api/our-company/members/[memberId]/competitors/**` | one-time + script-gap | Add audit logging; add an audit-token scan for write routes |
| M12 | Multiple primary actions / disabled primary without a reason; PASS-like S9 completion line; human vs seed judgement not distinguished | C6, C8 | — | systemic | Single primary action, explain disabled states, label judgement provenance |
| M13 | Terminology inconsistency and parse noise (Short List / 숏리스트, Brown Field / 브라운필드, duplicated word, raw backticks, empty parens, raw ids) | C9 | — | one-time / systemic | Normalise through the glossary |
| M14 | Demo seed proves the path, not the substance (all checklist rows pass; no validator/site/permit evidence; no HOLD/KILL/waiver path) | D F-9 | `scripts/co-newbiz/seed-s1-s12-demo.ts:~395-410` | script-gap | Add HOLD, KILL, and waiver paths and evidence rows to the seed |
| M15 | Greenfield DD residual busywork for internal expansions; brownfield sub-tracks (JV/minority/partnership/R&BD/CVC) unexercised | D F-11, F-12 | — | one-time + systemic | Trim internal-expansion DD; exercise the sub-tracks |
| M16 | Decision-record hygiene: AI-recommended vs human decision mismatch not captured; 35 GO / 3 HOLD / 0 KILL; no learning capture | D F-14 | — | systemic | Capture the mismatch and learning on every decision |
| M17 | Possible S12 coverage hole for brownfield external minority / R&BD / CVC | A-20 | — | could not verify | Verify against flow.spec S12 |

### Low

| # | Issue | Slot(s) | Class |
|---|---|---|---|
| L1 | Self-registration rate limit trusts `X-Forwarded-For` and uses an unbounded map | B F4 | — |
| L2 | Deprecated MCP aliases `record_gate_decision` / `create_route_decision` still ship | B F5 | — |
| L3 | Four S9 DD activities are read-only in MCP — confirm intent | B F6 | — |
| L4 | Remote MCP 401 path unverified | B F7 | — |
| L5 | S3 entry wording is circular | A-16 | — |
| L6 | Deal-structuring gate tag | A-17 | — |
| L7 | Financing checklist gate tag / S9 inputs text | A-18 | — |
| L8 | S9-to-S8 backward flow and kills without learning capture | A-19 | — |
| L9 | `risk-officer` bridge ownership wording | D F-15 | — |
| L10 | Dense mobile pages; duplicated stepper | C10 | — |

## Domain summaries

**Slot A — process integrity (`process-governance-manager`).** The engine has moved ahead of its SSOT. S3 capability register, S8 adoption, and S11 baseline/PMI blockers gate stages without flow.spec ownership, one checklist (legal-regulatory) has no producer or consumer, an AI agent key owns a human decision step, and personas, stages.yaml, and the neb-policy kill list have drifted from flow.spec and the registry. Review independence is thin: the AI-2nd seat collapses onto `platform-lead` for deal content.

**Slot B — web/API/MCP (`platform-lead`).** The platform surface is in good shape: OpenAPI and routes agree 455/455, anonymous access is denied everywhere except 10 intended public routes, and MCP is a pure REST client with the human-only boundary enforced. The weak points are the 19 failing journey scenarios (selector and tab-visibility regressions), unlogged competitor-registry writes, a spoofable rate-limit key, and deprecated MCP aliases that still ship.

**Slot C — UI/UX journeys (`ux-designer-agent`).** Journeys through the isolated harness break down at the seams: raw i18n keys on S6/S7, S10, and S11, S6/S7 sharing one page with a self-linking next step, no forward CTA after S8, and an overview that disagrees with project state. User copy leaks governance jargon and internal IDs, primary actions are duplicated or disabled without explanation, and terminology is inconsistent across locales.

**Slot D — red-team effectiveness (`risk-officer`).** The controls exist as designs but not as gates. Kill criteria are never evaluated on the gate path, the six-validator engine is unwired, GO accepts a one-character rationale from a single user, waivers and `na` are unguarded, and WACC is never human-confirmed. Decision-quality evidence is absent (constant "B" data confidence, no proxy chains, no benchmark cases), and the demo seed proves only the happy path.

## Action wiring

`ticket.ts` is L0-only, so deferred items live in this report and the memory log rather than the ticket backlog.

### Proposed waves

| Wave | Theme | Items |
|---|---|---|
| W1 | Quick fixes, no ADR | H2, H3, H4, H10, M10, M11, M13, L1, L2, H1 scenario repair |
| W2 | Gate-integrity ADR | C1, C2, C3, H5, H6 (WACC confirmation), M16 |
| W3 | Process SSOT and decision evidence | H7, H8, H9, H11, M1–M9, M14–M15, M17 |

### Validator-hardening candidates (script-gap)

- Unresolved dotted-key runtime/lint check (i18n)
- Dev-jargon lint for locale files
- Engine-blocker to flow.spec parity test
- Stage-output ownership check
- `activity.agent` in procedure `agent_keys` check
- Checklist consumer check
- Reverse `decision_authority` human vs registry check
- Persona Can-Lead/Support vs flow.spec check
- Policy kill item to registry check
- Audit-token scan for write routes
- S2 entry-market input-declaration check

## Not verified

- Cross-user MNPI probes
- Payload-level contract parity (OpenAPI vs route behavior)
- Non-M&A brownfield sub-tracks
- S9 six-validator and S11 PMI tabs were not opened in the walkthrough
- Axe and locale-smoke scenarios were not part of the slot B run
- Production / tunnel environment
- English (`en`) runtime rendering
