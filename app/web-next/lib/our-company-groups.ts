// Shared read queries for company groups — used by the business route
// (/api/our-company/groups*) and the admin Business Targets screen
// (/api/admin/business-targets/groups*, ADR-0146) so both return one shape.
import type { Database } from "bun:sqlite";
import { loadLatestProfile } from "./company-profile-pipeline.ts";

export type GroupListRow = { id: string; name: string; created_at: string; member_count: number };

export function listGroups(db: Database): GroupListRow[] {
  return db
    .query(
      `SELECT g.id, g.name, g.created_at,
              (SELECT COUNT(*) FROM company_group_member m WHERE m.group_id = g.id AND m.deleted_at IS NULL) AS member_count
       FROM company_group g WHERE g.deleted_at IS NULL ORDER BY g.created_at DESC`,
    )
    .all() as GroupListRow[];
}

export function getGroupDetail(db: Database, id: string) {
  const group = db
    .query("SELECT id, name, created_at FROM company_group WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { id: string; name: string; created_at: string } | null;
  if (!group) return null;

  const members = db
    .query(
      `SELECT m.id, m.company_name, m.dart_corp_code, m.role, m.created_at,
              (SELECT MAX(version_no) FROM company_profile_version v WHERE v.member_id = m.id) AS latest_version,
              (SELECT MAX(created_at) FROM company_profile_version v WHERE v.member_id = m.id) AS analyzed_at
       FROM company_group_member m WHERE m.group_id = ? AND m.deleted_at IS NULL ORDER BY m.created_at`,
    )
    .all(id) as Array<{
    id: string; company_name: string; dart_corp_code: string | null; role: "hq" | "affiliate";
    created_at: string; latest_version: number | null; analyzed_at: string | null;
  }>;

  const profiles = members.map((m) => ({
    member_id: m.id,
    company_name: m.company_name,
    role: m.role,
    latest_version: m.latest_version,
    profile: m.latest_version ? loadLatestProfile(db, { kind: "member", id: m.id }) : null,
  }));
  return { group, members, profiles };
}
