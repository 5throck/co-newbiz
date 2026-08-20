# SKILLS.md — Skill Lifecycle Registry

> Single Source of Truth for all project skills in `skills/`.  
> Propagation control is via SKILL.md frontmatter (`l2_propagate`/`scope`) — not this file.  
> Platform skills (`.claude/skills/`, `.gemini/skills/`) are tracked by `verify-platform-lifecycle.ts` — not here.  
> Machine parsing: `layer-filter.ts` reads each skill's `SKILL.md` frontmatter directly.  
> **L0+L1+L2 skills** are variant-specific overrides living in `templates/co-*/skills/` — NOT published to `templates/common/skills/`.

---

## Registry

### Workspace Skills

Skills with a `skills/<name>/` directory in the workspace root. These are the primary skills available across all platforms.

| skill | version | status | owner | last_reviewed | removal-date | notes |
|-------|---------|--------|-------|---------------|--------------|-------|
| `agent-lifecycle-manager` | 1.0.0 | active | pm | 2026-05-30 | — | — |
| `audit-workspace` | 1.0.0 | active | auditor | 2026-05-30 | — | — |
| `create-variant` | 1.0.1 | active | pm | 2026-06-05 | — | Workspace operator only — not deployed to L2 |
| `meeting-facilitation` | 1.4.0 | active | pm | 2026-06-05 | — | — |
| `project-review` | 1.1.0 | active | pm | 2026-07-10 | — | — |
| `promote-variant` | 1.0.1 | active | pm | 2026-06-05 | — | Workspace operator only — not deployed to L2 |
| `script-lifecycle-manager` | 1.2.0 | active | pm | 2026-05-30 | — | — |
| `security-scan` | 1.0.0 | active | pm | 2026-07-19 | — | Reassigned from security-expert — not defined in templates/common/agents/ or any variant, caused orphan on every propagated variant |
| `simulate-project-creation` | 1.0.0 | active | scaffolding-expert | 2026-05-30 | — | Workspace scaffolding test only |
| `skill-lifecycle-manager` | 1.2.0 | active | pm | 2026-05-30 | — | — |
| `sync` | 1.1.0 | active | pm | 2026-07-19 | — | Full project sync pipeline — lifecycle, audit, publish, commit, push, PR. Reassigned from lifecycle-manager — same orphan cause as security-scan |
| `team-builder` | 1.1.0 | active | pm | 2026-06-06 | — | — |
| `translate` | 1.0.0 | active | pm | 2026-06-06 | — | — |
| `validate-docs-links` | 1.0.0 | active | pm | 2026-07-19 | — | Reassigned from docs-writer — same orphan cause as security-scan |
| `project-to-variant` | 1.0.0 | active | scaffolding-expert | 2026-07-31 | — | Convert existing standalone project into official variant template |
| `upgrade-project` | 1.1.0 | active | pm | 2026-07-31 | — | Upgrade existing L2/L3 project to current template version |
| `variant-feature` | 1.0.0 | active | scaffolding-expert | 2026-07-31 | — | Add features (agents, skills, scripts, docs) to existing variant |
| `ticket-run` | 1.0.0 | active | automation-engineer | 2026-07-16 | — | Pulls next waiting service ticket from Phase A queue |
| `explain-me` | 1.0.0 | experimental | pm | 2026-08-03 | — | Single-file interactive HTML report generation. Inspired by beret21/reportme (MIT). Korean loanword data in references/loanword-refinements.json |
| `zod-contract-gate` | 1.0.0 | active | architect | 2026-08-06 | — | Defines Zod runtime schema validation patterns and contract safety rules |
| `presenter-mode` | 1.0.0 | active | presentation-architect | 2026-08-06 | — | Dual-window presenter state synchronization using browser BroadcastChannel API |
| `stride-threat-matrix` | 1.0.0 | active | security-expert | 2026-08-06 | — | Automated STRIDE threat matrix generation and DREAD risk scoring framework |
| `sarif-exporter` | 1.0.0 | active | security-expert | 2026-08-06 | — | Exports security scan results, threat matrices, and vulnerability findings into standard SARIF v2.1.0 JSON format |
| `accessibility-audit` | 1.0.0 | active | pm | 2026-08-06 | — | Automated WCAG 2.1 AA accessibility evaluation using axe-core |
| `k-dart` | 2.0.0 | active | strategy-analyst | 2026-08-09 | — | Unified DART OpenAPI skill — disclosure query, financial parsing, line-item extraction (scope: common, l2_propagate) |
| `k-law` | 1.0.0 | active | strategy-analyst | 2026-08-09 | — | Korean Ministry of Government Legislation (`법제처`) National Law Information Center OpenAPI — statutes, precedents, ordinances (scope: common, l2_propagate) |
| `mece-logic-auditor` | 1.0.0 | active | strategy-analyst | 2026-08-06 | — | MECE issue tree auditing and strategic reasoning evaluation rules |
| `sound-synth` | 1.0.0 | active | sound-designer | 2026-08-06 | — | Web Audio API / jsfxr procedural 8-bit retro sound effect generation rules |
| `standup-synthesizer` | 1.0.0 | active | pm | 2026-08-06 | — | Daily standup digest synthesizer aggregating commits, issues, PRs, and blockers |
| `swe-solve` | 1.0.0 | active | pm | 2026-08-06 | — | Autonomous 4-stage issue-to-PR resolution pipeline for software engineering tasks |
| `financial-statement-analysis` | 1.0.0 | active | financial-analyst | 2026-08-20 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult — DART pipeline, retargeted to co-newbiz's own `newbiz.ts fin:*` CLI |
| `insight-synthesis` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult — cross-domain synthesis for stage-gate decisions |
| `competitive-intelligence` | 1.0.0 | active | market-intelligence-agent | 2026-08-20 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult |
| `company-intelligence` | 1.0.0 | active | market-intelligence-agent | 2026-08-20 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult |
| `executive-presentation` | 1.0.0 | active | docs-writer | 2026-08-20 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult — retargeted to Entity/Group IC deck |
| `sample-driven-report-writing` | 1.0.0 | active | docs-writer | 2026-08-20 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult |
| `hwp-document-processing` | 1.0.0 | active | docs-writer | 2026-08-20 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult — generation path only, extraction not yet ported (see SKILL.md Adaptation Note) |
| `org-readiness-assessment` | 1.0.0 | active | hr-integration-agent | 2026-08-20 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult |
| `governance-document-hierarchy` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8B (design §9.3 governance-authoring group) — Policy/Procedure/Guideline/Checklist/Template layer classification |
| `policy-and-procedure-governance` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8B — Policy/Procedure authoring, entity addenda and shared/entity/region procedure model |
| `procedure-reference-override` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8B — ADR-0020 shared/entity/region override mechanics, `proc:resolve` |
| `two-tier-approval-chain` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8B — Entity IC gating + Group IC ranking (ADR-0028/0029) |
| `policy-change-impact-analysis` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8B — mandatory pre-amendment impact analysis, `project_policy_pin` retroactivity |
| `regulation-monitoring` | 1.0.0 | active | legal-counsel | 2026-08-20 | — | Wave 5.8B — portfolio-wide statute watch feeding the amendment pipeline |
| `adr-governance` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8B — design §7 ADR trigger-list check and drafting |
| `compliance-monitoring` | 1.0.0 | active | compliance-officer | 2026-08-20 | — | Wave 5.8B (design §9.2 merge) — absorbs governance-training-and-notice, governance-kpi-reporting |
| `waiver-management` | 1.0.0 | active | compliance-officer | 2026-08-20 | — | Wave 5.8B — ADR-0036 mandatory-expiry waiver lifecycle |
| `interpretation-registry` | 1.0.0 | active | compliance-officer | 2026-08-20 | — | Wave 5.8B — FR-GOV-12 scoped supersession Q&A registry |
| `checklist-authoring` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8B — item-by-item mandatory/waiver_eligible checklist layer |
| `group-level-review` | 1.0.0 | active | group-review-agent | 2026-08-20 | — | Wave 5.8C (design §9.3 group review + glossary + GF/BF gate groups) — orchestrates `group-investment-review`'s 5-step Group IC sequence |
| `portfolio-fit-assessment` | 1.0.0 | active | group-review-agent | 2026-08-20 | — | Wave 5.8C — overlap finding + agenda-ranking formula (meeting M2 D-M2-2) |
| `intra-group-transaction-compliance` | 1.0.0 | active | group-review-agent | 2026-08-20 | — | Wave 5.8C — Fair Trade Act Art. 47 screen, validated against pilot-003 |
| `glossary-management` | 1.0.0 | active | glossary-curator | 2026-08-20 | — | Wave 5.8C (design §9.2 merge) — absorbs glossary-lint |
| `stage-gate-governance` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8C — Screening-DD-Entity IC-Group IC sequence + 6-item Kill Criteria list |
| `greenfield-feasibility` | 1.0.0 | active | greenfield-agent | 2026-08-20 | — | Wave 5.8C — Green Field Screening/Pre-FS |
| `brownfield-feasibility` | 1.0.0 | active | brownfield-agent | 2026-08-20 | — | Wave 5.8C — Brown Field Screening/Pre-FS/FS/DD incl. six-validator completeness gate |
| `site-infrastructure-assessment` | 1.0.0 | active | greenfield-agent | 2026-08-20 | — | Wave 5.8C — mandatory infrastructure-minimums exclusion filter |
| `regional-incentive-sourcing` | 1.0.0 | active | greenfield-agent | 2026-08-20 | — | Wave 5.8C (design §9.2 merge) — absorbs site-comparison, incentive-NPV on one comparison table |
| `talent-pipeline-planning` | 1.0.0 | active | hr-integration-agent | 2026-08-20 | — | Wave 5.8C — Green Field local labor-market supply assessment |
| `community-partnership-planning` | 1.0.0 | active | hr-integration-agent | 2026-08-20 | — | Wave 5.8C — workforce-development partnerships and community-relations risk |
| `antitrust-screening` | 1.0.0 | active | antitrust-agent | 2026-08-20 | — | Wave 5.8D (design §9.3 M&A special-topics group) — HHI incl. common-ownership combinations (pilot 010 F-2) |
| `customer-attrition-risk` | 1.0.0 | active | customer-retention-agent | 2026-08-20 | — | Wave 5.8D — CoC-clause scan incl. retained-seller-as-supplier (pilot 002 F-2) |
| `incentive-clawback-assessment` | 1.0.0 | active | incentive-agent | 2026-08-20 | — | Wave 5.8D — ADR-0030 one-table acquisition/clawback design |
| `management-incentive-review` | 1.0.0 | active | incentive-agent | 2026-08-20 | — | Wave 5.8D — CoC-trigger executive compensation, role-based per PII discipline |
| `compensation-harmonization-analysis` | 1.0.0 | active | hr-integration-agent | 2026-08-20 | — | Wave 5.8D — ADR-0027 bidirectional upward-bias verification rule |
| `debt-and-contingent-liability-simulation` | 1.0.0 | active | risk-officer | 2026-08-20 | — | Wave 5.8D — ADR-0026 probability-weighted Monte Carlo integration, covenant Kill Criterion |
| `pmi-planning` | 1.0.0 | active | pmi-agent | 2026-08-20 | — | Wave 5.8D — synthesis skill sequencing the other five M&A special-topics outputs |
| `partner-sourcing-strategy` | 1.0.0 | active | partnership-agent | 2026-08-20 | — | Wave 5.8E (design §9.3 partnership + region/industry groups) — ADR-0031 hard/soft partner-dependency classification |
| `partner-due-diligence` | 1.0.0 | active | partnership-agent | 2026-08-20 | — | Wave 5.8E — compliance/financial/dependency screening incl. post-transfer competitor risk |
| `jv-structuring` | 1.0.0 | active | partnership-agent | 2026-08-20 | — | Wave 5.8E — governance/valuation/exit/deadlock documented before term-sheet negotiation |
| `region-profile-application` | 1.0.0 | active | region-lead | 2026-08-20 | — | Wave 5.8E — ADR-0023's 10 mandatory review axes, real `region-profiles/*.yaml` (KR/EU/US/CN/SEA) |
| `industry-profile-application` | 1.0.0 | active | industry-lead | 2026-08-20 | — | Wave 5.8E — ADR-0024 profile-first principle; `industry-profiles/` does not exist yet, gap flagged explicitly |
| `proxy-industry-chain` | 1.0.0 | active | quant-methodologist | 2026-08-20 | — | Wave 5.8F (design §9.3 market/proxy-chain group) — ADR-0006 statistical-hop-only grading rule |
| `value-chain-linkage-analysis` | 1.0.0 | active | quant-methodologist | 2026-08-20 | — | Wave 5.8F — ADR-0025 deliberate separation from proxy-chain betas |
| `unit-conversion-calibration` | 1.0.0 | active | quant-methodologist | 2026-08-20 | — | Wave 5.8F — lead-lag OLS regression, `python/correlation.py` |
| `market-data-pipeline` | 1.0.0 | active | data-architect | 2026-08-20 | — | Wave 5.8F — ADR-0004 cache-first/revision-preserving policy; `fetch`/`md:sync` CLI not yet implemented, gap flagged explicitly |
| `historical-financial-analysis` | 1.0.0 | active | financial-analyst | 2026-08-20 | — | Wave 5.8G (design §9.3 financial/simulation group) — historical distribution feeding the growth-projection anchor |
| `peer-benchmarking` | 1.0.0 | active | financial-analyst | 2026-08-20 | — | Wave 5.8G — cross-sectional peer distribution, the other anchor input |
| `growth-projection-modeling` | 1.0.0 | active | financial-analyst | 2026-08-20 | — | Wave 5.8G — ADR-0018 anchor_ref + top-decile base-rate warning, feeds the Kill Criterion |
| `quality-of-earnings` | 1.0.0 | active | financial-analyst | 2026-08-20 | — | Wave 5.8G — EBITDA normalization bridge for Brown Field DD |
| `wacc-input-session` | 1.0.0 | active | valuation-agent | 2026-08-20 | — | Wave 5.8G — kind=user WACC/hurdle-IRR confirmation gate (checklist bf-02) |
| `investment-feasibility-modeling` | 1.0.0 | active | valuation-agent | 2026-08-20 | — | Wave 5.8G — synthesis skill assembling confirmed WACC/EBITDA/growth/site-cost inputs |
| `scenario-planning` | 1.0.0 | active | risk-officer | 2026-08-20 | — | Wave 5.8G — discrete downside/base/upside cases incl. mandatory +200bp rate-shock test |
| `monte-carlo-simulation` | 1.0.0 | active | risk-officer | 2026-08-20 | — | Wave 5.8G — ADR-0026 seeded, deterministic `python/monte_carlo.py` P50/P95 NPV |



### Variant-Exclusive Skills

Skills registered in the catalog but without a `skills/<name>/` directory in the workspace root. These live exclusively inside variant templates (`templates/co-*/skills/`) and are only available when that variant is active.

| skill | version | status | owner | last_reviewed | removal-date | variant |
|-------|---------|--------|-------|---------------|--------------|---------|
| `change-impact-assessment` | 1.0.0 | active | pm | 2026-06-06 | — | co-consult only |
| `competitive-intelligence` | 1.0.0 | active | pm | 2026-06-06 | — | co-consult only |
| `consulting-report-writing` | 1.0.0 | active | pm | 2026-06-06 | — | co-consult only |
| `design` | 1.2.0 | active | pm | 2026-06-20 | — | co-deck only |
| `executive-presentation` | 1.0.0 | active | pm | 2026-06-06 | — | co-consult only |
| `financial-modeling` | 1.0.0 | active | pm | 2026-06-06 | — | co-consult only |
| `html-build` | 1.3.1 | active | pm | 2026-06-21 | — | co-deck only |
| `insight-synthesis` | 1.0.0 | active | pm | 2026-06-06 | — | co-consult only |
| `measure` | 1.3.0 | active | pm | 2026-06-20 | — | co-deck only |
| `narrative-framework` | 1.0.0 | active | pm | 2026-06-06 | — | co-consult only |
| `org-readiness-assessment` | 1.0.0 | active | pm | 2026-06-06 | — | co-consult only |
| `project-delivery` | 1.0.0 | active | pm | 2026-06-06 | — | co-consult only |
| `pdf-export` | 1.3.0 | active | pm | 2026-06-20 | — | co-deck only |
| `research` | 1.2.0 | active | pm | 2026-06-20 | — | co-deck only |
| `solution-design` | 1.0.0 | active | pm | 2026-06-06 | — | co-consult only |
| `stakeholder-alignment` | 1.0.0 | active | pm | 2026-06-06 | — | co-consult only |
| `stakeholder-review-management` | 1.0.0 | active | pm | 2026-06-06 | — | co-consult only |
| `storyline` | 1.2.0 | active | pm | 2026-06-20 | — | co-deck only |
| `technical-feasibility` | 1.0.0 | active | pm | 2026-06-06 | — | co-consult only |
| `theme-authoring` | 1.0.1 | active | pm | 2026-06-21 | — | co-deck only |
| `verify-authorization` | 1.0.0 | active | security-expert | 2026-06-06 | — | co-security only |
| `version` | 1.3.0 | active | pm | 2026-06-20 | — | co-deck only |
