// @version 1.0.0
/**
 * deal_archive manifest reader — the archive-side of the deletion-mark model
 * (deal-deletion-playbook). Rows are written when a deal is closed/archived or
 * delete-marked; this repository is the only read path.
 *
 * Deny-by-default: a manifest row is readable only by callers who were project
 * members at the time the mark was made (member_user_ids_json allowlist) —
 * the same membership gate the live deal had, kept permanently for audit.
 * Admins are excluded at the route layer (role separation, ADR-0091).
 */

import { getDb } from "../client.ts";

export interface DealArchiveRow {
  id: string;
  kind: "archived" | "deleted";
  entity_type: "project" | "opportunity";
  project_id: string | null;
  opportunity_id: string | null;
  project_no: string | null;
  project_name: string | null;
  track: string | null;
  status_at_archive: string | null;
  market_freeze_json: string | null;
  member_user_ids_json: string;
  mnpi_flag: number;
  acted_by: string;
  acted_at: string;
  reason: string | null;
}

export function listDeletedDealArchives(callerId: string): DealArchiveRow[] {
  return getDb()
    .query(
      `SELECT * FROM deal_archive WHERE kind = 'deleted' AND member_user_ids_json LIKE ? ORDER BY acted_at DESC`,
    )
    .all(`%"${callerId}"%`) as DealArchiveRow[];
}

export function getDealArchiveIfVisible(callerId: string, archiveId: string): DealArchiveRow | null {
  const row = getDb().query("SELECT * FROM deal_archive WHERE id = ?").get(archiveId) as
    | DealArchiveRow
    | undefined;
  if (!row) return null;
  let members: string[] = [];
  try {
    members = JSON.parse(row.member_user_ids_json) as string[];
  } catch {
    members = [];
  }
  if (!members.includes(callerId)) return null;
  return row;
}
