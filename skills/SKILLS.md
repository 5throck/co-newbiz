# SKILLS.md — Skill Lifecycle Registry
# SKILLS.md — Skill Lifecycle Registry


> Single Source of Truth for all project skills in `skills/`.  
> Single Source of Truth for all project skills in `skills/`.  
> Propagation control is via SKILL.md frontmatter (`l2_propagate`/`scope`) — not this file.  
> Propagation control is via SKILL.md frontmatter (`l2_propagate`/`scope`) — not this file.  
> Platform skills (`.claude/skills/`, `.gemini/skills/`) are tracked by `verify-platform-lifecycle.ts` — not here.  
> Platform skills (`.claude/skills/`, `.gemini/skills/`) are tracked by `verify-platform-lifecycle.ts` — not here.  
> Machine parsing: `layer-filter.ts` reads each skill's `SKILL.md` frontmatter directly.  
> Machine parsing: `layer-filter.ts` reads each skill's `SKILL.md` frontmatter directly.  
> **L0+L1+L2 skills** are variant-specific overrides living in `templates/co-*/skills/` — NOT published to `templates/common/skills/`.
> **L0+L1+L2 skills** are variant-specific overrides living in `templates/co-*/skills/` — NOT published to `templates/common/skills/`.


---
---
| `k-krx` | 1.0.2 | active | financial-analyst | 2026-09-11 | — | Queries the KRX Data Marketplace OPEN API for Korean exchange market data (KOSPI/KOSDAQ daily trading, stock master, ETF/ETN) |
| `k-ecos` | 1.0.0 | active | financial-analyst | 2026-09-11 | — | Queries the Bank of Korea ECOS Open API for Korean macro-financial statistics (base rate, exchange rates, money supply, GDP) |


## Registry
## Registry


### Workspace Skills
### Workspace Skills


Skills with a `skills/<name>/` directory in the workspace root. These are the primary skills available across all platforms.
Skills with a `skills/<name>/` directory in the workspace root. These are the primary skills available across all platforms.


| skill | version | status | owner | last_reviewed | removal-date | notes |
| skill | version | status | owner | last_reviewed | removal-date | notes |
|-------|---------|--------|-------|---------------|--------------|-------|
|-------|---------|--------|-------|---------------|--------------|-------|
| `access-control-review` | 1.0.0 | active | security-engineer | 2026-08-20 | — | Wave 5.8K — monthly stale-membership revocation, quarterly admin-count review |
| `accessibility-audit` | 1.1.0 | active | pm | 2026-09-06 | - | - |
| `admin-console-operations` | 1.1.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8K — operates the 3 built admin sections, names the 7 not yet built |
| `adr-governance` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8B — design §7 ADR trigger-list check and drafting |
| `agent-lifecycle-manager` | 1.3.0 | active | pm | 2026-09-21 | — | — |
|`agent-lifecycle-manager`|1.3.0|active|pm|2026-09-21|—|—|
| `agent-output-provenance` | 1.2.0 | active | process-governance-manager | 2026-08-28 | — | Wave 5.8I — `analysis_task.reviewed_by` design intent; table not yet migrated, gap flagged explicitly |
| `antitrust-screening` | 1.1.0 | active | antitrust-agent | 2026-08-23 | — | Wave 5.8D (design §9.3 M&A special-topics group) — HHI incl. common-ownership combinations (pilot 010 F-2) |
| `api-documentation` | 1.0.2 | active | pm | 2026-07-19 | — | — |
|`assumption-audit`|1.0.1| experimental |process-governance-manager|2026-08-20|—|Wave 5.8I — user/assumed/derived kind-tag correctness audit|
| `auth-and-account-management` | 1.0.0 | active | security-engineer | 2026-08-20 | — | Wave 5.8J — existence-never-leaked auth, dual-credential must-change-password gating |
| `batch-scheduling-operations` | 1.0.0 | active | infra-automation-engineer | 2026-08-20 | — | Wave 5.8K — ADR-0019 OS-level scheduler, never in-process timer |
| `brownfield-feasibility` | 1.2.0 | active | brownfield-agent | 2026-09-22 | — | Wave 5.8C — Brown Field Screening/Pre-FS/FS/DD incl. six-validator completeness gate |
| `certification-roadmap` | 1.0.0 | active | certification-agent | 2026-08-20 | — | Wave 5.8H — certification gap analysis, strictly separate from permits |
| `certification-transferability` | 1.2.0 | active | legal-counsel | 2026-08-23 | — | Wave 5.8H — CoC transferability confirmed against the certifying body's own rules; inference disallowed |
| `checklist-authoring` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8B — item-by-item mandatory/waiver_eligible checklist layer |
| `ci-triage` | 0.2.0 | active | pm | 2026-10-04 | - | - |
| `deal-pipeline-orchestration` | 1.0.0 | active | pm | 2026-09-08 | - | - |
| `manual-authoring` | 2.1.0 | active | docs-writer | 2026-09-06 | — | Manual/SOP/governance-reference authoring standard — audience split, governance metadata, external-reference badge rules; documents render live via `/library` (ADR-0108), no generator step |
| `commercial-due-diligence` | 1.2.0 | active | commercial-dd-agent | 2026-10-01 | — | Wave 5.8H — checklist cdd-01-08, no-narrative-only-finding rule; cdd-08 four-axis revenue quality |
| `community-partnership-planning` | 1.1.0 | active | hr-integration-agent | 2026-08-23 | — | Wave 5.8C — workforce-development partnerships and community-relations risk |
|`company-intelligence`|1.0.1| experimental | process-governance-manager |2026-08-20|—|Wave 5.8A reuse layer, adapted from Projects/co-consult|
| `compensation-harmonization-analysis` | 1.0.0 | active | hr-integration-agent | 2026-08-20 | — | Wave 5.8D — ADR-0027 bidirectional upward-bias verification rule |
| `competitive-intelligence` | 1.1.0 | active | market-intelligence-agent | 2026-08-23 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult |
| `compliance-monitoring` | 1.1.0 | active | compliance-officer | 2026-08-23 | — | Wave 5.8B (design §9.2 merge) — absorbs governance-training-and-notice, governance-kpi-reporting |
| `continuous-monitoring-and-alerting` | 1.0.0 | active | sre | 2026-08-20 | — | Wave 5.8J — ADR-0017 bidirectional (deterioration non-optional) notification policy |
| `customer-attrition-risk` | 1.2.0 | active | customer-retention-agent | 2026-10-01 | — | Wave 5.8D — CoC-clause scan incl. retained-seller-as-supplier (pilot 002 F-2); pre/post-close concentration and recurrence |
| `customer-qualification` | 1.0.0 | active | commercial-dd-agent | 2026-08-20 | — | Wave 5.8H — PPAP/FAI/vendor-registration, distinct from regulatory certification |
| `data-freshness-and-revision-control` | 1.0.0 | active | dba | 2026-08-20 | — | Wave 5.8J — ADR-0004 operational counterpart to market-data-pipeline |
| `data-normalization` | 1.0.0 | active | dba | 2026-08-20 | — | Wave 5.8J — generalizes `financial-statement-analysis`'s real mapping-table pattern |
| `database-operations` | 1.0.0 | active | dba | 2026-08-20 | — | Wave 5.8K (design §9.2 merge) — absorbs backup-and-dr; ADR-0015 "a backup never restored is not verified" |
| `db-migration-governance` | 1.0.0 | active | dba | 2026-08-20 | — | Wave 5.8J — ADR-0001/0002 SQLite portability-regime conventions |
| `dd-to-valuation-bridge` | 1.2.0 | active | valuation-agent | 2026-10-01 | — | Wave 5.8H — assumption_key/value_impact connection audit across all DD workstreams; margin-axis vs. QoE double-count check |
|`deal-execution-playbook`|1.0.1| experimental |process-governance-manager|2026-09-08|—|Wave 5.8I — navigates `docs/governance/process-map.md`/`docs/governance/raci.md`'s real per-gate RACI, never restates|
| `deal-workspace-operations` | 1.1.0 | active | process-governance-manager | 2026-09-09 | — | Wave B1 — open/membership plus close/archive lifecycle via `PATCH /api/projects/:id/close` and `md_project.status` |
| `debt-and-contingent-liability-simulation` | 1.1.0 | active | risk-officer | 2026-08-23 | — | Wave 5.8D — ADR-0026 probability-weighted Monte Carlo integration, covenant Kill Criterion |
| `decision-record` | 1.1.0 | active | pm | 2026-08-25 | — | — |
| `deployment-and-release` | 1.0.0 | active | release-engineer | 2026-08-20 | — | Wave 5.8K (design §9.3 ops/security group — final Wave 5.8 sub-PR) — ADR-0014 rollback-planned-before-migration discipline |
| `design-lint` | 1.0.0 | active | design-system-agent | 2026-08-30 | — | ADR-0074 — Onyx 3.0 mechanical enforcement (hardcoded colors, onInput, icon-only buttons without aria-label, nested main); bun scripts/co-newbiz/design-lint.ts |
| `documentation-writing` | 1.0.3 | active | pm | 2026-07-19 | — | — |
| `evidence-ledger` | 1.1.0 | active | pm | 2026-08-25 | — | — |
| `executive-presentation` | 1.0.0 | active | docs-writer | 2026-08-20 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult — retargeted to Entity/Group IC deck |
| `expert-interview` | 1.1.0 | active | commercial-dd-agent | 2026-08-23 | — | Wave 5.8H — 2-3 source triangulation, disconfirming-question structure |
| `explain-me` | 1.0.0 | experimental | pm | 2026-08-03 | — | Single-file interactive HTML report generation. Inspired by beret21/reportme (MIT). Korean loanword data in references/loanword-refinements.json |
| `financial-statement-analysis` | 1.0.0 | active | financial-analyst | 2026-08-20 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult — DART pipeline, retargeted to co-newbiz's own `newbiz.ts fin:*` CLI |
| `financing-plan-review` | 1.2.0 | active | valuation-agent | 2026-08-23 | — | ADR-0051 (PR-10 workflow concretization) — certainty-of-funds evidence pack per chk-financing; DD step 12 + Entity IC precondition |
| `finishing-a-development-branch` | 1.0.1 | active | pm | 2026-06-13 | — | — |
|`forward-industry-research`|1.0.1| experimental | process-governance-manager |2026-08-29|—|ADR-0066 gap closure — forward/upstream industry qualitative research narrative feeding the driver registry|
| `gateguard` | 1.0.2 | active | pm | 2026-08-01 | — | — |
| `glossary-management` | 1.0.0 | active | glossary-curator | 2026-08-20 | — | Wave 5.8C (design §9.2 merge) — absorbs glossary-lint |
| `governance-document-hierarchy` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8B (design §9.3 governance-authoring group) — Policy/Procedure/Guideline/Checklist/Template layer classification |
| `greenfield-feasibility` | 1.2.0 | active | greenfield-agent | 2026-10-01 | — | Wave 5.8C — Green Field Screening/Pre-FS |
|`group-level-review`|1.0.1| experimental | process-governance-manager |2026-08-20|—|Wave 5.8C (design §9.3 group review + glossary + GF/BF gate groups) — orchestrates `group-investment-review`'s 5-step Group IC sequence|
| `growth-projection-modeling` | 1.1.0 | active | financial-analyst | 2026-08-23 | — | Wave 5.8G — ADR-0018 anchor_ref + top-decile base-rate warning, feeds the Kill Criterion |
| `handbook` | 0.6.0 | active | pm | 2026-09-20 | — | — |
|`handbook`|0.6.0|active|pm|2026-09-20|—|—|
|`handbook-sync-audit`|1.0.5|active| pm |2026-08-29|—|—|
| `historical-financial-analysis` | 1.0.0 | active | financial-analyst | 2026-08-20 | — | Wave 5.8G (design §9.3 financial/simulation group) — historical distribution feeding the growth-projection anchor |
| `hwp-document-processing` | 1.1.0 | active | docs-writer | 2026-09-09 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult — generation path only, extraction not yet ported (see SKILL.md Adaptation Note) |
| `i18n-audit` | 1.0.0 | active | pm | 2026-08-29 | — | — |
| `i18n-formatting` | 1.0.0 | active | pm | 2026-08-24 | — | — |
| `i18n-layout` | 1.0.0 | active | pm | 2026-08-24 | — | — |
| `i18n-locale-config` | 1.0.0 | active | pm | 2026-08-24 | — | — |
| `incentive-clawback-assessment` | 1.1.0 | active | incentive-agent | 2026-08-23 | — | Wave 5.8D — ADR-0030 one-table acquisition/clawback design |
| `incident-response` | 1.0.0 | active | sre | 2026-08-20 | — | Wave 5.8K — MNPI evidence pull, audit-log-integrity default-Critical rule |
| `industry-profile-application` | 1.0.0 | active | industry-lead | 2026-08-20 | — | Wave 5.8E — ADR-0024 profile-first principle; `industry-profiles/` does not exist yet, gap flagged explicitly |
| `infrastructure-automation` | 1.0.0 | active | infra-automation-engineer | 2026-08-20 | — | Wave 5.8K — automation must preserve existing operational discipline gates |
| `insight-synthesis` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult — cross-domain synthesis for stage-gate decisions |
| `interpretation-registry` | 1.0.0 | active | compliance-officer | 2026-08-20 | — | Wave 5.8B — FR-GOV-12 scoped supersession Q&A registry |
| `intra-group-transaction-compliance` | 1.1.0 | active | group-review-agent | 2026-08-23 | — | Wave 5.8C — Fair Trade Act Art. 47 screen, validated against pilot-003 |
| `investment-feasibility-modeling` | 1.2.0 | active | valuation-agent | 2026-09-22 | — | Wave 5.8G — synthesis skill assembling confirmed WACC/EBITDA/growth/site-cost inputs |
| `investment-vehicle-structuring` | 1.3.0 | active | brownfield-agent | 2026-08-23 | — | ADR-0045 — post-Wave-5.10 addendum, deal-structure-hypothesis vehicle axis (tax/liability-isolation/financing-leverage/exit) flagged during the pilot-001 system re-run |
| `jv-structuring` | 1.2.0 | active | partnership-agent | 2026-08-23 | — | Wave 5.8E — governance/valuation/exit/deadlock documented before term-sheet negotiation |
| `k-dart` | 2.1.2 | active | strategy-analyst | 2026-08-09 | — | Unified DART OpenAPI skill — disclosure query, financial parsing, line-item extraction; KR-scoped — deploys only to --country KR projects (registry: `country_scoped_assets`) |
| `k-kosis` | 1.0.2 | active | financial-analyst | 2026-08-23 | — | Korean Statistical Information Service (KOSIS) OpenAPI — national statistics search, table browsing, data retrieval, metadata lookup; KR-scoped — deploys only to --country KR projects (registry: `country_scoped_assets`) |
|`k-law`|1.0.3|active|strategy-analyst|2026-09-21|—|Korean Ministry of Government Legislation  OpenAPI — statutes, precedents, ordinances; KR-scoped — deploys only to --country KR projects (registry: `country_scoped_assets`)|
| `k-opendata` | 1.2.2 | active | hs-classification-specialist | 2026-09-03 | — | — |
| `legal-due-diligence` | 1.1.0 | active | legal-counsel | 2026-08-23 | — | ADR-0051 (PR-10 workflow concretization) — DD-grade legal workstream per chk-legal-dd; RAG findings register mapped to SPA protections |
|`legal-risk-register`|1.0.1| experimental | process-governance-manager |2026-08-20|—|Wave 5.8H — consolidated per-project legal-risk view|
| `management-incentive-review` | 1.1.0 | active | incentive-agent | 2026-08-23 | — | Wave 5.8D — CoC-trigger executive compensation, role-based per PII discipline |
|`market-data-pipeline`|1.0.1| experimental | process-governance-manager |2026-08-20|—|Wave A1 — ADR-0004 cache-first/revision-preserving policy implemented via source-adapter framework; `fetch` and `md:sync` CLI live with fail-closed credentials, KOSIS unit quarantine, and natural-key catalog upserts|
| `master-data-governance` | 1.0.0 | active | dba | 2026-08-20 | — | Wave 5.8J (design §9.3 platform group) — real `staging_unmapped` queue resolution |
| `mcp-server-integration` | 1.0.0 | active | backend-engineer | 2026-08-20 | — | Wave 5.8J — ADR-0011 REST-only, enforced by the real bun:test DB-import scan |
| `meeting` | 1.4.1 | active | pm | 2026-09-13 | — | — |
| `committee-deliberation` | 1.6.0 | active | pm | 2026-09-13 | — | renamed from meeting-facilitation 1.5.0 — engine-run committee deliberation (ADR-0096/0097), distinct from the common meeting-facilitation flow |
| `meeting-facilitation` | 1.4.4 | active | pm | 2026-09-26 | — | adopted from templates/common 1.4.1 — common collaborative meeting flow; /meeting command |
| `monte-carlo-simulation` | 1.1.0 | active | risk-officer | 2026-08-23 | — | Wave 5.8G — ADR-0026 seeded, deterministic `python/monte_carlo.py` P50/P95 NPV |
| `notification-channel-management` | 1.0.0 | active | sre | 2026-08-20 | — | Wave 5.8J — real watch_rule/notification schema, channel/bundle/severity discipline |
| `observability-and-alerting` | 1.0.0 | active | sre | 2026-08-20 | — | Wave 5.8K — platform-health counterpart to continuous-monitoring-and-alerting |
| `org-readiness-assessment` | 1.1.0 | active | hr-integration-agent | 2026-08-23 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult |
| `partner-due-diligence` | 1.1.0 | active | partnership-agent | 2026-08-20 | — | Wave 5.8E — compliance/financial/dependency screening incl. post-transfer competitor risk |
| `partner-sourcing-strategy` | 1.1.0 | active | partnership-agent | 2026-08-20 | — | Wave 5.8E (design §9.3 partnership + region/industry groups) — ADR-0031 hard/soft partner-dependency classification |
| `peer-benchmarking` | 1.0.0 | active | financial-analyst | 2026-08-20 | — | Wave 5.8G — cross-sectional peer distribution, the other anchor input |
| `permit-pathway-mapping` | 1.1.0 | active | legal-counsel | 2026-08-23 | — | Wave 5.8H — permit DAG + critical path, strictly separate from certification |
| `platform-command-lifecycle-manager` | 1.0.3 | active | pm | 2026-09-25 | — | — |
| `platform-skill-lifecycle-manager` | 1.0.2 | active | pm | 2026-05-31 | — | — |
| `pmi-planning` | 1.1.0 | active | pmi-agent | 2026-08-23 | — | Wave 5.8D — synthesis skill sequencing the other five M&A special-topics outputs |
|`policy-and-procedure-governance`|1.0.1| experimental |process-governance-manager|2026-08-23|—|Wave 5.8B — Policy/Procedure authoring, entity addenda and shared/entity/region procedure model|
| `policy-change-impact-analysis` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8B — mandatory pre-amendment impact analysis, `project_policy_pin` retroactivity |
| `portfolio-fit-assessment` | 1.3.0 | active | group-review-agent | 2026-08-23 | — | Wave 5.8C — overlap finding + agenda-ranking formula (meeting M2 D-M2-2) |
| `procedure-reference-override` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8B — ADR-0020 shared/entity/region override mechanics, `proc:resolve` |
| `project-review` | 1.3.2 | active | pm | 2026-10-08 | — | Graph-aligned project review runbook refresh |
| `proxy-industry-chain` | 1.1.0 | active | quant-methodologist | 2026-08-23 | — | Wave 5.8F (design §9.3 market/proxy-chain group) — ADR-0006 statistical-hop-only grading rule |
| `quality-of-earnings` | 1.2.0 | active | financial-analyst | 2026-10-01 | — | Wave 5.8G — EBITDA normalization bridge for Brown Field DD; customer-level inputs to cdd-08 |
| `query-performance-tuning` | 1.0.0 | active | dba | 2026-08-20 | — | Wave 5.8J — membership-filtering join as the highest-traffic query pattern |
| `rag-scoring-framework` | 1.1.0 | active | process-governance-manager | 2026-08-23 | — | Wave 5.8I (design §9.3 RAG/quality + deal-execution axis C groups) — ADR-0016 priority-ordered (not weighted-average) overall grade |
| `region-profile-application` | 1.0.0 | active | region-lead | 2026-08-20 | — | Wave 5.8E — ADR-0023's 10 mandatory review axes, real `region-profiles/*.yaml` (KR/EU/US/CN/SEA) |
| `regional-incentive-sourcing` | 1.1.0 | active | greenfield-agent | 2026-08-23 | — | Wave 5.8C (design §9.2 merge) — absorbs site-comparison, incentive-NPV on one comparison table |
| `regulation-monitoring` | 1.0.0 | active | legal-counsel | 2026-08-20 | — | Wave 5.8B — portfolio-wide statute watch feeding the amendment pipeline |
| `regulatory-change-response` | 1.0.0 | active | legal-counsel | 2026-08-20 | — | Wave 5.8H — pre-effective-date response planning |
|`regulatory-screening`|1.0.1| experimental | process-governance-manager |2026-08-23|—|Wave 5.8H (design §9.3 legal/certification/DD group) — Screening-gate region/foreign-investment/sanctions checks|
| `research-analysis` | 1.0.2 | active | pm | 2026-07-19 | — | — |
| `rest-api-design` | 1.0.0 | active | backend-engineer | 2026-08-20 | — | Wave 5.8J — api-spec.md non-negotiables, 404-not-403, envelope shape |
| `run-versioning-and-attribution` | 1.0.0 | active | data-architect | 2026-08-20 | — | Wave 5.8I — ADR-0005 immutable run_input/input_hash, superseded_by chains |
|`sample-driven-report-writing`|1.0.1| experimental | process-governance-manager |2026-08-20|—|Wave 5.8A reuse layer, adapted from Projects/co-consult|
| `scenario-planning` | 1.1.0 | active | risk-officer | 2026-08-23 | — | Wave 5.8G — discrete downside/base/upside cases incl. mandatory +200bp rate-shock test |
| `script-lifecycle-manager` | 1.2.2 | active | pm | 2026-05-30 | — | — |
| `security-baseline-review` | 1.0.0 | active | security-engineer | 2026-08-20 | — | Wave 5.8K — orchestrates `docs/security/security-baseline.md`'s real recurring cadence |
| `security-scan` | 1.2.0 | active | pm | 2026-08-30 | — | Reassigned from security-expert — not defined in templates/common/agents/ or any variant, caused orphan on every propagated variant |
| `site-infrastructure-assessment` | 1.1.0 | active | greenfield-agent | 2026-08-23 | — | Wave 5.8C — mandatory infrastructure-minimums exclusion filter |
| `site-visit-protocol` | 1.1.0 | active | technical-dd-agent | 2026-08-23 | — | Wave 5.8H — evidence-capture discipline (photo/measurement/log) |
| `skill-lifecycle-manager` | 1.5.0 | active | pm | 2026-09-21 | — | — |
|`skill-lifecycle-manager`|1.5.0|active|pm|2026-09-21|—|—|
| `source-command-commit-push-pr` | 1.0.3 | active | pm | — | — | — |
| `stage-gate-governance` | 1.4.1 | active | process-governance-manager | 2026-09-22 | — | Wave 5.8C — Screening-DD-Entity IC-Group IC sequence + 6-item Kill Criteria list |
| `standup-synthesizer` | 1.0.0 | active | pm | 2026-08-06 | — | Daily standup digest synthesizer aggregating commits, issues, PRs, and blockers |
| `statute-change-monitoring` | 1.0.0 | active | legal-counsel | 2026-08-20 | — | Wave 5.8H — project-scoped DD counterpart to regulation-monitoring |
| `strategic-fit-screening` | 1.1.0 | active | process-governance-manager | 2026-08-23 | — | ADR-0051 (PR-10 workflow concretization) — entity-level knock-out + scorecard screen at first gate per chk-strategic-fit; thresholds illustrative until the thresholds meeting |
| `sync` | 1.6.0 | active | pm | 2026-09-17 | — | Full project sync pipeline — lifecycle, audit, publish, commit, push, PR. Reassigned from lifecycle-manager — same orphan cause as security-scan |
| `sync` | 1.8.0 | active | pm | 2026-10-08 | — | Full project sync pipeline — lifecycle, audit, publish, commit, push, PR. Reassigned from lifecycle-manager — same orphan cause as security-scan |
| `systematic-market-sizing` | 1.5.0 | active | market-intelligence-agent | 2026-09-03 | — | — |
| `talent-pipeline-planning` | 1.1.0 | active | hr-integration-agent | 2026-08-23 | — | Wave 5.8C — Green Field local labor-market supply assessment |
| `team-builder` | 1.1.0 | active | pm | 2026-06-13 | — | — |
| `technical-due-diligence` | 1.1.0 | active | technical-dd-agent | 2026-08-23 | — | Wave 5.8H — checklist tdd-01-08, independently-verified capex plan |
| `token-usage-lint` | 1.1.0 | active | pm | 2026-09-06 | - | - |
| `translate` | 1.0.3 | active | pm | 2026-08-24 | — | — |
| `two-tier-approval-chain` | 1.1.0 | active | process-governance-manager | 2026-08-23 | — | Wave 5.8B — Entity IC gating + Group IC ranking (ADR-0028/0029) |
| `ui-information-architecture` | 1.0.0 | active | frontend-engineer | 2026-08-20 | — | Wave 5.8J — ui-spec.md non-negotiables, real component patterns from Wave 5.6B |
| `ui-ux-design-intelligence` | 1.0.1 | active | pm | 2026-09-06 | - | - |
| `unit-conversion-calibration` | 1.0.0 | active | quant-methodologist | 2026-08-20 | — | Wave 5.8F — lead-lag OLS regression, `python/correlation.py` |
| `update-bun-packages` | 1.3.1 | active | pm | 2026-09-09 | — | — |
| `validate-docs-links` | 1.0.0 | active | pm | 2026-05-30 | — | Reassigned from docs-writer — same orphan cause as security-scan |
|`value-chain-driver-identification`|1.0.1| experimental | process-governance-manager |2026-08-29|—|ADR-0066 gap closure — per-stage driver sensitivity derivation via correlation/lead-lag|
| `value-chain-linkage-analysis` | 1.1.0 | active | quant-methodologist | 2026-08-23 | — | Wave 5.8F — ADR-0025 deliberate separation from proxy-chain betas |
|`value-chain-stage-financials`|1.0.1| experimental | process-governance-manager |2026-08-29|—|ADR-0066 gap closure — per-chain-node 5-year KPI rollup pipeline into `fact_industry`|
| `vulnerability-management` | 1.0.0 | active | security-engineer | 2026-08-20 | — | Wave 5.8K — CVE-check merge gate, mandatory recorded risk-acceptance for unpatched Critical/High |
| `wacc-input-session` | 1.3.1 | active | valuation-agent | 2026-09-22 | — | Wave 5.8G — kind=user WACC/hurdle-IRR confirmation gate (checklist bf-02) |
| `waiver-management` | 1.0.1 | experimental | process-governance-manager | 2026-09-08 | — | Wave 5.8B — ADR-0036 mandatory-expiry waiver lifecycle |
| `zod-contract-gate` | 1.0.2 | active | architect | 2026-08-06 | — | Defines Zod runtime schema validation patterns and contract safety rules |






### Variant-Exclusive Skills
### Variant-Exclusive Skills


Skills registered in the catalog but without a `skills/<name>/` directory in the workspace root. These live exclusively inside variant templates (`templates/co-*/skills/`) and are only available when that variant is active.
Skills registered in the catalog but without a `skills/<name>/` directory in the workspace root. These live exclusively inside variant templates (`templates/co-*/skills/`) and are only available when that variant is active.


| skill | version | status | owner | last_reviewed | removal-date | variant |
| skill | version | status | owner | last_reviewed | removal-date | variant |
|-------|---------|--------|-------|---------------|--------------|---------|
|-------|---------|--------|-------|---------------|--------------|---------|
| `change-impact-assessment` | 1.0.0 | active | pm | 2026-06-06 | — | co-consult only |
| `consulting-report-writing` | 1.0.0 | active | pm | 2026-06-06 | — | co-consult only |
| `design` | 1.2.0 | active | pm | 2026-06-20 | — | co-deck only |
| `financial-modeling` | 1.0.0 | active | pm | 2026-06-06 | — | co-consult only |
| `html-build` | 1.3.1 | active | pm | 2026-06-21 | — | co-deck only |
| `measure` | 1.3.0 | active | pm | 2026-06-20 | — | co-deck only |
| `narrative-framework` | 1.0.0 | active | pm | 2026-06-06 | — | co-consult only |
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
| `target-costing-analysis` | 1.0.1 | experimental | process-governance-manager | — | — | Added by fleet resync reconcile backfill (2026-09-22) |
| `design-foundation` | 1.1.0 | active | architect | 2026-09-26 | — | — |
| `service-design` | 1.1.0 | active | pm | 2026-09-27 | — | — |
