// @version 1.1.0
/**
 * Governance read tools — mcp-integration.md §3.
 *
 * ADR-0094: the project-scoped governance reads (rag / approval-chain /
 * compliance-checks / waivers) were removed — their backing
 * /api/projects/** routes were deleted. The live lookups remain:
 * /api/interpretations and /api/procedures/resolve.
 */

import type { RestPort } from "../shared/rest-port.ts";

export async function searchInterpretations(port: RestPort, query: { doc?: string; clause?: string; q?: string }) {
  const params = new URLSearchParams();
  if (query.doc) params.set("doc", query.doc);
  if (query.clause) params.set("clause", query.clause);
  if (query.q) params.set("q", query.q);
  const qs = params.toString();
  return port.get(`/api/interpretations${qs ? `?${qs}` : ""}`);
}

export async function getProcedure(port: RestPort, procedure: string, entity?: string, region?: string) {
  const params = new URLSearchParams({ procedure });
  if (entity) params.set("entity", entity);
  if (region) params.set("region", region);
  return port.get(`/api/procedures/resolve?${params.toString()}`);
}
