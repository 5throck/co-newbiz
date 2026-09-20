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
    "domain": null
  },
  {
    "key": "backend-engineer",
    "name": "Backend Engineer",
    "role": "",
    "domain": null
  },
  {
    "key": "brownfield-agent",
    "name": "Brownfield Agent",
    "role": "",
    "domain": null
  },
  {
    "key": "certification-agent",
    "name": "Certification Agent",
    "role": "",
    "domain": null
  },
  {
    "key": "commercial-dd-agent",
    "name": "Commercial DD Agent",
    "role": "",
    "domain": null
  },
  {
    "key": "compliance-officer",
    "name": "Compliance Officer",
    "role": "",
    "domain": null
  },
  {
    "key": "customer-retention-agent",
    "name": "Customer Retention Agent",
    "role": "",
    "domain": null
  },
  {
    "key": "data-architect",
    "name": "Data Architect",
    "role": "",
    "domain": null
  },
  {
    "key": "dba",
    "name": "DBA",
    "role": "",
    "domain": null
  },
  {
    "key": "design-system-agent",
    "name": "Design System Agent",
    "role": "",
    "domain": null
  },
  {
    "key": "docs-writer",
    "name": "Docs Writer Agent",
    "role": "",
    "domain": null
  },
  {
    "key": "financial-analyst",
    "name": "Financial Analyst",
    "role": "",
    "domain": null
  },
  {
    "key": "financing-agent",
    "name": "Financing Agent",
    "role": "",
    "domain": null
  },
  {
    "key": "frontend-engineer",
    "name": "Frontend Engineer",
    "role": "",
    "domain": null
  },
  {
    "key": "glossary-curator",
    "name": "Glossary Curator",
    "role": "",
    "domain": null
  },
  {
    "key": "greenfield-agent",
    "name": "Greenfield Agent",
    "role": "",
    "domain": null
  },
  {
    "key": "group-review-agent",
    "name": "Group Review Agent",
    "role": "",
    "domain": null
  },
  {
    "key": "hr-integration-agent",
    "name": "HR Integration Agent",
    "role": "",
    "domain": null
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
    "domain": null
  },
  {
    "key": "industry-lead",
    "name": "Industry Lead",
    "role": "",
    "domain": null
  },
  {
    "key": "infra-automation-engineer",
    "name": "Infra Automation Engineer",
    "role": "",
    "domain": null
  },
  {
    "key": "ip-agent",
    "name": "IP Agent",
    "role": "",
    "domain": null
  },
  {
    "key": "ir-agent",
    "name": "IR Agent",
    "role": "",
    "domain": null
  },
  {
    "key": "legal-counsel",
    "name": "Legal Counsel",
    "role": "",
    "domain": null
  },
  {
    "key": "market-intelligence-agent",
    "name": "Market Intelligence Agent",
    "role": "",
    "domain": null
  },
  {
    "key": "partnership-agent",
    "name": "Partnership Agent",
    "role": "",
    "domain": null
  },
  {
    "key": "platform-lead",
    "name": "Platform Lead",
    "role": "",
    "domain": null
  },
  {
    "key": "pm",
    "name": "Project Manager (PM) Agent",
    "role": "New Business Review Lead — coordinates four domain leads, enforces stage gates, approves ADRs",
    "domain": null
  },
  {
    "key": "pmi-agent",
    "name": "PMI Agent",
    "role": "",
    "domain": null
  },
  {
    "key": "process-governance-manager",
    "name": "Process Governance Manager",
    "role": "",
    "domain": null
  },
  {
    "key": "quant-methodologist",
    "name": "Quant Methodologist",
    "role": "",
    "domain": null
  },
  {
    "key": "region-lead",
    "name": "Region Lead",
    "role": "",
    "domain": null
  },
  {
    "key": "release-engineer",
    "name": "Release Engineer",
    "role": "",
    "domain": null
  },
  {
    "key": "risk-officer",
    "name": "Risk Officer",
    "role": "",
    "domain": null
  },
  {
    "key": "security-engineer",
    "name": "Security Engineer",
    "role": "",
    "domain": null
  },
  {
    "key": "site-facility-agent",
    "name": "Site Facility Agent",
    "role": "",
    "domain": null
  },
  {
    "key": "sre",
    "name": "SRE",
    "role": "",
    "domain": null
  },
  {
    "key": "technical-dd-agent",
    "name": "Technical DD Agent",
    "role": "",
    "domain": null
  },
  {
    "key": "ux-designer-agent",
    "name": "UX Designer Agent",
    "role": "",
    "domain": null
  },
  {
    "key": "valuation-agent",
    "name": "Valuation Agent",
    "role": "",
    "domain": null
  }
];

export const AGENT_KEYS = new Set(AGENT_REGISTRY.map((a) => a.key));
