// @version 1.0.0
/**
 * Process tools — ADR-0074 Process Meta Model Platform.
 * All thin REST wrappers (ADR-0011). Exposes S1–S7 stage evaluation,
 * agent stage execution, gate decisions, opportunity funnel, and
 * business case to MCP clients (Claude Desktop).
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

export async function updateOpportunity(id: string, body: Record<string, unknown>) {
  return rest.put(`/api/opportunities/${encodeURIComponent(id)}`, body);
}

export async function promoteOpportunity(id: string, body: { project_no: string }) {
  return rest.post(`/api/opportunities/${encodeURIComponent(id)}/promote`, body);
}

// ── Process evaluation (opportunity = S1~S7 lifecycle carrier, ADR-0094) ──

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
  gate: string; decision: string; rationale: string; missing_artifacts?: string[];
}) {
  return rest.post(`/api/opportunities/${encodeURIComponent(opportunityId)}/gate-decisions`, body);
}

// ── Route decision (S4) ─────────────────────────────────────────────────

export async function createRouteDecision(opportunityId: string, body: {
  track: string; sub_track?: string;
  rationale: string; alternatives_considered?: string;
}) {
  return rest.post(`/api/opportunities/${encodeURIComponent(opportunityId)}/route-decision`, body);
}
