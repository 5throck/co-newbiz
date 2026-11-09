// Generated from procedures/_committees.yaml for Next/Turbopack static server bundling.
// Do not edit by hand; update procedures/_committees.yaml and regenerate this projection.
import type { CommitteeDef } from "./committee-session.ts";

export const COMMITTEE_REGISTRY: Record<string, CommitteeDef> = {
  "route-steering-committee": {
    applies_to: "route_decision",
    description: "S4 steering committee (route decision). Deliberates the greenfield / brownfield track and route type before the human records the decision.",
    chair: "process-governance-manager",
    rounds: 2,
    decision_modes_allowed: [
      "human_only",
      "agent_team",
      "hybrid"
    ],
    members: [
      {
        type: "agent",
        key: "brownfield-agent",
        seat: "domain_expert",
        applies_when: "track == brownfield"
      },
      {
        type: "agent",
        key: "greenfield-agent",
        seat: "domain_expert",
        applies_when: "track == greenfield"
      },
      {
        type: "agent",
        key: "industry-lead",
        seat: "industry_expert"
      },
      {
        type: "agent",
        key: "region-lead",
        seat: "region_expert"
      },
      {
        type: "agent",
        key: "market-intelligence-agent",
        seat: "quantitative_rigor"
      },
      {
        type: "agent",
        key: "financing-agent",
        seat: "functional_financing"
      },
      {
        type: "agent",
        key: "site-facility-agent",
        seat: "functional_site_facility"
      },
      {
        type: "agent",
        key: "legal-counsel",
        seat: "functional_legal"
      },
      {
        type: "agent",
        key: "hr-integration-agent",
        seat: "functional_hr_labor"
      },
      {
        type: "agent",
        key: "ir-agent",
        seat: "functional_ir"
      },
      {
        type: "agent",
        key: "ip-agent",
        seat: "functional_ip"
      },
      {
        type: "agent",
        key: "risk-officer",
        seat: "red_team",
        veto_dissent: true
      }
    ]
  },
  "target-longlist-shortlist-committee": {
    applies_to: "brownfield_target",
    description: "S6/S7 committee (Long List -> Short List). Deliberates target screening and shortlist promotion before the human records the outcome.",
    chair: "process-governance-manager",
    rounds: 2,
    decision_modes_allowed: [
      "human_only",
      "agent_team",
      "hybrid"
    ],
    members: [
      {
        type: "agent",
        key: "brownfield-agent",
        seat: "domain_expert"
      },
      {
        type: "agent",
        key: "industry-lead",
        seat: "industry_expert"
      },
      {
        type: "agent",
        key: "region-lead",
        seat: "region_expert"
      },
      {
        type: "agent",
        key: "valuation-agent",
        seat: "quantitative_rigor"
      },
      {
        type: "agent",
        key: "financing-agent",
        seat: "functional_financing"
      },
      {
        type: "agent",
        key: "site-facility-agent",
        seat: "functional_site_facility"
      },
      {
        type: "agent",
        key: "legal-counsel",
        seat: "functional_legal"
      },
      {
        type: "agent",
        key: "hr-integration-agent",
        seat: "functional_hr_labor"
      },
      {
        type: "agent",
        key: "ir-agent",
        seat: "functional_ir"
      },
      {
        type: "agent",
        key: "ip-agent",
        seat: "functional_ip"
      },
      {
        type: "agent",
        key: "risk-officer",
        seat: "red_team",
        veto_dissent: true
      }
    ]
  },
  "entity-ic-committee": {
    applies_to: "entity_ic",
    description: "Entity IC committee (ADR-0196 Phase E, decision 9). Deliberates the entity-ic-review IC package before the human verdict step (entity-ic-reviewer, ADR-0053). Convened and closed by the chair in the recorder pattern (entity-ic-review step 4.5.5); the session proposes and never decides. The track-lead seat swaps by case_type.",
    chair: "process-governance-manager",
    rounds: 2,
    decision_modes_allowed: [
      "human_only",
      "agent_team",
      "hybrid"
    ],
    members: [
      {
        type: "agent",
        key: "brownfield-agent",
        seat: "domain_expert",
        applies_when: "case_type == brownfield"
      },
      {
        type: "agent",
        key: "greenfield-agent",
        seat: "domain_expert",
        applies_when: "case_type == greenfield"
      },
      {
        type: "agent",
        key: "risk-officer",
        seat: "red_team",
        veto_dissent: true
      },
      {
        type: "agent",
        key: "valuation-agent",
        seat: "quantitative_rigor"
      },
      {
        type: "agent",
        key: "financing-agent",
        seat: "functional_financing"
      },
      {
        type: "agent",
        key: "site-facility-agent",
        seat: "functional_site_facility"
      },
      {
        type: "agent",
        key: "legal-counsel",
        seat: "functional_legal"
      },
      {
        type: "agent",
        key: "hr-integration-agent",
        seat: "functional_hr_labor"
      },
      {
        type: "agent",
        key: "ir-agent",
        seat: "functional_ir"
      },
      {
        type: "agent",
        key: "ip-agent",
        seat: "functional_ip"
      }
    ]
  },
  "group-ic-committee": {
    applies_to: "group_ic",
    description: "Group IC committee (ADR-0196 Phase E, decision 9). Deliberates the ranked group agenda before the human verdict step (group-ic-reviewer, ADR-0053 / ADR-0186 D6). Convened and closed by the chair in the recorder pattern (group-investment-review step 4.4); the session proposes and never decides.",
    chair: "process-governance-manager",
    rounds: 2,
    decision_modes_allowed: [
      "human_only",
      "agent_team",
      "hybrid"
    ],
    members: [
      {
        type: "agent",
        key: "group-review-agent",
        seat: "domain_expert"
      },
      {
        type: "agent",
        key: "risk-officer",
        seat: "red_team",
        veto_dissent: true
      },
      {
        type: "agent",
        key: "financing-agent",
        seat: "functional_financing"
      },
      {
        type: "agent",
        key: "ir-agent",
        seat: "functional_ir",
        applies_when: "disclosure applies"
      }
    ]
  }
};
