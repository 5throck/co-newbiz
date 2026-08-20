// @version 1.0.0
/**
 * M&A special-topics / green-field tools — mcp-integration.md §3. Thin REST
 * wrappers over app/server/deal-review.ts (Wave 5.7B). list_regulatory_
 * requirements and get_permit_path keep permits and certifications as
 * parallel structures — the MCP layer never merges them (design §4-1
 * non-negotiable boundary). add_dd_finding (✱ write) follows the
 * manage_watch pattern: required fields checked here, scope and the
 * rbd_source rule enforced REST-side.
 */

import { rest } from "../shared/rest-client.ts";

export async function listDdFindings(projectId: string, category?: string) {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  const qs = params.toString();
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/dd-findings${qs ? `?${qs}` : ""}`);
}

interface DdFindingRow {
  id: string;
  description: string;
  value_impact: number | null;
  assumption_key: string | null;
  rbd_source: string | null;
  trl_grade: string | null;
  ip_ownership_status: string | null;
  commercialization_path: string | null;
  parent_relationship_json: string | null;
}

/**
 * Reshapes category='rbd' dd-findings into the R&BD-specific profile the
 * R&BD checklist consumes (rbd_source / TRL / IP / commercialization /
 * originator relationship) — generic DD columns stay for context, and the
 * envelope's meta/error pass through untouched.
 */
export async function getRbdSourceProfile(projectId: string) {
  const result = await rest.get<DdFindingRow[]>(
    `/api/projects/${encodeURIComponent(projectId)}/dd-findings?category=rbd`,
  );
  const profile = (result.data ?? []).map((row) => ({
    id: row.id,
    description: row.description,
    value_impact: row.value_impact,
    assumption_key: row.assumption_key,
    rbd_source: row.rbd_source,
    trl_grade: row.trl_grade,
    ip_ownership_status: row.ip_ownership_status,
    commercialization_path: row.commercialization_path,
    parent_relationship: parseRelationship(row.parent_relationship_json),
  }));
  return { ...result, data: profile };
}

function parseRelationship(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export interface DdFindingInput {
  category: string;
  description: string;
  value_impact?: number;
  assumption_key?: string;
  evidence_ref?: string;
  trl_grade?: string;
  ip_ownership_status?: string;
  commercialization_path?: string;
  parent_relationship_json?: string;
  rbd_source?: string;
}

/** ✱ write — needs the token's write scope; category='rbd' requires rbd_source (enforced REST-side). */
export async function addDdFinding(projectId: string, finding: DdFindingInput) {
  if (!projectId?.trim()) throw new Error("projectId is required.");
  if (!finding?.category?.trim() || !finding?.description?.trim()) {
    throw new Error("category and description are required.");
  }
  return rest.post(`/api/projects/${encodeURIComponent(projectId)}/dd-findings`, finding);
}

export async function getAntitrustAssessment(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/antitrust`);
}

export async function getIncentiveExposure(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/incentives`);
}

export async function getLiabilityExposure(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/liabilities`);
}

export async function compareSites(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/sites`);
}

export async function listPartnerCandidates(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/partners`);
}

export async function listRegulatoryRequirements(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/permits`);
}

export async function getPermitPath(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/permits?include_dag=1`);
}

export async function getValueChainLinkage(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/value-chain-links`);
}
