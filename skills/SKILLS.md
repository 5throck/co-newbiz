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
| `k-dart` | 2.0.0 | active | strategy-analyst | 2026-08-09 | — | Unified DART OpenAPI skill — disclosure query, financial parsing, line-item extraction; KR-scoped — deploys only to --country KR projects (registry: `country_scoped_assets`) |
| `k-law` | 1.0.0 | active | strategy-analyst | 2026-08-09 | — | Korean Ministry of Government Legislation  OpenAPI — statutes, precedents, ordinances; KR-scoped — deploys only to --country KR projects (registry: `country_scoped_assets`) |
| `k-kosis` | 1.0.0 | active | financial-analyst | 2026-08-23 | — | Korean Statistical Information Service (KOSIS) OpenAPI — national statistics search, table browsing, data retrieval, metadata lookup; KR-scoped — deploys only to --country KR projects (registry: `country_scoped_assets`) |
| `meeting-facilitation` | 1.4.0 | active | pm | 2026-06-05 | — | — |
| `project-review` | 1.1.0 | active | pm | 2026-07-10 | — | — |
| `script-lifecycle-manager` | 1.2.0 | active | pm | 2026-05-30 | — | — |
| `security-scan` | 1.0.0 | active | pm | 2026-07-19 | — | Reassigned from security-expert — not defined in templates/common/agents/ or any variant, caused orphan on every propagated variant |
| `skill-lifecycle-manager` | 1.2.0 | active | pm | 2026-05-30 | — | — |
| `sync` | 1.1.0 | active | pm | 2026-07-19 | — | Full project sync pipeline — lifecycle, audit, publish, commit, push, PR. Reassigned from lifecycle-manager — same orphan cause as security-scan |
| `team-builder` | 1.1.0 | active | pm | 2026-06-06 | — | — |
| `translate` | 1.0.0 | active | pm | 2026-06-06 | — | — |
| `validate-docs-links` | 1.0.0 | active | pm | 2026-07-19 | — | Reassigned from docs-writer — same orphan cause as security-scan |
| `explain-me` | 1.0.0 | experimental | pm | 2026-08-03 | — | Single-file interactive HTML report generation. Inspired by beret21/reportme (MIT). Korean loanword data in references/loanword-refinements.json |
| `zod-contract-gate` | 1.0.0 | active | architect | 2026-08-06 | — | Defines Zod runtime schema validation patterns and contract safety rules |
| `standup-synthesizer` | 1.0.0 | active | pm | 2026-08-06 | — | Daily standup digest synthesizer aggregating commits, issues, PRs, and blockers |
| `financial-statement-analysis` | 1.0.0 | active | financial-analyst | 2026-08-20 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult — DART pipeline, retargeted to co-newbiz's own `newbiz.ts fin:*` CLI |
| `insight-synthesis` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult — cross-domain synthesis for stage-gate decisions |
| `competitive-intelligence` | 1.0.0 | 1.1.0 | market-intelligence-agent | 2026-08-20 | 2026-08-23 | Wave 5.8A reuse layer, adapted from Projects/co-consult |
| `company-intelligence` | 1.0.0 | active | market-intelligence-agent | 2026-08-20 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult |
| `executive-presentation` | 1.0.0 | active | docs-writer | 2026-08-20 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult — retargeted to Entity/Group IC deck |
| `sample-driven-report-writing` | 1.0.0 | active | docs-writer | 2026-08-20 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult |
| `hwp-document-processing` | 1.0.0 | active | docs-writer | 2026-08-20 | — | Wave 5.8A reuse layer, adapted from Projects/co-consult — generation path only, extraction not yet ported (see SKILL.md Adaptation Note) |
| `org-readiness-assessment` | 1.0.0 | 1.1.0 | hr-integration-agent | 2026-08-20 | 2026-08-23 | Wave 5.8A reuse layer, adapted from Projects/co-consult |
| `governance-document-hierarchy` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8B (design §9.3 governance-authoring group) — Policy/Procedure/Guideline/Checklist/Template layer classification |
| `policy-and-procedure-governance` | 1.0.0 | 1.1.0 | process-governance-manager | 2026-08-20 | 2026-08-23 | Wave 5.8B — Policy/Procedure authoring, entity addenda and shared/entity/region procedure model |
| `procedure-reference-override` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8B — ADR-0020 shared/entity/region override mechanics, `proc:resolve` |
| `two-tier-approval-chain` | 1.0.0 | 1.1.0 | process-governance-manager | 2026-08-20 | 2026-08-23 | Wave 5.8B — Entity IC gating + Group IC ranking (ADR-0028/0029) |
| `policy-change-impact-analysis` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8B — mandatory pre-amendment impact analysis, `project_policy_pin` retroactivity |
| `regulation-monitoring` | 1.0.0 | active | legal-counsel | 2026-08-20 | — | Wave 5.8B — portfolio-wide statute watch feeding the amendment pipeline |
| `adr-governance` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8B — design §7 ADR trigger-list check and drafting |
| `compliance-monitoring` | 1.0.0 | 1.1.0 | compliance-officer | 2026-08-20 | 2026-08-23 | Wave 5.8B (design §9.2 merge) — absorbs governance-training-and-notice, governance-kpi-reporting |
| `waiver-management` | 1.0.0 | active | compliance-officer | 2026-08-20 | — | Wave 5.8B — ADR-0036 mandatory-expiry waiver lifecycle |
| `interpretation-registry` | 1.0.0 | active | compliance-officer | 2026-08-20 | — | Wave 5.8B — FR-GOV-12 scoped supersession Q&A registry |
| `checklist-authoring` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8B — item-by-item mandatory/waiver_eligible checklist layer |
| `group-level-review` | 1.0.0 | active | group-review-agent | 2026-08-20 | — | Wave 5.8C (design §9.3 group review + glossary + GF/BF gate groups) — orchestrates `group-investment-review`'s 5-step Group IC sequence |
| `portfolio-fit-assessment` | 1.0.0 | 1.1.0 | group-review-agent | 2026-08-20 | 2026-08-23 | Wave 5.8C — overlap finding + agenda-ranking formula (meeting M2 D-M2-2) |
| `intra-group-transaction-compliance` | 1.0.0 | 1.1.0 | group-review-agent | 2026-08-20 | 2026-08-23 | Wave 5.8C — Fair Trade Act Art. 47 screen, validated against pilot-003 |
| `glossary-management` | 1.0.0 | active | glossary-curator | 2026-08-20 | — | Wave 5.8C (design §9.2 merge) — absorbs glossary-lint |
| `stage-gate-governance` | 1.0.0 | 1.1.0 | process-governance-manager | 2026-08-20 | 2026-08-23 | Wave 5.8C — Screening-DD-Entity IC-Group IC sequence + 6-item Kill Criteria list |
| `greenfield-feasibility` | 1.0.0 | 1.1.0 | greenfield-agent | 2026-08-20 | 2026-08-23 | Wave 5.8C — Green Field Screening/Pre-FS |
| `brownfield-feasibility` | 1.0.0 | 1.1.0 | brownfield-agent | 2026-08-20 | 2026-08-23 | Wave 5.8C — Brown Field Screening/Pre-FS/FS/DD incl. six-validator completeness gate |
| `site-infrastructure-assessment` | 1.0.0 | 1.1.0 | greenfield-agent | 2026-08-20 | 2026-08-23 | Wave 5.8C — mandatory infrastructure-minimums exclusion filter |
| `regional-incentive-sourcing` | 1.0.0 | 1.1.0 | greenfield-agent | 2026-08-20 | 2026-08-23 | Wave 5.8C (design §9.2 merge) — absorbs site-comparison, incentive-NPV on one comparison table |
| `talent-pipeline-planning` | 1.0.0 | 1.1.0 | hr-integration-agent | 2026-08-20 | 2026-08-23 | Wave 5.8C — Green Field local labor-market supply assessment |
| `community-partnership-planning` | 1.0.0 | 1.1.0 | hr-integration-agent | 2026-08-20 | 2026-08-23 | Wave 5.8C — workforce-development partnerships and community-relations risk |
| `antitrust-screening` | 1.0.0 | 1.1.0 | antitrust-agent | 2026-08-20 | 2026-08-23 | Wave 5.8D (design §9.3 M&A special-topics group) — HHI incl. common-ownership combinations (pilot 010 F-2) |
| `customer-attrition-risk` | 1.0.0 | 1.1.0 | customer-retention-agent | 2026-08-20 | 2026-08-23 | Wave 5.8D — CoC-clause scan incl. retained-seller-as-supplier (pilot 002 F-2) |
| `incentive-clawback-assessment` | 1.0.0 | 1.1.0 | incentive-agent | 2026-08-20 | 2026-08-23 | Wave 5.8D — ADR-0030 one-table acquisition/clawback design |
| `management-incentive-review` | 1.0.0 | 1.1.0 | incentive-agent | 2026-08-20 | 2026-08-23 | Wave 5.8D — CoC-trigger executive compensation, role-based per PII discipline |
| `compensation-harmonization-analysis` | 1.0.0 | active | hr-integration-agent | 2026-08-20 | — | Wave 5.8D — ADR-0027 bidirectional upward-bias verification rule |
| `debt-and-contingent-liability-simulation` | 1.0.0 | 1.1.0 | risk-officer | 2026-08-20 | 2026-08-23 | Wave 5.8D — ADR-0026 probability-weighted Monte Carlo integration, covenant Kill Criterion |
| `pmi-planning` | 1.0.0 | active | pmi-agent | 2026-08-20 | — | Wave 5.8D — synthesis skill sequencing the other five M&A special-topics outputs |
| `partner-sourcing-strategy` | 1.0.0 | active | partnership-agent | 2026-08-20 | — | Wave 5.8E (design §9.3 partnership + region/industry groups) — ADR-0031 hard/soft partner-dependency classification |
| `partner-due-diligence` | 1.0.0 | active | partnership-agent | 2026-08-20 | — | Wave 5.8E — compliance/financial/dependency screening incl. post-transfer competitor risk |
| `jv-structuring` | 1.0.0 | active | partnership-agent | 2026-08-20 | — | Wave 5.8E — governance/valuation/exit/deadlock documented before term-sheet negotiation |
| `region-profile-application` | 1.0.0 | active | region-lead | 2026-08-20 | — | Wave 5.8E — ADR-0023's 10 mandatory review axes, real `region-profiles/*.yaml` (KR/EU/US/CN/SEA) |
| `industry-profile-application` | 1.0.0 | active | industry-lead | 2026-08-20 | — | Wave 5.8E — ADR-0024 profile-first principle; `industry-profiles/` does not exist yet, gap flagged explicitly |
| `proxy-industry-chain` | 1.0.0 | active | quant-methodologist | 2026-08-20 | — | Wave 5.8F (design §9.3 market/proxy-chain group) — ADR-0006 statistical-hop-only grading rule |
| `value-chain-linkage-analysis` | 1.0.0 | 1.1.0 | quant-methodologist | 2026-08-20 | 2026-08-23 | Wave 5.8F — ADR-0025 deliberate separation from proxy-chain betas |
| `value-chain-stage-financials` | 1.0.0 | active | financial-analyst | 2026-08-29 | — | ADR-0066 gap closure — per-chain-node 5-year KPI rollup pipeline into `fact_industry` |
| `forward-industry-research` | 1.0.0 | active | market-intelligence-agent | 2026-08-29 | — | ADR-0066 gap closure — forward/upstream industry qualitative research narrative feeding the driver registry |
| `value-chain-driver-identification` | 1.0.0 | active | quant-methodologist | 2026-08-29 | — | ADR-0066 gap closure — per-stage driver sensitivity derivation via correlation/lead-lag |
| `unit-conversion-calibration` | 1.0.0 | active | quant-methodologist | 2026-08-20 | — | Wave 5.8F — lead-lag OLS regression, `python/correlation.py` |
| `market-data-pipeline` | 1.0.0 | active | data-architect | 2026-08-20 | — | Wave 5.8F — ADR-0004 cache-first/revision-preserving policy; `fetch`/`md:sync` CLI not yet implemented, gap flagged explicitly |
| `historical-financial-analysis` | 1.0.0 | active | financial-analyst | 2026-08-20 | — | Wave 5.8G (design §9.3 financial/simulation group) — historical distribution feeding the growth-projection anchor |
| `peer-benchmarking` | 1.0.0 | active | financial-analyst | 2026-08-20 | — | Wave 5.8G — cross-sectional peer distribution, the other anchor input |
| `growth-projection-modeling` | 1.0.0 | 1.1.0 | financial-analyst | 2026-08-20 | 2026-08-23 | Wave 5.8G — ADR-0018 anchor_ref + top-decile base-rate warning, feeds the Kill Criterion |
| `quality-of-earnings` | 1.0.0 | 1.1.0 | financial-analyst | 2026-08-20 | 2026-08-23 | Wave 5.8G — EBITDA normalization bridge for Brown Field DD |
| `wacc-input-session` | 1.0.0 | 1.1.0 | valuation-agent | 2026-08-20 | 2026-08-23 | Wave 5.8G — kind=user WACC/hurdle-IRR confirmation gate (checklist bf-02) |
| `investment-feasibility-modeling` | 1.0.0 | 1.1.0 | valuation-agent | 2026-08-20 | 2026-08-23 | Wave 5.8G — synthesis skill assembling confirmed WACC/EBITDA/growth/site-cost inputs |
| `scenario-planning` | 1.0.0 | active | risk-officer | 2026-08-20 | — | Wave 5.8G — discrete downside/base/upside cases incl. mandatory +200bp rate-shock test |
| `monte-carlo-simulation` | 1.0.0 | active | risk-officer | 2026-08-20 | — | Wave 5.8G — ADR-0026 seeded, deterministic `python/monte_carlo.py` P50/P95 NPV |
| `regulatory-screening` | 1.0.0 | 1.1.0 | legal-counsel | 2026-08-20 | 2026-08-23 | Wave 5.8H (design §9.3 legal/certification/DD group) — Screening-gate region/foreign-investment/sanctions checks |
| `permit-pathway-mapping` | 1.0.0 | 1.1.0 | legal-counsel | 2026-08-20 | 2026-08-23 | Wave 5.8H — permit DAG + critical path, strictly separate from certification |
| `certification-roadmap` | 1.0.0 | active | certification-agent | 2026-08-20 | — | Wave 5.8H — certification gap analysis, strictly separate from permits |
| `certification-transferability` | 1.0.0 | 1.2.0 | certification-agent | 2026-08-20 | 2026-08-23 | Wave 5.8H — CoC transferability confirmed against the certifying body's own rules; inference disallowed |
| `regulatory-change-response` | 1.0.0 | active | legal-counsel | 2026-08-20 | — | Wave 5.8H — pre-effective-date response planning |
| `customer-qualification` | 1.0.0 | active | commercial-dd-agent | 2026-08-20 | — | Wave 5.8H — PPAP/FAI/vendor-registration, distinct from regulatory certification |
| `statute-change-monitoring` | 1.0.0 | active | legal-counsel | 2026-08-20 | — | Wave 5.8H — project-scoped DD counterpart to regulation-monitoring |
| `legal-risk-register` | 1.0.0 | active | legal-counsel | 2026-08-20 | — | Wave 5.8H — consolidated per-project legal-risk view |
| `commercial-due-diligence` | 1.0.0 | 1.1.0 | commercial-dd-agent | 2026-08-20 | 2026-08-23 | Wave 5.8H — checklist cdd-01-07, no-narrative-only-finding rule |
| `technical-due-diligence` | 1.0.0 | 1.1.0 | technical-dd-agent | 2026-08-20 | 2026-08-23 | Wave 5.8H — checklist tdd-01-08, independently-verified capex plan |
| `site-visit-protocol` | 1.0.0 | 1.1.0 | technical-dd-agent | 2026-08-20 | 2026-08-23 | Wave 5.8H — evidence-capture discipline (photo/measurement/log) |
| `expert-interview` | 1.0.0 | active | commercial-dd-agent | 2026-08-20 | — | Wave 5.8H — 2-3 source triangulation, disconfirming-question structure |
| `dd-to-valuation-bridge` | 1.0.0 | 1.1.0 | valuation-agent | 2026-08-20 | 2026-08-23 | Wave 5.8H — assumption_key/value_impact connection audit across all DD workstreams |
| `rag-scoring-framework` | 1.0.0 | 1.1.0 | process-governance-manager | 2026-08-20 | 2026-08-23 | Wave 5.8I (design §9.3 RAG/quality + deal-execution axis C groups) — ADR-0016 priority-ordered (not weighted-average) overall grade |
| `run-versioning-and-attribution` | 1.0.0 | active | data-architect | 2026-08-20 | — | Wave 5.8I — ADR-0005 immutable run_input/input_hash, superseded_by chains |
| `assumption-audit` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8I — user/assumed/derived kind-tag correctness audit |
| `deal-execution-playbook` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8I — navigates `docs/process-map.md`/`docs/raci.md`'s real per-gate RACI, never restates |
| `agent-output-provenance` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8I — `analysis_task.reviewed_by` design intent; table not yet migrated, gap flagged explicitly |
| `deal-workspace-operations` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8I — open/membership real and live; closure/archival not yet implemented, gap flagged explicitly |
| `master-data-governance` | 1.0.0 | active | dba | 2026-08-20 | — | Wave 5.8J (design §9.3 platform group) — real `staging_unmapped` queue resolution |
| `data-normalization` | 1.0.0 | active | dba | 2026-08-20 | — | Wave 5.8J — generalizes `financial-statement-analysis`'s real mapping-table pattern |
| `data-freshness-and-revision-control` | 1.0.0 | active | dba | 2026-08-20 | — | Wave 5.8J — ADR-0004 operational counterpart to market-data-pipeline |
| `db-migration-governance` | 1.0.0 | active | dba | 2026-08-20 | — | Wave 5.8J — ADR-0001/0002 SQLite portability-regime conventions |
| `query-performance-tuning` | 1.0.0 | active | dba | 2026-08-20 | — | Wave 5.8J — membership-filtering join as the highest-traffic query pattern |
| `rest-api-design` | 1.0.0 | active | backend-engineer | 2026-08-20 | — | Wave 5.8J — api-spec.md non-negotiables, 404-not-403, envelope shape |
| `mcp-server-integration` | 1.0.0 | active | backend-engineer | 2026-08-20 | — | Wave 5.8J — ADR-0011 REST-only, enforced by the real bun:test DB-import scan |
| `ui-information-architecture` | 1.0.0 | active | frontend-engineer | 2026-08-20 | — | Wave 5.8J — ui-spec.md non-negotiables, real component patterns from Wave 5.6B |
| `auth-and-account-management` | 1.0.0 | active | security-engineer | 2026-08-20 | — | Wave 5.8J — existence-never-leaked auth, dual-credential must-change-password gating |
| `continuous-monitoring-and-alerting` | 1.0.0 | active | sre | 2026-08-20 | — | Wave 5.8J — ADR-0017 bidirectional (deterioration non-optional) notification policy |
| `notification-channel-management` | 1.0.0 | active | sre | 2026-08-20 | — | Wave 5.8J — real watch_rule/notification schema, channel/bundle/severity discipline |
| `deployment-and-release` | 1.0.0 | active | release-engineer | 2026-08-20 | — | Wave 5.8K (design §9.3 ops/security group — final Wave 5.8 sub-PR) — ADR-0014 rollback-planned-before-migration discipline |
| `database-operations` | 1.0.0 | active | dba | 2026-08-20 | — | Wave 5.8K (design §9.2 merge) — absorbs backup-and-dr; ADR-0015 "a backup never restored is not verified" |
| `observability-and-alerting` | 1.0.0 | active | sre | 2026-08-20 | — | Wave 5.8K — platform-health counterpart to continuous-monitoring-and-alerting |
| `incident-response` | 1.0.0 | active | sre | 2026-08-20 | — | Wave 5.8K — MNPI evidence pull, audit-log-integrity default-Critical rule |
| `batch-scheduling-operations` | 1.0.0 | active | infra-automation-engineer | 2026-08-20 | — | Wave 5.8K — ADR-0019 OS-level scheduler, never in-process timer |
| `infrastructure-automation` | 1.0.0 | active | infra-automation-engineer | 2026-08-20 | — | Wave 5.8K — automation must preserve existing operational discipline gates |
| `security-baseline-review` | 1.0.0 | active | security-engineer | 2026-08-20 | — | Wave 5.8K — orchestrates `docs/security-baseline.md`'s real recurring cadence |
| `vulnerability-management` | 1.0.0 | active | security-engineer | 2026-08-20 | — | Wave 5.8K — CVE-check merge gate, mandatory recorded risk-acceptance for unpatched Critical/High |
| `access-control-review` | 1.0.0 | active | security-engineer | 2026-08-20 | — | Wave 5.8K — monthly stale-membership revocation, quarterly admin-count review |
| `admin-console-operations` | 1.0.0 | active | process-governance-manager | 2026-08-20 | — | Wave 5.8K — operates the 3 built admin sections, names the 7 not yet built |
| `investment-vehicle-structuring` | 1.0.0 | 1.1.0 | brownfield-agent | 2026-08-20 | 2026-08-23 | ADR-0045 — post-Wave-5.10 addendum, deal-structure-hypothesis vehicle axis (tax/liability-isolation/financing-leverage/exit) flagged during the pilot-001 system re-run |
| `strategic-fit-screening` | 1.0.0 | 1.1.0 | process-governance-manager | 2026-08-22 | 2026-08-23 | ADR-0051 (PR-10 workflow concretization) — entity-level knock-out + scorecard screen at first gate per chk-strategic-fit; thresholds illustrative until the thresholds meeting |
| `design-lint` | 1.0.0 | active | design-system-agent | 2026-08-30 | — | ADR-0074 — Onyx 3.0 mechanical enforcement (hardcoded colors, onInput, icon-only buttons without aria-label, nested main); bun scripts/co-newbiz/design-lint.ts |
| `legal-due-diligence` | 1.0.0 | 1.1.0 | legal-counsel | 2026-08-22 | 2026-08-23 | ADR-0051 (PR-10 workflow concretization) — DD-grade legal workstream per chk-legal-dd; RAG findings register mapped to SPA protections |
| `financing-plan-review` | 1.0.0 | 1.1.0 | valuation-agent | 2026-08-22 | 2026-08-23 | ADR-0051 (PR-10 workflow concretization) — certainty-of-funds evidence pack per chk-financing; DD step 12 + Entity IC precondition |



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
