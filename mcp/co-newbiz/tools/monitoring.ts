// @version 1.0.0
/**
 * list_notifications (read) / manage_watch (✱ write) — mcp-integration.md §3.
 * manage_watch requires the token's write scope; a read-scoped token gets
 * the REST layer's own 403 insufficient_scope envelope (app/server/
 * middleware.ts enforces this before any handler runs — the MCP server
 * does not duplicate that check, it relays it).
 */

import { rest } from "../shared/rest-client.ts";

export async function listNotifications() {
  return rest.get("/api/notifications");
}

export interface WatchRuleInput {
  trigger_type: string;
  threshold?: number;
  cooldown_hours?: number;
  channel: string;
}

export async function manageWatch(
  action: "create" | "delete",
  opts: { projectId?: string; rules?: WatchRuleInput[]; watchId?: string },
) {
  if (action === "create") {
    if (!opts.projectId) throw new Error("projectId is required to create a watch.");
    return rest.post("/api/watch", { project_id: opts.projectId, rules: opts.rules ?? [] });
  }
  if (!opts.watchId) throw new Error("watchId is required to delete a watch.");
  return rest.delete(`/api/watch/${encodeURIComponent(opts.watchId)}`);
}
