// @version 1.1.0
/**
 * Notifications (read) — mcp-integration.md §3.
 *
 * ADR-0094: manage_watch was removed — its backing /api/watch surface was
 * deleted along with the project-keyed REST tree. Only the live
 * /api/notifications relay remains.
 */

import { rest } from "../shared/rest-client.ts";

export async function listNotifications() {
  return rest.get("/api/notifications");
}
