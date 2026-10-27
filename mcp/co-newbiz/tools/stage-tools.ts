// @version 1.0.2 (ADR-0187 P0: S3 synergy-red-team and capability-register-* activity ids mapped onto existing tools)
/**
 * Stage tools S1-S12 — ADR-0154 §4, design §5 (Wave M M-2).
 *
 * Every entry wraps ONE existing REST route through the RestPort (routeTool);
 * none carries business logic. `activities` are flow.spec activity ids and
 * `artifacts` are `stage:S#:N` (1-based index into the stage's
 * requiredArtifacts); scripts/co-newbiz/mcp-coverage.ts fails when either is
 * uncovered by the registry.
 *
 * Deliberately NOT here (human-only, listed in mcp-coverage.exclusions.yaml,
 * enforced by the coverage script and the in-process route guard):
 *  - decision routes (gate decision, route decision, case adoption, target
 *    selection, transition decision) and human approvals (charter confirm,
 *    DD checklist judgment, four-axis completion) — propose_* tools instead
 *  - closure (POST close), PMI kickoff, synergy score confirmation, candidate
 *    rerank, waiver decisions, DD tailoring review, opportunity promotion
 */

import type { RegistryTool } from "../define.ts";
import { routeTool, type RouteToolSpec } from "./route-tool.ts";

const BODY = "JSON body forwarded unchanged to the REST route; the route validates it.";

const SPECS: readonly RouteToolSpec[] = [
  // ── Cross-cutting reads ──────────────────────────────────────────────
  { name: "get_opportunity", kind: "read", method: "GET", path: "/api/opportunities/{opportunityId}",
    description: "One opportunity (S1-S7 carrier) with its history." },
  { name: "get_project_process", kind: "read", method: "GET", path: "/api/projects/{projectId}/process",
    description: "Derived process state (S8-S12) for a promoted project — currentStage, completedStages, gateStatus, requiredArtifacts." },
  { name: "get_project_gate_decisions", kind: "read", method: "GET", path: "/api/projects/{projectId}/gate-decisions",
    description: "Gate decision records (GO/HOLD/KILL) for a project (fs, dd, entity_ic, group_ic). latest[].decision is the EFFECTIVE verdict: an entity_ic / group_ic GO that still awaits its second-reviewer countersign reads pending once maker/checker is enforced; recorded_decision, awaiting_countersign and countersign_state say what was recorded (ADR-0186). Countersigning is a human act, never a tool." },

  // ── S1 market analysis ───────────────────────────────────────────────
  { name: "list_market_analyses", kind: "read", method: "GET", path: "/api/market-overview/analyses", query: true,
    activities: ["market-research"], description: "Recent industry market-sizing analyses." },
  { name: "get_market_analysis", kind: "read", method: "GET", path: "/api/market-overview/analyses/{analysisId}",
    activities: ["market-research", "competitive-intelligence", "value-chain-analysis"], artifacts: ["stage:S1:1", "stage:S1:2", "stage:S1:3"],
    description: "One market-sizing analysis — size and growth, competitive structure, value-chain structure, data-confidence grade." },
  { name: "generate_market_sizing_draft", kind: "generate", method: "POST", path: "/api/market-overview/analyses", body: "required", bodyHint: BODY,
    activities: ["market-research", "competitive-intelligence", "value-chain-analysis"], artifacts: ["stage:S1:1", "stage:S1:2", "stage:S1:3"],
    description: "Start an industry market-sizing analysis (the systematic-market-sizing pipeline runs asynchronously). Output is a draft for human review." },
  { name: "rerun_market_analysis", kind: "generate", method: "POST", path: "/api/market-overview/analyses/{analysisId}/rerun", body: "optional",
    activities: ["market-research"], description: "Re-run an existing market-sizing analysis; the prior version is kept." },
  { name: "seed_market_analysis", kind: "write", method: "POST", path: "/api/market-overview/analyses/{analysisId}/seed", body: "required",
    bodyHint: "An agent-researched SizingMatrix; the route validates its shape.", activities: ["market-research"],
    description: "Land an agent-researched sizing matrix as a new analysis version." },
  { name: "get_value_chain_graph", kind: "read", method: "GET", path: "/api/market-overview/value-chain-graph", query: true,
    activities: ["value-chain-analysis"], artifacts: ["stage:S1:3"], description: "The upstream/downstream value-chain graph." },
  { name: "record_chain_link", kind: "write", method: "POST", path: "/api/market-overview/industry/{industryId}/chain-links", body: "required", bodyHint: BODY,
    activities: ["value-chain-analysis"], artifacts: ["stage:S1:3"], description: "Add a proxy/value-chain link for an industry." },
  { name: "add_competitor", kind: "write", method: "POST", path: "/api/our-company/members/{memberId}/competitors", body: "required", bodyHint: BODY,
    activities: ["competitive-intelligence"], artifacts: ["stage:S1:2"], description: "Register a competitor for one of our group members." },
  { name: "generate_competitor_proposals", kind: "generate", method: "POST", path: "/api/our-company/members/{memberId}/competitor-proposals/web-search", body: "optional",
    activities: ["competitive-intelligence"], description: "Web-search competitor candidates (proposals only; a person confirms)." },

  // ── S2 opportunity discovery ─────────────────────────────────────────
  { name: "discover_opportunities", kind: "generate", method: "POST", path: "/api/opportunities/discover", body: "required", bodyHint: BODY,
    activities: ["opportunity-discovery"], description: "Draft opportunity candidates along an industry value chain." },
  { name: "recommend_attractiveness", kind: "generate", method: "POST", path: "/api/opportunities/{opportunityId}/attractiveness-recommendation", body: "optional",
    activities: ["opportunity-discovery"], description: "Recommend an attractiveness score with its rationale (a recommendation, not a decision)." },
  { name: "record_opportunity_factor", kind: "write", method: "POST", path: "/api/opportunities/{opportunityId}/factors", body: "optional", bodyHint: BODY,
    activities: ["opportunity-discovery"], description: "Derive the opportunity's evaluation factors." },
  { name: "generate_business_model_sketch", kind: "generate", method: "POST", path: "/api/opportunities/{opportunityId}/sketch", body: "optional",
    activities: ["business-model-sketch"], description: "Generate a one-page business-model sketch from the linked S1 analysis." },
  { name: "get_business_model_sketch", kind: "read", method: "GET", path: "/api/opportunities/{opportunityId}/sketch",
    activities: ["business-model-sketch"], description: "The persisted business-model sketch." },
  { name: "get_entry_market_derivation", kind: "read", method: "GET", path: "/api/opportunities/{opportunityId}/entry-market-derivation",
    activities: ["entry-market-sizing"], artifacts: ["stage:S2:2"],
    description: "The S2 entry-market derivation state — linked S1 anchor, person-set target scope, ratio-factor chain (read-only; every write on this surface is human-only, ADR-0180)." },

  // ── S3 synergy and strategic fit ─────────────────────────────────────
  { name: "get_opportunity_screening", kind: "read", method: "GET", path: "/api/opportunities/{opportunityId}/screening",
    activities: ["strategic-fit-screening"], description: "Screening view — judgment inputs plus the deterministic Go/Hold/Kill recommendation (a recommendation only)." },
  { name: "start_synergy_analysis", kind: "generate", method: "POST", path: "/api/synergy/analyses", body: "required", bodyHint: BODY,
    activities: ["synergy-analysis", "synergy-red-team"], artifacts: ["stage:S3:1"], description: "Run a synergy analysis. The synergy score is a recommendation; a person confirms it in the web app." },
  { name: "rerun_synergy_analysis", kind: "generate", method: "POST", path: "/api/synergy/analyses/{analysisId}/rerun", body: "optional",
    activities: ["synergy-analysis", "synergy-red-team"], description: "Re-run a synergy analysis." },
  { name: "record_capability_list", kind: "write", method: "PUT", path: "/api/opportunities/{opportunityId}/capability-gap", body: "required", bodyHint: BODY,
    activities: ["strategic-fit-screening", "capability-register-greenfield", "capability-register-brownfield", "capability-assessment"], artifacts: ["stage:S5:1"],
    description: "Save the required-capability list and gap register (S3 list, S5 gap assessment)." },
  { name: "draft_capability_gap", kind: "generate", method: "POST", path: "/api/opportunities/{opportunityId}/capability-gap/llm-draft", body: "optional",
    activities: ["capability-assessment"], description: "Requirement-side draft (nothing is saved): proposes extra capability rows from synergy areas (or, without a synergy analysis, the S2 sketch and S1 factors; each row's source says which) and fills EMPTY necessity (essential|partial_essential|optional) and required-level narrative with a basis each. Always detects rows with a missing necessity or required level and reports how many cells were filled and how many remain missing (batched LLM calls, per-item validation). Never touches holding fields; a person reviews and saves." },
  { name: "check_capability_holding", kind: "generate", method: "POST", path: "/api/opportunities/{opportunityId}/capability-gap/holding-check", body: "optional",
    activities: ["capability-assessment"], description: "Holding-side draft (nothing is saved): proposes holding status, holding-level narrative and holding evidence (no holders; ADR-0172 amendment 2026-10-14 (2)) for unjudged or empty rows from group/affiliate profiles plus bounded external web search, with citations required (unsupported rows stay unjudged). Web text is untrusted data. Optional body {rows, webSearch:false, includeGroupMembers:true (adds up to 8 other members of the same group as evidence; default false)}. Rows left unevaluated come back with a short reason (unevaluatedReasons). Unverified (LLM-guessed) profile text is not citable. A person reviews and saves." },
  { name: "draft_capability_judgement", kind: "generate", method: "POST", path: "/api/opportunities/{opportunityId}/capability-attainability/ai-draft", body: "optional",
    activities: ["capability-assessment"], description: "S5 judgement proposal (nothing is saved, nothing is confirmed): proposes resolution (build|partner|hire|invest), expected level, cost (KRW million) and months as ESTIMATES only when defensible, attainability grade, a short rationale, and the investment category (labor|opex|capex: 인건비/운영비/설비투자) for the linked investment line, each with a basis, for rows that are stale, unjudged or lack a resolution or expected level. Optional body {rowIds (max 12 rows per call), includeEvidence:false}. Fills only fields that are empty; unsupported fields stay empty with a reason (unfilled). Offline: stored S3 data and company profiles plus the LLM, no web search. A person reviews, edits and saves; confirming is a separate human-only act and has no tool." },
  { name: "get_our_company_profile", kind: "read", method: "GET", path: "/api/our-company/members/{memberId}/profile",
    activities: ["our-company-profile"], description: "A group member's company profile." },
  { name: "analyze_our_company_member", kind: "generate", method: "POST", path: "/api/our-company/members/{memberId}/analyze", body: "optional",
    activities: ["our-company-profile"], description: "Refresh the company-profile analysis for a group member." },

  // ── S4 entry route ───────────────────────────────────────────────────
  { name: "get_route_decisions", kind: "read", method: "GET", path: "/api/opportunities/{opportunityId}/route-decision",
    activities: ["route-strategy"], description: "Route decisions (and the open draft) for an opportunity." },
  { name: "save_route_decision_draft", kind: "write", method: "PUT", path: "/api/opportunities/{opportunityId}/route-decision/draft", body: "required", bodyHint: BODY,
    activities: ["route-strategy"], description: "Save the route-decision DRAFT. The decision itself is a proposal a person confirms (propose_route_decision)." },
  { name: "get_route_advisory", kind: "read", method: "GET", path: "/api/opportunities/{opportunityId}/route-advisory",
    activities: ["route-advisory"], description: "Track advisor votes and the staging recommendation." },
  { name: "generate_route_recommendation", kind: "generate", method: "POST", path: "/api/opportunities/{opportunityId}/route-recommendation", body: "optional",
    activities: ["deal-shape-evaluation", "route-advisory"], description: "Recommend the entry route with reasoning (a recommendation, not a decision)." },

  // ── S5 greenfield entry ──────────────────────────────────────────────
  { name: "get_greenfield_assessment", kind: "read", method: "GET", path: "/api/greenfield/{opportunityId}",
    activities: ["capability-assessment", "entry-strategy", "business-case-lines"], description: "The greenfield self-entry assessment." },
  { name: "record_greenfield_assessment", kind: "write", method: "POST", path: "/api/greenfield/{opportunityId}", body: "required", bodyHint: BODY,
    activities: ["capability-assessment", "entry-strategy", "business-case-lines"], artifacts: ["stage:S5:1", "stage:S5:2"],
    description: "Save the capability-gap resolutions, entry strategy (Build/Partner/Hire/Invest), and investment lines." },
  { name: "generate_entry_strategy_recommendation", kind: "generate", method: "POST", path: "/api/greenfield/{opportunityId}/recommendation", body: "optional",
    activities: ["entry-strategy", "business-case-lines"], description: "Recommend investment-review items and entry strategy (amounts stay human inputs)." },
  { name: "draft_entry_strategy", kind: "generate", method: "POST", path: "/api/greenfield/{opportunityId}/entry-strategy-draft", body: "optional",
    activities: ["entry-strategy"], description: "S5 entry-strategy proposal (nothing is saved, nothing is decided): proposes the entry modes (build|partner|hire|invest, exactly one main) with a reason each, a rationale (max 600) and the considered-but-rejected alternatives (max 600), from stored S3 register, S4 decision record, opportunity context and company profile/disclosure data plus the LLM; no web search. A person fills only empty fields on the page and saves (record_greenfield_assessment). Without a configured LLM: 200 with an empty proposal." },

  // ── S6 target universe and long list (brownfield) ────────────────────
  { name: "draft_universe_criteria", kind: "generate", method: "POST", path: "/api/brownfield/{opportunityId}/universe-criteria-draft", body: "optional",
    activities: ["target-universe-definition"], description: "Draft the target-universe criteria." },
  { name: "record_universe_criterion", kind: "write", method: "POST", path: "/api/brownfield/{opportunityId}/eval-criteria", body: "required", bodyHint: BODY,
    activities: ["target-universe-definition"], artifacts: ["stage:S6:1"], description: "Add a target-universe / evaluation criterion." },
  { name: "list_candidates", kind: "read", method: "GET", path: "/api/brownfield/{opportunityId}/targets",
    activities: ["target-longlist"], description: "The target-company long list." },
  { name: "add_candidate", kind: "write", method: "POST", path: "/api/brownfield/{opportunityId}/targets", body: "required", bodyHint: BODY,
    activities: ["target-longlist"], artifacts: ["stage:S6:2"], description: "Add a target company to the long list." },
  { name: "generate_target_candidates", kind: "generate", method: "POST", path: "/api/brownfield/{opportunityId}/target-proposals/web-search", body: "optional",
    activities: ["target-longlist"], description: "Web-search target candidates (proposals only)." },

  // ── S7 target screening ──────────────────────────────────────────────
  { name: "get_candidate_eval_state", kind: "read", method: "GET", path: "/api/brownfield/{opportunityId}/targets/{targetId}/eval-state",
    activities: ["target-screening"], description: "Per-criterion evaluation state for one target." },
  { name: "draft_candidate_screening", kind: "generate", method: "POST", path: "/api/brownfield/{opportunityId}/targets/{targetId}/screening-draft", body: "optional",
    activities: ["target-screening", "ownership-regulatory-screening"], description: "Draft the screening evidence for one target (draft only)." },
  { name: "record_candidate_screening", kind: "write", method: "PUT", path: "/api/brownfield/{opportunityId}/targets/{targetId}/eval-state/{criterionId}", body: "required", bodyHint: BODY,
    activities: ["target-screening", "ownership-regulatory-screening", "target-ranking"], artifacts: ["stage:S7:2"],
    description: "Record one criterion judgment for a target. Scores feed the ranking; the final rank order is a human act (rerank is not exposed)." },
  { name: "shortlist_candidate", kind: "write", method: "POST", path: "/api/brownfield/{opportunityId}/targets/{targetId}/shortlist", body: "optional",
    activities: ["target-screening"], artifacts: ["stage:S7:1"], description: "Promote a fully evaluated target to the short list." },
  { name: "exclude_candidate", kind: "write", method: "POST", path: "/api/brownfield/{opportunityId}/targets/{targetId}/exclude", body: "required", bodyHint: BODY,
    activities: ["target-screening"], artifacts: ["stage:S7:3"], description: "Exclude a target and record the exclusion reason." },

  // ── S8 business case and valuation ───────────────────────────────────
  { name: "get_business_case", kind: "read", method: "GET", path: "/api/projects/{projectId}/business-case",
    activities: ["business-case-modeling"], description: "Business-case models, lines, and simulations for a project." },
  { name: "save_business_case", kind: "write", method: "POST", path: "/api/projects/{projectId}/business-case", body: "required", bodyHint: BODY,
    activities: ["business-case-modeling"], artifacts: ["stage:S8:1"], description: "Create a business-case model (manual cost/revenue lines or valuation)." },
  { name: "set_business_case_params", kind: "write", method: "POST", path: "/api/projects/{projectId}/business-case/params", body: "required", bodyHint: BODY,
    activities: ["valuation", "quant-methods"], description: "Set the business-case generation parameters. The EV/Revenue band is human-only and cannot be set here." },
  { name: "generate_business_case", kind: "generate", method: "POST", path: "/api/projects/{projectId}/business-case/generate", body: "optional", bodyHint: BODY,
    activities: ["business-case-modeling", "valuation", "quant-methods"], artifacts: ["stage:S8:1", "stage:S8:2", "stage:S8:3"],
    description: "Generate business cases, NPV quantile simulation, and BEP. Flags a RECOMMENDED case; adoption is a proposal a person confirms." },
  { name: "get_business_case_run", kind: "read", method: "GET", path: "/api/projects/{projectId}/business-case/generate/{runId}",
    activities: ["business-case-modeling"], description: "Status of a business-case generation run." },
  { name: "recommend_case_adoption", kind: "generate", method: "POST", path: "/api/projects/{projectId}/business-case/adoption-recommendation", body: "optional",
    activities: ["target-comparison"], artifacts: ["stage:S8:4"], description: "Compare cases/targets and recommend one (a recommendation; propose_case_adoption records the proposal)." },
  { name: "record_wacc", kind: "write", method: "POST", path: "/api/projects/{projectId}/wacc", body: "required", bodyHint: BODY,
    activities: ["valuation", "wacc-hurdle-confirmation"], description: "Record WACC inputs for a project." },
  { name: "record_target_costing", kind: "write", method: "POST", path: "/api/projects/{projectId}/target-costing", body: "required", bodyHint: BODY,
    activities: ["valuation"], description: "Record target-costing analysis inputs." },
  { name: "calibrate_proxy_chain", kind: "generate", method: "POST", path: "/api/projects/{projectId}/proxy-chain/calibrate", body: "optional",
    activities: ["quant-methods"], description: "Calibrate the project's proxy chain statistically." },
  { name: "get_target_check", kind: "read", method: "GET", path: "/api/projects/{projectId}/target-check",
    activities: ["target-comparison"], description: "Business-goal check for the adopted case: project goals (set by analysts, ADR-0159) plus affiliate/group standards, resolved project > affiliate > group per metric. Each entry has source (project|affiliate|group), shadowed, rationale and status; scope is null when the standards scope is unresolved but project goals still apply. Read only." },

  // ── S9 due diligence ─────────────────────────────────────────────────
  { name: "tailor_dd_checklist", kind: "generate", method: "POST", path: "/api/projects/{projectId}/dd-checklist/tailor", body: "optional",
    bodyHint: "{domains?: [commercial|technical|legal], target_id?: string} — target_id (ADR-0157) must be a target whose DD a person already opened; omitted = the selected target. A write to an unopened target fails with 409.",
    activities: ["commercial-dd", "technical-dd", "legal-dd"], description: "Run the industry-tailored DD checklist chain. Writes PROPOSED custom items only; a person reviews them. Optional body.target_id scopes it to an opened comparison target." },
  { name: "record_dd_finding", kind: "write", method: "POST", path: "/api/projects/{projectId}/partners/{partnerId}/findings", body: "required", bodyHint: BODY,
    activities: ["commercial-dd", "legal-dd"], description: "Record a DD finding against a partner candidate (with its value impact)." },
  { name: "record_customer_coc", kind: "write", method: "POST", path: "/api/projects/{projectId}/customer-coc", body: "required", bodyHint: BODY,
    activities: ["commercial-dd", "customer-retention-dd"], description: "Record a customer change-of-control clause finding." },
  { name: "record_interview", kind: "write", method: "POST", path: "/api/projects/{projectId}/interviews", body: "required", bodyHint: BODY,
    activities: ["commercial-dd"], description: "Record an expert/customer interview." },
  { name: "record_antitrust_screen", kind: "write", method: "POST", path: "/api/projects/{projectId}/antitrust", body: "required", bodyHint: BODY,
    activities: ["legal-dd", "antitrust-dd"], description: "Record the ownership/antitrust screening numbers (filing decisions stay human)." },
  { name: "record_site_assessment", kind: "write", method: "POST", path: "/api/projects/{projectId}/sites", body: "required", bodyHint: BODY,
    activities: ["technical-dd"], description: "Record site/facility assessment scores." },
  { name: "record_permit", kind: "write", method: "POST", path: "/api/projects/{projectId}/permits", body: "required", bodyHint: BODY,
    activities: ["legal-dd"], description: "Record a permit or certification (tracked separately)." },
  { name: "request_dd_waiver", kind: "write", method: "POST", path: "/api/projects/{projectId}/waivers", body: "required",
    bodyHint: "Waiver request fields (governance_doc_id, clause_ref = '<checklist_id> <item_id>' or dd_item, reason, approver_role = entity-ic-reviewer | group-ic-reviewer, expires_at); optional target_id (ADR-0157) scopes it to an opened comparison target — 409 when DD was never opened there. A waiver on one target never applies to another. Do NOT send approved_by: it never grants authority (ignored and logged; rejected once the compatibility window ends). A mandatory non-waiver-eligible item is 422 not_waivable; the reason must state the actual reasoning (422 rationale_insufficient). A request is always pending until a different human holding the approver role approves it in the web app (ADR-0186).",
    activities: ["dd-waiver-review"], description: "File a waiver REQUEST (always pending). Approval is a separate human act in the web app by a different person holding the approver human role (ADR-0186); no MCP tool can approve." },

  // ── S10 investment structure ─────────────────────────────────────────
  { name: "get_deal_structure", kind: "read", method: "GET", path: "/api/projects/{projectId}/deal-structure",
    activities: ["deal-structure-hypothesis", "financing-plan"], description: "Deal-structure hypotheses and the financing plan (sources and uses)." },
  { name: "record_deal_structure", kind: "write", method: "POST", path: "/api/projects/{projectId}/deal-structure", body: "required",
    bodyHint: "{action: hypothesize | add_financing_entry | remove_financing_entry, ...fields}. complete_four_axis is a human approval (propose_approval).",
    blockBody: { field: "action", values: ["complete_four_axis"] },
    activities: ["deal-structure-hypothesis", "financing-plan"], artifacts: ["stage:S10:2"],
    description: "Hypothesize a deal structure or edit financing lines. The four-axis completion is a human approval, not available here." },
  { name: "recommend_deal_structure", kind: "generate", method: "POST", path: "/api/projects/{projectId}/deal-structure-recommendation", body: "optional",
    activities: ["deal-structure-hypothesis"], description: "Recommend a deal structure (a recommendation only)." },

  // ── S11 investment review and execution ──────────────────────────────
  { name: "generate_gate_brief", kind: "generate", method: "POST", path: "/api/projects/{projectId}/gate-brief", body: "optional",
    activities: ["ic-preparation", "risk-review", "group-review"], description: "Compose the gate brief for entity_ic / group_ic (on demand, nothing decided). The result carries brief_id (pass it to propose_gate_decision so the AI recommendation is recorded beside the human decision) and the deterministic kill-criteria evaluation." },
  { name: "get_charter", kind: "read", method: "GET", path: "/api/projects/{projectId}/charter",
    activities: ["charter-baseline"], description: "The project charter with version history." },
  { name: "record_charter_amendment", kind: "write", method: "POST", path: "/api/projects/{projectId}/charter", body: "required", bodyHint: BODY,
    activities: ["charter-baseline"], artifacts: ["stage:S11:2"], description: "Append a charter amendment (new version). Confirming the baseline is a human approval (propose_approval)." },
  { name: "record_jv_term", kind: "write", method: "POST", path: "/api/projects/{projectId}/jv-terms", body: "required", bodyHint: BODY,
    activities: ["investment-structuring"], description: "Record a JV term (equity structure, governance, exit clauses)." },
  { name: "record_incentive", kind: "write", method: "POST", path: "/api/projects/{projectId}/incentives", body: "required", bodyHint: BODY,
    activities: ["investment-structuring", "incentive-dd"], description: "Record a regional incentive for the investment structure." },
  { name: "run_rag_recompute", kind: "generate", method: "POST", path: "/api/projects/{projectId}/rag/recompute", body: "optional",
    activities: ["risk-review"], description: "Recompute the AI-PROPOSED RAG grade (idempotent; capped by data confidence; never a decision)." },
  { name: "record_establishment", kind: "write", method: "PUT", path: "/api/projects/{projectId}/establishment", body: "required",
    blockBody: { field: "status", values: ["done"] },
    activities: ["entity-establishment-execution"], artifacts: ["stage:S11:4"], bodyHint: "{ step_no: 1-5, status: in_progress | halted | escalated, origin: internal | joint, mode?: new_entity | business_unit, note?, evidence_url? }",
    description: "Record an establishment step status (in_progress / halted / escalated) with a note, for the project's CURRENT establishment mode (new_entity = entity-formation steps, business_unit = new-business-unit steps; read the current mode and step titles from get_project_process or the establishment record). mode is optional and only a consistency check — it can never set the mode (409 mode_mismatch); if the mode is not chosen yet (409 mode_not_chosen) use propose_establishment_mode. Completion (done), assignment, reopen and choosing the mode are human-only: tell the user to do it in the web UI." },
  { name: "record_pmi_key_talent", kind: "write", method: "POST", path: "/api/projects/{projectId}/pmi/key-talent", body: "required", bodyHint: BODY,
    description: "PMI planning draft: a key-talent retention entry (status: active | departed_regretted | departed_planned). (PMI kickoff itself is not exposed.)" },
  { name: "record_pmi_synergy_certification", kind: "write", method: "POST", path: "/api/projects/{projectId}/pmi/synergy-certifications", body: "required", bodyHint: BODY,
    description: "PMI planning draft: a synergy-certification entry. (PMI kickoff itself is not exposed.)" },

  // ── S12 post-investment monitoring ───────────────────────────────────
  { name: "generate_monitoring_brief", kind: "generate", method: "POST", path: "/api/projects/{projectId}/monitoring-brief", body: "optional",
    activities: ["portfolio-monitoring"], description: "Compose the portfolio monitoring brief (read-only analysis)." },
];

export const STAGE_TOOLS: readonly RegistryTool[] = SPECS.map(routeTool);
