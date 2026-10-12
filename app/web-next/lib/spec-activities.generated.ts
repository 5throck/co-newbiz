// Generated from process/flow.spec.yaml for Next/Turbopack static server bundling.
// Do not edit by hand; update process/flow.spec.yaml and regenerate this
// projection with: bun scripts/co-newbiz/generate-spec-activities.ts
// (--check mode exits 1 on drift; tests/unit/process-flow.test.ts asserts
// this projection mirrors the spec.)
import type { SpecStage } from "./spec-activities.ts";

export const SPEC_VERSION = "2.7.0";
export const SPEC_STAGES: SpecStage[] = [
  {
    "id": "S1",
    "activities": [
      {
        "id": "market-research",
        "agent": "market-intelligence-agent",
        "skills": [
          "market-data-pipeline",
          "proxy-industry-chain",
          "systematic-market-sizing"
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
          "opportunity-discovery",
          "greenfield-screening",
          "brownfield-screening"
        ]
      }
    ]
  },
  {
    "id": "S3",
    "activities": [
      {
        "id": "strategic-fit-screening",
        "agent": "process-governance-manager",
        "skills": [
          "strategic-fit-screening",
          "portfolio-fit-assessment"
        ],
        "procedure": [
          "greenfield-screening",
          "brownfield-screening"
        ]
      },
      {
        "id": "synergy-analysis",
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
        "id": "our-company-profile",
        "agent": "financial-analyst",
        "skills": [
          "historical-financial-analysis",
          "company-intelligence"
        ],
        "procedure": [
          "company-profile-analysis"
        ]
      }
    ]
  },
  {
    "id": "S4",
    "activities": [
      {
        "id": "route-strategy",
        "agent": "pm",
        "skills": [
          "deal-execution-playbook",
          "jv-structuring",
          "partner-sourcing-strategy"
        ],
        "procedure": [
          "greenfield-pre-fs",
          "brownfield-pre-fs",
          "deal-shape-chain"
        ]
      },
      {
        "id": "deal-shape-evaluation",
        "agent": "brownfield-agent",
        "skills": [
          "deal-execution-playbook"
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
      }
    ]
  },
  {
    "id": "S5",
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
          "brownfield-feasibility"
        ],
        "procedure": [
          "brownfield-target-screening"
        ]
      }
    ]
  },
  {
    "id": "S8",
    "activities": [
      {
        "id": "business-case-modeling",
        "agent": "financial-analyst",
        "skills": [
          "growth-projection-modeling",
          "investment-feasibility-modeling"
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
          "monte-carlo-simulation"
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
          "monte-carlo-simulation"
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
          "site-infrastructure-assessment"
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
          "historical-financial-analysis"
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
          "talent-pipeline-planning"
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
        "skills": [],
        "procedure": [
          "greenfield-dd",
          "brownfield-dd"
        ]
      },
      {
        "id": "dd-waiver-review",
        "agent": "compliance-officer",
        "skills": [
          "waiver-management"
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
    "activities": [
      {
        "id": "deal-structure-hypothesis",
        "agent": "brownfield-agent",
        "skills": [
          "investment-vehicle-structuring"
        ],
        "procedure": [
          "deal-structuring",
          "brownfield-fs",
          "deal-shape-chain"
        ]
      },
      {
        "id": "financing-plan",
        "agent": "valuation-agent",
        "skills": [
          "financing-plan-review"
        ],
        "procedure": [
          "deal-structuring"
        ]
      }
    ]
  },
  {
    "id": "S11",
    "activities": [
      {
        "id": "ic-preparation",
        "agent": "pm",
        "skills": [
          "executive-presentation",
          "sample-driven-report-writing"
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
          "entity-ic-review",
          "jv-lifecycle-governance"
        ]
      },
      {
        "id": "risk-review",
        "agent": "risk-officer",
        "skills": [
          "legal-risk-register"
        ],
        "procedure": [
          "entity-ic-review",
          "group-investment-review"
        ]
      },
      {
        "id": "group-review",
        "agent": "group-review-agent",
        "skills": [
          "group-level-review"
        ],
        "procedure": [
          "entity-ic-review",
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
          "stage-gate-governance"
        ],
        "procedure": [
          "entity-establishment-execution"
        ]
      },
      {
        "id": "pmi-kickoff",
        "agent": "pmi-agent",
        "skills": [
          "pmi-planning"
        ],
        "procedure": [
          "pmi-integration-execution"
        ]
      }
    ]
  },
  {
    "id": "S12",
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
      }
    ]
  }
];
