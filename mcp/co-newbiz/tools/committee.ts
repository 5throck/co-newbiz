// @version 1.2.0
/**
 * Committee tools — ADR-0097 steering-committee deliberation. Thin READ-ONLY
 * REST wrappers (ADR-0011) over /api/opportunities/:id/committee-sessions**.
 * Only the implemented surface is exposed (no-dead-endpoint principle):
 * listing sessions and reading a full transcript (per-round positions,
 * chair agenda proposal, the AI-drafted minutes draft — both ADR-0196 phase
 * B, read-only passthrough of the session payload — chair PROPOSAL, verbatim
 * dissent). Convening/advancing deliberately has no MCP tool yet — writing
 * surface stays web-first until PM asks for it; do not advertise it here
 * before the routes are exposed by name.
 */

import type { RestPort } from "../shared/rest-port.ts";

export async function listCommitteeSessions(port: RestPort, opportunityId: string) {
  return port.get(`/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions`);
}

export async function getCommitteeSession(port: RestPort, opportunityId: string, sessionId: string) {
  return port.get(
    `/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${encodeURIComponent(sessionId)}`,
  );
}
