// @version 1.1.0
/**
 * Process tools — ADR-0074 Process Meta Model Platform, ADR-0094
 * opportunity-keyed addressing. All thin REST wrappers (ADR-0011) over
 * /api/opportunities/**. Exposes the S2 opportunity funnel, S1-S11 stage
 * evaluation, gate decisions, and the S4 route decision to MCP clients
 * (Claude Desktop).
 *
 * promote_opportunity removed — its /api/opportunities/:id/promote route
 * does not exist (promotion now happens through the opportunity lifecycle
 * routes); run_stage_agents likewise stays unregistered until its REST
 * route is built (ADR-0094 deferral). Do not advertise dead endpoints.
 */

import { rest } from "../shared/rest-client.ts";

// ── Opportunity funnel (S2) ─────────────────────────────────────────────

export async function listOpportunities(status?: string) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return rest.get(`/api/opportunities${qs}`);
}

export async function createOpportunity(body: {
  name: string; market_scope?: string; value_chain_node?: string;
  market_size_krw_m?: number; growth_rate?: number;
  attractiveness_score?: number; synergy_score?: number;
  status?: string; rationale?: string;
}) {
  return rest.post("/api/opportunities", body);
}

// ── Process evaluation (opportunity = S1~S7 carrier; projects carry S8~S11, ADR-0094) ──

export async function getProcessEvaluation(opportunityId: string) {
  return rest.get(`/api/opportunities/${encodeURIComponent(opportunityId)}/process`);
}

// run_stage_agents: DEFERRED — the agent-orchestrator REST route
// (/api/opportunities/:id/agent-run) does not exist yet; the MCP tool is not
// registered until it does. Do not advertise a dead endpoint.

// ── Gate decisions ──────────────────────────────────────────────────────

export async function listGateDecisions(opportunityId: string) {
  return rest.get(`/api/opportunities/${encodeURIComponent(opportunityId)}/gate-decisions`);
}

export async function recordGateDecision(opportunityId: string, body: {
  gate: string; decision: string; rationale: string; missing_artifacts?: string[]; learning_capture?: string;
}) {
  return rest.post(`/api/opportunities/${encodeURIComponent(opportunityId)}/gate-decisions`, body);
}

// ── Route decision (S4) ─────────────────────────────────────────────────

export async function createRouteDecision(opportunityId: string, body: {
  track: string; sub_track?: string;
  rationale: string; alternatives_considered?: string;
  // S4 scoring is mandatory on both tracks (spec v2.2.0+, ADR-0104).
  intent?: string;
  scores?: Array<{ criterion: string; score: number; evidence_note: string }>;
}) {
  return rest.post(`/api/opportunities/${encodeURIComponent(opportunityId)}/route-decision`, body);
}
