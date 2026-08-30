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

// ── Process evaluation ──────────────────────────────────────────────────

export async function getProcessEvaluation(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/process`);
}

export async function runStageAgents(projectId: string, stage: string) {
  return rest.post(`/api/projects/${encodeURIComponent(projectId)}/agent-run`, { stage });
}

// ── Gate decisions ──────────────────────────────────────────────────────

export async function listGateDecisions(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/gate-decisions`);
}

export async function recordGateDecision(projectId: string, body: {
  gate: string; decision: string; rationale: string; missing_artifacts?: string[];
}) {
  return rest.post(`/api/projects/${encodeURIComponent(projectId)}/gate-decisions`, body);
}

// ── Route decision (S4) ─────────────────────────────────────────────────

export async function createRouteDecision(projectId: string, body: {
  opportunity_id?: string; track: string; sub_track?: string;
  rationale: string; alternatives_considered?: string;
}) {
  return rest.post(`/api/projects/${encodeURIComponent(projectId)}/route-decision`, body);
}

// ── Business Case (S5) ──────────────────────────────────────────────────

export async function listBusinessCaseModels(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/business-case`);
}

export async function simulateBusinessCase(projectId: string, body: {
  model_id?: string; iterations?: number; discount_rate?: number;
}) {
  return rest.post(`/api/projects/${projectId}/business-case/simulate`, body);
}
