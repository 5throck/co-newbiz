// @version 1.0.0
/**
 * Test helper for ADR-0148 option A: a project created on/after
 * DD_UNASSESSED_COUNTED_FROM only completes S9 when every standard DD checklist item
 * is judged, so tests that fake "S9 fully resolved" must judge all of them.
 */
import type { Database } from "bun:sqlite";
import { ulid } from "../../db/lib/ulid.ts";
import { DD_WORKSPACE_CHECKLISTS, getChecklistItems } from "../../app/web-next/lib/library.ts";

export function judgeAllStandardDdItems(db: Database, projectId: string, assessedBy: string, at: string): number {
  let n = 0;
  for (const checklistId of Object.values(DD_WORKSPACE_CHECKLISTS)) {
    for (const item of getChecklistItems(checklistId) ?? []) {
      db.run(
        `INSERT OR IGNORE INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, assessed_by, assessed_at)
         VALUES (?,?,?,?,?,?,?)`,
        [ulid(), projectId, checklistId, item.id, "pass", assessedBy, at],
      );
      n += 1;
    }
  }
  return n;
}
