// @version 1.0.0
/**
 * Governance read tools — mcp-integration.md §3. Every project-scoped call
 * relays the REST layer's own membership gate: a non-member project id
 * returns the REST 404 envelope unchanged (existence stays protected, same
 * as the web app — FR-SEC-01), never rewritten into an MCP-specific error.
 */

import { rest } from "../shared/rest-client.ts";

export async function getRagAssessment(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/rag`);
}

export async function getApprovalChain(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/approval-chain`);
}

export async function getComplianceStatus(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/compliance-checks`);
}

export async function listWaivers(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/waivers`);
}

export async function searchInterpretations(query: { doc?: string; clause?: string; q?: string }) {
  const params = new URLSearchParams();
  if (query.doc) params.set("doc", query.doc);
  if (query.clause) params.set("clause", query.clause);
  if (query.q) params.set("q", query.q);
  const qs = params.toString();
  return rest.get(`/api/interpretations${qs ? `?${qs}` : ""}`);
}

export async function getProcedure(procedure: string, entity?: string, region?: string) {
  const params = new URLSearchParams({ procedure });
  if (entity) params.set("entity", entity);
  if (region) params.set("region", region);
  return rest.get(`/api/procedures/resolve?${params.toString()}`);
}
