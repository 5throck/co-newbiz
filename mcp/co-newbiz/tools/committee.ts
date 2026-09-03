// @version 1.0.0
/**
 * Committee tools — ADR-0097 steering-committee deliberation. Thin READ-ONLY
 * REST wrappers (ADR-0011) over /api/opportunities/:id/committee-sessions**.
 * Only the implemented surface is exposed (no-dead-endpoint principle):
 * listing sessions and reading a full transcript (per-round positions,
 * chair PROPOSAL, verbatim dissent). Convening/advancing deliberately has no
 * MCP tool yet — writing surface stays web-first until PM asks for it; do
 * not advertise it here before the routes are exposed by name.
 */

import { rest } from "../shared/rest-client.ts";

export async function listCommitteeSessions(opportunityId: string) {
  return rest.get(`/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions`);
}

export async function getCommitteeSession(opportunityId: string, sessionId: string) {
  return rest.get(
    `/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(sessionId)}`,
  );
}
