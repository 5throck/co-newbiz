// @version 1.0.0
/**
 * ADR-0193 var->stage map: for every variable a kill-criteria predicate reads, the earliest
 * flow stage at which its snapshot filler / opportunity-var source can produce a value.
 *
 * This is a cross-check, NOT the source of `evaluable_from` (design 2026-11-07 §4.1): the
 * registry's `evaluable_from` is a governance choice (when the team expects the evidence);
 * this map only rejects a declaration that is earlier than the data can exist. Sources:
 * `db/lib/snapshot-filler.ts` (project-scoped vars), the `md_var` seed migrations
 * (0018/0025/0027/0031/0032/0178), and the flow.spec stage that creates the source rows.
 *
 * A predicate variable absent from this map fails `procedures/_validate.ts` — a new predicate
 * var must declare its stage here in the same change.
 */
export const KILL_VAR_MIN_STAGE: Readonly<Record<string, string>> = {
  // opportunity / early project track
  "dealshape.viable_shapes": "S4", // deal-shape-chain hosted by S4 route-strategy
  "fin.wacc_source_status": "S4", // assumption wacc/hurdle_irr, S4 wacc-hurdle-confirmation
  "cert.load_bearing_unconfirmed": "S4", // certification, S4 certification-screen
  "risk.partner_candidates_active": "S4", // partner_candidate rows, partner track after the S4 route
  "risk.partner_dependency_risk": "S4",
  // S5 greenfield site / partner work
  "infra.sites_clearing_minimums": "S5", // site_candidate
  "infra.plan_finalized": "S5", // site announcement
  "partner.financial_distress_red_count": "S5", // partner DD needs a named partner
  "partner.dd_ip_chain_red_count": "S5",
  // S6-S7 brownfield target work
  "screening.viable_targets": "S6", // brownfield_target longlist
  "antitrust.presumption_screens_triggered": "S7", // antitrust_finding (ownership-regulatory-screening)
  // S8 feasibility
  "permit.critical_path_exceeds_incentive_deadline": "S8",
  "fin.targets_meeting_hurdle": "S8",
  // S9 DD
  "fin.dd_value_impact_unbridged": "S9",
  "infra.wastewater_insufficient_no_mitigation": "S9",
  "validators.applicable_missing": "S9",
  "cert.transferability_inferred_count": "S9",
  "risk.covenants_breached": "S9",
  // S11 IC / establishment
  "deliverables.required_unreviewed": "S11",
  "classification.origin_live_missing": "S11",
  "legal.employment_transfer_consent_regime_determined": "S11",
  "legal.ip_assignment_chain_complete": "S11",
  // S12 post-close monitoring
  "pmi.key_talent_attrition_90d": "S12",
  "pmi.synergy_run_rate_certified": "S12",
};
