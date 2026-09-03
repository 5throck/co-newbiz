// @version 1.0.0
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

import { rest } from "../shared/rest-client.ts";

export interface DdWorkspaceEnvelope {
  domains: Array<{
    domain: string;
    checklistId: string;
    title: string;
    items: Array<{ id: string; text: string; mandatory: boolean; waiver_eligible: boolean; state: unknown }>;
    custom: Array<Record<string, unknown>>;
  }>;
  findings: Array<Record<string, unknown>>;
  completion: { total: number; pending: number; mandatoryUnmet: number };
}

export async function getProjectDdWorkspace(projectId: string) {
  return rest.get<DdWorkspaceEnvelope>(`/api/projects/${encodeURIComponent(projectId)}/dd`);
}
