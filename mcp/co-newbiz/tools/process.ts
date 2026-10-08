// @version 1.3.0
/**
 * Process tools — ADR-0074 Process Meta Model Platform, ADR-0094
 * opportunity-keyed addressing. All thin REST wrappers (ADR-0011) over
 * /api/opportunities/**. Exposes the S2 opportunity funnel, S1-S11 stage
 * evaluation, and gate decision history to MCP clients. Decisions are NEVER
 * written from here (ADR-0154 §5, M-2): propose_* tools create proposals in
 * decision-tools.ts and a human confirms them on the web.
 *
 * promote_opportunity removed — its /api/opportunities/:id/promote route
 * does not exist (promotion now happens through the opportunity lifecycle
 * routes); run_stage_agents likewise stays unregistered until its REST
 * route is built (ADR-0094 deferral). Do not advertise dead endpoints.
 */

import type { RestPort } from "../shared/rest-port.ts";

// ── Opportunity funnel (S2) ─────────────────────────────────────────────

export async function listOpportunities(port: RestPort, status?: string) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return port.get(`/api/opportunities${qs}`);
}

export async function createOpportunity(port: RestPort, body: {
  name: string; market_scope?: string; value_chain_node?: string;
  market_size_krw_m?: number; growth_rate?: number;
  attractiveness_score?: number; synergy_score?: number;
  status?: string; rationale?: string;
}) {
  return port.post("/api/opportunities", body);
}

// ── Process evaluation (opportunity = S1~S7 carrier; projects carry S8~S11, ADR-0094) ──

export async function getProcessEvaluation(port: RestPort, opportunityId: string) {
  return port.get(`/api/opportunities/${encodeURIComponent(opportunityId)}/process`);
}

// run_stage_agents: DEFERRED — the agent-orchestrator REST route
// (/api/opportunities/:id/agent-run) does not exist yet; the MCP tool is not
// registered until it does. Do not advertise a dead endpoint.

// ── Gate decisions ──────────────────────────────────────────────────────

export async function listGateDecisions(port: RestPort, opportunityId: string) {
  return port.get(`/api/opportunities/${encodeURIComponent(opportunityId)}/gate-decisions`);
}
