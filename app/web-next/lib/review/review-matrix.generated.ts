// Generated from process/cross-validation-matrix.yaml. Do not edit by hand;
// regenerate with: bun scripts/co-newbiz/generate-review-matrix.ts
// (--check exits 1 on drift; tests/unit/review-matrix.test.ts runs it).
import type { ReviewMatrix } from "./domains.ts";

export const REVIEW_MATRIX: ReviewMatrix = {
  "version": "1.1.0",
  "fallback": {
    "functional": "platform-lead",
    "technical": "process-governance-manager",
    "industry": "region-lead",
    "region": "industry-lead"
  },
  "reviewerDomains": {
    "industry-lead": "industry",
    "region-lead": "region",
    "risk-officer": "functional",
    "platform-lead": "technical",
    "process-governance-manager": "functional"
  },
  "agentExemptions": [
    "pm"
  ],
  "gateExceptions": [
    "target_screening"
  ],
  "artifactTypes": {
    "market": {
      "reviewers": {
        "functional": "industry-lead",
        "technical": "industry-lead",
        "industry": "region-lead",
        "region": "industry-lead"
      },
      "rationale": "industry-lead owns the industry profiles and value-chain context used to test market claims."
    },
    "proxy_chain": {
      "reviewers": {
        "functional": "industry-lead",
        "technical": "industry-lead",
        "industry": "region-lead",
        "region": "industry-lead"
      },
      "rationale": "Chain links and unit conversions are tested against industry-lead's value-chain structure."
    },
    "regulatory": {
      "reviewers": {
        "functional": "region-lead",
        "technical": "region-lead",
        "industry": "region-lead",
        "region": "industry-lead"
      },
      "rationale": "region-lead owns the region profiles (merger control, FDI, permits); an industry-lead covers region-authored work via the industry regulatory landscape."
    },
    "labor": {
      "reviewers": {
        "functional": "region-lead",
        "technical": "region-lead",
        "industry": "region-lead",
        "region": "industry-lead"
      },
      "rationale": "Labor law is region-profile content; region-authored labor review is read by industry-lead for sector practice."
    },
    "valuation": {
      "reviewers": {
        "functional": "industry-lead",
        "technical": "industry-lead",
        "industry": "region-lead",
        "region": "industry-lead"
      },
      "rationale": "D3' (owner decision 2026-10-28, amends D3): industry-lead tests valuation and financing work against the industry's unit-economics benchmarks, cycle and value-chain structure; for industry-authored work region-lead reads it (FX, tax, repatriation, incentives). risk-officer (red team, base-rate authority) stays a first-stage specialist reviewer and is never recorded as the AI-2nd stage, so no fallback is needed."
    },
    "synergy": {
      "reviewers": {
        "functional": "industry-lead",
        "technical": "industry-lead",
        "industry": "region-lead",
        "region": "industry-lead"
      },
      "rationale": "D3' (owner decision 2026-10-28): same routing as valuation. Synergy locations (affiliates, value-chain linkage) and their quantification are tested against industry-lead's value-chain structure; risk-officer keeps the S3 synergy-red-team activity as a first-stage review."
    },
    "technical": {
      "reviewers": {
        "functional": "platform-lead",
        "technical": "process-governance-manager",
        "industry": "platform-lead",
        "region": "platform-lead"
      },
      "rationale": "platform-lead reviews technical artifacts only; technical-authored artifacts are read by process-governance-manager."
    },
    "strategy": {
      "reviewers": {
        "functional": "industry-lead",
        "technical": "industry-lead",
        "industry": "region-lead",
        "region": "industry-lead"
      },
      "rationale": "Strategic claims are tested against industry structure; platform-lead is deliberately NOT the blanket functional reviewer (finding M7)."
    },
    "bundle": {
      "reviewers": {
        "functional": "platform-lead",
        "technical": "process-governance-manager",
        "industry": "region-lead",
        "region": "industry-lead"
      },
      "rationale": "Generalist cross-domain reading of a multi-type bundle; the former DEFAULT_REVIEWER_DOMAIN mapping, now an explicit (not fallback) entry."
    }
  },
  "stages": {
    "S1": {
      "defaultType": "market",
      "required": [
        {
          "match": "가치사슬 구조",
          "artifactType": "proxy_chain"
        }
      ]
    },
    "S2": {
      "defaultType": "strategy",
      "required": [
        {
          "match": "진입시장 산정",
          "artifactType": "market"
        }
      ]
    },
    "S3": {
      "defaultType": "strategy",
      "required": [
        {
          "match": "시너지 평가",
          "artifactType": "synergy"
        }
      ]
    },
    "S4": {
      "defaultType": "strategy",
      "required": [
        {
          "match": "법무·규제 스크리닝 판정",
          "artifactType": "regulatory"
        }
      ]
    },
    "S5": {
      "defaultType": "strategy",
      "required": [
        {
          "match": "부지 선정 체크리스트 판정",
          "artifactType": "technical"
        }
      ]
    },
    "S6": {
      "defaultType": "strategy",
      "required": []
    },
    "S7": {
      "defaultType": "strategy",
      "required": []
    },
    "S8": {
      "defaultType": "valuation",
      "required": [
        {
          "match": "Target 비교 분석",
          "artifactType": "strategy"
        },
        {
          "match": "대상 선정 기록",
          "artifactType": "strategy"
        }
      ]
    },
    "S9": {
      "defaultType": "bundle",
      "required": []
    },
    "S10": {
      "defaultType": "strategy",
      "required": [
        {
          "match": "자금조달 계획",
          "artifactType": "valuation"
        }
      ]
    },
    "S11": {
      "defaultType": "strategy",
      "required": []
    },
    "S12": {
      "defaultType": "strategy",
      "required": []
    }
  }
};
