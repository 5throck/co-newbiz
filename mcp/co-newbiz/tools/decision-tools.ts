// @version 1.0.0
/**
 * Proposal and review tools — ADR-0154 §5, design §6 (Wave M M-2).
 *
 * Boundary #2: an agent never records a decision. Every propose_* tool calls
 * POST /api/proposals, which writes ONE decision_proposal row and returns the
 * confirm URL; a human then confirms it on /proposals/{id}/confirm in their own
 * web session, and that session runs the existing decision route. The tools
 * hold no decision route path: the only decision-related route they declare is
 * POST /api/proposals (the coverage script fails the build if a tool declares
 * a human-only route).
 *
 * record_gate_decision / create_route_decision survive for one release as
 * deprecated ALIASES of propose_gate_decision / propose_route_decision on both
 * transports: same behavior, plus a deprecation notice (design §6.4).
 */

import { z } from "zod";
import { defineTool, optString, requiredString, type RegistryTool } from "../define.ts";
import type { RestPort } from "../shared/rest-port.ts";

const evidenceRefs = z.array(z.string()).optional();
const evidenceProp = { type: "array", items: { type: "string" }, description: "References (document ids, URLs, artifact keys) supporting the proposal." };

const DEPRECATION = (alias: string, replacement: string) => ({
  deprecated: true,
  tool: alias,
  replacement,
  message: `${alias} no longer records a decision: it creates a decision proposal and returns the confirm URL. A person confirms it in the web app. ${alias} is removed in the next release; use ${replacement}.`,
});

async function createProposal(
  port: RestPort,
  kind: string,
  entityId: string,
  payload: Record<string, unknown>,
  rationale: string,
  refs: string[] | undefined,
) {
  return port.post("/api/proposals", { kind, entity_id: entityId, payload, rationale, evidence_refs: refs });
}

const gateArgs = z.object({
  entityId: requiredString,
  gate: requiredString,
  decision: requiredString,
  rationale: requiredString,
  gap_rationale: optString,
  missing_artifacts: z.array(z.string()).optional(),
  learning_capture: optString,
  gate_evaluation_id: optString,
  evidence_refs: evidenceRefs,
});

const routeScoreArg = z.object({ criterion: z.string(), score: z.number().int(), evidence_note: z.string() });
const routeArgs = z.object({
  opportunityId: requiredString,
  track: requiredString,
  rationale: requiredString,
  sub_track: optString,
  alternatives_considered: optString,
  intent: requiredString,
  scores: z.array(routeScoreArg),
  gate_evaluation_id: optString,
  evidence_refs: evidenceRefs,
});

const gateProps = {
  gate: { type: "string", enum: ["screening", "pre_fs", "target_screening", "fs", "dd", "entity_ic", "group_ic"] },
  decision: { type: "string", enum: ["go", "hold", "kill"] },
  rationale: { type: "string" },
  gap_rationale: { type: "string", description: "Required for an entity_ic/group_ic GO when open IC gaps exist; stored with the decision." },
  missing_artifacts: { type: "array", items: { type: "string", }, description: "Required when decision is hold." },
  learning_capture: { type: "string", description: "Required when decision is kill (ADR-0152)." },
  gate_evaluation_id: { type: "string" },
  evidence_refs: evidenceProp,
};

const routeProps = {
  track: { type: "string", enum: ["greenfield", "brownfield"] },
  sub_track: { type: "string" },
  rationale: { type: "string" },
  alternatives_considered: { type: "string" },
  intent: { type: "string", enum: ["integration", "capability_access"] },
  scores: {
    type: "array",
    description: "All five criteria scored 1-3 with evidence notes (ADR-0104).",
    items: {
      type: "object",
      properties: {
        criterion: { type: "string", enum: ["control_need", "capability_criticality", "market_uncertainty", "integration_capacity", "speed_to_capability"] },
        score: { type: "integer", minimum: 1, maximum: 3 },
        evidence_note: { type: "string" },
      },
      required: ["criterion", "score", "evidence_note"],
    },
  },
  gate_evaluation_id: { type: "string" },
  evidence_refs: evidenceProp,
};

type GateInput = z.output<typeof gateArgs>;
type RouteInput = z.output<typeof routeArgs>;

const proposeGate = (port: RestPort, a: GateInput) =>
  createProposal(port, "gate_decision", a.entityId, {
    gate: a.gate, decision: a.decision, rationale: a.rationale,
    gap_rationale: a.gap_rationale,
    missing_artifacts: a.missing_artifacts, learning_capture: a.learning_capture, gate_evaluation_id: a.gate_evaluation_id,
  }, a.rationale, a.evidence_refs);

const proposeRoute = (port: RestPort, a: RouteInput) =>
  createProposal(port, "route_decision", a.opportunityId, {
    track: a.track, sub_track: a.sub_track, rationale: a.rationale, alternatives_considered: a.alternatives_considered,
    intent: a.intent, scores: a.scores, gate_evaluation_id: a.gate_evaluation_id,
  }, a.rationale, a.evidence_refs);

const PROPOSE_NOTE = "Creates a decision PROPOSAL only (nothing is decided); returns the confirm URL where a person confirms it in their own web session.";

const projectIdProp = { type: "string", description: "Project ULID (promoted at S8)." };

const withDeprecation = (result: unknown, alias: string, replacement: string): unknown =>
  result && typeof result === "object" ? { ...(result as Record<string, unknown>), deprecation: DEPRECATION(alias, replacement) } : result;

const PROPOSE: RegistryTool[] = [
  defineTool({
    name: "propose_gate_decision",
    description: `Propose a gate decision (go/hold/kill) for an opportunity (screening, pre_fs, target_screening) or a project (fs, dd, entity_ic, group_ic). ${PROPOSE_NOTE}`,
    scope: "propose", kind: "propose", stageActivities: [], stageArtifacts: ["stage:S3:2"], routes: ["POST /api/proposals"],
    inputSchema: {
      type: "object",
      properties: { entityId: { type: "string", description: "Opportunity id for S1-S7 gates; project id for fs/dd/entity_ic/group_ic." }, ...gateProps },
      required: ["entityId", "gate", "decision", "rationale"],
    },
    args: gateArgs,
    handler: (ctx, a) => proposeGate(ctx.port, a),
  }),
  defineTool({
    name: "propose_route_decision",
    description: `Propose the S4 route decision (greenfield/brownfield + sub-track, intent, five scored criteria). ${PROPOSE_NOTE}`,
    scope: "propose", kind: "propose", stageActivities: ["route-strategy"],
    stageArtifacts: ["stage:S4:1", "stage:S4:2", "stage:S4:3", "stage:S4:4"], routes: ["POST /api/proposals"],
    inputSchema: { type: "object", properties: { opportunityId: { type: "string" }, ...routeProps }, required: ["opportunityId", "track", "rationale", "intent", "scores"] },
    args: routeArgs,
    handler: (ctx, a) => proposeRoute(ctx.port, a),
  }),
  defineTool({
    name: "propose_case_adoption",
    description: `Propose adopting one business-case model for the fs gate (S8). ${PROPOSE_NOTE}`,
    scope: "propose", kind: "propose", stageActivities: ["business-case-modeling"], stageArtifacts: ["stage:S8:1"], routes: ["POST /api/proposals"],
    inputSchema: { type: "object", properties: { projectId: projectIdProp, model_id: { type: "string" }, rationale: { type: "string" }, evidence_refs: evidenceProp }, required: ["projectId", "model_id", "rationale"] },
    args: z.object({ projectId: requiredString, model_id: requiredString, rationale: requiredString, evidence_refs: evidenceRefs }),
    handler: (ctx, a) => createProposal(ctx.port, "case_adoption", a.projectId, { model_id: a.model_id }, a.rationale, a.evidence_refs),
  }),
  defineTool({
    name: "propose_target_selection",
    description: `Propose the brownfield S8 target selection (which short-listed target the project proceeds with). ${PROPOSE_NOTE}`,
    scope: "propose", kind: "propose", stageActivities: ["target-selection"], stageArtifacts: ["stage:S8:5"], routes: ["POST /api/proposals"],
    inputSchema: { type: "object", properties: { projectId: projectIdProp, target_id: { type: "string" }, rationale: { type: "string" }, evidence_refs: evidenceProp }, required: ["projectId", "target_id", "rationale"] },
    args: z.object({ projectId: requiredString, target_id: requiredString, rationale: requiredString, evidence_refs: evidenceRefs }),
    handler: (ctx, a) => createProposal(ctx.port, "target_selection", a.projectId, { target_id: a.target_id, rationale: a.rationale }, a.rationale, a.evidence_refs),
  }),
  defineTool({
    name: "propose_transition_decision",
    description: `Propose the S12 portfolio transition decision (5-term vocabulary) with its dedicated record column. ${PROPOSE_NOTE}`,
    scope: "propose", kind: "propose", stageActivities: ["portfolio-monitoring"], stageArtifacts: ["stage:S12:2", "stage:S12:3"], routes: ["POST /api/proposals"],
    inputSchema: {
      type: "object",
      properties: {
        projectId: projectIdProp,
        decision: { type: "string", enum: ["next_tranche_released", "held_evidence_incomplete", "graduate_to_core", "reduce_or_divest", "kill_with_learning_captured"] },
        rationale: { type: "string" },
        learning_capture: { type: "string", description: "Required for kill_with_learning_captured." },
        tranche_condition: { type: "string", description: "Required for next_tranche_released / held_evidence_incomplete." },
        core_handoff: { type: "string", description: "Required for graduate_to_core." },
        divest_plan: { type: "string", description: "Required for reduce_or_divest." },
        review_cycle: { type: "string", description: "YYYY-Qn; defaults to the current quarter." },
        evidence_refs: evidenceProp,
      },
      required: ["projectId", "decision", "rationale"],
    },
    args: z.object({
      projectId: requiredString, decision: requiredString, rationale: requiredString, learning_capture: optString,
      tranche_condition: optString, core_handoff: optString, divest_plan: optString, review_cycle: optString, evidence_refs: evidenceRefs,
    }),
    handler: (ctx, a) => createProposal(ctx.port, "transition_decision", a.projectId, {
      decision: a.decision, rationale: a.rationale, learning_capture: a.learning_capture, tranche_condition: a.tranche_condition,
      core_handoff: a.core_handoff, divest_plan: a.divest_plan, review_cycle: a.review_cycle,
    }, a.rationale, a.evidence_refs),
  }),
  defineTool({
    name: "propose_approval",
    description: `Propose a human approval that stamps a human_final review: charter_baseline (S11), dd_checklist_judgment (S9, needs checklist_id, item_id, status), four_axis_completion (S10, needs hypothesis_id, artifact_ref), or dd_target_open (S9, ADR-0157: SUGGEST comparison DD on another shortlisted target — needs target_id and a rationale; only the person who confirms it opens DD, no tool does). ${PROPOSE_NOTE}`,
    scope: "propose", kind: "propose", stageActivities: ["charter-baseline"],
    stageArtifacts: ["stage:S9:1", "stage:S10:1", "stage:S11:3"], routes: ["POST /api/proposals"],
    inputSchema: {
      type: "object",
      properties: {
        projectId: projectIdProp,
        subject: { type: "string", enum: ["charter_baseline", "dd_checklist_judgment", "four_axis_completion", "dd_target_open"] },
        details: { type: "object", description: "Subject fields: dd_checklist_judgment {checklist_id, item_id, status, note?, evidence_ref?, waiver_id?}; four_axis_completion {hypothesis_id, artifact_ref}; dd_target_open {target_id, rationale}." },
        rationale: { type: "string" },
        evidence_refs: evidenceProp,
      },
      required: ["projectId", "subject", "rationale"],
    },
    args: z.object({ projectId: requiredString, subject: requiredString, details: z.record(z.string(), z.unknown()).optional(), rationale: requiredString, evidence_refs: evidenceRefs }),
    handler: (ctx, a) => createProposal(ctx.port, "approval", a.projectId, { subject: a.subject, ...(a.details ?? {}) }, a.rationale, a.evidence_refs),
  }),
  // Deprecated aliases (design §6.4): same proposal behavior on BOTH transports.
  defineTool({
    name: "record_gate_decision",
    description: "DEPRECATED alias of propose_gate_decision — it no longer records a decision. Creates a decision proposal and returns the confirm URL. Removed next release.",
    scope: "propose", kind: "propose", stageActivities: [], deprecated: true, routes: ["POST /api/proposals"],
    inputSchema: {
      type: "object",
      properties: { opportunityId: { type: "string" }, ...gateProps },
      required: ["opportunityId", "gate", "decision", "rationale"],
    },
    args: gateArgs.omit({ entityId: true }).extend({ opportunityId: requiredString }),
    handler: async (ctx, { opportunityId, ...rest }) =>
      withDeprecation(await proposeGate(ctx.port, { entityId: opportunityId, ...rest }), "record_gate_decision", "propose_gate_decision"),
  }),
  defineTool({
    name: "create_route_decision",
    description: "DEPRECATED alias of propose_route_decision — it no longer records a decision. Creates a decision proposal and returns the confirm URL. Removed next release.",
    scope: "propose", kind: "propose", stageActivities: [], deprecated: true, routes: ["POST /api/proposals"],
    inputSchema: { type: "object", properties: { opportunityId: { type: "string" }, ...routeProps }, required: ["opportunityId", "track", "rationale", "intent", "scores"] },
    args: routeArgs,
    handler: async (ctx, a) => withDeprecation(await proposeRoute(ctx.port, a), "create_route_decision", "propose_route_decision"),
  }),
];

const carrierArg = z.enum(["opportunity", "project"]);
const reviewArgs = z.object({ carrier: carrierArg, entityId: requiredString, gate: optString, artifact: optString });
const reviewProps = {
  carrier: { type: "string", enum: ["opportunity", "project"], description: "S1-S7 artifacts and gates ride the opportunity; S8-S12 the project." },
  entityId: { type: "string" },
  gate: { type: "string", description: "Review gate: screening, pre_fs (opportunity); fs, dd, entity_ic, group_ic, transition (project)." },
  artifact: { type: "string", description: "A stage artifact key stage:S#:N (see the coverage list) instead of a gate." },
};

function reviewBase(a: z.output<typeof reviewArgs>): string {
  const root = a.carrier === "project" ? "projects" : "opportunities";
  return `/api/${root}/${encodeURIComponent(a.entityId)}/reviews`;
}
function reviewTarget(a: z.output<typeof reviewArgs>): Record<string, string> {
  return a.artifact ? { artifact: a.artifact } : a.gate ? { gate: a.gate } : {};
}

const REVIEW: RegistryTool[] = [
  defineTool({
    name: "get_review_buckets",
    description: "Latest AI 1st / AI 2nd review for a gate or stage artifact as three buckets — verified, could not verify, needs judgement. There is no PASS stamp; silence is never approval.",
    scope: "read", kind: "read", stageActivities: [],
    routes: ["GET /api/opportunities/{entityId}/reviews", "GET /api/projects/{entityId}/reviews"],
    inputSchema: { type: "object", properties: reviewProps, required: ["carrier", "entityId"] },
    args: reviewArgs,
    handler: (ctx, a) => ctx.port.get(`${reviewBase(a)}?${new URLSearchParams(reviewTarget(a)).toString()}`),
  }),
  defineTool({
    name: "request_review",
    description: "Run the deterministic AI 1st review (completeness and consistency) of a gate or stage artifact as the calling user. Produces buckets for a human; never a decision or approval.",
    scope: "write", kind: "review", stageActivities: [],
    routes: ["POST /api/opportunities/{entityId}/reviews", "POST /api/projects/{entityId}/reviews"],
    inputSchema: { type: "object", properties: reviewProps, required: ["carrier", "entityId"] },
    args: reviewArgs,
    handler: (ctx, a) => ctx.port.post(reviewBase(a), reviewTarget(a)),
  }),
  defineTool({
    name: "request_ai_second_review",
    description: "Run the on-demand AI 2nd (cross-domain LLM) review of a gate or stage artifact as the calling user. A cache hit makes no LLM call; a missing reviewer or exhausted token cap is recorded as not performed.",
    scope: "write", kind: "review", stageActivities: [],
    routes: ["POST /api/opportunities/{entityId}/reviews/ai-2nd", "POST /api/projects/{entityId}/reviews/ai-2nd"],
    inputSchema: { type: "object", properties: reviewProps, required: ["carrier", "entityId"] },
    args: reviewArgs,
    handler: (ctx, a) => ctx.port.post(`${reviewBase(a)}/ai-2nd`, reviewTarget(a)),
  }),
  defineTool({
    name: "get_proposal_status",
    description: "Status of a decision proposal you created (pending, confirmed, rejected, expired, superseded) and its confirm URL.",
    scope: "read", kind: "read", stageActivities: [], routes: ["GET /api/proposals/{proposalId}"],
    inputSchema: { type: "object", properties: { proposalId: { type: "string" } }, required: ["proposalId"] },
    args: z.object({ proposalId: requiredString }),
    handler: (ctx, a) => ctx.port.get(`/api/proposals/${encodeURIComponent(a.proposalId)}`),
  }),
  defineTool({
    name: "list_my_proposals",
    description: "Decision proposals you created, newest first; optional status filter.",
    scope: "read", kind: "read", stageActivities: [], routes: ["GET /api/proposals"],
    inputSchema: { type: "object", properties: { status: { type: "string", enum: ["pending", "confirmed", "rejected", "expired", "superseded"] } } },
    args: z.object({ status: optString }),
    handler: (ctx, a) => ctx.port.get(`/api/proposals${a.status ? `?status=${encodeURIComponent(a.status)}` : ""}`),
  }),
];

export const DECISION_TOOLS: readonly RegistryTool[] = [...PROPOSE, ...REVIEW];
