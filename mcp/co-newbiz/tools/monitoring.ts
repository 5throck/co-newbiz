// @version 1.2.0
/**
 * Notifications (read) — mcp-integration.md §3.
 *
 * ADR-0094: manage_watch was removed — its backing /api/watch surface was
 * deleted along with the project-keyed REST tree. Only the live
 * /api/notifications relay remains.
 */

import type { RestPort } from "../shared/rest-port.ts";

export async function listNotifications(port: RestPort) {
  return port.get("/api/notifications");
}
