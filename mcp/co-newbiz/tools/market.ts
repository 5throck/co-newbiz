// @version 1.1.0
/**
 * Market / value-chain tools — ADR-0066 Phases A+C + ADR-0067 round 4.
 * All thin REST wrappers (ADR-0011).
 */

import { rest } from "../shared/rest-client.ts";

export async function getChainTopology(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/value-chain/topology`);
}

export async function getStageFinancials(projectId: string, industryId: string, years?: number) {
  const suffix = years ? `?years=${years}` : "";
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/industries/${encodeURIComponent(industryId)}/financials${suffix}`);
}

export async function listScreeningLonglist(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/screening-longlist`);
}

export async function addScreeningLonglistEntry(projectId: string, body: { candidate_name: string; knock_out_passed: boolean; notes?: string }) {
  return rest.post(`/api/projects/${encodeURIComponent(projectId)}/screening-longlist`, body);
}

export async function listPartnerDDFindings(projectId: string) {
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/partner-dd-findings`);
}

export async function addPartnerDDFinding(projectId: string, body: { partner_id: string; workstream: string; severity: string; description: string }) {
  return rest.post(`/api/projects/${encodeURIComponent(projectId)}/partner-dd-findings`, body);
}

export async function listChainSensitivities(projectId: string, industryId?: string) {
  const suffix = industryId ? `?industry_id=${encodeURIComponent(industryId)}` : "";
  return rest.get(`/api/projects/${encodeURIComponent(projectId)}/chain-sensitivities${suffix}`);
}

export async function upsertChainSensitivity(projectId: string, body: { industry_id: string; driver_code: string; sensitivity: number; lag_months?: number }) {
  return rest.post(`/api/projects/${encodeURIComponent(projectId)}/chain-sensitivities`, body);
}
