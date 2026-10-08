// GENERATED from agents/*.md — do not edit by hand; edit the agent md and
// regenerate via: bun scripts/co-newbiz/generate-agent-registry.ts
// ADR-0128 — 런타임 에이전트 레지스트리 (PM 라우터가 작업 수행 에이전트를
// 고르고, 시스템 프롬프트에 역할을 주입할 때 사용한다).
export interface AgentRegistryEntry { key: string; name: string; role: string; domain: string | null }

export const AGENT_REGISTRY: AgentRegistryEntry[] = [
  {
    "key": "antitrust-agent",
    "name": "Antitrust Agent",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "backend-engineer",
    "name": "Backend Engineer",
    "role": "",
    "domain": "technical"
  },
  {
    "key": "brownfield-agent",
    "name": "Brownfield Agent",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "certification-agent",
    "name": "Certification Agent",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "commercial-dd-agent",
    "name": "Commercial DD Agent",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "compliance-officer",
    "name": "Compliance Officer",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "customer-retention-agent",
    "name": "Customer Retention Agent",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "data-architect",
    "name": "Data Architect",
    "role": "",
    "domain": "technical"
  },
  {
    "key": "dba",
    "name": "DBA",
    "role": "",
    "domain": "technical"
  },
  {
    "key": "design-system-agent",
    "name": "Design System Agent",
    "role": "",
    "domain": "technical"
  },
  {
    "key": "docs-writer",
    "name": "Docs Writer Agent",
    "role": "",
    "domain": "_shared"
  },
  {
    "key": "financial-analyst",
    "name": "Financial Analyst",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "financing-agent",
    "name": "Financing Agent",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "frontend-engineer",
    "name": "Frontend Engineer",
    "role": "",
    "domain": "technical"
  },
  {
    "key": "glossary-curator",
    "name": "Glossary Curator",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "greenfield-agent",
    "name": "Greenfield Agent",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "group-review-agent",
    "name": "Group Review Agent",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "hr-integration-agent",
    "name": "HR Integration Agent",
    "role": "",
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
    "role": "",
    "domain": "functional"
  },
  {
    "key": "industry-lead",
    "name": "Industry Lead",
    "role": "",
    "domain": "industry"
  },
  {
    "key": "infra-automation-engineer",
    "name": "Infra Automation Engineer",
    "role": "",
    "domain": "technical"
  },
  {
    "key": "ip-agent",
    "name": "IP Agent",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "ir-agent",
    "name": "IR Agent",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "legal-counsel",
    "name": "Legal Counsel",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "market-intelligence-agent",
    "name": "Market Intelligence Agent",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "partnership-agent",
    "name": "Partnership Agent",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "platform-lead",
    "name": "Platform Lead",
    "role": "",
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
    "role": "",
    "domain": "functional"
  },
  {
    "key": "process-governance-manager",
    "name": "Process Governance Manager",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "quant-methodologist",
    "name": "Quant Methodologist",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "region-lead",
    "name": "Region Lead",
    "role": "",
    "domain": "region"
  },
  {
    "key": "release-engineer",
    "name": "Release Engineer",
    "role": "",
    "domain": "technical"
  },
  {
    "key": "risk-officer",
    "name": "Risk Officer",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "security-engineer",
    "name": "Security Engineer",
    "role": "",
    "domain": "technical"
  },
  {
    "key": "site-facility-agent",
    "name": "Site Facility Agent",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "sre",
    "name": "SRE",
    "role": "",
    "domain": "technical"
  },
  {
    "key": "technical-dd-agent",
    "name": "Technical DD Agent",
    "role": "",
    "domain": "functional"
  },
  {
    "key": "ux-designer-agent",
    "name": "UX Designer Agent",
    "role": "",
    "domain": "technical"
  },
  {
    "key": "valuation-agent",
    "name": "Valuation Agent",
    "role": "",
    "domain": "functional"
  }
];

export const AGENT_KEYS = new Set(AGENT_REGISTRY.map((a) => a.key));
