# VERSION_MANIFEST.md

**Generated**: 2026-09-16T14:35:19.674Z
**Manifest Version**: 1.0
**Location**: docs/VERSION_MANIFEST.md

---

## Summary

- **Agents**: 3
- **Skills**: 148
- **Scripts**: 130 *(top-level CLI scripts; library/helper modules under `scripts/lib/`, `scripts/helpers/`, `scripts/hooks/`, and `scripts/validators/` plus experiment files under `scripts/experiments/` are excluded here — `scripts/SCRIPTS.md` is the full registry)*
- **Commands**: 8

---

## Agents

| Name | File | Tier | Model | Last Modified |
|------|------|------|-------|---------------|
| i18n-specialist | agents/i18n-specialist.md | medium | inherit | 2026-09-15 |
| pm | agents/pm.md | medium | inherit | 2026-09-16 |
| README_ko | agents/README_ko.md | N/A | N/A | 2026-08-23 |

---

<!-- validate-md-language:allowlist-begin reason="Triggers column embeds verbatim Korean search keywords copied from k-* SKILL.md frontmatter (proper-noun data values, not prose). Generated region — a whole-file lang: ko exception would be dishonest and would un-validate the rest of the manifest, so scripts/validate-md-language.ts exempts only this marked section (T-20260912-015)." -->
## Skills

| Name | Version | Status | Location | Platform | Triggers | Owner |
|------|---------|--------|----------|----------|----------|-------|
| access-control-review | 1.0.0 | active | .claude/skills/access-control-review/SKILL.md | both | access permission review, stale membership revocation, wall_group relevance check, admin role count review | security-engineer |
| accessibility-audit | 1.1.0 | active | skills/accessibility-audit/SKILL.md | workspace | accessibility-audit, /accessibility-audit, axe-core audit, wcag accessibility check, wcag 2.1 aa | pm |
| admin-console-operations | 1.1.0 | active | .claude/skills/admin-console-operations/SKILL.md | both | admin console operation, user approval workflow, audit log review via admin UI, threshold edit ADR requirement | process-governance-manager |
| adr-governance | 1.0.0 | active | .claude/skills/adr-governance/SKILL.md | both | does this need an ADR, ADR trigger list, draft an ADR, architecture decision record | process-governance-manager |
| agent-lifecycle-manager | 1.1.0 | active | skills/agent-lifecycle-manager/SKILL.md | workspace | create agent, new agent, validate agents, agent lifecycle, manage agents | pm |
| agent-output-provenance | 1.2.0 | active | .claude/skills/agent-output-provenance/SKILL.md | both | agent output provenance, confidence grade on a deliverable, reviewed_by tracking, AI-produced vs human-confirmed distinction | process-governance-manager |
| antitrust-screening | 1.1.0 | active | skills/antitrust-screening/SKILL.md | workspace | antitrust screening, HHI calculation, merger control filing, gun-jumping, relevant market definition | antitrust-agent |
| api-documentation | 1.0.0 | active | skills/api-documentation/SKILL.md | workspace | api documentation, document api, api reference, developer documentation, rest api docs, graphql docs, sdk documentation | pm |
| assumption-audit | 1.0.0 | active | .claude/skills/assumption-audit/SKILL.md | both | assumption audit, kind=assumed rationale, assumption registry review, is this assumption load-bearing | process-governance-manager |
| auth-and-account-management | 1.0.0 | active | .claude/skills/auth-and-account-management/SKILL.md | both | account lockout, password reset, must change password gate, API token issuance, session lifecycle | security-engineer |
| batch-scheduling-operations | 1.0.0 | active | .claude/skills/batch-scheduling-operations/SKILL.md | both | OS scheduler registration, cron job setup, batch job scheduling, recurring task registration | infra-automation-engineer |
| brownfield-feasibility | 1.1.0 | active | skills/brownfield-feasibility/SKILL.md | workspace | brown field feasibility, M&A feasibility, acquisition screening, brownfield DD | brownfield-agent |
| certification-roadmap | 1.0.0 | active | skills/certification-roadmap/SKILL.md | workspace | certification requirements, certification gap analysis, certification roadmap | certification-agent |
| certification-transferability | 1.2.0 | active | skills/certification-transferability/SKILL.md | workspace | certification transferability, change of control certification, certification survives acquisition | legal-counsel |
| checklist-authoring | 1.0.0 | active | .claude/skills/checklist-authoring/SKILL.md | both | add a checklist item, checklist authoring, mandatory vs optional checklist item, waiver_eligible | process-governance-manager |
| ci-triage | 0.1.0 | active | skills/ci-triage/SKILL.md | workspace | ci failure, triage failure, audit gate failed, scaffold failed, fix the pipeline | pm |
| commercial-due-diligence | 1.1.0 | active | skills/commercial-due-diligence/SKILL.md | workspace | commercial due diligence, customer concentration analysis, pricing power assessment, win loss analysis | commercial-dd-agent |
| committee-deliberation | 1.6.0 | active | .claude/skills/committee-deliberation/SKILL.md | both | committee, committee-deliberation, steering committee, gate deliberation, red-team review | pm |
| community-partnership-planning | 1.1.0 | active | skills/community-partnership-planning/SKILL.md | workspace | community partnership, local workforce development, community relations, social license to operate | hr-integration-agent |
| company-intelligence | 1.0.0 | active | .claude/skills/company-intelligence/SKILL.md | both | company research, company analysis, corporate investigation, company intelligence, company profile, corporate intelligence, research this company, analyze this company | market-intelligence-agent |
| compensation-harmonization-analysis | 1.0.0 | active | skills/compensation-harmonization-analysis/SKILL.md | workspace | compensation harmonization, comp benchmark, upward bias, post-merger pay equalization | hr-integration-agent |
| competitive-intelligence | 1.1.0 | active | skills/competitive-intelligence/SKILL.md | workspace | competitive analysis, market analysis, competitor profiling, market entry analysis, industry attractiveness, competitive intelligence, five forces | market-intelligence-agent |
| compliance-monitoring | 1.1.0 | active | skills/compliance-monitoring/SKILL.md | workspace | compliance check, is this gate blocked, governance KPI, gate cycle time, checklist completion rate, waiver concentration | compliance-officer |
| continuous-monitoring-and-alerting | 1.0.0 | active | .claude/skills/continuous-monitoring-and-alerting/SKILL.md | both | watch cycle, auto re-analysis, deterioration alert, cooldown and hysteresis, OS scheduler registration | sre |
| customer-attrition-risk | 1.1.0 | active | skills/customer-attrition-risk/SKILL.md | workspace | customer attrition risk, change of control clause, customer concentration risk, retained seller as supplier | customer-retention-agent |
| customer-qualification | 1.0.0 | active | .claude/skills/customer-qualification/SKILL.md | both | customer qualification, vendor registration, PPAP, first article inspection, customer-mandated approval | commercial-dd-agent |
| data-freshness-and-revision-control | 1.0.0 | active | .claude/skills/data-freshness-and-revision-control/SKILL.md | both | data staleness check, revision_no audit, data change log review, series freshness monitoring | dba |
| data-normalization | 1.0.0 | active | .claude/skills/data-normalization/SKILL.md | both | data normalization, account name mapping, canonical schema conversion, normalization coverage | dba |
| database-operations | 1.0.0 | active | .claude/skills/database-operations/SKILL.md | both | database backup, disaster recovery, recovery drill, restore verification | dba |
| db-migration-governance | 1.0.0 | active | .claude/skills/db-migration-governance/SKILL.md | both | new migration, db schema change, migration review, portability regime compliance | dba |
| dd-to-valuation-bridge | 1.1.0 | active | skills/dd-to-valuation-bridge/SKILL.md | workspace | DD to valuation bridge, value_impact, does this finding move the valuation, narrative-only finding check | valuation-agent |
| deal-execution-playbook | 1.1.0 | active | .claude/skills/deal-execution-playbook/SKILL.md | both | what happens at this gate, who owns this deliverable, deal execution sequence, gate RACI | process-governance-manager |
| deal-pipeline-orchestration | 1.0.0 | active | .claude/skills/deal-pipeline-orchestration/SKILL.md | both | run the pipeline, execute stage, orchestrate deal review, advance the opportunity, which agent works this stage | pm |
| deal-workspace-operations | 1.1.0 | active | .claude/skills/deal-workspace-operations/SKILL.md | both | open a new project workspace, close a project, archive a project, project membership lifecycle | process-governance-manager |
| debt-and-contingent-liability-simulation | 1.1.0 | active | skills/debt-and-contingent-liability-simulation/SKILL.md | workspace | contingent liability, covenant breach test, rate shock, Monte Carlo liability integration, CoC debt acceleration | risk-officer |
| decision-record | 1.1.0 | active | skills/decision-record/SKILL.md | workspace | decision record, gate ruling, go/no-go decision, escalation decision, record a decision | pm |
| deployment-and-release | 1.0.0 | active | .claude/skills/deployment-and-release/SKILL.md | both | release deployment, migration rollback, irreversible migration sign-off, rollback drill | release-engineer |
| design-lint | 1.0.0 | active | .claude/skills/design-lint/SKILL.md | both | design lint, UI consistency | design-system-agent |
| documentation-writing | 1.0.0 | active | skills/documentation-writing/SKILL.md | workspace | write documentation, create guide, draft communication, write manual, create tutorial, documentation, technical writing | pm |
| evidence-ledger | 1.1.0 | active | skills/evidence-ledger/SKILL.md | workspace | evidence ledger, citation ledger, claim verification, source verification, evidence tracking | pm |
| executive-presentation | 1.0.0 | active | skills/executive-presentation/SKILL.md | workspace | executive presentation, executive deck, IC presentation, decision deck, strategy deck, board presentation | docs-writer |
| expert-interview | 1.1.0 | active | .claude/skills/expert-interview/SKILL.md | both | expert interview, expert network call, source triangulation, disconfirming questions | commercial-dd-agent |
| explain-me | 1.0.0 | experimental | skills/explain-me/SKILL.md | workspace | /explain-me, /reportme, make a report, create report, explain this topic | pm |
| financial-statement-analysis | 1.0.0 | active | skills/financial-statement-analysis/SKILL.md | workspace | financial statement analysis, ROIC analysis, value driver tree, financial KPI, profitability analysis, cash flow analysis, DART analysis, fundamental analysis, corporate financial analysis | financial-analyst |
| financing-plan-review | 1.2.0 | active | skills/financing-plan-review/SKILL.md | workspace | financing plan, certainty of funds, sources and uses | valuation-agent |
| finishing-a-development-branch | 1.0.0 | active | skills/finishing-a-development-branch/SKILL.md | workspace | finish branch, complete work, wrap up, finishing a development branch, merge branch, create PR, push and PR | pm |
| forward-industry-research | 1.0.0 | active | .claude/skills/forward-industry-research/SKILL.md | both | forward industry research, upstream industry research, key driver identification, industry direction analysis, external environment scenario | market-intelligence-agent |
| gateguard | 1.0.0 | active | skills/gateguard/SKILL.md | workspace | gateguard, /gateguard, investigate file, check before edit, pre-edit check | pm |
| glossary-management | 1.0.0 | active | .claude/skills/glossary-management/SKILL.md | both | add a glossary term, glossary lint, undefined term, glossary management, why_it_matters_ko | glossary-curator |
| governance-document-hierarchy | 1.0.0 | active | .claude/skills/governance-document-hierarchy/SKILL.md | both | governance document hierarchy, policy vs procedure, governance layer, is this mandatory, new governance document | process-governance-manager |
| graft | N/A | active | .claude/skills/graft/SKILL.md | claude | N/A | N/A |
| greenfield-feasibility | 1.1.0 | active | skills/greenfield-feasibility/SKILL.md | workspace | green field feasibility, new plant feasibility, new establishment review, greenfield screening | greenfield-agent |
| group-level-review | 1.0.0 | active | .claude/skills/group-level-review/SKILL.md | both | group IC review, group investment committee, run the group gate, group review agent | group-review-agent |
| growth-projection-modeling | 1.1.0 | active | skills/growth-projection-modeling/SKILL.md | workspace | growth projection, revenue forecast, base rate warning, anchor_ref, hockey stick check | financial-analyst |
| handbook | 0.4.1 | active | skills/handbook/SKILL.md | workspace | make handbook, create handbook, build course site, companion handbook | pm |
| handbook-sync-audit | 1.0.0 | active | skills/handbook-sync-audit/SKILL.md | workspace | audit handbook, handbook parity check, handbook sync audit, textbook drift check | docs-writer |
| historical-financial-analysis | 1.0.0 | active | skills/historical-financial-analysis/SKILL.md | workspace | historical financial trend, historical volatility, base rate distribution, multi-year trajectory analysis | financial-analyst |
| hwp-document-processing | 1.1.0 | active | .claude/skills/hwp-document-processing/SKILL.md | both | hwp, hwpx, hwp document, hwpx document, hwp extraction, hwpx generation, government report template | docs-writer |
| i18n-audit | 1.0.0 | active | skills/i18n-audit/SKILL.md | workspace | i18n audit, locale parity, translation parity, glossary audit, L10N parity | pm |
| i18n-formatting | 1.0.0 | active | skills/i18n-formatting/SKILL.md | workspace | date format, number format, currency format, unit conversion, paper size, korean numerals | pm |
| i18n-layout | 1.0.0 | active | skills/i18n-layout/SKILL.md | workspace | character encoding, RTL, bidi, font selection, CRLF, BOM | pm |
| i18n-locale-config | 1.0.0 | active | skills/i18n-locale-config/SKILL.md | workspace | locale config, locale code, BCP 47, collation, collation order, timezone | pm |
| incentive-clawback-assessment | 1.1.0 | active | skills/incentive-clawback-assessment/SKILL.md | workspace | incentive clawback, clawback exposure, relocation clawback risk, incentive obligation | incentive-agent |
| incident-response | 1.0.0 | active | .claude/skills/incident-response/SKILL.md | both | security incident, incident triage, MNPI incident, audit log integrity incident, post-incident analysis | sre |
| industry-profile-application | 1.0.0 | active | .claude/skills/industry-profile-application/SKILL.md | both | apply the industry profile, industry-specific review, industry profile gap | industry-lead |
| infrastructure-automation | 1.0.0 | active | .claude/skills/infrastructure-automation/SKILL.md | both | infrastructure automation, environment provisioning, deployment scripting, operational tooling | infra-automation-engineer |
| insight-synthesis | 1.0.0 | active | skills/insight-synthesis/SKILL.md | workspace | synthesize insights, insight synthesis, integrate analysis, strategic synthesis, combine findings, cross-analysis integration | process-governance-manager |
| interpretation-registry | 1.0.0 | active | .claude/skills/interpretation-registry/SKILL.md | both | interpretation registry, does this clause apply, record an interpretation, supersede an interpretation | compliance-officer |
| intra-group-transaction-compliance | 1.1.0 | active | skills/intra-group-transaction-compliance/SKILL.md | workspace | related party transaction, Fair Trade Act Art. 47, intra-group transaction, affiliate transaction screen | group-review-agent |
| investment-feasibility-modeling | 1.1.0 | active | skills/investment-feasibility-modeling/SKILL.md | workspace | investment feasibility model, NPV IRR calculation, feasibility financial model | valuation-agent |
| investment-vehicle-structuring | 1.3.0 | active | skills/investment-vehicle-structuring/SKILL.md | workspace | investment vehicle structure, SPV structuring, direct investment vs SPV, holding company routing, deal structure hypothesis vehicle axis | brownfield-agent |
| jv-structuring | 1.2.0 | active | skills/jv-structuring/SKILL.md | workspace | JV structuring, joint venture governance, veto matters, drag-along tag-along, deadlock resolution, technology contribution valuation | partnership-agent |
| k-dart | 2.1.0 | active | skills/k-dart/SKILL.md | workspace | k-dart, /k-dart, DART, DART OpenAPI, `DART 공시`, `공시검색`, `기업개황`, `재무제표`, `재무정보`, `재무제표 조회`, financial statement, corporate disclosure | market-intelligence-agent |
| k-ecos | 1.0.0 | active | skills/k-ecos/SKILL.md | workspace | k-ecos, /k-ecos, ECOS, `한국은행`, `한국은행 Open API`, `경제통계시스템`, `기준금리`, `환율`, `본원통화`, `100대 통계지표`, Bank of Korea statistics, Korean monetary statistics | financial-analyst |
| k-kosis | 1.0.0 | active | skills/k-kosis/SKILL.md | workspace | k-kosis, /k-kosis, KOSIS, `통계청`, `국가통계포털`, `인구통계`, `물가지수`, `경제통계`, `국가통계`, Korean national statistics | financial-analyst |
| k-krx | 1.0.0 | active | skills/k-krx/SKILL.md | workspace | k-krx, /k-krx, KRX, `한국거래소`, `KRX Open API`, `정보데이터시스템`, `주식 시세`, `코스피`, `코스닥`, `코넥스`, `일별매매정보`, `종목기본정보`, Korean stock market data, KOSPI market data, KOSDAQ market data | financial-analyst |
| k-law | 1.0.0 | active | skills/k-law/SKILL.md | workspace | k-law, /k-law, `법령`, `법률`, `법령정보`, `법령검색`, `판례`, law, statute, legal search, Korea law | market-intelligence-agent |
| k-opendata | 1.2.0 | active | skills/k-opendata/SKILL.md | workspace | k-opendata, /k-opendata, 공공데이터포털, data.go.kr, `관세청`, `수출입무역통계`, `품목별 국가별 수출입실적`, Korea Customs Service trade statistics, HS code trade data | market-intelligence-agent |
| legal-due-diligence | 1.1.0 | active | skills/legal-due-diligence/SKILL.md | workspace | legal DD, change-of-control clause scan, IP title chain | legal-counsel |
| legal-risk-register | 1.0.0 | active | .claude/skills/legal-risk-register/SKILL.md | both | legal risk register, litigation exposure tracking, consolidated legal risk view | legal-counsel |
| management-incentive-review | 1.1.0 | active | skills/management-incentive-review/SKILL.md | workspace | executive compensation review, golden parachute, change of control triggers, key-person retention, non-compete enforceability | incentive-agent |
| manual-authoring | 2.1.0 | active | .claude/skills/manual-authoring/SKILL.md | both | manual authoring, write a manual, SOP authoring, documentation standard | docs-writer |
| market-data-pipeline | 1.1.0 | active | .claude/skills/market-data-pipeline/SKILL.md | both | fetch market data, series revision policy, data change log, market data pipeline | data-architect |
| master-data-governance | 1.0.0 | active | .claude/skills/master-data-governance/SKILL.md | both | staging unmapped queue, master data resolution, unmapped raw value, master data code assignment | dba |
| mcp-server-integration | 1.0.0 | active | .claude/skills/mcp-server-integration/SKILL.md | both | add an MCP tool, MCP server integration, MCP-REST parity, no direct DB access from MCP | backend-engineer |
| meeting | 1.4.1 | active | .claude/skills/meeting/SKILL.md | both | meeting, agent discussion, collaborative decision, multi-agent coordination, facilitate meeting | pm |
| meeting-facilitation | 1.4.1 | active | skills/meeting-facilitation/SKILL.md | workspace | meeting, agent discussion, collaborative decision, multi-agent coordination, facilitate meeting | pm |
| monte-carlo-simulation | 1.1.0 | active | skills/monte-carlo-simulation/SKILL.md | workspace | Monte Carlo simulation, seeded simulation, P50 P95 NPV, contingent liability integration | risk-officer |
| notification-channel-management | 1.0.0 | active | .claude/skills/notification-channel-management/SKILL.md | both | notification channel, notification bundling, watch_rule configuration, notification severity | sre |
| observability-and-alerting | 1.0.0 | active | .claude/skills/observability-and-alerting/SKILL.md | both | system health monitoring, error rate alerting, job run status, platform observability | sre |
| org-readiness-assessment | 1.1.0 | active | skills/org-readiness-assessment/SKILL.md | workspace | organizational readiness, change readiness, change capacity, readiness assessment, transformation readiness | hr-integration-agent |
| partner-due-diligence | 1.1.0 | active | skills/partner-due-diligence/SKILL.md | workspace | partner due diligence, partner compliance screening, sanctions screening for a partner, post-transfer competitor risk | partnership-agent |
| partner-sourcing-strategy | 1.1.0 | active | skills/partner-sourcing-strategy/SKILL.md | workspace | partner sourcing, capability gap for a partner, hard partner dependency, JV partner search | partnership-agent |
| peer-benchmarking | 1.0.0 | active | skills/peer-benchmarking/SKILL.md | workspace | peer benchmarking, comparable company analysis, peer multiple comparison, industry benchmark | financial-analyst |
| permit-pathway-mapping | 1.1.0 | active | skills/permit-pathway-mapping/SKILL.md | workspace | permit pathway, permit DAG, permit critical path, operating permit requirements | legal-counsel |
| platform-command-lifecycle-manager | 1.0.0 | active | skills/platform-command-lifecycle-manager/SKILL.md | workspace | create platform command, new .claude command, new .gemini command, platform command lifecycle, command parity, propagate command | pm |
| platform-skill-lifecycle-manager | 1.0.0 | active | skills/platform-skill-lifecycle-manager/SKILL.md | workspace | create platform skill, new .claude skill, new .gemini skill, platform skill version, platform skill lifecycle, update platform skill | pm |
| pmi-planning | 1.1.0 | active | skills/pmi-planning/SKILL.md | workspace | PMI planning, post-merger integration, integration timeline, day-one integration plan | pmi-agent |
| policy-and-procedure-governance | 1.1.0 | active | .claude/skills/policy-and-procedure-governance/SKILL.md | both | draft a policy, draft a procedure, entity addendum, amend the group policy, new procedure | process-governance-manager |
| policy-change-impact-analysis | 1.0.0 | active | .claude/skills/policy-change-impact-analysis/SKILL.md | both | policy impact analysis, procedure amendment impact, does this affect in-flight projects, project_policy_pin, retroactivity decision | process-governance-manager |
| portfolio-fit-assessment | 1.3.0 | active | skills/portfolio-fit-assessment/SKILL.md | workspace | portfolio overlap, cannibalization, portfolio fit, group agenda ranking, rank against other group companies | group-review-agent |
| procedure-reference-override | 1.0.0 | active | .claude/skills/procedure-reference-override/SKILL.md | both | procedure override, entity-specific procedure, region-specific procedure, add_steps, replace_steps, resolve a procedure | process-governance-manager |
| project-review | 1.6.0 | active | skills/project-review/SKILL.md | workspace | project review, review project, audit project, quality review | pm |
| proxy-industry-chain | 1.1.0 | active | skills/proxy-industry-chain/SKILL.md | workspace | proxy chain, no direct market data, chain reliability grade, demand estimation via proxy industry | quant-methodologist |
| quality-of-earnings | 1.1.0 | active | skills/quality-of-earnings/SKILL.md | workspace | quality of earnings, EBITDA adjustments, normalized earnings, QoE report | financial-analyst |
| query-performance-tuning | 1.0.0 | active | .claude/skills/query-performance-tuning/SKILL.md | both | slow query, query performance, EXPLAIN QUERY PLAN, index coverage review | dba |
| rag-scoring-framework | 1.1.0 | active | skills/rag-scoring-framework/SKILL.md | workspace | RAG grade, RAG scoring, overall grade calculation, hysteresis, structural vs behavioral remedy grading | process-governance-manager |
| region-profile-application | 1.0.0 | active | .claude/skills/region-profile-application/SKILL.md | both | apply the region profile, region review axes, region profile gap, cross-border review checklist | region-lead |
| regional-incentive-sourcing | 1.1.0 | active | skills/regional-incentive-sourcing/SKILL.md | workspace | regional incentive, investment incentive package, site comparison, incentive NPV, compare candidate sites | greenfield-agent |
| regulation-monitoring | 1.0.0 | active | .claude/skills/regulation-monitoring/SKILL.md | both | regulation monitoring, statute change alert, new regulation affecting our projects, regulatory update | legal-counsel |
| regulatory-change-response | 1.0.0 | active | .claude/skills/regulatory-change-response/SKILL.md | both | upcoming regulation change, pre-effective-date response, regulatory change response plan | legal-counsel |
| regulatory-screening | 1.1.0 | active | .claude/skills/regulatory-screening/SKILL.md | both | regulatory screening, foreign investment screening trigger, sanctions screening all counterparties, region profile confirmation | legal-counsel |
| research-analysis | 1.0.0 | active | skills/research-analysis/SKILL.md | workspace | research, analyze, investigate, synthesize, evidence gathering, data analysis, literature review | pm |
| rest-api-design | 1.0.0 | active | .claude/skills/rest-api-design/SKILL.md | both | new REST endpoint, API design review, envelope shape, 404 vs 403 for non-members | backend-engineer |
| run-versioning-and-attribution | 1.0.0 | active | .claude/skills/run-versioning-and-attribution/SKILL.md | both | run versioning, input hash, reproduce a prior result, run attribution, superseded_by chain | data-architect |
| sample-driven-report-writing | 1.0.0 | active | .claude/skills/sample-driven-report-writing/SKILL.md | both | sample-driven report, deliverable template, match sample structure, write to sample format | docs-writer |
| scenario-planning | 1.1.0 | active | skills/scenario-planning/SKILL.md | workspace | scenario analysis, downside case, upside case, rate shock scenario, structural scenario planning | risk-officer |
| script-lifecycle-manager | 1.2.0 | active | skills/script-lifecycle-manager/SKILL.md | workspace | create script, update script, deprecate script, script lifecycle, manage scripts | pm |
| security-baseline-review | 1.0.0 | active | .claude/skills/security-baseline-review/SKILL.md | both | security baseline cadence, STRIDE matrix refresh, quarterly threat model review, pre-deployment security gate | security-engineer |
| security-scan | 1.2.0 | active | skills/security-scan/SKILL.md | workspace | security scan, scan for vulnerabilities, security check, run security | pm |
| site-infrastructure-assessment | 1.1.0 | active | skills/site-infrastructure-assessment/SKILL.md | workspace | site infrastructure, wastewater capacity, power supply capacity, logistics access assessment, site selection | greenfield-agent |
| site-visit-protocol | 1.1.0 | active | skills/site-visit-protocol/SKILL.md | workspace | site visit protocol, pre-visit document request, on-site evidence capture, site visit checklist | technical-dd-agent |
| skill-lifecycle-manager | 1.3.0 | active | skills/skill-lifecycle-manager/SKILL.md | workspace | create skill, new skill, validate skills, skill lifecycle, manage skills | pm |
| source-command-commit-push-pr | 1.0.1 | active | skills/source-command-commit-push-pr/SKILL.md | workspace | commit-push-pr, commit and push, create PR | pm |
| stage-gate-governance | 1.4.0 | active | skills/stage-gate-governance/SKILL.md | workspace | stage gate, kill criteria, gate sequence, halt the project, does this trigger a kill criterion | process-governance-manager |
| standup-synthesizer | 1.0.0 | active | skills/standup-synthesizer/SKILL.md | workspace | standup digest, daily standup, synthesize standup, work summary | pm |
| statute-change-monitoring | 1.0.0 | active | .claude/skills/statute-change-monitoring/SKILL.md | both | statute change affecting this project, regulation change during DD, re-check applicable statutes | legal-counsel |
| strategic-fit-screening | 1.1.0 | active | skills/strategic-fit-screening/SKILL.md | workspace | strategic fit screen, knock-out criteria, hunt zone fit | process-governance-manager |
| sync | 1.5.0 | active | skills/sync/SKILL.md | workspace | sync, /sync, commit and push, create PR | pm |
| systematic-market-sizing | 1.5.0 | active | skills/systematic-market-sizing/SKILL.md | workspace | market sizing, TAM SAM SOM, market matrix, region segment demand estimate, market cross-validation, scenario bands | market-intelligence-agent |
| talent-pipeline-planning | 1.1.0 | active | skills/talent-pipeline-planning/SKILL.md | workspace | talent pipeline, labor market assessment, hiring ramp-up plan, workforce availability | hr-integration-agent |
| team-builder | 1.1.0 | active | skills/team-builder/SKILL.md | workspace | build new agent team, create agent team, agent team setup, team builder | pm |
| technical-due-diligence | 1.1.0 | active | skills/technical-due-diligence/SKILL.md | workspace | technical due diligence, capex plan verification, bottleneck process identification, remaining useful life assessment | technical-dd-agent |
| token-usage-lint | 1.1.0 | active | skills/token-usage-lint/SKILL.md | workspace | token lint, hardcoded color, design token compliance, raw hex values, hardcoded spacing | pm |
| translate | 1.0.1 | active | skills/translate/SKILL.md | workspace | translate, translation, Korean translation | pm |
| two-tier-approval-chain | 1.1.0 | active | skills/two-tier-approval-chain/SKILL.md | workspace | entity IC, group IC, approval chain, IC gate, group agenda ranking, submit to group IC | process-governance-manager |
| ui-information-architecture | 1.0.0 | active | .claude/skills/ui-information-architecture/SKILL.md | both | new SPA screen, UI design review, 3-depth navigation, RAG display contract, source tooltip | frontend-engineer |
| ui-ux-design-intelligence | 1.0.1 | active | skills/ui-ux-design-intelligence/SKILL.md | workspace | design system, ui design, ux design, component design, visual design, design tokens, interface design | pm |
| unit-conversion-calibration | 1.0.0 | active | skills/unit-conversion-calibration/SKILL.md | workspace | calibrate a proxy hop, lead-lag regression, unit conversion coefficient, beta calibration for a proxy chain | quant-methodologist |
| update-bun-packages | 1.3.1 | active | skills/update-bun-packages/SKILL.md | workspace | update bun packages, upgrade bun packages, bun update, update dependencies, upgrade dependencies | pm |
| validate-docs-links | 1.0.0 | active | .claude/skills/validate-docs-links/SKILL.md | both | validate links, check links, broken links, docs validation | pm |
| value-chain-driver-identification | 1.0.0 | active | .claude/skills/value-chain-driver-identification/SKILL.md | both | chain node sensitivity, per-stage driver sensitivity, driver correlation analysis, lead-lag driver estimation | quant-methodologist |
| value-chain-linkage-analysis | 1.1.0 | active | skills/value-chain-linkage-analysis/SKILL.md | workspace | value chain linkage, pass-through rate, upstream downstream risk exposure, margin risk from supplier or customer industry | quant-methodologist |
| value-chain-stage-financials | 1.0.0 | active | .claude/skills/value-chain-stage-financials/SKILL.md | both | value chain stage financials, per-node 5-year financials, industry-level KPI rollup, chain stage financial performance | financial-analyst |
| vulnerability-management | 1.0.0 | active | .claude/skills/vulnerability-management/SKILL.md | both | CVE check, dependency vulnerability, risk acceptance decision, unpatched Critical CVE | security-engineer |
| wacc-input-session | 1.3.0 | active | skills/wacc-input-session/SKILL.md | workspace | WACC input, hurdle IRR confirmation, CAPM components, discount rate session, beta estimation | valuation-agent |
| waiver-management | 1.0.1 | active | .claude/skills/waiver-management/SKILL.md | both | file a waiver, waiver request, approve a waiver, waiver expiry, waiver concentration | compliance-officer |
| zod-contract-gate | 1.0.0 | active | skills/zod-contract-gate/SKILL.md | workspace | zod-contract-gate, /zod-contract-gate, zod contract validation, schema contract gate, runtime schema validation | backend-engineer |

<!-- validate-md-language:allowlist-end -->

---

## Scripts

| Name | Version | Location | Dependencies |
|------|---------|----------|--------------|
| adr-new.ts | 1.0.0 | scripts/co-newbiz/adr-new.ts | N/A |
| agent-create.ts | 1.0.1 | scripts/agent-create.ts | N/A |
| agent-delete.ts | 1.0.1 | scripts/agent-delete.ts | N/A |
| agent-lifecycle-audit.ts | 1.2.1 | scripts/agent-lifecycle-audit.ts | N/A |
| agent-list.ts | 1.1.0 | scripts/agent-list.ts | N/A |
| agent-verify.ts | 1.0.2 | scripts/agent-verify.ts | N/A |
| analyze-git-history.ts | 1.0.2 | scripts/analyze-git-history.ts | child_process |
| apply-handbook-theme.test.ts | 1.0.1 | scripts/tests/apply-handbook-theme.test.ts | bun:test |
| apply-handbook-theme.ts | 1.0.0 | scripts/handbook/apply-handbook-theme.ts | N/A |
| archive-memory.ts | 1.0.0 | scripts/archive-memory.ts | N/A |
| assume.ts | 1.0.0 | scripts/co-newbiz/assume.ts | N/A |
| audit.ts | 2.39.0 | scripts/audit.ts | bun |
| backfill-brownfield-financial-criteria.ts | 1.0.0 | scripts/co-newbiz/backfill-brownfield-financial-criteria.ts | N/A |
| backfill-capability-gap.ts | 1.0.0 | scripts/co-newbiz/backfill-capability-gap.ts | N/A |
| backfill-hyd-brk-report.ts | 1.1.0 | scripts/co-newbiz/backfill-hyd-brk-report.ts | N/A |
| backup.ts | 1.0.1 | scripts/co-newbiz/backup.ts | N/A |
| build-search-index.ts | 1.0.0 | scripts/handbook/build-search-index.ts | N/A |
| calibrate.ts | 1.0.0 | scripts/co-newbiz/calibrate.ts | N/A |
| check-a11y.ts | 1.0.0 | scripts/handbook/check-a11y.ts | N/A |
| check-authoring.ts | 1.2.0 | scripts/handbook/check-authoring.ts | N/A |
| check-external-links.ts | 1.2.0 | scripts/handbook/check-external-links.ts | N/A |
| check-i18n-parity.ts | 1.0.0 | scripts/handbook/check-i18n-parity.ts | N/A |
| check-labels.ts | 1.0.0 | scripts/handbook/check-labels.ts | N/A |
| check-links.ts | 1.0.0 | scripts/handbook/check-links.ts | N/A |
| check-lint.ts | 1.0.0 | scripts/handbook/check-lint.ts | N/A |
| check-search.ts | 2.0.0 | scripts/handbook/check-search.ts | N/A |
| check-spell.ts | 1.0.0 | scripts/handbook/check-spell.ts | N/A |
| check-structure.test.ts | 1.0.0 | scripts/tests/check-structure.test.ts | bun:test |
| check-structure.ts | 1.0.0 | scripts/handbook/check-structure.ts | N/A |
| check-symmetry.ts | 1.0.0 | scripts/handbook/check-symmetry.ts | N/A |
| check-tables.ts | 1.0.0 | scripts/handbook/check-tables.ts | N/A |
| cleanup-completed-md.ts | 1.1.0 | scripts/cleanup-completed-md.ts | N/A |
| clear-pm-approval.ts | 1.0.0 | scripts/clear-pm-approval.ts | N/A |
| committee-deliberation.ts | 1.1.0 | scripts/co-newbiz/committee-deliberation.ts | N/A |
| compile-tokens.ts | 1.2.0 | scripts/compile-tokens.ts | N/A |
| contrast-check.ts | 1.0.0 | scripts/co-newbiz/contrast-check.ts | N/A |
| convert.ts | 1.0.0 | scripts/co-newbiz/convert.ts | N/A |
| dart-collect.ts | 1.0.0 | scripts/co-newbiz/dart-collect.ts | N/A |
| db-export.ts | 1.0.0 | scripts/co-newbiz/db-export.ts | N/A |
| db-integrity.ts | 1.0.0 | scripts/co-newbiz/db-integrity.ts | N/A |
| deploy-handbook.ts | 1.1.0 | scripts/handbook/deploy-handbook.ts | N/A |
| deploy-readme-patch.test.ts | 1.0.0 | scripts/tests/deploy-readme-patch.test.ts | bun:test |
| design-lint.ts | 1.2.0 | scripts/co-newbiz/design-lint.ts | N/A |
| design-lint.ts | 1.0.0 | scripts/design-lint.ts | N/A |
| dev-sync.ts | 1.14.0 | scripts/dev-sync.ts | bun |
| dispatch-parallel.ts | 1.1.1 | scripts/dispatch-parallel.ts | N/A |
| dispatch-serial.ts | 1.1.1 | scripts/dispatch-serial.ts | N/A |
| dispatch.ts | 1.1.1 | scripts/dispatch.ts | N/A |
| driver-tree.ts | 1.0.0 | scripts/co-newbiz/driver-tree.ts | N/A |
| env-check.ts | 1.1.1 | scripts/co-newbiz/env-check.ts | N/A |
| extract-copycode.ts | 1.0.0 | scripts/handbook/extract-copycode.ts | N/A |
| fin-analyze.ts | 1.0.0 | scripts/co-newbiz/fin-analyze.ts | N/A |
| fin-pipeline.ts | 1.0.0 | scripts/co-newbiz/fin-pipeline.ts | N/A |
| fin-project.ts | 1.0.0 | scripts/co-newbiz/fin-project.ts | N/A |
| fix-construction-machinery-link.ts | 1.0.0 | scripts/co-newbiz/fix-construction-machinery-link.ts | N/A |
| gen-pk-notnull-rebuild.ts | 1.0.0 | scripts/co-newbiz/gen-pk-notnull-rebuild.ts | bun:sqlite |
| gen-pr-body.ts | 1.2.0 | scripts/gen-pr-body.ts | bun |
| generate-agent-registry.ts | N/A | scripts/co-newbiz/generate-agent-registry.ts | N/A |
| generate-ide-rules.ts | 1.0.0 | scripts/generate-ide-rules.ts | N/A |
| generate-process-flow.ts | 1.3.2 | scripts/co-newbiz/generate-process-flow.ts | js-yaml |
| generate-prompt-registry.ts | N/A | scripts/co-newbiz/generate-prompt-registry.ts | N/A |
| generate-skill-graph.ts | 1.10.0 | scripts/generate-skill-graph.ts | js-yaml |
| generate-version-manifest.ts | 1.5.0 | scripts/generate-version-manifest.ts | bun, js-yaml |
| glossary-lint.ts | 1.1.1 | scripts/co-newbiz/glossary-lint.ts | js-yaml |
| graph-map.ts | 1.1.0 | scripts/co-newbiz/graph-map.ts | js-yaml |
| graph.ts | 0.4.1 | scripts/co-newbiz/graph.ts | js-yaml |
| handbook-doctor.ts | 1.0.0 | scripts/handbook/handbook-doctor.ts | N/A |
| handbook-sync-audit.ts | 1.0.0 | scripts/handbook/handbook-sync-audit.ts | N/A |
| hwp-extract.ts | 1.0.0 | scripts/co-newbiz/hwp-extract.ts | N/A |
| kosis-units.ts | 1.0.1 | scripts/co-newbiz/kosis-units.ts | N/A |
| lifecycle-sync-audit.ts | 1.14.0 | scripts/lifecycle-sync-audit.ts | js-yaml |
| lint-server-boundary.ts | 1.0.0 | scripts/co-newbiz/lint-server-boundary.ts | N/A |
| md-to-ooxml.ts | 1.2.0 | scripts/md-to-ooxml.ts | fs, path |
| model.ts | 1.0.0 | scripts/co-newbiz/model.ts | N/A |
| nav-utils.ts | 1.0.0 | scripts/handbook/nav-utils.ts | N/A |
| newbiz.ts | 1.19.0 | scripts/co-newbiz/newbiz.ts | N/A |
| policy-sync.ts | 1.0.1 | scripts/co-newbiz/policy-sync.ts | N/A |
| proc-resolve.ts | 1.2.1 | scripts/co-newbiz/proc-resolve.ts | js-yaml |
| qa-gate.ts | 1.3.0 | scripts/qa-gate.ts | bun |
| rag.ts | 1.2.1 | scripts/co-newbiz/rag.ts | bun:sqlite |
| readme-lifecycle-audit.ts | 1.0.4 | scripts/readme-lifecycle-audit.ts | N/A |
| register-hydraulic-breaker-assumptions.ts | 1.0.0 | scripts/co-newbiz/register-hydraulic-breaker-assumptions.ts | N/A |
| render-pdf-deck.ts | 1.0.1 | scripts/render-pdf-deck.ts | N/A |
| report.ts | 1.0.0 | scripts/co-newbiz/report.ts | N/A |
| resolve-variants.ts | 1.0.3 | scripts/resolve-variants.ts | fs, js-yaml, path |
| restore.ts | 1.0.0 | scripts/co-newbiz/restore.ts | N/A |
| retry-handler.ts | 1.1.0 | scripts/retry-handler.ts | N/A |
| runbook-validate.ts | 1.0.0 | scripts/co-newbiz/runbook-validate.ts | js-yaml |
| scaffold-handbook.ts | 1.2.0 | scripts/handbook/scaffold-handbook.ts | N/A |
| scorecard-rollup.ts | 1.0.0 | scripts/co-newbiz/scorecard-rollup.ts | N/A |
| seed-benchmark-cases.ts | 1.0.0 | scripts/co-newbiz/seed-benchmark-cases.ts | bun:sqlite |
| seed-hydraulic-breaker-matrix.ts | 1.1.0 | scripts/co-newbiz/seed-hydraulic-breaker-matrix.ts | N/A |
| seed-s1-s12-demo.ts | 1.0.0 | scripts/co-newbiz/seed-s1-s12-demo.ts | N/A |
| setup-github-branch-protection.ts | 1.0.1 | scripts/setup-github-branch-protection.ts | bun |
| shadow-compare.ts | 1.0.0 | scripts/co-newbiz/shadow-compare.ts | N/A |
| simulate.ts | 1.0.0 | scripts/co-newbiz/simulate.ts | N/A |
| skill-lifecycle-audit.ts | 1.4.1 | scripts/skill-lifecycle-audit.ts | N/A |
| skill-session-review.ts | 1.0.0 | scripts/skill-session-review.ts | bun |
| source-adapters.ts | 1.1.0 | scripts/co-newbiz/source-adapters.ts | N/A |
| spec-register.ts | 1.2.0 | scripts/spec-register.ts | N/A |
| sync-agent-personas.ts | 1.0.1 | scripts/co-newbiz/sync-agent-personas.ts | N/A |
| sync-md.ts | 1.3.0 | scripts/sync-md.ts | N/A |
| sync-skill-status.ts | 1.0.1 | scripts/sync-skill-status.ts | N/A |
| sync-skills.ts | 1.8.0 | scripts/sync-skills.ts | N/A |
| team-builder.ts | 1.4.0 | scripts/team-builder.ts | N/A |
| test-runner.ts | 1.3.0 | scripts/test-runner.ts | fs, os, path |
| translate-readme.ts | 1.0.0 | scripts/translate-readme.ts | bun, fs, path |
| typecheck.ts | 1.1.1 | scripts/typecheck.ts | N/A |
| update-footers.ts | 1.0.0 | scripts/handbook/update-footers.ts | N/A |
| validate-agents.ts | 1.2.1 | scripts/validate-agents.ts | N/A |
| validate-decisions.ts | 1.0.0 | scripts/validate-decisions.ts | js-yaml |
| validate-doc-folder.ts | 1.2.0 | scripts/validate-doc-folder.ts | fs, path |
| validate-docs-links.ts | 1.1.0 | scripts/validate-docs-links.ts | fs, path |
| validate-handbook.ts | 1.1.0 | scripts/handbook/validate-handbook.ts | N/A |
| validate-md-language.ts | 1.11.0 | scripts/validate-md-language.ts | fs |
| validate-model-registry.ts | 1.4.0 | scripts/validate-model-registry.ts | N/A |
| validate-nav.ts | 1.0.0 | scripts/handbook/validate-nav.ts | N/A |
| validate-pm-extends.ts | 0.3.1 | scripts/validate-pm-extends.ts | N/A |
| validate-procedures.ts | 1.1.0 | scripts/validate-procedures.ts | js-yaml |
| validate-skills.ts | 1.5.1 | scripts/validate-skills.ts | N/A |
| validate-templates.ts | 1.33.0 | scripts/validate-templates.ts | js-yaml |
| validate-variant-readiness.ts | 1.1.0 | scripts/validate-variant-readiness.ts | N/A |
| verify-agent-deliverables.ts | 1.0.1 | scripts/verify-agent-deliverables.ts | fs |
| verify-memory.ts | 1.2.0 | scripts/verify-memory.ts | fs, path |
| verify-platform-lifecycle.ts | 1.1.3 | scripts/verify-platform-lifecycle.ts | N/A |
| verify-readme-sync.ts | 1.4.0 | scripts/verify-readme-sync.ts | bun, fs, path |
| verify-scripts.ts | 1.6.1 | scripts/verify-scripts.ts | fs, path |
| verify-skill-graph.ts | 1.6.0 | scripts/verify-skill-graph.ts | N/A |
| verify-skills.ts | 1.3.0 | scripts/verify-skills.ts | N/A |
| watch-run.ts | 1.1.0 | scripts/co-newbiz/watch-run.ts | bun:sqlite |

---

## Commands

| Name | File | Platform | Skill Integration |
|------|------|----------|-------------------|
| changelog | .claude/commands/changelog.md | both | N/A |
| commit-push-pr | .claude/commands/commit-push-pr.md | both | N/A |
| gateguard | .claude/commands/gateguard.md | both | N/A |
| meeting | .claude/commands/meeting.md | both | N/A |
| memlog | .claude/commands/memlog.md | both | N/A |
| new-task | .claude/commands/new-task.md | both | N/A |
| project-review | .claude/commands/project-review.md | both | N/A |
| sync | .claude/commands/sync.md | both | N/A |

---

## Platform Parity Status

**Checked**: Claude (.claude/) vs Gemini (.gemini/)

- **Commands with parity**: 8 / 8
- **Skills with parity**: 58 / 148 (common-template skills are parity-exempt)

---

## Drift Detection

⚠️ **Drift detected**:

- [WARNING] Agent README_ko missing tier or model metadata
