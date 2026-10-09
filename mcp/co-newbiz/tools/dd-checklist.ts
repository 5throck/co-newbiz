// @version 1.1.0
/**
 * DD checklist tools — ADR-0099 S9 tailored DD checklists. Thin READ-ONLY
 * REST wrappers (ADR-0011) over /api/projects/:id/dd. Only the implemented
 * surface is exposed (no-dead-endpoint principle): the aggregate S9 read
 * (standard checklists + live judgment state, custom items with provenance,
 * dd_finding list, completion summary). Tailoring (POST) and proposal review
 * (PUT) deliberately have no MCP tools — they are human decisions /
 * web-first write surfaces (design boundary #2); do not advertise them here
 * before the project asks for them.
 */

import type { RestPort } from "../shared/rest-port.ts";

export interface DdWorkspaceEnvelope {
  domains: Array<{
    domain: string;
    checklistId: string;
    title: string;
    items: Array<{ id: string; text: string; mandatory: boolean; waiver_eligible: boolean; state: unknown }>;
    custom: Array<Record<string, unknown>>;
  }>;
  findings: Array<Record<string, unknown>>;
  completion: { total: number; pending: number; unassessed?: number; mandatoryUnmet: number };
  /** ADR-0157: the scope described (null = selected/legacy), the gate's target, and one summary per shortlisted target. */
  scope_target_id?: string | null;
  selected_target_id?: string | null;
  targets?: Array<Record<string, unknown>>;
}

/**
 * `targetId` (ADR-0157) selects an OPENED comparison target; omitted = the
 * selected target the dd gate judges. No tool opens DD — an agent may only
 * suggest a target through propose_approval; a person opens it in the web app.
 */
export async function getProjectDdWorkspace(port: RestPort, projectId: string, targetId?: string) {
  const qs = targetId ? `?target_id=${encodeURIComponent(targetId)}` : "";
  return port.get<DdWorkspaceEnvelope>(`/api/projects/${encodeURIComponent(projectId)}/dd${qs}`);
}
