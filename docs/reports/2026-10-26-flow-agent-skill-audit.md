# Flow S1-S12 Agent / Skill / Prompt Placement Audit

- Date: 2026-10-26
- Author: process-governance-manager (read-only audit, dispatched by PM)
- Scope: prompt text quality, agent placement fit, skill matching for every S1-S12 activity
- Status: PROPOSAL to the owner. No file other than this report was written. Every item marked "ADR" or "DEC" below is a proposal; nothing here changes a procedure, the flow spec, or a gate.
- Authority note (AGENTS.md section 7): `process/flow.spec.yaml` governs stage dispatch; `procedures/_shared/*/schema.yaml` governs within-procedure steps; `skills/*/SKILL.md` governs "how". Where this report finds a divergence between two authorities, it records the divergence and routes it to PM. It does not pick the convenient rule.

---

## 1. Method and surfaces checked

### 1.1 Surfaces

| Surface | Source read | Result |
|---|---|---|
| Flow activities | `process/flow.spec.yaml` v2.10.1, parsed with js-yaml | 12 stages, 47 activities |
| Gate ladder | `process/stages.yaml` | G1-G8 gate ladder (a different axis from S1-S12; used only for context) |
| Procedures | all `procedures/_shared/*/schema.yaml` (24 files), `procedures/regions/EU`, `procedures/_human-roles.yaml`, `procedures/_committees.yaml` | `agent_key` / `skill_key` extracted per step |
| Checklists | `checklists/brownfield-feasibility-checklist.yaml`, `ma-special-topics-checklist.yaml` | six-validator definition compared with procedure |
| Committee registry | `procedures/_committees.yaml` (2 committees), `app/web-next/lib/committee-agents.ts` (13 role templates), `committee-registry.generated.ts` | seats mapped |
| Review-domain seat | `app/web-next/lib/review/domains.ts` | AI-2nd-review personas (`platform-lead`, `industry-lead`, `region-lead`) |
| Prompt SSOT | `app/web-next/prompts/prompts.json` (39 prompts) -> `scripts/co-newbiz/generate-prompt-registry.ts` -> `prompts.generated.ts` | metadata for all 39, full text for 11 |
| PM catalog | `scripts/co-newbiz/generate-pm-catalog.ts` (joins prompts x flow.spec x agents) | prompt-to-activity mapping read from `prompts.json` `activity` field |
| Agents | `agents/*.md` (43 files: 41 agents + README files), "Can Lead Stages", `required_skills`, `agents/README.md` class table | |
| Skills | `skills/*/SKILL.md` (105), `skills/SKILLS.md`, frontmatter owner/status/description | usage computed per skill across flow / procedure / checklist / agent files |
| Runtime code | `app/web-next/lib`, `app/web-next/app`, `mcp`, `scripts/co-newbiz` grep for agent keys | used to classify "runtime prompt / UI owner label" usage |
| Standard | `docs/standards/llm-interaction-standard.md` section 2 (one action per sentence, defined terms, facts vs requirements) | applied to prompts |

### 1.2 How "usage" was classified

An agent or skill counts as used if it appears on ANY of: flow activity lead (F), procedure `agent_key` / `skill_key` (P), committee seat (C), runtime prompt owner (R), review-domain persona (D), UI/API owner label (U), or dev-axis B role (B).

### 1.3 Headline numbers

- 47 flow activities. 41 agents. 105 skills. 39 runtime prompts. 2 committees.
- Skills by usage: 44 attached to a flow activity; 22 used only by procedure steps; 39 referenced by neither (of which about 30 are dev/ops tooling).
- 14 skills are one-line stubs ("Skill referenced by flow.spec.yaml stage activities"), all status `experimental`, all owned by `process-governance-manager`.
- No agent is wholly dead. Every agent is used on at least one surface (section 5).

### 1.4 Correction to PM's preliminary inventory

PM's inventory is right that those agents lead no flow activity. It overstates the gap in two ways:

1. The six Brown Field M&A validators ARE wired into `brownfield-dd` (steps 6-11 plus compliance step 14). What is missing is flow-level visibility and one validator definition (finding F-1, F-2 below).
2. Of the 61 skills not attached to a flow activity, 22 are executed by procedure steps. They are in use. They are only absent from the `skills:` list of the flow activity that hosts the step.

---

## 2. Per-stage tables

Legend: Verdict `OK` / `adjust` (keep lead, change skills, prompt, or binding) / `replace` (change the lead or the skill).
Prompt column: key, or "none" when the activity has no runtime prompt. A prompt check covers structure (5-section skeleton, one-JSON output, Korean marker, proposal-only clause), sentence length, and the standard's facts-versus-requirements rule.

### Prompt text quality: overall result

I read 11 prompt bodies in full and ran a mechanical check on all 39 (length, JSON-output clause, sentence length).

- All 39 have prompt lengths of 0.8k-2.7k characters. None exceeds 25 words per sentence under the generator's own advisory heuristic.
- All 11 read in full follow the 5-section skeleton and the proposal-only clause, use one imperative per sentence, and separate evidence boundary from task.
- Quality is high and uniform. The findings are about key naming, agent binding, and activity mapping, not wording. The wording defects found are listed in finding F-9.

### S1 Market analysis (applies to both tracks)

| Activity | Lead | Skills | Prompt | Verdict | Proposal and reason |
|---|---|---|---|---|---|
| market-research | market-intelligence-agent | market-data-pipeline, proxy-industry-chain, systematic-market-sizing | s1.sizing_ask_json, s1.sizing_summarize, s1.ksic_classify | OK | Lead fits (agent description names S1 sizing and KSIC). Prompt keys match the stage. `market-data-pipeline` is a stub skill (F-6). `forward-industry-research` is run at S1 by this agent (greenfield-screening step 2.5) but is not attached here: attach it. `k-kosis` / `k-ecos` data connectors are not attached (F-7). |
| competitive-intelligence | market-intelligence-agent | competitive-intelligence | none | OK | Skill matches the activity. No runtime prompt is needed because the output is analyst-authored. |
| value-chain-analysis | market-intelligence-agent | value-chain-linkage-analysis, value-chain-stage-financials | market.related_candidates | adjust | Lead is right (the agent description says it owns the six-axis linkage analysis). The skill `value-chain-linkage-analysis` is owned by `quant-methodologist`, and `value-chain-stage-financials` is a PGM-owned stub. Move skill ownership to `market-intelligence-agent` (skill lifecycle, no ADR). Prompt key `market.related_candidates` has no stage prefix; acceptable. |

### S2 Opportunity discovery (both tracks)

| Activity | Lead | Skills | Prompt | Verdict | Proposal and reason |
|---|---|---|---|---|---|
| opportunity-discovery | market-intelligence-agent | insight-synthesis | s2.discover, s3.opportunity_factors | adjust | Lead fits. Prompt key `s3.opportunity_factors` produces the S2 opportunity/risk factors (purpose text says "S2"). The `s3.` prefix is a misleading legacy key. Rename to `s2.opportunity_factors` (prompts.json + generated registry + PM catalog + the one chain caller in `agent-chains.ts`). Cosmetic; DEC only. |
| business-model-sketch | greenfield-agent | scenario-planning | opportunity.sketch | OK | The agent description explicitly gives greenfield-agent the track-neutral S2 sketch. Brownfield opportunities are sketched by the same agent by documented design. `scenario-planning` is owned by `risk-officer`; acceptable as a shared method skill. |
| entry-market-sizing | market-intelligence-agent | systematic-market-sizing | s2.entry_market_draft | OK | Matches ADR-0180/0181. |

### S3 Synergy and strategic fit (both tracks)

| Activity | Lead | Skills | Prompt | Verdict | Proposal and reason |
|---|---|---|---|---|---|
| strategic-fit-screening | process-governance-manager | strategic-fit-screening, portfolio-fit-assessment | none mapped. `s3.capability_gap_draft` and `s3.attractiveness_recommendation` exist but have no `activity` mapping | adjust | Lead fits (PGM persona and flow). Two S3 prompts are unmapped in the PM catalog (finding F-8). Map `s3.capability_gap_draft` to this activity. Rebinding its agent from `risk-officer` to `process-governance-manager` is also proposed: a red-team seat drafting the required-capability register it later challenges weakens independence (design: red team holds no authorship). Treat as a DEC. |
| synergy-analysis | risk-officer | assumption-audit | s4.synergy_fa, s4.synergy_synergy, s4.synergy_ic | adjust | `risk-officer`'s own description assigns the S3 synergy score, so the lead stays. Problems: (1) prompt keys use the `s4.` prefix for an S3 activity; (2) `s4.synergy_fa` derives target strengths and weaknesses from financial data, which is analysis, not red-team work: bind that one prompt to `financial-analyst` (S3 already has `financial-analyst` as lead of `our-company-profile`); (3) the only skill, `assumption-audit`, is a stub with no triggers (F-6). |
| our-company-profile | financial-analyst | historical-financial-analysis, company-intelligence | company_profile.qualitative / .competitive / .crosscheck | OK | Placement matches DEC-20261025-05 s13.3. `company_profile.competitor_web_search` (market-intelligence-agent) has no activity mapping; map it here. `company-intelligence` is a PGM-owned stub; re-own to `market-intelligence-agent`. |

### S4 Route decision (both tracks)

| Activity | Lead | Skills | Prompt | Verdict | Proposal and reason |
|---|---|---|---|---|---|
| route-strategy | pm | deal-execution-playbook, jv-structuring, partner-sourcing-strategy | s4.route_recommendation | adjust | PM as runtime lead is a placeholder here, not a design: unlike route-advisory there is no deterministic engine behind it. All three skills belong to other owners (`deal-execution-playbook` PGM stub; `jv-structuring` and `partner-sourcing-strategy` partnership-agent). The track-neutral route proposal is a synthesis; keep `pm` as the gateway assembler only if the owner accepts that a runtime PM prompt is the intended synthesis surface (it is already the prompt owner), otherwise bind to `process-governance-manager`. Recommended: keep `pm` for the prompt, but record the intent in the spec comment, as route-advisory and charter-baseline already do. |
| deal-shape-evaluation | brownfield-agent | deal-execution-playbook | none (steps in deal-shape-chain) | OK | DEC-20261025-02 row 4 documents this. |
| route-advisory | pm | none | none (deterministic engine `track-advisory.ts`) | OK | Intended: the spec comment names the TypeScript engine. No skill is correct for a deterministic engine. |
| (invisible steps) | n/a | n/a | n/a | adjust | The S4 procedures run `wacc_hurdle_confirmed` (valuation-agent, `wacc-input-session`) and `certification_transferability_check` / `certification_roadmap_map` (certification-agent) with no flow activity. They are enforced by the procedure but invisible in the stepper. See proposal P-3. |

### S5 Own entry (greenfield only)

| Activity | Lead | Skills | Prompt | Verdict | Proposal and reason |
|---|---|---|---|---|---|
| capability-assessment | greenfield-agent | greenfield-feasibility, org-readiness-assessment | s5.capability_judgement_draft, s5.greenfield_recommendation | OK | Prompt and procedure agree. `org-readiness-assessment` is owned by `hr-integration-agent` but used by greenfield-agent; acceptable shared skill. |
| entry-strategy | greenfield-agent | scenario-planning, talent-pipeline-planning | s5.entry_strategy_draft | OK | Matches the Build/Partner/Hire/Invest resolution in the agent description. |
| business-case-lines | financial-analyst | investment-feasibility-modeling | none | OK | Skill owner is `valuation-agent`; shared use is documented. |

### S6 Target candidate discovery (brownfield only)

| Activity | Lead | Skills | Prompt | Verdict | Proposal and reason |
|---|---|---|---|---|---|
| target-universe-definition | brownfield-agent | brownfield-feasibility, competitive-intelligence | s6.universe_criteria_draft | OK | |
| target-longlist | market-intelligence-agent | company-intelligence, brownfield-feasibility | s6.target_proposal_web_search | OK | DEC-20261025-05 s13.3 gives the agent the S6 longlist. `brownfield-feasibility` is an umbrella skill attached 7 times across S6, S7, S9; consider whether the skill is too broad (finding F-6). |

### S7 Target selection (brownfield only)

| Activity | Lead | Skills | Prompt | Verdict | Proposal and reason |
|---|---|---|---|---|---|
| target-screening | brownfield-agent | brownfield-feasibility, strategic-fit-screening, peer-benchmarking | s7.screening_draft | OK | Prompt reviewed: one verdict scale, explicit "no not-applicable verdict", evidence citation required. Clean. |
| ownership-regulatory-screening | antitrust-agent | antitrust-screening, regulatory-screening | none | OK | |
| target-ranking | brownfield-agent | strategic-fit-screening, brownfield-feasibility | none | adjust | The procedure step 3 uses `peer-benchmarking`; the flow lists `strategic-fit-screening` and `brownfield-feasibility` and omits it. Align the flow skill list to the procedure (procedure is authoritative for what). |

### S8 Business case (both tracks)

| Activity | Lead | Skills | Prompt | Verdict | Proposal and reason |
|---|---|---|---|---|---|
| business-case-modeling | financial-analyst | growth-projection-modeling, investment-feasibility-modeling | s8.business_case_prose (agent null) | adjust | Procedure steps 6.6-7.96 by `financial-analyst` also use `peer-benchmarking`, `value-chain-stage-financials`, `target-costing-analysis`, `financial-statement-analysis`. Attach `target-costing-analysis` and `financial-statement-analysis`. Prompt `s8.business_case_prose` has `agent: null` and no activity mapping: acceptable as a dynamic prompt, but map it to this activity. |
| valuation | valuation-agent | dd-to-valuation-bridge, monte-carlo-simulation | s8.ev_band_recommend, s8.business_case_adoption | OK | `s8.business_case_adoption` has no activity mapping; map to `valuation` or to `target-selection` (see below). |
| quant-methods | quant-methodologist | wacc-input-session, monte-carlo-simulation | s8.price_evidence | adjust | The quant steps (`proxy-industry-chain`, `unit-conversion-calibration`, `value-chain-driver-identification`) run under this agent in both FS procedures but only `wacc-input-session` and `monte-carlo-simulation` are attached. Attach the three. `value-chain-driver-identification` is a PGM stub; re-own to `quant-methodologist`. |
| target-comparison | financial-analyst | investment-feasibility-modeling | none | OK | |
| target-selection | pm | none | none | adjust | The procedure step 2 (`brownfield-fs-comparative`) is `decision_authority: human` but its `agent_key` is `pm`, which is not in `_human-roles.yaml`. ADR-0053 intends a person-role key for a human decision step. Register a human role (for example `target-selector`) in the same change and let PM stay as the assembler of the gate proposal. This is the only PM-led activity where a person-role fits better than an AI key. |

### S9 Due diligence (both tracks; brownfield-dd adds the M&A validators)

| Activity | Lead | Skills | Prompt | Verdict | Proposal and reason |
|---|---|---|---|---|---|
| commercial-dd | commercial-dd-agent | commercial-due-diligence | none | OK | |
| technical-dd | technical-dd-agent | technical-due-diligence, site-infrastructure-assessment | s9.dd_tailor | adjust | The greenfield-dd step 1 uses `site-visit-protocol` (owner technical-dd-agent) and it is not attached. Attach. `s9.dd_tailor` tailors checklists for all DD types by industry; it is bound to technical-dd-agent only because the activity mapping needs one agent. Acceptable; noted in F-8. |
| legal-dd | legal-counsel | legal-due-diligence, regulatory-screening | none | OK | |
| financial-dd | financial-analyst | quality-of-earnings, historical-financial-analysis | none | OK | |
| hr-dd | hr-integration-agent | org-readiness-assessment, talent-pipeline-planning | none | adjust | Brownfield steps 7 and 13 use `management-incentive-review`, `compensation-harmonization-analysis`, and `org-readiness-assessment`. Attach the first two. `management-incentive-review` is owned by `incentive-agent` but the agent description of `hr-integration-agent` ("executive compensation review") is the true owner: transfer skill ownership. |
| market-dd | market-intelligence-agent | competitive-intelligence | none | OK | |
| financing-dd | financing-agent | none | none | adjust | The agent has `required_skills: []` yet runs `financing-plan-review` in procedures (greenfield-execution-baseline step 1). Attach `financing-plan-review` here and add it to the agent's required skills (the skill owner `valuation-agent` also uses it at S10). |
| dd-waiver-review | compliance-officer | waiver-management | none | OK | `waiver-management` is a PGM-owned stub; re-own to `compliance-officer`. |
| capability-dd | brownfield-agent | brownfield-feasibility | none | OK | Added by v2.10.0 with a design doc. |
| (missing activities) | n/a | n/a | n/a | adjust | Four of the six mandatory M&A validators and their owners (antitrust step 6, customer-retention step 8, incentive step 9, contingent-liability step 10, certification step 11) have no flow activity. See F-1 and P-1. |

### S10 Investment structure design (both tracks)

| Activity | Lead | Skills | Prompt | Verdict | Proposal and reason |
|---|---|---|---|---|---|
| deal-structure-hypothesis | brownfield-agent | investment-vehicle-structuring | s8.deal_structure_recommendation | adjust | Greenfield step 4 of `deal-structuring` is carried by `greenfield-agent`; spec comment documents this. Prompt key uses the `s8.` prefix for an S10 activity; rename to `s10.deal_structure_recommendation`. |
| financing-plan | valuation-agent | financing-plan-review | none | OK | Procedure step 3 is `valuation-agent`; step 5 is `financing-agent`. Dual ownership is documented in `financing-agent`'s description (co-review). |
| (missing) | n/a | n/a | s10.site_regulatory_draft (legal-counsel, no activity) | adjust | The prompt and a Sites UI exist at S10 but no activity hosts site/facility work, and `deal-structuring` step 7 (incentive-agent) is invisible. See P-4. |

### S11 Investment review and execution (both tracks)

| Activity | Lead | Skills | Prompt | Verdict | Proposal and reason |
|---|---|---|---|---|---|
| ic-preparation | pm | executive-presentation, sample-driven-report-writing | s11.report_narration, s11.integrated_insight | OK | PM as assembler of the IC package is intended. `s11.integrated_insight` is the one documented DUAL_ASSIGNMENT (PGM prompt on a PM-led activity). The deck steps (4.5/4.6) are owned by `docs-writer` (see F-10). |
| charter-baseline | pm | none | none | OK | Intended: assembly engine `project-charter.ts`, named in the spec comment. |
| investment-structuring | brownfield-agent | none | none | OK | DEC-20261025-02 (K) keeps this assignment; greenfield co-review is a procedure contract (not machine-enforced). |
| risk-review | risk-officer | legal-risk-register | none | adjust | The step that proposes the RAG grade (`entity-ic-review` step 1) uses `rag-scoring-framework` and it is not attached here. Attach. `legal-risk-register` is a PGM-owned stub; re-own to `risk-officer`. |
| group-review | group-review-agent | group-level-review | none | OK | `group-level-review` is a PGM-owned stub; re-own to `group-review-agent`. |
| entity-establishment-execution | process-governance-manager | legal-due-diligence, k-law, certification-transferability, org-readiness-assessment, stage-gate-governance | none | adjust | Steps 1-3 are `legal-counsel`, step 4 is `hr-integration-agent`, only step 5 (gate record) is PGM. The skill list is the union of other agents' skills. PGM leads by persona and ADR-0047, so the lead is defensible; the persona ("execute S11 establishment") overstates PGM's share. Option: keep PGM as lead and edit the persona to "coordinate and close". A change of lead would be a procedure and persona change (ADR). |
| pmi-kickoff | pmi-agent | pmi-planning | none | OK | |
| greenfield-execution-baseline | greenfield-agent | none | none | adjust | Steps 1-5 use `financing-plan-review`, `certification-roadmap`, `talent-pipeline-planning`, `greenfield-feasibility`, `incentive-clawback-assessment` (three other agents). Attach the greenfield-agent's own two skills, as `entity-establishment-execution` already does for its union. |

### S12 Post-investment management (both tracks)

| Activity | Lead | Skills | Prompt | Verdict | Proposal and reason |
|---|---|---|---|---|---|
| portfolio-monitoring | group-review-agent | portfolio-fit-assessment | s11.monitoring_brief | adjust | Prompt key says `s11.`, activity is S12; rename to `s12.monitoring_brief`. `s12.milestone_suggest` (PGM) has no activity mapping; map here. Its body states "greenfield is research and development based commercialization", which is a stipulated fact inside an instruction (F-9). |
| integration-monitoring | pmi-agent | pmi-planning | none | OK | |
| partnership-monitoring | partnership-agent | none | none | replace (skill) | The procedure steps behind it (`jv-lifecycle-governance` step 2, `deal-shape-chain` step 6) use the dev-tooling skill `project-review` to produce a partnership health scorecard. A repo-review skill is the wrong tool for a deal artifact. See P-6. |

### Verdict counts (47 activities)

| Verdict | Count |
|---|---|
| OK | 29 |
| adjust | 17 |
| replace (skill binding) | 1 |
| replace (agent) | 0 |

No agent replacement is justified for any activity. Every lead either fits or is a documented, intentional assignment.

---

## 3. Cross-cutting findings, ranked by severity

### F-1 (HIGH) The "six mandatory M&A validators" are defined three different ways

| Authority | The six |
|---|---|
| Project CLAUDE.md and `checklists/brownfield-feasibility-checklist.yaml` bf-01 (non-waivable) | antitrust, customer-retention, incentive, hr-integration, certification transferability, **region-lead labor review** |
| `procedures/_shared/brownfield-dd` step 14 (the system-enforced completeness check) | antitrust, HR, customer, incentive, **contingent-liability**, certification |
| `checklists/ma-special-topics-checklist.yaml` ma-01..ma-12 | antitrust, exec comp/HR, customer, incentive, contingent liability, certification (no region-lead item) |

Evidence: `region-lead` appears in no `brownfield-dd` step. It appears only in the EU `brownfield-screening` override (step 2.5, works council), which feeds hr-integration. So the checklist item bf-01 asks for a validator that the procedure never runs, and the procedure enforces a validator (contingent liability) that bf-01 does not name. Because bf-01 carries `waiver_eligible: false` and the procedure carries a kill criterion with no waiver path, a project could be blocked by an item no step produces, or pass an item bf-01 never lists.

Per AGENTS.md section 7 this is a defect to reconcile through a recorded decision. Two options for the owner:
- (A) Add a `region-lead` labor-review step to `brownfield-dd` (feeding hr steps 7 and 13) and make the procedure's declared count consistent with bf-01.
- (B) Amend bf-01 and CLAUDE.md to name contingent liability as the sixth and keep region labor as an hr input.
Needs: ADR (procedure and checklist change) plus policy impact analysis and `project_policy_pin` check for in-flight projects.

### F-2 (HIGH) Flow-level S9 omits five validator-carrying agents

`customer-retention-agent`, `incentive-agent`, `antitrust-agent` (at S9), `certification-agent`, and `valuation-agent` (contingent-liability step 10) execute brownfield-dd steps but have no S9 activity. The stepper, activity cards, and the PM catalog (which joins prompts to flow activities) never show them. Enforcement lives in procedure step 14, so this is a visibility and routing gap, not an enforcement gap. The UI already has pages for these validators (`customer-coc`, `incentives`, `permits`, `comp-parity`), which confirms the work is expected.

### F-3 (HIGH) Skill misbinding in certification steps (design boundary 5)

`brownfield-pre-fs` step 3 and `greenfield-pre-fs` step 5 (and `business-unit-establishment-execution` step 3) produce `certification_transferability_check` with `skill_key: permit-pathway-mapping`. That skill is a permit skill; `certification-transferability` exists (owner `legal-counsel`) and its description says inference is disallowed. Boundary 5 says permits and certifications are managed separately. Fix: point step 3 / step 5 at `certification-transferability` (brownfield), and for greenfield step 5 either the same skill or keep not-applicable. Needs ADR (procedure change). The BU-establishment step uses `legal-counsel` with the same skill; fix together.

### F-4 (MEDIUM) Skill ownership is incoherent for 14 stubs and several domain skills

- 14 skills are one-line stubs with `status: experimental`, a generic description, and no triggers, all owned by PGM: assumption-audit, company-intelligence, deal-execution-playbook, forward-industry-research, group-level-review, legal-risk-register, policy-and-procedure-governance, market-data-pipeline, regulatory-screening, sample-driven-report-writing, target-costing-analysis, value-chain-stage-financials, value-chain-driver-identification, waiver-management. Eleven of them are attached to flow activities.
- The natural owner is usually another agent (waiver-management -> compliance-officer; assumption-audit and legal-risk-register -> risk-officer; group-level-review -> group-review-agent; company-intelligence, market-data-pipeline, forward-industry-research -> market-intelligence-agent; target-costing-analysis, value-chain-driver-identification -> quant-methodologist; deal-execution-playbook -> brownfield-agent).
- `management-incentive-review` (exec comp) is owned by `incentive-agent` but run by `hr-integration-agent`; `community-partnership-planning` is owned by `hr-integration-agent` but run by `greenfield-agent`; `value-chain-linkage-analysis` is owned by `quant-methodologist` but run by `market-intelligence-agent`.
- Five skills name an owner that is not in this roster: `k-dart`, `k-law` (strategy-analyst), `k-opendata` (hs-classification-specialist), `zod-contract-gate`, `design-foundation` (architect). `k-law` is attached to an S11 activity and to two procedures.
The skill-existence bar (distinct trigger + owner + non-trivial artifact) is not met by the stubs as written.

### F-5 (MEDIUM) A dev-tooling skill is bound to deal procedure steps

`project-review` (owner pm; a repository review skill) is the `skill_key` for `portfolio-venture-monitoring` step 2, `deal-shape-chain` step 6, and `jv-lifecycle-governance` step 2. The produced artifacts are `venture_transition_evidence`, `alliance_post_launch_review`, `jv_health_scorecard`. These are deal artifacts; the skill's trigger text is about codebase review.

### F-6 (MEDIUM) Flow `skills:` lists lag the procedures

22 skills are used only by procedure steps (customer-attrition-risk, certification-roadmap, compensation-harmonization-analysis, incentive-clawback-assessment, management-incentive-review, debt-and-contingent-liability-simulation, permit-pathway-mapping, regional-incentive-sourcing, partner-due-diligence, site-visit-protocol, rag-scoring-framework, unit-conversion-calibration, value-chain-driver-identification, target-costing-analysis, financial-statement-analysis, forward-industry-research, community-partnership-planning, compliance-monitoring, intra-group-transaction-compliance, two-tier-approval-chain, policy-and-procedure-governance, project-review). Seven activities with no skill are listed in the stage plan: route-advisory (intended), target-selection, financing-dd, charter-baseline (intended), investment-structuring, greenfield-execution-baseline, partnership-monitoring. Three of the seven need a skill (financing-dd, greenfield-execution-baseline, partnership-monitoring); two are engines or human-decision assembly (route-advisory, charter-baseline); two are documented pass-through (investment-structuring, target-selection).

### F-7 (MEDIUM) Data-connector skills are attached nowhere

`k-dart`, `k-ecos`, `k-kosis`, `k-krx`, `k-opendata` are referenced by no activity, procedure, or checklist. `financial-analyst` lists k-ecos, k-kosis, k-krx in `required_skills` but not `k-dart`, although DART collection is core (`scripts/co-newbiz/dart-collect.ts`). Unverified whether the spec validator accepts `scope: common` skills in an activity `skills:` list.

### F-8 (LOW-MEDIUM) Prompt catalog drift

- 12 of 39 prompts have no `activity` mapping: `s3.attractiveness_recommendation`, `s3.capability_gap_draft`, `opportunity.gate_brief`, `project.gate_brief`, `s8.business_case_prose`, `s8.business_case_adoption`, `pm.query_classify`, `committee.position`, `company_profile.competitor_web_search`, `s10.site_regulatory_draft`, `s12.milestone_suggest`, `pm.flow_suggest`. (`pm.*`, `committee.position`, and the two `gate_brief` prompts are legitimately cross-stage.) Of these, 6 are real stage work and should be mapped: `s3.capability_gap_draft`, `s3.attractiveness_recommendation`, `s8.business_case_prose`, `s8.business_case_adoption`, `company_profile.competitor_web_search`, `s12.milestone_suggest`.
- Stage-prefix mismatches in keys: `s3.opportunity_factors` (S2), `s4.synergy_*` (S3), `s8.deal_structure_recommendation` (S10), `s11.monitoring_brief` (S12), `s10.site_regulatory_draft` (no S10 site activity).
- Two prompts have `agent: null` (`s8.business_case_prose`, `committee.position`): dynamic by design, documented in the PM catalog.

### F-9 (LOW) Wording findings against the LLM Interaction Standard

- `s12.milestone_suggest` embeds a definition of the two tracks ("greenfield is research and development based commercialization, and brownfield is M&A due diligence and post-merger integration") inside the instruction. This mixes a stipulated fact into a requirement (standard 2.6) and is arguably wrong for greenfield. Move the track description into the user message's evidence block, using the glossary term.
- `s12.milestone_suggest` category vocabulary (permit, certification, capex, contract, custom) has no integration or pmi category although brownfield is in scope. Add the category or state that brownfield milestones are out of scope.
- `s4.synergy_fa` opens with two imperative sentences that differ by one word ("Derive the financial and business strengths... Derive the financial and business weaknesses."). Combine into one action with two outputs, or keep as is for sentence-length reasons. Minor.
- Otherwise the prompts meet the standard: one action per sentence, defined output contract, uncertainty marker pinned, proposal-only clause.

### F-10 (LOW) Agent README class table is stale for two agents

`docs-writer` is classed "Non-deal support, outside deal review" and "not dispatched through flow.spec stages", yet it is the `agent_key` of two deal procedure steps (`entity-ic-review` 4.6, `group-investment-review` 4.5). `site-facility-agent` is described as "lead consultation lane for site selection" but holds no procedure step and no flow activity, only committee seats and the Sites UI. Update the class table counts after the wiring decisions below.

### F-11 (LOW) Persona drift: gate assembly

The PGM persona says it owns "Gate Assembly and RAG Grade Proposals". The procedure assigns the RAG proposal step to `risk-officer` (entity-ic-review step 1) and PGM only the kill-criteria check (step 2) and gate record. Persona sync only (agents/ is generated from AGENTS.md; follow the persona-sync script).

---

## 4. Proposed changes

Authority and ADR column: **ADR** = touches `procedures/**`, `checklists/**`, `policies/**`, the human-role registry, or changes what a gate requires (lifecycle rule). **DEC** = flow.spec metadata-only or prompt/catalog change that needs a recorded decision and a flow.spec version bump but changes no stage/gate/track structure (precedent: v2.10.1). **Skill LC** = skill lifecycle only (agent-lifecycle-manager / skill-lifecycle-manager), no ADR.

### 4.1 Agent swaps and bindings

| # | Change | Reason | Needs |
|---|---|---|---|
| A-1 | Add `region-lead` labor-review step to `brownfield-dd`, or amend bf-01 / CLAUDE.md (F-1) | Make the six validators one definition | ADR |
| A-2 | Wire `site-facility-agent` as `agent_key` of `greenfield-screening` step 3 (site shortlist), `greenfield-pre-fs` step 3 (infra lead time/cost) | Agent exists to do site selection; today the steps are `greenfield-agent`. Currently the agent is committee-seat plus UI only. | ADR |
| A-3 | Wire `ip-agent` as `agent_key` of an R&BD-only DD step (applies_when `technology_track: rbd`), taking the IP/FTO part of `brownfield-dd` step 3 | Step 3 asks `technical-dd-agent` for IP/FTO; the dedicated agent is committee-only today | ADR |
| A-4 | Rebind prompt `s4.synergy_fa` to `financial-analyst`; rebind `s3.capability_gap_draft` to `process-governance-manager` | Red-team independence; financial analysis belongs to the analyst | DEC |
| A-5 | Register a human role for the S8 target-selection decision (for example `target-selector`) and use it as the `agent_key` of `brownfield-fs-comparative` step 2 | ADR-0053: a human decision step should carry a person-role key; `pm` is an AI agent | ADR |
| A-6 | Keep `pm` as lead for `route-strategy`, `route-advisory`, `target-selection`, `ic-preparation`, `charter-baseline`, recording the intent in the spec comments for `route-strategy` and `target-selection` | `route-advisory`, `charter-baseline` have named engines (intended). `route-strategy` and `target-selection` were placeholders without a stated rationale. | DEC (comment only) |
| A-7 | No change of lead for `entity-establishment-execution`; edit the PGM persona wording to "coordinate and close" | Procedure shows PGM owns 1 of 5 steps | persona sync |

### 4.2 Flow activity additions (visibility)

| # | Change | Reason | Needs |
|---|---|---|---|
| P-1 | Add brownfield S9 activities: `antitrust-dd` (antitrust-agent, antitrust-screening), `customer-retention-dd` (customer-retention-agent, customer-attrition-risk), `incentive-dd` (incentive-agent, incentive-clawback-assessment), `contingent-liability-dd` (valuation-agent, debt-and-contingent-liability-simulation), `certification-transferability-dd` (legal-counsel, certification-transferability), and `region-labor-review` (region-lead, regulatory-screening) if option A of F-1 is chosen. Procedure: `[brownfield-dd]` only, as `capability-dd` already does. | F-2: precedent v2.10.0 | DEC with design doc; ADR if F-1 changes the procedure |
| P-3 | Add S4 activities `wacc-hurdle-confirmation` (valuation-agent, wacc-input-session) and `certification-screen` (certification-agent, certification-roadmap, certification-transferability) | Procedure steps already run at S4 but are invisible | DEC |
| P-4 | Add an S10 `site-facility-assessment` activity (site-facility-agent, site-infrastructure-assessment) and map `s10.site_regulatory_draft` to it | Prompt and UI exist; no activity hosts them | DEC |
| P-5 | Align `skills:` lists to procedure usage (S7 target-ranking: add peer-benchmarking; S8 quant-methods: add proxy-industry-chain, unit-conversion-calibration, value-chain-driver-identification; S8 business-case-modeling: add target-costing-analysis, financial-statement-analysis; S9 technical-dd: add site-visit-protocol; S9 hr-dd: add management-incentive-review, compensation-harmonization-analysis; S9 financing-dd: add financing-plan-review; S11 risk-review: add rag-scoring-framework; S11 greenfield-execution-baseline: add greenfield-feasibility, talent-pipeline-planning; S1 market-research: add forward-industry-research; S12 partnership-monitoring: add the new skill in P-6) | F-6 | DEC |

### 4.3 Skill attach / detach / re-own

| # | Change | Needs |
|---|---|---|
| S-1 | Re-point `certification_transferability_check` steps (brownfield-pre-fs 3, greenfield-pre-fs 5, BU-establishment 3) from `permit-pathway-mapping` to `certification-transferability` (F-3) | ADR |
| S-2 | Re-point `project-review` bindings (F-5): `portfolio-venture-monitoring` step 2 -> `portfolio-fit-assessment`; `deal-shape-chain` step 6 and `jv-lifecycle-governance` step 2 -> new skill N-1 | ADR |
| S-3 | Re-own stubs (F-4): waiver-management -> compliance-officer; assumption-audit, legal-risk-register -> risk-officer; group-level-review -> group-review-agent; company-intelligence, market-data-pipeline, forward-industry-research -> market-intelligence-agent; target-costing-analysis, value-chain-driver-identification -> quant-methodologist; deal-execution-playbook -> brownfield-agent; management-incentive-review -> hr-integration-agent; value-chain-linkage-analysis -> market-intelligence-agent; community-partnership-planning -> greenfield-agent; k-law -> legal-counsel; k-dart -> financial-analyst; k-opendata -> quant-methodologist | Skill LC |
| S-4 | Rewrite the 14 stub descriptions with real triggers or demote them (status stays `experimental` until the bar is met) | Skill LC |
| S-5 | Add `k-dart` to `financial-analyst` required skills; attach `k-kosis`/`k-ecos` to S1 `market-research`, `k-ecos`/`k-krx` to S8 `quant-methods` after confirming the spec validator accepts them | DEC (verify validator first) |
| S-6 | Add `financing-plan-review` to `financing-agent` required skills | Skill LC |

### 4.4 New agents and skills (apply the skill-existence bar)

- **New agents: none proposed.** Every gap found is solved by wiring an existing agent (site-facility-agent, ip-agent, region-lead, certification-agent, customer-retention-agent, incentive-agent). One watch item: the four-axis review includes a tax axis with no dedicated owner (spread over brownfield-agent, legal-counsel, and valuation-agent). Evidence of failure is absent, so no hire is proposed.
- **N-1 new skill: `partnership-health-scorecard`.** Distinct trigger ("partnership health scorecard", "alliance post-launch review", "JV health review"); owner `partnership-agent` (its description already names the S12 scorecard); non-trivial artifacts `jv_health_scorecard` and `alliance_post_launch_review`. It replaces the misbound `project-review`. No other existing skill covers it (`portfolio-fit-assessment` is group-level; `jv-structuring` is structuring, not health monitoring). Apply via skill-lifecycle-manager; the procedure re-point is under S-2.

### 4.5 Prompt changes

| # | Change | Needs |
|---|---|---|
| R-1 | Rename keys: `s3.opportunity_factors` -> `s2.opportunity_factors`; `s4.synergy_*` -> `s3.synergy_*`; `s8.deal_structure_recommendation` -> `s10.deal_structure_recommendation`; `s11.monitoring_brief` -> `s12.monitoring_brief` (prompts.json, regenerate registry and PM catalog, update callers) | DEC |
| R-2 | Map the six stage prompts listed in F-8 to their activities | DEC |
| R-3 | Move the track definitions out of the `s12.milestone_suggest` instruction into the user message; add or exclude the integration category (F-9) | DEC |

### 4.6 ADR summary

| ADR required (procedure / checklist / role registry) | DEC only (flow.spec metadata, prompts) | Skill lifecycle only |
|---|---|---|
| A-1, A-2, A-3, A-5, S-1, S-2 (batch all procedure changes in one ADR "placement realignment" plus F-1 reconciliation); P-1 if it adds a region-lead step | A-4, A-6, P-1 (activities only), P-3, P-4, P-5, S-5, R-1, R-2, R-3 | S-3, S-4, S-6, N-1 creation |

Persona edits (A-7, F-11) go through the persona sync script.

---

## 5. Unused agents and skills

### 5.1 Agents (22 from PM's list, plus PM's note on committee/runtime)

Classes: (a) used elsewhere, keep; (b) dev/ops axis B, keep; (c) should be wired into the flow; (d) redundant, merge; (e) dead, deprecate through agent-lifecycle-manager.

| Agent | Surfaces found | Class | Recommendation |
|---|---|---|---|
| release-engineer | none in deal flow; `sync` skill | (b) | Keep. Axis B build/run (agents/README). |
| dba | none | (b) | Keep. |
| data-architect | none | (b) | Keep. |
| backend-engineer | none | (b) | Keep. |
| frontend-engineer | none | (b) | Keep. |
| sre | none | (b) | Keep. |
| infra-automation-engineer | none | (b) | Keep. |
| security-engineer | none | (b) | Keep. |
| design-system-agent | design-lint tooling; flows UI label | (b) | Keep. |
| ux-designer-agent | onboarding UI label | (b) | Keep. |
| i18n-specialist | i18n skills | (b) | Keep (shared). |
| platform-lead | `review/domains.ts` AI-2nd-review persona for the technical domain | (a) + (b) | Keep. Not procedure-dispatched by design. |
| industry-lead | committee seat (2), review-domain persona | (a) | Keep. Profile-driven, no step by design. |
| region-lead | committee seat (2), review-domain persona, EU override step 2.5 | (a) + (c) | Keep. Wire the labor review (A-1) if F-1 option A is chosen. |
| site-facility-agent | committee seat (2), Sites UI/API | (c) | Wire to greenfield-screening step 3 and pre-fs step 3 (A-2, P-4). |
| ir-agent | committee seat only | (a) | Keep; the seat has a role template. Do not invent a step. Revisit when a listed-company target or MNPI-sensitive IC package is run. |
| ip-agent | committee seat only | (c) | Wire to an R&BD-only DD step (A-3). |
| certification-agent | 3 procedure steps, pm-router rule, permits UI | (a) + (c) | Keep. Fix skill binding (S-1). Add S4 activity (P-3). |
| customer-retention-agent | brownfield-dd step 8, customer-coc UI | (a) + (c) | Keep. Add S9 activity (P-1). |
| incentive-agent | 3 procedure steps, incentives UI | (a) + (c) | Keep. Add S9 activity (P-1). Keep scope to incentives and clawback after skill re-own. |
| glossary-curator | glossary API, lint | (a) | Keep. Non-deal support. |
| docs-writer | 2 procedure steps, ic-review-steps.ts | (a) | Keep. Update README class table (F-10). |

Counts (22 agents): (a) only = 4 (ir-agent, glossary-curator, docs-writer, industry-lead); (a)+(c) = 4 (region-lead, certification-agent, customer-retention-agent, incentive-agent); (a)+(b) = 1 (platform-lead); (b) only = 11; (c) only = 2 (site-facility-agent, ip-agent); (d) = 0; (e) = 0.

Overlaps examined and not merged: `hr-integration-agent` vs `incentive-agent` on executive compensation (resolve by skill ownership, S-3); `certification-agent` vs `legal-counsel` on transferability (screening versus judgment: `certification-agent` description already defers judgment to `legal-counsel`); `financing-agent` vs `valuation-agent` on financing plan (documented dual).

### 5.2 Skills (105 total)

| Group | Count | Class | Recommendation |
|---|---|---|---|
| Attached to a flow activity | 44 | (a) | Keep. Stubs (14, F-4) need real descriptions. |
| Procedure-only (22) | 22 | (a) | Keep. Attach to the hosting activity (P-5). `project-review` is the exception: re-point (S-2), keep for its dev use. |
| `k-dart`, `k-ecos`, `k-kosis`, `k-krx`, `k-opendata` | 5 | (c) | Attach to data-collection activities (S-5) and fix owners. |
| `evidence-ledger`, `decision-record`, `research-analysis`, `meeting-facilitation` | 4 | (c) candidate | Process-support skills with deal relevance (evidence for gate rulings, committee sessions). Candidates to attach to gate-assembly steps and the committee procedure. Verify trigger overlap with `stage-gate-governance` and `two-tier-approval-chain` before wiring (not verified). |
| Dev/ops tooling: script-lifecycle-manager, skill-lifecycle-manager, agent-lifecycle-manager, platform-command-lifecycle-manager, platform-skill-lifecycle-manager, team-builder, gateguard, finishing-a-development-branch, source-command-commit-push-pr, sync, ci-triage, security-scan, update-bun-packages, token-usage-lint, standup-synthesizer, handbook, handbook-sync-audit, zod-contract-gate, api-documentation, service-design, accessibility-audit, design-foundation, ui-ux-design-intelligence, i18n-audit, i18n-formatting, i18n-layout, i18n-locale-config, translate, documentation-writing, explain-me | 30 | (b) | Keep outside deal flow by design. Re-own `zod-contract-gate` and `design-foundation` (owner `architect` not in this roster). |
| Redundancy candidates | 3 | (d) candidate | `source-command-commit-push-pr` vs `sync` (both redirect commit/push/PR); `documentation-writing` vs `sample-driven-report-writing` (both report/document writing, different owners); `explain-me` (experimental since 2026-08, owner pm, no user). Recommend a trigger-overlap review through skill-lifecycle-manager before any merge. Not verified at body level. |
| Dead | 0 | (e) | None proven dead. |

### 5.3 Overall policy recommendation

1. Treat "used" as any of seven surfaces, not flow.spec alone. A dev-axis agent or skill is not unused.
2. A flow activity's `skills:` list SHOULD be the union of the `skill_key` values of the procedure steps it hosts (precedent: `entity-establishment-execution`). Add a validator check to `procedures/_validate.ts` or `generate-spec-activities.ts` that warns when a hosted step's skill is absent from the activity list.
3. A skill's owner MUST be an agent that exists in the roster and SHOULD be the agent whose description claims the artifact. Add this to the skill lifecycle check.
4. Never hard-delete. A candidate for removal goes through `agent-lifecycle-manager` / `skill-lifecycle-manager` with a deprecation record. Nothing in this audit meets that bar today.
5. Do not hire an agent to close a visibility gap. Add an activity to the flow instead.

---

## 6. What could not be verified

- I did not run `procedures/_validate.ts`, `generate-pm-catalog.ts --check`, or the unit tests. All counts come from direct file reads and scripts I ran against the files.
- I read the full text of 11 of 39 prompts. For the other 28 I checked metadata, length, JSON-output clause, and sentence length only. The user-message templates (the second half of each prompt call) live in application code and were not reviewed.
- Prompt-to-activity mapping was taken from `prompts.json` (`activity` field). The generated PM catalog could not be imported by a script I tried, so I did not read the generated file's entries directly.
- I did not read every skill body. Skill descriptions, owners, and statuses came from frontmatter. Trigger overlap between `evidence-ledger`, `decision-record`, `stage-gate-governance` and between `source-command-commit-push-pr` and `sync` is not tested.
- I did not open `docs/designs/*` or `docs/decisions/*` beyond a grep. Whether the origin of "region-lead labor review" (design v1.0 section 6.7, meeting M5 D-M5-4) was intentionally narrowed to an hr input is not established; F-1 therefore lists both options.
- I did not check whether the spec validator accepts a `scope: common` skill (the k-* family) in an activity `skills:` list.
- Runtime behavior of the committee deterministic role templates and of the UI pages (customer-coc, incentives, permits, comp-parity, sites) was inferred from file headers and grep, not exercised.
- I did not inspect the database. Whether in-flight projects pinned to a policy version are affected by the procedure changes in section 4.6 needs the `project_policy_pin` check named in the lifecycle rules.
- The statement "no ADR is needed for flow.spec-only changes" is based on precedent (v2.10.0 and v2.10.1 headers). The owner or `compliance-officer` should confirm for each item.
- The business-unit-establishment procedure is intentionally not listed under S11 (spec comment at line 761, ADR-0167). I treated this as intended and did not review it further.
- No emoji or Korean text was added. Korean prompt markers were quoted only where needed.
