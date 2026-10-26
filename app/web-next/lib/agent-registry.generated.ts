// GENERATED from agents/*.md — do not edit by hand; edit the agent md and
// regenerate via: bun scripts/co-newbiz/generate-agent-registry.ts
// ADR-0128 — 런타임 에이전트 레지스트리 (PM 라우터가 작업 수행 에이전트를
// 고르고, 시스템 프롬프트에 역할을 주입할 때 사용한다).
export interface AgentRegistryEntry { key: string; name: string; role: string; domain: string | null }

export const AGENT_REGISTRY: AgentRegistryEntry[] = [
  {
    "key": "antitrust-agent",
    "name": "Antitrust Agent",
    "role": "Antitrust and merger-control review — market definition, HHI calculation, multi-jurisdiction filing determination, gun-jumping compliance, and remedy scenario modeling",
    "domain": "functional"
  },
  {
    "key": "backend-engineer",
    "name": "Backend Engineer",
    "role": "Next.js Route Handler API, authentication, the MCP server (REST-client-only), the analysis-engine CLI, and the monitoring/alerting pipeline",
    "domain": "technical"
  },
  {
    "key": "brownfield-agent",
    "name": "Brownfield Agent",
    "role": "M&A review lead — deal-shape evaluation, target identification and screening, capability DD, deal-structure hypothesis, and entity-IC assembly for external-combination routes",
    "domain": "functional"
  },
  {
    "key": "certification-agent",
    "name": "Certification Agent",
    "role": "Certification and regulatory-response specialist — certification-continuity screening, gap mapping, and roadmap sequencing through procedure steps, structurally separate from permits",
    "domain": "functional"
  },
  {
    "key": "commercial-dd-agent",
    "name": "Commercial DD Agent",
    "role": "Commercial due diligence lead — customer concentration, pricing power, channel checks, and expert interviews under mandatory triangulation",
    "domain": "functional"
  },
  {
    "key": "compliance-officer",
    "name": "Compliance Officer",
    "role": "Runs the rules the team writes — gate compliance checks, waiver adjudication, interpretation registry, and governance KPIs",
    "domain": "functional"
  },
  {
    "key": "customer-retention-agent",
    "name": "Customer Retention Agent",
    "role": "Customer retention risk specialist — change-of-control clause scanning across customer and supplier contracts, concentration and competitive-overlap assessment, and attrition exposure quantification",
    "domain": "functional"
  },
  {
    "key": "data-architect",
    "name": "Data Architect",
    "role": "ERD, master data governance, normalization, indexing, migration design review, and portability — owner of the three-layer data architecture and run versioning",
    "domain": "technical"
  },
  {
    "key": "dba",
    "name": "DBA",
    "role": "Database operations — backup/restore, monthly recovery drills, performance tuning, capacity, and migration execution",
    "domain": "technical"
  },
  {
    "key": "design-system-agent",
    "name": "Design System Agent",
    "role": "Onyx 3.0 design system governance — token, component, and accessibility consistency enforcement via design-lint",
    "domain": "technical"
  },
  {
    "key": "docs-writer",
    "name": "Docs Writer Agent",
    "role": "Shared documentation specialist — formatting, language-policy enforcement, index hygiene, and record-format contracts across all four domains",
    "domain": "_shared"
  },
  {
    "key": "financial-analyst",
    "name": "Financial Analyst",
    "role": "Corporate-financial analysis owner — company profiles, business-case lines, per-target S8 modeling, target comparison, and financial DD",
    "domain": "functional"
  },
  {
    "key": "financing-agent",
    "name": "Financing Agent",
    "role": "Financing-structure advisor — debt/equity mix, project finance, government funds, and covenant structuring, by committee seat and co-review",
    "domain": "functional"
  },
  {
    "key": "frontend-engineer",
    "name": "Frontend Engineer",
    "role": "Next.js App Router UI, ECharts visualizations, the RAG dashboard, the admin console, accessibility, and next-intl localization",
    "domain": "technical"
  },
  {
    "key": "glossary-curator",
    "name": "Glossary Curator",
    "role": "Terminology authority — glossary registration, review, duplicate merging, and the four tooling integrations that keep definitions consistent",
    "domain": "functional"
  },
  {
    "key": "greenfield-agent",
    "name": "Greenfield Agent",
    "role": "New-establishment review lead — business-model sketching (S2), capability-gap resolution into Build/Partner/Hire/Invest (S5), and execution-baseline drafting (S11)",
    "domain": "functional"
  },
  {
    "key": "group-review-agent",
    "name": "Group Review Agent",
    "role": "Group-level review lead — portfolio fit, intra-group transaction compliance, capital-allocation ranking across concurrent proposals, and S12 venture portfolio monitoring",
    "domain": "functional"
  },
  {
    "key": "hr-integration-agent",
    "name": "HR Integration Agent",
    "role": "HR & labor integration specialist — HR due diligence, executive CoC compensation review, upward-bias compensation harmonization, people-transfer execution, and the HR & labor committee seat",
    "domain": "functional"
  },
  {
    "key": "i18n-specialist",
    "name": "I18N Specialist Agent",
    "role": "specialist",
    "domain": "_shared"
  },
  {
    "key": "incentive-agent",
    "name": "Incentive Agent",
    "role": "Policy-benefit specialist — incentive clawback exposure on M&A relocation, establishment incentives recorded with clawback conditions, obligation-register construction, and incentive-deadline tracking",
    "domain": "functional"
  },
  {
    "key": "industry-lead",
    "name": "Industry Lead",
    "role": "Industry domain lead — steward of the KSIC-anchored industry-profiles/*.yaml system and the industry-expert voice in steering committees and cross-domain review",
    "domain": "industry"
  },
  {
    "key": "infra-automation-engineer",
    "name": "Infra Automation Engineer",
    "role": "OS configuration, service registration, the scheduled-collection scheduler, and health-check/cleanup automation",
    "domain": "technical"
  },
  {
    "key": "ip-agent",
    "name": "IP Agent",
    "role": "Patent and IP advisory — landscape and FTO analysis, IP valuation input, trade-secret posture, and technology-licensing positions",
    "domain": "functional"
  },
  {
    "key": "ir-agent",
    "name": "IR Agent",
    "role": "Investor-relations advisory — equity story, disclosure discipline, investor communications, and market-perception risk",
    "domain": "functional"
  },
  {
    "key": "legal-counsel",
    "name": "Legal Counsel",
    "role": "Domestic and overseas statute, contract, and regulatory advisory — legal DD, permit pathway judgment, and information-handling determinations",
    "domain": "functional"
  },
  {
    "key": "market-intelligence-agent",
    "name": "Market Intelligence Agent",
    "role": "Market-facts owner — market sizing, competitive intelligence, value-chain linkage, S2 entry-market derivation, and S6 target longlist",
    "domain": "functional"
  },
  {
    "key": "partnership-agent",
    "name": "Partnership Agent",
    "role": "Partner sourcing, partner due diligence, and JV structuring — owner of the partner-track funnel (deal-shape-chain) and the S12 partnership health scorecard for brownfield partnerships",
    "domain": "functional"
  },
  {
    "key": "platform-lead",
    "name": "Platform Lead",
    "role": "Technical domain lead — cross-cutting architecture review, ADR review participation, and the AI-2nd technical reviewer seat",
    "domain": "technical"
  },
  {
    "key": "pm",
    "name": "Project Manager (PM) Agent",
    "role": "Orchestrates multi-agent workflows and enforces the PM Gateway quality gates",
    "domain": "_core"
  },
  {
    "key": "pmi-agent",
    "name": "PMI Agent",
    "role": "Post-merger integration specialist — integration plan baseline at kickoff, day-1/100-day cadence, BAU-exit evidence pack for the human certifier, and S12 integration monitoring of synergy run-rate and retention",
    "domain": "functional"
  },
  {
    "key": "process-governance-manager",
    "name": "Process Governance Manager",
    "role": "Functional-domain lead and process authority — design and review owner of the rules the pipeline runs on, not a dispatcher",
    "domain": "functional"
  },
  {
    "key": "quant-methodologist",
    "name": "Quant Methodologist",
    "role": "Quantitative-method owner — unit conversion, proxy-chain calibration, error propagation, WACC input sessions, and simulation method integrity",
    "domain": "functional"
  },
  {
    "key": "region-lead",
    "name": "Region Lead",
    "role": "Region domain lead — steward of the ISO-coded region-profiles/*.yaml system, owner of the EU works-council override step, and the region-expert voice in steering committees",
    "domain": "region"
  },
  {
    "key": "release-engineer",
    "name": "Release Engineer",
    "role": "Build and deployment pipeline, migration execution ordering, and rollback procedures",
    "domain": "technical"
  },
  {
    "key": "risk-officer",
    "name": "Risk Officer",
    "role": "Red-team function — optimism-bias audits, base-rate enforcement, synergy-score recommendation, and kill-criteria discipline across the pipeline",
    "domain": "functional"
  },
  {
    "key": "security-engineer",
    "name": "Security Engineer",
    "role": "Threat modeling, security baseline, vulnerability and secrets management, and implementation of access control, personal-data protection, and MNPI handling",
    "domain": "technical"
  },
  {
    "key": "site-facility-agent",
    "name": "Site Facility Agent",
    "role": "Site and facility advisory — standing committee seat (ADR-0097) and lead consultation lane for site selection, industrial-complex eligibility, facility investment, and leasing-versus-build economics",
    "domain": "functional"
  },
  {
    "key": "sre",
    "name": "SRE",
    "role": "Monitoring and alerting, the log pipeline, and incident response with post-incident analysis",
    "domain": "technical"
  },
  {
    "key": "technical-dd-agent",
    "name": "Technical DD Agent",
    "role": "Technical due diligence lead — site-visit evidence, remaining equipment life, TRL/MRL assessment, EHS liability identification, and independent capex verification",
    "domain": "functional"
  },
  {
    "key": "ux-designer-agent",
    "name": "UX Designer Agent",
    "role": "Screen design ownership — JTBD-driven mockups, flows, and interaction patterns within the Onyx 3.0 doctrine",
    "domain": "technical"
  },
  {
    "key": "valuation-agent",
    "name": "Valuation Agent",
    "role": "Valuation model owner — DCF/NPV/IRR quantiles, Monte Carlo and contingent-liability simulation, DD-to-valuation bridge, and S10 financing plan",
    "domain": "functional"
  }
];

export const AGENT_KEYS = new Set(AGENT_REGISTRY.map((a) => a.key));
