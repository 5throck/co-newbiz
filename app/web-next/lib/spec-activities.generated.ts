// Generated from process/flow.spec.yaml for Next/Turbopack static server bundling.
// Do not edit by hand; update process/flow.spec.yaml and regenerate this
// projection with: bun scripts/co-newbiz/generate-spec-activities.ts
// (--check mode exits 1 on drift; tests/unit/process-flow.test.ts asserts
// this projection mirrors the spec.)
import type { SpecStage } from "./spec-activities.ts";

export const SPEC_VERSION = "2.21.0";
export const SPEC_STAGES: SpecStage[] = [
  {
    "id": "S1",
    "name": "시장분석",
    "applicableTracks": [
      "greenfield",
      "brownfield"
    ],
    "activities": [
      {
        "id": "market-research",
        "agent": "market-intelligence-agent",
        "skills": [
          "market-data-pipeline",
          "proxy-industry-chain",
          "systematic-market-sizing",
          "forward-industry-research"
        ],
        "procedure": [
          "greenfield-screening",
          "brownfield-screening"
        ]
      },
      {
        "id": "competitive-intelligence",
        "agent": "market-intelligence-agent",
        "skills": [
          "competitive-intelligence"
        ],
        "procedure": [
          "greenfield-screening",
          "brownfield-screening"
        ]
      },
      {
        "id": "value-chain-analysis",
        "agent": "market-intelligence-agent",
        "skills": [
          "value-chain-linkage-analysis",
          "value-chain-stage-financials"
        ],
        "procedure": [
          "greenfield-screening",
          "brownfield-screening"
        ]
      }
    ]
  },
  {
    "id": "S2",
    "name": "기회 발굴",
    "applicableTracks": [
      "greenfield",
      "brownfield"
    ],
    "activities": [
      {
        "id": "opportunity-discovery",
        "agent": "market-intelligence-agent",
        "skills": [
          "insight-synthesis"
        ],
        "procedure": [
          "opportunity-discovery",
          "greenfield-screening",
          "brownfield-screening"
        ]
      },
      {
        "id": "business-model-sketch",
        "agent": "greenfield-agent",
        "skills": [
          "scenario-planning"
        ],
        "procedure": [
          "opportunity-discovery"
        ]
      },
      {
        "id": "entry-market-sizing",
        "agent": "market-intelligence-agent",
        "skills": [
          "systematic-market-sizing"
        ],
        "procedure": [
          "opportunity-discovery",
          "greenfield-screening",
          "brownfield-screening"
        ]
      }
    ]
  },
  {
    "id": "S3",
    "name": "시너지·전략적 적합성",
    "applicableTracks": [
      "greenfield",
      "brownfield"
    ],
    "activities": [
      {
        "id": "strategic-fit-screening",
        "agent": "process-governance-manager",
        "skills": [
          "strategic-fit-screening",
          "portfolio-fit-assessment",
          "brownfield-feasibility",
          "antitrust-screening",
          "site-infrastructure-assessment",
          "regional-incentive-sourcing"
        ],
        "procedure": [
          "greenfield-screening",
          "brownfield-screening"
        ]
      },
      {
        "id": "synergy-analysis",
        "agent": "market-intelligence-agent",
        "skills": [
          "value-chain-linkage-analysis",
          "investment-feasibility-modeling",
          "historical-financial-analysis"
        ],
        "procedure": [
          "greenfield-screening",
          "brownfield-screening"
        ]
      },
      {
        "id": "synergy-red-team",
        "agent": "risk-officer",
        "skills": [
          "assumption-audit"
        ],
        "procedure": [
          "greenfield-screening",
          "brownfield-screening"
        ]
      },
      {
        "id": "capability-register-greenfield",
        "agent": "greenfield-agent",
        "skills": [
          "greenfield-feasibility"
        ],
        "procedure": [
          "greenfield-screening"
        ]
      },
      {
        "id": "capability-register-brownfield",
        "agent": "brownfield-agent",
        "skills": [
          "brownfield-feasibility"
        ],
        "procedure": [
          "brownfield-screening"
        ]
      },
      {
        "id": "our-company-profile",
        "agent": "financial-analyst",
        "skills": [
          "historical-financial-analysis",
          "company-intelligence",
          "competitive-intelligence"
        ],
        "procedure": [
          "company-profile-analysis"
        ]
      }
    ]
  },
  {
    "id": "S4",
    "name": "진출방식 결정",
    "applicableTracks": [
      "greenfield",
      "brownfield"
    ],
    "activities": [
      {
        "id": "route-strategy",
        "agent": "pm",
        "skills": [
          "deal-execution-playbook",
          "jv-structuring",
          "partner-sourcing-strategy",
          "brownfield-feasibility",
          "greenfield-feasibility",
          "site-infrastructure-assessment",
          "regional-incentive-sourcing",
          "partner-due-diligence",
          "partnership-health-scorecard",
          "investment-vehicle-structuring"
        ],
        "procedure": [
          "greenfield-pre-fs",
          "brownfield-pre-fs",
          "deal-shape-chain"
        ]
      },
      {
        "id": "route-advisory",
        "agent": "pm",
        "skills": [],
        "procedure": [
          "greenfield-pre-fs",
          "brownfield-pre-fs",
          "deal-shape-chain"
        ]
      },
      {
        "id": "wacc-hurdle-confirmation",
        "agent": "valuation-agent",
        "skills": [
          "wacc-input-session"
        ],
        "procedure": [
          "greenfield-pre-fs",
          "brownfield-pre-fs"
        ]
      },
      {
        "id": "certification-screen",
        "agent": "certification-agent",
        "skills": [
          "certification-roadmap",
          "certification-transferability"
        ],
        "procedure": [
          "greenfield-pre-fs",
          "brownfield-pre-fs"
        ]
      },
      {
        "id": "regulatory-screening",
        "agent": "legal-counsel",
        "skills": [
          "regulatory-screening",
          "permit-pathway-mapping",
          "k-law"
        ],
        "procedure": [
          "greenfield-screening",
          "brownfield-screening"
        ]
      }
    ]
  },
  {
    "id": "S5",
    "name": "자체 진출",
    "applicableTracks": [
      "greenfield"
    ],
    "activities": [
      {
        "id": "capability-assessment",
        "agent": "greenfield-agent",
        "skills": [
          "greenfield-feasibility",
          "org-readiness-assessment"
        ],
        "procedure": [
          "greenfield-capability-assessment"
        ]
      },
      {
        "id": "entry-strategy",
        "agent": "greenfield-agent",
        "skills": [
          "scenario-planning",
          "talent-pipeline-planning"
        ],
        "procedure": [
          "greenfield-capability-assessment"
        ]
      },
      {
        "id": "business-case-lines",
        "agent": "financial-analyst",
        "skills": [
          "investment-feasibility-modeling"
        ],
        "procedure": [
          "greenfield-capability-assessment"
        ]
      }
    ]
  },
  {
    "id": "S6",
    "name": "대상 후보 발굴",
    "applicableTracks": [
      "brownfield"
    ],
    "activities": [
      {
        "id": "target-universe-definition",
        "agent": "brownfield-agent",
        "skills": [
          "brownfield-feasibility",
          "competitive-intelligence"
        ],
        "procedure": [
          "brownfield-target-identification"
        ]
      },
      {
        "id": "target-longlist",
        "agent": "market-intelligence-agent",
        "skills": [
          "company-intelligence",
          "brownfield-feasibility"
        ],
        "procedure": [
          "brownfield-target-identification"
        ]
      }
    ]
  },
  {
    "id": "S7",
    "name": "대상 선정",
    "applicableTracks": [
      "brownfield"
    ],
    "activities": [
      {
        "id": "target-screening",
        "agent": "brownfield-agent",
        "skills": [
          "brownfield-feasibility",
          "strategic-fit-screening",
          "peer-benchmarking"
        ],
        "procedure": [
          "brownfield-target-screening"
        ]
      },
      {
        "id": "ownership-regulatory-screening",
        "agent": "antitrust-agent",
        "skills": [
          "antitrust-screening",
          "regulatory-screening"
        ],
        "procedure": [
          "brownfield-target-screening"
        ]
      },
      {
        "id": "target-ranking",
        "agent": "brownfield-agent",
        "skills": [
          "strategic-fit-screening",
          "brownfield-feasibility",
          "peer-benchmarking"
        ],
        "procedure": [
          "brownfield-target-screening"
        ]
      },
      {
        "id": "deal-shape-evaluation",
        "agent": "brownfield-agent",
        "skills": [
          "deal-execution-playbook"
        ],
        "procedure": [
          "brownfield-target-screening"
        ]
      }
    ]
  },
  {
    "id": "S8",
    "name": "사업성 분석",
    "applicableTracks": [
      "greenfield",
      "brownfield"
    ],
    "activities": [
      {
        "id": "business-case-modeling",
        "agent": "financial-analyst",
        "skills": [
          "growth-projection-modeling",
          "investment-feasibility-modeling",
          "target-costing-analysis",
          "financial-statement-analysis",
          "antitrust-screening",
          "peer-benchmarking",
          "quality-of-earnings",
          "scenario-planning",
          "value-chain-stage-financials",
          "historical-financial-analysis",
          "site-infrastructure-assessment"
        ],
        "procedure": [
          "greenfield-fs",
          "brownfield-fs"
        ]
      },
      {
        "id": "valuation",
        "agent": "valuation-agent",
        "skills": [
          "dd-to-valuation-bridge",
          "monte-carlo-simulation",
          "investment-vehicle-structuring"
        ],
        "procedure": [
          "greenfield-fs",
          "brownfield-fs"
        ]
      },
      {
        "id": "quant-methods",
        "agent": "quant-methodologist",
        "skills": [
          "wacc-input-session",
          "monte-carlo-simulation",
          "proxy-industry-chain",
          "unit-conversion-calibration",
          "value-chain-driver-identification"
        ],
        "procedure": [
          "greenfield-fs",
          "brownfield-fs"
        ]
      },
      {
        "id": "target-comparison",
        "agent": "financial-analyst",
        "skills": [
          "investment-feasibility-modeling"
        ],
        "procedure": [
          "brownfield-fs-comparative"
        ]
      },
      {
        "id": "target-selection",
        "agent": "pm",
        "skills": [],
        "procedure": [
          "brownfield-fs-comparative"
        ]
      }
    ]
  },
  {
    "id": "S9",
    "name": "실사·검증",
    "applicableTracks": [
      "greenfield",
      "brownfield"
    ],
    "activities": [
      {
        "id": "commercial-dd",
        "agent": "commercial-dd-agent",
        "skills": [
          "commercial-due-diligence"
        ],
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      },
      {
        "id": "technical-dd",
        "agent": "technical-dd-agent",
        "skills": [
          "technical-due-diligence",
          "site-infrastructure-assessment",
          "site-visit-protocol",
          "community-partnership-planning"
        ],
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      },
      {
        "id": "legal-dd",
        "agent": "legal-counsel",
        "skills": [
          "legal-due-diligence",
          "regulatory-screening"
        ],
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      },
      {
        "id": "financial-dd",
        "agent": "financial-analyst",
        "skills": [
          "quality-of-earnings",
          "historical-financial-analysis",
          "dd-to-valuation-bridge"
        ],
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      },
      {
        "id": "hr-dd",
        "agent": "hr-integration-agent",
        "skills": [
          "org-readiness-assessment",
          "talent-pipeline-planning",
          "management-incentive-review",
          "compensation-harmonization-analysis"
        ],
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      },
      {
        "id": "market-dd",
        "agent": "market-intelligence-agent",
        "skills": [
          "competitive-intelligence"
        ],
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      },
      {
        "id": "financing-dd",
        "agent": "financing-agent",
        "skills": [
          "financing-plan-review"
        ],
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      },
      {
        "id": "dd-waiver-review",
        "agent": "compliance-officer",
        "skills": [
          "waiver-management",
          "compliance-monitoring"
        ],
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      },
      {
        "id": "capability-dd",
        "agent": "brownfield-agent",
        "skills": [
          "brownfield-feasibility"
        ],
        "procedure": [
          "brownfield-dd"
        ]
      },
      {
        "id": "antitrust-dd",
        "agent": "antitrust-agent",
        "skills": [
          "antitrust-screening"
        ],
        "procedure": [
          "brownfield-dd"
        ]
      },
      {
        "id": "region-labor-review",
        "agent": "region-lead",
        "skills": [
          "regulatory-screening"
        ],
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      },
      {
        "id": "customer-retention-dd",
        "agent": "customer-retention-agent",
        "skills": [
          "customer-attrition-risk"
        ],
        "procedure": [
          "brownfield-dd"
        ]
      },
      {
        "id": "incentive-dd",
        "agent": "incentive-agent",
        "skills": [
          "incentive-clawback-assessment"
        ],
        "procedure": [
          "brownfield-dd"
        ]
      },
      {
        "id": "contingent-liability-dd",
        "agent": "valuation-agent",
        "skills": [
          "debt-and-contingent-liability-simulation"
        ],
        "procedure": [
          "brownfield-dd"
        ]
      },
      {
        "id": "certification-transferability-dd",
        "agent": "legal-counsel",
        "skills": [
          "certification-transferability"
        ],
        "procedure": [
          "brownfield-dd"
        ]
      },
      {
        "id": "ip-fto-dd",
        "agent": "ip-agent",
        "skills": [
          "ip-fto-review"
        ],
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      }
    ]
  },
  {
    "id": "S10",
    "name": "투자구조 설계",
    "applicableTracks": [
      "greenfield",
      "brownfield"
    ],
    "activities": [
      {
        "id": "deal-structure-hypothesis",
        "agent": "brownfield-agent",
        "skills": [
          "investment-vehicle-structuring"
        ],
        "procedure": [
          "deal-structuring"
        ]
      },
      {
        "id": "financing-plan",
        "agent": "valuation-agent",
        "skills": [
          "financing-plan-review",
          "investment-feasibility-modeling",
          "regional-incentive-sourcing"
        ],
        "procedure": [
          "deal-structuring"
        ]
      }
    ]
  },
  {
    "id": "S11",
    "name": "투자심사·실행",
    "applicableTracks": [
      "greenfield",
      "brownfield"
    ],
    "activities": [
      {
        "id": "ic-preparation",
        "agent": "pm",
        "skills": [
          "executive-presentation",
          "sample-driven-report-writing",
          "dd-to-valuation-bridge",
          "financing-plan-review",
          "insight-synthesis"
        ],
        "procedure": [
          "entity-ic-review",
          "group-investment-review"
        ]
      },
      {
        "id": "charter-baseline",
        "agent": "pm",
        "skills": [],
        "procedure": [
          "entity-ic-review"
        ]
      },
      {
        "id": "investment-structuring",
        "agent": "brownfield-agent",
        "skills": [],
        "procedure": [
          "entity-ic-review"
        ]
      },
      {
        "id": "risk-review",
        "agent": "risk-officer",
        "skills": [
          "legal-risk-register",
          "rag-scoring-framework"
        ],
        "procedure": [
          "entity-ic-review"
        ]
      },
      {
        "id": "group-review",
        "agent": "group-review-agent",
        "skills": [
          "group-level-review",
          "intra-group-transaction-compliance",
          "portfolio-fit-assessment",
          "two-tier-approval-chain"
        ],
        "procedure": [
          "group-investment-review"
        ]
      },
      {
        "id": "entity-establishment-execution",
        "agent": "process-governance-manager",
        "skills": [
          "legal-due-diligence",
          "k-law",
          "certification-transferability",
          "org-readiness-assessment",
          "stage-gate-governance",
          "permit-pathway-mapping"
        ],
        "procedure": [
          "entity-establishment-execution",
          "business-unit-establishment-execution"
        ]
      },
      {
        "id": "pmi-kickoff",
        "agent": "pmi-agent",
        "skills": [
          "pmi-planning",
          "compensation-harmonization-analysis"
        ],
        "procedure": [
          "pmi-integration-execution"
        ]
      },
      {
        "id": "greenfield-execution-baseline",
        "agent": "greenfield-agent",
        "skills": [
          "greenfield-feasibility",
          "talent-pipeline-planning",
          "certification-roadmap",
          "financing-plan-review",
          "incentive-clawback-assessment"
        ],
        "procedure": [
          "greenfield-execution-baseline"
        ]
      }
    ]
  },
  {
    "id": "S12",
    "name": "사후 관리",
    "applicableTracks": [
      "greenfield",
      "brownfield"
    ],
    "activities": [
      {
        "id": "portfolio-monitoring",
        "agent": "group-review-agent",
        "skills": [
          "portfolio-fit-assessment"
        ],
        "procedure": [
          "portfolio-venture-monitoring"
        ]
      },
      {
        "id": "integration-monitoring",
        "agent": "pmi-agent",
        "skills": [
          "pmi-planning"
        ],
        "procedure": [
          "pmi-integration-execution"
        ]
      },
      {
        "id": "partnership-monitoring",
        "agent": "partnership-agent",
        "skills": [
          "partnership-health-scorecard",
          "jv-structuring",
          "portfolio-fit-assessment"
        ],
        "procedure": [
          "jv-lifecycle-governance"
        ]
      }
    ]
  }
];
