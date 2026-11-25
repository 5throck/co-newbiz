// Investment uncertainty is the S5 greenfield (in-house entry) simulation output; brownfield projects
// have none, so every S8 surface that would show it asks this helper first. Null/unset track keeps it.
import type { Database } from "bun:sqlite";

export function investUncertaintyApplies(db: Database, projectId: string): boolean {
  try {
    const row = db.query("SELECT track FROM md_project WHERE id = ?").get(projectId) as {
      track: string | null;
    } | null;
    return row?.track !== "brownfield";
  } catch {
    return true;
  }
}
