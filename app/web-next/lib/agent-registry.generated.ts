// GENERATED from agents/*.md — do not edit by hand; edit the agent md and
// regenerate via: bun scripts/co-newbiz/generate-agent-registry.ts
// ADR-0128 — 런타임 에이전트 레지스트리 (PM 라우터가 작업 수행 에이전트를
// 고르고, 시스템 프롬프트에 역할을 주입할 때 사용한다).
export interface AgentRegistryEntry { key: string; name: string; role: string; domain: string | null }

export const AGENT_REGISTRY: AgentRegistryEntry[] = [
  {
    "key": "antitrust-agent",
    "name": "Antitrust Agent",
    "role": "Antitrust and merger-control review: market definition, HHI calculation, multi-jurisdiction filing determination, gun-jumping compliance, and remedy scenario modeling",
    "domain": "functional"
  },
  {
    "key": "backend-engineer",
    "name": "Backend Engineer",
    "role": "Next.js Route Handler REST API, authentication, MCP server, the analysis-engine CLI, and the monitoring/alerting pipeline",
    "domain": "technical"
  },
  {
    "key": "brownfield-agent",
    "name": "Brownfield Agent",
    "role": "M&A review lead: target screening, deal structuring, and carve-out assessment",
    "domain": "functional"
  },
  {
    "key": "certification-agent",
    "name": "Certification Agent",
    "role": "Certification and regulatory response, kept structurally distinct from permits",
    "domain": "functional"
  },
  {
    "key": "commercial-dd-agent",
    "name": "Commercial DD Agent",
    "role": "Commercial due diligence: customer concentration, pricing power, channel checks, and expert interviews, with mandatory triangulation",
    "domain": "functional"
  },
  {
    "key": "compliance-officer",
    "name": "Compliance Officer",
    "role": "Owns governance operation: the standing work of running the rules the team writes, not writing them",
    "domain": "functional"
  },
  {
    "key": "customer-retention-agent",
    "name": "Customer Retention Agent",
    "role": "Post-acquisition customer attrition risk: change-of-control clause scanning, customer concentration, and competitive-overlap analysis",
    "domain": "functional"
  },
  {
    "key": "data-architect",
    "name": "Data Architect",
    "role": "ERD, master data governance, normalization, indexing, migration, and portability",
    "domain": "technical"
  },
  {
    "key": "dba",
    "name": "Database Administrator",
    "role": "Database operations: backup/restore, monthly recovery drills, performance tuning, and capacity management",
    "domain": "technical"
  },
  {
    "key": "design-system-agent",
    "name": "Design System Agent",
    "role": "Onyx 3.0 design system governance - enforcing token, component, and accessibility consistency across the web UI",
    "domain": "technical"
  },
  {
    "key": "docs-writer",
    "name": "Docs Writer",
    "role": "Document formatting and language-policy enforcement across all four domains",
    "domain": "_shared"
  },
  {
    "key": "financial-analyst",
    "name": "Financial Analyst",
    "role": "Historical financial analysis, peer benchmarking, quality-of-earnings, and growth-projection methodology, built on the existing DART-to-IFRS-to-KPI-to-ROIC-driver-tree pipeline inherited from co-consult",
    "domain": "functional"
  },
  {
    "key": "financing-agent",
    "name": "Financing Agent",
    "role": "Financing structure advisory: debt/equity mix, project finance, government funds and subsidies, and financial covenant structuring",
    "domain": "functional"
  },
  {
    "key": "frontend-engineer",
    "name": "Frontend Engineer",
    "role": "Next.js (App Router) UI, Recharts visualizations, the RAG dashboard, the admin console, and accessibility",
    "domain": "technical"
  },
  {
    "key": "glossary-curator",
    "name": "Glossary Curator",
    "role": "Owns the glossary: registration, review, duplicate merging, and the four tooling integrations (UI tooltip, report appendix, glossary-lint, MCP lookup_term) that keep it from rotting",
    "domain": "functional"
  },
  {
    "key": "greenfield-agent",
    "name": "Greenfield Agent",
    "role": "New-establishment review lead: site selection, infrastructure assessment, talent pipeline planning, community partnership, permit pathway, and ramp-up modeling for Green Field projects",
    "domain": "functional"
  },
  {
    "key": "group-review-agent",
    "name": "Group Review Agent",
    "role": "Group-level review distinct from entity-level review: portfolio fit, intra-group transaction compliance, and capital allocation prioritization across concurrent proposals",
    "domain": "functional"
  },
  {
    "key": "hr-integration-agent",
    "name": "HR Integration Agent",
    "role": "Executive compensation review, employee pay-and-benefits parity analysis, and labor/workforce integration for M&A",
    "domain": "functional"
  },
  {
    "key": "i18n-specialist",
    "name": "I18N Specialist Agent",
    "role": "specialist",
    "domain": null
  },
  {
    "key": "incentive-agent",
    "name": "Incentive Agent",
    "role": "Bidirectional policy-benefit management: sourcing regional tax and infrastructure incentives for new sites, and assessing clawback exposure on relocation for M&A and headquarters moves",
    "domain": "functional"
  },
  {
    "key": "industry-lead",
    "name": "Industry Lead",
    "role": "Domain lead for industry — owns the industry-profiles/*.yaml system",
    "domain": "industry"
  },
  {
    "key": "infra-automation-engineer",
    "name": "Infrastructure Automation Engineer",
    "role": "OS configuration, service registration, the scheduled-collection scheduler, and health-check/cleanup automation",
    "domain": "technical"
  },
  {
    "key": "ip-agent",
    "name": "IP Agent",
    "role": "Patent and IP advisory: patent landscape, freedom-to-operate, IP valuation, trade secrets, and technology licensing",
    "domain": "functional"
  },
  {
    "key": "ir-agent",
    "name": "IR Agent",
    "role": "Investor relations advisory: equity story, disclosure discipline, investor communications, and market perception risk",
    "domain": "functional"
  },
  {
    "key": "legal-counsel",
    "name": "Legal Counsel",
    "role": "Domestic and overseas statute, contract, and regulatory advisory",
    "domain": "functional"
  },
  {
    "key": "market-intelligence-agent",
    "name": "Market Intelligence Agent",
    "role": "TAM/SAM/SOM sizing, demand forecasting, competitor capacity-expansion tracking, and the six-axis upstream/downstream value-chain linkage analysis -- kept structurally separate from the proxy chain, since the two serve different purposes",
    "domain": "functional"
  },
  {
    "key": "partnership-agent",
    "name": "Partnership Agent",
    "role": "Partner sourcing strategy, partner due diligence including compliance screening, and JV structuring, distinct from community-partnership-planning (which covers local-community relations)",
    "domain": "functional"
  },
  {
    "key": "platform-lead",
    "name": "Platform Lead",
    "role": "Domain lead for technical",
    "domain": "technical"
  },
  {
    "key": "pm",
    "name": "Project Manager (PM) Agent",
    "role": "",
    "domain": null
  },
  {
    "key": "pmi-agent",
    "name": "PMI Agent",
    "role": "Post-merger integration planning: synergy realization tracking and integration risk assessment",
    "domain": "functional"
  },
  {
    "key": "process-governance-manager",
    "name": "Process Governance Manager",
    "role": "Domain lead for functional",
    "domain": "functional"
  },
  {
    "key": "quant-methodologist",
    "name": "Quant Methodologist",
    "role": "Owns the proxy industry chain methodology: unit conversion, regression calibration, lead-lag estimation, error propagation, and attribution analysis for run-to-run comparison",
    "domain": "functional"
  },
  {
    "key": "region-lead",
    "name": "Region Lead",
    "role": "Domain lead for region — owns the region-profiles/*.yaml system",
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
    "role": "Red-team function",
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
    "name": "Site & Facility Agent",
    "role": "Site and facility advisory: site selection, industrial complex eligibility, facility investment, and leasing-versus-build decisions",
    "domain": "functional"
  },
  {
    "key": "sre",
    "name": "Site Reliability Engineer",
    "role": "Monitoring and alerting, log pipeline, and incident response with post-incident analysis",
    "domain": "technical"
  },
  {
    "key": "technical-dd-agent",
    "name": "Technical DD Agent",
    "role": "Technical due diligence: site visits, remaining equipment life, TRL assessment, EHS liability, and capex verification",
    "domain": "functional"
  },
  {
    "key": "ux-designer-agent",
    "name": "UX Designer Agent",
    "role": "Screen design ownership - designing mockups, flows, and interaction patterns within the Onyx 3.0 doctrine for the co-newbiz web UI",
    "domain": "technical"
  },
  {
    "key": "valuation-agent",
    "name": "Valuation Agent",
    "role": "DCF/NPV/IRR/Payback/DSCR modeling, WACC assembly from live and user-supplied inputs, scenario and Monte Carlo simulation, and debt/contingent-liability simulation",
    "domain": "functional"
  }
];

export const AGENT_KEYS = new Set(AGENT_REGISTRY.map((a) => a.key));
