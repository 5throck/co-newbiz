// @version 1.1.0
// Pipeline status (read) — ADR-0102 §6. Read-only relay of
// GET /api/opportunities/[id]/pipeline/status: the active run's status,
// current stage, paused reason, and deep-link target. No write capability is
// exposed over MCP — consistent with the project's read-mostly MCP posture;
// pipeline START deliberately has no MCP tool (the ADR-0102 start route is a
// web action).
import type { RestPort } from "../shared/rest-port.ts";

export async function getPipelineStatus(port: RestPort, opportunityId: string) {
  return port.get(`/api/opportunities/${encodeURIComponent(opportunityId)}/pipeline/status`);
}
